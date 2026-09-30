"use client";
import { mergeDexLabel } from "./format";
import type { TokenEvent } from "../types";

/**
 * Fold a live frame into the row it updates. Only the fields the frame
 * actually carries: a frame has no bundle %, volume or socials, and spreading
 * it whole (`{ ...prev, ...next }`) blanked what the enrichment hooks had
 * filled — on every quote update, now that the API re-sends rows as they move.
 */
export function mergeLiveFrame(prev: TokenEvent, next: TokenEvent): TokenEvent {
  const merged = { ...prev } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === null || v === "") continue;
    merged[k] = v;
  }
  merged.dex = mergeDexLabel(prev.dex, next.dex);
  merged.isNew = prev.isNew;
  return merged as unknown as TokenEvent;
}
