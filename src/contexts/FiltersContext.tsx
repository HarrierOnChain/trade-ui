"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { defaultPlatformFilter, platforms } from "../components/PlatformFilter";
import { CHAIN_CHANGED_EVENT } from "../lib/chains";

export type ColumnKey = "trending" | "deploy" | "migrating" | "migration";

export const COLUMN_META: Record<ColumnKey, { label: string }> = {
  trending:     { label: "Trending" },
  deploy:       { label: "New Deploys" },
  migrating:    { label: "Migrating" },
  migration:    { label: "Migrated" },
};

export interface Range {
  min?: number;
  max?: number;
}

export interface ColumnFilters {
  spam: boolean;
  platforms: string[];
  search: string;
  exclude: string;

  // Audit
  bundlePercentage: Range;
  sniperPercentage: Range;
  creatorDeploys: Range;

  // $ Metrics
  marketCap: Range;
  volume24h: Range;
  liquidity: Range;
  priceChange: Range;
  tradeCount: Range;
  holders: Range;
  ageMinutes: Range;

  // Socials
  requireTwitter: boolean;
  requireWebsite: boolean;
  requireTelegram: boolean;
}

const STORAGE_KEY = "spool.filters.v1";
const LEGACY_SOL_PLATFORM_VALUES = new Set([
  "Pumpfun", "Mayhem", "MeteoraDBC", "RaydiumLaunchpad", "Boopfun", "Moonit", "Sugar",
]);

export function defaultFilters(): ColumnFilters {
  return {
    spam: false,
    platforms: platforms().map((p) => p.value),
    search: "",
    exclude: "",
    bundlePercentage: {},
    sniperPercentage: {},
    creatorDeploys: {},
    marketCap: {},
    volume24h: {},
    liquidity: {},
    priceChange: {},
    tradeCount: {},
    holders: {},
    ageMinutes: {},
    requireTwitter: false,
    requireWebsite: false,
    requireTelegram: false,
  };
}

type AllFilters = Record<ColumnKey, ColumnFilters>;

function initialState(): AllFilters {
  return {
    trending:     defaultFilters(),
    deploy:       defaultFilters(),
    migrating:    defaultFilters(),
    migration:    defaultFilters(),
  };
}

/** Count non-default filter fields for a column — drives active-badge display */
export function countActive(f: ColumnFilters): number {
  let n = 0;
  if (f.spam) n++;
  if (f.platforms.length !== platforms().length) n++;
  if (f.search.trim()) n++;
  if (f.exclude.trim()) n++;
  const ranges: Range[] = [
    f.bundlePercentage, f.sniperPercentage, f.creatorDeploys,
    f.marketCap, f.volume24h, f.liquidity, f.priceChange,
    f.tradeCount, f.holders, f.ageMinutes,
  ];
  ranges.forEach((r) => { if (r.min != null || r.max != null) n++; });
  if (f.requireTwitter) n++;
  if (f.requireWebsite) n++;
  if (f.requireTelegram) n++;
  return n;
}

// Merge persisted values over the current default shape so new fields get their
// defaults automatically when the schema grows.
function reviveFilters(raw: unknown): AllFilters {
  const base = initialState();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  (Object.keys(base) as ColumnKey[]).forEach((k) => {
    const persisted = obj[k];
    if (persisted && typeof persisted === "object") {
      base[k] = { ...base[k], ...(persisted as Partial<ColumnFilters>) };
      // Platforms must match known set (drops stale values if PLATFORMS shrinks)
      const known = new Set(platforms().map((p) => p.value));
      base[k].platforms = (base[k].platforms || []).filter((p) => known.has(p));
      const isLegacyDefault = base[k].platforms.length === LEGACY_SOL_PLATFORM_VALUES.size
        && base[k].platforms.every((p) => LEGACY_SOL_PLATFORM_VALUES.has(p));
      if (base[k].platforms.length === 0 || isLegacyDefault) {
        base[k].platforms = platforms().map((p) => p.value);
      }
    }
  });
  return base;
}

interface FiltersValue {
  filters: AllFilters;
  get: (col: ColumnKey) => ColumnFilters;
  update: (col: ColumnKey, patch: Partial<ColumnFilters>) => void;
  reset: (col: ColumnKey) => void;
  /** Legacy single-platform-string accessor used by stream hooks */
  platformString: (col: ColumnKey) => string;
}

const Ctx = createContext<FiltersValue>({
  filters: initialState(),
  get: () => defaultFilters(),
  update: () => {},
  reset: () => {},
  platformString: () => defaultPlatformFilter(),
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

  // The launchpad set is per-chain. On an in-session chain switch the page
  // does NOT reload, so a column's selected platforms would otherwise stay on
  // the old chain's values and `passesFilters`/`platformString` would filter
  // out every token on the new chain. Remap each column to the new chain's
  // known platforms (mirrors reviveFilters) when the chain changes.
  useEffect(() => {
    const onChain = () => {
      setFilters((prev) => {
        const known = new Set(platforms().map((p) => p.value));
        const all = platforms().map((p) => p.value);
        let changed = false;
        const next = { ...prev };
        (Object.keys(prev) as ColumnKey[]).forEach((k) => {
          const cur = prev[k].platforms || [];
          const kept = cur.filter((p) => known.has(p));
          const remapped = kept.length ? kept : all;
          const same = remapped.length === cur.length && remapped.every((v, i) => v === cur[i]);
          if (!same) { next[k] = { ...prev[k], platforms: remapped }; changed = true; }
        });
        if (!changed) return prev;
        persist(next);
        return next;
      });
    };
    window.addEventListener(CHAIN_CHANGED_EVENT, onChain);
    return () => window.removeEventListener(CHAIN_CHANGED_EVENT, onChain);
  }, [persist]);

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

  const platformString = useCallback((col: ColumnKey) => {
    const list = filters[col].platforms;
    return list.length ? list.join(",") : defaultPlatformFilter();
  }, [filters]);

  return (
    <Ctx.Provider value={{ filters, get, update, reset, platformString }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFilters() {
  return useContext(Ctx);
}
