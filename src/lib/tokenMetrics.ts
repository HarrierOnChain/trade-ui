import type { LivePrice } from "../hooks/useLiveTradePrices";
import type { TokenEvent } from "../types";

export interface TokenMetrics {
  bundlePct: number;
  sniperPct: number;
  holders: number;
  top10Pct: number;
  devHoldPct: number | null;
}

/** Live-merged token stats shared by TokenHeader and the trading sidebar. */
export function computeTokenMetrics(
  token: TokenEvent,
  live?: LivePrice,
  opts?: { top10Pct?: number; devHoldPct?: number | null },
): TokenMetrics {
  const bundlePct = Math.max(
    0,
    Math.min(100, (token.bundlePercentage ?? 0) + (live?.bundleAdd ?? 0)),
  );
  const sniperPct = Math.max(
    0,
    Math.min(100, (token.sniperPercentage ?? 0) + (live?.sniperAdd ?? 0)),
  );
  const holders = (token.holders ?? 0) + (live?.uniqueTraders ?? 0);
  return {
    bundlePct,
    sniperPct,
    holders,
    top10Pct: opts?.top10Pct ?? 0,
    devHoldPct: opts?.devHoldPct ?? null,
  };
}

/** Pump.fun system PDAs — must not count toward holder concentration. */
const SYSTEM_ACCOUNT_PREFIX = "BwWK17cb";

export function isHolderExcludedFromConcentration(h: {
  address?: string;
  isLiquidityPool?: boolean;
  isSystemAccount?: boolean;
}): boolean {
  if (h.isLiquidityPool || h.isSystemAccount) return true;
  const addr = h.address ?? "";
  return addr.startsWith(SYSTEM_ACCOUNT_PREFIX);
}

/**
 * Combined % of supply held by top-10 non-LP wallets (capped at 100).
 * Prefer amount/supply when both are known; otherwise sum precomputed %.
 */
export function top10HoldPct(
  holders: Array<{
    percentage?: number;
    amount?: number;
    address?: string;
    isLiquidityPool?: boolean;
    isSystemAccount?: boolean;
  }>,
  supply?: number,
): number {
  const eligible = holders.filter((h) => !isHolderExcludedFromConcentration(h));
  const top10 = eligible.slice(0, 10);
  if (top10.length === 0) return 0;

  const useAmounts =
    supply != null && supply > 0 && top10.some((h) => (h.amount ?? 0) > 0);

  const sum = useAmounts
    ? top10.reduce((s, h) => s + ((h.amount ?? 0) / supply!) * 100, 0)
    : top10.reduce((s, h) => s + (h.percentage ?? 0), 0);

  return Math.min(100, Math.max(0, sum));
}

export function devHoldPct(
  holders: Array<{ address: string; percentage?: number }>,
  devAddress?: string | null,
): number | null {
  if (!devAddress) return null;
  const row = holders.find((h) => h.address === devAddress);
  return row?.percentage ?? null;
}
