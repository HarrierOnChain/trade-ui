"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  COLUMN_KEYS,
  defaultFilters,
  reviveColumnFilters,
  type ColumnFilters,
  type ColumnKey,
} from "../lib/tokenFilters";

export { countActive, defaultFilters } from "../lib/tokenFilters";
export type { ColumnFilters, ColumnKey, Range } from "../lib/tokenFilters";

export const COLUMN_META: Record<ColumnKey, { label: string }> = {
  trending:     { label: "Trending" },
  deploy:       { label: "New Deploys" },
  migrating:    { label: "Migrating" },
  migration:    { label: "Migrated" },
};

const STORAGE_KEY = "spool.filters.v1";

type AllFilters = Record<ColumnKey, ColumnFilters>;

function initialState(): AllFilters {
  return Object.fromEntries(COLUMN_KEYS.map((k) => [k, defaultFilters()])) as AllFilters;
}

// Stored columns over the current shape: new filters get their defaults and
// values from an older shape are dropped (lib/tokenFilters reviveColumnFilters).
function reviveFilters(raw: unknown): AllFilters {
  const base = initialState();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  for (const k of COLUMN_KEYS) base[k] = reviveColumnFilters(obj[k]);
  return base;
}

interface FiltersValue {
  filters: AllFilters;
  get: (col: ColumnKey) => ColumnFilters;
  update: (col: ColumnKey, patch: Partial<ColumnFilters>) => void;
  reset: (col: ColumnKey) => void;
}

const Ctx = createContext<FiltersValue>({
  filters: initialState(),
  get: () => defaultFilters(),
  update: () => {},
  reset: () => {},
});

export function FiltersProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<AllFilters>(initialState);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setFilters(reviveFilters(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, []);

  const persist = useCallback((next: AllFilters) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const update = useCallback((col: ColumnKey, patch: Partial<ColumnFilters>) => {
    setFilters((prev) => {
      const next = { ...prev, [col]: { ...prev[col], ...patch } };
      persist(next);
      return next;
    });
  }, [persist]);

  const reset = useCallback((col: ColumnKey) => {
    setFilters((prev) => {
      const next = { ...prev, [col]: defaultFilters() };
      persist(next);
      return next;
    });
  }, [persist]);

  const get = useCallback((col: ColumnKey) => filters[col], [filters]);

  return (
    <Ctx.Provider value={{ filters, get, update, reset }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFilters() {
  return useContext(Ctx);
}
