"use client";
/**
 * Cross-cutting lookup: given any wallet address, return the user-assigned
 * label (if any) of one of the user's own wallets (the vault's), from
 * `useUserWallets()` — these carry the `label` field (or a kind-derived
 * default).
 *
 * Used by any component that renders a wallet pubkey so the label
 * surfaces instead of (or alongside) the raw truncated address.
 */

import React, { useMemo } from "react";
import { useUserWallets } from "./useUserWallets";
import { shortAddr } from "../lib/format";

export interface WalletLabelInfo {
  label: string;
}

export type WalletLabelMap = Map<string, WalletLabelInfo>;

export function useWalletLabels(): {
  labels: WalletLabelMap;
  getLabel: (addr?: string | null) => WalletLabelInfo | null;
} {
  const { wallets } = useUserWallets();

  const labels = useMemo<WalletLabelMap>(() => {
    const m: WalletLabelMap = new Map();
    for (const w of wallets) {
      if (!w.pubkey) continue;
      m.set(w.pubkey, { label: w.displayLabel });
    }
    return m;
  }, [wallets]);

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

/* ───────── Display component ───────── */

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
            background: "var(--accent)",
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
