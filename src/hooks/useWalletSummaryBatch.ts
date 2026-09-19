"use client";

import { useEffect, useState } from "react";
import { fetchWalletSummary } from "../api/client";
import { normalizeWalletSummaryItems } from "../api/normalize";
import type { WalletSummaryItem, WalletSummaryResponse } from "../types";

interface WalletSummaryWindow {
  from?: number;
  to?: number;
}

interface WalletSummaryMeta {
  solPriceUsd?: number;
  from?: string | null;
  to?: string | null;
  timestamp?: string;
}

export function useWalletSummaryBatch(
  addresses: string[],
  window: WalletSummaryWindow,
  refreshKey = 0,
) {
  const [summaries, setSummaries] = useState<WalletSummaryItem[]>([]);
  const [meta, setMeta] = useState<WalletSummaryMeta>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!addresses.length) {
      setSummaries([]);
      setMeta({});
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetchWalletSummary(addresses, window);
        if (cancelled) return;

        const typed = res as WalletSummaryResponse;
        setSummaries(normalizeWalletSummaryItems(typed));
        setMeta({
          solPriceUsd: typed.solPriceUsd,
          from: typed.from,
          to: typed.to,
          timestamp: typed.timestamp,
        });
      } catch (err) {
        if (cancelled) return;
        setSummaries([]);
        setMeta({});
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [addresses.join(","), window.from, window.to, refreshKey]);

  return { summaries, meta, loading, error };
}
