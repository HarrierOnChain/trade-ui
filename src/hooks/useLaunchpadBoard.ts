"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RazeWebSocket, type WsEventType } from "../api/websocket";
import { friendlyFetchError } from "../api/chainError";
import { useChain } from "../contexts/ChainContext";
import { useClientPageVisible } from "../contexts/ClientPageVisibility";
import { mergeLiveFrame } from "../lib/streamMerge";
import { isFiltering, passesFilters, type ColumnFilters } from "../lib/tokenFilters";
import { noteRows } from "../lib/columnSeen";
import { useMetaEnrichment } from "./useMetaEnrichment";
import type { TokenEvent } from "../types";

/** Rows a column renders; the board itself holds more (the API's 100). */
const MAX = 20;
/** Coalesce a burst of board frames (the `new` board moves ~20×/s). */
const FLUSH_MS = 150;
/** The REST prime: `new` and `graduated` keep the latest 100 per chain. */
const PRIME_LIMIT = 100;

export interface BoardOptions {
  /** `deploy` = board new, `migrating` = graduating, `migration` = graduated
   *  (also the column's key). */
  event: Extract<WsEventType, "deploy" | "migrating" | "migration">;
  /** REST prime: the board as of now, before the socket's snapshot lands. */
  fetch: (limit: number) => Promise<{ data: TokenEvent[] }>;
  /** Column order (the API's own: newest, fullest, latest graduation). */
  order: (a: TokenEvent, b: TokenEvent) => number;
  /** The column's filters: a row that fails them does not take a slot. */
  filters?: ColumnFilters;
}

export function sameRow(a: TokenEvent, b: TokenEvent): boolean {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (x[k] !== y[k]) return false;
  return true;
}

/**
 * One launchpad board, live. The `launchpad` channel sends the board
 * (`snapshot`) on every (re)subscribe, then `add` / `update` / `remove`; a
 * token sits on one board at a time, so `remove` is how a token moves on
 * (new → graduating → graduated) or drops off the end. REST only primes the
 * board once, before the snapshot arrives — nothing here polls.
 *
 * The full board lives in a ref; the column renders the top `MAX` rows, in
 * `order`, that pass its filters, so a removed or filtered-out row is replaced
 * by the next one instead of leaving a hole. Rows carry the whole token row
 * (stats, pool, safety) as `/tokens` gives it; a value the API has not
 * measured yet (null: safety on a launch under ~30 s old, stats until the
 * first decoration) lets a row in, and once measured a row that fails gives
 * its slot to the next one. Fields a frame does not carry survive it.
 */
export function useLaunchpadBoard({ event, fetch, order, filters }: BoardOptions) {
  const { chainId } = useChain();
  const pageVisible = useClientPageVisible();
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrichKey, setEnrichKey] = useState(0);

  const boardRef = useRef(new Map<string, TokenEvent>());
  /** Last rendered version of each row, so a row that leaves the top MAX and
   *  comes back keeps what enrichment filled in. */
  const renderedRef = useRef(new Map<string, TokenEvent>());
  const snapshotSeenRef = useRef(false);
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enrichMintsRef = useRef("");
  const orderRef = useRef(order);
  orderRef.current = order;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const filtersKey = JSON.stringify(filters ?? null);

  const render = () => {
    flushRef.current = null;
    const f = filtersRef.current;
    const gate = f && isFiltering(f) ? f : null;
    setTokens((prev) => {
      for (const t of prev) renderedRef.current.set(t.mint_address, t);
      const rows = [...boardRef.current.values()].map((t) => {
        const old = renderedRef.current.get(t.mint_address);
        return { t, old, view: old ? mergeLiveFrame(old, t) : t };
      });
      const wanted = (gate
        ? rows.filter((r) => passesFilters(r.view, gate, { optimistic: true }))
        : rows)
        .sort((a, b) => orderRef.current(a.view, b.view))
        .slice(0, MAX);
      const next = wanted.map(({ t, old, view }) => {
        if (!old) return t;
        // A row the live feed just added keeps its entry flag until rendered.
        if (t.isNew && !prev.some((p) => p.mint_address === t.mint_address)) view.isNew = true;
        return sameRow(old, view) ? old : view;
      });
      if (renderedRef.current.size > 500) {
        const keep = new Set(boardRef.current.keys());
        for (const k of renderedRef.current.keys()) if (!keep.has(k)) renderedRef.current.delete(k);
      }
      if (next.length === prev.length && next.every((t, i) => t === prev[i])) return prev;
      return next;
    });
  };

  const schedule = () => {
    if (flushRef.current != null) return;
    flushRef.current = setTimeout(render, FLUSH_MS);
  };
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  // Enrichment patches the rendered rows; re-pick the visible set after each
  // so a row that now fails a filter makes room.
  const setEnriched = useCallback<React.Dispatch<React.SetStateAction<TokenEvent[]>>>((u) => {
    setTokens(u);
    scheduleRef.current();
  }, []);

  // Reset + REST prime on chain / visibility change.
  useEffect(() => {
    boardRef.current = new Map();
    renderedRef.current = new Map();
    snapshotSeenRef.current = false;
    enrichMintsRef.current = "";
    setTokens([]);
    setError(null);
    if (!pageVisible) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(PRIME_LIMIT)
      .then((res) => {
        // The socket's snapshot is newer; a late REST answer must not undo it.
        if (cancelled || snapshotSeenRef.current) return;
        for (const t of res.data) {
          if (t.mint_address) boardRef.current.set(t.mint_address, t);
        }
        noteRows(event, res.data);
        render();
      })
      .catch((e) => {
        if (!cancelled && boardRef.current.size === 0) setError(friendlyFetchError(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, pageVisible]);

  // Live board.
  useEffect(() => {
    if (!pageVisible) return;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribe([event]);
    const off = ws.on(event, (msg) => {
      const kind = msg.kind;
      if (kind === "snapshot") {
        if (msg.chain && msg.chain !== chainId) return;
        const rows = Array.isArray(msg.rows) ? msg.rows as TokenEvent[] : [];
        const next = new Map<string, TokenEvent>();
        for (const t of rows) {
          if (!t.mint_address) continue;
          const had = boardRef.current.get(t.mint_address);
          next.set(t.mint_address, had ? mergeLiveFrame(had, t) : t);
        }
        boardRef.current = next;
        snapshotSeenRef.current = true;
        noteRows(event, rows);
        setError(null);
        setLoading(false);
        schedule();
        return;
      }
      const t = msg as unknown as TokenEvent & { kind?: string; type?: string; board?: string };
      const mint = t.mint_address;
      if (!mint || (t.chain && t.chain !== chainId)) return;
      if (kind === "remove") {
        if (boardRef.current.delete(mint)) schedule();
        return;
      }
      const { kind: _k, type: _t, board: _b, ...row } = t;
      const had = boardRef.current.get(mint);
      boardRef.current.set(mint, had ? mergeLiveFrame(had, row) : { ...row, isNew: kind === "add" });
      noteRows(event, [row]);
      schedule();
    });
    return () => {
      off();
      ws.unsubscribe([event]);
      if (flushRef.current != null) {
        clearTimeout(flushRef.current);
        flushRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, chainId, pageVisible]);

  // Re-pick the visible rows when the filters change (no refetch needed).
  useEffect(() => {
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  // New rows in view: their metadata (socials a board row may lack). Rendered
  // rows tell the filter modal what exists.
  useEffect(() => {
    noteRows(event, tokens);
    const mintsKey = tokens.map((t) => t.mint_address).join(",");
    if (mintsKey === enrichMintsRef.current) return;
    const before = new Set(enrichMintsRef.current.split(","));
    enrichMintsRef.current = mintsKey;
    if (tokens.some((t) => !before.has(t.mint_address))) setEnrichKey((k) => k + 1);
  }, [event, tokens]);

  useMetaEnrichment(tokens, setEnriched, MAX, enrichKey);

  return { tokens, loading: pageVisible ? loading : false, error };
}

const ms = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);

/** Ties by address ascending: the API's total order on every board. */
const byAddress = (a: TokenEvent, b: TokenEvent) =>
  a.mint_address < b.mint_address ? -1 : a.mint_address > b.mint_address ? 1 : 0;

/** Newest launch first. */
export const byCreated = (a: TokenEvent, b: TokenEvent) =>
  ms(b.created_at) - ms(a.created_at) || byAddress(a, b);

/** Fullest curve first, then newest — the API's own `graduating` order. */
export const byProgress = (a: TokenEvent, b: TokenEvent) =>
  (b.graduationPercent ?? 0) - (a.graduationPercent ?? 0) || byCreated(a, b);

/** Latest graduation first (every graduated row has its time). */
export const byGraduated = (a: TokenEvent, b: TokenEvent) =>
  ms(b.migrated_at) - ms(a.migrated_at) || byAddress(a, b);
