"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { fetchHolders } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { toArray } from "../api/normalize";
import type { Holder } from "../types";

/** Hard cap on the holders list to keep the UI responsive. Matches the REST limit. */
const MAX_HOLDERS = 200;
/** Coalesce WS trades into a single re-sort + setState every FLUSH_MS. */
const FLUSH_MS = 120;

/** Extension of Holder that lets the table flag freshly-promoted entries. */
export type LiveHolder = Holder & { isNew?: boolean };

type WsTrade = {
  tokenMint: string;
  signer: string;
  type: "buy" | "sell";
  tokens: number;
  sol: number;
  avgPrice: number;
  tsIso: string;
  /** Dedup key when the same swap is emitted on trade + transaction channels. */
  dedupKey: string;
};

function holderPct(amount: number, supply: number): number {
  if (supply <= 0 || amount <= 0) return 0;
  return (amount / supply) * 100;
}

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
  const tokens  = Number(inner.tokensAmount ?? inner.tokenAmount ?? inner.token_amount ?? 0);
  const sol     = Number(inner.solAmount ?? inner.sol_amount ?? 0);
  const avgPrice = Number(inner.avgPrice ?? inner.avg_price ?? 0);
  const ts = inner.timestamp ?? msg.timestamp;
  const tsIso = typeof ts === "string" ? ts : new Date(typeof ts === "number" ? ts : Date.now()).toISOString();
  const signature = String(inner.signature ?? inner.txSignature ?? msg.signature ?? "");
  const dedupKey = signature
    ? `${signature}:${signer}:${rawType}`
    : `${signer}:${rawType}:${tokens}:${sol}:${tsIso}`;
  return {
    tokenMint,
    signer,
    type: rawType === "sell" ? "sell" : "buy",
    tokens,
    sol,
    avgPrice,
    tsIso,
    dedupKey,
  };
}

export function useHolders(mint: string | null) {
  const [holders, setHolders] = useState<LiveHolder[]>([]);
  const [currentPriceSol, setCurrentPriceSol] = useState(0);
  const [supply, setSupply] = useState(1_000_000_000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Holders newly promoted from WS since this mint was loaded.
  const [newHoldersCount, setNewHoldersCount] = useState(0);

  const load = useCallback(async () => {
    if (!mint) return;
    try {
      const holdersRes = await fetchHolders(mint, 200);
      // Standard Solana memecoin supply is 1B. If the API has none (or
      // something implausibly small), fall back to 1B so we don't divide by
      // it and blow percentages up to millions of %.
      const rawSupply = holdersRes.supply ?? 0;
      const resolvedSupply = rawSupply >= 1_000_000 ? rawSupply : 1_000_000_000;
      const list = toArray<Holder>(holdersRes).map((h, i) => ({
        ...h,
        rank: h.rank ?? i + 1,
        // The API's share of supply; our own division only when it has none.
        percentage: h.percentage > 0 ? h.percentage : holderPct(h.amount, resolvedSupply),
      }));
      setSupply(resolvedSupply);
      // holders endpoint returns currentPriceSol (latest trade avg_price) at
      // the top level — used for PnL so we don't depend on marketCap/stats.
      const price = Number(
        (holdersRes as { currentPriceSol?: unknown })?.currentPriceSol ?? 0
      );
      setCurrentPriceSol(isFinite(price) ? price : 0);
      setHolders(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    if (!mint) {
      setHolders([]);
      setCurrentPriceSol(0);
      setLoading(false);
      setNewHoldersCount(0);
      return;
    }
    setLoading(true);
    setHolders([]);
    setNewHoldersCount(0);
    load();
  }, [load, mint]);

  // supply is set async after first load; keep a ref so the WS handler below
  // always sees the latest value without re-subscribing on every update.
  const supplyRef = useRef(supply);
  useEffect(() => { supplyRef.current = supply; }, [supply]);

  // Fold live trades into holders.
  //  - Existing holder: update balance, re-sort, re-rank.
  //  - Unknown signer: accumulate inferred balance in `pendingNewRef`. Once it
  //    crosses the smallest amount in the current top-N (or list size < cap),
  //    promote it into `holders` with `isNew: true` so the table can highlight.
  // Net-zero / sell-only signers never enter the list.
  const pendingNewRef = useRef<Map<string, {
    amount: number;
    buySol: number; sellSol: number;
    trades: number; buyCount: number; sellCount: number;
    lastTrade: string;
  }>>(new Map());

  useEffect(() => {
    pendingNewRef.current = new Map();
  }, [mint]);

  // Coalesce bursts of WS trades into a single sort+setState every FLUSH_MS.
  // Without this, a high-volume token caused 100+ sorts/sec across 200 holders.
  const pendingTradesRef = useRef<WsTrade[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPriceRef = useRef(0);
  const promotedCountRef = useRef(0);

  useEffect(() => {
    if (!mint) return;
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeToken(mint);

    const flush = () => {
      flushTimerRef.current = null;
      const pendingRaw = pendingTradesRef.current;
      if (pendingRaw.length === 0) return;
      pendingTradesRef.current = [];
      const supplyNow = supplyRef.current || 1_000_000_000;

      // A swap can arrive twice (a snapshot replay after a reconnect).
      const seen = new Set<string>();
      const pending: WsTrade[] = [];
      for (const t of pendingRaw) {
        if (seen.has(t.dedupKey)) continue;
        seen.add(t.dedupKey);
        pending.push(t);
      }

      // Apply price + promotion-count side effects in one batched render.
      if (latestPriceRef.current > 0) {
        const p = latestPriceRef.current;
        latestPriceRef.current = 0;
        setCurrentPriceSol(p);
      }

      setHolders((prev) => {
        let next = prev;
        let mutated = false;

        for (const t of pending) {
          const isBuy = t.type === "buy";
          const idx = next.findIndex((h) => h.address === t.signer);

          // Path A: existing holder.
          if (idx !== -1) {
            if (!mutated) {
              next = next.slice();
              mutated = true;
            }
            const h = next[idx];
            const newAmount = Math.max(0, h.amount + (isBuy ? t.tokens : -t.tokens));
            next[idx] = {
              ...h,
              amount:     newAmount,
              buySol:     (h.buySol    ?? 0) + (isBuy ? t.sol : 0),
              sellSol:    (h.sellSol   ?? 0) + (isBuy ? 0 : t.sol),
              trades:     (h.trades    ?? 0) + 1,
              buyCount:   (h.buyCount  ?? 0) + (isBuy ? 1 : 0),
              sellCount:  (h.sellCount ?? 0) + (isBuy ? 0 : 1),
              lastTrade:  t.tsIso,
              percentage: holderPct(newAmount, supplyNow),
            };
            continue;
          }

          // Path B: unknown signer — accumulate, maybe promote.
          const pend = pendingNewRef.current.get(t.signer) ?? {
            amount: 0, buySol: 0, sellSol: 0,
            trades: 0, buyCount: 0, sellCount: 0,
            lastTrade: t.tsIso,
          };
          pend.amount    = Math.max(0, pend.amount + (isBuy ? t.tokens : -t.tokens));
          pend.buySol   += isBuy ? t.sol : 0;
          pend.sellSol  += isBuy ? 0 : t.sol;
          pend.trades   += 1;
          pend.buyCount += isBuy ? 1 : 0;
          pend.sellCount += isBuy ? 0 : 1;
          pend.lastTrade = t.tsIso;
          pendingNewRef.current.set(t.signer, pend);

          const bottomAmount = next.length >= MAX_HOLDERS
            ? (next[next.length - 1]?.amount ?? 0)
            : 0;
          if (pend.amount <= 0 || pend.amount <= bottomAmount) continue;

          const promoted: LiveHolder = {
            address:    t.signer,
            amount:     pend.amount,
            percentage: holderPct(pend.amount, supplyNow),
            rank:       0,
            buySol:     pend.buySol,
            sellSol:    pend.sellSol,
            trades:     pend.trades,
            buyCount:   pend.buyCount,
            sellCount:  pend.sellCount,
            lastTrade:  pend.lastTrade,
            isNew:      true,
          };
          pendingNewRef.current.delete(t.signer);
          promotedCountRef.current += 1;

          if (!mutated) {
            next = next.slice();
            mutated = true;
          }
          next.push(promoted);
        }

        if (!mutated) return prev;

        next.sort((a, b) => b.amount - a.amount);
        if (next.length > MAX_HOLDERS) next.length = MAX_HOLDERS;
        // Preserve object identity for holders whose rank didn't change so
        // memoized rows can skip re-rendering.
        for (let i = 0; i < next.length; i++) {
          const expected = i + 1;
          if (next[i].rank !== expected) {
            next[i] = { ...next[i], rank: expected };
          }
        }
        return next;
      });

      if (promotedCountRef.current > 0) {
        const n = promotedCountRef.current;
        promotedCountRef.current = 0;
        setNewHoldersCount((c) => c + n);
      }
    };

    const apply = (msg: Record<string, unknown>) => {
      const t = extractTrade(msg);
      if (!t || t.tokenMint !== mint) return;
      if (t.avgPrice > 0) latestPriceRef.current = t.avgPrice;
      pendingTradesRef.current.push(t);
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = setTimeout(flush, FLUSH_MS);
    };

    const offTrade       = ws.on("trade",       apply);
    return () => {
      offTrade();
      ws.unsubscribeToken(mint);
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingTradesRef.current = [];
      latestPriceRef.current = 0;
      promotedCountRef.current = 0;
    };
  }, [mint]);

  return { holders, currentPriceSol, supply, loading, error, refresh: load, newHoldersCount };
}
