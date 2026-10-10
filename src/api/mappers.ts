/**
 * API shapes → the UI's internal types.
 *
 * The API speaks USD (`…Usd`), percents 0–100 (`…Percent`), Unix ms and `null`
 * for unknown. The UI keeps prices in the chain's native coin (SOL/ETH/BNB) and
 * snake-ish legacy field names, so the conversion happens here, once, for REST
 * and live frames alike. Unknown stays `undefined` — never a made-up 0.
 */
import { getActiveChain } from "../lib/chains";
import { imageSrc } from "./evmapi";
import type { Holder, TokenEvent, TopTrader, Trade } from "../types";

export type Rec = Record<string, unknown>;

export function asRecord(v: unknown): Rec | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Rec : null;
}

export function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export function msToIso(v: unknown): string | undefined {
  const n = num(v);
  if (n == null || n <= 0) return undefined;
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

/** USD → native coin, or undefined when either side is unknown. */
export function usdToNative(usd: unknown, native: number): number | undefined {
  const v = num(usd);
  if (v == null || !(native > 0)) return undefined;
  return v / native;
}

const NATIVE_QUOTES: Record<string, string[]> = {
  sol: ["SOL", "WSOL"],
  eth: ["ETH", "WETH"],
  base: ["ETH", "WETH"],
  robinhood: ["ETH", "WETH"],
  bsc: ["BNB", "WBNB"],
};

/** True when a trade's quote is the chain's own coin (so its amount is native). */
export function isNativeQuote(symbol: unknown, chain: string): boolean {
  if (typeof symbol !== "string") return false;
  return (NATIVE_QUOTES[chain] ?? NATIVE_QUOTES.sol).includes(symbol.toUpperCase());
}

function quoteKind(symbol: unknown, chain: string): string | undefined {
  if (typeof symbol !== "string" || !symbol) return undefined;
  const s = symbol.toUpperCase();
  if (isNativeQuote(s, chain)) return chain === "sol" ? "SOL" : s.replace(/^W/, "");
  if (s === "USDC" || s === "USDT") return s;
  return "OTHER";
}

/**
 * The API's launchpad names → the platform values the UI's filters and icons
 * use (lib/launchpadPlatforms.generated.ts, components/PlatformFilter). Names
 * with no counterpart pass through unchanged.
 */
const PLATFORM_ALIASES: Record<string, string> = {
  "pump.fun": "Pumpfun",
  "pump mayhem": "Mayhem",
  "bonk.fun": "LetsBonk",
  "jupiter studio": "JupiterStudio",
  "jup_studio": "JupiterStudio",
  "launchlab": "RaydiumLaunchpad",
  "easya kickstart": "Kickstart",
  "pons": "Pons",
  "clanker v4": "Clanker",
  "zora creator": "Zora",
};

export function platformName(name: unknown): string {
  if (typeof name !== "string" || !name) return "";
  return PLATFORM_ALIASES[name.toLowerCase()] ?? name;
}

/**
 * TokenSummary (boards, search, trending, screener), Token (single + batch)
 * or RankedToken → TokenEvent. `native` is the chain's coin in USD.
 */
export function apiTokenToEvent(row: Rec, native: number): TokenEvent {
  const chain = str(row.chain) ?? getActiveChain();
  const launchpad = asRecord(row.launchpad);
  const socials = asRecord(row.socials) ?? {};
  const safety = asRecord(row.safety);
  const pool = asRecord(row.pool);
  const stats = asRecord(row.stats);
  // A single/batch Token carries stats windows; a RankedToken carries the one
  // window it was ranked on.
  const day = asRecord(stats?.["24h"]) ?? asRecord(row.window);
  const graduated = launchpad?.graduated === true;
  const progress = num(launchpad?.progressPercent);
  const volumeUsd = num(day?.volumeUsd);
  const buys = num(day?.buys);
  const sells = num(day?.sells);
  const trades = num(day?.trades) ?? (buys != null && sells != null ? buys + sells : undefined);

  const event: TokenEvent = {
    mint_address: String(row.address ?? ""),
    chain,
    name: String(row.name ?? ""),
    symbol: String(row.symbol ?? ""),
    // The launchpad names the platform the columns filter on; a graduated or
    // never-launched token falls back to its main pool's DEX.
    dex: platformName(launchpad?.name) || String(pool?.dex ?? ""),
    image: imageSrc(str(row.image) ?? null),
    website: str(socials.website) ?? null,
    twitter: str(socials.twitter) ?? null,
    telegram: str(socials.telegram) ?? null,
    discord: str(socials.discord) ?? null,
    created_at: msToIso(row.createdAt) ?? "",
    migrated_at: msToIso(launchpad?.graduatedAt),
    marketCap: num(row.marketCapUsd),
    lastPrice: usdToNative(row.priceUsd, native),
    liquidity: num(row.liquidityUsd),
    holders: num(row.holders),
    // Bonding-curve fill; the API nulls it once graduated.
    graduationPercent: progress ?? (graduated ? 100 : undefined),
    graduated: launchpad ? graduated : undefined,
    signer: str(row.creator),
    quoteMint: str(pool?.quoteToken),
    quoteKind: quoteKind(pool?.quoteSymbol, chain),
  };
  if (day) {
    event.priceChange = num(day.priceChangePercent);
    event.volume24h = volumeUsd;
    event.totalSolVolume = usdToNative(volumeUsd, native);
    event.buyCount = buys;
    event.sellCount = sells;
    event.tradeCount = trades;
  }
  if (safety) {
    event.bundlePercentage = num(safety.bundlersPercent);
    event.sniperPercentage = num(safety.snipersPercent);
    event.creatorDeploys = num(safety.creatorLaunches);
    event.top10Percent = num(safety.top10Percent);
    event.devPercent = num(safety.devPercent);
    event.insidersPercent = num(safety.insidersPercent);
    event.freshWalletsPercent = num(safety.freshWalletsPercent);
    event.botsPercent = num(safety.botsPercent);
    event.bluechipPercent = num(safety.bluechipPercent);
    event.buyTaxPercent = num(safety.buyTaxPercent);
    event.sellTaxPercent = num(safety.sellTaxPercent);
    event.honeypot = bool(safety.honeypot);
    event.mintRenounced = bool(safety.mintRenounced);
    event.freezeRenounced = bool(safety.freezeRenounced);
  }
  return event;
}

/** Drop `undefined` keys so a merge never blanks a known field. */
export function defined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (out as Rec)[k] = v;
  }
  return out;
}

/** Trade (token tape) or WalletTrade → Trade. */
export function apiTradeToTrade(row: Rec, native: number, fallbackMint = ""): Trade {
  const chain = str(row.chain) ?? getActiveChain();
  const priceUsd = num(row.priceUsd);
  const volumeUsd = num(row.volumeUsd);
  const quoteAmount = num(row.quoteAmount);
  const tags = Array.isArray(row.tags) ? row.tags.map((t) => String(t).toLowerCase()) : [];
  const solAmount = isNativeQuote(row.quoteSymbol, chain) && quoteAmount != null
    ? quoteAmount
    : usdToNative(volumeUsd, native);
  return {
    signature: String(row.signature ?? ""),
    tokenMint: String(row.token ?? fallbackMint),
    signer: String(row.wallet ?? ""),
    transactionType: row.side === "sell" ? "sell" : "buy",
    tokensAmount: num(row.amount) ?? 0,
    // Unpriced rows (a token-quoted swap with no fresh quote price) keep
    // null: shown as "–", never as a 0 SOL trade.
    avgPrice: usdToNative(priceUsd, native) ?? null,
    solAmount: solAmount ?? null,
    timestamp: num(row.time) ?? Date.now(),
    usdValue: volumeUsd,
    avgPriceUSD: priceUsd,
    isBundle: tags.includes("bundle"),
    isSniper: tags.includes("sniper"),
    isProTrader: tags.includes("pro"),
    tags,
  };
}

/** Holder → Holder (USD amounts become native). */
export function apiHolderToHolder(row: Rec, native: number, rank: number): Holder {
  const buys = num(row.buys);
  const sells = num(row.sells);
  const label = str(row.label);
  return {
    address: String(row.wallet ?? ""),
    amount: num(row.amount) ?? 0,
    percentage: num(row.percent) ?? 0,
    rank,
    buySol: usdToNative(row.boughtUsd, native),
    sellSol: usdToNative(row.soldUsd, native),
    buyCount: buys,
    sellCount: sells,
    trades: buys != null || sells != null ? (buys ?? 0) + (sells ?? 0) : undefined,
    lastTrade: msToIso(row.lastActiveAt),
    // `label` names an exchange or a pool: not a person.
    isLiquidityPool: Boolean(label),
    label,
    valueUsd: num(row.valueUsd),
    unrealizedPnlUsd: num(row.unrealizedPnlUsd),
    fundedBy: str(row.fundedBy),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : undefined,
  };
}

/** A /traders row (Holder shape) → TopTrader. */
export function apiHolderToTrader(row: Rec, native: number): TopTrader {
  const buys = num(row.buys) ?? 0;
  const sells = num(row.sells) ?? 0;
  const boughtUsd = num(row.boughtUsd) ?? 0;
  const soldUsd = num(row.soldUsd) ?? 0;
  const pnlUsd = num(row.pnlUsd);
  const realizedUsd = num(row.realizedPnlUsd);
  const tags = Array.isArray(row.tags) ? row.tags.map((t) => String(t).toLowerCase()) : [];
  const has = (...names: string[]) => names.some((n) => tags.includes(n));
  return {
    trader: String(row.wallet ?? ""),
    totalBuys: buys,
    totalSells: sells,
    totalTrades: buys + sells,
    totalVolume: boughtUsd + soldUsd,
    totalPnL: pnlUsd ?? soldUsd - boughtUsd,
    // The table's column is realized PnL.
    pnlSol: usdToNative(realizedUsd ?? soldUsd - boughtUsd, native) ?? 0,
    buySol: usdToNative(boughtUsd, native) ?? 0,
    sellSol: usdToNative(soldUsd, native) ?? 0,
    boughtTokens: 0,
    soldTokens: 0,
    isHolding: (num(row.amount) ?? 0) > 0,
    heldTokens: num(row.amount),
    lastTrade: msToIso(row.lastActiveAt),
    bundleTrades: has("bundler", "bundle") ? 1 : 0,
    sniperTrades: has("sniper") ? 1 : 0,
    pnlFromApi: true,
  };
}

/** Candle → the datafeed's bar fields (ms time). */
export function apiCandle(row: Rec): { time: number; open: number; high: number; low: number; close: number; volume: number } | null {
  const time = num(row.time);
  const close = num(row.close);
  if (time == null || close == null) return null;
  return {
    time,
    open: num(row.open) ?? close,
    high: num(row.high) ?? close,
    low: num(row.low) ?? close,
    close,
    volume: num(row.volume) ?? 0,
  };
}
