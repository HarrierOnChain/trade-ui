"use client";
import { useEffect, useRef, useState } from "react";
import { fetchRanking, type RankInterval, type RankSort } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { useChain } from "../contexts/ChainContext";
import { useClientPageVisible } from "../contexts/ClientPageVisibility";
import { mergeLiveFrame } from "../lib/streamMerge";
import type { TokenEvent } from "../types";

/** The ranking's depth: the API's maximum. */
export const RANKING_LIMIT = 100;
/** Coalesce a burst of ranking changes into one render. */
const FLUSH_MS = 250;

const byRank = (a: TokenEvent, b: TokenEvent) => (a.rank ?? Infinity) - (b.rank ?? Infinity);

/**
 * One chain's `/trending` ranking over `interval`, ranked by `sort`, live:
 * one REST read primes it, then the `trending` channel sends the ranking
 * (`snapshot`) and its changes (`add`, `update`, `remove`), each row with its
 * `rank` and the whole token row. Paused while its page is hidden.
 *
 * `loading` holds until rows are on screen (or the ranking is known empty).
 * A channel snapshot with no rows, which a fresh subscription can send before
 * the ranking is computed, is not taken as the answer. On a new window or
 * sort the previous rows stay, `stale`, until the new ones arrive; a new
 * chain starts empty.
 */
export function useRanking(interval: RankInterval, sort: RankSort) {
  const { chainId } = useChain();
  const visible = useClientPageVisible();
  const [rows, setRows] = useState<TokenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rankRef = useRef(new Map<string, TokenEvent>());
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef(chainId);

  useEffect(() => {
    rankRef.current = new Map();
    if (chainRef.current !== chainId) {
      chainRef.current = chainId;
      setRows([]);
    }
    setError(null);
    if (!visible) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setStale(true);
    let cancelled = false;
    /** A ranking with rows has arrived (REST or channel). */
    let settled = false;
    /** The channel's ranking: newer than any REST answer still out. */
    let live = false;

    const flushNow = () => {
      if (flushRef.current != null) {
        clearTimeout(flushRef.current);
        flushRef.current = null;
      }
      if (cancelled) return;
      setRows([...rankRef.current.values()].sort(byRank));
      setStale(false);
      setLoading(false);
    };
    const schedule = () => {
      if (!settled) return flushNow();
      if (flushRef.current == null) flushRef.current = setTimeout(flushNow, FLUSH_MS);
    };

    fetchRanking(interval, sort, RANKING_LIMIT).then(
      (list) => {
        if (cancelled || live) return;
        rankRef.current = new Map(list.map((t) => [t.mint_address, t]));
        // An empty answer is an answer too: the ranking is empty.
        settled = list.length > 0;
        flushNow();
      },
      (e) => {
        if (cancelled || live) return;
        setError(e instanceof Error ? e.message : String(e));
        setStale(false);
        setLoading(false);
      },
    );

    const ws = RazeWebSocket.getInstance();
    ws.subscribeTrending(chainId, interval, RANKING_LIMIT, sort);
    const off = ws.on("trending", (msg) => {
      if (msg.chain !== chainId || msg.interval !== interval || msg.sort !== sort) return;
      if (msg.kind === "snapshot") {
        const list = (msg.rows as TokenEvent[]) ?? [];
        // Not computed yet: keep what REST gives (or what is shown).
        if (list.length === 0 && !settled) return;
        live = true;
        const next = new Map<string, TokenEvent>();
        for (const t of list) {
          const had = rankRef.current.get(t.mint_address);
          next.set(t.mint_address, had ? mergeLiveFrame(had, t) : t);
        }
        rankRef.current = next;
        setError(null);
        const first = !settled;
        settled = true;
        if (first) flushNow();
        else schedule();
        return;
      }
      const row = msg.row as TokenEvent | undefined;
      if (!row?.mint_address) return;
      if (msg.kind === "remove") rankRef.current.delete(row.mint_address);
      else if (msg.kind === "add" || msg.kind === "update") {
        const had = rankRef.current.get(row.mint_address);
        rankRef.current.set(row.mint_address, had ? mergeLiveFrame(had, row) : row);
      } else return;
      // Changes before a whole ranking only update it: one row is not the list.
      if (settled) schedule();
    });

    return () => {
      cancelled = true;
      off();
      ws.unsubscribeTrending(chainId, interval, RANKING_LIMIT, sort);
      if (flushRef.current != null) {
        clearTimeout(flushRef.current);
        flushRef.current = null;
      }
    };
  }, [chainId, interval, sort, visible]);

  return { rows, loading: visible ? loading : false, stale, error };
}
