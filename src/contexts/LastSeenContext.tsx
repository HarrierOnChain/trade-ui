"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "spool.lastSeen";
const MAX_ENTRIES = 200;

interface LastSeenValue {
  /** mint address → unix ms of last view */
  lastSeen: Record<string, number>;
  /** Record a view. Call this whenever a user opens / clicks a token. */
  record: (mint: string) => void;
  /** Drop a single mint (e.g. a deploy preview placeholder that leaked in). */
  forget: (mint: string) => void;
  /** Clear all history (utility for settings panel). */
  clear: () => void;
}

const Ctx = createContext<LastSeenValue>({
  lastSeen: {},
  record: () => {},
  forget: () => {},
  clear: () => {},
});

export function LastSeenProvider({ children }: { children: React.ReactNode }) {
  const [lastSeen, setLastSeen] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLastSeen(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const persist = useCallback((next: Record<string, number>) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const record = useCallback((mint: string) => {
    if (!mint) return;
    setLastSeen((prev) => {
      const next = { ...prev, [mint]: Date.now() };
      // cap size — drop oldest when over the limit
      const keys = Object.keys(next);
      if (keys.length > MAX_ENTRIES) {
        const sorted = keys.sort((a, b) => next[a] - next[b]);
        const trimmed: Record<string, number> = {};
        for (let i = keys.length - MAX_ENTRIES; i < keys.length; i++) {
          trimmed[sorted[i]] = next[sorted[i]];
        }
        persist(trimmed);
        return trimmed;
      }
      persist(next);
      return next;
    });
  }, [persist]);

  const forget = useCallback((mint: string) => {
    if (!mint) return;
    setLastSeen((prev) => {
      if (!(mint in prev)) return prev;
      const next = { ...prev };
      delete next[mint];
      persist(next);
      return next;
    });
  }, [persist]);

  const clear = useCallback(() => {
    setLastSeen({});
    persist({});
  }, [persist]);

  return <Ctx.Provider value={{ lastSeen, record, forget, clear }}>{children}</Ctx.Provider>;
}

export function useLastSeen() {
  return useContext(Ctx);
}
