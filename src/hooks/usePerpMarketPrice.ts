"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPerpMarketTrades } from "../api/client";
import { RazeWebSocket } from "../api/websocket";

export const SOL_PERP_MARKET_ID = "jup:SOL-PERP";
export const BTC_PERP_MARKET_ID = "jup:BTC-PERP";
export const ETH_PERP_MARKET_ID = "jup:ETH-PERP";

export function usePerpMarketPrice(marketId: string | null | undefined) {
  const [price, setPrice] = useState<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
      flashTimer.current = null;
    }
    setPrice(null);
    setFlash(null);

    if (!marketId) return;

    let cancelled = false;

    fetchPerpMarketTrades(marketId, 1)
      .then((r) => {
        if (cancelled) return;
        const px = Number(r.data?.[0]?.price ?? 0);
        if (px > 0) setPrice((prev) => prev ?? px / 1_000_000);
      })
      .catch(() => {});

    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeMarkets([marketId]);
    const off = ws.on("perp_fill", (msg) => {
      const market = (msg.market_id as string) ?? "";
      if (market !== marketId) return;

      const data = msg.data as Record<string, unknown> | undefined;
      const priceE6 = Number(data?.price ?? 0);
      if (!priceE6) return;

      const next = priceE6 / 1_000_000;
      setPrice((prev) => {
        if (prev != null) {
          if (next > prev) setFlash("up");
          else if (next < prev) setFlash("down");

          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => {
            flashTimer.current = null;
            setFlash(null);
          }, 700);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
      off();
      ws.unsubscribeMarkets([marketId]);
      if (flashTimer.current) {
        clearTimeout(flashTimer.current);
        flashTimer.current = null;
      }
    };
  }, [marketId]);

  return { price, flash };
}

export interface LivePerpPrice {
  /** Last-trade price in plain USD. */
  price: number;
  /** Tick direction vs the previous fill — clears 700ms after the last move. */
  flash: "up" | "down" | null;
}

/**
 * Live last-trade price for MANY perp markets at once, fed by the `perp_fill`
 * stream. Drives the market-selector dropdown so every pair shows a ticking
 * price. Only subscribes while `active` (i.e. the dropdown is open) so we
 * don't hold ~50 market subscriptions on the wire when it's closed; prices
 * persist across open/close so reopening is instant. Prices are keyed by the
 * wire `market_id` (`venue:asset`) so callers can index with `m.market_id`.
 */
export function useAllPerpLivePrices(
  marketIds: string[],
  active: boolean,
): Record<string, LivePerpPrice> {
  const [prices, setPrices] = useState<Record<string, LivePerpPrice>>({});
  // Mirror so the seed pass can read current prices without re-running on
  // every tick.
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Stable subscription key so we don't tear down + replay when the array
  // identity changes but the contents don't.
  const key = useMemo(() => [...new Set(marketIds)].sort().join(","), [marketIds]);

  useEffect(() => {
    if (!active || !key) return;
    const ids = key.split(",");
    let cancelled = false;
    const timers = flashTimers.current;

    const apply = (id: string, next: number) => {
      if (!(next > 0)) return;
      setPrices((prev) => {
        const cur = prev[id];
        let flash: "up" | "down" | null = null;
        if (cur && cur.price > 0) {
          if (next > cur.price) flash = "up";
          else if (next < cur.price) flash = "down";
        }
        if (flash) {
          const t = timers.get(id);
          if (t) clearTimeout(t);
          timers.set(id, setTimeout(() => {
            timers.delete(id);
            setPrices((p) => (p[id] ? { ...p, [id]: { ...p[id], flash: null } } : p));
          }, 700));
        }
        return { ...prev, [id]: { price: next, flash } };
      });
    };

    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeMarkets(ids);
    const off = ws.on("perp_fill", (msg) => {
      const id = (msg.market_id as string) ?? "";
      if (!id) return;
      const data = msg.data as Record<string, unknown> | undefined;
      apply(id, Number(data?.price ?? 0) / 1_000_000);
    });

    // One-shot seed of the last-trade price for markets we don't have yet, so
    // thin pairs aren't blank until their next fill lands.
    for (const id of ids) {
      if (pricesRef.current[id]) continue;
      fetchPerpMarketTrades(id, 1)
        .then((r) => {
          if (cancelled) return;
          const px = Number(r.data?.[0]?.price ?? 0) / 1_000_000;
          if (px > 0) {
            setPrices((prev) => (prev[id] ? prev : { ...prev, [id]: { price: px, flash: null } }));
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      off();
      ws.unsubscribeMarkets(ids);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [active, key]);

  return prices;
}
