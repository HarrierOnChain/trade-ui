import type {
  TokenEvent,
  TokenHolding,
  WalletHoldingsResponse,
  WalletPerformanceDataPoint,
  WalletPerformanceResponse,
  WalletPnlHistoryPoint,
  WalletPnlHistoryResponse,
  WalletSummaryItem,
} from "../types";
import { imageSrc } from "./evmapi";

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Coerce a backend bool/0-1/"true" into a boolean, or undefined when absent. */
function toOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNestedRecord(
  value: Record<string, unknown> | null,
  path: string[],
): Record<string, unknown> | null {
  let current: Record<string, unknown> | null = value;
  for (const key of path) {
    current = asRecord(current?.[key]);
    if (!current) return null;
  }
  return current;
}

function readNestedValue(
  value: Record<string, unknown> | null,
  path: string[],
): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Extract an array from any API response shape.
 * Handles: raw array, { data: [] }, { tokens: [] }, { traders: [] }, etc.
 * Guards against { data: {...} } (object, not array) which caused .map errors.
 */
export function toArray<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    for (const key of ["data", "alerts", "tokens", "traders", "holders", "results", "items", "deploys", "trades", "candles"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
    // Handle nested: { data: { traders: [...] } } or { data: { holders: [...] } }
    if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
      const inner = obj.data as Record<string, unknown>;
      for (const key of ["traders", "holders", "tokens", "alerts", "items", "results"]) {
        if (Array.isArray(inner[key])) return inner[key] as T[];
      }
    }
  }
  return [];
}

/**
 * Wallet summary can return either a single object or an array inside `data`.
 * This normalizes both shapes into an array for UI consumption.
 */
export function normalizeWalletSummaryItems(res: unknown): WalletSummaryItem[] {
  if (res && typeof res === "object" && !Array.isArray(res)) {
    const data = (res as Record<string, unknown>).data;
    if (Array.isArray(data)) return data as WalletSummaryItem[];
    if (data && typeof data === "object") return [data as WalletSummaryItem];
  }
  return toArray<WalletSummaryItem>(res);
}

function normalizeTokenHolding(raw: unknown): TokenHolding | null {
  const token = asRecord(raw);
  if (!token) return null;

  const parsedInfo = readNestedRecord(token, ["accountInfo", "parsed", "info"]);
  const tokenAmount =
    asRecord(token.tokenAmount) ??
    asRecord(parsedInfo?.tokenAmount) ??
    readNestedRecord(token, ["accountInfo", "tokenAmount"]);

  const mint = String(token.mint ?? parsedInfo?.mint ?? "");
  if (!mint) return null;

  const decimals = toNumber(token.decimals ?? tokenAmount?.decimals);
  let amount = toNumber(token.amount, Number.NaN);
  if (!Number.isFinite(amount)) {
    amount = toNumber(
      tokenAmount?.uiAmount ??
      tokenAmount?.uiAmountString ??
      (decimals >= 0
        ? toNumber(token.rawAmount ?? tokenAmount?.amount, 0) / 10 ** decimals
        : 0),
      0,
    );
  }
  const usdValue = toNumber(token.usdValue ?? token.usd_value, Number.NaN);

  return {
    mint,
    amount,
    decimals,
    isNative: Boolean(token.isNative),
    hasBalance:
      typeof token.hasBalance === "boolean"
        ? token.hasBalance
        : amount > 0,
    symbol: typeof token.symbol === "string" ? token.symbol : undefined,
    name: typeof token.name === "string" ? token.name : undefined,
    image: typeof token.image === "string" ? token.image : null,
    usdValue: Number.isFinite(usdValue) ? usdValue : undefined,
  };
}

/**
 * The by-owner endpoint is documented with `tokens`, `tokensWithBalance`,
 * nested `tokenAmount`, and `summary.totalSolBalance`. Normalize that contract
 * into a stable holdings response the app can consume consistently.
 */
export function normalizeWalletHoldingsResponse(
  res: unknown,
): WalletHoldingsResponse {
  const response = asRecord(res) ?? {};
  const rawTokens =
    (Array.isArray(response.tokensWithBalance) ? response.tokensWithBalance : null) ??
    (Array.isArray(response.tokens) ? response.tokens : null) ??
    (Array.isArray(response.data) ? response.data : []);

  const data = rawTokens
    .map((token) => normalizeTokenHolding(token))
    .filter((token): token is TokenHolding => token != null);

  const summary = asRecord(response.summary);
  const nativeHolding = data.find((token) => token.isNative);
  const totalSolBalance =
    summary && summary.totalSolBalance != null
      ? toNumber(summary.totalSolBalance, nativeHolding?.amount ?? 0)
      : nativeHolding?.amount;

  return {
    success: Boolean(response.success),
    ownerAddress: String(response.ownerAddress ?? response.address ?? ""),
    data,
    count: toNumber(
      response.count ?? summary?.tokensWithBalance ?? summary?.totalTokens,
      data.length,
    ),
    summary: summary
      ? {
          totalTokens: toNumber(
            summary.totalTokens ?? response.count,
            data.length,
          ),
          tokensWithBalance: toNumber(
            summary.tokensWithBalance,
            data.filter((token) => token.hasBalance).length,
          ),
          totalSolBalance,
          totalAccounts: toNumber(summary.totalAccounts, 0),
        }
      : undefined,
    timestamp:
      typeof response.timestamp === "string"
        ? response.timestamp
        : undefined,
  };
}

/**
 * Wallet performance currently comes back from Raze with snake_case metric keys
 * and `bucket` timestamps. Normalize that shape once at the API boundary so the
 * rest of the app can consume the camelCase point model consistently.
 */
export function normalizeWalletPerformanceResponse(
  res: unknown,
): WalletPerformanceResponse {
  const response =
    res && typeof res === "object" && !Array.isArray(res)
      ? (res as Record<string, unknown>)
      : {};

  const solPriceUsd = toNumber(response.solPriceUsd ?? response.sol_price_usd, 0);
  const rawPoints = Array.isArray(response.data) ? response.data : [];
  const data: WalletPerformanceDataPoint[] = rawPoints
    .map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const point = raw as Record<string, unknown>;
      const timestamp = String(point.timestamp ?? point.bucket ?? "");
      if (!timestamp) return null;

      const volumeSol = toNumber(point.volumeSol ?? point.volume_sol);
      const realizedPnlSol = toNumber(
        point.realizedPnlSol ?? point.realized_pnl_sol,
      );

      return {
        timestamp,
        trades: toNumber(point.trades),
        buys: toNumber(point.buys),
        sells: toNumber(point.sells),
        volumeSol,
        volumeUsd: toNumber(
          point.volumeUsd ?? point.volume_usd,
          volumeSol * solPriceUsd,
        ),
        realizedPnlSol,
        realizedPnlUsd: toNumber(
          point.realizedPnlUsd ?? point.realized_pnl_usd,
          realizedPnlSol * solPriceUsd,
        ),
        uniqueTokens: toNumber(point.uniqueTokens ?? point.unique_tokens),
      };
    })
    .filter((point): point is WalletPerformanceDataPoint => point != null);

  return {
    success: Boolean(response.success),
    address: String(response.address ?? ""),
    startTime: String(response.startTime ?? response.start_time ?? ""),
    endTime: String(response.endTime ?? response.end_time ?? ""),
    resolution:
      response.resolution === "1h" || response.resolution === "1d"
        ? response.resolution
        : "1d",
    data,
    count: toNumber(response.count, data.length),
    solPriceUsd: solPriceUsd || undefined,
    timestamp:
      typeof response.timestamp === "string" ? response.timestamp : undefined,
  };
}

/**
 * Wallet PnL history — FIFO time buckets from `raze-history`
 * (`GET /api/sol/wallets/{address}/pnl/history`). Each point's
 * `realizedPnlSol` is the realized PnL earned in that bucket (not cumulative).
 */
export function normalizeWalletPnlHistoryResponse(
  res: unknown,
): WalletPnlHistoryResponse {
  const response =
    res && typeof res === "object" && !Array.isArray(res)
      ? (res as Record<string, unknown>)
      : {};

  const solPriceUsd = toNumber(response.solPriceUsd ?? response.sol_price_usd, 0);
  const rawPoints = Array.isArray(response.data) ? response.data : [];
  const data: WalletPnlHistoryPoint[] = rawPoints
    .map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const point = raw as Record<string, unknown>;
      const bucket = String(point.bucket ?? "");
      if (!bucket) return null;

      const realizedPnlSol = toNumber(
        point.realizedPnlSol ?? point.realized_pnl_sol,
      );
      const unrealizedPnlSol = toNumber(
        point.unrealizedPnlSol ?? point.unrealized_pnl_sol,
      );
      const totalPnlSol = toNumber(
        point.totalPnlSol ?? point.total_pnl_sol,
        realizedPnlSol + unrealizedPnlSol,
      );
      const pointSolUsd = toNumber(point.solPriceUsd ?? point.sol_price_usd, solPriceUsd);

      return {
        bucket,
        realizedPnlSol,
        unrealizedPnlSol,
        totalPnlSol,
        solPriceUsd: pointSolUsd,
      };
    })
    .filter((point): point is WalletPnlHistoryPoint => point != null);

  const resolution =
    response.resolution === "1h" || response.resolution === "1d"
      ? response.resolution
      : "1h";

  return {
    success: Boolean(response.success),
    address: String(response.address ?? ""),
    resolution,
    data,
    count: toNumber(response.count, data.length),
    tradesProcessed: toNumber(response.tradesProcessed ?? response.trades_processed),
    tokensTracked: toNumber(response.tokensTracked ?? response.tokens_tracked),
    solPriceUsd: solPriceUsd || undefined,
    timestamp:
      typeof response.timestamp === "string" ? response.timestamp : undefined,
  };
}

/**
 * Normalize a WebSocket deploy/migration message into a TokenEvent.
 *
 * Actual message shape received from the API:
 * {
 *   type: "deploy",
 *   timestamp: "2026-03-07T...",
 *   data: {
 *     mint: "...",           ← not mint_address
 *     name: "...",
 *     symbol: "...",
 *     platform: "Pumpfun",  ← not dex
 *     uri: "...",
 *     signer: "...",
 *     creator_buy_sol: 0.5,
 *     creator_buy_price: ...,
 *     creator_buy_tokens: ...,
 *   },
 *   priceInfo: { solPrice: 82.92 }
 * }
 */
export function normalizeTokenEvent(
  msg: Record<string, unknown>,
  isMigration = false,
): TokenEvent | null {
  // Token fields can be nested in msg.data or at the top level
  const inner =
    msg.data && typeof msg.data === "object" && !Array.isArray(msg.data)
      ? (msg.data as Record<string, unknown>)
      : msg;

  // Resolve mint address from all known field names
  const mint = String(
    inner.mint_address ?? inner.mint ?? inner.address ?? msg.mint_address ?? msg.mint ?? msg.address ?? ""
  );
  if (!mint) return null;

  const created_at = String(
    inner.created_at ?? inner.timestamp ?? msg.timestamp ?? new Date().toISOString()
  );

  return {
    mint_address:      mint,
    name:              String(inner.name         ?? ""),
    symbol:            String(inner.symbol       ?? ""),
    // platform (WS) → dex; also accepts dex directly
    dex:               String(inner.dex ?? inner.platform ?? inner.exchange ?? ""),
    uri:               (inner.uri ?? null) as string | null,
    image:             imageSrc((inner.image ?? inner.imageUri ?? inner.image_url ?? inner.imageUrl ?? inner.logo ?? inner.logoUri ?? inner.logo_url ?? null) as string | null),
    chain:             typeof inner.chain === "string" ? inner.chain : undefined,
    website:           (inner.website  ?? null) as string | null,
    twitter:           (inner.twitter  ?? null) as string | null,
    telegram:          (inner.telegram ?? null) as string | null,
    created_at,
    migrated_at:       isMigration
                         ? String(inner.migrated_at ?? msg.timestamp ?? created_at)
                         : undefined,
    // ⚠️ ALL numeric fields go through toOptionalNumber — upstreams can
    // serialize numerics as JSON strings; a blind `as number` cast lets
    // "0.0123" reach fmt* → `e.toFixed is not a function` → whole-tree
    // React crash (P0-bis 2026-07-22).
    marketCap:         toOptionalNumber(inner.marketCap         ?? inner.market_cap),
    initialMarketCap:  toOptionalNumber(inner.initialMarketCap   ?? inner.initial_market_cap),
    bundlePercentage:  toOptionalNumber(inner.bundlePercentage   ?? inner.bundle_percentage),
    sniperPercentage:  toOptionalNumber(inner.sniperPercentage   ?? inner.sniper_percentage),
    creatorDeploys:    toOptionalNumber(inner.creatorDeploys     ?? inner.creator_deploys),
    creatorMigrations: toOptionalNumber(inner.creatorMigrations  ?? inner.creator_migrations),
    creatorBuySol:     toOptionalNumber(inner.creatorBuySol   ?? inner.creator_buy_sol   ?? inner.devBuySol      ?? inner.dev_buy_sol),
    creatorBuyPrice:   toOptionalNumber(inner.creatorBuyPrice ?? inner.creator_buy_price ?? inner.devBuyAvgPrice ?? inner.dev_buy_avg_price ?? inner.devBuyPrice ?? inner.dev_buy_price),
    creatorBuyTokens:  toOptionalNumber(inner.creatorBuyTokens ?? inner.creator_buy_tokens ?? inner.devBuyTokens ?? inner.dev_buy_tokens),
    signer:            (inner.signer ?? inner.creator ?? undefined) as string | undefined,
    slot:              toOptionalNumber(inner.slot),
    firstHourTrades:   toOptionalNumber(inner.firstHourTrades ?? inner.first_hour_trades),
    firstHourVolume:   toOptionalNumber(inner.firstHourVolume ?? inner.first_hour_volume),
    priceChange:       toOptionalNumber(inner.priceChange ?? inner.price_change ?? inner.change24h ?? inner.change_24h),
    volume24h:         toOptionalNumber(inner.volume24h ?? inner.volume_24h ?? inner.volume ?? inner.totalVolume),
    liquidity:         toOptionalNumber(inner.liquidity ?? inner.liquiditySol ?? inner.liquidity_sol),
    holders:           toOptionalNumber(inner.holders ?? inner.holderCount ?? inner.holder_count ?? inner.uniqueTraders ?? inner.unique_traders),
    hasCashback:       toOptionalBool(inner.hasCashback ?? inner.has_cashback ?? inner.isCashback ?? inner.is_cashback),
    quoteMint:         (inner.quoteMint ?? inner.quote_mint ?? undefined) as string | undefined,
    quoteKind:         (inner.quoteKind ?? inner.quote_kind ?? undefined) as string | undefined,
  };
}

/**
 * Normalize REST-API token list items (may also have camelCase or snake_case fields).
 */
/** ms-epoch number → ISO string; pass through existing strings. */
function toIso(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return value != null ? String(value) : "";
}

export function normalizeRestToken(raw: Record<string, unknown>): TokenEvent {
  const mint = String(raw.mint_address ?? raw.mint ?? raw.address ?? raw.token_address ?? "");
  return {
    mint_address:      mint,
    name:              String(raw.name     ?? ""),
    symbol:            String(raw.symbol   ?? ""),
    dex:               String(raw.dex ?? raw.platform ?? raw.exchange ?? ""),
    uri:               (raw.uri ?? null) as string | null,
    image:             imageSrc((raw.image ?? raw.imageUri ?? raw.image_url ?? raw.imageUrl ?? raw.logo ?? raw.logoUri ?? raw.logo_url ?? null) as string | null),
    chain:             typeof raw.chain === "string" ? raw.chain : undefined,
    website:           (raw.website  ?? null) as string | null,
    twitter:           (raw.twitter  ?? null) as string | null,
    telegram:          (raw.telegram ?? null) as string | null,
    created_at:        toIso(raw.created_at ?? raw.createdAt ?? raw.timestamp ?? raw.time ?? ""),
    migrated_at:       (raw.migrated_at ?? raw.migratedAt ?? raw.migrated ?? undefined) as string | undefined,
    // ⚠️ Numeric fields: toOptionalNumber, mai cast ciechi (vedi nota in
    // normalizeTokenEvent — upstream può mandare numerici come stringhe JSON).
    marketCap:         toOptionalNumber(raw.marketCap         ?? raw.market_cap),
    initialMarketCap:  toOptionalNumber(raw.initialMarketCap   ?? raw.initial_market_cap),
    // Trending alerts ship the latest trade's avg_price as `avgPrice`. Map it
    // to lastPrice so TokenRow's mcap fallback (priceSol * supply * solPrice)
    // shows the correct current marketcap on first render.
    lastPrice:         toOptionalNumber(raw.lastPrice ?? raw.last_price ?? raw.avgPrice ?? raw.avg_price),
    bundlePercentage:  toOptionalNumber(raw.bundlePercentage   ?? raw.bundle_percentage),
    sniperPercentage:  toOptionalNumber(raw.sniperPercentage   ?? raw.sniper_percentage),
    creatorDeploys:    toOptionalNumber(raw.creatorDeploys     ?? raw.creator_deploys),
    creatorMigrations: toOptionalNumber(raw.creatorMigrations  ?? raw.creator_migrations),
    creatorBuySol:     toOptionalNumber(raw.creatorBuySol   ?? raw.creator_buy_sol   ?? raw.devBuySol      ?? raw.dev_buy_sol),
    creatorBuyPrice:   toOptionalNumber(raw.creatorBuyPrice ?? raw.creator_buy_price ?? raw.devBuyAvgPrice ?? raw.dev_buy_avg_price ?? raw.devBuyPrice ?? raw.dev_buy_price),
    creatorBuyTokens:  toOptionalNumber(raw.creatorBuyTokens ?? raw.creator_buy_tokens ?? raw.devBuyTokens ?? raw.dev_buy_tokens),
    signer:            (raw.signer ?? raw.creator ?? undefined) as string | undefined,
    slot:              toOptionalNumber(raw.slot ?? raw.block_number),
    firstHourTrades:   toOptionalNumber(raw.firstHourTrades ?? raw.first_hour_trades),
    firstHourVolume:   toOptionalNumber(raw.firstHourVolume ?? raw.first_hour_volume),
    priceChange:       toOptionalNumber(raw.priceChange ?? raw.price_change ?? raw.change24h ?? raw.change_24h),
    volume24h:         toOptionalNumber(raw.volume24h ?? raw.volume_24h ?? raw.volume ?? raw.totalVolume),
    liquidity:         toOptionalNumber(raw.liquidity ?? raw.liquiditySol ?? raw.liquidity_sol),
    holders:           toOptionalNumber(raw.holders ?? raw.holderCount ?? raw.holder_count ?? raw.uniqueTraders ?? raw.unique_traders),
    hasCashback:       toOptionalBool(raw.hasCashback ?? raw.has_cashback ?? raw.isCashback ?? raw.is_cashback),
    quoteMint:         (raw.quoteMint ?? raw.quote_mint ?? undefined) as string | undefined,
    quoteKind:         (raw.quoteKind ?? raw.quote_kind ?? undefined) as string | undefined,
  };
}

