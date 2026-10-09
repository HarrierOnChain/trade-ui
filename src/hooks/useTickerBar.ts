"use client";
// Ticker-bar preferences (shared by the footer toggle + the bar itself).
// Persisted to localStorage with an in-process listener set so both surfaces
// stay in sync in the same tab.
import { useCallback, useEffect, useState } from "react";

export type TickerSource = "watchlist" | "positions" | "recent";
const SOURCES: readonly TickerSource[] = ["watchlist", "positions", "recent"];
export type TickerSortField = "price" | "name" | "added";
const SORT_FIELDS: readonly TickerSortField[] = ["price", "name", "added"];
export type TickerSortDir = "asc" | "desc";
export type TickerNativeCurrency = "sol" | "usd";

interface TickerPrefs {
  enabled: boolean;
  source: TickerSource;
  // Watchlist sort
  sortField: TickerSortField;
  sortDir: TickerSortDir;
  // Positions
  showMcaps: boolean;
  showHidden: boolean;
  nativeCurrency: TickerNativeCurrency;
}

const KEY = "trade.tickerBar.v1";
const DEFAULTS: TickerPrefs = {
  enabled: false,
  source: "watchlist",
  sortField: "added",
  sortDir: "desc",
  showMcaps: true,
  showHidden: true,
  nativeCurrency: "usd",
};

function read(): TickerPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const prefs = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<TickerPrefs>) };
    // A source this build no longer has falls back to the default.
    if (!SOURCES.includes(prefs.source)) prefs.source = DEFAULTS.source;
    if (!SORT_FIELDS.includes(prefs.sortField)) prefs.sortField = DEFAULTS.sortField;
    return prefs;
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
    setSortField: (s: TickerSortField) => update({ sortField: s }),
    setSortDir: (d: TickerSortDir) => update({ sortDir: d }),
    setShowMcaps: (v: boolean) => update({ showMcaps: v }),
    setShowHidden: (v: boolean) => update({ showHidden: v }),
    setNativeCurrency: (c: TickerNativeCurrency) => update({ nativeCurrency: c }),
  };
}
