"use client";

import { CHAIN_CHANGED_EVENT, getActiveChain, type ChainId } from "../lib/chains";
import { notifyWireOpen } from "../lib/wire/singleton";
import { nativeUsd } from "./client";
import { imageSrc } from "./evmapi";
import { readApiSettings } from "./settings";

export type WsEventType =
  | "deploy"
  | "migration"
  | "migrating"
  | "trade"
  | "transaction"
  | "analysis"
  | "alert"
  | "priceInfo"
  | "dex_paid"
  | "raze_listeners"
  | "perp_fill"
  | "perp_liquidation"
  | "perp_position_update"
  | "perp_order"
  | "ohlcv";

export type WsHandler = (data: Record<string, unknown>) => void;

type Sub = { cancel(): void };

function wsUrlFrom(base: string, apiKey: string): string {
  const raw = base && base !== "https://api.raze.bot" ? base : "http://127.0.0.1:8810";
  const u = new URL(raw);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = "";
  if (apiKey) u.searchParams.set("api_key", apiKey);
  return u.toString();
}

function sameOriginWsUrl(): string | null {
  if (typeof window === "undefined") return null;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
}

function sseUrl(path: string, extra: Record<string, string> = {}): string {
  const url = new URL(`/api/raze${path}`, window.location.origin);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url.pathname + url.search;
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
  private eventSubs = new Map<WsEventType, { rc: number; sub: Sub }>();
  private tokenSubs = new Map<string, { rc: number; sub: Sub }>();
  private native = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private opening = false;
  private sessionWsUrl: string | null = null;
  private sse = new Map<string, AbortController>();

  private constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener(CHAIN_CHANGED_EVENT, () => this.resetAll());
      window.addEventListener("trade-ui:api-settings", () => this.resetAll());
      window.addEventListener("pagehide", () => this.disconnect());
    }
  }

  connect(): void {
    this.ensureSocket();
    void nativeUsd().then((n) => { this.native = n; }).catch(() => {});
  }
  disconnect(): void { this.closeSocket(); }

  private chain(): ChainId { return getActiveChain(); }

  private dispatch(msg: Record<string, unknown>): void {
    const type = msg.type as WsEventType;
    if (!type) return;
    this.handlers.get(type)?.forEach((h) => {
      try { h(msg); } catch { /* swallow */ }
    });
  }

  private mapDeploy(d: Record<string, unknown>, type: "deploy" | "migration" | "migrating" | "alert"): Record<string, unknown> {
    const safety = d.safety && typeof d.safety === "object" && !Array.isArray(d.safety)
      ? d.safety as Record<string, unknown>
      : null;
    const launchpad = d.launchpad && typeof d.launchpad === "object" && !Array.isArray(d.launchpad)
      ? d.launchpad as Record<string, unknown>
      : null;
    return {
      type,
      mint: d.address,
      mint_address: d.address,
      address: d.address,
      chain: d.chain,
      name: d.name,
      symbol: d.symbol,
      image: imageSrc(typeof d.image === "string" ? d.image : null),
      platform: d.platform,
      dex: d.platform,
      uri: d.uri,
      signer: d.creatorAddress,
      creator: d.creatorAddress,
      created_at: d.createdAt,
      // A completion frame has no migratedAt yet; its curve's completedAt
      // (seconds) is the same moment.
      migrated_at: d.migratedAt ?? (typeof launchpad?.completedAt === "number"
        ? launchpad.completedAt * 1000
        : undefined),
      timestamp: d.createdAt ?? d.migratedAt ?? Date.now(),
      marketCap: d.marketCap,
      liquidity: d.liquidityUsd,
      holders: d.holders,
      priceUsd: d.priceUsd,
      // Percent, like every change on the API. Live frames re-send it as the
      // quote moves, so the row's change is not the one it was born with.
      priceChange: d.change24h ?? d.change1h,
      // Not volume24h: the API's is USD, the columns' filters read it as SOL.
      graduationPercent: launchpad?.graduationPercent,
      // The migrating board drops a row on these.
      completed: launchpad?.completed === true || launchpad?.migrated === true,
      bundlePercentage: safety?.bundlePercentage ?? d.bundlePercentage,
      sniperPercentage: safety?.sniperPercentage ?? d.sniperPercentage,
    };
  }

  private mapTrade(d: Record<string, unknown>): Record<string, unknown> {
    const priceUsd = Number(d.priceUsd || 0);
    const native = this.native || 0;
    return {
      type: "trade",
      tokenMint: d.token,
      mint: d.token,
      signer: d.wallet,
      wallet: d.wallet,
      transactionType: d.side,
      tokensAmount: d.amount,
      avgPrice: native > 0 ? priceUsd / native : priceUsd,
      solAmount: d.sol,
      signature: d.sig,
      timestamp: d.ts,
      usdValue: d.usd,
      isBundle: d.bundle === true,
      isSniper: d.sniper === true,
      slot: d.blockNumber,
    };
  }

  private mapBar(d: Record<string, unknown>): Record<string, unknown> {
    const native = this.native || 1;
    const t = Number(d.t || Date.now());
    return {
      type: "ohlcv",
      candle: {
        timestamp: new Date(t).toISOString(),
        open: Number(d.o || 0) / native,
        high: Number(d.h || 0) / native,
        low: Number(d.l || 0) / native,
        close: Number(d.c || 0) / native,
        volume: Number(d.v || 0),
        sol_price: native,
      },
    };
  }

  private onEnvelope(body: { ok?: boolean; data?: Record<string, unknown> }): void {
    const d = body.data;
    if (!d || typeof d !== "object") return;
    const type = String(d.type || "");
    if (type === "subscribed" || type === "unsubscribed" || type === "pong" || type === "gap") return;
    if (type === "deploy") this.dispatch(this.mapDeploy(d, "deploy"));
    else if (type === "migration") this.dispatch(this.mapDeploy(d, "migration"));
    else if (type === "new") this.dispatch(this.mapDeploy(d, "alert"));
    else if (type === "migrating") this.dispatch(this.mapDeploy(d, "migrating"));
    else if (type === "trade") this.dispatch(this.mapTrade(d));
    else if (type === "bar") this.dispatch(this.mapBar(d));
    else if (type === "stats" && d.price != null) {
      this.dispatch({
        type: "priceInfo",
        priceInfo: { solPrice: this.native },
        solPrice: this.native,
        priceUsd: d.price,
      });
    }
  }

  private candidateWsUrls(): string[] {
    const urls: string[] = [];
    const same = sameOriginWsUrl();
    if (same) urls.push(same);
    const { apiBase, apiKey } = readApiSettings();
    if (apiKey) urls.push(wsUrlFrom(apiBase, apiKey));
    else if (this.sessionWsUrl) urls.push(this.sessionWsUrl);
    return [...new Set(urls)];
  }

  private async loadSessionWs(): Promise<void> {
    if (this.sessionWsUrl) return;
    try {
      const r = await fetch("/api/session", { signal: AbortSignal.timeout(5_000) });
      const j = await r.json() as { wsUrl?: string | null };
      if (j.wsUrl) this.sessionWsUrl = j.wsUrl;
    } catch { /* ignore */ }
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
    });
  }

  private bindSocket(socket: WebSocket, url: string): void {
    socket.onopen = null;
    socket.onerror = null;
    this.abortAllSse();
    this.socket = socket;
    notifyWireOpen(url);
    this.replay();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op: "ping", id: "p" }));
      }
    }, 20_000);
    socket.onmessage = (ev) => {
      try {
        this.onEnvelope(JSON.parse(String(ev.data)));
      } catch { /* ignore */ }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.ensureSocket();
      }, 1500);
    };
  }

  private ensureSocket(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.opening) return;
    this.opening = true;
    void this.openLive().finally(() => { this.opening = false; });
  }

  private async openLive(): Promise<void> {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    await this.loadSessionWs();
    const same = sameOriginWsUrl();
    if (same) {
      const socket = await this.tryWs(same, 5_000);
      if (socket) {
        this.bindSocket(socket, same);
        return;
      }
    }
    for (const url of this.candidateWsUrls()) {
      if (same && url === same) continue;
      const socket = await this.tryWs(url, 800);
      if (socket) {
        this.bindSocket(socket, url);
        return;
      }
    }
    this.replaySse();
  }

  private abortAllSse(): void {
    for (const ac of this.sse.values()) {
      try { ac.abort(); } catch { /* ignore */ }
    }
    this.sse.clear();
  }

  private closeSse(id: string): void {
    const ac = this.sse.get(id);
    if (!ac) return;
    try { ac.abort(); } catch { /* ignore */ }
    this.sse.delete(id);
  }

  private replaySse(): void {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    for (const t of this.eventSubs.keys()) this.startEventSse(t);
    for (const mint of this.tokenSubs.keys()) this.startTokenSse(mint);
  }

  private openSse(id: string, path: string, extra: Record<string, string> = {}): void {
    this.closeSse(id);
    const ac = new AbortController();
    this.sse.set(id, ac);
    void this.readSse(id, path, extra, ac);
  }

  private async readSse(
    id: string,
    path: string,
    extra: Record<string, string>,
    ac: AbortController,
  ): Promise<void> {
    let attempt = 0;
    while (!ac.signal.aborted) {
      try {
        const res = await fetch(sseUrl(path, extra), {
          headers: { accept: "text/event-stream" },
          signal: ac.signal,
          cache: "no-store",
        });
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
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try { this.onEnvelope(JSON.parse(payload)); } catch { /* ignore */ }
            }
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

  private closeSocket(): void {
    this.abortAllSse();
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { this.socket?.close(); } catch { /* ignore */ }
    this.socket = null;
  }

  private send(op: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(op));
    }
  }

  private replay(): void {
    for (const t of this.eventSubs.keys()) this.startEvent(t);
    for (const mint of this.tokenSubs.keys()) this.startToken(mint);
  }

  private resetAll(): void {
    this.sessionWsUrl = null;
    this.closeSocket();
    this.connect();
    this.replay();
  }

  private startEvent(t: WsEventType): void {
    const channel = t === "deploy" ? "deploys"
      : t === "migration" ? "migrations"
      : t === "migrating" ? "migrating"
      : t === "alert" ? "discovery"
      : null;
    if (!channel) return;
    const prev = this.eventSubs.get(t);
    try { prev?.sub.cancel(); } catch { /* ignore */ }
    const id = `e-${t}`;
    this.eventSubs.set(t, {
      rc: prev?.rc ?? 1,
      sub: { cancel: () => this.closeSse(id) },
    });
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.closeSse(id);
      this.send({ op: "subscribe", id, channel, chain: this.chain() });
      return;
    }
    if (this.opening || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.startEventSse(t);
  }

  private startEventSse(t: WsEventType): void {
    const path = t === "deploy" ? "/discovery/deploys/stream"
      : t === "migration" ? "/discovery/migrations/stream"
      : t === "migrating" ? "/discovery/launchpad/stream"
      : t === "alert" ? "/discovery/new/stream"
      : null;
    if (!path) return;
    this.openSse(`e-${t}`, path, { chain: this.chain() });
  }

  private startToken(mint: string): void {
    const prev = this.tokenSubs.get(mint);
    try { prev?.sub.cancel(); } catch { /* ignore */ }
    this.tokenSubs.set(mint, {
      rc: prev?.rc ?? 1,
      sub: { cancel: () => this.closeTokenSse(mint) },
    });
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.closeTokenSse(mint);
      this.send({ op: "subscribe", id: `t-${mint}-trades`, channel: "trades", chain: this.chain(), address: mint });
      this.send({ op: "subscribe", id: `t-${mint}-ohlc`, channel: "ohlc", chain: this.chain(), address: mint });
      this.send({ op: "subscribe", id: `t-${mint}-stats`, channel: "stats", chain: this.chain(), address: mint });
      return;
    }
    if (this.opening || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.startTokenSse(mint);
  }

  private closeTokenSse(mint: string): void {
    this.closeSse(`t-${mint}-trades`);
    this.closeSse(`t-${mint}-ohlc`);
    this.closeSse(`t-${mint}-stats`);
  }

  private startTokenSse(_mint: string): void {
    // Per-token SSE (3 streams × every row) is what filled evmapi's accept
    // queue. Token live data rides the multiplexed WebSocket only.
  }

  subscribe(types: WsEventType[]): void {
    this.connect();
    for (const t of types) {
      const cur = this.eventSubs.get(t);
      if (cur) { cur.rc += 1; continue; }
      this.eventSubs.set(t, { rc: 1, sub: { cancel() {} } });
      this.startEvent(t);
    }
  }

  unsubscribe(types: WsEventType[]): void {
    for (const t of types) {
      const cur = this.eventSubs.get(t);
      if (!cur) continue;
      if (cur.rc <= 1) {
        try { cur.sub.cancel(); } catch { /* ignore */ }
        this.eventSubs.delete(t);
        this.send({ op: "unsubscribe", id: `e-${t}` });
      } else cur.rc -= 1;
    }
  }

  subscribeToken(mint: string): void {
    if (!mint) return;
    this.connect();
    const cur = this.tokenSubs.get(mint);
    if (cur) { cur.rc += 1; return; }
    this.tokenSubs.set(mint, { rc: 1, sub: { cancel() {} } });
    this.startToken(mint);
  }

  unsubscribeToken(mint: string): void {
    if (!mint) return;
    const cur = this.tokenSubs.get(mint);
    if (!cur) return;
    if (cur.rc <= 1) {
      try { cur.sub.cancel(); } catch { /* ignore */ }
      this.tokenSubs.delete(mint);
      this.send({ op: "unsubscribe", id: `t-${mint}-trades` });
      this.send({ op: "unsubscribe", id: `t-${mint}-ohlc` });
      this.send({ op: "unsubscribe", id: `t-${mint}-stats` });
    } else cur.rc -= 1;
  }

  subscribeSigners(_signers: string[]): void {}
  unsubscribeSigners(_signers: string[]): void {}
  subscribeMarket(_marketId: string): void {}
  unsubscribeMarket(_marketId: string): void {}
  subscribeMarkets(_markets: string[]): void {}
  unsubscribeMarkets(_markets: string[]): void {}

  on(type: WsEventType, handler: WsHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  subscribeMany(eventTypes: WsEventType[]): void {
    this.subscribe(eventTypes);
  }
}
