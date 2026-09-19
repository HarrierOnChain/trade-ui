"use client";
import { useCallback, useEffect, useState } from "react";

const BASE_KEY = "raze.quickBuyAmount";
const DEFAULT = 0.1;

// Per-column quick-buy amounts: each monitor column (deploy / migrating /
// migration / trending …) keeps its own persisted amount so they don't sync.
// `scope` undefined = the legacy global amount (BASE_KEY), still used by the
// sidebar bolt and any surface that isn't column-scoped.
type Store = { current: number; hydrated: boolean; listeners: Set<() => void> };
const stores = new Map<string, Store>();

function storageKey(scope?: string): string {
  return scope ? `${BASE_KEY}.${scope}` : BASE_KEY;
}

function getStore(scope?: string): Store {
  const id = scope ?? "";
  let s = stores.get(id);
  if (!s) {
    s = { current: DEFAULT, hydrated: false, listeners: new Set() };
    stores.set(id, s);
  }
  return s;
}

function parseAmt(raw: string | null): number | null {
  const n = raw == null ? NaN : parseFloat(raw);
  // 0 is valid (disables quick-buy); reject only missing / malformed / negative.
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function read(scope?: string): number {
  if (typeof window === "undefined") return DEFAULT;
  const scoped = parseAmt(localStorage.getItem(storageKey(scope)));
  if (scoped != null) return scoped;
  // Seed a not-yet-diverged column from the legacy global amount so existing
  // users keep their configured value until they change one column.
  if (scope) {
    const legacy = parseAmt(localStorage.getItem(BASE_KEY));
    if (legacy != null) return legacy;
  }
  return DEFAULT;
}

function write(scope: string | undefined, v: number) {
  const s = getStore(scope);
  s.current = v;
  if (typeof window !== "undefined") localStorage.setItem(storageKey(scope), String(v));
  s.listeners.forEach((l) => l());
}

export function useQuickBuyAmount(scope?: string): [number, (v: number) => void] {
  // Always start with the default so SSR and the first client render agree.
  // Hydration from localStorage happens post-mount; otherwise React #418
  // fires when the persisted value differs.
  const [v, setV] = useState<number>(DEFAULT);
  useEffect(() => {
    const s = getStore(scope);
    if (!s.hydrated) {
      s.current = read(scope);
      s.hydrated = true;
    }
    setV(s.current);
    const l = () => setV(s.current);
    s.listeners.add(l);
    return () => {
      s.listeners.delete(l);
    };
  }, [scope]);
  const set = useCallback((val: number) => write(scope, val), [scope]);
  return [v, set];
}
