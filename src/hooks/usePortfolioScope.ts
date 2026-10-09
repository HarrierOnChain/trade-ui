"use client";

import { useEffect, useState } from "react";
import { fetchWalletHoldings, fetchWalletTrades } from "../api/client";
import { toArray } from "../api/normalize";
import { dedupeTrades } from "../lib/trades";
import type { TokenHolding, Trade } from "../types";

interface PortfolioScopeState {
  /** Token holdings summed across the wallets (native coin excluded). */
  holdings: TokenHolding[];
  /** The wallets' recent swaps, newest first. */
  trades: Trade[];
  loading: boolean;
}

const EMPTY_STATE: PortfolioScopeState = { holdings: [], trades: [], loading: false };

function toMs(value?: string | number | null) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeHolding(map: Map<string, TokenHolding>, holding: TokenHolding) {
  const existing = map.get(holding.mint);
  if (!existing) {
    map.set(holding.mint, { ...holding });
    return;
  }
  existing.amount += holding.amount;
  existing.usdValue = (existing.usdValue ?? 0) + (holding.usdValue ?? 0);
  existing.hasBalance = existing.hasBalance || holding.hasBalance;
  existing.symbol = existing.symbol || holding.symbol;
  existing.name = existing.name || holding.name;
  existing.image = existing.image || holding.image;
}

/** Holdings and recent trades of a set of wallets, merged. */
export function usePortfolioScope(addresses: string[]) {
  const [state, setState] = useState<PortfolioScopeState>(EMPTY_STATE);

  useEffect(() => {
    if (!addresses.length) {
      setState(EMPTY_STATE);
      return;
    }

    let cancelled = false;
    setState({ ...EMPTY_STATE, loading: true });

    void (async () => {
      const results = await Promise.all(
        addresses.map(async (address) => {
          const [holdings, trades] = await Promise.allSettled([
            fetchWalletHoldings(address),
            fetchWalletTrades(address, 30),
          ]);
          return {
            holdings: holdings.status === "fulfilled" ? holdings.value.data ?? [] : [],
            trades: trades.status === "fulfilled"
              ? toArray<Trade>(trades.value).map((trade) => ({ ...trade, signer: trade.signer || address }))
              : [],
          };
        }),
      );
      if (cancelled) return;

      const holdingsMap = new Map<string, TokenHolding>();
      const trades: Trade[] = [];
      for (const result of results) {
        for (const holding of result.holdings) {
          if (!holding.isNative) mergeHolding(holdingsMap, holding);
        }
        trades.push(...result.trades);
      }

      setState({
        holdings: [...holdingsMap.values()].sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0)),
        trades: dedupeTrades(trades).sort((a, b) => (toMs(b.timestamp) ?? 0) - (toMs(a.timestamp) ?? 0)),
        loading: false,
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses.join(",")]);

  return state;
}
