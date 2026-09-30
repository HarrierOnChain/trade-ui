import { CHAIN_CHANGED_EVENT, getActiveChain, type ChainId } from "../lib/chains";
import {
  normalizeWalletHoldingsResponse,
  normalizeWalletPerformanceResponse,
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
  usdToNative,
  type Rec,
} from "./mappers";
import { fetchNativePrices, nativeUsd } from "./native";
import type {
  TokenEvent,
  Trade,
  Holder,
  TopTrader,
  TrendingToken,
  TrendingPeriod,
  SearchResult,
  TokenPriceChanges,
  PriceChangePeriod,
  WalletHoldingsResponse,
  WalletSummaryResponse,
  WalletSummaryItem,
  WalletPerformanceResponse,
  WalletFifoPnlResponse,
  WalletPnlHistoryResponse,
  WalletTokensResponse,
  PnlSummaryResponse,
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
): Promise<{ data: T; nextCursor: string | null }> {
  const key = cacheKey(path, params);
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.value as { data: T; nextCursor: string | null };
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<{ data: T; nextCursor: string | null }>;
  const p = evmapiGet<T>(path, params).then(
    ({ data, nextCursor }) => {
      const value = { data, nextCursor };
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

export function chainPath(solPath: string): string {
  return solPath;
}

// ── tokens ─────────────────────────────────────────────────────────────────

/** The API's full Token for one address (identity, price, stats, pool,
 *  launchpad, safety). Shared by header, strip, supply, quote and metadata. */
export async function fetchTokenRaw(mint: string, c: string = chain()): Promise<Rec> {
  const { data } = await get<Rec>(tokenPath(mint, "", c), {}, 5_000);
  return data;
}

const BATCH_IDS = 10;

export const fetchBatchTokenEnrich = async (mints: string[], _sparklineLimit = 0) => {
  const c = chain();
  const native = await nativeUsd(c).catch(() => 0);
  const data: Record<string, unknown> = {};
  // Only addresses of the active chain's family: one foreign id (a search
  // result from another chain) makes the API reject the whole batch (400).
  const evm = c !== "sol";
  const unique = [...new Set(mints.filter((m) => m && /^0x[0-9a-fA-F]{40}$/.test(m) === evm))];
  // One batch call per BATCH_IDS tokens instead of two calls per token. The
  // contract allows 50, but today the API answers 404 "tokens not found" to
  // any batch of more than 10 (its upstream caps there), so stay at 10.
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
      data[asked] = {
        name: t.name || undefined,
        symbol: t.symbol || undefined,
        image: t.image ?? undefined,
        last_price: t.lastPrice,
        lastPrice: t.lastPrice,
        marketCap: t.marketCap,
        liquidity: t.liquidity,
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
        platform: t.dex || undefined,
        dex: t.dex || undefined,
        creatorDeploys: t.creatorDeploys,
        creator_deploys: t.creatorDeploys,
        graduationPercent: t.graduationPercent,
      };
    }
  }
  return { success: true, data };
};

async function listBoard(board: "new" | "graduating" | "graduated", limit: number, platform?: string): Promise<{ data: TokenEvent[] }> {
  const c = chain();
  const native = await nativeUsd(c).catch(() => 0);
  const { data } = await get<unknown>(`/launchpad/${board}`, { chain: c, limit }, 1_000);
  const wanted = platform?.toLowerCase().split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  const list = rows(data)
    .map((r) => apiTokenToEvent(r, native))
    .filter((t) => t.mint_address && (!wanted.length || !t.dex || wanted.includes(t.dex.toLowerCase())));
  return { data: list };
}

export const fetchDeploys = (limit = 50, platform?: string) => listBoard("new", limit, platform);
export const fetchMigrations = (limit = 50, platform?: string) => listBoard("graduated", limit, platform);
export const fetchMigrating = (limit = 50, platform?: string) => listBoard("graduating", limit, platform);

// ── trades ─────────────────────────────────────────────────────────────────

type TimeRange = { fromMs?: number | null; toMs?: number | null };

function inRange(t: Trade, range?: TimeRange): boolean {
  if (!range) return true;
  const ts = Number(t.timestamp);
  if (range.fromMs != null && Number.isFinite(range.fromMs) && ts < range.fromMs) return false;
  if (range.toMs != null && Number.isFinite(range.toMs) && ts > range.toMs) return false;
  return true;
}

/**
 * Newest first, paged by the API's `next`. The API has no oldest-first order
 * and no time filter: `sort` only re-orders a page and a time range filters
 * the page it got.
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
  const native = await nativeUsd(c).catch(() => 0);
  const { data, nextCursor } = await get<unknown>(tokenPath(mint, "/trades", c), {
    limit: Math.min(200, limit),
    cursor: cursor || undefined,
    wallet: wallet || undefined,
  });
  const trades = rows(data).map((r) => apiTradeToTrade(r, native, mint)).filter((t) => inRange(t, timeRange));
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

export const fetchHolders = async (mint: string, limit = 200) => {
  const c = chain();
  const native = await nativeUsd(c).catch(() => 0);
  const [token, firstPage] = await Promise.all([
    fetchTokenRaw(mint, c).catch(() => null),
    get<unknown>(tokenPath(mint, "/holders", c), { limit: Math.min(100, limit) }, 5_000),
  ]);
  const raw = rows(firstPage.data);
  const seen = new Set(raw.map((h) => String(h.wallet ?? "")));
  let cursor = firstPage.nextCursor;
  // Pages of ≤100 until `limit`. Deduped by wallet, and a page that adds no
  // new wallet ends the walk: today the API's holders `next` cursor hands
  // back the first page again, which doubled every top holder.
  while (cursor && raw.length < limit) {
    try {
      const page = await get<unknown>(tokenPath(mint, "/holders", c), { limit: Math.min(100, limit - raw.length), cursor }, 5_000);
      const fresh = rows(page.data).filter((h) => {
        const w = String(h.wallet ?? "");
        if (!w || seen.has(w)) return false;
        seen.add(w);
        return true;
      });
      if (!fresh.length) break;
      raw.push(...fresh);
      cursor = page.nextCursor;
    } catch {
      break;
    }
  }
  const holders: Holder[] = raw.slice(0, limit).map((h, i) => apiHolderToHolder(h, native, i + 1));
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
function trendingInterval(period: TrendingPeriod): string {
  switch (period) {
    case "recent": return "1h";
    default: return "24h";
  }
}

function toTrending(t: TokenEvent): TrendingToken {
  return {
    ...t,
    mint: t.mint_address,
    image: t.image,
    marketCap: t.marketCap,
    volume: t.volume24h,
    priceChange: t.priceChange,
    tradeCount: t.tradeCount,
  };
}

export const fetchTrending = async (period: TrendingPeriod = "daily", limit = 50) => {
  const c = chain();
  const native = await nativeUsd(c).catch(() => 0);
  const { data } = await get<unknown>("/trending", { chain: c, limit, interval: trendingInterval(period) }, 5_000);
  return { data: rows(data).map((r) => toTrending(apiTokenToEvent(r, native))).filter((t) => t.mint) };
};

export const fetchSolPrice = async () => {
  const usd = await nativeUsd(chain()).catch(() => 0);
  return { solPrice: usd, nativePrice: usd, hasValidPrice: usd > 0 };
};

export interface SearchOptions {
  q?: string;
  creator?: string;
  authority?: string;
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

export function fetchSearch(opts: SearchOptions): Promise<{ data: SearchResult[] }>;
export function fetchSearch(q: string, limit?: number): Promise<{ data: SearchResult[] }>;
export async function fetchSearch(
  arg: string | SearchOptions,
  limit = 20,
): Promise<{ data: SearchResult[] }> {
  const native = await nativeUsd(chain()).catch(() => 0);
  const lim = typeof arg === "string" ? limit : (arg.limit ?? 20);
  const creator = typeof arg === "string" ? "" : (arg.creator || arg.authority || "");
  if (creator) {
    const list = await fetchCreatedTokens(creator, lim);
    return { data: list.map((r) => toSearchResult(r, native)).filter((r) => r.mint) };
  }
  const q = typeof arg === "string" ? arg : (arg.q || "");
  if (!q.trim()) return { data: [] };
  const { data } = await get<unknown>("/search", { q: q.trim(), limit: Math.min(50, lim) }, 5_000);
  return { data: rows(data).map((r) => toSearchResult(r, native)).filter((r) => r.mint) };
}

export const fetchTokensByDeployer = (creator: string, limit = 20, page = 1) =>
  fetchSearch({ creator, limit, page });

export const fetchTokensByAuthority = (authority: string, limit = 20, page = 1) =>
  fetchSearch({ authority, limit, page });

export interface CreatorMigration {
  mint: string;
  name: string;
  symbol: string;
  uri?: string;
  migratedAt?: string;
  /** Not served by the API (no all-time high); kept for the type's callers. */
  athMcap?: number;
  /** Market cap now, USD. */
  marketCap?: number;
}

export const fetchCreatorMigrations = async (signer: string, limit = 50) => {
  const list = await fetchCreatedTokens(signer, limit, { graduated: true });
  return {
    success: true,
    data: list.map((r) => {
      const lp = asRecord(r.launchpad);
      return {
        mint: String(r.address ?? ""),
        name: String(r.name ?? ""),
        symbol: String(r.symbol ?? ""),
        migratedAt: msToIso(lp?.graduatedAt),
        marketCap: num(r.marketCapUsd),
      } satisfies CreatorMigration;
    }).filter((m) => m.mint),
  };
};

export const fetchTokenMeta = (mint: string) => fetchTokenInfo(mint).then((r) => r.data);

export interface QuoteData {
  mint: string;
  avgPrice: number;
  amountIn: number;
  amountOut: number;
  platform: string;
  pool: string;
  timeTaken: number;
}

export const fetchQuote = async (mint: string) => {
  const c = chain();
  const [data, native] = await Promise.all([fetchTokenRaw(mint, c), nativeUsd(c).catch(() => 0)]);
  const pool = asRecord(data.pool);
  const launchpad = asRecord(data.launchpad);
  return {
    success: true,
    data: {
      mint,
      avgPrice: usdToNative(data.priceUsd, native) ?? 0,
      amountIn: 0,
      amountOut: 0,
      platform: String(launchpad?.name ?? pool?.dex ?? ""),
      pool: String(pool?.address ?? ""),
      timeTaken: 0,
    } satisfies QuoteData,
  };
};

export const fetchTokenInfo = async (mint: string) => {
  const c = chain();
  const [data, native] = await Promise.all([fetchTokenRaw(mint, c), nativeUsd(c).catch(() => 0)]);
  const token = apiTokenToEvent(data, native);
  if (!token.mint_address) token.mint_address = mint;
  return { success: true, data: token };
};

const CHANGE_WINDOWS = ["1m", "5m", "1h", "6h", "24h"] as const;

export const fetchPriceChanges = async (mint: string) => {
  const c = chain();
  const [data, native] = await Promise.all([fetchTokenRaw(mint, c), nativeUsd(c).catch(() => 0)]);
  const priceUsd = num(data.priceUsd);
  const currentPrice = usdToNative(priceUsd, native) ?? 0;
  const stats = asRecord(data.stats) ?? {};
  const changes: TokenPriceChanges["changes"] = {};
  for (const key of CHANGE_WINDOWS) {
    const w = asRecord(stats[key]);
    const pct = num(w?.priceChangePercent);
    if (!w || pct == null) {
      changes[key] = null;
      continue;
    }
    // The window's opening price, recovered from the change, so the strip can
    // keep the percentage live as trades move the current price.
    const anchor = currentPrice > 0 && pct > -100 ? currentPrice / (1 + pct / 100) : 0;
    changes[key] = {
      change: pct,
      price: anchor,
      trades: num(w.trades) ?? (num(w.buys) ?? 0) + (num(w.sells) ?? 0),
      volume: num(w.volumeUsd) ?? 0,
    } satisfies PriceChangePeriod;
  }
  const result: TokenPriceChanges & { success: boolean } = {
    success: true,
    mint,
    currentPrice,
    currentPriceUSD: priceUsd != null ? String(priceUsd) : null,
    solPriceUSD: native,
    changes,
  };
  return result;
};

export const fetchTokenSupply = async (mint: string) => {
  const data = await fetchTokenRaw(mint);
  const supply = num(data.circulatingSupply) ?? num(data.totalSupply) ?? 1_000_000_000;
  return { supply, decimals: num(data.decimals) ?? 6 };
};

// ── wallets ────────────────────────────────────────────────────────────────

type WalletPeriod = "1d" | "7d" | "30d" | "1y";

async function fetchWalletStats(address: string, period: WalletPeriod = "30d"): Promise<Rec> {
  const { data } = await get<Rec>(walletPath(address), { period }, 30_000);
  return data;
}

export const fetchWalletHoldings = async (address: string) => {
  const [holdings, stats] = await Promise.all([
    get<unknown>(walletPath(address, "/holdings"), { limit: 100 }, 10_000),
    fetchWalletStats(address).catch(() => null),
  ]);
  const list = rows(holdings.data);
  const nativeBalance = num(stats?.nativeBalance);
  return normalizeWalletHoldingsResponse({
    success: true,
    ownerAddress: address,
    tokens: list.map((r) => ({
      mint: String(r.token ?? ""),
      amount: num(r.amount) ?? 0,
      // Holdings carry no decimals.
      decimals: 0,
      usdValue: num(r.valueUsd),
      symbol: typeof r.symbol === "string" ? r.symbol : undefined,
      name: typeof r.name === "string" ? r.name : undefined,
      hasBalance: (num(r.amount) ?? 0) > 0,
    })),
    summary: {
      totalSolBalance: nativeBalance,
      tokensWithBalance: list.length,
      totalTokens: list.length,
    },
  }) as WalletHoldingsResponse;
};

export type WalletTradeRow = Trade & { tokenSymbol?: string | null; tokenImage?: string | null };

export const fetchWalletTrades = async (address: string, limit = 50) => {
  const c = chain();
  const native = await nativeUsd(c).catch(() => 0);
  const { data, nextCursor } = await get<unknown>(walletPath(address, "/trades", c), { limit: Math.min(100, limit) });
  return {
    data: rows(data).map((r): WalletTradeRow => ({
      ...apiTradeToTrade(r, native),
      signer: address,
      tokenSymbol: typeof r.tokenSymbol === "string" ? r.tokenSymbol : null,
      tokenImage: imageSrc(typeof r.tokenImage === "string" ? r.tokenImage : null),
    })),
    nextCursor,
  };
};

function statsToSummary(address: string, s: Rec, native: number): WalletSummaryItem {
  const trades = num(s.trades) ?? 0;
  const buys = num(s.buys) ?? 0;
  const sells = num(s.sells) ?? 0;
  const volume = num(s.volumeUsd) ?? 0;
  const realized = num(s.realizedPnlUsd) ?? 0;
  const winRate = num(s.winRatePercent);
  return {
    address,
    totalTrades: trades,
    totalBuys: buys,
    totalSells: sells,
    buyRatio: buys + sells > 0 ? buys / (buys + sells) : 0,
    sellRatio: buys + sells > 0 ? sells / (buys + sells) : 0,
    totalVolumeSol: usdToNative(volume, native) ?? 0,
    totalVolumeUsd: volume,
    avgTradeSizeSol: trades > 0 ? (usdToNative(volume, native) ?? 0) / trades : 0,
    avgTradeSizeUsd: trades > 0 ? volume / trades : 0,
    largestTradeSol: 0,
    largestTradeUsd: 0,
    totalFees: 0,
    realizedPnlSol: usdToNative(realized, native) ?? 0,
    realizedPnlUsd: realized,
    realizedPnlPct: num(s.realizedPnlPercent) ?? null,
    uniqueTokensTraded: num(s.tokensTraded) ?? 0,
    winningTokens: 0,
    // The UI reads a 0–1 ratio.
    winRate: winRate != null ? winRate / 100 : 0,
    lastTradeAt: msToIso(s.lastActiveAt) ?? null,
    proTradeCount: 0,
    sniperCount: 0,
    bundleCount: 0,
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

const LEADERBOARD_PERIOD = { daily: "1d", weekly: "7d", monthly: "30d" } as const;

export const fetchPnlLeaderboard = async (opts?: { period?: "daily" | "weekly" | "monthly"; platform?: string; limit?: number }) => {
  const c = chain();
  const period = opts?.period ?? "daily";
  const native = await nativeUsd(c).catch(() => 0);
  // No per-platform leaderboard on this API: `platform` is not applied.
  const { data } = await get<unknown>("/wallets/top", {
    chain: c,
    period: LEADERBOARD_PERIOD[period],
    sort: "pnl",
    limit: Math.min(100, opts?.limit ?? 50),
  }, 30_000);
  const list = rows(data);
  return {
    success: true as const,
    error: undefined as string | undefined,
    period,
    platform: "all",
    wallets: list.map((r) => ({
      signer: String(r.address ?? ""),
      pnlSol: usdToNative(r.realizedPnlUsd, native) ?? 0,
      pnlUsd: num(r.realizedPnlUsd) ?? 0,
      trades: num(r.trades) ?? 0,
    })).filter((w) => w.signer),
    limit: list.length,
    offset: 0,
    solPriceUsd: native,
  };
};

/** Chain-wide PnL distribution: the API has no aggregate for it. Reported as
 *  unavailable so the KPI tiles stay empty instead of showing zeros. */
export const fetchPnlSummary = async (opts?: { period?: "daily" | "weekly" | "monthly"; platform?: string }) =>
  ({
    success: false,
    error: "not_available",
    period: opts?.period ?? "daily",
    platform: "all",
    totalProfitableWallets: 0,
    totalPnlSol: 0,
    totalPnlUsd: 0,
    avgPnlSol: 0,
    avgPnlUsd: 0,
    medianPnlSol: 0,
    medianPnlUsd: 0,
    p90PnlSol: 0,
    p90PnlUsd: 0,
    p99PnlSol: 0,
    p99PnlUsd: 0,
    maxPnlSol: 0,
    maxPnlUsd: 0,
  }) satisfies PnlSummaryResponse;

/** PnlPoint[] (oldest first) for the seconds window [from, to]. */
async function fetchPnlPoints(address: string, from: number, to: number, resolution: "1h" | "1d"): Promise<Rec[]> {
  const nowSec = Date.now() / 1000;
  const days = Math.max(1, Math.min(365, Math.ceil((nowSec - from) / 86_400)));
  const { data } = await get<unknown>(walletPath(address, "/pnl"), { days, resolution }, 30_000);
  const fromMs = from * 1000;
  const toMs = (to || nowSec) * 1000;
  return rows(data).filter((p) => {
    const t = num(p.time) ?? 0;
    return t >= fromMs - (resolution === "1d" ? 86_400_000 : 3_600_000) && t <= toMs;
  });
}

export const fetchWalletPerformance = async (
  address: string,
  options: { from: number; to: number; resolution?: "1h" | "1d" },
) => {
  const native = await nativeUsd(chain()).catch(() => 0);
  const resolution = options.resolution ?? "1d";
  const points = await fetchPnlPoints(address, options.from, options.to, resolution);
  return normalizeWalletPerformanceResponse({
    success: true,
    address,
    startTime: new Date(options.from * 1000).toISOString(),
    endTime: new Date(options.to * 1000).toISOString(),
    resolution,
    solPriceUsd: native,
    data: points.map((p) => {
      const pnl = num(p.realizedPnlUsd) ?? 0;
      const vol = num(p.volumeUsd) ?? 0;
      return {
        timestamp: msToIso(p.time) ?? "",
        trades: num(p.trades) ?? 0,
        buys: 0,
        sells: 0,
        volumeSol: usdToNative(vol, native) ?? 0,
        volumeUsd: vol,
        realizedPnlSol: usdToNative(pnl, native) ?? 0,
        realizedPnlUsd: pnl,
        uniqueTokens: 0,
      };
    }),
  }) as WalletPerformanceResponse;
};

export const fetchWalletPnl = async (
  address: string,
  options: { from?: number; to?: number; limit?: number } = {},
) => {
  const native = await nativeUsd(chain()).catch(() => 0);
  const [stats, holdings] = await Promise.all([
    fetchWalletStats(address, periodFor(options.from, options.to)),
    fetchWalletHoldings(address).catch(() => null),
  ]);
  const realized = num(stats.realizedPnlUsd) ?? 0;
  const tokens = (holdings?.data || []).map((h) => ({
    mint: h.mint,
    realizedPnlSol: 0,
    totalCostBasis: 0,
    unrealizedCostSol: usdToNative(h.usdValue ?? 0, native) ?? 0,
    unrealizedTokens: h.amount,
    unrealizedLots: 1,
    totalBuys: 0,
    totalSells: 0,
  }));
  return {
    success: true,
    address,
    data: {
      totalRealizedPnlSol: usdToNative(realized, native) ?? 0,
      totalRealizedPnlUsd: realized,
      totalUnrealizedCostSol: tokens.reduce((s, t) => s + t.unrealizedCostSol, 0),
      totalUnrealizedCostUsd: holdings?.data.reduce((s, h) => s + (h.usdValue || 0), 0) ?? 0,
      tokenCount: tokens.length,
      tokens,
    },
    tradesProcessed: num(stats.trades) ?? 0,
    truncated: false,
    solPriceUsd: native,
    timestamp: new Date().toISOString(),
  } satisfies WalletFifoPnlResponse;
};

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

export const fetchWalletTokenBreakdown = async (
  address: string,
  options: { limit?: number; sort?: "volume" | "pnl" | "trades" | "recent"; offset?: number } = {},
) => {
  const holdings = await fetchWalletHoldings(address);
  const native = await nativeUsd(chain()).catch(() => 0);
  const data = holdings.data.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50)).map((h) => ({
    mint: h.mint,
    totalTrades: 0,
    buys: 0,
    sells: 0,
    totalVolumeSol: 0,
    totalVolumeUsd: 0,
    buyVolumeSol: 0,
    buyVolumeUsd: 0,
    sellVolumeSol: 0,
    sellVolumeUsd: 0,
    realizedPnlSol: 0,
    realizedPnlUsd: 0,
    totalFees: 0,
    name: h.name,
    symbol: h.symbol,
    positionStatus: "open" as const,
  }));
  return {
    success: true,
    address,
    data,
    count: data.length,
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    sort: options.sort ?? "volume",
    hasMore: false,
    solPriceUsd: native,
  } satisfies WalletTokensResponse;
};

export const fetchChainSentiment = async () => {
  const { data } = await get<unknown>("/trending", { chain: chain(), limit: 20, interval: "1h" }, 30_000);
  let buys = 0, sells = 0;
  for (const r of rows(data)) {
    const w = asRecord(r.window);
    buys += num(w?.buys) ?? 0;
    sells += num(w?.sells) ?? 0;
  }
  const buyRatio = buys + sells ? buys / (buys + sells) : 0.5;
  return {
    score: Math.round(buyRatio * 100),
    label: buyRatio >= 0.55 ? "buy" : buyRatio <= 0.45 ? "sell" : "neutral",
    buyRatio,
    trades: buys + sells,
  };
};

export interface OhlcCandle {
  timestamp: string | number;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume?: string | number;
  sol_price?: string | number;
}

export interface TradingVolume {
  trade_count: number;
  total_sol_volume: number;
  total_token_volume: number;
  buy_count: number;
  sell_count: number;
  bundle_trades: number;
  sniper_trades: number;
  protrader_trades: number;
  buySolVolume: number;
  sellSolVolume: number;
  netFlow: number;
  buySellRatio: number;
  feesTotal: number;
  uniqueTraders: number;
}

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

export const fetchTradingVolume = async (mint: string, _hours = 24) => {
  const c = chain();
  const [data, native] = await Promise.all([fetchTokenRaw(mint, c), nativeUsd(c).catch(() => 0)]);
  const w = asRecord(asRecord(data.stats)?.["24h"]) || {};
  const buys = num(w.buys) ?? 0;
  const sells = num(w.sells) ?? 0;
  return {
    success: true,
    mint,
    hours: 24,
    data: {
      trade_count: num(w.trades) ?? buys + sells,
      total_sol_volume: usdToNative(w.volumeUsd, native) ?? 0,
      total_token_volume: 0,
      buy_count: buys,
      sell_count: sells,
      bundle_trades: 0,
      sniper_trades: 0,
      protrader_trades: 0,
      buySolVolume: usdToNative(w.buyVolumeUsd, native) ?? 0,
      sellSolVolume: usdToNative(w.sellVolumeUsd, native) ?? 0,
      netFlow: (usdToNative(w.buyVolumeUsd, native) ?? 0) - (usdToNative(w.sellVolumeUsd, native) ?? 0),
      buySellRatio: sells ? buys / sells : 1,
      feesTotal: 0,
      uniqueTraders: 0,
    } satisfies TradingVolume,
  };
};

// ── candles ────────────────────────────────────────────────────────────────

export type OhlcTimeframe =
  | "1s" | "5s" | "15s" | "30s"
  | "1m" | "5m" | "15m" | "30m"
  | "1h" | "4h" | "12h" | "1d" | "1w";

export interface ApiCandle { time: number; open: number; high: number; low: number; close: number; volume: number }

/**
 * OHLCV from the API, oldest first. `to` pages back (pass the oldest `time`
 * you have). `unit`: `usd` = USD price, `marketCap` = USD market cap.
 * Volume is USD either way.
 */
export const fetchCandles = async (
  mint: string,
  opts: { interval: OhlcTimeframe; limit?: number; from?: number; to?: number; unit?: "usd" | "marketCap" },
): Promise<ApiCandle[]> => {
  const { data } = await get<unknown>(tokenPath(mint, "/candles"), {
    interval: opts.interval,
    limit: Math.min(1000, opts.limit ?? 300),
    from: opts.from,
    to: opts.to,
    unit: opts.unit ?? "usd",
  });
  return rows(data)
    .map((r) => apiCandle(r))
    .filter((c): c is ApiCandle => c != null)
    .sort((a, b) => a.time - b.time);
};

/** Candles in the chain's native coin (price per token). */
export const fetchOhlc = async (
  mint: string,
  timeframe: OhlcTimeframe = "1s",
  limit = 60,
  to?: number,
) => {
  const native = await nativeUsd(chain()).catch(() => 0);
  const bars = await fetchCandles(mint, { interval: timeframe, limit, to });
  const div = native > 0 ? native : 1;
  const candles: OhlcCandle[] = bars.map((b) => ({
    timestamp: new Date(b.time).toISOString(),
    open: b.open / div,
    high: b.high / div,
    low: b.low / div,
    close: b.close / div,
    volume: b.volume,
  }));
  return {
    data: candles,
    candles,
    interval: timeframe,
    oldestTimestamp: bars[0]?.time ?? null,
    count: candles.length,
  };
};

export interface FundingInfo {
  fundedBy: string;
  fundedAt: string;
  signature: string;
  slot: number;
  lamports: string;
  solAmount: number;
  source: "observed" | "rpc_backfilled" | "rpc_unresolved";
}
export interface FundingChainEntry {
  wallet: string;
  fundedBy: string | null;
  fundedAt?: string;
  signature?: string;
  slot?: number;
  lamports?: string;
  solAmount?: number;
  source?: FundingInfo["source"];
}
export interface FundedByEntry {
  wallet: string;
  fundedAt: string;
  signature: string;
  slot: number;
  lamports: string;
  solAmount: number;
  source: FundingInfo["source"];
}
export interface FundingCluster {
  rootFunder: string;
  depth: number;
  wallets: string[];
}
export interface HolderEdge {
  a: string;
  b: string;
  kind: "sol" | "token";
  transfers: number;
  firstSeen: string;
  lastSeen: string;
}

export const fetchFundingLookup = async (_wallets: string[], ..._rest: unknown[]) =>
  ({ success: true, fundings: {} as Record<string, FundingInfo | null>, missing: [] as string[], enrichmentEnqueued: [] as string[] });
export const fetchFundingFundedBy = async (..._rest: unknown[]) => ({ success: true, funded: {} as Record<string, { wallets: FundedByEntry[]; nextCursor: string | null; more: boolean }> });
export const fetchFundingChain = async (..._rest: unknown[]) => ({ success: true, chains: {} as Record<string, FundingChainEntry[]> });
export const fetchFundingCluster = async (..._rest: unknown[]) => ({ success: true, clusters: [] as FundingCluster[], unclustered: [] as string[], enrichmentEnqueued: [] as string[] });
export const fetchHolderEdges = async (mint: string, ..._rest: unknown[]) => ({ success: true, mint, edges: [] as HolderEdge[] });

export type PerpVenue = "jup" | "phoenix";
export type PerpSide = "long" | "short";
export type PerpFundingMechanism = "funding" | "borrow_fee";
export interface PerpMarket { market_id: string; venue: PerpVenue; asset: string; volume_24h_usd?: number; trades_24h?: number }
export interface PerpCandle { timestamp: number; open: number; high: number; low: number; close: number; volume_usd: number; trade_count: number }
export type PerpFillAction = "open" | "add" | "reduce" | "close" | "fill";
export interface PerpMarketTrade {
  timestamp: number; slot: number; signature: string; signer: string;
  side: PerpSide; size: number; price: number; fee: number;
  action?: PerpFillAction; realized_pnl_e6?: number | null;
}
export interface PerpLiquidation {
  timestamp: number; slot: number; signature: string; signer: string;
  position_pubkey: string; side: PerpSide; size_closed: number; oracle_price: number; fee: number;
}
export interface PerpPosition {
  market_id: string; venue: PerpVenue; position_pubkey: string;
  side: PerpSide; size: number; entry_price: number; collateral: number;
  unrealized_pnl: number; slot: number; snapshot_ts: number; is_open: boolean;
}
export interface PerpQuote {
  market_id: string; venue: string; side: PerpSide;
  entry_price: number; est_liquidation_price: number; size: number;
  mechanism: PerpFundingMechanism; funding_or_borrow_bps_per_hour: number;
  fee_bps: number; quote_ts_ms: number; slot: number; provider: string;
}
export interface PerpUnsignedTx { wallet: string; tx_b64: string; status: string }
export type PerpOrderKind = "limit" | "take_profit" | "stop_loss";
export type PerpOrderState = "open" | "updated" | "filled" | "cancelled";
export interface PerpOrder {
  order_id: string; owner: string; market_id: string; venue: PerpVenue | string;
  position_pubkey: string; kind: PerpOrderKind; side: PerpSide; state: PerpOrderState;
  size_usd: number; collateral: number; trigger_price: number; trigger_above: boolean;
  entire_position: boolean; created_slot: number; created_ts: number;
  updated_slot: number; updated_ts: number; last_signature: string;
}

const emptyList = async <T,>(extra: T) => extra;

export const fetchPerpMarkets = async (..._rest: unknown[]) => ({ data: [] as PerpMarket[], count: 0 });
export const fetchPerpCandles = async (marketId: string, ..._rest: unknown[]) => ({ market_id: marketId, timeframe: "1m", data: [] as PerpCandle[], count: 0 });
export const fetchPerpMarketTrades = async (marketId: string, ..._rest: unknown[]) => ({ market_id: marketId, data: [] as PerpMarketTrade[], count: 0 });
export const fetchPerpLiquidations = async (marketId: string, ..._rest: unknown[]) => ({ market_id: marketId, data: [] as PerpLiquidation[], count: 0 });
export const fetchPerpWalletPositions = async (address: string, ..._rest: unknown[]) => ({ address, data: [] as PerpPosition[], count: 0, is_fresh: false });
export const fetchPerpWalletTrades = async (address: string, ..._rest: unknown[]) => ({ address, data: [] as (PerpMarketTrade & { market_id: string; venue: string; position_pubkey: string })[], count: 0 });
export const fetchPerpWalletLiquidations = async (address: string, ..._rest: unknown[]) => ({ address, data: [] as (PerpLiquidation & { market_id: string; venue: string })[], count: 0 });
export const fetchPerpWalletPnl = async (address: string, ..._rest: unknown[]) => ({ address, data: [] as Array<{
  market_id: string; venue: string;
  long_size: number; short_size: number;
  volume_usd_e6: number; fees_paid_e6: number;
  gross_pnl_e6: number; net_pnl_e6: number;
  first_fill_ts: number; last_fill_ts: number;
}>, count: 0 });
export const fetchPerpQuote = async (..._rest: unknown[]) =>
  ({ success: false as boolean, error: "not_supported_selfhosted", data: undefined as PerpQuote | undefined });
export const submitPerpOrder = async (..._rest: unknown[]) => ({ success: false as boolean, error: "not_supported_selfhosted", data: undefined });
export const submitPerpClose = async (..._rest: unknown[]) => ({ success: false as boolean, error: "not_supported_selfhosted", data: undefined });
export const submitPerpTpsl = async (..._rest: unknown[]) => ({ success: false as boolean, error: "not_supported_selfhosted", data: undefined });
export const submitPerpCancel = async (..._rest: unknown[]) => ({ success: false as boolean, error: "not_supported_selfhosted", data: undefined });
export const submitPerpModify = async (..._rest: unknown[]) => ({ success: false as boolean, error: "not_supported_selfhosted", data: undefined });
export const fetchPerpMarketOrders = async (marketId: string, ..._rest: unknown[]) => ({ market_id: marketId, data: [] as PerpOrder[], count: 0 });
export const fetchPerpOrderbook = async (marketId: string, ..._rest: unknown[]) => ({ market_id: marketId, asks: [], bids: [], note: "unavailable" });
export const fetchPerpWalletOrders = async (address: string, ..._rest: unknown[]) => ({ address, data: [] as PerpOrder[], count: 0 });

void emptyList;
