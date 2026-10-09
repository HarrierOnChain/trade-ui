"use client";
/**
 * Read/write a single user preference, kept in this browser's localStorage.
 *
 * Concurrent mounts of the same key share state through a module-scope
 * cache, so the embedded trading panel and the floating card stay in sync.
 */
import { useCallback, useEffect, useState } from "react";

const LS_PREFIX = "trade.pref.";

type Listener<T> = (v: T) => void;
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener<unknown>>>();

function notify<T>(key: string, value: T) {
  cache.set(key, value);
  const set = listeners.get(key);
  if (!set) return;
  for (const l of set) (l as Listener<T>)(value);
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
}

export function useUserPreference<T>(
  key: string,
  defaultValue: T,
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  // Start with `defaultValue` so SSR and the first client render agree.
  // The cache + localStorage read happens post-mount so React doesn't see
  // a hydration mismatch (#418) when the persisted value differs from the
  // default.
  const [value, setValueState] = useState<T>(defaultValue);

  // Subscribe to module-cache updates so sibling components stay in sync.
  useEffect(() => {
    // Initial hydration from in-memory cache or localStorage.
    if (cache.has(key)) {
      setValueState(cache.get(key) as T);
    } else {
      const local = readLocal<T | undefined>(key, undefined as unknown as T | undefined);
      if (local !== undefined) {
        cache.set(key, local);
        setValueState(local as T);
      }
    }
    const set = listeners.get(key) ?? new Set();
    const handler: Listener<unknown> = (v) => setValueState(v as T);
    set.add(handler);
    listeners.set(key, set);
    return () => {
      set.delete(handler);
    };
  }, [key]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = (cache.get(key) as T) ?? value;
      const resolved =
        typeof next === "function" ? (next as (p: T) => T)(prev) : next;

      notify(key, resolved);
      writeLocal(key, resolved);
    },
    [key, value],
  );

  return [value, setValue] as const;
}
