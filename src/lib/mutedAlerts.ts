/* ─────────────────────────────────────────────────────────────
   Mute state for the LiveAlerts panel.
   Muting a wallet hides its events from the header notification
   panel. State is stored in localStorage so it persists across
   sessions.
   ───────────────────────────────────────────────────────────── */

export const MUTED_WALLETS_KEY = "trade.alerts.mutedWallets";

function readSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function writeSet(key: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch { /* quota / private mode */ }
}

export function readMutedWallets(): Set<string> {
  return readSet(MUTED_WALLETS_KEY);
}

export function writeMutedWallets(ids: Set<string>) {
  writeSet(MUTED_WALLETS_KEY, ids);
}
