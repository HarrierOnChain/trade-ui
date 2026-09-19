"use client";

import { useEffect, useState } from "react";
import {
  fetchPerpWalletPnl,
  fetchPerpWalletPositions,
  fetchPerpWalletTrades,
  type PerpPosition,
  type PerpMarketTrade,
} from "../api/client";

export type PerpScopePosition = PerpPosition & { wallet: string };
export type PerpScopeTrade = PerpMarketTrade & {
  market_id: string;
  venue: string;
  position_pubkey: string;
  wallet: string;
};

export interface PerpScopeTotals {
  netPnlUsd: number;
  volumeUsd: number;
  feesUsd: number;
  longSizeUsd: number;
  shortSizeUsd: number;
  marketsTraded: number;
  openPositionsCount: number;
  openNotionalUsd: number;
  unrealizedPnlUsd: number;
}

interface PerpScopeState {
  positions: PerpScopePosition[];
  trades: PerpScopeTrade[];
  totals: PerpScopeTotals;
  loading: boolean;
  error: string | null;
}

const e6 = (n: number) => n / 1_000_000;

const EMPTY_TOTALS: PerpScopeTotals = {
  netPnlUsd: 0,
  volumeUsd: 0,
  feesUsd: 0,
  longSizeUsd: 0,
  shortSizeUsd: 0,
  marketsTraded: 0,
  openPositionsCount: 0,
  openNotionalUsd: 0,
  unrealizedPnlUsd: 0,
};

const EMPTY_STATE: PerpScopeState = {
  positions: [],
  trades: [],
  totals: EMPTY_TOTALS,
  loading: false,
  error: null,
};

/**
 * Aggregates perp data across a set of wallets for the portfolio scope.
 * Mirrors `usePortfolioScope`'s shape but only for perps. PnL reflects
 * the upstream history crate's `perp-pnl` endpoint (today net_pnl_e6 is
 * effectively `-fees_paid_e6` until the parser fills gross_pnl).
 */
export function usePortfolioPerps(addresses: string[], refreshKey = 0) {
  const [state, setState] = useState<PerpScopeState>(EMPTY_STATE);

  // The hook key includes the sorted, joined address list so a same-set
  // re-render doesn't re-trigger the fetch.
  const key = [...addresses].sort().join(",");

  useEffect(() => {
    if (!addresses.length) {
      setState(EMPTY_STATE);
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    void (async () => {
      const results = await Promise.all(
        addresses.map(async (address) => {
          const r = await Promise.allSettled([
            fetchPerpWalletPositions(address),
            fetchPerpWalletTrades(address, 30),
            fetchPerpWalletPnl(address),
          ]);
          const positions =
            r[0].status === "fulfilled" && Array.isArray(r[0].value?.data)
              ? r[0].value.data
              : [];
          const trades =
            r[1].status === "fulfilled" && Array.isArray(r[1].value?.data)
              ? r[1].value.data
              : [];
          const pnl =
            r[2].status === "fulfilled" && Array.isArray(r[2].value?.data)
              ? r[2].value.data
              : [];
          return { address, positions, trades, pnl };
        }),
      );

      if (cancelled) return;

      const positions: PerpScopePosition[] = [];
      const trades: PerpScopeTrade[] = [];
      const totals: PerpScopeTotals = { ...EMPTY_TOTALS };
      const marketKeys = new Set<string>();
      let pnlRowsSeen = 0;

      for (const r of results) {
        for (const p of r.positions) {
          positions.push({ ...p, wallet: r.address });
          totals.openPositionsCount += 1;
          totals.openNotionalUsd += e6(p.size);
          totals.unrealizedPnlUsd += e6(p.unrealized_pnl);
        }
        for (const t of r.trades) {
          trades.push({ ...t, wallet: r.address });
        }
        for (const m of r.pnl) {
          pnlRowsSeen += 1;
          totals.netPnlUsd += e6(m.net_pnl_e6);
          totals.volumeUsd += e6(m.volume_usd_e6);
          totals.feesUsd += e6(m.fees_paid_e6);
          totals.longSizeUsd += e6(m.long_size);
          totals.shortSizeUsd += e6(m.short_size);
          marketKeys.add(`${m.venue}:${m.market_id}`);
        }
      }

      // Fallback: the upstream `_mv_perp_wallet_positions` MV can lag for
      // fresh wallets, returning an empty perp-pnl payload while
      // perp-trades / perp-positions still have data. When that happens
      // we derive the same totals from the recent trade fills so the
      // overview cards never read as empty when the wallet is active.
      if (pnlRowsSeen === 0 && trades.length > 0) {
        for (const t of trades) {
          totals.volumeUsd += e6(t.size);
          totals.feesUsd += e6(t.fee);
          if (t.side === "long") totals.longSizeUsd += e6(t.size);
          else totals.shortSizeUsd += e6(t.size);
          marketKeys.add(`${t.venue}:${t.market_id}`);
        }
        // Mirrors upstream net_pnl semantic: until the parser produces
        // realized PnL, net_pnl == −fees_paid.
        totals.netPnlUsd = -totals.feesUsd;
      }

      totals.marketsTraded = marketKeys.size;

      positions.sort((a, b) => b.size - a.size);
      trades.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

      setState({
        positions,
        trades,
        totals,
        loading: false,
        error: null,
      });
    })().catch((err) => {
      if (cancelled) return;
      setState({
        ...EMPTY_STATE,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey]);

  return state;
}
