import { CHAIN_CHANGED_EVENT, getActiveChain, type ChainId } from "../lib/chains";
import {
  normalizeWalletHoldingsResponse,
  normalizeWalletPnlHistoryResponse,
} from "./normalize";
import { evmapiGet, imageSrc } from "./evmapi";
import {
  apiCandle,
  apiHolderToHolder,
  apiHolderToTrader,
  apiTokenToEvent,
  apiTradeToTrade,
  asRecord,
  msToIso,
  num,
  platformName,
  usdToNative,
  type Rec,
} from "./mappers";
import { fetchNativePrices, nativeUsd } from "./native";
import type { BatchEnrichEntry } from "../lib/batchEnrichCoordinator";
import type {
  TokenEvent,
  Trade,
  Holder,
  TopTrader,
  TrendingPeriod,
  SearchResult,
  WalletHoldingsResponse,
  WalletSummaryResponse,
  WalletSummaryItem,
  WalletPnlHistoryResponse,
} from "../types";

export { fetchNativePrices, nativeUsd };

function chain(): ChainId {
  return getActiveChain();
}

function tokenPath(address: string, suffix = "", c: string = chain()): string {
  return `/tokens/${c}/${encodeURIComponent(address)}${suffix}`;
}

function walletPath(address: string, suffix = "", c: string = chain()): string {
  return `/wallets/${c}/${encodeURIComponent(address)}${suffix}`;
}

// ── shared GET: one request per (chain, path, params) in flight, and a short
// memory so the several hooks that read the same token on one page (header,
// strip, tables, chart) share a single upstream call.

type CacheEntry = { ts: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

export function clearRazeResponseCache(): void {
  responseCache.clear();
  inFlight.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener(CHAIN_CHANGED_EVENT, clearRazeResponseCache);
}

type Params = Record<string, string | number | boolean | undefined | null>;

function cacheKey(path: string, params: Params): string {
  const ordered = Object.keys(params)
    .filter((k) => params[k] != null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `${path}?${ordered}`;
}

async function get<T>(
  path: string,
  params: Params = {},
  ttlMs = 2_000,
): Promise<{ data: T; nextCursor: string | null; native?: unknown }> {
  const key = cacheKey(path, params);
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.value as { data: T; nextCursor: string | null; native?: unknown };
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<{ data: T; nextCursor: string | null; native?: unknown }>;
  const p = evmapiGet<T>(path, params).then(
    ({ data, nextCursor, native }) => {
      const value = { data, nextCursor, native };
      responseCache.set(key, { ts: Date.now(), value });
      inFlight.delete(key);
      if (responseCache.size > 500) {
        const cutoff = Date.now() - 60_000;
        for (const [k, v] of responseCache) if (v.ts < cutoff) responseCache.delete(k);
      }
      return value;
    },
    (err) => { inFlight.delete(key); throw err; },
  );
  inFlight.set(key, p);
  return p;
}

function rows(data: unknown): Rec[] {
  return Array.isArray(data) ? data.map((r) => asRecord(r) ?? {}) : [];
}

export async function fetchTokenRaw(mint: string, c: string = chain()): Promise<Rec> {
  const { data } = await get<Rec>(tokenPath(mint, "", c), {}, 5_000);
  return data;
}

const BATCH_IDS = 50;

export const fetchBatchTokenEnrich = async (mints: string[], _sparklineLimit = 0) => {
  const c = chain();
  const native = await nativeUsd(c).catch(() => 0);
  const data: Record<string, BatchEnrichEntry> = {};
  // The API leaves an id of another chain's family out of the answer.
  const unique = [...new Set(mints.filter(Boolean))];
  // One batch call per BATCH_IDS tokens (the API's maximum).
  const slices: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH_IDS) slices.push(unique.slice(i, i + BATCH_IDS));
  const pages = await Promise.all(slices.map(async (slice) => {
    try {
      const res = await get<unknown>("/tokens", { ids: slice.map((m) => `${c}:${m}`).join(",") }, 10_000);
      return { slice, list: rows(res.data) };
    } catch {
      return { slice, list: [] as Rec[] };
    }
  }));
  for (const { slice, list } of pages) {
    for (const row of list) {
      const t = apiTokenToEvent(row, native);
      if (!t.mint_address) continue;
      // Batch rows answer lowercase EVM addresses; key by what was asked.
      const asked = slice.find((m) => m.toLowerCase() === t.mint_address.toLowerCase()) ?? t.mint_address;
      const entry: BatchEnrichEntry = {
        name: t.name || undefined,
        symbol: t.symbol || undefined,
        priceChange: t.priceChange,
        // USD and native kept apart: `volume_24h` is USD, `total_sol_volume`
        // is SOL/ETH/BNB.
        volume_24h: t.volume24h,
        total_sol_volume: t.totalSolVolume,
        trade_count: t.tradeCount,
        holders: t.holders,
        buy_count: t.buyCount,
        sell_count: t.sellCount,
        bundle_percentage: t.bundlePercentage,
        sniper_percentage: t.sniperPercentage,
        signer: t.signer,
        // The launchpad only: without one, the batch read's `dex` is the
        // pool's venue (on new BSC pairs even the pair's name), not a launchpad.
        platform: platformName(asRecord(row.launchpad)?.name) || undefined,
        creatorDeploys: t.creatorDeploys,
        top10Percent: t.top10Percent,
        devPercent: t.devPercent,
        insidersPercent: t.insidersPercent,
        freshWalletsPercent: t.freshWalletsPercent,
        botsPercent: t.botsPercent,
        buyTaxPercent: t.buyTaxPercent,
        sellTaxPercent: t.sellTaxPercent,
        honeypot: t.honeypot,
        mintRenounced: t.mintRenounced,
        freezeRenounced: t.freezeRenounced,
        ownershipRenounced: t.ownershipRenounced,
        twitter: t.twitter ?? undefined,
        website: t.website ?? undefined,
        telegram: t.telegram ?? undefined,
        discord: t.discord ?? undefined,
      };
      data[asked] = entry;
    }
  }
  return { success: true, data };
};

/**
 * Token images from the batch read, keyed by address (EVM lowercase): one
 * call per 50 tokens. A token the API leaves out, or has no image for, is
 * absent.
 */
export async function fetchTokenImages(c: string, addresses: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(addresses.filter(Boolean))];
  const out: Record<string, string> = {};
  for (let i = 0; i < unique.length; i += BATCH_IDS) {
    const slice = unique.slice(i, i + BATCH_IDS);
    const res = await get<unknown>("/tokens", { ids: slice.map((m) => `${c}:${m}`).join(",") }, 10 * 60_000);
    for (const row of rows(res.data)) {
      const t = apiTokenToEvent(row, 0);
      if (!t.mint_address || !t.image) continue;
      const asked = slice.find((m) => m.toLowerCase() === t.mint_address.toLowerCase()) ?? t.mint_address;
      out[c === "sol" ? asked : asked.toLowerCase()] = t.image;
    }
  }
  return out;
}

/** A whole board; the columns filter it themselves (hooks/useLaunchpadBoard). */
async function listBoard(board: "new" | "graduating" | "graduated", limit: number): Promise<{ data: TokenEvent[] }> {
  const c = chain();
  const native = await nativeUsd(c).catch(() => 0);
  const { data } = await get<unknown>(`/launchpad/${board}`, { chain: c, limit }, 1_000);
  return { data: rows(data).map((r) => apiTokenToEvent(r, native)).filter((t) => t.mint_address) };
}

export const fetchDeploys = (limit = 100) => listBoard("new", limit);
export const fetchMigrations = (limit = 100) => listBoard("graduated", limit);
export const fetchMigrating = (limit = 100) => listBoard("graduating", limit);

// ── trades ─────────────────────────────────────────────────────────────────

type TimeRange = { fromMs?: number | null; toMs?: number | null };

const finite = (v: number | null | undefined): number | undefined =>
  v != null && Number.isFinite(v) ? v : undefined;

/**
 * Newest first, paged by the API's `next`. A time range is the API's window
 * (`from` inclusive, `to` exclusive, Unix ms; the UI's `toMs` is inclusive):
 * its cursor stays in the window, and the page that reaches `from` has no
 * `next`. The API has no oldest-first order: `sort` only re-orders.
 */
export const fetchTrades = async (
  mint: string,
  limit = 50,
  _sort: "asc" | "desc" = "desc",
  cursor?: string | null,
  timeRange?: TimeRange,
  wallet?: string,
) => {
  const c = chain();
  const to = finite(timeRange?.toMs);
  const { data, nextCursor } = await get<unknown>(tokenPath(mint, "/trades", c), {
    limit: Math.min(200, limit),
    cursor: cursor || undefined,
    wallet: wallet || undefined,
    // A cursor carries its window.
    from: cursor ? undefined : finite(timeRange?.fromMs),
    to: cursor || to == null ? undefined : to + 1,
  });
  const trades = rows(data).map((r) => apiTradeToTrade(r, mint));
  return { data: trades, nextCursor, hasMore: Boolean(nextCursor) };
};

/** One wallet's trades of one token, filtered by the API (`?wallet=`). */
export const fetchTradesBySignerMint = async (
  signer: string,
  mint: string,
  limit = 100,
  cursor?: string | null,
  sort: "asc" | "desc" = "desc",
  timeRange?: TimeRange,
) => fetchTrades(mint, limit, sort, cursor, timeRange, signer);

// ── holders / traders ──────────────────────────────────────────────────────

/** The 100 largest holders (the API has no next page), one row per wallet. */
export const fetchHolders = async (mint: string, limit = 100) => {
  const c = chain();
  const native = await nativeUsd(c).catch(() => 0);
  const [token, page] = await Promise.all([
    fetchTokenRaw(mint, c).catch(() => null),
    get<unknown>(tokenPath(mint, "/holders", c), { limit: Math.min(100, limit) }, 5_000),
  ]);
  const holders: Holder[] = rows(page.data).map((h, i) => apiHolderToHolder(h, native, i + 1));
  const supply = num(token?.circulatingSupply) ?? num(token?.totalSupply);
  return {
    holders,
    data: holders,
    currentPriceSol: usdToNative(token?.priceUsd, native) ?? 0,
    supply,
  };
};

export const fetchTopTraders = async (mint: string, limit = 100) => {
  const c = chain();
  const native = await nativeUsd(c).catch(() => 0);
  const { data } = await get<unknown>(tokenPath(mint, "/traders", c), { limit: Math.min(100, limit) }, 5_000);
  const traders: TopTrader[] = rows(data).slice(0, limit).map((r) => apiHolderToTrader(r, native));
  return { data: traders };
};

// ── discovery ──────────────────────────────────────────────────────────────

/** The API's trending windows: 1m, 5m, 1h, 6h, 24h. */
export function trendingInterval(period: TrendingPeriod): string {
  switch (period) {
    case "recent": return "1h";
    default: return "24h";
  }
}

export const fetchTrending = async (period: TrendingPeriod = "daily", limit = 50): Promise<{ data: TokenEvent[] }> => {
  const c = chain();
  const native = await nativeUsd(c).catch(() => 0);
  const interval = trendingInterval(period);
  const { data } = await get<unknown>("/trending", { chain: c, limit, interval }, 5_000);
  // Rows carry the token's own 24h stats, which the mapper reads before the
  // ranking window.
  return { data: rows(data).map((r) => apiTokenToEvent(r, native)).filter((t) => t.mint_address) };
};

export interface SearchOptions {
  q?: string;
  creator?: string;
  limit?: number;
  page?: number;
}

function toSearchResult(row: Rec, native: number): SearchResult {
  const t = apiTokenToEvent(row, native);
  return {
    mint: t.mint_address,
    chain: t.chain,
    symbol: t.symbol,
    name: t.name,
    platform: t.dex,
    created_at: t.created_at || undefined,
    image: t.image ?? null,
    marketCap: t.marketCap,
    lastPrice: t.lastPrice,
  };
}

/** Tokens a wallet created, most recent activity first (the screener). */
async function fetchCreatedTokens(creator: string, limit: number, extra: Params = {}): Promise<Rec[]> {
  const { data } = await get<unknown>("/screener", {
    chain: chain(),
    creator,
    minLiquidity: 0,
    limit: Math.min(100, limit),
    ...extra,
  }, 30_000);
  return rows(data);
}

/** The API's `/search`: name, symbol, address, a pool's address, or a
 *  wallet's created tokens (newest first). */
export function fetchSearch(opts: SearchOptions): Promise<{ data: SearchResult[] }>;
export function fetchSearch(q: string, limit?: number): Promise<{ data: SearchResult[] }>;
export async function fetchSearch(
  arg: string | SearchOptions,
  limit = 20,
): Promise<{ data: SearchResult[] }> {
  const native = await nativeUsd(chain()).catch(() => 0);
  const lim = typeof arg === "string" ? limit : (arg.limit ?? 20);
  const q = typeof arg === "string" ? arg : (arg.q || arg.creator || "");
  if (!q.trim()) return { data: [] };
  const { data } = await get<unknown>("/search", { q: q.trim(), limit: Math.min(50, lim) }, 5_000);
  return { data: rows(data).map((r) => toSearchResult(r, native)).filter((r) => r.mint) };
}

export const fetchTokenInfo = async (mint: string) => {
  const c = chain();
  const [data, native] = await Promise.all([fetchTokenRaw(mint, c), nativeUsd(c).catch(() => 0)]);
  const token = apiTokenToEvent(data, native);
  if (!token.mint_address) token.mint_address = mint;
  return { success: true, data: token };
};

/** The supply `/tokens` prices the market cap over; null when not known. */
export const fetchTokenSupply = async (mint: string) => {
  const data = await fetchTokenRaw(mint);
  const supply = num(data.circulatingSupply) ?? num(data.totalSupply) ?? null;
  return { supply, decimals: num(data.decimals) ?? null };
};

// ── wallets ────────────────────────────────────────────────────────────────

type WalletPeriod = "1d" | "7d" | "30d" | "1y";

async function fetchWalletStats(address: string, period: WalletPeriod = "30d"): Promise<Rec> {
  const { data } = await get<Rec>(walletPath(address), { period }, 30_000);
  return data;
}

/** A wallet's tokens (identity, decimals, value, liquidity per row) and its
 *  coin (`native`), one `/holdings` read. */
export const fetchWalletHoldings = async (address: string) => {
  const holdings = await get<unknown>(walletPath(address, "/holdings"), { limit: 100 }, 10_000);
  const list = rows(holdings.data);
  const nativeBalance = num(asRecord(holdings.native)?.amount);
  return normalizeWalletHoldingsResponse({
    success: true,
    ownerAddress: address,
    tokens: list.map((r) => ({
      mint: String(r.token ?? ""),
      amount: num(r.amount) ?? 0,
      decimals: num(r.decimals),
      usdValue: num(r.valueUsd),
      liquidityUsd: num(r.liquidityUsd),
      symbol: typeof r.symbol === "string" ? r.symbol : undefined,
      name: typeof r.name === "string" ? r.name : undefined,
      image: imageSrc(typeof r.image === "string" ? r.image : null),
      hasBalance: (num(r.amount) ?? 0) > 0,
    })),
    summary: {
      totalSolBalance: nativeBalance,
      tokensWithBalance: list.length,
      totalTokens: list.length,
    },
  }) as WalletHoldingsResponse;
};

export type WalletTradeRow = Trade & {
  tokenName?: string | null;
  tokenSymbol?: string | null;
  tokenImage?: string | null;
};

/** A wallet's swaps, newest first; pass the previous page's `nextCursor` as
 *  `cursor` for the next one. */
export const fetchWalletTrades = async (address: string, limit = 50, cursor?: string | null) => {
  const c = chain();
  const { data, nextCursor } = await get<unknown>(walletPath(address, "/trades", c), {
    limit: Math.min(100, limit),
    cursor: cursor || undefined,
  });
  return {
    data: rows(data).map((r): WalletTradeRow => ({
      ...apiTradeToTrade(r),
      signer: address,
      tokenName: typeof r.tokenName === "string" ? r.tokenName : null,
      tokenSymbol: typeof r.tokenSymbol === "string" ? r.tokenSymbol : null,
      tokenImage: imageSrc(typeof r.tokenImage === "string" ? r.tokenImage : null),
    })),
    nextCursor,
  };
};

/** The API's wallet stats; what it did not measure stays null (shown "—"). */
function statsToSummary(address: string, s: Rec, native: number): WalletSummaryItem {
  const trades = num(s.trades) ?? null;
  const volume = num(s.volumeUsd) ?? null;
  const volumeSol = usdToNative(volume, native) ?? null;
  const realized = num(s.realizedPnlUsd) ?? null;
  const winRate = num(s.winRatePercent);
  return {
    address,
    totalTrades: trades,
    totalBuys: num(s.buys) ?? null,
    totalSells: num(s.sells) ?? null,
    totalVolumeSol: volumeSol,
    totalVolumeUsd: volume,
    avgTradeSizeSol: trades && volumeSol != null ? volumeSol / trades : null,
    avgTradeSizeUsd: trades && volume != null ? volume / trades : null,
    realizedPnlSol: usdToNative(realized, native) ?? null,
    realizedPnlUsd: realized,
    realizedPnlPct: num(s.realizedPnlPercent) ?? null,
    uniqueTokensTraded: num(s.tokensTraded) ?? null,
    // The UI reads a 0–1 ratio.
    winRate: winRate != null ? winRate / 100 : null,
    lastTradeAt: msToIso(s.lastTradeAt) ?? null,
  };
}

function periodFor(fromSec?: number, toSec?: number): WalletPeriod {
  if (!fromSec) return "30d";
  const days = ((toSec ?? Date.now() / 1000) - fromSec) / 86_400;
  if (days <= 1.01) return "1d";
  if (days <= 7.01) return "7d";
  if (days <= 30.01) return "30d";
  return "1y";
}

export const fetchWalletSummary = async (
  addresses: string[],
  options: { from?: number; to?: number } = {},
) => {
  const native = await nativeUsd(chain()).catch(() => 0);
  const period = periodFor(options.from, options.to);
  const items: WalletSummaryItem[] = [];
  await Promise.all(addresses.map(async (address) => {
    try {
      items.push(statsToSummary(address, await fetchWalletStats(address, period), native));
    } catch { /* skip */ }
  }));
  return {
    success: true,
    data: items,
    count: items.length,
    solPriceUsd: native,
  } satisfies WalletSummaryResponse;
};

/** The API's history: 30 days hourly, 365 days daily (a range starting
 *  further back is its 400). */
const PNL_HISTORY_DAYS = { "1h": 30, "1d": 365 } as const;

/** PnlPoint[] (oldest first) for the seconds window [from, to]: the API's
 *  window (`from`/`to` in ms), from the bucket that holds `from`, clamped to
 *  its history. */
async function fetchPnlPoints(address: string, from: number, to: number, resolution: "1h" | "1d"): Promise<Rec[]> {
  const nowMs = Date.now();
  const earliest = nowMs - PNL_HISTORY_DAYS[resolution] * 86_400_000 + 60_000;
  const toMs = to ? Math.min(to * 1000, nowMs) : nowMs;
  const fromMs = Math.min(Math.max(from * 1000, earliest), toMs);
  const { data } = await get<unknown>(
    walletPath(address, "/pnl"),
    { from: Math.floor(fromMs), to: Math.floor(toMs), resolution },
    30_000,
  );
  return rows(data);
}

export const fetchWalletPnlHistory = async (
  address: string,
  options: { from: number; to: number; resolution?: "1h" | "1d"; limit?: number },
) => {
  const native = await nativeUsd(chain()).catch(() => 0);
  const resolution = options.resolution ?? "1d";
  const points = await fetchPnlPoints(address, options.from, options.to, resolution);
  return normalizeWalletPnlHistoryResponse({
    success: true,
    address,
    resolution,
    solPriceUsd: native,
    data: points.map((p) => {
      const sol = usdToNative(p.realizedPnlUsd, native) ?? 0;
      return {
        bucket: msToIso(p.time) ?? "",
        realizedPnlSol: sol,
        unrealizedPnlSol: 0,
        totalPnlSol: sol,
        solPriceUsd: native,
      };
    }),
  }) as WalletPnlHistoryResponse;
};

export interface SignerCountsResponse {
  success: boolean;
  data: {
    signer: string;
    deployCount: number;
    migrationCount: number;
    totalCount: number;
    deployTokens?: string[];
    migrationTokens?: string[];
  };
  timestamp?: string;
}

export const fetchSignerCounts = async (signer: string, _withTokens = false) => {
  const list = await fetchCreatedTokens(signer, 100);
  const migrated = list.filter((r) => asRecord(r.launchpad)?.graduated === true);
  return {
    success: true,
    data: {
      signer,
      deployCount: list.length,
      migrationCount: migrated.length,
      totalCount: list.length,
      deployTokens: list.map((r) => String(r.address ?? "")),
      migrationTokens: migrated.map((r) => String(r.address ?? "")),
    },
  } satisfies SignerCountsResponse;
};

// ── candles ────────────────────────────────────────────────────────────────

export type OhlcTimeframe =
  | "1s" | "5s" | "15s" | "30s"
  | "1m" | "5m" | "15m" | "30m"
  | "1h" | "4h" | "12h" | "1d" | "1w";

export interface ApiCandle { time: number; open: number; high: number; low: number; close: number; volume: number }

/**
 * OHLCV from the API, oldest first. `to` pages back (pass the oldest `time`
 * you have). `unit`: `usd` = price, `marketCap` = market cap; `currency`:
 * `usd`, or `native` for the chain's coin at each candle's end (volume too).
 */
export const fetchCandles = async (
  mint: string,
  opts: {
    interval: OhlcTimeframe;
    limit?: number;
    from?: number;
    to?: number;
    unit?: "usd" | "marketCap";
    currency?: "usd" | "native";
  },
): Promise<ApiCandle[]> => {
  const { data } = await get<unknown>(tokenPath(mint, "/candles"), {
    interval: opts.interval,
    limit: Math.min(1000, opts.limit ?? 300),
    from: opts.from,
    to: opts.to,
    unit: opts.unit ?? "usd",
    currency: opts.currency === "native" ? "native" : undefined,
  });
  return rows(data).map((r) => apiCandle(r));
};
