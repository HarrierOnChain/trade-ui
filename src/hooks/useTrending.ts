"use client";
import { useEffect, useState, useCallback } from "react";
import { fetchTrending } from "../api/client";
import { fetchPublicMetadata } from "../api/metadata";
import { toArray } from "../api/normalize";
import type { TrendingToken, TrendingPeriod } from "../types";

const POLL_INTERVAL = 30_000;

function enrichTrending(
  tokens: TrendingToken[],
  setTokens: React.Dispatch<React.SetStateAction<TrendingToken[]>>
) {
  tokens.forEach((token) => {
    const missing = !token.name || !token.symbol || !token.image || !token.twitter || !token.website;
    if (!missing) return;
    fetchPublicMetadata(token.mint).then((meta) => {
      const hasData = meta.name || meta.symbol || meta.image || meta.twitter || meta.telegram || meta.website;
      if (!hasData) return;
      setTokens((prev) =>
        prev.map((t) => (t.mint === token.mint ? { ...t, ...meta } : t))
      );
    });
  });
}

export function useTrending(period: TrendingPeriod = "daily", limit = 50) {
  const [tokens, setTokens] = useState<TrendingToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchTrending(period, limit);
      const seen = new Set<string>();
      const list = toArray<TrendingToken>(res).filter((t) => {
        if (seen.has(t.mint)) return false;
        seen.add(t.mint);
        return true;
      });
      setTokens(list);
      enrichTrending(list, setTokens);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [period, limit]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [load]);

  return { tokens, loading, error, refresh: load };
}
