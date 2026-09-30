"use client";
import { useEffect, useRef, useState } from "react";
import { fetchTrending } from "../api/client";
import { normalizeRestToken, toArray } from "../api/normalize";
import { useChain } from "../contexts/ChainContext";
import { platformAllowed } from "../lib/tokenFilters";
import { mergeLiveFrame } from "../lib/streamMerge";
import { useTokenEnrichment } from "./useTokenEnrichment";
import type { TokenEvent, TrendingPeriod, TrendingToken } from "../types";

const MAX = 20;
/**
 * Trending has no live channel on the API (the old `discovery` stream is
 * gone), so the ranking is re-read on this interval — the one REST refresh
 * that is not priming a stream. Prices on the rows still tick live through
 * useLiveTradePrices.
 */
const REFRESH_MS = 30_000;

function alertRestToToken(t: TrendingToken): TokenEvent {
  return normalizeRestToken(t as unknown as Record<string, unknown>);
}

export function useAlertStream(platform?: string, period: TrendingPeriod = "recent") {
  const { chainId } = useChain();
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrichKey, setEnrichKey] = useState(0);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    seenRef.current = new Set();

    const load = (initial: boolean) => {
      fetchTrending(period, MAX)
        .then((res) => {
          if (cancelled) return;
          const seen = new Set<string>();
          const list = toArray<TrendingToken>(res)
            .map(alertRestToToken)
            .filter((t) => {
              if (!t.mint_address || seen.has(t.mint_address)) return false;
              if (!platformAllowed(t.dex, platform)) return false;
              seen.add(t.mint_address);
              return true;
            });
          const fresh = list.some((t) => !seenRef.current.has(t.mint_address));
          setTokens((prev) => {
            // Keep enriched fields and row identity across refreshes; the
            // server's order is the ranking.
            const byMint = new Map(prev.map((t) => [t.mint_address, t]));
            return list.map((t) => {
              const old = byMint.get(t.mint_address);
              if (old) return mergeLiveFrame(old, t);
              return initial ? t : { ...t, isNew: true };
            });
          });
          list.forEach((t) => seenRef.current.add(t.mint_address));
          if (fresh) setEnrichKey((k) => k + 1);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled && initial) setLoading(false); });
    };

    load(true);
    const id = setInterval(() => load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [platform, period, chainId]);

  useTokenEnrichment(tokens, setTokens, 20, enrichKey);

  return { tokens, loading };
}
