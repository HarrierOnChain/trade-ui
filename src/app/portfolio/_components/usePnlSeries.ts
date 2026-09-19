"use client";
/**
 * PnL data hooks for the Caesar-style Spot summary — fed entirely by Raze's
 * own `fetchWalletPnlHistory` endpoint (NOT Caesar's /pnl/* + socket.io).
 *
 *  • usePnlSeries  → a cumulative realized-PnL series (USD) for the area chart,
 *                    re-queried per selected timeframe and merged across every
 *                    on-chain wallet.
 *  • useMonthlyPnl → per-day realized PnL for the calendar heatmap of one month.
 *
 * Both are out-of-band (timeframe / month / refresh changes) — they never run
 * on a trading hot path, so the per-wallet fan-out is fine.
 */

import { useEffect, useRef, useState } from "react";
import { fetchWalletPnlHistory } from "../../../api/client";
import type { WalletPnlHistoryPoint } from "../../../types";

export type PnlTimeframe = "1H" | "6H" | "24H" | "7D" | "ALL";

export const PNL_TIMEFRAMES: PnlTimeframe[] = ["1H", "6H", "24H", "7D", "ALL"];

export interface PnlSeriesPoint {
  /** Bucket time in ms. */
  t: number;
  /** Cumulative realized PnL in USD up to this bucket. */
  v: number;
}

interface PnlSeriesState {
  series: PnlSeriesPoint[];
  /** Total realized PnL (USD) over the selected window. */
  realizedUsd: number;
  loading: boolean;
}

interface TimeframeWindow {
  fromSec: number;
  toSec: number;
  resolution: "1h" | "1d";
}

function timeframeWindow(tf: PnlTimeframe, nowMs: number): TimeframeWindow {
  const nowSec = Math.floor(nowMs / 1000);
  const H = 3600;
  const D = 86_400;
  switch (tf) {
    case "1H":  return { fromSec: nowSec - 1 * H,   toSec: nowSec, resolution: "1h" };
    case "6H":  return { fromSec: nowSec - 6 * H,   toSec: nowSec, resolution: "1h" };
    case "24H": return { fromSec: nowSec - 24 * H,  toSec: nowSec, resolution: "1h" };
    case "7D":  return { fromSec: nowSec - 7 * D,   toSec: nowSec, resolution: "1d" };
    // Effectively lifetime — 5 years spans all of Solana mainnet history, so
    // the "All" label doesn't silently truncate older realized PnL.
    case "ALL": return { fromSec: nowSec - 5 * 365 * D, toSec: nowSec, resolution: "1d" };
  }
}

/** USD value of a bucket's realized PnL, falling back to a passed sol price. */
function bucketRealizedUsd(p: WalletPnlHistoryPoint, solPriceFallback: number): number {
  const price = p.solPriceUsd && p.solPriceUsd > 0 ? p.solPriceUsd : solPriceFallback;
  return (p.realizedPnlSol ?? 0) * (price > 0 ? price : 0);
}

/**
 * Pre-v2 history cached cumulative series — convert to per-bucket deltas so
 * calendar totals and chart cumulation stay correct before redeploy.
 */
function ensureBucketDeltas(points: WalletPnlHistoryPoint[]): WalletPnlHistoryPoint[] {
  if (points.length < 2) return points;
  const sorted = [...points].sort((a, b) => Date.parse(a.bucket) - Date.parse(b.bucket));
  const monotonic = sorted.every((p, i) =>
    i === 0 || (p.realizedPnlSol ?? 0) >= (sorted[i - 1].realizedPnlSol ?? 0) - 1e-12,
  );
  const first = sorted[0].realizedPnlSol ?? 0;
  const last = sorted[sorted.length - 1].realizedPnlSol ?? 0;
  const sumRaw = sorted.reduce((s, p) => s + (p.realizedPnlSol ?? 0), 0);
  const looksCumulative = monotonic && first > 0 && Math.abs(sumRaw - last) > 1e-9;
  if (!looksCumulative) return sorted;
  let prev = 0;
  return sorted.map((p) => {
    const cum = p.realizedPnlSol ?? 0;
    const delta = cum - prev;
    prev = cum;
    return { ...p, realizedPnlSol: delta };
  });
}

function mergeWalletPoints(
  results: WalletPnlHistoryPoint[][],
  solPriceFallback: number,
): WalletPnlHistoryPoint[] {
  const byBucket = new Map<string, WalletPnlHistoryPoint>();
  for (const points of results) {
    for (const p of ensureBucketDeltas(points)) {
      const existing = byBucket.get(p.bucket);
      if (!existing) {
        byBucket.set(p.bucket, { ...p });
        continue;
      }
      existing.realizedPnlSol += p.realizedPnlSol ?? 0;
      existing.unrealizedPnlSol += p.unrealizedPnlSol ?? 0;
      existing.totalPnlSol += p.totalPnlSol ?? 0;
      if (p.solPriceUsd > 0) existing.solPriceUsd = p.solPriceUsd;
    }
  }
  return [...byBucket.values()].sort(
    (a, b) => Date.parse(a.bucket) - Date.parse(b.bucket),
  );
}

const EMPTY_SERIES: PnlSeriesState = { series: [], realizedUsd: 0, loading: false };

export function usePnlSeries(
  addresses: string[],
  timeframe: PnlTimeframe,
  solPriceFallback: number,
  refreshKey = 0,
): PnlSeriesState {
  const [state, setState] = useState<PnlSeriesState>(EMPTY_SERIES);
  const addrKey = addresses.join(",");
  // Read the live SOL price at fetch time without re-fetching on every tick.
  const priceRef = useRef(solPriceFallback);
  priceRef.current = solPriceFallback;

  useEffect(() => {
    if (!addresses.length) { setState(EMPTY_SERIES); return; }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    void (async () => {
      const win = timeframeWindow(timeframe, Date.now());
      const results = await Promise.all(
        addresses.map(async (address) => {
          try {
            const resp = await fetchWalletPnlHistory(address, {
              from: win.fromSec, to: win.toSec, resolution: win.resolution,
            });
            return resp.success ? (resp.data ?? []) : [];
          } catch {
            return [] as WalletPnlHistoryPoint[];
          }
        }),
      );
      if (cancelled) return;

      const merged = mergeWalletPoints(results, priceRef.current);
      let cum = 0;
      const series: PnlSeriesPoint[] = [];
      for (const p of merged) {
        const t = Date.parse(p.bucket);
        if (!Number.isFinite(t)) continue;
        const usd = bucketRealizedUsd(p, priceRef.current);
        cum += usd;
        series.push({ t, v: cum });
      }

      setState({ series, realizedUsd: cum, loading: false });
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrKey, timeframe, refreshKey]);

  return state;
}

/* ── Monthly daily PnL (calendar heatmap) ────────────────────────────── */

export interface DayPnl {
  usd: number;
  sol: number;
}

interface MonthlyPnlState {
  /** day-of-month (1-31) → realized PnL for that day. */
  byDay: Map<number, DayPnl>;
  totalUsd: number;
  totalSol: number;
  loading: boolean;
}

const EMPTY_MONTH: MonthlyPnlState = { byDay: new Map(), totalUsd: 0, totalSol: 0, loading: false };

export function useMonthlyPnl(
  addresses: string[],
  monthDate: Date,
  solPriceFallback: number,
  refreshKey = 0,
): MonthlyPnlState {
  const [state, setState] = useState<MonthlyPnlState>(EMPTY_MONTH);
  const addrKey = addresses.join(",");
  const year = monthDate.getUTCFullYear();
  const month = monthDate.getUTCMonth();
  const priceRef = useRef(solPriceFallback);
  priceRef.current = solPriceFallback;

  useEffect(() => {
    if (!addresses.length) { setState(EMPTY_MONTH); return; }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    void (async () => {
      const fromSec = Math.floor(Date.UTC(year, month, 1) / 1000);
      const toSec = Math.floor(Date.UTC(year, month + 1, 1) / 1000) - 1;

      const results = await Promise.all(
        addresses.map(async (address) => {
          try {
            const resp = await fetchWalletPnlHistory(address, {
              from: fromSec, to: toSec, resolution: "1d",
            });
            return resp.success ? (resp.data ?? []) : [];
          } catch {
            return [] as WalletPnlHistoryPoint[];
          }
        }),
      );
      if (cancelled) return;

      const merged = mergeWalletPoints(results, priceRef.current);
      const byDay = new Map<number, DayPnl>();
      let totalUsd = 0;
      let totalSol = 0;
      for (const p of merged) {
        const d = new Date(p.bucket);
        if (Number.isNaN(d.getTime())) continue;
        if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month) continue;
        const day = d.getUTCDate();
        const usd = bucketRealizedUsd(p, priceRef.current);
        const sol = p.realizedPnlSol ?? 0;
        const cur = byDay.get(day) ?? { usd: 0, sol: 0 };
        byDay.set(day, { usd: cur.usd + usd, sol: cur.sol + sol });
        totalUsd += usd;
        totalSol += sol;
      }

      setState({ byDay, totalUsd, totalSol, loading: false });
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrKey, year, month, refreshKey]);

  return state;
}
