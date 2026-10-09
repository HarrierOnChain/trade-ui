/** When the market-data socket last opened (ms since epoch), 0 before. */
let openedAt = 0;

/** Called by the socket (src/api/websocket.ts) on every open, reconnects included. */
export function markStreamOpen(): void {
  openedAt = Date.now();
}

/** Milliseconds to wait so the socket's subscriptions arm before non-critical
 *  metadata requests compete with them. */
export function streamSettledDelay(ms = 3_000): number {
  const since = openedAt > 0 ? Date.now() - openedAt : 0;
  return Math.max(0, ms - since);
}
