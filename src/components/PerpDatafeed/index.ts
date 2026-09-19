/**
 * PerpDatafeed – IBasicDataFeed implementation for perpetual
 * markets. Mirrors `SolanaDatafeed` but reads from `/api/sol/perp/markets/{id}/candles`
 * and subscribes to `perp_fill` WS events with a `markets` subscription.
 *
 * Price scale: the perp API returns `open/high/low/close` already as e6 USD
 * (because `perp_fills.price` is e6 USD per unit base). We divide by 1e6 so
 * the chart axis shows human-readable USD. `volume_usd` arrives as plain USD
 * already (the OHLCV accumulator divides size_e6 / 1e6 before flushing).
 */
import type {
  IExternalDatafeed,
  IDatafeedChartApi,
  DatafeedConfiguration,
  LibrarySymbolInfo,
  ResolutionString,
  PeriodParams,
  HistoryCallback,
  DatafeedErrorCallback,
  OnReadyCallback,
  SearchSymbolsCallback,
  ResolveCallback,
  SubscribeBarsCallback,
  Bar,
  GetMarksCallback,
  Mark,
} from "../../lib/razeChart";

export type MarksProvider = (fromSec: number, toSec: number) => Mark[];

import { getBackendBase } from "../../api/config";
import { getWire } from "../../lib/wire/singleton";
import type { WireSubscription } from "../../lib/wire/client";
import { REGION_CHANGED_EVENT } from "../../lib/regions";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Proxy a Raze GET through the regional Terminal backend over the
 *  encrypted wire. */
function razeFetch<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  return getWire(getBackendBase()).call<T>("raze.get", { path, params });
}

// Perp uses 1m as smallest TV resolution. Sub-minute candles add noise without
// useful signal for these markets, and the toolbar starts at 1m.
const SUPPORTED_RESOLUTIONS = ["1", "5", "15", "60", "240", "1D"] as ResolutionString[];

function getApiTimeframe(resolution: string): string {
  switch (resolution) {
    case "1":   return "1m";
    case "5":   return "5m";
    case "15":  return "15m";
    case "60":  return "1h";
    case "240": return "4h";
    case "1D":  return "1d";
    default:    return "1m";
  }
}

function timeframeToMs(timeframe: string): number {
  switch (timeframe) {
    case "1m":  return 60_000;
    case "5m":  return 300_000;
    case "15m": return 900_000;
    case "1h":  return 3_600_000;
    case "4h":  return 14_400_000;
    case "1d":  return 86_400_000;
    default:    return 60_000;
  }
}

function alignTime(timeMs: number, resolution: string): number {
  const ms = timeframeToMs(getApiTimeframe(resolution));
  return Math.floor(timeMs / ms) * ms;
}

// ── API response types ────────────────────────────────────────────────────────

interface CandleItem {
  timestamp: number;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume_usd: number;
  trade_count: number;
}

interface CandleResp {
  market_id: string;
  timeframe: string;
  data:  CandleItem[];
  count: number;
}

const CACHE_TTL = 5_000;
// Candles per page when extending history. Backend caps `limit` at 2000; 1000
// keeps each page light while covering ~16h at 1m / ~41d at 1h.
const CHUNK = 1000;
// Safety cap on pages walked back in a single getBars call.
const MAX_PAGES = 20;

export class PerpDatafeed implements IExternalDatafeed, IDatafeedChartApi {
  private _cfg: DatafeedConfiguration = {
    supported_resolutions: SUPPORTED_RESOLUTIONS,
    exchanges:    [{ value: "raze", name: "Raze", desc: "Raze Perps" }],
    symbols_types: [{ name: "perp", value: "perp" }],
    supports_marks: true,
  };

  // Caller-supplied marker source. `getMarks` delegates so React state
  // (live perp_fills, liquidations, user/tracked classification) drives the
  // on-chart marks without re-mounting the widget.
  private _marksProvider: MarksProvider | null = null;

  // listenerGuid → onTick callback
  private _subscribers = new Map<string, SubscribeBarsCallback>();

  private _currentSymbol:     string | null = null;
  private _currentResolution: string | null = null;

  // `{market_id}-{tf}` → { data: Bar[]; ts: number }
  private _cache = new Map<string, { data: Bar[]; ts: number }>();
  // `{market_id}-{resolution}` → last rendered Bar
  private _lastBar = new Map<string, Bar>();
  private _inflight = new Map<string, Promise<void>>();
  // Lazy-pagination state, keyed by `{market_id}-{tf}`:
  //   _oldestTs → ms timestamp of the oldest candle cached (the cursor used as
  //               the next `to` when fetching older history); null = exhausted.
  //   _hasMore  → false once the API has returned a short page (no older data).
  private _oldestTs = new Map<string, number | null>();
  private _hasMore = new Map<string, boolean>();

  private _wireSub: WireSubscription | null = null;
  private _wireSubMarket = "";

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener(REGION_CHANGED_EVENT, this._handleRegionChanged);
    }
  }

  // ── IExternalDatafeed ────────────────────────────────────────────────────

  onReady(cb: OnReadyCallback): void {
    setTimeout(() => cb(this._cfg), 0);
  }

  setMarksProvider(provider: MarksProvider | null): void {
    this._marksProvider = provider;
  }

  // ── Marks (IDatafeedChartApi.getMarks) ────────────────────────────────────
  // TradingView calls this whenever it needs to paint bar marks for a visible
  // range. Delegates to the React-owned provider so filter/state changes in
  // the widget propagate through activeChart().refreshMarks().
  getMarks(
    _symbolInfo: LibrarySymbolInfo,
    from: number,
    to: number,
    onDataCallback: GetMarksCallback<Mark>,
    _resolution: ResolutionString,
  ): void {
    const marks = this._marksProvider ? this._marksProvider(from, to) : [];
    onDataCallback(marks);
  }

  searchSymbols(_: string, __: string, ___: string, cb: SearchSymbolsCallback): void {
    cb([]);
  }

  resolveSymbol(
    symbolName: string,
    onResolve: ResolveCallback,
    onError: DatafeedErrorCallback,
  ): void {
    if (!symbolName) { onError("empty symbol"); return; }
    void this._resolveSymbolAsync(symbolName, onResolve, onError);
  }

  private async _resolveSymbolAsync(
    market: string,
    onResolve: ResolveCallback,
    onError: DatafeedErrorCallback,
  ): Promise<void> {
    try {
      // Pre-load 1m bars to compute pricescale.
      await this._loadBars(market, "1m");
      const cached = this._cache.get(`${market}-1m`);
      const pricescale = this._computePricescale(cached?.data ?? []);

      // "jup:SOL-PERP" → "SOL-PERP" for display
      const label = market.includes(":") ? market.split(":")[1] : market;

      onResolve({
        ticker:               market,
        name:                 label,
        description:          `${market}`,
        type:                 "perp",
        session:              "24x7",
        timezone:             "Etc/UTC",
        exchange:             "Raze",
        listed_exchange:      "Raze",
        format:               "price",
        minmov:               1,
        pricescale,
        has_intraday:         true,
        has_seconds:          true,
        seconds_multipliers:  ["1"],
        intraday_multipliers: ["1", "5", "15", "60", "240"],
        has_daily:            true,
        daily_multipliers:    ["1"],
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        volume_precision:     2,
        data_status:          "streaming",
      });
    } catch (e) {
      onError(String(e));
    }
  }

  /** Pricescale appropriate for typical perp asset ranges (SOL ~$80, BTC ~$60k, ETH ~$2k). */
  private _computePricescale(bars: Bar[]): number {
    let sum = 0, count = 0;
    for (const b of bars) { if (b.close > 0) { sum += b.close; count++; } }
    if (!count) return 100; // 2 dp default
    const ref = sum / count;
    if (ref >= 10_000) return 100;        // BTC: $60_000.00
    if (ref >= 100)    return 100;        // SOL/ETH: $86.45
    if (ref >= 1)      return 10_000;     // sub-$100: 4 dp
    return 1_000_000;                     // sub-$1: 6 dp (sanity)
  }

  getBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onResult: HistoryCallback,
    onError: DatafeedErrorCallback,
  ): void {
    void this._getBarsAsync(symbolInfo.ticker ?? symbolInfo.name, resolution, periodParams, onResult, onError);
  }

  private async _getBarsAsync(
    market: string,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onResult: HistoryCallback,
    onError: DatafeedErrorCallback,
  ): Promise<void> {
    try {
      const tf = getApiTimeframe(resolution);
      const baseKey = `${market}-${tf}`;
      const fromMs = periodParams.from * 1000;
      const toMs   = periodParams.to   * 1000;

      await this._loadBars(market, tf);

      let allBars = this._cache.get(baseKey)?.data ?? [];
      if (!allBars.length) { onResult([], { noData: true }); return; }

      // Scrolling left: TradingView asks for a window older than the oldest
      // candle we hold. Walk the API back (via the `to` cursor) until we cover
      // it or the market has no more history.
      const firstCachedBar = allBars[0];
      const needsOlderData = Boolean(firstCachedBar && fromMs < firstCachedBar.time);
      if (needsOlderData && this._hasMore.get(baseKey) !== false) {
        await this._fetchMoreBars(market, tf, baseKey, fromMs);
        allBars = this._cache.get(baseKey)?.data ?? [];
      }
      if (!allBars.length) { onResult([], { noData: true }); return; }

      const bars = this._getCachedBarsForRange(baseKey, fromMs, toMs);
      if (!bars || bars.length === 0) {
        onResult([], { noData: this._hasMore.get(baseKey) === false });
        return;
      }
      this._lastBar.set(`${market}-${resolution}`, bars[bars.length - 1]!);
      onResult(bars, { noData: false });
    } catch (e) {
      onError(String(e));
    }
  }

  // Return the cached series for a requested [from,to] window. Matches the
  // SolanaDatafeed behavior: if the request overlaps the cache at all, hand
  // back the whole contiguous series rather than slicing it into islands.
  private _getCachedBarsForRange(baseKey: string, fromMs: number, toMs: number): Bar[] | null {
    const cached = this._cache.get(baseKey);
    if (!cached || cached.data.length === 0) return null;
    const allBars = cached.data;
    const firstBarTime = allBars[0]!.time;
    const lastBarTime  = allBars[allBars.length - 1]!.time;
    if (toMs >= firstBarTime && fromMs <= lastBarTime) return allBars;
    if (fromMs > lastBarTime) return allBars; // future window — keep latest
    const filtered = allBars.filter((b) => b.time >= fromMs && b.time <= toMs);
    return filtered.length ? filtered : null;
  }

  // Extend the cache with older candles until we cover `untilMs` or the API
  // runs out. The perp candles endpoint returns up to `limit` rows ending at
  // `to` (ms), newest-first; we page back using the oldest row as the next
  // cursor. A short page means there's no older history.
  private async _fetchMoreBars(
    market: string,
    timeframe: string,
    baseKey: string,
    untilMs: number,
  ): Promise<void> {
    if (this._hasMore.get(baseKey) === false) return;
    const existing = this._cache.get(baseKey)?.data ?? [];
    if (existing.length && existing[0]!.time <= untilMs) return; // already covered

    const cursor = this._oldestTs.get(baseKey);
    if (cursor == null) { this._hasMore.set(baseKey, false); return; }

    const fetchKey = `${baseKey}-more`;
    const inflight = this._inflight.get(fetchKey);
    if (inflight) { await inflight; return; }

    const frameMs = timeframeToMs(timeframe);
    const promise = (async () => {
      const newBars: Bar[] = [];
      let cur = cursor;
      for (let page = 0; page < MAX_PAGES; page++) {
        let resp: CandleResp;
        try {
          resp = await razeFetch<CandleResp>(`/api/sol/perp/markets/${market}/candles`, {
            timeframe, limit: CHUNK, to: cur - 1, // `to` is ms (matches the endpoint)
          });
        } catch { break; }

        const items = resp.data ?? [];
        if (!items.length) { this._hasMore.set(baseKey, false); this._oldestTs.set(baseKey, null); break; }

        let oldestRaw = Infinity;
        for (const it of items) {
          if (it.timestamp < oldestRaw) oldestRaw = it.timestamp;
          newBars.push({
            time:  Math.floor(it.timestamp / frameMs) * frameMs,
            open:  it.open, high: it.high, low: it.low, close: it.close,
            volume: it.volume_usd,
          });
        }
        // Short page → exhausted history.
        if (items.length < CHUNK) { this._hasMore.set(baseKey, false); this._oldestTs.set(baseKey, null); break; }
        this._oldestTs.set(baseKey, oldestRaw);
        cur = oldestRaw;
        if (Math.floor(oldestRaw / frameMs) * frameMs <= untilMs) break;
      }

      if (!newBars.length) return;
      const merged = [...existing, ...newBars].sort((a, b) => a.time - b.time);
      const deduped = merged.filter((b, i) => i === 0 || b.time !== merged[i - 1]!.time);
      for (let i = 1; i < deduped.length; i++) deduped[i]!.open = deduped[i - 1]!.close;
      this._cache.set(baseKey, { data: deduped, ts: this._cache.get(baseKey)?.ts ?? Date.now() });
    })();

    this._inflight.set(fetchKey, promise);
    try { await promise; }
    finally { if (this._inflight.get(fetchKey) === promise) this._inflight.delete(fetchKey); }
  }

  private async _loadBars(market: string, timeframe: string): Promise<void> {
    const baseKey = `${market}-${timeframe}`;
    const cached = this._cache.get(baseKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return;

    const inflight = this._inflight.get(baseKey);
    if (inflight) { await inflight; return; }

    const promise = (async () => {
      let resp: CandleResp;
      try {
        resp = await razeFetch<CandleResp>(`/api/sol/perp/markets/${market}/candles`, {
          timeframe, limit: 1000,
        });
      } catch { return; }

      const items = resp.data ?? [];
      if (!items.length) {
        this._cache.set(baseKey, { data: [], ts: Date.now() });
        this._hasMore.set(baseKey, false);
        this._oldestTs.set(baseKey, null);
        return;
      }

      const frameMs = timeframeToMs(timeframe);
      let oldestRaw = Infinity;
      const bars: Bar[] = items.map((it) => {
        if (it.timestamp < oldestRaw) oldestRaw = it.timestamp;
        const ts = Math.floor(it.timestamp / frameMs) * frameMs;
        // perp_ohlcv_* tables store Float64 USD already (the application-side
        // PerpOhlcvManager divides size_e6 / 1e6 + price_e6 / 1e6 before
        // queuing). volume_usd is also plain USD.
        return {
          time:  ts,
          open:  it.open,
          high:  it.high,
          low:   it.low,
          close: it.close,
          volume: it.volume_usd,
        };
      });
      // Seed pagination: the oldest row is the cursor for fetching older
      // history; a full page implies more may exist, a short one means we
      // already have everything.
      this._oldestTs.set(baseKey, oldestRaw);
      this._hasMore.set(baseKey, items.length >= 1000);
      bars.sort((a, b) => a.time - b.time);
      // Enforce candle continuity
      for (let i = 1; i < bars.length; i++) {
        bars[i]!.open = bars[i - 1]!.close;
      }
      this._cache.set(baseKey, { data: bars, ts: Date.now() });
    })();

    this._inflight.set(baseKey, promise);
    try { await promise; }
    finally {
      if (this._inflight.get(baseKey) === promise) this._inflight.delete(baseKey);
    }
  }

  // ── subscribeBars / unsubscribeBars ───────────────────────────────────────

  subscribeBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: SubscribeBarsCallback,
    listenerGuid: string,
  ): void {
    const market = symbolInfo.ticker ?? symbolInfo.name;
    this._subscribers.set(listenerGuid, onTick);
    this._currentSymbol     = market;
    this._currentResolution = resolution;

    // Seed _lastBar from cache
    const tf = getApiTimeframe(resolution);
    const baseKey = `${market}-${tf}`;
    const cached  = this._cache.get(baseKey);
    if (cached?.data.length) {
      const last = cached.data[cached.data.length - 1];
      if (last) this._lastBar.set(`${market}-${resolution}`, last);
    }

    this._connectWs(market);
  }

  unsubscribeBars(listenerGuid: string): void {
    this._subscribers.delete(listenerGuid);
    if (!this._subscribers.size) this._currentSymbol = null;
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private _connectWs(market: string): void {
    if (this._wireSub && this._wireSubMarket === market) return;
    if (this._wireSub) this._closeWs();
    this._wireSubMarket = market;
    // Backend's raze.feed multiplexer fans out events keyed on `market_id` / `market`.
    // The SolanaDatafeed fast path uses `kind:"token"`; perps use `kind:"markets"`
    // because the upstream Raze WS keys perp_fill events on market id, not mint.
    this._wireSub = getWire(getBackendBase()).subscribe(
      "raze.feed",
      { kind: "markets", markets: [market] },
      (msg) => { void this._handleWs(msg as Record<string, unknown>); },
    );
  }

  private _handleRegionChanged = (): void => {
    this._cache.clear();
    this._lastBar.clear();
    this._inflight.clear();
    this._oldestTs.clear();
    this._hasMore.clear();
    this._closeWs();
    if (this._currentSymbol) this._connectWs(this._currentSymbol);
  };

  private _closeWs(): void {
    if (this._wireSub) {
      try { this._wireSub.cancel(); } catch { /* ignore */ }
      this._wireSub = null;
    }
    this._wireSubMarket = "";
  }

  private _emit(bar: Bar): void {
    this._subscribers.forEach((cb) => cb(bar));
  }

  private async _handleWs(msg: Record<string, unknown>): Promise<void> {
    const type = msg.type as string;
    if (type !== "perp_fill") return;
    const market = String(msg.market_id ?? "");
    const currentSymbol     = this._currentSymbol;
    const currentResolution = this._currentResolution;
    if (!currentSymbol || !currentResolution || market !== currentSymbol) return;

    // The streaming pipeline wraps PerpEvent under msg.data with a `kind:"fill"` tag.
    const data = msg.data as Record<string, unknown> | undefined;
    if (!data) return;
    // PerpEvent::Fill is serialized as { kind: "fill", market_id, venue, ... }
    // Streaming-side strips the `kind` discriminator before broadcasting; on
    // the wire we get the inner Fill fields directly under msg.data.
    const price_e6 = Number(data.price ?? 0);
    const size_e6  = Number(data.size  ?? 0);
    const tsRaw    = Number(data.block_time ?? 0);
    if (!price_e6) return;

    const price = price_e6 / 1_000_000;
    const volumeUsd = size_e6 / 1_000_000;

    let tsMs: number;
    if (tsRaw > 1e12) tsMs = tsRaw;
    else if (tsRaw > 0) tsMs = tsRaw * 1000;
    else tsMs = Date.now();

    const aligned = alignTime(tsMs, currentResolution);
    const barKey  = `${currentSymbol}-${currentResolution}`;
    const lastBar = this._lastBar.get(barKey);

    let bar: Bar;
    if (lastBar && aligned === lastBar.time) {
      bar = {
        time:   aligned,
        open:   lastBar.open,
        high:   Math.max(lastBar.high, price),
        low:    Math.min(lastBar.low,  price),
        close:  price,
        volume: (lastBar.volume || 0) + volumeUsd,
      };
    } else {
      const open = lastBar ? lastBar.close : price;
      bar = {
        time: aligned, open,
        high: Math.max(open, price), low: Math.min(open, price),
        close: price, volume: volumeUsd,
      };
    }
    this._lastBar.set(barKey, bar);
    this._emit(bar);
  }

  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener(REGION_CHANGED_EVENT, this._handleRegionChanged);
    }
    this._closeWs();
    this._subscribers.clear();
    this._cache.clear();
    this._lastBar.clear();
    this._inflight.clear();
    this._oldestTs.clear();
    this._hasMore.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: PerpDatafeed | null = null;

export function getPerpDatafeedInstance(): PerpDatafeed {
  if (!_instance) _instance = new PerpDatafeed();
  return _instance;
}

export function destroyPerpDatafeedInstance(): void {
  _instance?.destroy();
  _instance = null;
}
