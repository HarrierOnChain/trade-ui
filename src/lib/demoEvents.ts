"use client";
/**
 * Tiny pub-sub for "I just fired a demo trade — please refetch."
 *
 * Demo trades don't flow through the real-wallet WebSocket so the
 * portfolio / token-page pollers can lag up to their
 * interval before showing a fresh fill. We fire this event from every
 * site that mutates demo state and have the pollers listen for it to
 * trigger an immediate refresh. Backed by a window CustomEvent so the
 * dispatch site doesn't need a reference to the listening hook.
 */

export const DEMO_CHANGED_EVENT = "terminal:demo-changed";

export function notifyDemoChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(DEMO_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/** Run `cb` immediately, then on every demo-changed event for the lifetime
 *  of the effect. Wire into a useEffect as the only setup so the return
 *  value cleans up the listener.
 */
export function onDemoChanged(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(DEMO_CHANGED_EVENT, handler);
  return () => window.removeEventListener(DEMO_CHANGED_EVENT, handler);
}
