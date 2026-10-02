"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchTrades, fetchTradesBySignerMint } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { friendlyFetchError } from "../api/chainError";
import { num } from "../api/mappers";
import { addLiveTrade, mergeTradeBatch } from "../lib/trades";
import { getPreviewData, isPreviewMint, isStreamOnly, subscribePreview } from "../lib/previewData";
import type { Trade } from "../types";

const PAGE = 50;
const CAP  = 500; // soft cap so infinite scroll can't balloon memory

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
  const cursorRef = useRef<string | null>(null);
  const prevMint = useRef<string | null>(null);
  const timeFilterActive = timeRangeActive(timeRange);
  const serverTimeFilter = timeFilterActive;

  // Preview-mode short-circuit: synthetic trades sourced from the deploy
  // form (one row per planned wallet buy). Re-subscribes whenever the
  // registry updates, so adding/removing a wallet in the form re-renders.
  const previewSnapshot = useSyncExternalStore(
    (cb) => (mint ? subscribePreview(mint, cb) : () => {}),
    () => (mint ? getPreviewData(mint) : null),
    () => null,
  );

  // Initial / filter-change fetch — re-runs whenever sort flips so the
  // server returns the actually-oldest trades, not just "oldest among the
  // first page of desc". asc pagination uses `time >` predicate server-side.
  useEffect(() => {
    if (!mint) {
      setTrades([]);
      setLoading(false);
      setHasMore(false);
      setError(null);
      cursorRef.current = null;
      return;
    }
    if (isPreviewMint(mint)) {
      setTrades(previewSnapshot?.trades ?? []);
      setLoading(false);
      setHasMore(false);
      setError(null);
      cursorRef.current = null;
      return;
    }
    // Stream-only (freshly-deployed) mint: no REST history — start empty; the
    // live WS feed (effect below) fills the table as trades land.
    if (isStreamOnly(mint)) {
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
  }, [mint, signer, sort, previewSnapshot, serverTimeFilter, timeRange?.fromMs, timeRange?.toMs]);

  // Page forward with the stored cursor (direction follows current sort)
  const loadMore = useCallback(async () => {
    if (!mint || loadingMore || !hasMore || !cursorRef.current) return;
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
    } catch (e) {
      setError(friendlyFetchError(e));
    } finally {
      setLoadingMore(false);
    }
  }, [mint, signer, sort, loadingMore, hasMore, serverTimeFilter, timeRange?.fromMs, timeRange?.toMs]);

  // WS live updates — only in the default newest-first view, and never
  // when a signer or time filter is applied (historical drill-down).
  useEffect(() => {
    // Preview mints don't exist on-chain, so no WS subscribe.
    if (!mint || signer || timeFilterActive || sort !== "desc" || isPreviewMint(mint)) return;

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

    function handleAnalysis(msg: Record<string, unknown>) {
      const data = (msg.data && typeof msg.data === "object" && !Array.isArray(msg.data))
        ? (msg.data as Record<string, unknown>)
        : msg;
      const sig = String(data.signature ?? msg.signature ?? "");
      // Flags belong to one wallet's row when the frame names it.
      const wallet = String(data.wallet ?? data.signer ?? "");
      const mintStr = String(data.mint ?? "");
      if (!sig || (mintStr && mintStr !== mint)) return;
      const isBundle = data.isBundle != null ? Boolean(data.isBundle) : undefined;
      const isSniper = data.isSniper != null ? Boolean(data.isSniper) : undefined;
      setTrades((prev) => prev.map((t) => {
        if (t.signature !== sig || (wallet && t.signer !== wallet)) return t;
        return {
          ...t,
          isBundle: isBundle || t.isBundle,
          isSniper: isSniper || t.isSniper,
        };
      }));
    }

    const unsub1 = ws.on("trade",          handleTrade);
    const unsub2 = ws.on("trade_snapshot", handleSnapshot);
    const unsub3 = ws.on("analysis",       handleAnalysis);

    return () => {
      unsub1();
      unsub2();
      unsub3();
      ws.unsubscribeToken(mint, ["trades"], { sse: true });
      prevMint.current = null;
    };
  }, [mint, signer, sort, timeFilterActive]);

  return { trades, loading, loadingMore, hasMore, error, loadMore };
}
