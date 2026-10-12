"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTrades, fetchTradesBySignerMint } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { friendlyFetchError } from "../api/chainError";
import { addLiveTrade, applyTradeTags, dropRetracted, mergeTradeBatch } from "../lib/trades";
import type { Trade } from "../types";

const PAGE = 50;
const CAP  = 500; // soft cap so infinite scroll can't balloon memory
// After a failed page, scroll-loading waits this long (the API's Retry-After
// on a 503), so a sentinel left in view can't retry in a tight loop.
const MORE_RETRY_MS = 2000;

export type TradeTimeRange = { fromMs?: number | null; toMs?: number | null };

function timeRangeActive(range?: TradeTimeRange | null): boolean {
  return (
    (range?.fromMs != null && isFinite(range.fromMs)) ||
    (range?.toMs != null && isFinite(range.toMs))
  );
}

type TradesResponse = {
  data?: Trade[];
  trades?: unknown[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

// Solana returns the camelCase contract under { data: [...] }.
function extractTrades(res: TradesResponse | null | undefined): Trade[] {
  return Array.isArray(res?.data) ? res!.data : [];
}

function sortTrades(trades: Trade[], sort: "asc" | "desc"): Trade[] {
  return [...trades].sort((a, b) =>
    sort === "asc" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
}

export function useTrades(
  mint: string | null,
  signer?: string | null,
  sort: "asc" | "desc" = "desc",
  timeRange?: TradeTimeRange | null,
) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [morePaused, setMorePaused] = useState(false);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorRef = useRef<string | null>(null);
  const prevMint = useRef<string | null>(null);
  const timeFilterActive = timeRangeActive(timeRange);
  const serverTimeFilter = timeFilterActive;

  const clearPause = useCallback(() => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = null;
    setMorePaused(false);
  }, []);
  useEffect(() => clearPause, [clearPause]);

  // Initial / filter-change fetch. The API pages newest first only (a time
  // range is its window): `sort` re-orders what is loaded.
  useEffect(() => {
    clearPause();
    if (!mint) {
      setTrades([]);
      setLoading(false);
      setHasMore(false);
      setError(null);
      cursorRef.current = null;
      return;
    }
    setLoading(true);
    setTrades([]);
    setHasMore(false);
    setError(null);
    cursorRef.current = null;

    const req = signer
      ? fetchTradesBySignerMint(signer, mint, PAGE, null, sort, serverTimeFilter ? timeRange ?? undefined : undefined)
      : fetchTrades(mint, PAGE, sort, null, serverTimeFilter ? timeRange ?? undefined : undefined);

    (req as Promise<TradesResponse>)
      .then((res) => {
        const incoming = extractTrades(res);
        setTrades((prev) =>
          sortTrades(mergeTradeBatch(prev, incoming), sort).slice(0, CAP),
        );
        cursorRef.current = res?.nextCursor ?? null;
        setHasMore(Boolean(res?.hasMore) && !!res?.nextCursor);
      })
      .catch((e) => setError(friendlyFetchError(e)))
      .finally(() => setLoading(false));
  }, [mint, signer, sort, serverTimeFilter, timeRange?.fromMs, timeRange?.toMs, clearPause]);

  // Page forward with the stored cursor (direction follows current sort)
  const loadMore = useCallback(async () => {
    if (!mint || loadingMore || morePaused || !hasMore || !cursorRef.current) return;
    setLoadingMore(true);
    try {
      const res = await (signer
        ? fetchTradesBySignerMint(
            signer,
            mint,
            PAGE,
            cursorRef.current,
            sort,
            serverTimeFilter ? timeRange ?? undefined : undefined,
          )
        : fetchTrades(
            mint,
            PAGE,
            sort,
            cursorRef.current,
            serverTimeFilter ? timeRange ?? undefined : undefined,
          )) as TradesResponse;
      const more = extractTrades(res);
      // The page is the authority for the transactions it names (overlap at
      // the page boundary included).
      setTrades((prev) => sortTrades(mergeTradeBatch(prev, more), sort).slice(0, CAP));
      cursorRef.current = res?.nextCursor ?? null;
      setHasMore(Boolean(res?.hasMore) && !!res?.nextCursor);
      setError(null);
    } catch (e) {
      // The cursor is kept: the retry asks for the same page.
      setError(friendlyFetchError(e));
      setMorePaused(true);
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
      pauseTimer.current = setTimeout(() => {
        pauseTimer.current = null;
        setMorePaused(false);
      }, MORE_RETRY_MS);
    } finally {
      setLoadingMore(false);
    }
  }, [mint, signer, sort, loadingMore, morePaused, hasMore, serverTimeFilter, timeRange?.fromMs, timeRange?.toMs]);

  // WS live updates — only in the default newest-first view, and never
  // when a signer or time filter is applied (historical drill-down).
  useEffect(() => {
    if (!mint || signer || timeFilterActive || sort !== "desc") return;

    const ws = RazeWebSocket.getInstance();
    ws.connect();

    if (prevMint.current && prevMint.current !== mint) {
      ws.unsubscribeToken(prevMint.current, ["trades"], { sse: true });
    }
    prevMint.current = mint;
    // The token being viewed: keep it streaming over SSE if the socket is down.
    ws.subscribeToken(mint, ["trades"], { sse: true });

    // websocket.ts dispatches the mapped Trade with its event fields.
    function handleTrade(msg: Record<string, unknown>) {
      const { type: _type, mint: _mint, wallet: _wallet, ...rest } = msg;
      const trade = rest as unknown as Trade;
      if (trade.tokenMint !== mint) return;
      setTrades((prev) => {
        const next = addLiveTrade(prev, trade);
        return next === prev ? prev : next.slice(0, CAP);
      });
    }

    // Sent on every (re)subscribe: after a reconnect it fills the gap.
    function handleSnapshot(msg: Record<string, unknown>) {
      if (msg.tokenMint !== mint || !Array.isArray(msg.trades)) return;
      const incoming = msg.trades as Trade[];
      if (!incoming.length) return;
      setTrades((prev) => sortTrades(mergeTradeBatch(prev, incoming), "desc").slice(0, CAP));
    }

    // Rows of a slot whose fork was lost go; the copy from the slot where
    // the transaction landed, if any, comes as a new trade.
    function handleRetract(msg: Record<string, unknown>) {
      if (msg.tokenMint !== mint || !Array.isArray(msg.rows)) return;
      const gone = msg.rows as { id: string }[];
      setTrades((prev) => dropRetracted(prev, gone));
    }

    // Tags the API learnt after it sent the rows (late flags, a maker's tags).
    function handleTags(msg: Record<string, unknown>) {
      if (msg.tokenMint !== mint || !Array.isArray(msg.rows)) return;
      const rows = msg.rows as { id: string; tags: string[] }[];
      setTrades((prev) => applyTradeTags(prev, rows));
    }

    const unsub1 = ws.on("trade",          handleTrade);
    const unsub2 = ws.on("trade_snapshot", handleSnapshot);
    const unsub4 = ws.on("trade_retract",  handleRetract);
    const unsub5 = ws.on("trade_tags",     handleTags);

    return () => {
      unsub1();
      unsub2();
      unsub4();
      unsub5();
      ws.unsubscribeToken(mint, ["trades"], { sse: true });
      prevMint.current = null;
    };
  }, [mint, signer, sort, timeFilterActive]);

  return { trades, loading, loadingMore, hasMore, morePaused, error, loadMore };
}
