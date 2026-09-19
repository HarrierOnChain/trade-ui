import { CHAIN_CHANGED_EVENT, getActiveChain, nativePriceKey, type ChainId } from "../lib/chains";
import {
  normalizeWalletHoldingsResponse,
  normalizeWalletPerformanceResponse,
  normalizeWalletPnlHistoryResponse,
} from "./normalize";
import { evmapiGet, imageSrc } from "./evmapi";
import type {
  TokenEvent,
  Trade,
  Holder,
  TopTrader,
  TrendingToken,
  TrendingPeriod,
  SearchResult,
  TokenPriceChanges,
  WalletHoldingsResponse,
  WalletSummaryResponse,
  WalletSummaryItem,
  WalletPerformanceResponse,
  WalletFifoPnlResponse,
  WalletPnlHistoryResponse,
  WalletTokensResponse,
  PnlLeaderboardResponse,
  PnlSummaryResponse,
} from "../types";

const WIRE_RPC_TIMEOUT_MS = 25_000;

function chain(): ChainId {
  return getActiveChain();
}

function tokenPath(address: string, suffix = ""): string {
  return `/tokens/${chain()}/${encodeURIComponent(address)}${suffix}`;
}

function walletPath(address: string, suffix = ""): string {
  return `/wallets/${chain()}/${encodeURIComponent(address)}${suffix}`;
}

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

function cacheKey(path: string, params: Record<string, string | number>): string {
  const base = `${chain()}`;
  if (Object.keys(params).length === 0) return `${base}|${path}`;
  const ordered = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return `${base}|${path}?${ordered}`;
}

export function chainPath(solPath: string): string {
  return solPath;
}

type NativePrices = { sol?: { usd: number }; eth?: { usd: number }; bnb?: { usd: number } };
let nativeCache: { t: number; data: NativePrices } | null = null;
let nativeInflight: Promise<NativePrices> | null = null;

export async function fetchNativePrices(): Promise<NativePrices> {
  const now = Date.now();
  if (nativeCache && now - nativeCache.t < 15_000) return nativeCache.data;
  if (nativeInflight) return nativeInflight;
  nativeInflight = evmapiGet<NativePrices>("/prices/native")
    .then(({ data }) => {
      nativeCache = { t: Date.now(), data };
      return data;
    })
    .finally(() => { nativeInflight = null; });
  return nativeInflight;
}

export async function nativeUsd(id: ChainId = chain()): Promise<number> {
  const prices = await fetchNativePrices().catch(() => ({} as NativePrices));
  const key = nativePriceKey(id);
  return prices[key]?.usd || 0;
}

function socials(raw: unknown): { website?: string | null; twitter?: string | null; telegram?: string | null } {
  const s = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    website: (s.website as string | null) ?? null,
    twitter: (s.twitter as string | null) ?? (s.x as string | null) ?? null,
    telegram: (s.telegram as string | null) ?? null,
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function discoveryToToken(row: Record<string, unknown>, native: number): TokenEvent {
  const address = String(row.address ?? row.mint ?? row.mint_address ?? "");
  const priceUsd = num(row.priceUsd) ?? num(row.lastAvgPrice) ?? num(row.last_avg_price);
  const lastPrice = priceUsd != null && native > 0 ? priceUsd / native : undefined;
  const created = row.createdAt ?? row.created_at ?? row.timestamp;
  const launchpad = asRecord(row.launchpad);
  const migrated = row.migratedAt ?? row.migrated_at ?? launchpad?.migratedAt ?? launchpad?.migrated_at;
  const links = socials(row.socialLinks);
  const safety = asRecord(row.safety) ?? asRecord(launchpad);
  const buyUsd = num(row.creatorBuyUsd);
  const buys = num(row.buys);
  const sells = num(row.sells);
  return {
    mint_address: address,
    chain: String(row.chain ?? chain()),
    name: String(row.name ?? ""),
    symbol: String(row.symbol ?? ""),
    dex: String(row.platform ?? launchpad?.launchpadName ?? row.dex ?? ""),
    uri: (row.uri as string | null) ?? null,
    image: imageSrc((row.image as string | null) ?? null),
    website: links.website,
    twitter: links.twitter,
    telegram: links.telegram,
    created_at: typeof created === "number" ? new Date(created).toISOString() : String(created || new Date().toISOString()),
    migrated_at: migrated == null ? undefined : (typeof migrated === "number" ? new Date(migrated).toISOString() : String(migrated)),
    marketCap: num(row.marketCap),
    lastPrice,
    volume24h: num(row.volume24h),
    liquidity: num(row.liquidityUsd ?? row.liquidity),
    holders: num(row.holders),
    priceChange: num(row.change24h ?? row.change1h ?? row.priceChange),
    signer: (row.creatorAddress ?? row.signer ?? undefined) as string | undefined,
    bundlePercentage: num(safety?.bundlePercentage ?? row.bundlePercentage),
    sniperPercentage: num(safety?.sniperPercentage ?? row.sniperPercentage),
    creatorDeploys: num(row.creatorDeploys),
    creatorMigrations: num(row.creatorMigrations),
    creatorBuySol: buyUsd != null && native > 0 ? buyUsd / native : num(row.creatorBuySol),
    buyCount: buys,
    sellCount: sells,
    tradeCount: num(row.tradeCount) ?? (buys != null || sells != null ? (buys ?? 0) + (sells ?? 0) : undefined),
    quoteMint: (row.quoteAddress ?? row.quoteMint ?? undefined) as string | undefined,
  } as TokenEvent;
}

export function mapTradeRow(row: Record<string, unknown>, tokenMint: string, native: number): Trade {
  const priceUsd = num(row.priceUsd) ?? 0;
  const avgPrice = native > 0 ? priceUsd / native : priceUsd;
  const side = String(row.side || "buy").toLowerCase() === "sell" ? "sell" : "buy";
  return {
    signature: String(row.sig ?? row.signature ?? ""),
    tokenMint: String(row.token ?? tokenMint),
    signer: String(row.wallet ?? row.signer ?? ""),
    transactionType: side,
    tokensAmount: num(row.amount) ?? 0,
    avgPrice,
    solAmount: num(row.sol) ?? 0,
    timestamp: (num(row.ts) ?? Date.now()) as number,
    usdValue: num(row.usd),
    avgPriceUSD: priceUsd || undefined,
    isBundle: row.bundle === true,
    isSniper: row.sniper === true,
  };
}

async function listDiscovery(path: string, limit: number, extra: Record<string, string | number> = {}): Promise<{ data: TokenEvent[] }> {
  const native = await nativeUsd().catch(() => 0);
  const { data } = await evmapiGet<unknown>(path, { chain: chain(), limit, ...extra });
  const rows = Array.isArray(data) ? data : [];
  return { data: rows.map((r) => discoveryToToken(asRecord(r) || {}, native)).filter((t) => t.mint_address) };
}

export async function razeGet<T = unknown>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const ohlc = path.match(/\/tokens\/ohlc\/([^/?]+)/);
  if (ohlc) {
    return fetchOhlc(ohlc[1]!, String(params.timeframe || params.resolution || "1m") as OhlcTimeframe, Number(params.limit || 150)) as Promise<T>;
  }
  const supply = path.match(/\/tokens\/supply\/([^/?]+)/);
  if (supply) return fetchTokenSupply(supply[1]!) as Promise<T>;
  if (path.endsWith("/api/sol/price") || path === "/api/sol/price") {
    return fetchSolPrice() as Promise<T>;
  }
  throw new Error(`unsupported_path:${path}`);
}

export async function razePost<T = unknown>(_path: string, _body: unknown): Promise<T> {
  throw new Error("not_supported_selfhosted");
}

export async function cachedRazeGet<T>(
  path: string,
  params: Record<string, string | number> = {},
  ttlMs = 10_000,
): Promise<T> {
  const key = cacheKey(path, params);
  const now = Date.now();
  const cached = responseCache.get(key);
  if (cached && now - cached.ts < ttlMs) return cached.value as T;
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const p = razeGet<T>(path, params).then(
    (v) => { responseCache.set(key, { ts: Date.now(), value: v }); inFlight.delete(key); return v; },
    (err) => { inFlight.delete(key); throw err; },
  );
  inFlight.set(key, p);
  return p;
}

export const fetchBatchTokenEnrich = async (mints: string[], _sparklineLimit = 0) => {
  const native = await nativeUsd().catch(() => 0);
  const data: Record<string, unknown> = {};
  await Promise.all(mints.slice(0, 20).map(async (mint) => {
    try {
      const token = await evmapiGet<Record<string, unknown>>(tokenPath(mint));
      const stats = await evmapiGet<Record<string, unknown>>(tokenPath(mint, "/stats")).catch(() => null);
      const row = token.data;
      const w24 = asRecord(asRecord(stats?.data?.windows)?.["24h"]);
      const safety = asRecord(row.safety);
      data[mint] = {
        name: row.name,
        symbol: row.symbol,
        image: imageSrc(row.image as string | null),
        uri: row.uri,
        last_price: num(row.priceUsd) && native > 0 ? Number(row.priceUsd) / native : undefined,
        lastPrice: num(row.priceUsd) && native > 0 ? Number(row.priceUsd) / native : undefined,
        volume_24h: num(row.volume24h) ?? num(w24?.volume),
        trade_count: num(w24?.transactions),
        unique_traders: num(w24?.traders) ?? num(row.holders),
        holders: num(row.holders),
        buy_count: num(w24?.buys),
        sell_count: num(w24?.sells),
        bundle_percentage: num(safety?.bundlePercentage),
        sniper_percentage: num(safety?.sniperPercentage),
        signer: row.creatorAddress,
        platform: row.platform,
        dex: row.platform,
        creatorDeploys: num(row.creatorDeploys),
        creator_deploys: num(row.creatorDeploys),
        creatorMigrations: num(row.creatorMigrations),
        creator_migrations: num(row.creatorMigrations),
        creator_buy_sol: num(row.creatorBuyUsd) && native > 0 ? Number(row.creatorBuyUsd) / native : undefined,
        creatorBuySol: num(row.creatorBuyUsd) && native > 0 ? Number(row.creatorBuyUsd) / native : undefined,
      };
    } catch { /* skip */ }
  }));
  return { success: true, data };
};

export const fetchDeploys = (limit = 50, platform?: string) =>
  listDiscovery("/discovery/new", limit, platform ? { platform } : {});

export const fetchMigrations = (limit = 50, platform?: string) =>
  listDiscovery("/discovery/migrations", limit, platform ? { platform } : {});

export const fetchMigrating = (limit = 50, platform?: string) =>
  listDiscovery("/discovery/launchpad", limit, platform ? { platform } : {});

export const fetchTrades = async (
  mint: string,
  limit = 50,
  _sort: "asc" | "desc" = "desc",
  cursor?: string | null,
  _timeRange?: { fromMs?: number | null; toMs?: number | null },
) => {
  const native = await nativeUsd().catch(() => 0);
  const { data, nextCursor } = await evmapiGet<unknown>(tokenPath(mint, "/trades"), {
    limit,
    cursor: cursor || undefined,
  });
  const rows = Array.isArray(data) ? data : [];
  const trades = rows.map((r) => mapTradeRow(asRecord(r) || {}, mint, native));
  return { data: trades, nextCursor, hasMore: Boolean(nextCursor) };
};

export const fetchHolders = async (mint: string, limit = 200) => {
  const native = await nativeUsd().catch(() => 0);
  const { data } = await evmapiGet<{
    holders?: Array<Record<string, unknown>>;
    supply?: number;
  }>(tokenPath(mint, "/holders"), { limit: Math.min(100, limit) });
  const token = await evmapiGet<Record<string, unknown>>(tokenPath(mint)).catch(() => null);
  const priceUsd = num(token?.data?.priceUsd) ?? 0;
  const holders: Holder[] = (data.holders || []).map((h, i) => ({
    address: String(h.address || ""),
    amount: num(h.amount) ?? 0,
    percentage: num(h.percentage) ?? 0,
    rank: num(h.rank) ?? i + 1,
  }));
  return {
    holders,
    data: holders,
    currentPriceSol: native > 0 ? priceUsd / native : 0,
    supply: num(data.supply),
  };
};

export const fetchTopTraders = async (mint: string, limit = 100) => {
  const native = await nativeUsd().catch(() => 0);
  const { data } = await evmapiGet<unknown>(tokenPath(mint, "/traders"), { period: "DAY" });
  const rows = Array.isArray(data) ? data : [];
  const traders: TopTrader[] = rows.slice(0, limit).map((raw) => {
    const r = asRecord(raw) || {};
    const buyUsd = num(r.buyUsd ?? r.buys ?? r.buyVolumeUsd) ?? 0;
    const sellUsd = num(r.sellUsd ?? r.sells ?? r.sellVolumeUsd) ?? 0;
    const buySol = native > 0 ? buyUsd / native : 0;
    const sellSol = native > 0 ? sellUsd / native : 0;
    const pnlUsd = num(r.pnlUsd ?? r.realizedProfitUsd) ?? (sellUsd - buyUsd);
    return {
      trader: String(r.trader ?? r.walletAddress ?? r.address ?? ""),
      totalBuys: num(r.buys) ?? 0,
      totalSells: num(r.sells) ?? 0,
      totalTrades: (num(r.buys) ?? 0) + (num(r.sells) ?? 0),
      totalVolume: buyUsd + sellUsd,
      totalPnL: pnlUsd,
      pnlSol: native > 0 ? pnlUsd / native : 0,
      avgTradeSize: 0,
      winRate: 0,
      buySol,
      sellSol,
      boughtTokens: 0,
      soldTokens: 0,
      avgBuyPrice: 0,
      avgSellPrice: 0,
      isHolding: Boolean(r.isHolding),
      bundleTrades: r.bundle === true ? 1 : 0,
      sniperTrades: r.sniper === true ? 1 : 0,
    };
  });
  return { data: traders };
};

export const fetchTrending = async (period: TrendingPeriod = "daily", limit = 50) => {
  const interval = period === "recent" || period === "daily" ? "1h" : period === "weekly" ? "1w" : "1d";
  const native = await nativeUsd().catch(() => 0);
  const { data } = await evmapiGet<unknown>("/discovery/trending", { chain: chain(), limit, interval });
  const rows = Array.isArray(data) ? data : [];
  const tokens: TrendingToken[] = rows.map((raw) => {
    const r = asRecord(raw) || {};
    const t = discoveryToToken(r, native);
    return {
      mint: t.mint_address,
      ...t,
      image: t.image,
      marketCap: t.marketCap,
      volume: t.volume24h,
      priceChange: t.priceChange,
    };
  });
  return { data: tokens };
};

export const fetchSolPrice = async () => {
  const prices = await fetchNativePrices();
  const key = nativePriceKey(chain());
  const usd = prices[key]?.usd || 0;
  return { solPrice: usd, nativePrice: usd, hasValidPrice: usd > 0 };
};

export interface SearchOptions {
  q?: string;
  creator?: string;
  authority?: string;
  limit?: number;
  page?: number;
}

export function fetchSearch(opts: SearchOptions): Promise<{ data: SearchResult[] }>;
export function fetchSearch(q: string, limit?: number): Promise<{ data: SearchResult[] }>;
export async function fetchSearch(
  arg: string | SearchOptions,
  limit = 20,
): Promise<{ data: SearchResult[] }> {
  const q = typeof arg === "string" ? arg : (arg.q || arg.creator || arg.authority || "");
  const lim = typeof arg === "string" ? limit : (arg.limit ?? 20);
  const { data } = await evmapiGet<unknown>("/search", { q, limit: lim });
  const rows = Array.isArray(data) ? data : [];
  return {
    data: rows.map((raw) => {
      const r = asRecord(raw) || {};
      return {
        mint: String(r.address ?? r.mint ?? ""),
        chain: String(r.chain ?? chain()),
        symbol: String(r.symbol ?? ""),
        name: String(r.name ?? ""),
        platform: String(r.platform ?? ""),
        created_at: r.createdAt != null ? String(r.createdAt) : undefined,
      };
    }),
  };
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
  athMcap?: number;
}

export const fetchCreatorMigrations = async (signer: string, limit = 50) => {
  const { data } = await evmapiGet<unknown>("/discovery/screener", {
    chain: chain(),
    creatorAddress: signer,
    limit,
  });
  const rows = Array.isArray(data) ? data : [];
  return {
    success: true,
    data: rows.map((raw) => {
      const r = asRecord(raw) || {};
      return {
        mint: String(r.address ?? ""),
        name: String(r.name ?? ""),
        symbol: String(r.symbol ?? ""),
        migratedAt: r.migratedAt != null ? String(r.migratedAt) : undefined,
        athMcap: num(r.athPrice ?? r.marketCap),
      } satisfies CreatorMigration;
    }),
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
  const { data } = await evmapiGet<Record<string, unknown>>(tokenPath(mint));
  const native = await nativeUsd().catch(() => 0);
  const priceUsd = num(data.priceUsd) ?? 0;
  return {
    success: true,
    data: {
      mint,
      avgPrice: native > 0 ? priceUsd / native : 0,
      amountIn: 0,
      amountOut: 0,
      platform: String(data.platform ?? ""),
      pool: "",
      timeTaken: 0,
    } satisfies QuoteData,
  };
};

export const fetchTokenInfo = async (mint: string) => {
  const native = await nativeUsd().catch(() => 0);
  const { data } = await evmapiGet<Record<string, unknown>>(tokenPath(mint));
  const token = discoveryToToken(data, native);
  if (!token.mint_address) token.mint_address = mint;
  return { success: true, data: token };
};

export const fetchPriceChanges = async (mint: string) => {
  const native = await nativeUsd().catch(() => 0);
  const { data } = await evmapiGet<Record<string, unknown>>(tokenPath(mint, "/stats"));
  const token = await evmapiGet<Record<string, unknown>>(tokenPath(mint)).catch(() => null);
  const windows = asRecord(data.windows) || asRecord(token?.data?.windows) || {};
  const priceUsd = num(token?.data?.priceUsd) ?? num(data.price) ?? 0;
  const currentPrice = native > 0 ? priceUsd / native : 0;
  const pick = (key: string) => {
    const w = asRecord(windows[key]);
    if (!w) return null;
    const change = num(w.change ?? w.priceChange);
    const price = num(w.price);
    return {
      change: change ?? 0,
      price: price ?? 0,
      trades: num(w.transactions ?? w.trades) ?? 0,
      volume: num(w.volume) ?? 0,
    };
  };
  const result: TokenPriceChanges & { success: boolean } = {
    success: true,
    mint,
    currentPrice,
    currentPriceUSD: priceUsd ? String(priceUsd) : null,
    solPriceUSD: native,
    changes: {
      "5m": pick("5m"),
      "1h": pick("1h"),
      "4h": pick("4h"),
      "12h": pick("12h"),
      "24h": pick("24h"),
    },
  };
  return result;
};

export const fetchTokenSupply = async (mint: string) => {
  const { data } = await evmapiGet<Record<string, unknown>>(tokenPath(mint));
  const supply = num(data.circulatingSupply ?? data.totalSupply) ?? 1_000_000_000;
  return { supply, decimals: 6 };
};

export const fetchWalletHoldings = async (address: string) => {
  const { data } = await evmapiGet<unknown>(walletPath(address, "/holdings"));
  const rows = Array.isArray(data) ? data : [];
  const native = await evmapiGet<Record<string, unknown>>(walletPath(address, "/native")).catch(() => null);
  const rawBal = native?.data?.nativeTokenBalance;
  const sol = typeof rawBal === "number"
    ? (chain() === "sol" ? rawBal / 1e9 : rawBal)
    : typeof rawBal === "string"
      ? Number(rawBal) / (chain() === "sol" ? 1e9 : 1e18)
      : 0;
  return normalizeWalletHoldingsResponse({
    success: true,
    ownerAddress: address,
    tokens: rows.map((raw) => {
      const r = asRecord(raw) || {};
      return {
        mint: String(r.address ?? r.tokenId ?? ""),
        amount: num(r.amount) ?? 0,
        decimals: num(r.decimals) ?? 0,
        usdValue: num(r.usd),
        hasBalance: (num(r.amount) ?? 0) > 0,
      };
    }),
    summary: { totalSolBalance: sol, tokensWithBalance: rows.length, totalTokens: rows.length },
  }) as WalletHoldingsResponse;
};

export const fetchWalletTrades = async (address: string, limit = 50) => {
  const native = await nativeUsd().catch(() => 0);
  const { data } = await evmapiGet<unknown>(walletPath(address, "/trades"), { limit });
  const rows = Array.isArray(data) ? data : [];
  return { data: rows.map((r) => mapTradeRow(asRecord(r) || {}, String((asRecord(r) || {}).token || ""), native)) };
};

function windowToSummary(address: string, wallet: Record<string, unknown>): WalletSummaryItem {
  const w = asRecord(asRecord(wallet.windows)?.["30d"]) || asRecord(wallet.windows) || {};
  const realized = num(w.realizedProfitUsd ?? wallet.realizedProfitUsd) ?? 0;
  const volume = num(w.volumeUsd) ?? 0;
  const swaps = num(w.swaps ?? wallet.trades) ?? 0;
  const wins = num(w.wins) ?? 0;
  const losses = num(w.losses) ?? 0;
  return {
    address,
    totalTrades: swaps,
    totalBuys: 0,
    totalSells: 0,
    buyRatio: 0,
    sellRatio: 0,
    totalVolumeSol: 0,
    totalVolumeUsd: volume,
    avgTradeSizeSol: 0,
    avgTradeSizeUsd: swaps ? volume / swaps : 0,
    largestTradeSol: 0,
    largestTradeUsd: 0,
    totalFees: 0,
    realizedPnlSol: 0,
    realizedPnlUsd: realized,
    uniqueTokensTraded: num(w.uniqueTokens ?? wallet.tokenCount) ?? 0,
    winningTokens: wins,
    winRate: (wins + losses) > 0 ? wins / (wins + losses) : 0,
    proTradeCount: 0,
    sniperCount: 0,
    bundleCount: 0,
  };
}

export const fetchWalletSummary = async (
  addresses: string[],
  _options: { from?: number; to?: number } = {},
) => {
  const items: WalletSummaryItem[] = [];
  await Promise.all(addresses.map(async (address) => {
    try {
      const { data } = await evmapiGet<Record<string, unknown>>(walletPath(address));
      items.push(windowToSummary(address, data));
    } catch { /* skip */ }
  }));
  const native = await nativeUsd().catch(() => 0);
  return {
    success: true,
    data: items,
    count: items.length,
    solPriceUsd: native,
  } satisfies WalletSummaryResponse;
};

export const fetchPnlLeaderboard = async (_opts?: unknown) => {
  const { data } = await evmapiGet<unknown>("/wallets/leaderboard", { chain: chain() });
  const rows = Array.isArray(data) ? data : [];
  const native = await nativeUsd().catch(() => 0);
  return {
    success: true as const,
    error: undefined as string | undefined,
    period: "daily" as const,
    platform: "all",
    wallets: rows.map((raw) => {
      const r = asRecord(raw) || {};
      return {
        signer: String(r.address ?? ""),
        pnlSol: 0,
        pnlUsd: num(r.realizedProfitUsd30d ?? r.realizedProfitUsd) ?? 0,
        trades: num(r.swaps30d) ?? 0,
      };
    }),
    limit: rows.length,
    offset: 0,
    solPriceUsd: native,
  };
};

export const fetchPnlSummary = async (_opts?: unknown) =>
  ({
    success: true,
    period: "daily",
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

export const fetchWalletPerformance = async (
  address: string,
  options: { from: number; to: number; resolution?: "1h" | "1d" },
) => {
  const hist = await fetchWalletPnlHistory(address, options);
  return normalizeWalletPerformanceResponse({
    success: true,
    address,
    startTime: new Date(options.from * 1000).toISOString(),
    endTime: new Date(options.to * 1000).toISOString(),
    resolution: options.resolution ?? "1d",
    data: hist.data.map((p) => ({
      timestamp: p.bucket,
      trades: 0,
      buys: 0,
      sells: 0,
      volumeSol: 0,
      volumeUsd: 0,
      realizedPnlSol: p.realizedPnlSol,
      realizedPnlUsd: p.realizedPnlSol * (p.solPriceUsd || 0),
      uniqueTokens: 0,
    })),
  }) as WalletPerformanceResponse;
};

export const fetchWalletPnl = async (
  address: string,
  options: { from?: number; to?: number; limit?: number } = {},
) => {
  const native = await nativeUsd().catch(() => 0);
  const { data } = await evmapiGet<Record<string, unknown>>(walletPath(address, "/pnl"), {
    from: options.from,
    to: options.to,
  });
  const realized = num(data.realizedProfitUsd) ?? 0;
  const holdings = await fetchWalletHoldings(address).catch(() => null);
  const tokens = (holdings?.data || []).map((h) => ({
    mint: h.mint,
    realizedPnlSol: 0,
    totalCostBasis: 0,
    unrealizedCostSol: native > 0 ? (h.usdValue || 0) / native : 0,
    unrealizedTokens: h.amount,
    unrealizedLots: 1,
    totalBuys: 0,
    totalSells: 0,
  }));
  return {
    success: true,
    address,
    data: {
      totalRealizedPnlSol: native > 0 ? realized / native : 0,
      totalRealizedPnlUsd: realized,
      totalUnrealizedCostSol: tokens.reduce((s, t) => s + t.unrealizedCostSol, 0),
      totalUnrealizedCostUsd: holdings?.data.reduce((s, h) => s + (h.usdValue || 0), 0) ?? 0,
      tokenCount: tokens.length,
      tokens,
    },
    tradesProcessed: 0,
    truncated: false,
    solPriceUsd: native,
    timestamp: new Date().toISOString(),
  } satisfies WalletFifoPnlResponse;
};

export const fetchWalletPnlHistory = async (
  address: string,
  options: { from: number; to: number; resolution?: "1h" | "1d"; limit?: number },
) => {
  const native = await nativeUsd().catch(() => 0);
  const { data } = await evmapiGet<Record<string, unknown>>(walletPath(address, "/pnl"), {
    from: options.from,
    to: options.to,
    resolution: options.resolution === "1h" ? "1H" : "1D",
  });
  const series = Array.isArray(data.series) ? data.series : [];
  const points = series.map((raw) => {
    const r = asRecord(raw) || {};
    const t = num(r.t ?? r.timestamp ?? r.time) ?? 0;
    const usd = num(r.v ?? r.value ?? r.realizedProfitUsd) ?? 0;
    return {
      bucket: t > 1e12 ? new Date(t).toISOString() : new Date(t * 1000).toISOString(),
      realizedPnlSol: native > 0 ? usd / native : 0,
      unrealizedPnlSol: 0,
      totalPnlSol: native > 0 ? usd / native : 0,
      solPriceUsd: native,
    };
  });
  return normalizeWalletPnlHistoryResponse({
    success: true,
    address,
    resolution: options.resolution ?? "1d",
    data: points,
    solPriceUsd: native,
  }) as WalletPnlHistoryResponse;
};

export const fetchWalletTokenBreakdown = async (
  address: string,
  options: { limit?: number; sort?: "volume" | "pnl" | "trades" | "recent"; offset?: number } = {},
) => {
  const holdings = await fetchWalletHoldings(address);
  const native = await nativeUsd().catch(() => 0);
  const data = holdings.data.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50)).map((h) => ({
    mint: h.mint,
    totalTrades: 0,
    buys: 0,
    sells: 0,
    totalVolumeSol: 0,
    totalVolumeUsd: h.usdValue ?? 0,
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

export const fetchTradesBySignerMint = async (
  signer: string,
  mint: string,
  limit = 100,
  cursor?: string | null,
  sort: "asc" | "desc" = "desc",
  timeRange?: { fromMs?: number | null; toMs?: number | null },
) => {
  const res = await fetchTrades(mint, limit, sort, cursor, timeRange);
  const data = res.data.filter((t) => t.signer === signer);
  return { ...res, data };
};

export const fetchChainSentiment = async () => {
  const { data } = await evmapiGet<unknown>("/discovery/trending", { chain: chain(), limit: 20 });
  const rows = Array.isArray(data) ? data : [];
  let buys = 0, sells = 0;
  for (const raw of rows) {
    const r = asRecord(raw) || {};
    buys += num(r.buys) ?? 0;
    sells += num(r.sells) ?? 0;
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
  const res = await fetchCreatorMigrations(signer, 50);
  return {
    success: true,
    data: {
      signer,
      deployCount: res.data.length,
      migrationCount: res.data.length,
      totalCount: res.data.length,
      deployTokens: res.data.map((t) => t.mint),
      migrationTokens: res.data.map((t) => t.mint),
    },
  } satisfies SignerCountsResponse;
};

export const fetchTradingVolume = async (mint: string, _hours = 24) => {
  const { data } = await evmapiGet<Record<string, unknown>>(tokenPath(mint, "/stats"));
  const w = asRecord(asRecord(data.windows)?.["24h"]) || {};
  const buys = num(w.buys) ?? 0;
  const sells = num(w.sells) ?? 0;
  const vol = num(w.volume) ?? 0;
  const native = await nativeUsd().catch(() => 0);
  const solVol = native > 0 ? vol / native : 0;
  return {
    success: true,
    mint,
    hours: 24,
    data: {
      trade_count: num(w.transactions) ?? 0,
      total_sol_volume: solVol,
      total_token_volume: 0,
      buy_count: buys,
      sell_count: sells,
      bundle_trades: 0,
      sniper_trades: 0,
      protrader_trades: 0,
      buySolVolume: native > 0 ? (num(w.buyVolume) ?? 0) / native : 0,
      sellSolVolume: native > 0 ? (num(w.sellVolume) ?? 0) / native : 0,
      netFlow: 0,
      buySellRatio: sells ? buys / sells : 1,
      feesTotal: 0,
      uniqueTraders: num(w.traders) ?? 0,
    } satisfies TradingVolume,
  };
};

export type OhlcTimeframe =
  | "1s" | "5s" | "15s" | "30s"
  | "1m" | "5m" | "15m" | "30m"
  | "1h" | "4h" | "1d";

export const fetchOhlc = async (
  mint: string,
  timeframe: OhlcTimeframe = "1s",
  limit = 60,
) => {
  const native = await nativeUsd().catch(() => 0);
  const to = Date.now();
  const span: Record<string, number> = {
    "1s": 1_000, "5s": 5_000, "15s": 15_000, "30s": 30_000,
    "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
  };
  const step = span[timeframe] ?? 60_000;
  const from = to - step * Math.max(limit, 50);
  const { data } = await evmapiGet<{ bars?: Array<Record<string, unknown>>; unit?: string }>(
    tokenPath(mint, "/ohlc"),
    { resolution: timeframe, from, to, unit: "usd", limit },
  );
  const bars = data.bars || [];
  const candles: OhlcCandle[] = bars.map((b) => {
    const t = num(b.t) ?? 0;
    const div = native > 0 ? native : 1;
    return {
      timestamp: new Date(t).toISOString(),
      open: (num(b.o) ?? 0) / div,
      high: (num(b.h) ?? 0) / div,
      low: (num(b.l) ?? 0) / div,
      close: (num(b.c) ?? 0) / div,
      volume: num(b.v) ?? 0,
      sol_price: native,
    };
  });
  return {
    data: candles,
    candles,
    interval: timeframe,
    oldestTimestamp: candles[0] ? Date.parse(String(candles[0].timestamp)) : null,
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
void WIRE_RPC_TIMEOUT_MS;
