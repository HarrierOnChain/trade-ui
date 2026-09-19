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
