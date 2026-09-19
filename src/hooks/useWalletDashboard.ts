"use client";

import { useEffect, useState } from "react";
import {
  fetchWalletHoldings,
  fetchWalletPnl,
  fetchWalletPnlHistory,
  fetchWalletPerformance,
  fetchWalletTokenBreakdown,
  fetchWalletTrades,
} from "../api/client";
import { toArray } from "../api/normalize";
import type {
  TokenHolding,
  Trade,
  WalletFifoPnlResponse,
  WalletPerformanceDataPoint,
  WalletPnlHistoryPoint,
  WalletTokenBreakdown,
} from "../types";

interface WalletDashboardWindow {
  from: number;
  to: number;
  resolution: "1h" | "1d";
}

interface WalletDashboardState {
  holdings: TokenHolding[];
  trades: Trade[];
  tokenBreakdown: WalletTokenBreakdown[];
  pnl: WalletFifoPnlResponse | null;
  performance: WalletPerformanceDataPoint[];
  pnlHistory: WalletPnlHistoryPoint[];
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: WalletDashboardState = {
  holdings: [],
  trades: [],
  tokenBreakdown: [],
  pnl: null,
  performance: [],
  pnlHistory: [],
  loading: false,
  error: null,
};

export function useWalletDashboard(
  address: string | null,
  window: WalletDashboardWindow,
  refreshKey = 0,
) {
  const [state, setState] = useState<WalletDashboardState>(EMPTY_STATE);

  useEffect(() => {
    if (!address) {
      setState(EMPTY_STATE);
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    void (async () => {
      const results = await Promise.allSettled([
        fetchWalletHoldings(address),
        fetchWalletTrades(address, 30),
        fetchWalletTokenBreakdown(address, { limit: 100, sort: "recent" }),
        fetchWalletPnl(address),
        fetchWalletPerformance(address, {
          from: window.from,
          to: window.to,
          resolution: window.resolution,
        }),
        fetchWalletPnlHistory(address, {
          from: window.from,
          to: window.to,
          resolution: window.resolution,
        }),
      ]);

      if (cancelled) return;

      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => String(result.reason));

      setState({
        holdings:
          results[0].status === "fulfilled"
            ? results[0].value.data ?? []
            : [],
        trades:
          results[1].status === "fulfilled"
            ? toArray<Trade>(results[1].value)
            : [],
        tokenBreakdown:
          results[2].status === "fulfilled"
            ? results[2].value.data ?? []
            : [],
        pnl:
          results[3].status === "fulfilled"
            ? results[3].value
            : null,
        performance:
          results[4].status === "fulfilled"
            ? results[4].value.data ?? []
            : [],
        pnlHistory:
          results[5].status === "fulfilled"
            ? results[5].value.data ?? []
            : [],
        loading: false,
        error: failures.length ? failures.join(" · ") : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [address, window.from, window.to, window.resolution, refreshKey]);

  return state;
}
