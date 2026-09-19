"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { fetchTopTraders } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { toArray } from "../api/normalize";
import type { TopTrader } from "../types";

const MAX_TRADERS = 100;
/** Coalesce WS trades into a single re-sort + setState every FLUSH_MS. */
const FLUSH_MS = 120;

export type LiveTopTrader = TopTrader & { isNew?: boolean };

type WsTrade = {
  tokenMint: string;
  signer: string;
  type: "buy" | "sell";
  tokens: number;
  sol: number;
  avgPrice: number;
  tsIso: string;
};

function extractTrade(msg: Record<string, unknown>): WsTrade | null {
  const inner =
    msg.transaction && typeof msg.transaction === "object" && !Array.isArray(msg.transaction)
      ? (msg.transaction as Record<string, unknown>)
      : msg.data && typeof msg.data === "object" && !Array.isArray(msg.data)
      ? (msg.data as Record<string, unknown>)
      : msg;
  const tokenMint = String(
    inner.tokenMint ?? inner.token_mint ?? inner.mint ?? inner.address ?? msg.tokenMint ?? ""
  );
  const signer    = String(inner.signer ?? inner.wallet ?? msg.signer ?? msg.wallet ?? "");
  if (!tokenMint || !signer) return null;
  const rawType = String(inner.transactionType ?? inner.transaction_type ?? inner.type ?? "buy").toLowerCase();
  const tokens   = Number(inner.tokensAmount ?? inner.tokenAmount ?? inner.token_amount ?? 0);
  const sol      = Number(inner.solAmount ?? inner.sol_amount ?? 0);
  const avgPrice = Number(inner.avgPrice ?? inner.avg_price ?? 0);
  const ts = inner.timestamp ?? msg.timestamp;
  const tsIso = typeof ts === "string" ? ts : new Date(typeof ts === "number" ? ts : Date.now()).toISOString();
  return { tokenMint, signer, type: rawType === "sell" ? "sell" : "buy", tokens, sol, avgPrice, tsIso };
}

/** Recompute derived fields on a trader after a new trade has been folded in. */
function recompute(t: LiveTopTrader, solPrice: number): LiveTopTrader {
  const totalTrades = t.totalBuys + t.totalSells;
  const totalVolume = (t.buySol + t.sellSol) * (solPrice || 0);
  const pnlSol = t.sellSol - t.buySol;
  const totalPnL = pnlSol * (solPrice || 0);
  const avgTradeSize = totalTrades > 0 ? totalVolume / totalTrades : 0;
  const avgBuyPrice  = t.boughtTokens > 0 ? t.buySol / t.boughtTokens : 0;
  const avgSellPrice = t.soldTokens   > 0 ? t.sellSol / t.soldTokens : 0;
  const isHolding    = t.boughtTokens > t.soldTokens;
  return { ...t, totalTrades, totalVolume, totalPnL, pnlSol, avgTradeSize, avgBuyPrice, avgSellPrice, isHolding };
}

function blankTrader(addr: string, tsIso: string): LiveTopTrader {
  return {
    trader: addr,
    totalBuys: 0, totalSells: 0, totalTrades: 0,
    totalVolume: 0, totalPnL: 0, pnlSol: 0,
    avgTradeSize: 0, winRate: 0,
    buySol: 0, sellSol: 0,
    boughtTokens: 0, soldTokens: 0,
    avgBuyPrice: 0, avgSellPrice: 0,
    isHolding: false,
    firstTrade: tsIso, lastTrade: tsIso,
  };
}

export function useTopTraders(mint: string | null, solPriceUsd: number = 0) {
  const [traders, setTraders] = useState<LiveTopTrader[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTradersCount, setNewTradersCount] = useState(0);

  // Pending volume for unknown traders, accumulated until they qualify for top-N.
  const pendingRef = useRef<Map<string, LiveTopTrader>>(new Map());
  const solPriceRef = useRef(solPriceUsd);
  useEffect(() => { solPriceRef.current = solPriceUsd; }, [solPriceUsd]);

  const load = useCallback(async () => {
    if (!mint) return;
    try {
      const res = await fetchTopTraders(mint, MAX_TRADERS);
      const list = toArray<TopTrader>(res);
      setTraders(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    if (!mint) {
      setTraders([]);
      setLoading(false);
      setNewTradersCount(0);
      pendingRef.current = new Map();
      return;
    }
    setLoading(true);
    setTraders([]);
    setNewTradersCount(0);
    pendingRef.current = new Map();
    load();
  }, [load, mint]);

  // Coalesce WS trades into a single sort+setState every FLUSH_MS.
  const pendingTradesRef = useRef<WsTrade[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promotedCountRef = useRef(0);

  useEffect(() => {
    if (!mint) return;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeToken(mint);

    const flush = () => {
      flushTimerRef.current = null;
      const pending = pendingTradesRef.current;
      if (pending.length === 0) return;
      pendingTradesRef.current = [];
      const px = solPriceRef.current;

      setTraders((prev) => {
        let next = prev;
        let mutated = false;

        for (const t of pending) {
          const isBuy = t.type === "buy";
          const idx = next.findIndex((x) => x.trader === t.signer);

          if (idx !== -1) {
            if (!mutated) {
              next = next.slice();
              mutated = true;
            }
            const cur = next[idx];
            const merged: LiveTopTrader = {
              ...cur,
              totalBuys:    cur.totalBuys    + (isBuy ? 1 : 0),
              totalSells:   cur.totalSells   + (isBuy ? 0 : 1),
              buySol:       cur.buySol       + (isBuy ? t.sol    : 0),
              sellSol:      cur.sellSol      + (isBuy ? 0        : t.sol),
              boughtTokens: cur.boughtTokens + (isBuy ? t.tokens : 0),
              soldTokens:   cur.soldTokens   + (isBuy ? 0        : t.tokens),
              lastTrade:    t.tsIso,
              largestTrade: Math.max(cur.largestTrade ?? 0, t.sol * (px || 0)),
            };
            next[idx] = recompute(merged, px);
            continue;
          }

          const pend = pendingRef.current.get(t.signer) ?? blankTrader(t.signer, t.tsIso);
          const updated: LiveTopTrader = recompute({
            ...pend,
            totalBuys:    pend.totalBuys    + (isBuy ? 1 : 0),
            totalSells:   pend.totalSells   + (isBuy ? 0 : 1),
            buySol:       pend.buySol       + (isBuy ? t.sol    : 0),
            sellSol:      pend.sellSol      + (isBuy ? 0        : t.sol),
            boughtTokens: pend.boughtTokens + (isBuy ? t.tokens : 0),
            soldTokens:   pend.soldTokens   + (isBuy ? 0        : t.tokens),
            lastTrade:    t.tsIso,
            largestTrade: Math.max(pend.largestTrade ?? 0, t.sol * (px || 0)),
          }, px);
          pendingRef.current.set(t.signer, updated);

          const bottomVol = next.length >= MAX_TRADERS
            ? (next[next.length - 1]?.totalVolume ?? 0)
            : 0;
          if ((updated.totalVolume ?? 0) <= bottomVol) continue;

          pendingRef.current.delete(t.signer);
          promotedCountRef.current += 1;
          if (!mutated) {
            next = next.slice();
            mutated = true;
          }
          next.push({ ...updated, isNew: true });
        }

        if (!mutated) return prev;

        next.sort((a, b) => (b.totalVolume ?? 0) - (a.totalVolume ?? 0));
        if (next.length > MAX_TRADERS) next.length = MAX_TRADERS;
        return next;
      });

      if (promotedCountRef.current > 0) {
        const n = promotedCountRef.current;
        promotedCountRef.current = 0;
        setNewTradersCount((c) => c + n);
      }
    };

    const apply = (msg: Record<string, unknown>) => {
      const t = extractTrade(msg);
      if (!t || t.tokenMint !== mint) return;
      pendingTradesRef.current.push(t);
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = setTimeout(flush, FLUSH_MS);
    };

    const offTrade       = ws.on("trade",       apply);
    const offTransaction = ws.on("transaction", apply);
    return () => {
      offTrade();
      offTransaction();
      ws.unsubscribeToken(mint);
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingTradesRef.current = [];
      promotedCountRef.current = 0;
    };
  }, [mint]);

  return { traders, loading, error, refresh: load, newTradersCount };
}
