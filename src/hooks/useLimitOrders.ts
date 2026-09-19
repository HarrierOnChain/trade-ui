"use client";
/**
 * Backend-backed limit-order list. The price-watcher in the primary
 * region watches active LimitOrder rows and fires them when the token's
 * mcap crosses the user's target — the browser is just a CRUD client.
 *
 * Pass `mint` to scope the list to a single token (used by the trading
 * panel's history drawer). Omit it to read every active LimitOrder the
 * user has across tokens.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRegion } from "../contexts/RegionContext";
import { BackendClient, useSession, type LimitOrder } from "../api/backend";

const POLL_MS = 5_000;

/** What the drawer / chart line consumes. Targets the on-the-wire shape
 *  of a LimitOrder plus the historic `limitConfig.targetMcapUsd` accessor
 *  the trading-panel UI was already coded against. */
export interface LimitOrderView extends LimitOrder {
  limitConfig: { targetMcapUsd: number };
}

export interface UseLimitOrdersResult {
  orders: LimitOrderView[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: CreateLimitOrderInput) => Promise<LimitOrderView>;
  cancel: (id: string) => Promise<void>;
  /** Update the trigger mcap on an active order (chart-line drag). */
  update: (id: string, targetMcapUsd: number) => Promise<void>;
}

export interface CreateLimitOrderInput {
  side: "buy" | "sell";
  tokenMint: string;
  tokenSymbol?: string;
  /** Buy: SOL per wallet. Sell: percentage (0–100) per wallet. The route
   *  rejects sell amounts > 100. */
  amount: number;
  targetMcapUsd: number;
  /** Optional UI snapshot (mcap at create time). Not currently persisted
   *  on the new LimitOrder row — kept in the API to match the panel
   *  signature. */
  createdAtMcapUsd?: number;
  /** Trading panel passes a single wallet id per order (the active
   *  signing wallet). Multi-wallet fanout is gone in the new model — if
   *  more than one is supplied we POST one row per wallet. */
  walletIds: string[];
  slippageBps?: number;
  transactionsFeeLamports?: number;
}

export function useLimitOrders(mint?: string): UseLimitOrdersResult {
  const { region } = useRegion();
  const session = useSession();

  const client = useMemo(
    () => (session ? new BackendClient(region.baseUrl, session.token) : null),
    [region.baseUrl, session],
  );

  const [orders, setOrders] = useState<LimitOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!client) {
      setOrders([]);
      setLoading(false);
      return;
    }
    const myReq = ++reqIdRef.current;
    try {
      const res = await client.listLimitOrders(mint ? { mint } : {});
      if (reqIdRef.current !== myReq) return;
      setOrders(res.limitOrders.map(narrow));
      setError(null);
    } catch (e) {
      if (reqIdRef.current !== myReq) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  }, [client, mint]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    if (!client) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [client, refresh]);

  useEffect(() => {
    if (!client) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [client, refresh]);

  const create = useCallback(
    async (input: CreateLimitOrderInput): Promise<LimitOrderView> => {
      if (!client) throw new Error("not signed in");
      // Pre-position LimitOrders are single-wallet rows on the backend.
      // The trading panel only ever sends one id today; if multiple come
      // through, POST each and return the first to keep the panel
      // happy. The drawer re-polls and sees them all.
      if (input.walletIds.length === 0) throw new Error("missing_wallet");
      const wallets = input.walletIds;
      const created = await client.createLimitOrder({
        walletId: wallets[0],
        side: input.side,
        mint: input.tokenMint,
        symbol: input.tokenSymbol,
        triggerMcapUsd: input.targetMcapUsd,
        amount: input.amount,
        slippageBps: input.slippageBps,
        transactionsFeeLamports: input.transactionsFeeLamports,
      });
      // Fan-out the rest in the background.
      for (let i = 1; i < wallets.length; i++) {
        void client.createLimitOrder({
          walletId: wallets[i],
          side: input.side,
          mint: input.tokenMint,
          symbol: input.tokenSymbol,
          triggerMcapUsd: input.targetMcapUsd,
          amount: input.amount,
          slippageBps: input.slippageBps,
          transactionsFeeLamports: input.transactionsFeeLamports,
        }).catch(() => {});
      }
      const view = narrow(created.limitOrder);
      setOrders((prev) => [view, ...prev.filter((o) => o.id !== view.id)]);
      return view;
    },
    [client],
  );

  const cancel = useCallback(
    async (id: string) => {
      if (!client) throw new Error("not signed in");
      await client.cancelLimitOrder(id);
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: "cancelled" } : o)));
    },
    [client],
  );

  const update = useCallback(
    async (id: string, targetMcapUsd: number) => {
      if (!client) throw new Error("not signed in");
      const updated = await client.updateLimitOrder(id, { triggerMcapUsd: targetMcapUsd });
      const view = narrow(updated.limitOrder);
      setOrders((prev) => prev.map((o) => (o.id === id ? view : o)));
    },
    [client],
  );

  return { orders, loading, error, refresh, create, cancel, update };
}

function narrow(r: LimitOrder): LimitOrderView {
  return {
    ...r,
    limitConfig: { targetMcapUsd: r.triggerMcapUsd },
  };
}
