"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTrending, trendingInterval } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { useChain } from "../contexts/ChainContext";
import { isFiltering, passesFilters, type ColumnFilters } from "../lib/tokenFilters";
import { noteRows } from "../lib/columnSeen";
import { mergeLiveFrame } from "../lib/streamMerge";
import { sameRow } from "./useLaunchpadBoard";
import type { TokenEvent, TrendingPeriod } from "../types";

/** Rows the column renders. */
const MAX = 20;
/** Ranking depth (the API's maximum), so filters have rows to pick from. */
const RANK_LIMIT = 100;
const SORT = "trades";

const byRank = (a: TokenEvent, b: TokenEvent) => (a.rank ?? Infinity) - (b.rank ?? Infinity);

/**
 * The trending ranking: the top `MAX` rows, in the API's order, that pass the
 * column's filters. One REST read primes the column; the `trending` channel
 * then sends the ranking (`snapshot`, each row with its `rank`) and its
 * changes (`add`, `update`, `remove`) at every read of the ranking. Rows carry
 * the whole token row (stats, safety, pool); a value the API has not measured
 * yet (null) lets a row through the filters.
 */
export function useAlertStream(filters?: ColumnFilters, period: TrendingPeriod = "recent") {
  const { chainId } = useChain();
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const rankRef = useRef<TokenEvent[]>([]);
  const renderedRef = useRef(new Map<string, TokenEvent>());
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
        // Keep row identity across frames that change nothing it shows.
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

  useEffect(() => {
    let cancelled = false;
    // A snapshot from the channel is newer than any REST answer still out.
    let live = false;
    setLoading(true);
    rankRef.current = [];
    renderedRef.current = new Map();
    setTokens([]);

    const unique = (rows: TokenEvent[]) => {
      const seen = new Set<string>();
      return rows.filter((t) => {
        if (!t.mint_address || seen.has(t.mint_address)) return false;
        seen.add(t.mint_address);
        return true;
      });
    };

    fetchTrending(period, RANK_LIMIT)
      .then((res) => {
        if (cancelled || live) return;
        rankRef.current = unique(res.data);
        noteRows("trending", rankRef.current);
        select();
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    const ws = RazeWebSocket.getInstance();
    const interval = trendingInterval(period);
    ws.subscribeTrending(chainId, interval, RANK_LIMIT, SORT);
    const off = ws.on("trending", (msg) => {
      if (msg.chain !== chainId || msg.interval !== interval || msg.sort !== SORT) return;
      const kind = msg.kind;
      if (kind === "snapshot") {
        live = true;
        rankRef.current = unique((msg.rows as TokenEvent[]) ?? []).sort(byRank);
        setLoading(false);
      } else {
        const row = msg.row as TokenEvent | undefined;
        if (!row?.mint_address) return;
        const rest = rankRef.current.filter((t) => t.mint_address !== row.mint_address);
        if (kind === "remove") rankRef.current = rest;
        else if (kind === "add") rankRef.current = [...rest, { ...row, isNew: true }].sort(byRank);
        else if (kind === "update") {
          const held = rankRef.current.find((t) => t.mint_address === row.mint_address);
          rankRef.current = [...rest, held ? { ...row, isNew: held.isNew } : row].sort(byRank);
        } else return;
      }
      noteRows("trending", rankRef.current);
      select();
    });

    return () => {
      cancelled = true;
      off();
      ws.unsubscribeTrending(chainId, interval, RANK_LIMIT, SORT);
    };
  }, [period, chainId, select]);

  // Re-pick the visible rows when the filters change (no refetch needed).
  useEffect(() => { select(); }, [filtersKey, select]);

  return { tokens, loading };
}
