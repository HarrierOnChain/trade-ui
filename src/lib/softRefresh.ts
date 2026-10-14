"use client";
/**
 * Start the app's live state over without reloading the page: the live
 * connection is reset, then everything under ChainProvider mounts again
 * (the same remount a chain switch does), on the page it was on. The lock,
 * the URL and what pages keep in storage survive; component state does not.
 *
 * A screen whose state must not be lost meanwhile (a launch in progress)
 * holds it off: while any hold is out, a refresh is skipped, not queued.
 */

export const SOFT_REFRESH_EVENT = "trade-ui:soft-refresh";
/** The websocket client resets its connection on this (src/api/websocket.ts). */
const RESET_CONNECTION_EVENT = "trade-ui:api-settings";

const holds = new Set<symbol>();

/** Keep soft refreshes off until the returned function is called. */
export function holdSoftRefresh(): () => void {
  const key = Symbol("soft-refresh-hold");
  holds.add(key);
  return () => { holds.delete(key); };
}

/** Refresh now, unless held. Returns whether it did. */
export function softRefresh(): boolean {
  if (typeof window === "undefined" || holds.size > 0) return false;
  window.dispatchEvent(new Event(RESET_CONNECTION_EVENT));
  window.dispatchEvent(new Event(SOFT_REFRESH_EVENT));
  return true;
}
