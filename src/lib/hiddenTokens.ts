"use client";

/* ─────────────────────────────────────────────────────────────
   Global token-hide registry
   A user-owned blocklist of token mints that should be filtered
   out of every list-style surface — Portfolio holdings/activity,
   Monitor columns (deploys / migrations / trending), sidebar
   mini-feeds, etc.

   Hidden state lives in localStorage so it survives reloads and
   syncs across browser tabs (via the `storage` event). Within a
   single tab updates also propagate via an in-process listener
   set, since `storage` events only fire in *other* windows.
   ───────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from "react";

export const HIDDEN_TOKENS_STORAGE_KEY = "trade.hiddenTokens.v1";

export interface HiddenTokenEntry {
  mint: string;
  hiddenAt: string;          // ISO timestamp
  symbol?: string;           // last known symbol (for the manager UI)
  name?: string;             // last known name
}

type HiddenMap = Record<string, HiddenTokenEntry>;

function readStorage(): HiddenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(HIDDEN_TOKENS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: HiddenMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!k || typeof k !== "string") continue;
      if (!v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      if (typeof e.mint !== "string") continue;
      out[k] = {
        mint: e.mint,
        hiddenAt: typeof e.hiddenAt === "string" ? e.hiddenAt : new Date().toISOString(),
        symbol: typeof e.symbol === "string" ? e.symbol : undefined,
        name: typeof e.name === "string" ? e.name : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeStorage(map: HiddenMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HIDDEN_TOKENS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

// In-process subscribers — `storage` events only fire across tabs, so we
// keep our own pub/sub for the originating tab.
const inProcessListeners = new Set<() => void>();
function notifyInProcess() {
  inProcessListeners.forEach((fn) => fn());
}

export interface UseHiddenTokens {
  hidden: HiddenMap;
  hiddenMints: Set<string>;
  count: number;
  isHidden: (mint: string | null | undefined) => boolean;
  hide: (mint: string, meta?: { symbol?: string; name?: string }) => void;
  unhide: (mint: string) => void;
  clear: () => void;
}

/** Reactive view + mutator API for the hidden-tokens registry. */
export function useHiddenTokens(): UseHiddenTokens {
  const [hidden, setHidden] = useState<HiddenMap>({});

  useEffect(() => {
    setHidden(readStorage());
    const onStorage = (e: StorageEvent) => {
      if (e.key === HIDDEN_TOKENS_STORAGE_KEY) setHidden(readStorage());
    };
    const onLocal = () => setHidden(readStorage());
    window.addEventListener("storage", onStorage);
    inProcessListeners.add(onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      inProcessListeners.delete(onLocal);
    };
  }, []);

  const hiddenMints = useMemo(() => new Set(Object.keys(hidden)), [hidden]);

  const isHidden = useCallback(
    (mint: string | null | undefined) => Boolean(mint && hiddenMints.has(mint)),
    [hiddenMints],
  );

  const hide = useCallback((mint: string, meta?: { symbol?: string; name?: string }) => {
    if (!mint) return;
    const next = { ...readStorage() };
    next[mint] = {
      mint,
      hiddenAt: new Date().toISOString(),
      symbol: meta?.symbol,
      name: meta?.name,
    };
    writeStorage(next);
    notifyInProcess();
  }, []);

  const unhide = useCallback((mint: string) => {
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
    hidden,
    hiddenMints,
    count: Object.keys(hidden).length,
    isHidden,
    hide,
    unhide,
    clear,
  };
}

/** Light-weight helper for components that only need the Set for filtering. */
export function useHiddenMints(): Set<string> {
  return useHiddenTokens().hiddenMints;
}
