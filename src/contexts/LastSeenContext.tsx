"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "spool.lastSeen";
const MAX_ENTRIES = 200;

interface LastSeenValue {
  /** mint address → unix ms of last view */
  lastSeen: Record<string, number>;
  /** Record a view. Call this whenever a user opens / clicks a token. */
  record: (mint: string) => void;
}

const Ctx = createContext<LastSeenValue>({
  lastSeen: {},
  record: () => {},
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

  return <Ctx.Provider value={{ lastSeen, record }}>{children}</Ctx.Provider>;
}

export function useLastSeen() {
  return useContext(Ctx);
}
