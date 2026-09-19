"use client";

/* ─────────────────────────────────────────────────────────────
   Global dev-hide registry
   A user-owned blocklist of dev (token-creator / signer) wallet
   addresses whose tokens should be filtered out of every list-
   style surface — Monitor columns (deploys / migrations /
   trending), the sidebar mini-feed, the trending page, etc.

   Mirrors `hiddenTokens.ts`: state lives in localStorage so it
   survives reloads and syncs across browser tabs (via the
   `storage` event), with an in-process subscriber set so the
   originating tab also sees its own writes.
   ───────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from "react";

export const HIDDEN_DEVS_STORAGE_KEY = "trade.hiddenDevs.v1";

export interface HiddenDevEntry {
  address: string;
  hiddenAt: string;          // ISO timestamp
  label?: string;            // free-form label saved by the user (optional)
  lastTokenSymbol?: string;  // last symbol seen for this dev (for the manager UI)
  lastTokenName?: string;
  lastTokenMint?: string;
}

type HiddenMap = Record<string, HiddenDevEntry>;

function readStorage(): HiddenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(HIDDEN_DEVS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: HiddenMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!k || typeof k !== "string") continue;
      if (!v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      if (typeof e.address !== "string") continue;
      out[k] = {
        address: e.address,
        hiddenAt: typeof e.hiddenAt === "string" ? e.hiddenAt : new Date().toISOString(),
        label: typeof e.label === "string" ? e.label : undefined,
        lastTokenSymbol: typeof e.lastTokenSymbol === "string" ? e.lastTokenSymbol : undefined,
        lastTokenName: typeof e.lastTokenName === "string" ? e.lastTokenName : undefined,
        lastTokenMint: typeof e.lastTokenMint === "string" ? e.lastTokenMint : undefined,
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
    window.localStorage.setItem(HIDDEN_DEVS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

const inProcessListeners = new Set<() => void>();
function notifyInProcess() {
  inProcessListeners.forEach((fn) => fn());
}

export interface UseHiddenDevs {
  hidden: HiddenMap;
  hiddenAddresses: Set<string>;
  count: number;
  isHidden: (address: string | null | undefined) => boolean;
  hide: (
    address: string,
    meta?: { label?: string; lastTokenSymbol?: string; lastTokenName?: string; lastTokenMint?: string },
  ) => void;
  unhide: (address: string) => void;
  clear: () => void;
}

/** Reactive view + mutator API for the hidden-devs registry. */
export function useHiddenDevs(): UseHiddenDevs {
  const [hidden, setHidden] = useState<HiddenMap>({});

  useEffect(() => {
    setHidden(readStorage());
    const onStorage = (e: StorageEvent) => {
      if (e.key === HIDDEN_DEVS_STORAGE_KEY) setHidden(readStorage());
    };
    const onLocal = () => setHidden(readStorage());
    window.addEventListener("storage", onStorage);
    inProcessListeners.add(onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      inProcessListeners.delete(onLocal);
    };
  }, []);

  const hiddenAddresses = useMemo(() => new Set(Object.keys(hidden)), [hidden]);

  const isHidden = useCallback(
    (address: string | null | undefined) => Boolean(address && hiddenAddresses.has(address)),
    [hiddenAddresses],
  );

  const hide = useCallback(
    (
      address: string,
      meta?: { label?: string; lastTokenSymbol?: string; lastTokenName?: string; lastTokenMint?: string },
    ) => {
      if (!address) return;
      const next = { ...readStorage() };
      next[address] = {
        address,
        hiddenAt: new Date().toISOString(),
        label: meta?.label,
        lastTokenSymbol: meta?.lastTokenSymbol,
        lastTokenName: meta?.lastTokenName,
        lastTokenMint: meta?.lastTokenMint,
      };
      writeStorage(next);
      notifyInProcess();
    },
    [],
  );

  const unhide = useCallback((address: string) => {
    if (!address) return;
    const next = { ...readStorage() };
    if (!(address in next)) return;
    delete next[address];
    writeStorage(next);
    notifyInProcess();
  }, []);

  const clear = useCallback(() => {
    writeStorage({});
    notifyInProcess();
  }, []);

  return {
    hidden,
    hiddenAddresses,
    count: Object.keys(hidden).length,
    isHidden,
    hide,
    unhide,
    clear,
  };
}

/** Light-weight helper for components that only need the Set for filtering. */
export function useHiddenDevAddresses(): Set<string> {
  return useHiddenDevs().hiddenAddresses;
}
