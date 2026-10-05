"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWalletTrades } from "../api/client";
import { toArray } from "../api/normalize";
import { RazeWebSocket } from "../api/websocket";
import type { Trade } from "../types";

/**
 * Where a tracked wallet originates. The Tracker keeps these
 * separate so the UI can label rows, filter by source, and route
 * management actions to the correct registry:
 *
 *   "user"      → mirror of /portfolio's wallet manager
 *   "watchlist" → external addresses the user is monitoring
 */
export type WalletSource = "user" | "watchlist";

/**
 * Tracked wallet definition (passed in from the page).
 */
export interface TrackedWallet {
  id: string;
  address: string;
  label: string;
  source: WalletSource;
}

/**
 * A single tracker alert — either a historical trade pulled from
 * `/wallets/{chain}/{address}/trades` or a live trade pushed over the
 * WebSocket's `wallet` channel.
 */
export interface TrackerAlert {
  /** Stable id (signature + signer + tokenMint + side); used as React key. */
  id: string;
  /** Address that signed the trade. */
  signer: string;
  /** Friendly wallet label. */
  walletLabel: string;
  /** Wallet entry id from the parent registry. */
  walletId: string;
  /** Whether the originating wallet is the user's own or a watchlist entry. */
  walletSource: WalletSource;
  /** Token mint that was traded. */
  tokenMint: string;
  /** Trade direction. */
  side: "buy" | "sell";
  /** SOL amount swapped. */
  solAmount: number;
  /** Token amount transacted. */
  tokensAmount: number;
  /** USD value if the API resolved a price. */
  usdValue?: number;
  /** Token market cap at the time of the trade. */
  marketCap?: number;
  /** Tx signature. */
  signature: string;
  /** Unix ms of the trade event. */
  timestamp: number;
  /** Whether the alert arrived via WebSocket (vs REST seed). */
  live: boolean;
  /** True for the first ~6s after a live alert arrives. */
  isNew?: boolean;
}

interface Options {
  /** Cap on stored alerts across all tracked wallets. */
  maxAlerts?: number;
  /** REST page size when seeding history per wallet. */
  seedLimit?: number;
  /** Store an alert feed in hook state. Disable for callback-only consumers. */
  storeAlerts?: boolean;
  /** Optional callback fired once for every fresh live alert. */
  onLive?: (alert: TrackerAlert) => void;
}

const DEFAULT_MAX = 250;
const DEFAULT_SEED = 25;
const NEW_BADGE_MS = 6_000;

/** Coerce the polymorphic `Trade.timestamp` (string ISO or numeric s/ms) to ms. */
function tradeMs(raw: Trade["timestamp"]): number {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return 0;
    return raw > 1e12 ? raw : raw * 1000;
  }
  const n = Date.parse(String(raw ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function alertId(t: { signature?: string; tokenMint?: string; transactionType?: string; signer?: string; timestamp?: number }) {
  // The signer is part of it: two tracked wallets co-signing one transaction
  // are two alerts.
  if (t.signature) return `${t.signature}:${t.signer}:${t.tokenMint}:${t.transactionType}`;
  return `${t.signer}:${t.tokenMint}:${t.transactionType}:${t.timestamp}`;
}

/** Convert a REST/WS Trade into a TrackerAlert anchored to a wallet. */
function tradeToAlert(
  trade: Trade,
  wallet: TrackedWallet,
  live: boolean,
): TrackerAlert | null {
  if (!trade.tokenMint) return null;
  const ts = tradeMs(trade.timestamp);
  return {
    id: alertId({
      signature: trade.signature,
      tokenMint: trade.tokenMint,
      transactionType: trade.transactionType,
      signer: trade.signer || wallet.address,
      timestamp: ts,
    }),
    signer: trade.signer || wallet.address,
    walletLabel: wallet.label,
    walletId: wallet.id,
    walletSource: wallet.source,
    tokenMint: trade.tokenMint,
    side: trade.transactionType === "sell" ? "sell" : "buy",
    solAmount: Number(trade.solAmount) || 0,
    tokensAmount: Number(trade.tokensAmount) || 0,
    usdValue: typeof trade.usdValue === "number" ? trade.usdValue : undefined,
    marketCap: typeof trade.marketCap === "number" ? trade.marketCap : undefined,
    signature: String(trade.signature ?? ""),
    timestamp: ts || Date.now(),
    live,
  };
}

export interface UseTrackerStream {
  alerts: TrackerAlert[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Wallet address → number of alerts currently in the buffer. */
  countsByWallet: Record<string, number>;
  /** Per-source alert counts (mirrors the `WalletSource` discriminator). */
  countsBySource: Record<WalletSource, number>;
  /** Total alerts received over WS for the current session (resets on refresh). */
  liveCount: number;
  connected: boolean;
}

/**
 * Subscribe to the Raze streaming WebSocket for a list of tracked wallets and
 * seed the alert feed with their most recent historical trades. The hook is
 * defensive about duplicates (signature+side+mint), and emits a transient
 * `isNew` badge for every WS alert.
 */
export function useTrackerStream(
  wallets: TrackedWallet[],
  options: Options = {},
): UseTrackerStream {
  const {
    maxAlerts = DEFAULT_MAX,
    seedLimit = DEFAULT_SEED,
    storeAlerts = true,
    onLive,
  } = options;

  const [alerts, setAlerts] = useState<TrackerAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const [connected, setConnected] = useState(false);

  // Stable map of address → wallet so the WS handler can resolve labels
  // without re-running the subscribe effect on every label edit. When the
  // same address appears in both `user` and `watchlist` sources the user
  // entry wins so alerts get the user's chosen label.
  const walletByAddrRef = useRef<Map<string, TrackedWallet>>(new Map());
  useEffect(() => {
    const m = new Map<string, TrackedWallet>();
    for (const w of wallets) {
      if (!w.address) continue;
      const existing = m.get(w.address);
      if (existing && existing.source === "user") continue;
      m.set(w.address, w);
    }
    walletByAddrRef.current = m;
  }, [wallets]);

  // Sorted, deduped list of tracked addresses — used as the dependency key
  // so the WS subscribe effect only re-runs when the actual address set
  // changes (label edits / source flips don't reopen subscriptions).
  const addressKey = useMemo(
    () =>
      Array.from(
        new Set(wallets.map((w) => w.address).filter(Boolean) as string[]),
      )
        .sort()
        .join(","),
    [wallets],
  );

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  // Dedupe live events across the `trade` and `transaction` WS channels
  // (the backend may emit both for the same swap) and across effect re-runs.
  const seenLiveIdsRef = useRef<Set<string>>(new Set());

  // ── REST seed ────────────────────────────────────────────────────────────
  useEffect(() => {
    // Callers that already render historical trades (e.g. the Portfolio page
    // pulls them via usePortfolioScope) can opt out of the REST seed by
    // passing seedLimit: 0 — the WS stream still fills `alerts` with live
    // events but we skip the redundant per-wallet history fetch.
    if (!storeAlerts || seedLimit <= 0) {
      if (storeAlerts) setAlerts([]);
      setLoading(false);
      setError(null);
      return;
    }
    // De-dup by address so the same wallet listed under both "user" and
    // "watchlist" sources only triggers one REST call.
    const live: TrackedWallet[] = [];
    const seenAddr = new Set<string>();
    for (const w of wallets) {
      if (!w.address || seenAddr.has(w.address)) continue;
      seenAddr.add(w.address);
      live.push(w);
    }
    if (live.length === 0) {
      setAlerts([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.allSettled(
      live.map((w) =>
        fetchWalletTrades(w.address, seedLimit).then(
          (res) => ({ wallet: w, trades: toArray<Trade>(res) }),
        ),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const next: TrackerAlert[] = [];
        const seen = new Set<string>();
        let anyError = false;
        for (const r of results) {
          if (r.status === "rejected") {
            anyError = true;
            continue;
          }
          for (const t of r.value.trades) {
            const a = tradeToAlert(t, r.value.wallet, false);
            if (!a || seen.has(a.id)) continue;
            seen.add(a.id);
            next.push(a);
          }
        }
        next.sort((x, y) => y.timestamp - x.timestamp);
        setAlerts(next.slice(0, maxAlerts));
        if (anyError && next.length === 0) {
          setError("Failed to load trade history.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [addressKey, refreshTick, maxAlerts, seedLimit, storeAlerts, wallets]);

  // ── WS signer subscriptions ──────────────────────────────────────────────
  useEffect(() => {
    const addresses = addressKey ? addressKey.split(",").filter(Boolean) : [];
    if (addresses.length === 0) {
      setConnected(false);
      return;
    }

    seenLiveIdsRef.current.clear();

    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeSigners(addresses);
    setConnected(true);

    // The API's `wallet` channel (Solana): a snapshot of recent swaps on every
    // (re)subscribe — it fills whatever a reconnect missed — then one frame
    // per swap. EVM wallets have no live channel; their feed is the REST seed.
    const handler = (msg: Record<string, unknown>) => {
      const wallet = walletByAddrRef.current.get(String(msg.wallet ?? ""));
      if (!wallet) return; // not one of ours (or unsubscribed meanwhile)

      if (msg.snapshot === true) {
        const trades = Array.isArray(msg.trades) ? msg.trades as Trade[] : [];
        const seed = trades
          .map((t) => tradeToAlert(t, wallet, false))
          .filter((a): a is TrackerAlert => a != null);
        for (const a of seed) seenLiveIdsRef.current.add(a.id);
        if (!storeAlerts || seed.length === 0) return;
        setAlerts((prev) => {
          const have = new Set(prev.map((a) => a.id));
          const fresh = seed.filter((a) => !have.has(a.id));
          if (fresh.length === 0) return prev;
          return [...prev, ...fresh]
            .sort((x, y) => y.timestamp - x.timestamp)
            .slice(0, maxAlerts);
        });
        return;
      }

      const trade = msg.trade as Trade | undefined;
      if (!trade) return;
      const alert = tradeToAlert(trade, wallet, true);
      if (!alert) return;

      // Skip duplicate deliveries (a snapshot re-sends recent swaps).
      if (seenLiveIdsRef.current.has(alert.id)) return;
      seenLiveIdsRef.current.add(alert.id);
      if (seenLiveIdsRef.current.size > 500) seenLiveIdsRef.current.clear();

      if (storeAlerts) {
        setAlerts((prev) => {
          if (prev.some((a) => a.id === alert.id)) return prev;
          return [{ ...alert, isNew: true }, ...prev].slice(0, maxAlerts);
        });
        setLiveCount((n) => n + 1);
      }
      onLive?.(alert);

      // Drop the `isNew` badge after a beat so the row stops flashing.
      if (storeAlerts) {
        window.setTimeout(() => {
          setAlerts((prev) =>
            prev.map((a) => (a.id === alert.id ? { ...a, isNew: false } : a)),
          );
        }, NEW_BADGE_MS);
      }
    };

    const off = ws.on("wallet_trade", handler);

    return () => {
      off();
      ws.unsubscribeSigners(addresses);
      seenLiveIdsRef.current.clear();
      setConnected(false);
    };
  }, [addressKey, maxAlerts, onLive, storeAlerts]);

  const countsByWallet = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of alerts) counts[a.walletId] = (counts[a.walletId] ?? 0) + 1;
    return counts;
  }, [alerts]);

  const countsBySource = useMemo(() => {
    const counts: Record<WalletSource, number> = { user: 0, watchlist: 0 };
    for (const a of alerts) counts[a.walletSource] += 1;
    return counts;
  }, [alerts]);

  return {
    alerts,
    loading,
    error,
    refresh,
    countsByWallet,
    countsBySource,
    liveCount,
    connected,
  };
}
