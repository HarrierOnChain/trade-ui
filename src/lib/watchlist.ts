"use client";

/* ─────────────────────────────────────────────────────────────
   Token watchlist registry
   A user-owned set of pinned (starred) token mints, shown in
   the ticker bar and the footer. Each entry stores a snapshot
   of the TokenEvent at add-time so it renders immediately
   without re-fetching; live prices come in via the standard
   useLiveTradePrices hook.

   Mirrors `hiddenTokens.ts` for storage semantics — a single
   localStorage key, cross-tab sync via the `storage` event,
   plus an in-process subscriber set so the originating tab
   sees its own writes.
   ───────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CHAIN_CHANGED_EVENT, getActiveChain, coerceChainId, type ChainId } from "../lib/chains";
import type { TokenEvent } from "../types";

export const WATCHLIST_STORAGE_KEY = "trade.watchlist.v1";

/** Legacy entries (pre chain-scoping) and anything unrecognized are Solana. */
function coerceChain(v: unknown): ChainId {
  return coerceChainId(v);
}

export interface WatchlistEntry {
  mint: string;
  addedAt: string; // ISO timestamp
  chainId: ChainId; // chain the token belongs to (mints don't collide cross-chain)
  snapshot: TokenEvent;
}

type WatchMap = Record<string, WatchlistEntry>;

function isTokenEvent(v: unknown): v is TokenEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.mint_address === "string" && e.mint_address.length > 0;
}

function readStorage(): WatchMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: WatchMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!k || typeof k !== "string") continue;
      if (!v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      const snap = e.snapshot;
      if (!isTokenEvent(snap)) continue;
      out[k] = {
        mint: typeof e.mint === "string" ? e.mint : snap.mint_address,
        addedAt: typeof e.addedAt === "string" ? e.addedAt : new Date().toISOString(),
        chainId: coerceChain(e.chainId),
        snapshot: snap,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeStorage(map: WatchMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

const inProcessListeners = new Set<() => void>();
function notifyInProcess() {
  inProcessListeners.forEach((fn) => fn());
}

export interface UseWatchlist {
  entries: WatchlistEntry[];
  watchedMints: Set<string>;
  count: number;
  isWatched: (mint: string | null | undefined) => boolean;
  add: (snapshot: TokenEvent) => void;
  remove: (mint: string) => void;
  clear: () => void;
}

/** Reactive view + mutator API for the watchlist. */
export function useWatchlist(): UseWatchlist {
  const [map, setMap] = useState<WatchMap>({});
  const [chain, setChain] = useState<ChainId>("sol");

  useEffect(() => {
    setMap(readStorage());
    setChain(getActiveChain());
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCHLIST_STORAGE_KEY) setMap(readStorage());
    };
    const onLocal = () => setMap(readStorage());
    const onChain = () => setChain(getActiveChain());
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHAIN_CHANGED_EVENT, onChain);
    inProcessListeners.add(onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHAIN_CHANGED_EVENT, onChain);
      inProcessListeners.delete(onLocal);
    };
  }, []);

  // The column only shows tokens for the active chain. The star toggle
  // (`watchedMints`/`isWatched`) stays global since mints never collide
  // across chains.
  const entries = useMemo(
    () =>
      Object.values(map)
        .filter((e) => e.chainId === chain)
        .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)),
    [map, chain],
  );
  const watchedMints = useMemo(() => new Set(Object.keys(map)), [map]);

  const isWatched = useCallback(
    (mint: string | null | undefined) => Boolean(mint && watchedMints.has(mint)),
    [watchedMints],
  );

  const add = useCallback((snapshot: TokenEvent) => {
    const mint = snapshot?.mint_address?.trim();
    if (!mint) return;
    const next = { ...readStorage() };
    // Re-adding refreshes the snapshot but preserves the original addedAt
    // so the row keeps its place in the chronological list.
    const prevAddedAt = next[mint]?.addedAt;
    next[mint] = {
      mint,
      addedAt: prevAddedAt ?? new Date().toISOString(),
      chainId: next[mint]?.chainId ?? getActiveChain(),
      snapshot: { ...snapshot, mint_address: mint },
    };
    writeStorage(next);
    notifyInProcess();
  }, []);

  const remove = useCallback((mint: string) => {
    if (!mint) return;
    const next = { ...readStorage() };
    if (!(mint in next)) return;
    delete next[mint];
    writeStorage(next);
    notifyInProcess();
  }, []);

  const clear = useCallback(() => {
    writeStorage({});
    notifyInProcess();
  }, []);

  return {
    entries,
    watchedMints,
    count: entries.length,
    isWatched,
    add,
    remove,
    clear,
  };
}
