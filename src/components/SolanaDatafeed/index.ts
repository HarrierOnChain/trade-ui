/**
 * SolanaDatafeed – IBasicDataFeed implementation
 * Mirrors solana-frame's SolanaDatafeed, using the public Raze API with ?apiKey=
 *
 * Key differences from the naive version:
 *  - Uses /api/sol/tokens/ohlc/{mint}?timeframe=…  (NOT the trades endpoint)
 *  - Converts SOL prices → market cap:  price × solPrice × tokenSupply
 *  - Cursor-based pagination with oldestTimestamp
 *  - Proper _lastBar continuity for real-time bars
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
  Mark,
  GetMarksCallback,
} from "../../lib/razeChart";

export type MarksProvider = (from: number, to: number) => Mark[];
/** Snapshot of an all-time high in the chart's current display scale. */
export interface ATHInfo { price: number; time: number }
type ATHCallback = (ath: ATHInfo | null) => void;
import { razeGet } from "../../api/client";
import { RazeWebSocket } from "../../api/websocket";
import { fetchPublicMetadata, getCachedPublicMetadata } from "../../api/metadata";
import { REGION_CHANGED_EVENT } from "../../lib/regions";
import { getActiveChain, apiBase, CHAIN_CHANGED_EVENT } from "../../lib/chains";
import { getPreviewData, isPreviewMint, isStreamOnly, subscribePreview } from "../../lib/previewData";
import { despikeBars, LiveBarGuard } from "../../lib/candleDespike";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Raze GET via wire — uses shared `razeGet` (single-flight cache + retry). */
function razeFetch<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  return razeGet<T>(path, params);
}

// ── resolution helpers ────────────────────────────────────────────────────────

const SUPPORTED_RESOLUTIONS = [
  "1S", "5S", "15S", "30S",
  "1", "5", "15", "30", "60", "240",
  "1D",
] as ResolutionString[];

function getApiTimeframe(resolution: string): string {
  switch (resolution) {
    case "1S":  return "1s";
    case "5S":  return "5s";
    case "15S": return "15s";
    case "30S": return "30s";
    case "1":   return "1m";
    case "5":   return "5m";
    case "15":  return "15m";
    case "30":  return "30m";
    case "60":  return "1h";
    case "240": return "4h";
    case "1D":  return "1d";
    default:    return "1m";
  }
}

function timeframeToMs(timeframe: string): number {
  switch (timeframe) {
    case "1s":  return 1_000;
    case "5s":  return 5_000;
    case "15s": return 15_000;
    case "30s": return 30_000;
    case "1m":  return 60_000;
    case "5m":  return 300_000;
    case "15m": return 900_000;
    case "30m": return 1_800_000;
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

interface OHLCVItem {
  timestamp: string;
  token_mint?: string;
  open:   string | number;
  high:   string | number;
  low:    string | number;
  close:  string | number;
  volume: string | number;
  sol_price?: string | number;
}

interface OHLCResponse {
  data:             OHLCVItem[];
  oldestTimestamp:  number | null;
  count?:           number;
}

// ── SolanaDatafeed ────────────────────────────────────────────────────────────

const CHUNK         = 50;   // candles per scroll-back page (_fetchMoreBars)
const INITIAL_LIMIT = 150;  // initial window fetched in ONE request (was INITIAL_PAGES×CHUNK sequential)
const CACHE_TTL     = 5_000; // ms
/** Nominal Solana slot duration. Only used to size the live-bar staleness gate. */
const SLOT_MS       = 400;

export class SolanaDatafeed implements IExternalDatafeed, IDatafeedChartApi {
  private _cfg: DatafeedConfiguration = {
    supported_resolutions: SUPPORTED_RESOLUTIONS,
    exchanges:    [{ value: "raze", name: "Raze", desc: "Raze Solana" }],
    symbols_types: [{ name: "solana", value: "solana" }],
    supports_marks: true,
  };

  // Caller-supplied marker source. `getMarks` delegates here so that
  // React state (trades, filters, user wallets) drives the on-chart marks.
  private _marksProvider: MarksProvider | null = null;

  // listenerGuid → onTick callback
  private _subscribers = new Map<string, SubscribeBarsCallback>();

  private _currentSymbol:     string | null = null;
  private _currentResolution: string | null = null;

  // `{mint}-{apiTimeframe}` → { data: Bar[]; ts: number }
  private _cache   = new Map<string, { data: Bar[]; ts: number }>();
  // `{mint}-{apiTimeframe}` → false means no more history
  private _hasMore = new Map<string, boolean>();
  // `{mint}-{apiTimeframe}` → oldest cursor for next page; null = exhausted
  private _oldestCursor = new Map<string, number | null>();
  private _inflightRequests = new Map<string, Promise<void>>();
  // `{mint}-{resolution}` → last rendered Bar (for continuity)
  private _lastBar = new Map<string, Bar>();
  // `{mint}-{resolution}` → print-corroboration guard for the live bar.
  private _liveGuard = new Map<string, LiveBarGuard>();
  // Highest trade slot seen ≈ chain tip. Mirrors the server's `OHLC_HEAD_SLOT`.
  // ⚠️ Monotonic and never reset per mint: if the FIRST print after a subscribe
  // is itself a stale relay it becomes the head and passes its own gate. Same
  // limitation the server carries; a single fresh print corrects it.
  private _headSlot = 0;
  // All-time-high tracking. Keyed by `{mint}-{apiTimeframe}` to match _cache.
  // Updates are monotonic — once an ATH is recorded it can only be raised by a
  // higher bar. This prevents stale cache TTL refetches (which return only the
  // latest INITIAL_LIMIT bars and lose older history) from accidentally
  // lowering the ATH below a value we already observed.
  private _athByKey = new Map<string, ATHInfo>();
  // baseKey → set of subscriber callbacks. Each TVChart subscribes for its
  // current (mint, resolution) tuple and unsubscribes when the chart tears
  // down or interval changes.
  private _athListeners = new Map<string, Set<ATHCallback>>();

  // SOL price
  private _solPrice          = 0;
  private _solPriceTs        = 0;
  private _solPriceInflight: Promise<number> | null = null;
  // token supply: mint → supply
  private _supply = new Map<string, number>();
  // display label cache: mint → "SYMBOL NAME"
  private _tokenLabel = new Map<string, string>();

  // Display mode
  private _currency: "usd" | "sol" = "usd";
  private _display:  "mcap" | "price" = "mcap";

  // WebSocket
  private _wireSub: { cancel(): void } | null = null;
  private _wireSubMint = "";

  // Preview-mint reactivity: TV reset-cache callbacks (one per subscribeBars
  // listener) fired whenever the deploy form re-publishes its snapshot, so the
  // chart re-pulls the synthetic candles instead of keeping a stale series.
  private _resetCacheCbs = new Map<string, () => void>();
  private _previewDispose: (() => void) | null = null;
  private _previewMint = "";

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener(REGION_CHANGED_EVENT, this._handleRegionChanged);
      // Switching chains changes which upstream OHLC/price/supply come from;
      // wipe caches so the chart refetches against the newly-active chain.
      window.addEventListener(CHAIN_CHANGED_EVENT, this._handleRegionChanged);
    }
  }

  // ── Mode ──────────────────────────────────────────────────────────────────

  getMode(): { currency: "usd" | "sol"; display: "mcap" | "price" } {
    return { currency: this._currency, display: this._display };
  }

  setMode(currency: "usd" | "sol", display: "mcap" | "price"): void {
    if (this._currency === currency && this._display === display) return;
    this._currency = currency;
    this._display  = display;
    // Clear bar caches so getBars re-fetches with the new multipliers
    this._cache.clear();
    this._hasMore.clear();
    this._oldestCursor.clear();
    this._lastBar.clear();
    this._liveGuard.clear();
    // ATH is tracked in the chart's display scale; the previous values are
    // meaningless after the multiplier flips. The TVChart instance is also
    // rebuilt on currency/display change so listeners will re-subscribe.
    this._athByKey.clear();
  }

  setMarksProvider(provider: MarksProvider | null): void {
    this._marksProvider = provider;
  }

  // ── ATH ────────────────────────────────────────────────────────────────────
  // Tracks the highest `bar.high` we've seen across the loaded history of a
  // given (mint, resolution). Surfaced to TVChart so it can paint a single
  // mark + horizontal line at the all-time-high.

  /** Returns the most recent ATH for this (mint, resolution), or null. */
  getATH(mint: string, resolution: ResolutionString): ATHInfo | null {
    return this._athByKey.get(`${mint}-${getApiTimeframe(resolution)}`) ?? null;
  }

  /**
   * Subscribe to ATH changes for a specific (mint, resolution) tuple. Fires on
   * every monotonic update — initial cache load, lazy older-history fetch, or
   * a live bar that breaks the previous high. Returns a disposer.
   */
  addATHListener(
    mint: string,
    resolution: ResolutionString,
    cb: ATHCallback,
  ): () => void {
    const key = `${mint}-${getApiTimeframe(resolution)}`;
    let set = this._athListeners.get(key);
    if (!set) { set = new Set(); this._athListeners.set(key, set); }
    set.add(cb);
    return () => {
      const s = this._athListeners.get(key);
      if (!s) return;
      s.delete(cb);
      if (!s.size) this._athListeners.delete(key);
    };
  }

  private _notifyATH(baseKey: string): void {
    const ath = this._athByKey.get(baseKey) ?? null;
    const set = this._athListeners.get(baseKey);
    if (!set) return;
    for (const cb of set) cb(ath);
  }

  /**
   * Despike a batch of bars, then re-apply open→close continuity.
   *
   * The rule itself lives in `lib/candleDespike` and is a port of the server's
   * `history/src/db/ohlcv_despike.rs` — ONE rule, same constants, so a bar and
   * its refetched self agree instead of the chart rewriting its own history.
   *
   * This replaced a client-only heuristic (mcap-bucketed body/wick ratios down
   * to 1.015 at large cap, median-of-3 windows). It was dropped because:
   *  - it was a SECOND, different rule, so history disagreed with the live bar
   *    and with what the server now serves;
   *  - its thresholds were never measured — at >$1B mcap it trimmed any wick
   *    beyond 1.5%, well inside genuine intra-bar volatility;
   *  - collapsing an outlier body to `open = close = local` mutated the very
   *    closes the next bar used as its reference, so it was not idempotent and
   *    a re-run (every scroll-back re-clamps the whole merged array) could
   *    cascade.
   *
   * Continuity runs AFTER the despike — it overwrites each open with the
   * previous close, which can push the open outside the bar's own range, so the
   * OHLC invariants are re-asserted at the end. The old code skipped that.
   */
  private _sanitizeBars(bars: Bar[]): number {
    const touched = despikeBars(bars);
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i]!;
      b.open = bars[i - 1]!.close;
      b.high = Math.max(b.high, b.open, b.close);
      b.low  = Math.min(b.low,  b.open, b.close);
    }
    return touched;
  }

  /** Sort, drop zero/NaN closes (they paint as holes on a mcap axis), merge
   *  duplicate timestamps, then despike + continuity. */
  private _finalizeHistory(bars: Bar[]): Bar[] {
    bars.sort((a, b) => a.time - b.time);
    const out: Bar[] = [];
    for (const b of bars) {
      if (!(b.close > 0) || !Number.isFinite(b.close) || !Number.isFinite(b.time)) continue;
      b.high = Math.max(b.high, b.open, b.close);
      b.low  = Math.min(b.low,  b.open, b.close);
      const last = out[out.length - 1];
      if (last && last.time === b.time) {
        last.high = Math.max(last.high, b.high);
        last.low = Math.min(last.low, b.low);
        last.close = b.close;
        last.volume = (last.volume || 0) + (b.volume || 0);
      } else {
        out.push(b);
      }
    }
    this._sanitizeBars(out);
    return out;
  }

  // NOTE: `_usdMcapFactor` was removed with the mcap-bucketed spike thresholds
  // it existed to feed. It also carried a latent bug worth recording: in
  // SOL-denominated mode `_loadBars` never fetched the SOL price (it is only
  // needed for USD display), so the factor was computed with solPrice = 1 and
  // every mcap estimate came out ~140x too low — landing on a much looser
  // threshold bucket exactly where the tight one was intended. The
  // corroboration rule needs no marketcap at all, so the whole class of bug
  // goes with it.

  /** Walk a bar batch and raise the stored ATH if any bar's high beats it. */
  private _maybeUpdateATHFromBars(baseKey: string, bars: Bar[]): void {
    let bestPrice = -Infinity;
    let bestTime = 0;
    for (const b of bars) {
      if (Number.isFinite(b.high) && b.high > bestPrice) {
        bestPrice = b.high;
        bestTime = b.time;
      }
    }
    if (!Number.isFinite(bestPrice) || bestPrice <= 0) return;
    const prev = this._athByKey.get(baseKey);
    if (prev && prev.price >= bestPrice) return;
    this._athByKey.set(baseKey, { price: bestPrice, time: bestTime });
    this._notifyATH(baseKey);
  }

  /**
   * Live-bar variant: only raises ATH, never lowers it.
   *
   * ⚠️ `athHigh` exists because the ATH is MONOTONIC while the live wick is not.
   * The live bar deliberately renders an uncorroborated print (it is the last
   * traded price), and that wick retracts when the next print supersedes it —
   * but an ATH taken from it could never retract, so one provisional spike
   * would pin the ATH line at a price the chart itself no longer shows. Callers
   * on the live path pass the CORROBORATED high instead of the rendered one.
   */
  private _maybeUpdateATHFromBar(baseKey: string, bar: Bar, athHigh?: number): void {
    const high = athHigh ?? bar.high;
    if (!Number.isFinite(high) || high <= 0) return;
    const prev = this._athByKey.get(baseKey);
    if (prev && high <= prev.price) return;
    this._athByKey.set(baseKey, { price: high, time: bar.time });
    this._notifyATH(baseKey);
  }

  // ── Marks (IDatafeedChartApi.getMarks) ────────────────────────────────────
  // TradingView calls this whenever it needs to paint bar marks for a visible
  // range. We delegate to the React-owned provider so filter/state changes in
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

  /** Returns the multiplier to convert a raw SOL token price into the display value */
  private _multiplier(solPrice: number, supply: number): number {
    // usd+mcap → price × solPrice × supply  (USD market cap)
    // usd+price → price × solPrice           (USD per token)
    // sol+mcap → price × supply              (SOL market cap)
    // sol+price → price                      (raw SOL price, ×1)
    const sp = this._currency === "usd" ? solPrice : 1;
    const su = this._display  === "mcap" ? supply   : 1;
    return sp * su;
  }

  // ── IExternalDatafeed ────────────────────────────────────────────────────────

  onReady(cb: OnReadyCallback): void {
    setTimeout(() => cb(this._cfg), 0);
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
    mint: string,
    onResolve: ResolveCallback,
    onError: DatafeedErrorCallback,
  ): Promise<void> {
    try {
      // Label is cosmetic — fire in background, don't block resolution on it.
      // Pre-fetch solPrice in parallel with bars so the placeholder branch never
      // sees _solPrice=0 (which would make the initial mcap bar show as $0).
      void this._getTokenLabel(mint);
      // Pre-fetch solPrice + supply in parallel with the OHLCV request so that
      // by the time _loadBars processes the response, both are already cached.
      // Without this, supply is only kicked off *after* the OHLCV response
      // arrives, adding a second serial async hop before the chart can render.
      void this._getSolPrice();
      if (!isPreviewMint(mint) && !isStreamOnly(mint)) {
        void this._getSupply(mint);
        await this._loadBars(mint, "1m", `${mint}-1m`);
      }

      const cached     = this._cache.get(`${mint}-1m`);
      const pricescale = this._computePricescale(cached?.data ?? [], this._display);
      // Deploy preview: use the seeded metadata (the symbol/name the user typed
      // in the wizard) so the legend shows the real ticker; fall back to "-"
      // only until it's seeded. Live mints use the seeded/cached label (sync),
      // then the background-fetched one, then the mint.
      const label      = this._labelFromCache(mint)
        ?? (isPreviewMint(mint) ? "-" : (this._tokenLabel.get(mint) ?? mint));

      onResolve({
        ticker:               mint,
        name:                 label,
        description:          label,
        type:                 "solana",
        session:              "24x7",
        timezone:             "Etc/UTC",
        exchange:             "Raze",
        listed_exchange:      "Raze",
        format:               "price",
        minmov:               1,
        pricescale,
        has_intraday:         true,
        has_seconds:          true,
        seconds_multipliers:  ["1", "5", "15", "30"],
        intraday_multipliers: ["1", "5", "15", "30", "60", "240"],
        has_daily:            true,
        daily_multipliers:    ["1"],
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        volume_precision:     3,
        data_status:          "streaming",
      });
    } catch (e) {
      onError(String(e));
    }
  }

  /** Pick a pricescale that matches the order of magnitude of the actual price data */
  private _computePricescale(bars: Bar[], mode: "mcap" | "price" = "mcap"): number {
    let sum = 0, count = 0;
    for (const b of bars) { if (b.close > 0) { sum += b.close; count++; } }
    if (!count) {
      // No history yet: MCAP values are large (no decimals), PRICE values are tiny (12 dp)
      return mode === "price" ? 1_000_000_000_000 : 1;
    }
    const ref = sum / count;
    if (ref >= 100)         return 1;               // e.g. $6400 mcap
    if (ref >= 1)           return 100;             // 2 dp
    if (ref >= 0.01)        return 10_000;          // 4 dp
    if (ref >= 0.0001)      return 1_000_000;       // 6 dp
    if (ref >= 0.000001)    return 100_000_000;     // 8 dp
    if (ref >= 0.00000001)  return 10_000_000_000;  // 10 dp
    return 1_000_000_000_000;                       // 12 dp
  }

  /** Build a "SYMBOL NAME" label from a metadata record, or null if it has neither. */
  private _labelFrom(meta: { name?: string; symbol?: string } | null | undefined): string | null {
    const name = meta?.name?.trim() ?? "";
    const symbol = meta?.symbol?.trim() ?? "";
    if (!name && !symbol) return null;
    return name && symbol ? `${symbol} ${name}` : symbol || name;
  }

  /** Synchronous label from already-seeded/cached metadata (no network). Read
   *  fresh each time so a re-resolve after the deploy form's name changes picks
   *  up the new value rather than a stale cached label. */
  private _labelFromCache(mint: string): string | null {
    return this._labelFrom(getCachedPublicMetadata(mint));
  }

  private async _getTokenLabel(mint: string): Promise<string> {
    if (this._tokenLabel.has(mint)) return this._tokenLabel.get(mint)!;
    try {
      const label = this._labelFrom(await fetchPublicMetadata(mint));
      if (label) { this._tokenLabel.set(mint, label); return label; }
    } catch { /* fall through */ }
    return mint;
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
    mint: string,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onResult: HistoryCallback,
    onError: DatafeedErrorCallback,
  ): Promise<void> {
    try {
      // Preview-mint short-circuit: real candles synthesised from the deploy
      // form's planned trades (bundle buys + queued market-making fires),
      // bucketed at the requested resolution and scaled like live bars.
      if (isPreviewMint(mint)) {
        const bars = await this._synthesisePreviewBars(mint, resolution, periodParams);
        onResult(bars, { noData: bars.length === 0 });
        return;
      }
      // Stream-only (freshly-deployed) mint: no OHLCV history fetch — return an
      // empty series; live bars build from the WS trade feed (subscribeBars →
      // _connectWs → _handleWs). Avoids the post-deploy chart reload.
      if (isStreamOnly(mint)) {
        onResult([], { noData: true });
        return;
      }
      const timeframe = getApiTimeframe(resolution);
      const baseKey   = `${mint}-${timeframe}`;
      const fromMs    = periodParams.from * 1000;
      const toMs      = periodParams.to   * 1000;

      await this._loadBars(mint, timeframe, baseKey);

      let allBars = this._cache.get(baseKey)?.data ?? [];
      if (!allBars.length) {
        onResult([], { noData: true });
        return;
      }

      const firstCachedBar = allBars[0];
      const needsOlderData = Boolean(firstCachedBar && fromMs < firstCachedBar.time);

      if (needsOlderData && this._hasMore.get(baseKey) !== false) {
        await this._fetchMoreBars(mint, timeframe, baseKey, fromMs);
        allBars = this._cache.get(baseKey)?.data ?? [];
      }

      if (!allBars.length) {
        onResult([], { noData: true });
        return;
      }

      const bars = this._getCachedBarsForRange(baseKey, fromMs, toMs) ?? [];
      if (bars.length === 0) {
        const noMoreHistory = this._hasMore.get(baseKey) === false;
        onResult([], { noData: noMoreHistory });
        return;
      }

      const histLast = bars[bars.length - 1]!;
      const lbKey = `${mint}-${resolution}`;
      const live = this._lastBar.get(lbKey);
      // A history refetch must not rewind the forming live bar — that opened a
      // hole between the REST head and "now", then the next print started a
      // new candle across the gap.
      if (!live || live.time < histLast.time) {
        this._lastBar.set(lbKey, histLast);
      }
      onResult(bars, { noData: false });
    } catch (e) {
      onError(String(e));
    }
  }

  // ── Preview-mint bar synthesiser ────────────────────────────────────────
  // Drives the `/deploy` page's chart from the form's planned trades (bundle
  // buys + queued market-making fires, fill prices walked along the pump.fun
  // curve by the deploy page). Trades are bucketed into REAL candles at the
  // requested resolution and scaled with the same multiplier as live bars
  // (mcap/price × usd/sol), so the preview chart reads exactly like the live
  // chart will the moment the token launches.
  private async _synthesisePreviewBars(
    mint: string,
    resolution: ResolutionString,
    periodParams: PeriodParams,
  ): Promise<Bar[]> {
    const snap = getPreviewData(mint);
    if (!snap) return [];

    const supply   = snap.supply || 1_000_000_000;
    const solPrice = this._currency === "usd" ? (await this._getSolPrice()) || 1 : 1;
    const m        = this._multiplier(solPrice, supply);

    // Pump.fun curve starting price (virt SOL 30 / virt tokens 1.073B) — the
    // first candle opens here, exactly where the live chart will start.
    const basePrice = (30 / 1_073_000_000) * m;

    const fromMs  = periodParams.from * 1000;
    const toMs    = periodParams.to   * 1000;
    const frameMs = timeframeToMs(getApiTimeframe(resolution));

    const tsOf = (t: { timestamp: string | number }): number => {
      const raw = t.timestamp;
      if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
      const n = Date.parse(raw);
      return Number.isFinite(n) ? n : 0;
    };
    const trades = [...(snap.trades ?? [])]
      .filter((t) => Number.isFinite(t.avgPrice) && t.avgPrice > 0)
      .sort((a, b) => tsOf(a) - tsOf(b));

    if (trades.length === 0) {
      // Flat seed candle at the curve's starting price so TV doesn't paint
      // "No data" before any wallet is allocated.
      const time = Math.floor(Date.now() / frameMs) * frameMs;
      if (toMs < time) return [];
      return [{ time, open: basePrice, high: basePrice, low: basePrice, close: basePrice, volume: 0 }];
    }

    // Aggregate fills into OHLC buckets with open/close continuity.
    const bars: Bar[] = [];
    let prevClose = basePrice;
    for (const t of trades) {
      const time  = Math.floor(tsOf(t) / frameMs) * frameMs;
      const price = t.avgPrice * m;
      const vol   = Math.max(0, t.solAmount ?? 0);
      const last  = bars[bars.length - 1];
      if (last && last.time === time) {
        last.high   = Math.max(last.high, price);
        last.low    = Math.min(last.low, price);
        last.close  = price;
        last.volume = (last.volume || 0) + vol;
      } else {
        bars.push({
          time,
          open: prevClose,
          high: Math.max(prevClose, price),
          low:  Math.min(prevClose, price),
          close: price,
          volume: vol,
        });
      }
      prevClose = price;
    }

    // Terminate TV's scroll-back once it asks for a window before our series.
    if (toMs < bars[0]!.time) return [];
    return bars;
  }

  private _getCachedBarsForRange(baseKey: string, fromMs: number, toMs: number): Bar[] | null {
    const cached = this._cache.get(baseKey);
    if (!cached || cached.data.length === 0) return null;

    const allBars = cached.data;
    const firstBarTime = allBars[0]!.time;
    const lastBarTime  = allBars[allBars.length - 1]!.time;

    // Match the working solana-frame behavior: if TradingView's requested
    // range overlaps our cache at all, return the cached series instead of
    // trimming it down into disconnected islands.
    if (toMs >= firstBarTime && fromMs <= lastBarTime) {
      return allBars;
    }

    // When TV requests a future window while the latest bars are still valid,
    // keep showing the latest cached series until realtime catches up.
    if (fromMs > lastBarTime) {
      return allBars;
    }

    const filtered = allBars.filter((bar) => bar.time >= fromMs && bar.time <= toMs);
    return filtered.length ? filtered : null;
  }

  /** Fetches the initial batch of OHLCV data from the API into _cache */
  private async _loadBars(mint: string, timeframe: string, baseKey: string): Promise<void> {
    const cached = this._cache.get(baseKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return;

    const inflight = this._inflightRequests.get(baseKey);
    if (inflight) {
      await inflight;
      return;
    }

    const loadPromise = (async () => {
      const needsSolPrice = this._currency === "usd";
      const needsSupply   = this._display  === "mcap";
      const collected: Bar[] = [];

      // solPrice + supply are fetched lazily, only when the window has data.
      // This makes empty-data tokens (new launches) resolve instantly.
      let globalSolPrice = needsSolPrice ? 0 : 1; // 0 = not yet fetched (USD mode)
      let supply         = needsSupply   ? 0 : 1; // 0 = not yet fetched (mcap mode)

      // Initial window in a SINGLE request. The OHLC endpoint serves this whole
      // window in one round-trip (~15-30ms server-side regardless of limit), so
      // cursor-paginating it into sequential pages only added serial network
      // round-trips to time-to-first-candle. Deeper history loads lazily on
      // scroll-back via _fetchMoreBars, continuing from _oldestCursor.
      let resp: OHLCResponse;
      try {
        resp = await razeFetch<OHLCResponse>(
          `${apiBase(getActiveChain())}/tokens/ohlc/${mint}`,
          { timeframe, limit: INITIAL_LIMIT },
        );
      } catch {
        resp = { data: [], oldestTimestamp: null };
      }

      const items = resp.data ?? [];
      if (!items.length) {
        this._hasMore.set(baseKey, false);
        this._oldestCursor.set(baseKey, null);
      } else {
        // solPrice/supply both needed: display-mode math AND the USD mcap factor
        // that scales MEV detection.
        if (globalSolPrice === 0 || supply === 0) {
          const [fetchedSp, fetchedSu] = await Promise.all([
            globalSolPrice === 0 ? this._getSolPrice()   : Promise.resolve(globalSolPrice),
            supply         === 0 ? this._getSupply(mint) : Promise.resolve(supply),
          ]);
          globalSolPrice = fetchedSp;
          supply         = fetchedSu;
        }

        const frameMs = timeframeToMs(timeframe);
        for (const item of items) {
          const tsRaw = new Date(item.timestamp).getTime();
          const ts    = Math.floor(tsRaw / frameMs) * frameMs; // align to bar boundary
          // Use per-bar sol_price when available (USD mode only), else fall back to global
          const _perCandleSp = item.sol_price != null ? parseFloat(String(item.sol_price)) : 0;
          // Per-candle price only when it is a real positive value (a "0.00"
          // string is truthy but useless) — else fall back to the global SOL
          // USD price.
          const sp = (needsSolPrice && _perCandleSp > 0) ? _perCandleSp : globalSolPrice;
          const m  = this._multiplier(sp, supply);
          collected.push({
            time:   ts,
            open:   parseFloat(String(item.open))  * m,
            high:   parseFloat(String(item.high))  * m,
            low:    parseFloat(String(item.low))   * m,
            close:  parseFloat(String(item.close)) * m,
            volume: parseFloat(String(item.volume)),
          });
        }

        // Cursor for lazy scroll-back. A short page means no older history exists.
        const cursor = resp.oldestTimestamp;
        if (cursor === null || items.length < INITIAL_LIMIT) {
          this._hasMore.set(baseKey, false);
          this._oldestCursor.set(baseKey, null);
        } else {
          this._oldestCursor.set(baseKey, cursor);
        }
      }

      const ready = this._finalizeHistory(collected);
      this._cache.set(baseKey, { data: ready, ts: Date.now() });
      this._maybeUpdateATHFromBars(baseKey, ready);

      // `_cache` and `_lastBar` are two stores describing the same series, and
      // the 5s TTL refetch used to update only the first — so after any
      // background reload they disagreed, and whichever one the chart read next
      // decided what was on screen. That drift is a mechanical source of "the
      // chart changed after a refresh", independent of any filtering.
      //
      // Only bars STRICTLY OLDER than the cache's newest are reconciled: there
      // `_lastBar` is simply behind (the tape went quiet) and the server's closed
      // bar is authoritative and complete, so adopting it also fixes the `open`
      // the next print will chain from.
      //
      // ⚠️ The equal case is left ALONE on purpose. For the bar still forming,
      // the server row is at best 2s stale (the ingest accumulator flushes a
      // second after the window closes) and may be missing prints the tape has
      // already delivered; overwriting would throw live data away. Deciding a
      // winner there needs a merge policy and a measurement, not a guess.
      const res = this._currentResolution;
      if (res && getApiTimeframe(res) === timeframe && ready.length) {
        const newest = ready[ready.length - 1]!;
        const lbKey  = `${mint}-${res}`;
        const live   = this._lastBar.get(lbKey);
        if (live && live.time < newest.time) {
          this._lastBar.set(lbKey, { ...newest });
          this._liveGuard
            .get(lbKey)
            ?.adopt(newest.time, newest.high, newest.low, newest.close);
        }
      }
    })();

    this._inflightRequests.set(baseKey, loadPromise);
    try {
      await loadPromise;
    } finally {
      if (this._inflightRequests.get(baseKey) === loadPromise) {
        this._inflightRequests.delete(baseKey);
      }
    }
  }

  /** Extends the cache with older bars until we cover untilMs or exhaust the API */
  private async _fetchMoreBars(
    mint: string,
    timeframe: string,
    baseKey: string,
    untilMs: number,
  ): Promise<void> {
    if (this._hasMore.get(baseKey) === false) return;

    const existing = this._cache.get(baseKey)?.data ?? [];
    if (existing.length && existing[0]!.time <= untilMs) return; // already covered

    const cursor = this._oldestCursor.get(baseKey);
    if (cursor == null) {
      this._hasMore.set(baseKey, false);
      return;
    }

    const fetchKey = `${baseKey}-more`;
    const inflight = this._inflightRequests.get(fetchKey);
    if (inflight) {
      await inflight;
      return;
    }

    const fetchPromise = (async () => {
      const needsSolPrice = this._currency === "usd";
      // Always fetch both: solPrice/supply needed for display math AND for
      // the USD mcap factor that scales MEV-spike threshold.
      const [globalSolPrice, supply] = await Promise.all([
        this._getSolPrice(),
        this._getSupply(mint),
      ]);

      const newBars: Bar[] = [];
      let cur: number = cursor;

      for (let page = 0; page < 20; page++) {
        const params: Record<string, string | number> = { timeframe, limit: CHUNK, to: cur - 1 };

        let resp: OHLCResponse;
        try {
          resp = await razeFetch<OHLCResponse>(`${apiBase(getActiveChain())}/tokens/ohlc/${mint}`, params);
        } catch {
          break;
        }

        const items = resp.data ?? [];
        if (!items.length) {
          this._hasMore.set(baseKey, false);
          this._oldestCursor.set(baseKey, null);
          break;
        }

        const frameMs = timeframeToMs(timeframe);
        for (const item of items) {
          const tsRaw = new Date(item.timestamp).getTime();
          const ts    = Math.floor(tsRaw / frameMs) * frameMs;
          const _perCandleSp = item.sol_price != null ? parseFloat(String(item.sol_price)) : 0;
          // Per-candle price only when it is a real positive value (a "0.00"
          // string is truthy but useless) — else fall back to the global SOL
          // USD price.
          const sp = (needsSolPrice && _perCandleSp > 0) ? _perCandleSp : globalSolPrice;
          const m  = this._multiplier(sp, supply);
          newBars.push({
            time:   ts,
            open:   parseFloat(String(item.open))  * m,
            high:   parseFloat(String(item.high))  * m,
            low:    parseFloat(String(item.low))   * m,
            close:  parseFloat(String(item.close)) * m,
            volume: parseFloat(String(item.volume)),
          });
        }

        const nextCursor = resp.oldestTimestamp;
        if (nextCursor === null || items.length < CHUNK) {
          this._hasMore.set(baseKey, false);
          this._oldestCursor.set(baseKey, null);
          break;
        }
        this._oldestCursor.set(baseKey, nextCursor);
        cur = nextCursor;

        // Stop once we've fetched past the requested window
        const oldest = newBars.reduce((m, b) => Math.min(m, b.time), Infinity);
        if (oldest <= untilMs) break;
      }

      if (!newBars.length) return;

      // Merge with existing, drop zeros / duplicate timestamps, despike.
      // Re-running over the WHOLE merged array is safe because `despikeBars` is
      // idempotent — that is exactly what the old non-idempotent clamp was not.
      const deduped = this._finalizeHistory([...existing, ...newBars]);

      // Keep original ts so TTL-based refresh of recent data still works
      this._cache.set(baseKey, { data: deduped, ts: this._cache.get(baseKey)?.ts ?? Date.now() });
      // Older history may contain a higher high than what we'd seen so far.
      this._maybeUpdateATHFromBars(baseKey, newBars);
    })();

    this._inflightRequests.set(fetchKey, fetchPromise);
    try {
      await fetchPromise;
    } finally {
      if (this._inflightRequests.get(fetchKey) === fetchPromise) {
        this._inflightRequests.delete(fetchKey);
      }
    }
  }


  /**
   * Push a bar to every subscriber. `athHigh` overrides which high feeds the
   * (monotonic) ATH tracker — see `_maybeUpdateATHFromBar`.
   */
  private _emit(bar: Bar, athHigh?: number): void {
    const sym = this._currentSymbol;
    const res = this._currentResolution;
    if (sym && res) {
      this._maybeUpdateATHFromBar(`${sym}-${getApiTimeframe(res)}`, bar, athHigh);
    }
    this._subscribers.forEach((cb) => cb(bar));
  }

  // ── subscribeBars / unsubscribeBars ───────────────────────────────────────

  subscribeBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: SubscribeBarsCallback,
    listenerGuid: string,
    onResetCacheNeededCallback?: () => void,
  ): void {
    const mint = symbolInfo.ticker ?? symbolInfo.name;
    this._subscribers.set(listenerGuid, onTick);
    if (onResetCacheNeededCallback) {
      this._resetCacheCbs.set(listenerGuid, onResetCacheNeededCallback);
    }
    this._currentSymbol     = mint;
    this._currentResolution = resolution;

    // Seed _lastBar from cache
    const timeframe = getApiTimeframe(resolution);
    const baseKey   = `${mint}-${timeframe}`;
    const cached    = this._cache.get(baseKey);
    if (cached?.data.length) {
      const last = cached.data[cached.data.length - 1];
      if (last) this._lastBar.set(`${mint}-${resolution}`, last);
    }

    // Preview mints have no live feed — skip the WS; instead invalidate TV's
    // bar cache whenever the deploy form re-publishes its snapshot.
    if (isPreviewMint(mint)) {
      this._watchPreview(mint);
      return;
    }
    this._unwatchPreview();
    this._connectWs(mint);
  }

  unsubscribeBars(listenerGuid: string): void {
    this._subscribers.delete(listenerGuid);
    this._resetCacheCbs.delete(listenerGuid);
    if (!this._subscribers.size) this._currentSymbol = null;
  }

  private _watchPreview(mint: string): void {
    if (this._previewDispose && this._previewMint === mint) return;
    this._previewDispose?.();
    this._previewMint = mint;
    this._previewDispose = subscribePreview(mint, () => {
      for (const cb of this._resetCacheCbs.values()) cb();
    });
  }

  private _unwatchPreview(): void {
    this._previewDispose?.();
    this._previewDispose = null;
    this._previewMint = "";
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private _connectWs(mint: string): void {
    if (this._wireSub && this._wireSubMint === mint) return;
    if (this._wireSub) this._closeWs();
    this._wireSubMint = mint;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeToken(mint);
    const offTrade = ws.on("trade", (msg) => { void this._handleWs(msg); });
    this._wireSub = {
      cancel: () => {
        offTrade();
        ws.unsubscribeToken(mint);
      },
    };
  }

  private _handleRegionChanged = (): void => {
    this._cache.clear();
    this._hasMore.clear();
    this._oldestCursor.clear();
    this._inflightRequests.clear();
    this._lastBar.clear();
    this._liveGuard.clear();
    this._supply.clear();
    this._solPrice = 0;
    this._solPriceTs = 0;
    this._solPriceInflight = null;
    this._closeWs();
    if (this._currentSymbol) this._connectWs(this._currentSymbol);
  };

  private _closeWs(): void {
    if (this._wireSub) {
      try { this._wireSub.cancel(); } catch { /* ignore */ }
      this._wireSub = null;
    }
    this._wireSubMint = "";
  }

  private async _handleWs(msg: Record<string, unknown>): Promise<void> {
    const type = msg.type as string;

    // ── live trade → build candle ──────────────────────────────────────────
    if (type === "trade" || type === "transaction") {
      // Capture symbol+resolution before any await to avoid race conditions
      const currentSymbol     = this._currentSymbol;
      const currentResolution = this._currentResolution;
      if (!currentSymbol || !currentResolution) return;

      const tx = (msg.transaction ?? msg.data ?? msg) as Record<string, unknown>;
      const tokenMint = String(
        tx.tokenMint ?? tx.token_mint ?? tx.mint ?? tx.address ?? msg.tokenMint ?? ""
      );
      if (!tokenMint || tokenMint !== currentSymbol) return;

      // Try all common price field names the server may send
      const avgPrice = parseFloat(String(
        tx.avgPrice ?? tx.avg_price ?? tx.price ?? tx.tokenPrice ?? tx.token_price ?? 0
      ));
      const solAmt   = parseFloat(String(tx.solAmount ?? tx.sol_amount ?? tx.sol ?? 0));
      if (!avgPrice) return;

      const [solPrice, supply] = await Promise.all([
        this._currency === "usd" ? this._getSolPrice() : Promise.resolve(1),
        this._display  === "mcap" ? this._getSupply(tokenMint) : Promise.resolve(1),
      ]);
      if (this._currency === "usd" && !solPrice) return;

      // Re-verify symbol hasn't changed while we were awaiting
      if (this._currentSymbol !== currentSymbol || this._currentResolution !== currentResolution) return;

      const price = avgPrice * this._multiplier(solPrice, supply);
      const rawTs    = tx.timestamp ?? msg.timestamp;
      let tsMs: number;
      if (typeof rawTs === "number") {
        tsMs = rawTs > 1e15 ? rawTs / 1000 : rawTs > 1e12 ? rawTs : rawTs * 1000;
      } else if (typeof rawTs === "string") {
        const n = Number(rawTs);
        if (!isNaN(n) && n > 0) {
          tsMs = n > 1e15 ? n / 1000 : n > 1e12 ? n : n * 1000;
        } else {
          const d = new Date(rawTs);
          tsMs = isNaN(d.getTime()) ? Date.now() : d.getTime();
        }
      } else {
        tsMs = Date.now();
      }

      const resolution = currentResolution;
      const barKey     = `${currentSymbol}-${resolution}`;

      // ── Staleness gate, keyed on `slot` and NOT on the timestamp ───────────
      // 🔴 `timestamp` (and `blockTime`) are the router's OWN wall clock at
      // flatten time, not chain time: `router/src/feed/flatten.rs:230` sets both
      // from `chrono::Utc::now()`. The producer learned this the hard way and
      // wrote it down at `router/src/feed/mesh/client.rs:558` — "`slot` is
      // canonical across observers; `timestamp` and `block_time` are
      // observation-time … so a slow peer's 'fresh' stamp on an old trade
      // defeats a wall-clock filter" — and the mesh relay deliberately admits
      // peer trades up to MESH_MAX_PEER_SLOT_LAG (150 slots ≈ 60 s) behind.
      //
      // So a minute-old print reaches this tape carrying a fresh stamp, and
      // `alignTime` files it under the CURRENT bucket — up to 60 buckets wrong
      // on a 1s chart, at a price from a different regime. It then looks exactly
      // like a spike AND, worse, the corroboration guard would accept it as a
      // legitimate successor. No price rule can survive that; it has to be
      // rejected on the one field that is canonical across observers.
      //
      // Threshold scales with the bar: a print may only touch the live candle if
      // its slot is close enough to the head that it could plausibly belong to
      // that bar. Same shape as the server's `HISTORY_OHLC_MAX_LAG_SLOTS`
      // (`history/src/ingestion/processor.rs:57`), which likewise keeps the
      // trade and skips only its OHLCV update.
      const slot = Math.trunc(parseFloat(String(tx.slot ?? tx.Slot ?? 0))) || 0;
      if (slot > 0) {
        if (slot > this._headSlot) this._headSlot = slot;
        const frameSlots = Math.ceil(timeframeToMs(getApiTimeframe(resolution)) / SLOT_MS);
        const maxLagSlots = Math.max(4, frameSlots * 2);
        if (this._headSlot - slot > maxLagSlots) return;
      }

      const aligned    = alignTime(tsMs, resolution);
      const lastBar    = this._lastBar.get(barKey);
      // Never rewind the live head. An out-of-order print used to replace
      // `_lastBar` with a past bucket; the next real print then opened a new
      // candle across a hole.
      if (lastBar && aligned < lastBar.time) return;
      const sameBar    = !!lastBar && aligned === lastBar.time;
      const open       = sameBar ? lastBar!.open : (lastBar ? lastBar.close : price);

      // ── Corroboration guard ────────────────────────────────────────────────
      // The old gate here was `isBundle || ratio > 10 || ratio < 0.1`. Both
      // halves were dead weight, measured on production ClickHouse 2026-08-08:
      //   - `is_bundle` is true on 54.2% of spike prints and 57.6% of ALL prints
      //     (Pumpfun: 39.9% vs 62.3%, i.e. LESS) — the flag says a trade was
      //     bundled, not that its price is untradeable. Zero signal.
      //   - the 10x band is 8.7 doublings looser than the 1.15 the server uses;
      //     the fascia that actually draws the wicks is 1.15x-10x, all of which
      //     sailed straight through.
      // The replacement corroborates between PRINTS: a print extends the wick
      // only once a later print stands behind it. It still moves `close`
      // immediately (it IS the last traded price, the chart must stay live), and
      // the rendered wick RETRACTS if the next print reverts — which is what
      // makes the live bar converge on what a refetch of that same bar returns.
      let guard = this._liveGuard.get(barKey);
      if (!guard) {
        guard = new LiveBarGuard();
        this._liveGuard.set(barKey, guard);
      }
      let env: { high: number; low: number };
      let athHigh: number;
      if (aligned < guard.currentBarTime) {
        // ⚠️ A straggler for a bucket we have already moved past. The guard must
        // only ever roll FORWARD: rewinding it would discard the live bar's
        // corroborated envelope for one late print. Build this bar without
        // corroboration — it is a single bar and the server's two-sided verdict
        // governs it as soon as it is refetched.
        env = { high: Math.max(open, price), low: Math.min(open, price) };
        athHigh = Math.max(open, price);
      } else {
        if (guard.currentBarTime !== aligned) {
          // Bar rolled over. Settle the outgoing bar's last pending print (with
          // the wide one-sided band) and re-emit it if that changed its
          // envelope, otherwise the final print of EVERY bar would be silently
          // dropped from the wick — a systematic bias, not a filter.
          if (lastBar && guard.currentBarTime === lastBar.time) {
            const settled = guard.settle();
            const hi = Math.max(settled.high, lastBar.open, lastBar.close);
            const lo = Math.min(settled.low,  lastBar.open, lastBar.close);
            if (hi !== lastBar.high || lo !== lastBar.low) {
              const closed: Bar = { ...lastBar, high: hi, low: lo };
              this._lastBar.set(barKey, closed);
              this._emit(closed);
            }
          }
          guard.reset(aligned, open);
        }
        env = guard.push(price);
        // ATH from the CORROBORATED high only — the rendered wick can retract,
        // a monotonic ATH cannot.
        athHigh = Math.max(guard.confirmedHigh, open, price);
      }

      const bar: Bar = {
        time:   aligned,
        open,
        // `env` already covers the live price; `open` keeps the invariant.
        high:   Math.max(env.high, open),
        low:    Math.min(env.low,  open),
        close:  price,
        // Volume is never suppressed — an uncorroborated print is a real trade.
        volume: sameBar ? (lastBar!.volume || 0) + solAmt : solAmt,
      };

      this._lastBar.set(barKey, bar);
      this._emit(bar, athHigh);
      return;
    }

    // Live candles are folded from the trade tape above. The server also
    // pushes 1s `bar` frames built from the same prints; applying them here
    // fought that path — uncorroborated wicks (MEV prints becoming the
    // envelope), rewind gaps, and o=h=l=c ticks when a 1s close replaced
    // the forming bar. History still comes from REST `/ohlc`.
  }

  /** Warm OHLC + price/supply caches — call from the token page on mint change
   *  so the chart is ready when TradingView resolves the symbol. */
  prefetchMint(mint: string): void {
    if (!mint) return;
    // Preview mint: warm only the SOL price so the synthetic candles can be
    // scaled to USD mcap on the chart's first paint.
    if (isPreviewMint(mint)) {
      void this._getSolPrice();
      return;
    }
    // Stream-only mint: no OHLC warm. Seed the pump.fun default supply (1B) so
    // live mcap candles build from the stream without a per-token supply fetch.
    if (isStreamOnly(mint)) {
      if (!this._supply.has(mint)) this._supply.set(mint, 1_000_000_000);
      void this._getSolPrice();
      return;
    }
    void this._getSolPrice();
    void this._getSupply(mint);
    void this._loadBars(mint, "1m", `${mint}-1m`);
  }

  // ── SOL price & supply ────────────────────────────────────────────────────

  // Native-coin USD price: SOL via /api/sol/price.
  private _getSolPrice(): Promise<number> {
    if (this._solPrice && Date.now() - this._solPriceTs < 60_000) return Promise.resolve(this._solPrice);
    if (this._solPriceInflight) return this._solPriceInflight;
    this._solPriceInflight = (async () => {
      try {
        const d = await razeFetch<Record<string, unknown>>("/api/sol/price");
        // Prioritise solPrice; fall back to price/usd. Use || not ?? so 0 is skipped.
        const price = parseFloat(String(d.solPrice || d.price || d.usd || 0));
        if (price > 0) { this._solPrice = price; this._solPriceTs = Date.now(); }
      } catch { /* keep stale */ }
      this._solPriceInflight = null;
      return this._solPrice;
    })();
    return this._solPriceInflight;
  }

  private async _getSupply(mint: string): Promise<number> {
    if (this._supply.has(mint)) return this._supply.get(mint)!;
    try {
      const d = await razeFetch<Record<string, unknown>>(`/api/sol/tokens/supply/${mint}`);
      const s = parseFloat(String(d.supply ?? d.totalSupply ?? 0));
      // New/unindexed tokens may return tiny placeholder values (e.g. 1000).
      // Any real SPL token has at least 1M circulating; fall back to 1B if not.
      const supply = s >= 1_000_000 ? s : 1_000_000_000;
      this._supply.set(mint, supply);
      return supply;
    } catch {
      return 1_000_000_000;
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener(REGION_CHANGED_EVENT, this._handleRegionChanged);
      window.removeEventListener(CHAIN_CHANGED_EVENT, this._handleRegionChanged);
    }
    this._closeWs();
    this._unwatchPreview();
    this._resetCacheCbs.clear();
    this._subscribers.clear();
    this._cache.clear();
    this._hasMore.clear();
    this._oldestCursor.clear();
    this._inflightRequests.clear();
    this._lastBar.clear();
    this._liveGuard.clear();
    this._supply.clear();
    this._tokenLabel.clear();
    this._athByKey.clear();
    this._athListeners.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: SolanaDatafeed | null = null;

export function getSolanaDatafeedInstance(): SolanaDatafeed {
  if (!_instance) _instance = new SolanaDatafeed();
  return _instance;
}

export function destroySolanaDatafeedInstance(): void {
  _instance?.destroy();
  _instance = null;
}

/** Kick off chart data in parallel with token-info / trades (same wire, concurrent RPCs). */
export function prefetchSolanaChartData(mint: string): void {
  getSolanaDatafeedInstance().prefetchMint(mint);
}

