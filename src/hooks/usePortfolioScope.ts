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
import { dedupeTrades } from "../lib/trades";
import type {
  FifoTokenPnl,
  TokenHolding,
  Trade,
  WalletFifoPnlResponse,
  WalletPnlHistoryPoint,
  WalletPerformanceDataPoint,
  WalletTokenBreakdown,
} from "../types";

interface PortfolioScopeWindow {
  from: number;
  to: number;
  resolution: "1h" | "1d";
}

export interface WalletScopeSnapshot {
  address: string;
  holdingsValueUsd: number;
  holdingsCount: number;
  nativeSol: number;
  recentTradeAt?: string | null;
  recentTrades: number;
}

interface PortfolioScopeState {
  holdings: TokenHolding[];
  holdingWalletCounts: Record<string, number>;
  trades: Trade[];
  tokenBreakdown: WalletTokenBreakdown[];
  tokenWalletCounts: Record<string, number>;
  pnl: WalletFifoPnlResponse | null;
  performance: WalletPerformanceDataPoint[];
  pnlHistory: WalletPnlHistoryPoint[];
  walletSnapshots: WalletScopeSnapshot[];
  loading: boolean;
  historyLoading: boolean;
  error: string | null;
}

const EMPTY_STATE: PortfolioScopeState = {
  holdings: [],
  holdingWalletCounts: {},
  trades: [],
  tokenBreakdown: [],
  tokenWalletCounts: {},
  pnl: null,
  performance: [],
  pnlHistory: [],
  walletSnapshots: [],
  loading: false,
  historyLoading: false,
  error: null,
};

function toMs(value?: string | number | null) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function earlier(left?: string | null, right?: string | null) {
  const leftMs = toMs(left);
  const rightMs = toMs(right);
  if (leftMs == null) return right ?? null;
  if (rightMs == null) return left ?? null;
  return leftMs <= rightMs ? left ?? null : right ?? null;
}

function later(left?: string | null, right?: string | null) {
  const leftMs = toMs(left);
  const rightMs = toMs(right);
  if (leftMs == null) return right ?? null;
  if (rightMs == null) return left ?? null;
  return leftMs >= rightMs ? left ?? null : right ?? null;
}

function mergeHolding(
  map: Map<string, TokenHolding>,
  counts: Record<string, number>,
  holding: TokenHolding,
) {
  const existing = map.get(holding.mint);
  if (!existing) {
    map.set(holding.mint, { ...holding });
    counts[holding.mint] = (counts[holding.mint] ?? 0) + 1;
    return;
  }

  existing.amount += holding.amount;
  existing.usdValue = (existing.usdValue ?? 0) + (holding.usdValue ?? 0);
  existing.hasBalance = existing.hasBalance || holding.hasBalance;
  existing.isNative = existing.isNative || holding.isNative;
  existing.symbol = existing.symbol || holding.symbol;
  existing.name = existing.name || holding.name;
  existing.image = existing.image || holding.image;
  counts[holding.mint] = (counts[holding.mint] ?? 0) + 1;
}

function mergeTokenBreakdown(
  map: Map<string, WalletTokenBreakdown>,
  counts: Record<string, number>,
  token: WalletTokenBreakdown,
) {
  const existing = map.get(token.mint);
  if (!existing) {
    map.set(token.mint, { ...token });
    counts[token.mint] = (counts[token.mint] ?? 0) + 1;
    return;
  }

  existing.totalTrades += token.totalTrades;
  existing.buys += token.buys;
  existing.sells += token.sells;
  existing.totalVolumeSol += token.totalVolumeSol;
  existing.totalVolumeUsd += token.totalVolumeUsd;
  existing.buyVolumeSol += token.buyVolumeSol;
  existing.buyVolumeUsd += token.buyVolumeUsd;
  existing.sellVolumeSol += token.sellVolumeSol;
  existing.sellVolumeUsd += token.sellVolumeUsd;
  existing.realizedPnlSol += token.realizedPnlSol;
  existing.realizedPnlUsd += token.realizedPnlUsd;
  existing.totalFees += token.totalFees;
  existing.firstTrade = earlier(existing.firstTrade, token.firstTrade);
  existing.lastTrade = later(existing.lastTrade, token.lastTrade);
  existing.name = existing.name || token.name;
  existing.symbol = existing.symbol || token.symbol;
  existing.platform = existing.platform || token.platform;
  existing.positionStatus =
    existing.buys > existing.sells ? "open" : "closed";
  if (existing.firstTrade && existing.lastTrade) {
    const duration = toMs(existing.lastTrade)! - toMs(existing.firstTrade)!;
    existing.holdDurationSeconds = Math.max(0, Math.round(duration / 1000));
  }
  counts[token.mint] = (counts[token.mint] ?? 0) + 1;
}

function mergeFifoToken(
  map: Map<string, FifoTokenPnl>,
  token: FifoTokenPnl,
) {
  const existing = map.get(token.mint);
  if (!existing) {
    map.set(token.mint, { ...token });
    return;
  }

  existing.realizedPnlSol += token.realizedPnlSol;
  existing.totalCostBasis += token.totalCostBasis;
  existing.unrealizedCostSol += token.unrealizedCostSol;
  existing.unrealizedTokens += token.unrealizedTokens;
  existing.unrealizedLots += token.unrealizedLots;
  existing.totalBuys += token.totalBuys;
  existing.totalSells += token.totalSells;
}

function mergePerformance(
  map: Map<string, WalletPerformanceDataPoint>,
  point: WalletPerformanceDataPoint,
) {
  const existing = map.get(point.timestamp);
  if (!existing) {
    map.set(point.timestamp, { ...point });
    return;
  }

  existing.trades += point.trades;
  existing.buys += point.buys;
  existing.sells += point.sells;
  existing.volumeSol += point.volumeSol;
  existing.volumeUsd += point.volumeUsd;
  existing.realizedPnlSol += point.realizedPnlSol;
  existing.realizedPnlUsd += point.realizedPnlUsd;
  existing.uniqueTokens += point.uniqueTokens;
}

function mergePnlHistory(
  map: Map<string, WalletPnlHistoryPoint>,
  point: WalletPnlHistoryPoint,
) {
  const existing = map.get(point.bucket);
  if (!existing) {
    map.set(point.bucket, { ...point });
    return;
  }

  existing.realizedPnlSol += point.realizedPnlSol;
  existing.unrealizedPnlSol += point.unrealizedPnlSol;
  existing.totalPnlSol += point.totalPnlSol;
  existing.solPriceUsd = point.solPriceUsd || existing.solPriceUsd;
}

function formatErrors(errors: string[]) {
  return errors.length ? `Some wallet requests failed: ${errors.join(", ")}` : null;
}

export function usePortfolioScope(
  addresses: string[],
  window: PortfolioScopeWindow,
  refreshKey = 0,
) {
  const [state, setState] = useState<PortfolioScopeState>(EMPTY_STATE);

  useEffect(() => {
    if (!addresses.length) {
      setState(EMPTY_STATE);
      return;
    }

    let cancelled = false;
    setState({
      ...EMPTY_STATE,
      loading: true,
      historyLoading: true,
      error: null,
    });

    void (async () => {
      const coreResults = await Promise.all(
        addresses.map(async (address) => {
          const results = await Promise.allSettled([
            fetchWalletHoldings(address),
            fetchWalletTrades(address, 30),
            fetchWalletTokenBreakdown(address, { limit: 120, sort: "recent" }),
          ]);

          const holdingsResponse =
            results[0].status === "fulfilled"
              ? results[0].value
              : null;
          const holdings = holdingsResponse?.data ?? [];
          const walletTrades = dedupeTrades(
            results[1].status === "fulfilled"
              ? toArray<Trade>(results[1].value).map((trade) => ({
                  ...trade,
                  signer: trade.signer || address,
                }))
              : [],
          );
          const tokenBreakdown =
            results[2].status === "fulfilled"
              ? results[2].value.data ?? []
              : [];

          const errors: string[] = [];
          if (results[0].status === "rejected") errors.push(`${address} holdings`);
          if (results[1].status === "rejected") errors.push(`${address} trades`);
          if (results[2].status === "rejected") errors.push(`${address} tokens`);

          return {
            address,
            holdingsResponse,
            holdings,
            walletTrades,
            tokenBreakdown,
            errors,
          };
        }),
      );

      if (cancelled) return;

      const holdingsMap = new Map<string, TokenHolding>();
      const holdingWalletCounts: Record<string, number> = {};
      const tokenMap = new Map<string, WalletTokenBreakdown>();
      const tokenWalletCounts: Record<string, number> = {};
      const trades: Trade[] = [];
      const snapshots: WalletScopeSnapshot[] = [];
      const errors: string[] = [];

      for (const result of coreResults) {
        errors.push(...result.errors);

        for (const holding of result.holdings) {
          if (holding.isNative) continue;
          mergeHolding(holdingsMap, holdingWalletCounts, holding);
        }

        for (const trade of result.walletTrades) {
          trades.push(trade);
        }

        for (const token of result.tokenBreakdown) {
          mergeTokenBreakdown(tokenMap, tokenWalletCounts, token);
        }

        const holdingsValueUsd = result.holdings.reduce(
          (sum, holding) => sum + (holding.usdValue ?? 0),
          0,
        );
        const nativeSol =
          result.holdingsResponse?.summary?.totalSolBalance ??
          result.holdings.find((holding) => holding.isNative)?.amount ??
          0;
        const recentTradeAt =
          result.walletTrades
            .map((trade) => ({
              value:
                typeof trade.timestamp === "string"
                  ? trade.timestamp
                  : new Date(trade.timestamp).toISOString(),
              stamp: toMs(trade.timestamp) ?? 0,
            }))
            .sort((left, right) => right.stamp - left.stamp)[0]?.value ?? null;

        snapshots.push({
          address: result.address,
          holdingsValueUsd,
          holdingsCount: result.holdings.filter(
            (holding) =>
              !holding.isNative &&
              ((holding.usdValue ?? 0) > 0 || holding.amount > 0),
          ).length,
          nativeSol,
          recentTradeAt,
          recentTrades: result.walletTrades.length,
        });
      }

      const mergedHoldings = [...holdingsMap.values()].sort(
        (left, right) => (right.usdValue ?? 0) - (left.usdValue ?? 0),
      );
      const mergedTokens = [...tokenMap.values()].sort(
        (left, right) => right.totalVolumeSol - left.totalVolumeSol,
      );
      const mergedTrades = dedupeTrades(trades).sort(
        (left, right) => (toMs(right.timestamp) ?? 0) - (toMs(left.timestamp) ?? 0),
      );

      setState({
        holdings: mergedHoldings,
        holdingWalletCounts,
        trades: mergedTrades,
        tokenBreakdown: mergedTokens,
        tokenWalletCounts,
        pnl: null,
        performance: [],
        pnlHistory: [],
        walletSnapshots: snapshots,
        loading: true,
        historyLoading: true,
        error: formatErrors(errors),
      });

      const historyResults = await Promise.all(
        addresses.map(async (address) => {
          const results = await Promise.allSettled([
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
          const pnl =
            results[0].status === "fulfilled"
              ? results[0].value
              : null;
          const performance =
            results[1].status === "fulfilled"
              ? results[1].value.data ?? []
              : [];
          const pnlHistory =
            results[2].status === "fulfilled"
              ? results[2].value.data ?? []
              : [];

          const errors: string[] = [];
          if (results[0].status === "rejected") errors.push(`${address} pnl`);
          if (results[1].status === "rejected") errors.push(`${address} performance`);
          if (results[2].status === "rejected") errors.push(`${address} pnl-history`);

          return {
            address,
            pnl,
            performance,
            pnlHistory,
            errors,
          };
        }),
      );

      if (cancelled) return;

      const fifoMap = new Map<string, FifoTokenPnl>();
      const performanceMap = new Map<string, WalletPerformanceDataPoint>();
      const pnlHistoryMap = new Map<string, WalletPnlHistoryPoint>();
      let pnlTotals: WalletFifoPnlResponse["data"] | null = null;
      let pnlAddress = addresses.length === 1 ? addresses[0] : "connected-wallets";
      let tradesProcessed = 0;
      let truncated = false;
      let solPriceUsd: number | undefined;
      let timestamp: string | undefined;
      const allErrors = [...errors];

      for (const result of historyResults) {
        allErrors.push(...result.errors);

        if (result.pnl) {
          if (!pnlTotals) {
            pnlTotals = {
              totalRealizedPnlSol: 0,
              totalRealizedPnlUsd: 0,
              totalUnrealizedCostSol: 0,
              totalUnrealizedCostUsd: 0,
              tokenCount: 0,
              tokens: [],
            };
          }

          pnlTotals.totalRealizedPnlSol += result.pnl.data.totalRealizedPnlSol;
          pnlTotals.totalRealizedPnlUsd += result.pnl.data.totalRealizedPnlUsd;
          pnlTotals.totalUnrealizedCostSol += result.pnl.data.totalUnrealizedCostSol;
          pnlTotals.totalUnrealizedCostUsd += result.pnl.data.totalUnrealizedCostUsd;
          pnlTotals.tokenCount += result.pnl.data.tokenCount;
          for (const token of result.pnl.data.tokens) {
            mergeFifoToken(fifoMap, token);
          }
          tradesProcessed += result.pnl.tradesProcessed;
          truncated = truncated || result.pnl.truncated;
          solPriceUsd = result.pnl.solPriceUsd ?? solPriceUsd;
          timestamp = result.pnl.timestamp ?? timestamp;
        }

        for (const point of result.performance) {
          mergePerformance(performanceMap, point);
        }

        for (const point of result.pnlHistory) {
          mergePnlHistory(pnlHistoryMap, point);
        }
      }

      const mergedPnlTokens = [...fifoMap.values()].sort(
        (left, right) => right.realizedPnlSol - left.realizedPnlSol,
      );

      setState({
        holdings: mergedHoldings,
        holdingWalletCounts,
        trades: mergedTrades,
        tokenBreakdown: mergedTokens,
        tokenWalletCounts,
        pnl: pnlTotals
          ? {
              success: true,
              address: pnlAddress,
              data: {
                ...pnlTotals,
                tokens: mergedPnlTokens,
              },
              tradesProcessed,
              truncated,
              solPriceUsd,
              timestamp,
            }
          : null,
        performance: [...performanceMap.values()].sort(
          (left, right) => (toMs(left.timestamp) ?? 0) - (toMs(right.timestamp) ?? 0),
        ),
        pnlHistory: [...pnlHistoryMap.values()].sort(
          (left, right) => (toMs(left.bucket) ?? 0) - (toMs(right.bucket) ?? 0),
        ),
        walletSnapshots: snapshots,
        loading: false,
        historyLoading: false,
        error: formatErrors(allErrors),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [addresses.join(","), window.from, window.to, window.resolution, refreshKey]);

  return state;
}
