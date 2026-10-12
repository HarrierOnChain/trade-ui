import type { LivePrice } from "../hooks/useLiveTradePrices";
import type { TokenEvent } from "../types";

export interface TokenMetrics {
  bundlePct: number;
  sniperPct: number;
  /** The API's holder count; null when not measured. */
  holders: number | null;
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
  // The API's count, refreshed by board updates and token snapshots: a
  // trader is not a holder, so the live traders are not added.
  const holders = token.holders ?? null;
  return {
    bundlePct,
    sniperPct,
    holders,
    top10Pct: opts?.top10Pct ?? 0,
    devHoldPct: opts?.devHoldPct ?? null,
  };
}
