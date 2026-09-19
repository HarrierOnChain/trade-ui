"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPnlLeaderboard, fetchPnlSummary } from "../api/client";
import type {
  LeaderboardPeriod,
  PnlLeaderboardWallet,
  PnlSummaryResponse,
} from "../types";
import { useClientPageVisible } from "../contexts/ClientPageVisibility";

export type LeaderboardPlatform = "all" | "pumpfun" | "bonk" | "raydium";

export interface ChainLeaderboardEntry extends PnlLeaderboardWallet {
  rank: number;
}

const DEFAULT_LIMIT = 50;

function normalizeWallets(raw: unknown): PnlLeaderboardWallet[] {
  if (!raw || typeof raw !== "object") return [];
  const wallets = (raw as { wallets?: unknown }).wallets;
  if (!Array.isArray(wallets)) return [];
  return wallets
    .map((w) => {
      if (!w || typeof w !== "object") return null;
      const row = w as Record<string, unknown>;
      const signer = String(row.signer ?? "");
      if (!signer) return null;
      return {
        signer,
        pnlSol: Number(row.pnlSol ?? row.pnl_sol ?? 0),
        pnlUsd: Number(row.pnlUsd ?? row.pnl_usd ?? 0),
        trades: Number(row.trades ?? 0),
      };
    })
    .filter((w): w is PnlLeaderboardWallet => w != null);
}

export function useChainLeaderboard(
  period: LeaderboardPeriod,
  platform: LeaderboardPlatform,
  limit = DEFAULT_LIMIT,
) {
  const visible = useClientPageVisible();
  const [wallets, setWallets] = useState<PnlLeaderboardWallet[]>([]);
  const [stats, setStats] = useState<PnlSummaryResponse | null>(null);
  const [solPriceUsd, setSolPriceUsd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const platformParam = platform === "all" ? undefined : platform;
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!visible) {
      setWallets([]);
      setStats(null);
      setLoading(false);
      setStatsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setStatsLoading(true);
    setError(null);
    setStats(null);

    void (async () => {
      try {
        // Table first — summary uses the same heavy ClickHouse scan; firing both
        // in parallel on cold cache doubles wall time (~10s → ~5s for weekly).
        const lb = await fetchPnlLeaderboard({ period, platform: platformParam, limit });
        if (cancelled) return;

        if (!lb.success) {
          throw new Error(lb.error ?? "Failed to load leaderboard");
        }

        setWallets(normalizeWallets(lb));
        setSolPriceUsd(lb.solPriceUsd ?? 0);
        if (!cancelled) setLoading(false);

        try {
          const summary = await fetchPnlSummary({ period, platform: platformParam });
          if (cancelled) return;
          if (summary.success) setStats(summary);
        } catch {
          /* KPI tiles are optional — table already shown */
        }
      } catch (err) {
        if (cancelled) return;
        setWallets([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setStatsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, period, platformParam, limit, refreshKey]);

  const entries: ChainLeaderboardEntry[] = useMemo(
    () => wallets.map((w, i) => ({ ...w, rank: i + 1 })),
    [wallets],
  );

  return {
    entries,
    stats,
    solPriceUsd,
    loading,
    statsLoading,
    error,
    refresh,
    solanaOnly: false,
  };
}
