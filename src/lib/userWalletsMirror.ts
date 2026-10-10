/* ─────────────────────────────────────────────────────────────
   The user's own wallets, read synchronously.

   useUserWallets mirrors the vault's wallet list into
   localStorage (`trade.portfolio.wallets.v3`) so code outside
   React (the ticker bar, the status footer)
   can read it without waiting on the provider.
   ───────────────────────────────────────────────────────────── */

import type { StreamWallet } from "../hooks/useWalletTradeStream";

export const PORTFOLIO_STORAGE_KEY = "trade.portfolio.wallets.v3";

interface RawPortfolioWallet {
  id: string;
  label: string;
  address: string;
  isPlaceholder?: boolean;
}

function isRawWallet(v: unknown): v is RawPortfolioWallet {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.label === "string" && typeof o.address === "string";
}

/** The mirrored wallet list as TrackedWallets. Returns an empty array when
 *  the user hasn't added any wallets yet — never seed demo addresses,
 *  otherwise a brand-new install would stream somebody else's trades. */
export function readUserWallets(): StreamWallet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // skip "draft" entries that have no on-chain address
    const valid = parsed.filter((w): w is RawPortfolioWallet => isRawWallet(w) && !w.isPlaceholder);
    return valid.map((w) => ({
      id: w.id.startsWith("user:") ? w.id : `user:${w.id}`,
      address: w.address,
      label: w.label,
    }));
  } catch {
    return [];
  }
}
