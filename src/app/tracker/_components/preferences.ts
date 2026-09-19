"use client";
/**
 * Tracker preferences — client-only ordering, starring, hiding, muting,
 * and per-wallet notes for the watchlist.
 *
 * The canonical TrackedWallet roster lives in `WATCHLIST_STORAGE_KEY`
 * (lib/trackerWallets). Display order, star, hide, mute, and notes are
 * orthogonal — they shape *how* the list renders without touching the
 * roster itself. A synthetic same-tab event broadcasts every write so
 * any mounted hook re-reads immediately.
 */

import { useCallback, useEffect, useState } from "react";

const ORDER_KEY   = "tracker.walletOrder.v1";
const STARRED_KEY = "tracker.walletStarred.v1";
const HIDDEN_KEY  = "tracker.walletHidden.v1";
const MUTED_KEY   = "tracker.walletMuted.v1";
const NOTES_KEY   = "tracker.walletNotes.v1";
const PREFS_EVENT = "tracker:prefs";

function readArray(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch { return []; }
}

function writeArray(key: string, ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(ids));
    window.dispatchEvent(new Event(PREFS_EVENT));
  } catch { /* ignore */ }
}

function readMap(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch { return {}; }
}

function writeMap(key: string, map: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
    window.dispatchEvent(new Event(PREFS_EVENT));
  } catch { /* ignore */ }
}

/* ── Hook ────────────────────────────────────────────────────────────── */

export interface TrackerPrefs {
  order: string[];
  starred: Set<string>;
  hidden: Set<string>;
  muted: Set<string>;
  notes: Record<string, string>;

  toggleStar:   (id: string) => void;
  toggleHidden: (id: string) => void;
  toggleMuted:  (id: string) => void;
  setNote:      (id: string, note: string) => void;
  clearNote:    (id: string) => void;

  /** Move wallet `id` to occupy index `targetIdx` in the visible ordering. */
  moveTo: (id: string, targetIdx: number, visibleIds: string[]) => void;
  /** Replace order outright. */
  setOrder: (ids: string[]) => void;
  /** Reset all prefs (order/star/hidden/muted/notes). */
  reset: () => void;
}

export function useTrackerPrefs(): TrackerPrefs {
  // Start with defaults so SSR and the first client render agree. The
  // localStorage hydration runs in useEffect (post-mount), preventing
  // React #418 hydration mismatches.
  const [order, setOrderState]     = useState<string[]>([]);
  const [starred, setStarredState] = useState<Set<string>>(() => new Set<string>());
  const [hidden, setHiddenState]   = useState<Set<string>>(() => new Set<string>());
  const [muted, setMutedState]     = useState<Set<string>>(() => new Set<string>());
  const [notes, setNotesState]     = useState<Record<string, string>>({});

  useEffect(() => {
    // Initial hydration from localStorage after mount.
    setOrderState(readArray(ORDER_KEY));
    setStarredState(new Set(readArray(STARRED_KEY)));
    setHiddenState(new Set(readArray(HIDDEN_KEY)));
    setMutedState(new Set(readArray(MUTED_KEY)));
    setNotesState(readMap(NOTES_KEY));

    const refresh = () => {
      setOrderState(readArray(ORDER_KEY));
      setStarredState(new Set(readArray(STARRED_KEY)));
      setHiddenState(new Set(readArray(HIDDEN_KEY)));
      setMutedState(new Set(readArray(MUTED_KEY)));
      setNotesState(readMap(NOTES_KEY));
    };
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === ORDER_KEY || e.key === STARRED_KEY ||
        e.key === HIDDEN_KEY || e.key === MUTED_KEY || e.key === NOTES_KEY
      ) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PREFS_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PREFS_EVENT, refresh);
    };
  }, []);

  const toggleStar = useCallback((id: string) => {
    setStarredState((prev) => {
      const next = new Set<string>();
      if (!prev.has(id)) next.add(id);
      writeArray(STARRED_KEY, [...next]);
      return next;
    });
  }, []);

  const toggleHidden = useCallback((id: string) => {
    setHiddenState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeArray(HIDDEN_KEY, [...next]);
      return next;
    });
  }, []);

  const toggleMuted = useCallback((id: string) => {
    setMutedState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeArray(MUTED_KEY, [...next]);
      return next;
    });
  }, []);

  const setNote = useCallback((id: string, note: string) => {
    setNotesState((prev) => {
      const next = { ...prev };
      const trimmed = note.trim();
      if (!trimmed) delete next[id];
      else next[id] = trimmed;
      writeMap(NOTES_KEY, next);
      return next;
    });
  }, []);

  const clearNote = useCallback((id: string) => {
    setNotesState((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      writeMap(NOTES_KEY, next);
      return next;
    });
  }, []);

  const moveTo = useCallback((id: string, targetIdx: number, visibleIds: string[]) => {
    const filtered = visibleIds.filter((v) => v !== id);
    const clamped = Math.max(0, Math.min(targetIdx, filtered.length));
    filtered.splice(clamped, 0, id);
    setOrderState(filtered);
    writeArray(ORDER_KEY, filtered);
  }, []);

  const setOrder = useCallback((ids: string[]) => {
    setOrderState(ids);
    writeArray(ORDER_KEY, ids);
  }, []);

  const reset = useCallback(() => {
    setOrderState([]);    writeArray(ORDER_KEY, []);
    setStarredState(new Set()); writeArray(STARRED_KEY, []);
    setHiddenState(new Set());  writeArray(HIDDEN_KEY, []);
    setMutedState(new Set());   writeArray(MUTED_KEY, []);
    setNotesState({});          writeMap(NOTES_KEY, {});
  }, []);

  return {
    order, starred, hidden, muted, notes,
    toggleStar, toggleHidden, toggleMuted, setNote, clearNote,
    moveTo, setOrder, reset,
  };
}

/* ── Pure sort ───────────────────────────────────────────────────────── */

export function sortByPref<T extends { id: string }>(
  items: T[],
  order: string[],
  starred: Set<string>,
): T[] {
  const orderIdx = new Map(order.map((id, i) => [id, i] as const));
  const out = [...items];
  out.sort((a, b) => {
    const aStar = starred.has(a.id) ? 0 : 1;
    const bStar = starred.has(b.id) ? 0 : 1;
    if (aStar !== bStar) return aStar - bStar;
    const ai = orderIdx.has(a.id) ? orderIdx.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const bi = orderIdx.has(b.id) ? orderIdx.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return 0;
  });
  return out;
}
