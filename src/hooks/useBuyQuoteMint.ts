"use client";
import { useUserPreference } from "./useUserPreference";
import { PREF_KEYS } from "../components/TradingPanel/presets";
import { findQuoteMint, defaultQuoteMint, type QuoteMint } from "../lib/quoteMints";

/**
 * The user's selected buy quote asset (the "pay with" token), shared with the
 * trading panel through `PREF_KEYS.buyInputMint`. Quick-buy surfaces (column
 * header input, row hover overlay, sidebar bolt) read this so a column buy
 * spends the same quote the panel does, instead of hardcoding SOL.
 *
 * Returns the resolved quote and a setter that takes a quote label.
 */
export function useBuyQuoteMint(): readonly [QuoteMint, (label: string) => void] {
  const [label, setLabel] = useUserPreference<string>(
    PREF_KEYS.buyInputMint,
    defaultQuoteMint().label,
  );
  return [findQuoteMint(label), setLabel] as const;
}
