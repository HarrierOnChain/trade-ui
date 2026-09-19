/**
 * Preview-mint registry. Lets non-route surfaces (the `/deploy` page) drive
 * the same token-page hooks (`useTokenInfo`, `useTrades`, `useHolders`,
 * `useLiveTradePrices`) with synthetic data instead of fetching from the
 * backend for a mint that doesn't exist yet.
 *
 * Each hook that supports preview-mode calls `getPreviewData(mint)` at the
 * top of its body and (if non-null) returns the synthetic snapshot directly
 * — short-circuiting REST + WS work. To stay reactive, hooks also
 * `subscribePreview(mint, cb)` so updates from the deploy form re-render the
 * components.
 *
 * The registry is a process-global map. There's no SSR concern because
 * every consuming surface is a "use client" file; the deploy page populates
 * the registry on mount and clears it on unmount.
 */

import type { TokenEvent, Trade, Holder } from "../types";
import type { LivePrice } from "../hooks/useLiveTradePrices";

export interface PreviewSnapshot {
  /** Synthetic header info (name/symbol/image/marketCap/...) for `useTokenInfo`. */
  tokenInfo: TokenEvent | null;
  /** Synthetic trades (one per planned wallet buy) for `useTrades`. */
  trades: Trade[];
  /** Synthetic holders (one per wallet allocation) for `useHolders`. */
  holders: Holder[];
  /** Synthetic live tick for `useLiveTradePrices`. */
  livePrice: LivePrice | null;
  /** Pump.fun default supply (1B); fed to `fetchTokenSupply`. */
  supply: number;
}

type Listener = () => void;

const registry = new Map<string, PreviewSnapshot>();
const listeners = new Map<string, Set<Listener>>();

export function registerPreviewToken(mint: string, snapshot: PreviewSnapshot): void {
  registry.set(mint, snapshot);
  notify(mint);
}

export function clearPreviewToken(mint: string): void {
  if (!registry.delete(mint)) return;
  notify(mint);
}

export function getPreviewData(mint: string | null | undefined): PreviewSnapshot | null {
  if (!mint) return null;
  return registry.get(mint) ?? null;
}

/** `true` iff `mint` has been registered as a synthetic-preview mint. */
export function isPreviewMint(mint: string | null | undefined): boolean {
  if (!mint) return false;
  return registry.has(mint);
}

// ── Stream-only mints ─────────────────────────────────────────────────────
//
// A "stream-only" mint skips ALL REST history (OHLCV, trades, holders, token
// stats) — its chart/trades/holders build purely from the live WS feed.
// UNLIKE a preview mint, WS subscriptions stay ACTIVE (preview blocks both).
//
// Used right after a /deploy launch: the token is seconds old, so there is no
// history worth fetching — fetching it just causes a visible chart reload to
// an empty series. Marking the new mint stream-only makes the surface build
// from the stream (our own bundle buys + subsequent trades) with no reload.

const streamOnly = new Set<string>();

export function markStreamOnly(mint: string | null | undefined): void {
  if (mint) streamOnly.add(mint);
}

export function unmarkStreamOnly(mint: string | null | undefined): void {
  if (mint) streamOnly.delete(mint);
}

/** `true` iff `mint` should build from the live stream with no REST history. */
export function isStreamOnly(mint: string | null | undefined): boolean {
  return !!mint && streamOnly.has(mint);
}

export function subscribePreview(mint: string, cb: Listener): () => void {
  let set = listeners.get(mint);
  if (!set) {
    set = new Set();
    listeners.set(mint, set);
  }
  set.add(cb);
  return () => {
    const s = listeners.get(mint);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) listeners.delete(mint);
  };
}

function notify(mint: string) {
  const set = listeners.get(mint);
  if (!set || set.size === 0) return;
  for (const cb of set) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}
