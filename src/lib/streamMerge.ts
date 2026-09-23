"use client";
import { mergeDexLabel } from "./format";
import type { TokenEvent } from "../types";

/**
 * Fields a deploy/migration snapshot (REST or WS) is the authoritative source
 * for. Everything OUTSIDE this set — marketCap, volume24h, holders,
 * bundlePercentage/sniperPercentage, twitter/telegram/website, … — is filled
 * asynchronously by useTokenEnrichment / useMetaEnrichment and MUST survive a
 * poll. Mirrors useMigratingStream's SNAPSHOT_KEYS.
 */
const SNAPSHOT_KEYS: Array<keyof TokenEvent> = [
  "mint_address", "signer", "dex", "name", "symbol", "uri", "slot",
  "image", "creatorBuySol", "creatorBuyPrice", "creatorBuyTokens",
  "lastPrice", "created_at", "migrated_at",
  // The quote. No enrichment hook sets these, so leaving them out froze every
  // row's market cap and change at whatever its first snapshot said. The API
  // brings REST rows up to the latest pushed quote, so a poll is fresher.
  "marketCap", "priceChange", "graduationPercent",
];

function rowsEqual(a: TokenEvent, b: TokenEvent): boolean {
  for (const k of SNAPSHOT_KEYS) if (a[k] !== b[k]) return false;
  return true;
}

function mergeKeepingEnriched(prev: TokenEvent, next: TokenEvent): TokenEvent {
  const merged = { ...prev } as unknown as Record<string, unknown>;
  const n = next as unknown as Record<string, unknown>;
  for (const k of SNAPSHOT_KEYS) {
    const v = n[k as string];
    if (v === undefined || v === null || v === "") continue;
    merged[k as string] = v;
  }
  // Keep a pump-family launchpad (Mayhem) label if the snapshot reports the
  // pumpfun/pumpswap trade venue instead.
  merged.dex = mergeDexLabel(prev.dex, next.dex);
  return merged as unknown as TokenEvent;
}

/**
 * Reconcile a fresh newest-first snapshot into a live streamed list WITHOUT
 * wiping enriched fields (marketCap/volume/holders/socials/image, set async by
 * the enrichment hooks) or resetting object identity for unchanged rows.
 *
 * This is what stops the deploy/migration Monitor columns from visibly
 * "refreshing" on every poll: a naive `setTokens(snapshot)` replaces every row
 * object, blanking enriched data until it re-fetches → a full-column flash.
 *
 * Unlike useMigratingStream this does NOT drop rows the snapshot omits — on the
 * deploy/migration columns those are fresher WS-delivered tokens the (stale,
 * ~15s) REST poll simply hasn't caught up to. The union is re-sorted
 * newest-first via `tsOf` and truncated to `max`, so aged-out rows fall off.
 *
 * Returns the SAME `prev` reference when the reconcile is a no-op, so
 * `setTokens(prev)` short-circuits and no re-render / re-enrich fires.
 */
export function reconcileSnapshot(
  prev: TokenEvent[],
  incoming: TokenEvent[],
  max: number,
  tsOf: (t: TokenEvent) => number,
): TokenEvent[] {
  const incomingByMint = new Map<string, TokenEvent>();
  for (const t of incoming) {
    if (t.mint_address && !incomingByMint.has(t.mint_address)) {
      incomingByMint.set(t.mint_address, t);
    }
  }

  const out: TokenEvent[] = [];
  const seen = new Set<string>();

  // Existing rows: keep identity + enriched data, merge snapshot fields.
  for (const old of prev) {
    if (!old.mint_address || seen.has(old.mint_address)) continue;
    seen.add(old.mint_address);
    const next = incomingByMint.get(old.mint_address);
    if (!next) { out.push(old); continue; } // WS-fresh; snapshot not caught up
    const merged = mergeKeepingEnriched(old, next);
    out.push(rowsEqual(merged, old) ? old : merged);
  }

  // Snapshot rows we didn't already have. The live WS path owns the `isNew`
  // entry animation, so poll-introduced rows arrive un-flagged (as before).
  for (const t of incoming) {
    if (!t.mint_address || seen.has(t.mint_address)) continue;
    seen.add(t.mint_address);
    out.push({ ...t });
  }

  out.sort((a, b) => tsOf(b) - tsOf(a));
  const list = out.length > max ? out.slice(0, max) : out;

  if (list.length === prev.length && list.every((t, i) => t === prev[i])) {
    return prev;
  }
  return list;
}

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

function sameRow(a: TokenEvent, b: TokenEvent): boolean {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  return Object.keys(y).every((k) => x[k] === y[k]);
}

/**
 * Apply one live frame to a newest-first column (`tsOf` orders it).
 *
 * A row the column holds is merged (`mergeLiveFrame`). A token it does not
 * hold goes in at its own time, not on top, and not at all when that lands
 * past `max`: the API re-sends a moving token about once a second, and an
 * older migration re-sent that way used to jump to the top of the column.
 * `insertAs` is the row to insert when it must differ from the merge (e.g. a
 * first sighting with no time of its own yet). Returns `prev` itself when
 * nothing changes, so React skips the render.
 */
export function applyLiveFrame(
  prev: TokenEvent[],
  token: TokenEvent,
  tsOf: (t: TokenEvent) => number,
  max: number,
  insertAs: TokenEvent = token,
): TokenEvent[] {
  const i = prev.findIndex((t) => t.mint_address === token.mint_address);
  if (i >= 0) {
    const merged = mergeLiveFrame(prev[i], token);
    if (sameRow(prev[i], merged)) return prev;
    const next = prev.slice();
    next[i] = merged;
    return next;
  }
  const ts = tsOf(insertAs);
  let j = 0;
  while (j < prev.length && tsOf(prev[j]) >= ts) j++;
  if (j >= max) return prev;
  const next = prev.slice();
  next.splice(j, 0, insertAs);
  return next.slice(0, max);
}
