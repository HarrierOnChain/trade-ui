"use client";
/**
 * Read/write a single backend-persisted user preference, with optimistic
 * local state and a debounced write-back. While the user is unauthed, the
 * value falls back to localStorage so the trading panel still remembers
 * their inputs across reloads (and the next signed-in session migrates
 * the local cache up to the backend on first write).
 *
 * Concurrent mounts of the same key share state through a module-scope
 * cache, so the WALLET/TOTAL toggle in the embedded panel and the same
 * toggle in the floating card stay in sync without two round-trips.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../contexts/AppContext";
import { useRegion } from "../contexts/RegionContext";
import { BackendClient, useSession, SESSION_CHANGED_EVENT } from "../api/backend";

const LS_PREFIX = "trade.pref.";
const WRITE_DEBOUNCE_MS = 350;

type Listener<T> = (v: T) => void;
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener<unknown>>>();
const inflight = new Map<string, Promise<unknown>>();
// Tracks which (key, session token) pairs have already been hydrated from the
// backend. Without this, every mount of useUserPreference re-fires a GET —
// e.g. each TokenRow hover spinning up a fresh useQuickBuy would refetch
// slippage + transaction fee prefs every time.
const hydrated = new Map<string, string>();

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
  const { authed } = useApp();
  const { region } = useRegion();
  const session = useSession();

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

  // Initial backend hydrate when authed. We trust the backend value as
  // the source of truth and overwrite any cached local value with it.
  // Hydration is once per (key, session token) — see `hydrated` above.
  useEffect(() => {
    if (!authed || !session) return;
    if (hydrated.get(key) === session.token) return;
    hydrated.set(key, session.token);
    let cancelled = false;
    const client = new BackendClient(region.baseUrl, session.token);
    const existing = inflight.get(key) as Promise<T | null> | undefined;
    const p = existing ?? client.getPreference<T>(key);
    if (!existing) inflight.set(key, p as Promise<unknown>);
    p.then((remote) => {
      if (cancelled) return;
      if (remote != null) {
        notify(key, remote);
        writeLocal(key, remote);
      } else {
        // Backend has nothing yet — push local up so the user keeps any
        // pre-login customizations.
        const local = readLocal<T | undefined>(key, undefined as unknown as T | undefined);
        if (local !== undefined) {
          void client.setPreference(key, local).catch(() => {});
        }
      }
    })
      .catch(() => {
        // Drop the hydration claim on hard errors so the next consumer can retry.
        if (hydrated.get(key) === session.token) hydrated.delete(key);
      })
      .finally(() => {
        if (inflight.get(key) === p) inflight.delete(key);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, session?.token, region.baseUrl, key]);

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValue = useRef<T | null>(null);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = (cache.get(key) as T) ?? value;
      const resolved =
        typeof next === "function" ? (next as (p: T) => T)(prev) : next;

      // Optimistic local update + module cache notify.
      notify(key, resolved);
      writeLocal(key, resolved);

      // Debounced write-through to the backend (only when authed).
      pendingValue.current = resolved;
      if (writeTimer.current) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(() => {
        const toWrite = pendingValue.current;
        pendingValue.current = null;
        const sess = session;
        if (!sess || !authed) return;
        const client = new BackendClient(region.baseUrl, sess.token);
        void client.setPreference(key, toWrite as T).catch(() => {});
      }, WRITE_DEBOUNCE_MS);
    },
    [authed, session, region.baseUrl, key, value],
  );

  // Re-hydrate when the session token changes (e.g. login/logout in another tab).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSession = () => {
      // The auth-effect above will re-fire on next render — nothing to
      // do here besides making sure the listener is registered.
    };
    window.addEventListener(SESSION_CHANGED_EVENT, onSession);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, onSession);
  }, []);

  return [value, setValue] as const;
}
