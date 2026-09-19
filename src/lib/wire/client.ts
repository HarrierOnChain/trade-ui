// terminal-wire-v1 client. Single WSS per regional backend; multiplexed
// request/response and subscriptions; encrypted under the application-layer
// session key derived in protocol.ts.
//
// Lifecycle:
//   const w = new WireClient({ wsUrl, token })
//   await w.ready                       // resolves after handshake + auth
//   const me = await w.call("auth.me")  // request/response
//   const sub = w.subscribe("trades.byMint", { mint }, ev => ...)
//   sub.cancel()
//   w.close()
//
// On unexpected close the client reconnects with capped backoff; pending
// requests reject with `{ code: "wire_closed" }` so React hooks can retry.
// Active topic subscriptions are kept and re-armed on the new session (new
// wire sub ids) so raze.feed and other streams survive transient drops.

import {
  DIR_C2S, DIR_S2C, WIRE_VERSION,
  decryptFrame, deriveKey, dh, encryptFrame,
  encodeMessage, decodeMessage, newEphemeral,
  type AppMessage,
} from "./protocol";
import { WIRE_OPEN_EVENT, type WireOpenDetail } from "./events";

// X25519 public half of WIRE_STATIC_PRIV held by every regional backend.
// Pinned in the bundle — rotation requires a frontend redeploy.
// Override with NEXT_PUBLIC_WIRE_SERVER_STATIC_PUB for local/dev backends
// that use a different WIRE_STATIC_PRIV (e.g. faggot-dev on :4210).
export const WIRE_SERVER_STATIC_PUB_HEX =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WIRE_SERVER_STATIC_PUB) ||
  "074e570b0ec770b4074d0c3fac6791357bf5ea005fe2c2ba68dae801f49f690e";

export interface WireOptions {
  /** Full ws/wss URL of the backend wire endpoint, e.g. wss://fr.raze.sh/terminal/backend/wire */
  wsUrl: string;
  /** Backend session bearer; null for an anonymous channel. */
  token: string | null;
  /** Server static pubkey (hex). Defaults to the bundled value above. */
  serverStaticPubHex?: string;
}

export interface WireError { code: string; msg?: string }
export class WireRpcError extends Error {
  code: string;
  constructor(e: WireError) { super(e.msg ?? e.code); this.code = e.code; }
}

interface PendingCall {
  resolve: (data: unknown) => void;
  reject: (err: WireRpcError) => void;
}

/** Logical subscription — survives reconnect; re-armed with a fresh wire id. */
interface ActiveSub {
  topic: string;
  params: unknown;
  onEvent: (ev: unknown) => void;
  onEnd?: (e?: WireError) => void;
  /** Server-facing sub id while this session is armed; null between disconnect and replay. */
  wireId: number | null;
}

export interface WireSubscription {
  cancel(): void;
}

type Phase = "connecting" | "open" | "closed";

/** Default request/response timeout — mirrors WIRE_RPC_TIMEOUT_MS in
 *  src/api/client.ts so a wire call can never hang forever when the backend
 *  accepts the frame but stops answering. */
const WIRE_CALL_TIMEOUT_MS = 25_000;

export class WireClient {
  private ws: WebSocket | null = null;
  private key: Uint8Array | null = null;
  private txSeq = 0n;
  private rxSeq = 0n;
  private phase: Phase = "closed";
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  /** Stable client-side id → subscription intent (handlers + topic). */
  private activeSubs = new Map<number, ActiveSub>();
  /** Wire sub id on the current session → stable client-side id. */
  private wireIdToSubId = new Map<number, number>();
  private readyResolve!: () => void;
  private readyReject!: (e: Error) => void;

  /** Resolves once the handshake + auth ack has succeeded. Re-armed on every reconnect. */
  ready: Promise<void>;

  constructor(private readonly opts: WireOptions) {
    this.ready = new Promise<void>((res, rej) => { this.readyResolve = res; this.readyReject = rej; });
    this.connect();
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.phase === "closed") return Promise.reject(new WireRpcError({ code: "wire_closed" }));
    return this.ready.then(() => new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        // Drop the pending entry first so a late response is a no-op instead
        // of settling the promise a second time.
        if (!this.pending.delete(id)) return;
        reject(new WireRpcError({ code: "wire_timeout" }));
      }, WIRE_CALL_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (d) => { clearTimeout(timer); resolve(d as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.send({ id, m: method, ...(params !== undefined ? { p: params } : {}) });
    }));
  }

  subscribe(
    topic: string,
    params: unknown,
    onEvent: (data: unknown) => void,
    onEnd?: (err?: WireError) => void,
  ): WireSubscription {
    const stableId = this.nextId++;
    this.activeSubs.set(stableId, { topic, params, onEvent, onEnd, wireId: null });
    void this.ready.then(() => this.armSub(stableId));
    return {
      cancel: () => this.cancelSub(stableId),
    };
  }

  close(): void {
    this.phase = "closed";
    try { this.ws?.close(); } catch { /* ignore */ }
    for (const p of this.pending.values()) p.reject(new WireRpcError({ code: "wire_closed" }));
    this.pending.clear();
    for (const reg of this.activeSubs.values()) {
      try { reg.onEnd?.({ code: "wire_closed" }); } catch { /* ignore */ }
    }
    this.activeSubs.clear();
    this.wireIdToSubId.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private connect(isReconnect = false): void {
    this.phase = "connecting";
    this.txSeq = 0n;
    this.rxSeq = 0n;
    this.key = null;
    // Reject any prior `ready` waiters before replacing the promise — otherwise
    // a reconnect mid-handshake orphans `raze.get` forever (monitor skeletons).
    // Skip on the constructor's first connect (nothing has awaited yet).
    if (isReconnect) {
      try {
        this.readyReject(new WireRpcError({ code: "wire_closed" }));
      } catch { /* already settled */ }
    }
    this.ready = new Promise<void>((res, rej) => { this.readyResolve = res; this.readyReject = rej; });

    const ws = new WebSocket(this.opts.wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    const eph = newEphemeral();
    let serverEphPub: Uint8Array | null = null;
    let handshakeDone = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ v: WIRE_VERSION, ce: b64encode(eph.pub) }));
    };

    ws.onmessage = (event) => {
      try {
        if (!handshakeDone) {
          const text = typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(new Uint8Array(event.data as ArrayBuffer));
          const hello = JSON.parse(text) as { v: number; se: string };
          if (hello?.v !== WIRE_VERSION || typeof hello.se !== "string") throw new Error("bad server hello");
          serverEphPub = b64decode(hello.se);
          const serverStaticPub = hexDecode(this.opts.serverStaticPubHex ?? WIRE_SERVER_STATIC_PUB_HEX);
          this.key = deriveKey({
            dh1: dh(eph.priv, serverStaticPub),
            dh2: dh(eph.priv, serverEphPub),
            clientEphPub: eph.pub,
            serverEphPub,
          });
          handshakeDone = true;
          // Send auth as the first encrypted frame.
          this.send({ auth: this.opts.token ?? null }, /*beforeReady*/ true);
          return;
        }

        const frame = new Uint8Array(event.data as ArrayBuffer);
        const dec = decryptFrame(this.key!, frame);
        if (dec.direction !== DIR_S2C) throw new Error("wrong direction");
        if (dec.seq <= this.rxSeq) throw new Error("replay");
        this.rxSeq = dec.seq;
        const msg = decodeMessage(dec.plaintext);
        this.handleMessage(msg);
      } catch (err) {
        // Anything malformed → drop the socket and let onclose schedule a retry.
        try { ws.close(1011, (err as Error).message); } catch { /* ignore */ }
      }
    };

    ws.onclose = () => {
      const wasOpen = this.phase === "open";
      this.ws = null;
      this.key = null;
      // Reject everything in flight; React layer will retry on reconnect.
      for (const p of this.pending.values()) p.reject(new WireRpcError({ code: "wire_closed" }));
      this.pending.clear();
      // Drop wire ids for this session; logical subs stay for replay after auth.
      this.disarmAllSubs();
      // Unblock callers waiting on `ready` for this attempt (auth never came).
      try {
        this.readyReject(new WireRpcError({ code: "wire_closed" }));
      } catch { /* already settled */ }

      if (this.phase === "closed") return;
      this.phase = "connecting";
      // Backoff: 250ms → 4s.
      const delay = wasOpen ? 250 : 1000 + Math.random() * 3000;
      setTimeout(() => { if (this.phase !== "closed") this.connect(true); }, delay);
    };

    ws.onerror = () => { /* surfaced via onclose */ };
  }

  private handleMessage(msg: AppMessage): void {
    if ("auth" in msg) {
      const ack = msg as { auth: { ok: boolean } };
      if (!ack.auth?.ok) {
        this.readyReject(new WireRpcError({ code: "auth_failed" }));
        try { this.ws?.close(4401, "auth_failed"); } catch { /* ignore */ }
        return;
      }
      this.phase = "open";
      this.readyResolve();
      this.replayAllSubs();
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<WireOpenDetail>(WIRE_OPEN_EVENT, {
            detail: { wsUrl: this.opts.wsUrl },
          }),
        );
      }
      return;
    }
    if ("id" in msg && ("ok" in msg)) {
      const r = msg as { id: number; ok: boolean; d?: unknown; e?: WireError };
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      if (r.ok) p.resolve(r.d);
      else p.reject(new WireRpcError(r.e ?? { code: "unknown_error" }));
      return;
    }
    if ("ev" in msg) {
      const e = msg as { ev: number; d: unknown };
      const stableId = this.wireIdToSubId.get(e.ev);
      if (stableId != null) this.activeSubs.get(stableId)?.onEvent(e.d);
      return;
    }
    if ("eos" in msg) {
      const e = msg as { eos: number; e?: WireError };
      const stableId = this.wireIdToSubId.get(e.eos);
      if (stableId == null) return;
      const reg = this.activeSubs.get(stableId);
      this.wireIdToSubId.delete(e.eos);
      if (reg) reg.wireId = null;
      // Keep logical sub unless the consumer passed onEnd (explicit teardown).
      // Raze feed subs omit onEnd — replay on the next wire session instead of
      // going dead while RazeWebSocket still thinks it is subscribed.
      if (reg?.onEnd) {
        this.activeSubs.delete(stableId);
        reg.onEnd(e.e);
      }
      return;
    }
  }

  private armSub(stableId: number): void {
    if (this.phase !== "open") return;
    const reg = this.activeSubs.get(stableId);
    if (!reg || reg.wireId != null) return;
    const wireId = this.nextId++;
    reg.wireId = wireId;
    this.wireIdToSubId.set(wireId, stableId);
    this.send({
      sub: wireId,
      t: reg.topic,
      ...(reg.params !== undefined ? { p: reg.params } : {}),
    });
  }

  private replayAllSubs(): void {
    for (const stableId of this.activeSubs.keys()) this.armSub(stableId);
  }

  private disarmAllSubs(): void {
    for (const reg of this.activeSubs.values()) reg.wireId = null;
    this.wireIdToSubId.clear();
  }

  private cancelSub(stableId: number): void {
    const reg = this.activeSubs.get(stableId);
    if (!reg) return;
    if (reg.wireId != null) {
      if (this.phase === "open") this.send({ unsub: reg.wireId });
      this.wireIdToSubId.delete(reg.wireId);
    }
    this.activeSubs.delete(stableId);
  }

  private send(m: AppMessage, beforeReady = false): void {
    if (!this.ws || !this.key) return;
    if (!beforeReady && this.phase !== "open") return;
    this.txSeq += 1n;
    try {
      const frame = encryptFrame(this.key, DIR_C2S, this.txSeq, encodeMessage(m));
      this.ws.send(frame);
    } catch {
      try { this.ws.close(); } catch { /* ignore */ }
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function b64encode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hexDecode(h: string): Uint8Array {
  if (h.length % 2 !== 0) throw new Error("bad hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
