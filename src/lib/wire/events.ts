/** Fired on `window` after each successful wire handshake + auth (incl. reconnect). */
export const WIRE_OPEN_EVENT = "raze:wire-open";

export type WireOpenDetail = { wsUrl: string };

/** Default wait after wire open before non-critical metadata RPCs. */
export const STREAM_FIRST_MS = 3_000;

let wireReadyAt = 0;

if (typeof window !== "undefined") {
  window.addEventListener(WIRE_OPEN_EVENT, () => {
    wireReadyAt = Date.now();
  });
}

/** Milliseconds to wait so raze.feed subs arm before metadata floods the wire. */
export function streamSettledDelay(ms = STREAM_FIRST_MS): number {
  const sinceWire = wireReadyAt > 0 ? Date.now() - wireReadyAt : 0;
  return Math.max(0, ms - sinceWire);
}
