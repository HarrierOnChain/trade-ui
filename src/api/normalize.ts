import type {
  TokenHolding,
  WalletHoldingsResponse,
  WalletPnlHistoryPoint,
  WalletPnlHistoryResponse,
  WalletSummaryItem,
} from "../types";

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
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
