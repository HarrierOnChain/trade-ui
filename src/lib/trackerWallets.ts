/* ─────────────────────────────────────────────────────────────
   Tracker wallet storage
   The Tracker keeps two distinct registries side-by-side:

     • User wallets — read-only mirror of the Portfolio page's
       wallet manager (`trade.portfolio.wallets.v3`). The
       Tracker never mutates these; management happens in
       /portfolio.

     • Watchlist — external wallets the user is monitoring
       (whales, KOLs, smart money). Stored under
       `trade.tracker.watchlist.v1` and fully owned by the
       Tracker (add / rename / remove).

   Legacy storage from the first cut of the Tracker
   (`trade.tracker.wallets.v1`) is migrated into the
   watchlist on first read, with any addresses that already
   appear as user wallets filtered out so we don't double-up.
   ───────────────────────────────────────────────────────────── */

import type { TrackedWallet } from "../hooks/useTrackerStream";

export const PORTFOLIO_STORAGE_KEY = "trade.portfolio.wallets.v3";
export const WATCHLIST_STORAGE_KEY = "trade.tracker.watchlist.v1";
export const LEGACY_TRACKER_KEY    = "trade.tracker.wallets.v1";

interface RawPortfolioWallet {
  id: string;
  label: string;
  address: string;
  isPlaceholder?: boolean;
}

interface RawWatchlistWallet {
  id: string;
  label: string;
  address: string;
}

function isRawWallet(v: unknown): v is RawWatchlistWallet {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.label === "string" && typeof o.address === "string";
}

/** Mirror the Portfolio's wallet list as TrackedWallets (source = "user").
 *  Returns an empty array when the user hasn't added any portfolio wallets
 *  yet — never seed demo addresses, otherwise the "My Wallets" tape would
 *  stream somebody else's trades to a brand-new account. */
export function readUserWallets(): TrackedWallet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((w): w is RawPortfolioWallet => {
      if (!isRawWallet(w)) return false;
      // skip the Portfolio's "draft" entries that have no on-chain address
      return !(w as RawPortfolioWallet).isPlaceholder;
    });
    return valid.map((w) => ({
      id: w.id.startsWith("user:") ? w.id : `user:${w.id}`,
      address: w.address,
      label: w.label,
      source: "user" as const,
    }));
  } catch {
    return [];
  }
}

/** Migrate the legacy single-list tracker storage into the new watchlist
 *  key the first time it's read on a given browser. Idempotent. */
function migrateLegacyWatchlist() {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(WATCHLIST_STORAGE_KEY) != null) return;
    const legacy = window.localStorage.getItem(LEGACY_TRACKER_KEY);
    if (!legacy) return;
    const parsed = JSON.parse(legacy);
    if (!Array.isArray(parsed)) return;
    const userAddrs = new Set(readUserWallets().map((w) => w.address));
    const migrated = parsed
      .filter(isRawWallet)
      .filter((w) => !userAddrs.has(w.address));
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(migrated));
  } catch {
    /* ignore */
  }
}

export function readWatchlist(): TrackedWallet[] {
  if (typeof window === "undefined") return [];
  migrateLegacyWatchlist();
  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRawWallet).map((w) => ({
      id: w.id.startsWith("watch:") ? w.id : `watch:${w.id}`,
      address: w.address,
      label: w.label,
      source: "watchlist" as const,
    }));
  } catch {
    return [];
  }
}

export function writeWatchlist(wallets: TrackedWallet[]) {
  if (typeof window === "undefined") return;
  try {
    const stripped = wallets
      .filter((w) => w.source === "watchlist")
      .map((w) => ({
        id: w.id.replace(/^watch:/, ""),
        label: w.label,
        address: w.address,
      }));
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(stripped));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export function makeWatchlistId() {
  return `watch:${Math.random().toString(36).slice(2, 9)}`;
}

export function isSolAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}
