"use client";
import { useSolPrice } from "./useSolPrice";

/**
 * Native USD price (SOL/USD). The `solPrice` channel through the row/header
 * components is denomination-agnostic (price × solPrice × supply), so this
 * hook is the single feed for it.
 */
export function useNativeUsd(): number {
  const sol = useSolPrice();
  return sol || 0;
}
