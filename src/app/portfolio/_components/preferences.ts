"use client";
/**
 * Portfolio wallet preferences — client-only ordering, starring, hiding.
 *
 * The backend stores the canonical wallet roster (kind, label, pubkey).
 * Display order, "primary" star, and per-wallet hide flag are user-local
 * conveniences kept in localStorage so the portfolio can reshape the
 * list without round-tripping. Cross-tab updates fire a synthetic
 * window event so the hook re-reads immediately on every preference
 * write.
 */

import { useCallback, useEffect, useState } from "react";

const ORDER_KEY = "portfolio.walletOrder.v1";
const STARRED_KEY = "portfolio.walletStarred.v1";
const HIDDEN_KEY = "portfolio.walletHidden.v1";
const AVATARS_KEY = "portfolio.walletAvatars.v1";
const PREFS_EVENT = "portfolio:wallet-prefs";

function readArray(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function writeArray(key: string, ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(ids));
    window.dispatchEvent(new Event(PREFS_EVENT));
  } catch {
    /* quota / private mode — ignore */
  }
}

function readAvatars(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(AVATARS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function writeAvatars(map: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AVATARS_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event(PREFS_EVENT));
  } catch {
    /* quota / private mode — ignore */
  }
}

/** Sync read for components outside the prefs hook (e.g. trading popup). */
export function readWalletAvatars(): Record<string, string> {
  return readAvatars();
}

/* ── Hook ────────────────────────────────────────────────────────────── */

export interface WalletPrefs {
  /** Ordered list of wallet ids; ids not present append at the end. */
  order: string[];
  /** Set of starred (primary) wallet ids. Typically holds 0 or 1. */
  starred: Set<string>;
  /** Set of hidden wallet ids — they're filtered from the visible list. */
  hidden: Set<string>;
  /** Optional per-wallet avatar glyph (1–2 letters or one emoji). */
  avatars: Record<string, string>;

  /** Toggle a wallet's star. Mutually exclusive — flips the previous one off. */
  toggleStar: (id: string) => void;
  /** Toggle hidden flag. */
  toggleHidden: (id: string) => void;
  /** Move wallet `id` to occupy index `targetIdx` in the visible ordering. */
  moveTo: (id: string, targetIdx: number, visibleIds: string[]) => void;
  /** Replace the full order with `ids` (visible-only — append unknowns). */
  setOrder: (ids: string[]) => void;
  /** Set or clear a wallet's custom avatar glyph (`null` = auto initials). */
  setAvatar: (id: string, glyph: string | null) => void;
  /** Reset all prefs back to default (clears order, stars, hidden). */
  reset: () => void;
}

export function useWalletPrefs(): WalletPrefs {
  // Start with defaults so SSR and the first client render agree. The
  // localStorage hydration runs in useEffect (post-mount), preventing
  // React #418 hydration mismatches.
  const [order, setOrderState] = useState<string[]>([]);
  const [starred, setStarredState] = useState<Set<string>>(() => new Set<string>());
  const [hidden, setHiddenState] = useState<Set<string>>(() => new Set<string>());
  const [avatars, setAvatarsState] = useState<Record<string, string>>(() => ({}));

  // Initial hydration + cross-tab + same-tab re-reads
  useEffect(() => {
    // Post-mount initial load.
    setOrderState(readArray(ORDER_KEY));
    setStarredState(new Set(readArray(STARRED_KEY)));
    setHiddenState(new Set(readArray(HIDDEN_KEY)));
    setAvatarsState(readAvatars());

    const refresh = () => {
      setOrderState(readArray(ORDER_KEY));
      setStarredState(new Set(readArray(STARRED_KEY)));
      setHiddenState(new Set(readArray(HIDDEN_KEY)));
      setAvatarsState(readAvatars());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === ORDER_KEY || e.key === STARRED_KEY || e.key === HIDDEN_KEY || e.key === AVATARS_KEY) refresh();
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
      if (!prev.has(id)) next.add(id); // mutually exclusive — one primary at a time
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

  const setOrder = useCallback((ids: string[]) => {
    setOrderState(ids);
    writeArray(ORDER_KEY, ids);
  }, []);

  const moveTo = useCallback(
    (id: string, targetIdx: number, visibleIds: string[]) => {
      // Reorder within the visible set, then preserve unknown-id tail.
      const filtered = visibleIds.filter((v) => v !== id);
      const clamped = Math.max(0, Math.min(targetIdx, filtered.length));
      filtered.splice(clamped, 0, id);
      setOrderState(filtered);
      writeArray(ORDER_KEY, filtered);
    },
    [],
  );

  const setAvatar = useCallback((id: string, glyph: string | null) => {
    setAvatarsState((prev) => {
      const next = { ...prev };
      if (!glyph) delete next[id];
      else next[id] = glyph;
      writeAvatars(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setOrderState([]);
    setStarredState(new Set());
    setHiddenState(new Set());
    setAvatarsState({});
    writeArray(ORDER_KEY, []);
    writeArray(STARRED_KEY, []);
    writeArray(HIDDEN_KEY, []);
    writeAvatars({});
  }, []);

  return { order, starred, hidden, avatars, toggleStar, toggleHidden, moveTo, setOrder, setAvatar, reset };
}

/* ── Pure helper: sort a wallet list by user pref ────────────────────── */

export function sortByPref<T extends { id: string }>(
  wallets: T[],
  order: string[],
  starred: Set<string>,
): T[] {
  const orderIdx = new Map(order.map((id, i) => [id, i] as const));
  const out = [...wallets];
  out.sort((a, b) => {
    // Starred float to top
    const aStar = starred.has(a.id) ? 0 : 1;
    const bStar = starred.has(b.id) ? 0 : 1;
    if (aStar !== bStar) return aStar - bStar;
    // Then explicit order
    const ai = orderIdx.has(a.id) ? orderIdx.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const bi = orderIdx.has(b.id) ? orderIdx.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return 0;
  });
  return out;
}
