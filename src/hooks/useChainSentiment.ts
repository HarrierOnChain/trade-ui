"use client";
import { useEffect, useState } from "react";
import { RazeWebSocket } from "../api/websocket";
import { num } from "../api/mappers";
import { useChain } from "../contexts/ChainContext";
import type { ChainSentiment } from "../types";

const INTERVAL = "1h";
const SORT = "trades";

/**
 * The buy pressure of the active chain: the `trending` channel's summary of
 * the hour's ranking by trades (its top 100), sent at every read of the
 * ranking (limit 0: the summary only). Null until the first summary, and when
 * the API measured no buy share.
 */
export function useChainSentiment(): ChainSentiment | null {
  const { chainId } = useChain();
  const [sentiment, setSentiment] = useState<ChainSentiment | null>(null);

  useEffect(() => {
    setSentiment(null);
    const ws = RazeWebSocket.getInstance();
    ws.subscribeTrending(chainId, INTERVAL, 0, SORT);
    const off = ws.on("trending_summary", (msg) => {
      if (msg.chain !== chainId || msg.interval !== INTERVAL || msg.sort !== SORT) return;
      const s = (msg.summary ?? {}) as Record<string, unknown>;
      const buys = num(s.buysPercent);
      setSentiment(buys == null ? null : {
        score: Math.round(buys),
        buyRatio: buys / 100,
        trades: num(s.trades) ?? 0,
      });
    });
    return () => {
      off();
      ws.unsubscribeTrending(chainId, INTERVAL, 0, SORT);
    };
  }, [chainId]);

  return sentiment;
}
