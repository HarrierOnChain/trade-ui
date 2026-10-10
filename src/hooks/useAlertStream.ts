"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTrending } from "../api/client";
import { useChain } from "../contexts/ChainContext";
import { isFiltering, passesFilters, type ColumnFilters } from "../lib/tokenFilters";
import { noteRows } from "../lib/columnSeen";
import { mergeLiveFrame } from "../lib/streamMerge";
import { sameRow } from "./useLaunchpadBoard";
import { useTokenEnrichment } from "./useTokenEnrichment";
import type { TokenEvent, TrendingPeriod } from "../types";

/** Rows the column renders. */
const MAX = 20;
/** Ranking depth read (the API's maximum), so filters have rows to pick from. */
const RANK_LIMIT = 100;
/**
 * Trending has no live channel on the API (the old `discovery` stream is
 * gone), so the ranking is re-read on this interval — the one REST refresh
 * that is not priming a stream. Prices on the rows still tick live through
 * useLiveTradePrices.
 */
const REFRESH_MS = 30_000;

/**
 * The trending ranking: the top `MAX` rows, in the server's order, that pass
 * the column's filters. As on the boards, a value a row does not carry yet
 * lets it in until enrichment fills it.
 */
export function useAlertStream(filters?: ColumnFilters, period: TrendingPeriod = "recent") {
  const { chainId } = useChain();
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrichKey, setEnrichKey] = useState(0);
  const rankRef = useRef<TokenEvent[]>([]);
  const renderedRef = useRef(new Map<string, TokenEvent>());
  const seenRef = useRef(new Set<string>());
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const filtersKey = JSON.stringify(filters ?? null);

  const select = useCallback(() => {
    const f = filtersRef.current;
    const gate = f && isFiltering(f) ? f : null;
    setTokens((prev) => {
      for (const t of prev) renderedRef.current.set(t.mint_address, t);
      const next: TokenEvent[] = [];
      for (const t of rankRef.current) {
        // Keep enriched fields and row identity across refreshes.
        const old = renderedRef.current.get(t.mint_address);
        const view = old ? mergeLiveFrame(old, t) : t;
        if (gate && !passesFilters(view, undefined, gate, { optimistic: true })) continue;
        next.push(old && sameRow(old, view) ? old : view);
        if (next.length >= MAX) break;
      }
      if (renderedRef.current.size > 500) {
        const keep = new Set(rankRef.current.map((t) => t.mint_address));
        for (const k of renderedRef.current.keys()) if (!keep.has(k)) renderedRef.current.delete(k);
      }
      if (next.length === prev.length && next.every((t, i) => t === prev[i])) return prev;
      return next;
    });
  }, []);

  const setEnriched = useCallback<React.Dispatch<React.SetStateAction<TokenEvent[]>>>((u) => {
    setTokens(u);
    select();
  }, [select]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    seenRef.current = new Set();
    rankRef.current = [];
    renderedRef.current = new Map();
    setTokens([]);

    const load = (initial: boolean) => {
      fetchTrending(period, RANK_LIMIT)
        .then((res) => {
          if (cancelled) return;
          const seen = new Set<string>();
          const list = res.data.filter((t) => {
            if (!t.mint_address || seen.has(t.mint_address)) return false;
            seen.add(t.mint_address);
            return true;
          });
          const fresh = list.some((t) => !seenRef.current.has(t.mint_address));
          rankRef.current = list.map((t) =>
            initial || seenRef.current.has(t.mint_address) ? t : { ...t, isNew: true });
          list.forEach((t) => seenRef.current.add(t.mint_address));
          noteRows("trending", list);
          select();
          if (fresh) setEnrichKey((k) => k + 1);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled && initial) setLoading(false); });
    };

    load(true);
    const id = setInterval(() => load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [period, chainId, select]);

  // Re-pick the visible rows when the filters change (no refetch needed).
  useEffect(() => { select(); }, [filtersKey, select]);

  useEffect(() => { noteRows("trending", tokens); }, [tokens]);

  // The ranking already carries safety (honeypot, taxes, renounced…) that the
  // batch token read leaves empty or zero: enrichment only fills gaps there.
  useTokenEnrichment(tokens, setEnriched, MAX, enrichKey, { keepSafety: true });

  return { tokens, loading };
}
