"use client";

import { CHAIN_CHANGED_EVENT, getActiveChain } from "../lib/chains";
import { markStreamOpen } from "../lib/streamSettle";
import { apiCandle, apiTokenToEvent, apiTradeToTrade, asRecord, num, type Rec } from "./mappers";
import { fetchNativePrices, nativeUsdSync, setNativePrices } from "./native";

/**
 * Events the UI listens to. Every live source is one channel of the API's
 * single WebSocket (`/ws`), mapped to the UI's internal shapes:
 *
 * | event            | channel                    | payload                                              |
 * |------------------|----------------------------|------------------------------------------------------|
 * | `deploy`         | launchpad board=new        | `kind` snapshot (`rows`) / add / update / remove (a TokenEvent) |
 * | `migrating`      | launchpad board=graduating | same                                                 |
 * | `migration`      | launchpad board=graduated  | same                                                 |
 * | `trade`          | trades                     | a Trade, flat                                        |
 * | `trade_snapshot` | trades                     | `{tokenMint, trades}` newest first, on (re)subscribe  |
 * | `trade_retract`  | trades                     | `{tokenMint, rows: [{signature, wallet}]}`: rows of a slot whose fork was lost |
 * | `candle`         | candles                    | `{tokenMint, interval, unit, kind, candles | candle}` |
 * | `token`          | token                      | `{tokenMint, token: TokenEvent, raw}` (snapshot)      |
 * | `tick`           | token                      | `{tokenMint, time, priceUsd, marketCapUsd, liquidityUsd, lastPrice}` |
 * | `prices`         | prices                     | `{sol, eth, bnb}` USD                                |
 * | `wallet_trade`   | wallet (Solana)            | `{wallet, trade}` or `{wallet, snapshot, trades}`    |
 */
export type WsEventType =
  | "deploy"
  | "migration"
  | "migrating"
  | "trade"
  | "trade_snapshot"
  | "trade_retract"
  | "candle"
  | "token"
  | "tick"
  | "prices"
  | "wallet_trade";

export type WsHandler = (data: Record<string, unknown>) => void;

/** Per-token channels a caller can hold. `candles` has its own method. */
export type TokenChannel = "trades" | "token";

type Channel = "trades" | "candles" | "token" | "launchpad" | "prices" | "wallet";

interface Spec {
  channel: Channel;
  chain?: string;
  token?: string;
  interval?: string;
  unit?: string;
  board?: string;
  wallet?: string;
}

interface Sub {
  spec: Spec;
  rc: number;
  /** Holders that also want the SSE fallback while no socket is up. Per-row
   *  token feeds stay WebSocket-only: one SSE connection each would exhaust
   *  the proxy's stream budget. */
  sse: number;
}

const BOARD_OF: Partial<Record<WsEventType, "new" | "graduating" | "graduated">> = {
  deploy: "new",
  migrating: "graduating",
  migration: "graduated",
};
const EVENT_OF_BOARD: Record<string, WsEventType> = {
  new: "deploy",
  graduating: "migrating",
  graduated: "migration",
};

/** The API allows 200 per socket; keep headroom for the global channels. */
const MAX_SUBS = 195;
/** SSE fallback streams at once: two of the browser's six connections per
 *  origin stay free for everything else. */
const MAX_SSE = 4;

/** Which channels keep streaming when only MAX_SSE can: the open token's
 *  tape and chart first, then prices, its header, and the boards. */
function ssePriority(spec: Spec): number {
  switch (spec.channel) {
    case "trades": return 0;
    case "candles": return 1;
    case "prices": return 2;
    case "token": return 3;
    case "launchpad": return spec.board === "new" ? 4 : spec.board === "graduating" ? 5 : 6;
    default: return 7;
  }
}
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function sidOf(spec: Spec): string {
  return [spec.channel, spec.chain ?? "", spec.board ?? spec.token ?? spec.wallet ?? "", spec.interval ?? "", spec.unit ?? ""]
    .join("|")
    .replace(/\|+$/, "");
}

function sameOriginWsUrl(): string | null {
  if (typeof window === "undefined") return null;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export class RazeWebSocket {
  private static instance: RazeWebSocket | null = null;
  static getInstance(): RazeWebSocket {
    if (!RazeWebSocket.instance) RazeWebSocket.instance = new RazeWebSocket();
    return RazeWebSocket.instance;
  }

  private handlers = new Map<WsEventType, Set<WsHandler>>();
  private socket: WebSocket | null = null;
  private subs = new Map<string, Sub>();
  /** Board events → the subscription currently serving them (chain-bound). */
  private boardSubs = new Map<WsEventType, { rc: number; sid: string }>();
  private sse = new Map<string, AbortController>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private opening = false;
  private attempts = 0;
  private pricesHeld = false;
  private overCapWarned = false;

  private constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener(CHAIN_CHANGED_EVENT, () => this.repointBoards());
      window.addEventListener("trade-ui:api-settings", () => this.resetConnection());
      window.addEventListener("pagehide", () => this.disconnect());
      // Back from the bfcache: the page is alive again but its socket is not.
      window.addEventListener("pageshow", (e) => {
        if ((e as PageTransitionEvent).persisted && this.subs.size) this.ensureSocket();
      });
    }
  }

  // ── connection ──────────────────────────────────────────────────────────

  connect(): void {
    if (typeof window === "undefined") return;
    if (!this.pricesHeld) {
      // Native prices convert every USD field; keep them pushed, not polled.
      this.pricesHeld = true;
      this.retain({ channel: "prices" }, true);
    }
    this.ensureSocket();
  }

  disconnect(): void {
    this.closeSocket();
  }

  /** True while the WebSocket is open (SSE fallback does not count). */
  isLive(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private resetConnection(): void {
    this.closeSocket();
    this.attempts = 0;
    this.ensureSocket();
  }

  private ensureSocket(): void {
    if (typeof window === "undefined") return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.opening || this.reconnectTimer) return;
    this.opening = true;
    void this.openLive().finally(() => { this.opening = false; });
  }

  private async openLive(): Promise<void> {
    // Prime native prices so the first snapshots convert; the `prices`
    // channel keeps them current from then on.
    const primed = fetchNativePrices().catch(() => null);
    // server.mjs serves same-origin `/api/ws` and adds the key itself.
    const url = sameOriginWsUrl();
    const socket = url ? await this.tryWs(url, 6_000) : null;
    await Promise.race([primed, new Promise((r) => setTimeout(r, 1_500))]);
    if (socket) {
      this.bindSocket(socket);
      return;
    }
    // No socket: stream the channels that asked for it over SSE (through
    // the proxy, which adds the key), and keep retrying the socket slowly.
    this.startAllSse();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.attempts += 1;
    const delay = Math.min(30_000, 1_500 * 2 ** Math.min(this.attempts - 1, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureSocket();
    }, delay);
  }

  private tryWs(url: string, ms: number): Promise<WebSocket | null> {
    return new Promise((resolve) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        resolve(null);
        return;
      }
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) {
          try { socket.close(); } catch { /* ignore */ }
          resolve(null);
          return;
        }
        resolve(socket);
      };
      const timer = setTimeout(() => done(false), ms);
      socket.onopen = () => done(true);
      socket.onerror = () => done(false);
      socket.onclose = () => done(false);
    });
  }

  private bindSocket(socket: WebSocket): void {
    socket.onopen = null;
    socket.onerror = null;
    this.abortAllSse();
    this.socket = socket;
    this.attempts = 0;
    markStreamOpen();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: "ping" }));
    }, 20_000);
    socket.onmessage = (ev) => {
      let frame: Rec | null = null;
      try { frame = asRecord(JSON.parse(String(ev.data))); } catch { /* ignore */ }
      if (frame) this.onFrame(frame);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      // Reconnect at once; every channel re-sends its snapshot on subscribe,
      // which is what fills the gap.
      this.scheduleReconnect();
    };
    this.replay();
  }

  private closeSocket(): void {
    this.abortAllSse();
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const s = this.socket;
    this.socket = null;
    try { s?.close(); } catch { /* ignore */ }
  }

  private send(op: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(op));
    }
  }

  private sendSubscribe(sid: string, spec: Spec): void {
    this.send({ op: "subscribe", id: sid, ...spec });
  }

  private replay(): void {
    // Prices first: the snapshots after it convert with a known price.
    const order = [...this.subs.entries()].sort(([, a], [, b]) =>
      Number(b.spec.channel === "prices") - Number(a.spec.channel === "prices"));
    let n = 0;
    for (const [sid, sub] of order) {
      if (n >= MAX_SUBS) break;
      this.sendSubscribe(sid, sub.spec);
      n += 1;
    }
  }

  // ── subscription registry ───────────────────────────────────────────────

  private retain(spec: Spec, sse = false): string {
    const sid = sidOf(spec);
    const cur = this.subs.get(sid);
    if (cur) {
      cur.rc += 1;
      if (sse) {
        cur.sse += 1;
        if (cur.sse === 1 && this.inFallback()) this.rebalanceSse();
      }
      return sid;
    }
    if (this.subs.size >= MAX_SUBS) {
      if (!this.overCapWarned) {
        this.overCapWarned = true;
        console.warn(`[raze-ws] ${MAX_SUBS} live subscriptions reached; further ones are skipped`);
      }
      return sid;
    }
    const sub: Sub = { spec, rc: 1, sse: sse ? 1 : 0 };
    this.subs.set(sid, sub);
    if (this.isLive()) this.sendSubscribe(sid, spec);
    else if (!this.opening && !this.reconnectTimer) this.ensureSocket();
    if (sub.sse > 0 && this.inFallback()) this.rebalanceSse();
    return sid;
  }

  private release(sid: string, sse = false): void {
    const cur = this.subs.get(sid);
    if (!cur) return;
    if (sse && cur.sse > 0) cur.sse -= 1;
    if (cur.rc > 1) {
      cur.rc -= 1;
      if (cur.sse === 0 && this.sse.has(sid)) {
        this.closeSse(sid);
        if (this.inFallback()) this.rebalanceSse();
      }
      return;
    }
    this.subs.delete(sid);
    if (this.sse.has(sid)) {
      this.closeSse(sid);
      if (this.inFallback()) this.rebalanceSse();
    }
    this.send({ op: "unsubscribe", id: sid });
  }

  private boardSpec(t: WsEventType): Spec | null {
    const board = BOARD_OF[t];
    if (!board) return null;
    return { channel: "launchpad", board, chain: getActiveChain() };
  }

  /** A chain switch moves every board subscription to the new chain. */
  private repointBoards(): void {
    for (const [t, entry] of this.boardSubs) {
      const spec = this.boardSpec(t);
      if (!spec) continue;
      const sid = sidOf(spec);
      if (sid === entry.sid) continue;
      for (let i = 0; i < entry.rc; i++) {
        this.retain(spec, true);
        this.release(entry.sid, true);
      }
      entry.sid = sid;
    }
  }

  // ── SSE fallback ────────────────────────────────────────────────────────

  private abortAllSse(): void {
    for (const ac of this.sse.values()) {
      try { ac.abort(); } catch { /* ignore */ }
    }
    this.sse.clear();
  }

  private closeSse(sid: string): void {
    const ac = this.sse.get(sid);
    if (!ac) return;
    try { ac.abort(); } catch { /* ignore */ }
    this.sse.delete(sid);
  }

  /** No socket, and the last attempt to open one failed. */
  private inFallback(): boolean {
    return !this.isLive() && !this.opening && this.reconnectTimer != null;
  }

  private startAllSse(): void {
    this.rebalanceSse();
  }

  /**
   * Keep at most MAX_SSE streams open, the most useful first. Each SSE stream
   * holds one of the browser's six HTTP/1.1 connections to this origin for as
   * long as it lives; with seven open (prices, three boards, the token's
   * trades/candles/token) every other request — REST, JS chunks — queued
   * behind them and the token page never finished loading.
   */
  private rebalanceSse(): void {
    if (this.isLive()) {
      this.abortAllSse();
      return;
    }
    const want = [...this.subs.entries()]
      .filter(([, sub]) => sub.sse > 0)
      .sort(([, a], [, b]) => ssePriority(a.spec) - ssePriority(b.spec))
      .slice(0, MAX_SSE);
    const keep = new Set(want.map(([sid]) => sid));
    for (const sid of [...this.sse.keys()]) if (!keep.has(sid)) this.closeSse(sid);
    for (const [sid, sub] of want) this.startSse(sid, sub);
  }

  private startSse(sid: string, sub: Sub): void {
    if (sub.sse <= 0 || this.sse.has(sid) || typeof window === "undefined") return;
    const ac = new AbortController();
    this.sse.set(sid, ac);
    const { channel, ...params } = sub.spec;
    const url = new URL(`/api/raze/stream/${channel}`, window.location.origin);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, String(v));
    void this.readSse(sid, url.pathname + url.search, ac);
  }

  private async readSse(sid: string, path: string, ac: AbortController): Promise<void> {
    let attempt = 0;
    const headers: Record<string, string> = { accept: "text/event-stream" };
    while (!ac.signal.aborted) {
      try {
        const res = await fetch(path, { headers, signal: ac.signal, cache: "no-store" });
        if (!res.ok || !res.body) throw new Error("sse");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        attempt = 0;
        while (!ac.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let event = "";
            const data: string[] = [];
            for (const line of chunk.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
            }
            if (!data.length) continue;
            try {
              const frame = asRecord(JSON.parse(data.join("\n")));
              if (!frame) continue;
              // SSE frames carry no subscription id; one stream = one sid.
              frame.id = sid;
              if (!frame.type && event) frame.type = event;
              this.onFrame(frame);
            } catch { /* ignore */ }
          }
        }
      } catch {
        if (ac.signal.aborted) return;
      }
      if (ac.signal.aborted) return;
      attempt += 1;
      await sleep(Math.min(12_000, 800 * 2 ** Math.min(attempt, 4)), ac.signal);
    }
  }

  // ── frames ──────────────────────────────────────────────────────────────

  private dispatch(type: WsEventType, msg: Record<string, unknown>): void {
    this.handlers.get(type)?.forEach((h) => {
      try { h(msg); } catch { /* swallow */ }
    });
  }

  private onFrame(f: Rec): void {
    const type = String(f.type ?? "");
    if (!type || type === "pong" || type === "subscribed" || type === "unsubscribed" || type === "lagged") return;
    const sid = typeof f.id === "string" ? f.id : "";
    const sub = this.subs.get(sid);
    if (type === "error") {
      const err = asRecord(f.error);
      console.warn(`[raze-ws] ${sid || "socket"}: ${String(err?.code ?? "error")} ${String(err?.message ?? "")}`);
      return;
    }
    if (!sub) return; // released while the frame was in flight
    const spec = sub.spec;
    const chain = spec.chain ?? getActiveChain();
    switch (spec.channel) {
      case "prices": {
        setNativePrices(f.data);
        const p = asRecord(f.data) ?? {};
        this.dispatch("prices", { type: "prices", ...p });
        return;
      }
      case "launchpad": {
        const event = EVENT_OF_BOARD[spec.board ?? ""];
        if (!event) return;
        const native = nativeUsdSync(chain);
        if (type === "snapshot") {
          const rows = Array.isArray(f.data) ? f.data : [];
          this.dispatch(event, {
            type: event,
            kind: "snapshot",
            board: spec.board,
            chain,
            rows: rows.map((r) => apiTokenToEvent(asRecord(r) ?? {}, native)).filter((t) => t.mint_address),
          });
          return;
        }
        const row = asRecord(f.data);
        if (!row) return;
        const token = apiTokenToEvent(row, native);
        if (!token.mint_address) return;
        this.dispatch(event, { ...token, type: event, kind: type, board: spec.board });
        return;
      }
      case "trades": {
        const native = nativeUsdSync(chain);
        const mint = spec.token ?? "";
        if (type === "snapshot") {
          const rows = Array.isArray(f.data) ? f.data : [];
          this.dispatch("trade_snapshot", {
            type: "trade_snapshot",
            tokenMint: mint,
            trades: rows.map((r) => apiTradeToTrade(asRecord(r) ?? {}, native, mint)),
          });
          return;
        }
        if (type === "retract") {
          // A Solana slot whose fork was lost: its rows never executed. A
          // transaction that landed in another slot comes later as a trade.
          const rows = (Array.isArray(f.data) ? f.data : [])
            .map((r) => asRecord(r) ?? {})
            .map((r) => ({ signature: String(r.signature ?? ""), wallet: String(r.wallet ?? "") }))
            .filter((r) => r.signature);
          if (rows.length) this.dispatch("trade_retract", { type: "trade_retract", tokenMint: mint, rows });
          return;
        }
        const row = asRecord(f.data);
        if (!row) return;
        const trade = apiTradeToTrade(row, native, mint);
        this.dispatch("trade", { ...trade, type: "trade", mint: trade.tokenMint, wallet: trade.signer });
        return;
      }
      case "candles": {
        const base = { type: "candle", tokenMint: spec.token, interval: spec.interval, unit: spec.unit ?? "usd", kind: type };
        if (type === "snapshot") {
          const rows = Array.isArray(f.data) ? f.data : [];
          this.dispatch("candle", {
            ...base,
            candles: rows.map((r) => apiCandle(asRecord(r) ?? {})).filter(Boolean),
          });
          return;
        }
        const candle = apiCandle(asRecord(f.data) ?? {});
        if (candle) this.dispatch("candle", { ...base, candle });
        return;
      }
      case "token": {
        const native = nativeUsdSync(chain);
        const row = asRecord(f.data);
        if (!row) return;
        if (type === "snapshot") {
          this.dispatch("token", {
            type: "token",
            tokenMint: spec.token,
            token: apiTokenToEvent(row, native),
            raw: row,
          });
          return;
        }
        if (type === "tick") {
          const priceUsd = num(row.priceUsd);
          this.dispatch("tick", {
            type: "tick",
            tokenMint: spec.token,
            time: num(row.time) ?? Date.now(),
            priceUsd,
            marketCapUsd: num(row.marketCapUsd),
            liquidityUsd: num(row.liquidityUsd),
            lastPrice: priceUsd != null && native > 0 ? priceUsd / native : undefined,
          });
        }
        return;
      }
      case "wallet": {
        const native = nativeUsdSync(chain);
        const wallet = spec.wallet ?? "";
        const map = (r: unknown) => {
          const row = asRecord(r) ?? {};
          return {
            ...apiTradeToTrade(row, native),
            signer: wallet,
            tokenSymbol: row.tokenSymbol ?? null,
            tokenImage: row.tokenImage ?? null,
          };
        };
        if (type === "snapshot") {
          const rows = Array.isArray(f.data) ? f.data : [];
          this.dispatch("wallet_trade", { type: "wallet_trade", wallet, snapshot: true, trades: rows.map(map) });
          return;
        }
        if (f.data) this.dispatch("wallet_trade", { type: "wallet_trade", wallet, trade: map(f.data) });
        return;
      }
    }
  }

  // ── public API ──────────────────────────────────────────────────────────

  /** Launchpad boards (`deploy` / `migrating` / `migration`) on the active chain. */
  subscribe(types: WsEventType[]): void {
    this.connect();
    for (const t of types) {
      const spec = this.boardSpec(t);
      if (!spec) continue; // not a board
      const cur = this.boardSubs.get(t);
      if (cur) {
        cur.rc += 1;
        this.retain(this.subs.get(cur.sid)?.spec ?? spec, true);
        continue;
      }
      const sid = this.retain(spec, true);
      this.boardSubs.set(t, { rc: 1, sid });
    }
  }

  unsubscribe(types: WsEventType[]): void {
    for (const t of types) {
      const cur = this.boardSubs.get(t);
      if (!cur) continue;
      this.release(cur.sid, true);
      if (cur.rc <= 1) this.boardSubs.delete(t);
      else cur.rc -= 1;
    }
  }

  subscribeMany(eventTypes: WsEventType[]): void {
    this.subscribe(eventTypes);
  }

  /**
   * Per-token live feeds on the active chain. `trades` fires `trade` (and a
   * `trade_snapshot` on every (re)subscribe); `token` fires `token` + `tick`.
   * `sse`: also stream over SSE while no socket is up — for the token being
   * viewed, not for list rows.
   */
  subscribeToken(mint: string, channels: TokenChannel[] = ["trades"], opts: { sse?: boolean } = {}): void {
    if (!mint) return;
    this.connect();
    for (const channel of channels) {
      this.retain({ channel, chain: getActiveChain(), token: mint }, Boolean(opts.sse));
    }
  }

  unsubscribeToken(mint: string, channels: TokenChannel[] = ["trades"], opts: { sse?: boolean } = {}): void {
    if (!mint) return;
    for (const channel of channels) {
      const sid = this.findSid((s) => s.channel === channel && s.token === mint);
      if (sid) this.release(sid, Boolean(opts.sse));
    }
  }

  /** The API's forming bar for (mint, interval, unit): `candle` events. */
  subscribeCandles(mint: string, interval: string, unit: "usd" | "marketCap" = "usd"): void {
    if (!mint) return;
    this.connect();
    this.retain({ channel: "candles", chain: getActiveChain(), token: mint, interval, unit }, true);
  }

  unsubscribeCandles(mint: string, interval: string, unit: "usd" | "marketCap" = "usd"): void {
    const sid = this.findSid((s) => s.channel === "candles" && s.token === mint && s.interval === interval && (s.unit ?? "usd") === unit);
    if (sid) this.release(sid, true);
  }

  /** Every swap of these Solana wallets: `wallet_trade` events. The API's
   *  wallet channel is Solana-only; EVM addresses are skipped. */
  subscribeSigners(signers: string[]): void {
    const list = signers.filter((s) => SOLANA_ADDRESS.test(s));
    if (!list.length) return;
    this.connect();
    for (const wallet of list) this.retain({ channel: "wallet", chain: "sol", wallet }, true);
  }

  unsubscribeSigners(signers: string[]): void {
    for (const wallet of signers) {
      if (!SOLANA_ADDRESS.test(wallet)) continue;
      this.release(sidOf({ channel: "wallet", chain: "sol", wallet }), true);
    }
  }

  on(type: WsEventType, handler: WsHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  private findSid(pred: (s: Spec) => boolean): string | null {
    for (const [sid, sub] of this.subs) if (pred(sub.spec)) return sid;
    return null;
  }
}
