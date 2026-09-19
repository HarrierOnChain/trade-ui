"use client";
import { useEffect, useState, useCallback } from "react";
import { fetchWalletHoldings } from "../api/client";
import type { TokenHolding, WalletHoldingsSummary } from "../types";

export function useWalletHoldings(address: string | null) {
  const [holdings, setHoldings] = useState<TokenHolding[]>([]);
  const [summary, setSummary] = useState<WalletHoldingsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetchWalletHoldings(address);
      setHoldings(res.data ?? []);
      setSummary(res.summary ?? null);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (!address) {
      setHoldings([]);
      setSummary(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setHoldings([]);
    setSummary(null);
    load();
  }, [load, address]);

  return { holdings, summary, loading, error, refresh: load };
}
