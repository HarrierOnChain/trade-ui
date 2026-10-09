"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTrades, fetchTradesBySignerMint } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { friendlyFetchError } from "../api/chainError";
import { num } from "../api/mappers";
import { addLiveTrade, dropRetracted, mergeTradeBatch } from "../lib/trades";
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

function tradeTimestampMs(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!isNaN(n) && n > 0) return n > 1e15 ? n / 1000 : n > 1e12 ? n : n * 1000;
  return new Date(raw as string).getTime();
}

function sortTrades(trades: Trade[], sort: "asc" | "desc"): Trade[] {
  return [...trades].sort((a, b) => {
    const ta = tradeTimestampMs(a.timestamp);
    const tb = tradeTimestampMs(b.timestamp);
    return sort === "asc" ? ta - tb : tb - ta;
  });
}

function normalizeWsTrade(msg: Record<string, unknown>): Trade | null {
  const inner =
    (msg.transaction && typeof msg.transaction === "object" && !Array.isArray(msg.transaction))
      ? (msg.transaction as Record<string, unknown>)
      : (msg.data && typeof msg.data === "object" && !Array.isArray(msg.data))
        ? (msg.data as Record<string, unknown>)
        : msg;

  const tokenMint = String(
    inner.tokenMint ?? inner.token_mint ?? inner.mint ?? inner.address ?? msg.tokenMint ?? ""
  );
  if (!tokenMint) return null;

  return {
    signature:       String(inner.signature       ?? msg.signature       ?? ""),
    tokenMint,
    signer:          String(inner.signer ?? inner.wallet ?? msg.signer ?? msg.wallet ?? ""),
    transactionType: ((): "buy" | "sell" => {
      const raw = String(inner.transactionType ?? inner.transaction_type ?? inner.type ?? msg.transactionType ?? "buy");
      return raw.toLowerCase() === "sell" ? "sell" : "buy";
    })(),
    tokensAmount:    Number(inner.tokensAmount     ?? inner.tokenAmount   ?? 0),
    avgPrice:        num(inner.avgPrice ?? inner.avg_price) ?? null,
    solAmount:       num(inner.solAmount ?? inner.sol_amount) ?? null,
    timestamp:       (inner.timestamp ?? msg.timestamp ?? Date.now()) as string | number,
    usdValue:        inner.usdValue != null ? Number(inner.usdValue) : undefined,
    avgPriceUSD:     inner.avgPriceUSD != null ? Number(inner.avgPriceUSD) : undefined,
    marketCap:       inner.marketCap != null ? Number(inner.marketCap) : undefined,
    isBundle:        Boolean(inner.isBundle        ?? inner.is_bundle),
    isSniper:        Boolean(inner.isSniper        ?? inner.is_sniper),
    isProTrader:     Boolean(inner.isProTrader     ?? inner.proTrade       ?? inner.pro_trade),
    tags:            Array.isArray(inner.tags) ? inner.tags.map((t) => String(t).toLowerCase()) : undefined,
  };
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

  // Initial / filter-change fetch — re-runs whenever sort flips so the
  // server returns the actually-oldest trades, not just "oldest among the
  // first page of desc". asc pagination uses `time >` predicate server-side.
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

    function handleTrade(msg: Record<string, unknown>) {
      const trade = normalizeWsTrade(msg);
      if (!trade || trade.tokenMint !== mint) return;
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
      const gone = msg.rows as { signature: string; wallet: string }[];
      setTrades((prev) => dropRetracted(prev, gone));
    }

    const unsub1 = ws.on("trade",          handleTrade);
    const unsub2 = ws.on("trade_snapshot", handleSnapshot);
    const unsub4 = ws.on("trade_retract",  handleRetract);

    return () => {
      unsub1();
      unsub2();
      unsub4();
      ws.unsubscribeToken(mint, ["trades"], { sse: true });
      prevMint.current = null;
    };
  }, [mint, signer, sort, timeFilterActive]);

  return { trades, loading, loadingMore, hasMore, morePaused, error, loadMore };
}
