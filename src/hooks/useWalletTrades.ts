"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { fetchWalletTrades } from "../api/client";
import { tradeKeyAcrossTokens } from "../lib/trades";
import type { Trade } from "../types";

const CAP = 500; // soft cap, as the token tape's infinite scroll

function append(prev: Trade[], more: Trade[]): Trade[] {
  const seen = new Set(prev.map(tradeKeyAcrossTokens));
  const out = [...prev];
  for (const t of more) {
    const key = tradeKeyAcrossTokens(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.slice(0, CAP);
}

/** A wallet's swaps, paged by the API's `next` cursor. */
export function useWalletTrades(address: string | null, limit = 50) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A failed next page: auto-paging stops until the caller retries.
  const [moreError, setMoreError] = useState<string | null>(null);
  // Drops answers that land after the address changed or a refresh started.
  const genRef = useRef(0);

  const load = useCallback(async () => {
    if (!address) return;
    const gen = ++genRef.current;
    setLoadingMore(false);
    setMoreError(null);
    try {
      const res = await fetchWalletTrades(address, limit);
      if (gen !== genRef.current) return;
      setTrades(append([], res.data));
      setCursor(res.nextCursor ?? null);
      setError(null);
    } catch (e) {
      if (gen !== genRef.current) return;
      setError(String(e));
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [address, limit]);

  const loadMore = useCallback(async () => {
    if (!address || loading || loadingMore || !cursor) return;
    const gen = genRef.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await fetchWalletTrades(address, limit, cursor);
      if (gen !== genRef.current) return;
      setTrades((prev) => append(prev, res.data));
      setCursor(res.nextCursor ?? null);
    } catch (e) {
      // The cursor is kept, so a retry asks for the same page.
      if (gen === genRef.current) setMoreError(String(e));
    } finally {
      if (gen === genRef.current) setLoadingMore(false);
    }
  }, [address, limit, cursor, loading, loadingMore]);

  useEffect(() => {
    setCursor(null);
    setError(null);
    if (!address) {
      ++genRef.current;
      setTrades([]);
      setLoading(false);
      setLoadingMore(false);
      setMoreError(null);
      return;
    }
    setLoading(true);
    setTrades([]);
    load();
  }, [load, address]);

  const hasMore = !!cursor && trades.length < CAP;
  return { trades, loading, loadingMore, hasMore, error, moreError, loadMore, refresh: load };
}
