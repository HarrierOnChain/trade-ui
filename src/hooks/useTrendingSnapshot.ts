"use client";
// Single source of truth for the chain-trending overview page.
//
// Subscribes to `trending.live` on the regional backend. The backend's first
// event on subscribe is a `snapshot` (current rolling state); subsequent
// events are `upsert` / `remove` deltas. We patch the local map in place so
// React re-renders only the affected token cells.
//
// Loading is `true` only until the first snapshot arrives. There is no
// REST fallback — the backend serves an in-memory snapshot which is
// effectively zero-latency, and the live stream is the only data source.

import { useEffect, useMemo, useRef, useState } from "react";
import { getWire } from "../lib/wire/singleton";
import { getBackendBase } from "../api/config";
import { useClientPageVisible } from "../contexts/ClientPageVisibility";

export interface TrendingEntry {
  mint: string;
  symbol: string;
  name: string;
  dex: string;
  image: string | null;
  marketCap: number | null;
  lastPrice: number | null;
  liquidity: number | null;
  volumeSol: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  uniqueTraders: number;
  firstPrice: number | null;
  priceChangePct: number | null;
  isNew: boolean;
  isMigrating: boolean;
  source: "alert" | "deploy" | "migration" | "trade" | "bootstrap";
  createdAt: number;
  firstSeenAt: number;
  lastTradeAt: number;
  lastEventAt: number;
  score: number;
}

type Delta =
  | { kind: "snapshot"; entries: TrendingEntry[]; solPrice: number | null; ts: number }
  | { kind: "upsert"; entry: TrendingEntry }
  | { kind: "remove"; mint: string };

export interface TrendingSnapshot {
  entries: TrendingEntry[];     // sorted by score desc
  solPrice: number | null;
  loading: boolean;
  error: string | null;
  lastUpdateAt: number | null;
}

const RERENDER_THROTTLE_MS = 250;

export function useTrendingSnapshot(limit = 200): TrendingSnapshot {
  const pageVisible = useClientPageVisible();
  const [version, bump] = useState(0);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastUpdateRef = useRef<number | null>(null);
  const stateRef = useRef<Map<string, TrendingEntry>>(new Map());
  const sortedRef = useRef<TrendingEntry[]>([]);
  const dirtyRef = useRef(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Coalesce bursty deltas into a single re-render per RERENDER_THROTTLE_MS.
  const scheduleFlush = () => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      sortedRef.current = [...stateRef.current.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      lastUpdateRef.current = Date.now();
      bump((v) => v + 1);
    }, RERENDER_THROTTLE_MS);
  };

  useEffect(() => {
    if (!pageVisible) return;
    const wire = getWire(getBackendBase());
    let cancelled = false;
    let gotSnapshot = false;

    const sub = wire.subscribe(
      "trending.live",
      { limit },
      (raw) => {
        if (cancelled) return;
        const d = raw as Delta;
        if (d.kind === "snapshot") {
          gotSnapshot = true;
          const m = new Map<string, TrendingEntry>();
          for (const e of d.entries) m.set(e.mint, e);
          stateRef.current = m;
          if (d.solPrice != null && d.solPrice > 0) setSolPrice(d.solPrice);
          dirtyRef.current = true;
          setLoading(false);
          setError(null);
          // First snapshot — flush immediately, don't throttle.
          if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
          sortedRef.current = [...stateRef.current.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
          lastUpdateRef.current = Date.now();
          bump((v) => v + 1);
        } else if (d.kind === "upsert") {
          stateRef.current.set(d.entry.mint, d.entry);
          dirtyRef.current = true;
          scheduleFlush();
        } else if (d.kind === "remove") {
          if (stateRef.current.delete(d.mint)) {
            dirtyRef.current = true;
            scheduleFlush();
          }
        }
      },
      (err) => {
        if (cancelled) return;
        if (err) setError(err.code ?? "error");
      },
    );

    // Safety timeout: if no snapshot arrives within 10s, stop showing the
    // loading spinner so the page isn't permanently stuck.
    const timeout = setTimeout(() => {
      if (!gotSnapshot && !cancelled) {
        setLoading(false);
        setError("snapshot_timeout");
      }
    }, 10_000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      try { sub.cancel(); } catch { /* ignore */ }
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    };
  }, [limit, pageVisible]);

  return useMemo<TrendingSnapshot>(
    () => ({
      entries: sortedRef.current,
      solPrice,
      loading: pageVisible ? loading : false,
      error,
      lastUpdateAt: lastUpdateRef.current,
    }),
    // version is the throttled re-render trigger
    [version, solPrice, loading, error],
  );
}
