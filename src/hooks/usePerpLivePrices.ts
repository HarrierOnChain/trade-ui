"use client";

import { useEffect, useState } from "react";
import { fetchPerpCandles } from "../api/client";

const POLL_MS = 5_000;

/**
 * Polls the most recent candle close for each market_id and returns a
 * map of market_id → current price (USD). `perp_ohlcv_*` stores plain
 * Float64 USD, so the candle close is the value we need without scale
 * adjustment. Keys mirror the wire `market_id` (`venue:asset`) so the
 * caller can index directly with `position.market_id`.
 */
export function usePerpLivePrices(marketIds: string[]) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Stable key so we don't refetch on every render when the array
  // identity changes but the contents don't.
  const key = [...new Set(marketIds)].sort().join(",");

  useEffect(() => {
    if (!key) {
      setPrices({});
      return;
    }
    const ids = key.split(",");
    let cancelled = false;

    const tick = async () => {
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const res = await fetchPerpCandles(id, "1s", 1);
          const last = res?.data?.[res.data.length - 1];
          return { id, price: last?.close ?? null };
        }),
      );
      if (cancelled) return;
      setPrices((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.status !== "fulfilled" || r.value.price == null) continue;
          next[r.value.id] = r.value.price;
        }
        return next;
      });
    };

    void tick();
    const handle = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [key]);

  return prices;
}

/**
 * Recomputes uPnL in USD from a snapshot position against a live price.
 * `sizeUsd` and `entryPriceUsd` are the e6-decoded values; `currentPrice`
 * is whatever `usePerpLivePrices` returned (already plain USD). Returns
 * the snapshot fallback when no live price is available.
 */
export function liveUnrealizedPnl(
  side: "long" | "short",
  sizeUsd: number,
  entryPriceUsd: number,
  currentPrice: number | undefined,
  snapshotPnl: number,
): number {
  if (!currentPrice || !entryPriceUsd) return snapshotPnl;
  const ratio = currentPrice / entryPriceUsd;
  const dir = side === "long" ? 1 : -1;
  return sizeUsd * (ratio - 1) * dir;
}
