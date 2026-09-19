"use client";
import { useEffect, useRef, useState } from "react";
import { fetchOhlc, fetchTokenSupply } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import type { CandleData, Timeframe, Trade } from "../types";
import { TIMEFRAME_SECONDS } from "../types";

function timeframeToMs(tf: Timeframe): number {
  return TIMEFRAME_SECONDS[tf] * 1000;
}

/**
 * Fetches OHLCV candles from /api/sol/tokens/ohlc.
 * When solPrice is provided, also fetches supply and converts raw SOL-per-token
 * prices to USD market cap (same multiplier as SolanaDatafeed in usd+mcap mode).
 */
export function useTokenCandles(
  mint: string | null,
  timeframe: Timeframe = "1m",
  solPrice?: number,
) {
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [loading, setLoading] = useState(false);
  const tfMs = timeframeToMs(timeframe);
  // Keep multiplier in a ref so live WS updates use the same scale
  const multiplierRef = useRef<number>(1);

  useEffect(() => {
    if (!mint) { setCandles([]); return; }
    setLoading(true);
    setCandles([]);

    const run = async () => {
      // Fetch OHLC + supply in parallel when we need mcap conversion
      const [res, supplyRes] = await Promise.all([
        fetchOhlc(mint, timeframe, 100),
        solPrice ? fetchTokenSupply(mint).catch(() => null) : Promise.resolve(null),
      ]);

      const supply = supplyRes?.supply ?? 0;
      const m = solPrice && supply ? solPrice * supply : 1;
      multiplierRef.current = m;

      // Solana returns { data:[...] }.
      const items = (res?.data ?? []) as unknown as Array<Record<string, unknown>>;
      const parsed: CandleData[] = items
        .map((c) => {
          const tsMs = typeof c.timestamp === "string"
            ? Date.parse(c.timestamp)
            : Number(c.timestamp) > 1e10
              ? Number(c.timestamp)
              : Number(c.timestamp) * 1000;
          return {
            time: Math.floor(tsMs / 1000),
            open:   parseFloat(String(c.open))   * m,
            high:   parseFloat(String(c.high))   * m,
            low:    parseFloat(String(c.low))    * m,
            close:  parseFloat(String(c.close))  * m,
            volume: parseFloat(String(c.volume ?? 0)),
          };
        })
        .filter((c) => isFinite(c.time) && isFinite(c.open))
        .sort((a, b) => a.time - b.time);

      for (let i = 1; i < parsed.length; i++) {
        parsed[i]!.open = parsed[i - 1]!.close;
      }

      setCandles(parsed);
    };

    run().catch(() => setCandles([])).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, timeframe, solPrice]);

  // Live trade updates — Solana WS feed.
  useEffect(() => {
    if (!mint) return;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeToken(mint);

    const tfSec = tfMs / 1000;

    const unsub = ws.on("trade", (msg) => {
      if ((msg.tokenMint as string) !== mint) return;
      const trade = msg as unknown as Trade;
      const rawPrice = (trade as Trade & { avgPrice?: number }).avgPrice ?? 0;
      if (!rawPrice) return;

      const price = rawPrice * multiplierRef.current;

      const rawTs = trade.timestamp;
      const tsMs = typeof rawTs === "string"
        ? Date.parse(rawTs)
        : Number(rawTs) > 1e10 ? Number(rawTs) : Number(rawTs) * 1000;
      const tsSec = Math.floor(tsMs / 1000);
      const bucketSec = Math.floor(tsSec / tfSec) * tfSec;
      const vol = (trade as Trade & { solAmount?: number }).solAmount ?? 0;

      setCandles((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.time === bucketSec) {
          return [...prev.slice(0, -1), {
            ...last,
            high: Math.max(last.high, price),
            low: Math.min(last.low, price),
            close: price,
            volume: last.volume + vol,
          }];
        }
        return [...prev, { time: bucketSec, open: price, high: price, low: price, close: price, volume: vol }];
      });
    });

    return () => {
      unsub();
      ws.unsubscribeToken(mint);
    };
  }, [mint, tfMs]);

  return { candles, loading };
}
