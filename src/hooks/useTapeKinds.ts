"use client";
import { useState, useEffect, useCallback } from "react";

export type TapeKind = "deploy" | "migrating" | "migration" | "trending" | "mine" | "watch" | "x";

export const TAPE_KINDS: TapeKind[] = [
  "deploy", "migrating", "migration", "trending", "mine", "watch", "x",
];

export const DEFAULT_TAPE_KINDS: TapeKind[] = [...TAPE_KINDS];

export const TAPE_VIEW_LABEL: Record<TapeKind, string> = {
  deploy: "Deploy",
  migrating: "Migrating",
  migration: "Migrations",
  trending: "Trending",
  mine: "My Wallets",
  watch: "Tracked",
  x: "X",
};

export const TAPE_VIEW_SHORT: Record<TapeKind, string> = {
  deploy: "Dpl",
  migrating: "Mig",
  migration: "Mig+",
  trending: "Trnd",
  mine: "Mine",
  watch: "Trk",
  x: "X",
};

export const TAPE_ACCENT: Record<TapeKind, string> = {
  deploy: "var(--buy)",
  migrating: "var(--paper)",
  migration: "var(--accent)",
  trending: "var(--paper)",
  mine: "var(--accent)",
  watch: "oklch(0.74 0.13 75)",
  x: "var(--info, #1d9bf0)",
};

export const TAPE_VIEW_KEY = "spool.sidebar.tape.view";
const TAPE_CHANGE_EVENT = "spool:tape-kinds-changed";

function isTapeKind(v: unknown): v is TapeKind {
  return TAPE_KINDS.includes(v as TapeKind);
}

function normalizeTapeKinds(value: unknown): TapeKind[] | null {
  if (value === "all") return DEFAULT_TAPE_KINDS;
  if (isTapeKind(value)) return [value];
  if (!Array.isArray(value)) return null;
  return TAPE_KINDS.filter((k) => value.includes(k));
}

export function readStoredTapeKinds(): TapeKind[] {
  if (typeof window === "undefined") return DEFAULT_TAPE_KINDS;
  try {
    const raw = window.localStorage.getItem(TAPE_VIEW_KEY);
    if (!raw) return DEFAULT_TAPE_KINDS;
    try {
      const parsed = JSON.parse(raw);
      const normalized = normalizeTapeKinds(parsed);
      if (normalized) return normalized;
    } catch {
      const normalized = normalizeTapeKinds(raw);
      if (normalized) return normalized;
    }
  } catch { /* ignore */ }
  return DEFAULT_TAPE_KINDS;
}

function writeStoredTapeKinds(kinds: TapeKind[]) {
  try {
    window.localStorage.setItem(TAPE_VIEW_KEY, JSON.stringify(kinds));
    window.dispatchEvent(new Event(TAPE_CHANGE_EVENT));
  } catch { /* ignore */ }
}

export function useTapeKinds() {
  const [kinds, setKindsState] = useState<TapeKind[]>(DEFAULT_TAPE_KINDS);

  useEffect(() => {
    setKindsState(readStoredTapeKinds());
    const handler = () => setKindsState(readStoredTapeKinds());
    window.addEventListener(TAPE_CHANGE_EVENT, handler);
    return () => window.removeEventListener(TAPE_CHANGE_EVENT, handler);
  }, []);

  const toggleKind = useCallback((kind: TapeKind) => {
    setKindsState((prev) => {
      const next = prev.includes(kind)
        ? prev.filter((k) => k !== kind)
        : TAPE_KINDS.filter((k) => k === kind || prev.includes(k));
      writeStoredTapeKinds(next);
      return next;
    });
  }, []);

  const setKinds = useCallback((next: TapeKind[]) => {
    setKindsState(next);
    writeStoredTapeKinds(next);
  }, []);

  return { kinds, toggleKind, setKinds };
}
