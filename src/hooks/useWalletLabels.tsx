"use client";
/**
 * Cross-cutting lookup: given any wallet address, return the user-assigned
 * label (if any). Aggregates two sources:
 *
 *   1. The user's own wallets (PHANTOM + PLATFORM) from `useUserWallets()`
 *      — these carry the `label` field (or a kind-derived default).
 *   2. The Tracker watchlist stored in localStorage under
 *      `trade.tracker.watchlist.v1` — user-maintained labels for
 *      external wallets (whales, KOLs, etc.).
 *
 * Used by any component that renders a wallet pubkey so the label
 * surfaces instead of (or alongside) the raw truncated address.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useUserWallets } from "./useUserWallets";
import { readWatchlist, WATCHLIST_STORAGE_KEY } from "../lib/trackerWallets";
import { shortAddr } from "../lib/format";

export type WalletLabelSource = "phantom" | "platform" | "watchlist";

export interface WalletLabelInfo {
  label: string;
  source: WalletLabelSource;
}

export type WalletLabelMap = Map<string, WalletLabelInfo>;

const WALLETS_CHANGED_EVENT = "terminal:wallets-changed";

function readWatchlistEntries(): Array<{ address: string; label: string }> {
  try {
    return readWatchlist().map((w) => ({ address: w.address, label: w.label }));
  } catch {
    return [];
  }
}

export function useWalletLabels(): {
  labels: WalletLabelMap;
  getLabel: (addr?: string | null) => WalletLabelInfo | null;
} {
  const { wallets } = useUserWallets();

  const [watchlist, setWatchlist] = useState<Array<{ address: string; label: string }>>(
    () => (typeof window === "undefined" ? [] : readWatchlistEntries()),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reload = () => setWatchlist(readWatchlistEntries());
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCHLIST_STORAGE_KEY || e.key == null) reload();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(WALLETS_CHANGED_EVENT, reload);
    // Tracker mutations (add/rename/remove) happen in-tab; the tracker code
    // writes localStorage synchronously but no event fires. Re-read on focus
    // so a rename in the Tracker page is reflected after the user returns.
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(WALLETS_CHANGED_EVENT, reload);
      window.removeEventListener("focus", reload);
    };
  }, []);

  const labels = useMemo<WalletLabelMap>(() => {
    const m: WalletLabelMap = new Map();
    // Watchlist first so user wallets win if the same address is in both.
    for (const w of watchlist) {
      if (!w.address || !w.label) continue;
      m.set(w.address, { label: w.label, source: "watchlist" });
    }
    for (const w of wallets) {
      if (!w.pubkey) continue;
      m.set(w.pubkey, {
        label: w.displayLabel,
        source: w.kind === "PHANTOM" ? "phantom" : "platform",
      });
    }
    return m;
  }, [wallets, watchlist]);

  const getLabel = useMemo(
    () => (addr?: string | null) => (addr ? labels.get(addr) ?? null : null),
    [labels],
  );

  return { labels, getLabel };
}

/** Single-address convenience — same behavior, narrower return. */
export function useWalletLabel(addr?: string | null): WalletLabelInfo | null {
  const { getLabel } = useWalletLabels();
  return getLabel(addr);
}

/** Plain-text form for places that can't render JSX (toast bodies, etc). */
export function walletLabelText(
  info: WalletLabelInfo | null,
  addr?: string | null,
  chars = 4,
): string {
  if (info) return info.label;
  return shortAddr(addr, chars);
}

/* ───────── Display component ───────── */

const sourceColor: Record<WalletLabelSource, string> = {
  phantom:   "var(--accent)",
  platform:  "var(--accent)",
  watchlist: "var(--amber)",
};

interface WalletLabelProps {
  address?: string | null;
  /** Truncation width used when no label is found. */
  chars?: number;
  /** Extra className applied to the outer span. */
  className?: string;
  /** Style overrides applied after the default styling. */
  style?: React.CSSProperties;
  /**
   * Fallback to render when no label AND no address. Defaults to "—".
   */
  empty?: React.ReactNode;
}

/**
 * Renders a wallet identifier: the user's label if one is known for this
 * address (with a small colored dot to flag it), otherwise the truncated
 * address via `shortAddr`. Always mono-styled — drop-in replacement for
 * `{shortAddr(addr, n)}` in existing rows.
 */
export function WalletLabel({
  address,
  chars = 4,
  className,
  style,
  empty = "—",
}: WalletLabelProps) {
  const info = useWalletLabel(address);
  if (!address) return <>{empty}</>;

  if (info) {
    return (
      <span
        className={className}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, ...style }}
        title={address}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: sourceColor[info.source],
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600, color: "var(--paper)" }}>{info.label}</span>
      </span>
    );
  }

  return (
    <span className={className} style={style}>
      {shortAddr(address, chars)}
    </span>
  );
}
