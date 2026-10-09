// ─────────────────────────────────────────────
// Shared Raze API types
// ─────────────────────────────────────────────

export interface TokenEvent {
  mint_address: string;
  /** Catalog slug when known (sol, eth, bsc, base, robinhood). */
  chain?: string;
  name: string;
  symbol: string;
  dex: string;
  image?: string | null;
  marketCap?: number;
  lastPrice?: number;
  bundlePercentage?: number;
  sniperPercentage?: number;
  creatorDeploys?: number;
  signer?: string;
  slot?: number;
  priceChange?: number;
  /** Bonding-curve completion, 0-100 (the API's launchpad.progressPercent). */
  graduationPercent?: number;
  /** Left its launchpad for a pool (the API's launchpad.graduated). Known
   *  even when the graduation time is not. */
  graduated?: boolean;
  volume24h?: number;
  liquidity?: number;
  holders?: number;
  tradeCount?: number;
  totalSolVolume?: number;
  buyCount?: number;
  sellCount?: number;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  created_at: string;
  migrated_at?: string;
  isNew?: boolean;
  /** Quote mint the token is paired against (Pump.fun enabled USDC quotes
   *  2026-05-21; SOL pairs report wrapped-SOL). */
  quoteMint?: string;
  /** Short label derived from `quoteMint`: "SOL" | "USDC" | "USDT" | "OTHER".
   *  Drives the USDC badge (shown when quoteKind === "USDC"). */
  quoteKind?: string;
}

export interface Trade {
  signature: string;
  tokenMint: string;
  signer: string;
  transactionType: "buy" | "sell";
  tokensAmount: number;
  /** Native coin per token; null when the API has no price for the row. */
  avgPrice: number | null;
  /** Native coin volume; null when the API has no volume for the row
   *  (e.g. a token-quoted swap with no fresh quote price). Never a made-up 0. */
  solAmount: number | null;
  timestamp: string | number; // ISO string from REST, may be unix ms from WS
  usdValue?: number;
  avgPriceUSD?: number | string;
  marketCap?: number;
  isBundle?: boolean;
  isSniper?: boolean;
  isProTrader?: boolean;
  /** The API's maker tags for the row, lowercase (openapi `Trade.tags`). */
  tags?: string[];
  /** Set on a row the UI took from a single live frame; rows from an API
   *  answer (REST page, WS snapshot) leave it unset. */
  live?: boolean;
}

export interface Holder {
  address: string;
  amount: number;
  percentage: number;
  rank: number;
  buySol?: number;
  sellSol?: number;
  trades?: number;
  buyCount?: number;
  sellCount?: number;
  lastTrade?: string;
  isLiquidityPool?: boolean;
  /** Pump.fun system PDA — excluded from concentration metrics. */
  isSystemAccount?: boolean;
  /** Exchange or pool name when the holder is not a person. */
  label?: string;
  /** Current value of the position, USD. */
  valueUsd?: number;
  /** Unrealized PnL from the API, USD. */
  unrealizedPnlUsd?: number;
  fundedBy?: string;
  tags?: string[];
}

export interface TopTrader {
  trader: string;
  totalBuys: number;
  totalSells: number;
  totalTrades: number;
  totalVolume: number;    // USD
  totalPnL: number;       // USD
  pnlSol: number;         // SOL
  buySol: number;         // SOL spent on buys
  sellSol: number;        // SOL received from sells
  boughtTokens: number;
  soldTokens: number;
  isHolding: boolean;
  lastTrade?: string;
  /** 1 when the API tags the wallet a bundler, else 0. */
  bundleTrades?: number;
  /** 1 when the API tags the wallet a sniper, else 0. */
  sniperTrades?: number;
  /** Tokens held now (the API reports the balance, not bought − sold). */
  heldTokens?: number;
  /** totalPnL came from the API (realized + unrealized): live trades keep it. */
  pnlFromApi?: boolean;
}

export interface SearchResult {
  mint: string;
  chain?: string;
  symbol: string;
  name: string;
  platform: string;
  time?: string;
  created_at?: string;
  image?: string | null;
  /** USD. */
  marketCap?: number;
  /** Native coin per token. */
  lastPrice?: number;
}

export type TrendingPeriod = "recent" | "daily" | "weekly" | "monthly";

export interface TokenHolding {
  mint: string;
  amount: number;
  decimals: number;
  isNative?: boolean;
  hasBalance?: boolean;
  symbol?: string;
  name?: string;
  image?: string | null;
  usdValue?: number;
}

export interface WalletHoldingsSummary {
  totalTokens?: number;
  tokensWithBalance?: number;
  totalSolBalance?: number;
  totalAccounts?: number;
}

export interface WalletHoldingsResponse {
  success: boolean;
  ownerAddress: string;
  data: TokenHolding[];
  count: number;
  summary?: WalletHoldingsSummary;
  timestamp?: string;
}

export interface WalletSummaryItem {
  address: string;
  totalTrades: number;
  totalBuys: number;
  totalSells: number;
  buyRatio: number;
  sellRatio: number;
  totalVolumeSol: number;
  totalVolumeUsd: number;
  avgTradeSizeSol: number;
  avgTradeSizeUsd: number;
  realizedPnlSol: number;
  realizedPnlUsd: number;
  realizedPnlPct?: number | null;
  uniqueTokensTraded: number;
  winRate: number;
  lastTradeAt?: string | null;
}

export interface WalletSummaryResponse {
  success: boolean;
  address?: string;
  data: WalletSummaryItem | WalletSummaryItem[];
  count?: number;
  solPriceUsd?: number;
  from?: string | null;
  to?: string | null;
  timestamp?: string;
}

export interface WalletPnlHistoryPoint {
  bucket: string;
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  totalPnlSol: number;
  solPriceUsd: number;
}

export interface WalletPnlHistoryResponse {
  success: boolean;
  address: string;
  resolution: "1h" | "1d";
  data: WalletPnlHistoryPoint[];
  count: number;
  tradesProcessed: number;
  tokensTracked: number;
  solPriceUsd?: number;
  timestamp?: string;
}

export interface ChainSentiment {
  /** Buy share of the last hour's trades on the top trending tokens, 0-100. */
  score: number;
  buyRatio: number;
  trades: number;
}

export interface PriceChangePeriod {
  change: number;
  price: number;
  trades: number;
  volume: number;
}

export interface TokenPriceChanges {
  mint: string;
  currentPrice: number;
  currentPriceUSD: string | null;
  oldestPrice?: number;
  oldestTime?: string;
  tokenAgeSeconds?: number;
  /** The API's windows: 1m, 5m, 1h, 6h, 24h (no 4h / 12h). */
  changes: {
    "1m"?: PriceChangePeriod | null;
    "5m"?: PriceChangePeriod | null;
    "1h"?: PriceChangePeriod | null;
    "6h"?: PriceChangePeriod | null;
    "24h"?: PriceChangePeriod | null;
  };
  solPriceUSD?: number;
}

export type Timeframe = "1s" | "5s" | "30s" | "1m" | "5m" | "15m" | "1h";
