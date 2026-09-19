"use client";
import { useEffect, useState, useCallback } from "react";
import { fetchWalletTrades } from "../api/client";
import { toArray } from "../api/normalize";
import type { Trade } from "../types";

export function useWalletTrades(address: string | null, limit = 50) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetchWalletTrades(address, limit);
      setTrades(toArray<Trade>(res));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [address, limit]);

  useEffect(() => {
    if (!address) {
      setTrades([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setTrades([]);
    load();
  }, [load, address]);

  return { trades, loading, error, refresh: load };
}
