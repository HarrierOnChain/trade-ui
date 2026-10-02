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
  uri?: string | null;
  image?: string | null;
  marketCap?: number;
  initialMarketCap?: number;
  lastPrice?: number;
  bundlePercentage?: number;
  sniperPercentage?: number;
  creatorDeploys?: number;
  creatorMigrations?: number;
  creatorBuySol?: number;
  creatorBuyPrice?: number;
  creatorBuyTokens?: number;
  signer?: string;
  slot?: number;
  firstHourTrades?: number;
  firstHourVolume?: number;
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
  feesTotal?: number;
  buyCount?: number;
  sellCount?: number;
  uniqueTraders?: number;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  created_at: string;
  migrated_at?: string;
  isNew?: boolean;
  /** Bonding-curve / pool cashback flag (Pump.fun byte 82 / PumpSwap byte 244).
   *  Orthogonal to `dex` — both Pump.fun and Mayhem tokens can be cashback. */
  hasCashback?: boolean;
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
  bought?: number;
  sold?: number;
  buySol?: number;
  sellSol?: number;
  trades?: number;
  buyCount?: number;
  sellCount?: number;
  firstTrade?: string;
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
  avgTradeSize: number;
  winRate: number;
  buySol: number;         // SOL spent on buys
  sellSol: number;        // SOL received from sells
  boughtTokens: number;
  soldTokens: number;
  avgBuyPrice: number;    // SOL per token
  avgSellPrice: number;   // SOL per token
  isHolding: boolean;
  firstTrade?: string;
  lastTrade?: string;
  bundleTrades?: number;
  sniperTrades?: number;
  proTrades?: number;
  entryDelaySeconds?: number | null;
  largestTrade?: number;
  /** Tokens held now (the API reports the balance, not bought − sold). */
  heldTokens?: number;
  /** totalPnL came from the API (realized + unrealized): live trades keep it. */
  pnlFromApi?: boolean;
}

export interface TrendingToken {
  mint: string;
  name?: string;
  symbol?: string;
  image?: string | null;
  score?: number;
  tradeCount?: number;
  uniqueTraders?: number;
  marketCap?: number;
  volume?: number;
  priceChange?: number;
  // Raw API fields
  [key: string]: unknown;
}

export interface SearchResult {
  mint: string;
  chain?: string;
  symbol: string;
  name: string;
  platform: string;
  uri?: string;
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
  largestTradeSol: number;
  largestTradeUsd: number;
  totalFees: number;
  realizedPnlSol: number;
  realizedPnlUsd: number;
  realizedPnlPct?: number | null;
  uniqueTokensTraded: number;
  winningTokens: number;
  winRate: number;
  firstTradeAt?: string | null;
  lastTradeAt?: string | null;
  proTradeCount: number;
  sniperCount: number;
  bundleCount: number;
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

export type LeaderboardPeriod = "daily" | "weekly" | "monthly";

export interface PnlLeaderboardWallet {
  signer: string;
  pnlSol: number;
  pnlUsd: number;
  trades: number;
}

export interface PnlLeaderboardResponse {
  success: boolean;
  period: LeaderboardPeriod;
  platform: string;
  wallets: PnlLeaderboardWallet[];
  limit: number;
  offset: number;
  solPriceUsd?: number;
  timestamp?: string;
  error?: string;
}

export interface PnlSummaryResponse {
  success: boolean;
  period: LeaderboardPeriod;
  platform: string;
  totalProfitableWallets: number;
  totalPnlSol: number;
  totalPnlUsd: number;
  avgPnlSol: number;
  avgPnlUsd: number;
  medianPnlSol: number;
  medianPnlUsd: number;
  p90PnlSol: number;
  p90PnlUsd: number;
  p99PnlSol: number;
  p99PnlUsd: number;
  maxPnlSol: number;
  maxPnlUsd: number;
  solPriceUsd?: number;
  timestamp?: string;
  error?: string;
}

export interface WalletPerformanceDataPoint {
  timestamp: string;
  trades: number;
  buys: number;
  sells: number;
  volumeSol: number;
  volumeUsd: number;
  realizedPnlSol: number;
  realizedPnlUsd: number;
  uniqueTokens: number;
}

export interface WalletPerformanceResponse {
  success: boolean;
  address: string;
  startTime: string;
  endTime: string;
  resolution: "1h" | "1d";
  data: WalletPerformanceDataPoint[];
  count: number;
  solPriceUsd?: number;
  timestamp?: string;
}

export interface FifoTokenPnl {
  mint: string;
  realizedPnlSol: number;
  totalCostBasis: number;
  unrealizedCostSol: number;
  unrealizedTokens: number;
  unrealizedLots: number;
  totalBuys: number;
  totalSells: number;
}

export interface WalletFifoPnlTotals {
  totalRealizedPnlSol: number;
  totalRealizedPnlUsd: number;
  totalUnrealizedCostSol: number;
  totalUnrealizedCostUsd: number;
  tokenCount: number;
  tokens: FifoTokenPnl[];
}

export interface WalletFifoPnlResponse {
  success: boolean;
  address: string;
  data: WalletFifoPnlTotals;
  tradesProcessed: number;
  truncated: boolean;
  solPriceUsd?: number;
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

export interface WalletTokenBreakdown {
  mint: string;
  totalTrades: number;
  buys: number;
  sells: number;
  totalVolumeSol: number;
  totalVolumeUsd: number;
  buyVolumeSol: number;
  buyVolumeUsd: number;
  sellVolumeSol: number;
  sellVolumeUsd: number;
  realizedPnlSol: number;
  realizedPnlUsd: number;
  firstTrade?: string | null;
  lastTrade?: string | null;
  totalFees: number;
  name?: string;
  symbol?: string;
  platform?: string;
  positionStatus?: "open" | "closed";
  holdDurationSeconds?: number;
}

export interface WalletTokensResponse {
  success: boolean;
  address: string;
  data: WalletTokenBreakdown[];
  count: number;
  limit: number;
  offset: number;
  sort: "volume" | "pnl" | "trades" | "recent";
  hasMore: boolean;
  solPriceUsd?: number;
  timestamp?: string;
}

export interface ChainSentiment {
  score: number;
  label?: string;
  timestamp?: string;
  [key: string]: unknown;
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

export interface CandleData {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = "1s" | "5s" | "30s" | "1m" | "5m" | "15m" | "1h";

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1s": 1,
  "5s": 5,
  "30s": 30,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
};
