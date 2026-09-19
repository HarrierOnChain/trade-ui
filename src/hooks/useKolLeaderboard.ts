"use client";

import { useCallback, useEffect, useState } from "react";
import { useBackend } from "../api/backend";
import type { KolLeaderboardEntry } from "../api/backend";
import type { LeaderboardPeriod } from "../types";
import { useClientPageVisible } from "../contexts/ClientPageVisibility";

export function useKolLeaderboard(period: LeaderboardPeriod | null) {
  const visible = useClientPageVisible();
  const client = useBackend();
  const [entries, setEntries] = useState<KolLeaderboardEntry[]>([]);
  const [solPriceUsd, setSolPriceUsd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (period === null || !visible) {
      setEntries([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await client.kolsLeaderboard(period as LeaderboardPeriod);
        if (cancelled) return;
        setEntries(res.kols ?? []);
        setSolPriceUsd(res.solPriceUsd ?? 0);
      } catch (err) {
        if (cancelled) return;
        setEntries([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, period, client, refreshKey]);

  return { entries, solPriceUsd, loading, error, refresh, solanaOnly: false };
}
