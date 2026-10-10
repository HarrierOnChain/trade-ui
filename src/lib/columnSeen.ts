"use client";
import { useSyncExternalStore } from "react";
import {
  FLAG_FILTERS,
  RANGE_FILTERS,
  platformKey,
  type ColumnKey,
} from "./tokenFilters";
import { SOL_PLATFORM_CHIPS } from "./launchpadPlatforms.generated";
import type { TokenEvent } from "../types";

/**
 * What each monitor column has really received, per chain: the launchpads its
 * rows named, and the filter fields that carry information — seen with at
 * least two different values. A field the API leaves empty, or always fills
 * with the same constant (blue-chip holders on /tokens, Solana bundlers), can
 * filter nothing, so the modal does not offer it. The filter modal lists only
 * what is here, so it follows the API instead of a fixed list.
 *
 * Kept in localStorage (pruned after `TTL_MS` unseen) so the modal is
 * complete on the next visit before the first rows land.
 */
const STORAGE_KEY = "trade-ui.monitor-seen.v1";
const TTL_MS = 14 * 86_400_000;
const MAX_PLATFORMS = 150;
/** How stale a timestamp may get before a sighting refreshes it. */
const TOUCH_MS = 3_600_000;

interface ScopeState {
  /** platformKey → name as the rows spell it, rows seen, last seen (ms). */
  platforms: Record<string, { label: string; n: number; at: number }>;
  /** Filter field → last seen with a value (ms), once it varied. */
  fields: Record<string, number>;
}

export interface SeenPlatform {
  key: string;
  /** The rows' spelling (the logo key). */
  name: string;
}

export interface ColumnSeen {
  /** Most frequent first. */
  platforms: SeenPlatform[];
  fields: ReadonlySet<string>;
}

const OBSERVERS: Array<{ key: string; observe: (t: TokenEvent, now: number) => number | boolean | undefined }> = [
  ...RANGE_FILTERS.map((s) => ({ key: s.key, observe: (t: TokenEvent, now: number) => s.value(t, undefined, now) })),
  ...FLAG_FILTERS.map((s) => ({ key: s.key, observe: (t: TokenEvent) => s.observe(t) })),
];

let state: Record<string, ScopeState> | null = null;
/** First value per scope+field, until a different one shows the field varies. */
const firstValue = new Map<string, number | boolean>();
const listeners = new Set<() => void>();
let version = 0;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const snapshots = new Map<string, { version: number; value: ColumnSeen }>();
const EMPTY: ColumnSeen = { platforms: [], fields: new Set() };

function load(): Record<string, ScopeState> {
  if (state) return state;
  state = {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, ScopeState>;
    const cutoff = Date.now() - TTL_MS;
    for (const [id, sc] of Object.entries(raw)) {
      if (!sc || typeof sc !== "object") continue;
      const platforms = Object.entries(sc.platforms ?? {})
        .filter(([, p]) => p && typeof p.label === "string" && p.at > cutoff)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, MAX_PLATFORMS);
      const fields = Object.entries(sc.fields ?? {}).filter(([, at]) => typeof at === "number" && at > cutoff);
      state[id] = { platforms: Object.fromEntries(platforms), fields: Object.fromEntries(fields) };
    }
  } catch {
    /* unreadable or blocked storage: start empty */
  }
  return state;
}

function changed(): void {
  version++;
  if (notifyTimer != null) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const l of listeners) l();
  }, 250);
}

function persist(): void {
  if (saveTimer != null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, 5_000);
}

/** Record what `rows` of `column` carry (each on its own chain). */
export function noteRows(column: ColumnKey, rows: Iterable<TokenEvent>): void {
  if (typeof window === "undefined") return;
  const all = load();
  const now = Date.now();
  let grew = false;
  let dirty = false;
  for (const t of rows) {
    if (!t.chain || !t.mint_address) continue;
    const id = `${t.chain}:${column}`;
    const sc = (all[id] ??= { platforms: {}, fields: {} });

    const key = platformKey(t.dex);
    const p = sc.platforms[key];
    if (p) {
      p.n++;
      if (now - p.at > TOUCH_MS) { p.at = now; dirty = true; }
    } else {
      sc.platforms[key] = { label: String(t.dex ?? "").trim(), n: 1, at: now };
      grew = true;
    }

    for (const o of OBSERVERS) {
      const at = sc.fields[o.key];
      const v = o.observe(t, now);
      if (v === undefined) continue;
      if (at != null) {
        if (now - at > TOUCH_MS) { sc.fields[o.key] = now; dirty = true; }
        continue;
      }
      const fk = `${id}:${o.key}`;
      const first = firstValue.get(fk);
      if (first === undefined) firstValue.set(fk, v);
      else if (first !== v) {
        sc.fields[o.key] = now;
        firstValue.delete(fk);
        grew = true;
      }
    }
  }
  if (grew) changed();
  if (grew || dirty) persist();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function snapshot(id: string): ColumnSeen {
  const cached = snapshots.get(id);
  if (cached && cached.version === version) return cached.value;
  const sc = load()[id];
  const value: ColumnSeen = sc
    ? {
        platforms: Object.entries(sc.platforms)
          .sort((a, b) => b[1].n - a[1].n || a[1].label.localeCompare(b[1].label))
          .map(([key, p]) => ({ key, name: p.label })),
        fields: new Set(Object.keys(sc.fields)),
      }
    : EMPTY;
  snapshots.set(id, { version, value });
  return value;
}

/** Launchpads and filterable fields seen in `column` on `chain`. */
export function useColumnSeen(chain: string, column: ColumnKey): ColumnSeen {
  const id = `${chain}:${column}`;
  return useSyncExternalStore(subscribe, () => snapshot(id), () => EMPTY);
}

/** Display name of a launchpad (`name` as the rows spell it). */
export function platformLabel(name: string): string {
  if (!name) return "No launchpad";
  const key = platformKey(name);
  return SOL_PLATFORM_CHIPS.find((c) => c.value.toLowerCase() === key)?.label ?? name;
}
