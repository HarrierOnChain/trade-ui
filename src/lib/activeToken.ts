"use client";

// Global "current token mint" signal for SHELL components that normally derive
// the active mint from the URL (e.g. the left sidebar's Wallets tab, which
// keys off usePathname() === "/token/<mint>").
//
// The /deploy page goes live IN-PLACE: on a successful launch it relabels the
// URL to /token/<mint> via history.replaceState WITHOUT a Next.js navigation
// (no remount, no flash). Because there's no real navigation, usePathname()
// stays "/deploy", so any shell UI that parses the URL sees no active mint.
//
// The deploy page publishes the live mint here so those shell components can
// resolve it. URL parsing takes precedence; this is a fallback for the
// in-place case (and is cleared when the deploy surface unmounts).

import { useSyncExternalStore } from "react";

let current: string | null = null;
const listeners = new Set<() => void>();

export function setActiveTokenMint(mint: string | null): void {
  const next = mint && mint.trim() ? mint : null;
  if (current === next) return;
  current = next;
  for (const cb of listeners) {
    try { cb(); } catch { /* ignore */ }
  }
}

export function getActiveTokenMint(): string | null {
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Reactive read of the shell-level active token mint (null when unset). */
export function useActiveTokenMint(): string | null {
  return useSyncExternalStore(subscribe, getActiveTokenMint, () => null);
}
