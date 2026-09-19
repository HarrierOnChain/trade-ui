"use client";
// Ticker-bar preferences (shared by the footer toggle + the bar itself).
// Persisted to localStorage with an in-process listener set so both surfaces
// stay in sync in the same tab.
import { useCallback, useEffect, useState } from "react";

export type TickerSource = "watchlist" | "positions" | "recent" | "deployed";
export type TickerQuickbuy = "never" | "always" | "hover";
export type TickerSortField = "price" | "name" | "createdAt" | "added";
export type TickerSortDir = "asc" | "desc";
export type TickerPnlDisplay = "valuePct" | "valuePnl" | "pnlPct";
export type TickerNativeCurrency = "sol" | "usd";

interface TickerPrefs {
  enabled: boolean;
  source: TickerSource;
  quickbuy: TickerQuickbuy;
  // Watchlist sort
  sortField: TickerSortField;
  sortDir: TickerSortDir;
  // Positions
  pnlDisplay: TickerPnlDisplay;
  showMcaps: boolean;
  showHidden: boolean;
  nativeCurrency: TickerNativeCurrency;
}

const KEY = "trade.tickerBar.v1";
const DEFAULTS: TickerPrefs = {
  enabled: false,
  source: "watchlist",
  quickbuy: "hover",
  sortField: "added",
  sortDir: "desc",
  pnlDisplay: "valuePct",
  showMcaps: true,
  showHidden: true,
  nativeCurrency: "usd",
};

function read(): TickerPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<TickerPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set<() => void>();
function write(next: TickerPrefs) {
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

export function useTickerBar() {
  const [prefs, setPrefs] = useState<TickerPrefs>(DEFAULTS);
  useEffect(() => {
    setPrefs(read());
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setPrefs(read()); };
    const onLocal = () => setPrefs(read());
    window.addEventListener("storage", onStorage);
    listeners.add(onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      listeners.delete(onLocal);
    };
  }, []);

  const update = useCallback((patch: Partial<TickerPrefs>) => {
    const next = { ...read(), ...patch };
    write(next);
    setPrefs(next);
  }, []);

  return {
    ...prefs,
    setEnabled: (v: boolean) => update({ enabled: v }),
    toggleEnabled: () => update({ enabled: !read().enabled }),
    setSource: (s: TickerSource) => update({ source: s }),
    setQuickbuy: (q: TickerQuickbuy) => update({ quickbuy: q }),
    setSortField: (s: TickerSortField) => update({ sortField: s }),
    setSortDir: (d: TickerSortDir) => update({ sortDir: d }),
    setPnlDisplay: (p: TickerPnlDisplay) => update({ pnlDisplay: p }),
    setShowMcaps: (v: boolean) => update({ showMcaps: v }),
    setShowHidden: (v: boolean) => update({ showHidden: v }),
    setNativeCurrency: (c: TickerNativeCurrency) => update({ nativeCurrency: c }),
  };
}
