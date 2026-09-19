"use client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BackendClient } from "../api/backend";
import { getBackendBase } from "../api/config";
import {
  isRegionSelectable,
  REGIONAL_REGION_IDS,
  REGION_CHANGED_EVENT,
  REGION_IDS,
  REGION_PIN_STORAGE_KEY,
  REGION_STORAGE_KEY,
  REGIONS,
  resolveDefaultRegion,
  selectableRegionalIds,
  type Region,
  type RegionId,
  type RegionalRegionId,
} from "../lib/regions";

export type RegionLatencyStatus = "idle" | "checking" | "ok" | "error";

export interface RegionLatency {
  status: RegionLatencyStatus;
  ms?: number;
  checkedAt?: number;
}

type RegionLatencyMap = Record<RegionId, RegionLatency>;

interface Value {
  region: Region;
  regionId: RegionId;
  /** Manually pin a region (the footer/settings picker). Sticks across reloads. */
  setRegion: (id: RegionId) => void;
  /** Online, user-selectable regions (admin-controlled, minus code-depooled). */
  regions: Region[];
  /** Master switch: when false the footer picker is hidden for everyone. */
  regionSelectionEnabled: boolean;
  /** Per-region latency badges (display only — never drives the selection). */
  latencies: RegionLatencyMap;
  /** True while a latency probe is in flight. */
  checking: boolean;
  /** Re-measure latency badges (e.g. when the picker opens). */
  refreshRegionPings: () => void;
}

const Ctx = createContext<Value | null>(null);

const PING_TIMEOUT_MS = 2_500;
// One warm-up request (establishes DNS/TCP/TLS, discarded) + this many
// counted samples; the reported latency is their median. A small
// concurrency pool avoids the 8-way client bandwidth contention that the
// old Promise.all-of-all-regions probe suffered.
const PING_SAMPLES = 3;
const PING_POOL = 3;
// How often a live session re-pulls the admin region config so that enabling
// or disabling a region from the admin panel reaches every open tab without a
// reload. The config is global, so the poll uses whatever region is current.
const CONFIG_POLL_MS = 45_000;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readStoredRegion(): RegionId | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(REGION_STORAGE_KEY);
    if (raw && (REGION_IDS as readonly string[]).includes(raw)) return raw as RegionId;
  } catch {
    /* ignore */
  }
  return null;
}

// True once the user has explicitly picked a region from the footer/settings.
// Until then the region is auto-selected by latency on every page load.
function readPinned(): boolean {
  if (!isBrowser()) return false;
  try {
    return localStorage.getItem(REGION_PIN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setPinned(pinned: boolean) {
  if (!isBrowser()) return;
  try {
    if (pinned) localStorage.setItem(REGION_PIN_STORAGE_KEY, "1");
    else localStorage.removeItem(REGION_PIN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// The region implied by the hostname (e.g. de.raze.sh → "de"), if any.
function hostRegion(): RegionalRegionId | null {
  if (!isBrowser()) return null;
  const first = window.location.hostname.split(".")[0];
  if ((REGIONAL_REGION_IDS as readonly string[]).includes(first)) {
    return first as RegionalRegionId;
  }
  return null;
}

function emptyLatencies(): RegionLatencyMap {
  return REGION_IDS.reduce((acc, id) => {
    acc[id] = { status: "idle" };
    return acc;
  }, {} as RegionLatencyMap);
}

// A stable, content-addressed key for the admin-disabled region set. Storing
// the set as a sorted string lets `setState` bail out when the content is
// unchanged — that referential stability is what stops the old auto-pick →
// getConfig → re-probe → auto-pick infinite loop.
function normalizeDisabledKey(disabled: readonly string[]): string {
  return [...disabled].filter(Boolean).sort().join(",");
}

function disabledFromKey(key: string): string[] {
  return key ? key.split(",") : [];
}

// Persist the active region and notify the wire/datafeed consumers, which read
// the region from localStorage and reconnect when this event fires.
function persistRegion(id: RegionId) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(REGION_STORAGE_KEY, id);
    window.dispatchEvent(new CustomEvent(REGION_CHANGED_EVENT, { detail: { regionId: id } }));
  } catch {
    /* ignore */
  }
}

// A single timed GET of <base>/health. Returns round-trip ms, or null on
// non-2xx / timeout / network error.
async function probeOnce(base: string): Promise<number | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    // No custom headers — keeps this a CORS "simple" GET so app.raze.bot can
    // probe regional *.raze.sh /health without a preflight that our backends
    // don't answer for Accept.
    const res = await fetch(`${base}/health?t=${Date.now()}-${Math.random()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    await res.text().catch(() => "");
    return Math.max(1, Math.round(performance.now() - startedAt));
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function measureRegionLatency(
  id: RegionalRegionId,
): Promise<{ id: RegionalRegionId; ms: number | null }> {
  const base = REGIONS[id].baseUrl.replace(/\/$/, "");

  // Warm-up: pays DNS/TCP/TLS so it doesn't skew the measurement. Discarded.
  // If it fails outright, treat the region as unreachable (skip the rest).
  if ((await probeOnce(base)) == null) return { id, ms: null };

  const samples: number[] = [];
  for (let i = 0; i < PING_SAMPLES; i++) {
    const ms = await probeOnce(base);
    if (ms != null) samples.push(ms);
  }
  if (samples.length === 0) return { id, ms: null };

  samples.sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const median =
    samples.length % 2 === 1
      ? samples[mid]
      : Math.round((samples[mid - 1] + samples[mid]) / 2);
  return { id, ms: Math.max(1, median) };
}

// Run `task` over `items` with at most `pool` in flight at once.
async function mapPooled<T, R>(
  items: readonly T[],
  pool: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(pool, items.length) }, worker));
  return results;
}

export function RegionProvider({ children }: { children: React.ReactNode }) {
  // SSR-stable default so SSR HTML and the first client render agree. The real
  // selection (stored pin or latency auto-pick) is resolved post-mount once we
  // know the online region set. Starting from a localStorage/hostname-derived
  // value here would diverge from SSR and trip React #418.
  const [regionId, setRegionIdState] = useState<RegionId>(() => resolveDefaultRegion());
  const [latencies, setLatencies] = useState<RegionLatencyMap>(() => emptyLatencies());
  const [checking, setChecking] = useState(false);
  const [pingNonce, setPingNonce] = useState(0);
  const [regionSelectionEnabled, setRegionSelectionEnabled] = useState(false);
  // Admin-disabled regions, held as a content-stable string (see normalize).
  const [disabledKey, setDisabledKey] = useState("");

  const disabledTerminalRegions = useMemo(() => disabledFromKey(disabledKey), [disabledKey]);
  const probeRegionIds = useMemo(
    () => selectableRegionalIds(disabledFromKey(disabledKey)),
    [disabledKey],
  );

  const regionIdRef = useRef(regionId);
  regionIdRef.current = regionId;
  const probeIdsRef = useRef(probeRegionIds);
  probeIdsRef.current = probeRegionIds;
  const initializedRef = useRef(false);
  const runIdRef = useRef(0);

  // Adopt a region: update state + ref, persist, and notify consumers. A no-op
  // when the region is unchanged, so it can never feed a render/event loop.
  const applyRegion = useCallback((id: RegionId) => {
    if (regionIdRef.current === id) return;
    regionIdRef.current = id;
    setRegionIdState(id);
    persistRegion(id);
  }, []);

  // Probe a set of regions and update the latency badges. Pure measurement —
  // it never changes the selected region. Returns the raw results so the
  // initial auto-pick can choose from them.
  const runProbe = useCallback(
    async (
      ids: readonly RegionalRegionId[],
    ): Promise<{ id: RegionalRegionId; ms: number | null }[]> => {
      if (!isBrowser() || ids.length === 0) {
        setChecking(false);
        return [];
      }
      const runId = ++runIdRef.current;
      setChecking(true);
      setLatencies((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = { ...next[id], status: "checking" };
        return next;
      });

      const results = await mapPooled(ids, PING_POOL, measureRegionLatency);
      // A newer probe superseded us — let it own the badges + checking flag.
      if (runId !== runIdRef.current) return results;

      const checkedAt = Date.now();
      setLatencies((prev) => {
        const next = { ...prev };
        for (const r of results) {
          next[r.id] = r.ms == null
            ? { status: "error", checkedAt }
            : { status: "ok", ms: r.ms, checkedAt };
        }
        return next;
      });
      setChecking(false);
      return results;
    },
    [],
  );

  // First-load selection, runs exactly once. A manual pin (still online) wins;
  // otherwise the lowest-latency online region is auto-selected.
  const ensureInitialSelection = useCallback(
    async (disabled: readonly string[], selectionEnabled: boolean) => {
      // Master switch OFF: region choice isn't offered to anyone yet (the
      // footer picker is hidden — see `regionSelectionEnabled` doc-comment on
      // `Value`). Without this guard the latency race below still runs for
      // every session regardless of the switch, so a freshly re-pooled region
      // that simply answers /health faster than a loaded "cp" silently
      // hijacks the session onto a backend nobody chose and that may not be
      // fully vetted yet (e.g. "ny" pulled in image-upload traffic while the
      // picker was still supposed to be invisible — see
      // 20-Incidents/2026-07-09-region-autopick-bypasses-master-switch).
      if (!selectionEnabled) {
        const def = resolveDefaultRegion();
        // Heal a stale localStorage pick too (e.g. a leftover "ny" from before
        // this guard existed): `getSelectedRegionId()` in api/config.ts — used
        // independently by getBackendBase()/image-upload — reads localStorage
        // directly and has no idea this in-memory default just changed, so
        // `applyRegion`'s "no-op if unchanged" short-circuit isn't enough here.
        persistRegion(def);
        applyRegion(def);
        return;
      }
      const online = selectableRegionalIds(disabled);

      // 1. Honour a manual pin as long as it's still online.
      if (readPinned()) {
        const pinned = readStoredRegion();
        if (pinned && isRegionSelectable(pinned, disabled)) {
          applyRegion(pinned);
          return;
        }
      }

      // 2. No pin → auto-pick the fastest online region by latency.
      if (online.length > 0) {
        const results = await runProbe(online);
        const best = results
          .filter((r): r is { id: RegionalRegionId; ms: number } => r.ms != null)
          .sort((a, b) => a.ms - b.ms)[0];
        if (best) {
          applyRegion(best.id);
          return;
        }
      }

      // 3. Nothing reachable — fall back so the app still has a backend.
      const host = hostRegion();
      const def = resolveDefaultRegion();
      let fallback: RegionId;
      if (host && isRegionSelectable(host, disabled)) fallback = host;
      else if (isRegionSelectable(def, disabled)) fallback = def;
      else fallback = online[0] ?? def;
      applyRegion(fallback);
    },
    [applyRegion, runProbe],
  );

  // Load the admin region config on mount and poll it so admin changes reach
  // every live session. The first load also kicks off the one-time selection.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function load() {
      let disabled: string[] = [];
      // Emergency escape hatch: if we can't even reach a backend to ask
      // whether selection is enabled, allow the latency race so the app can
      // still route around a fully-dead "cp" — see the catch branch below.
      let selectionEnabled = false;
      try {
        const client = new BackendClient(getBackendBase(regionIdRef.current));
        const cfg = await client.getConfig();
        if (cancelled) return;
        disabled = cfg.disabledTerminalRegions ?? [];
        selectionEnabled = cfg.regionSelectionEnabled ?? false;
        setRegionSelectionEnabled(selectionEnabled);
        setDisabledKey(normalizeDisabledKey(disabled));
      } catch {
        if (cancelled) return;
        if (!initializedRef.current) {
          selectionEnabled = true;
          setRegionSelectionEnabled(true);
          setDisabledKey("");
        }
      } finally {
        if (!cancelled) {
          if (!initializedRef.current) {
            initializedRef.current = true;
            void ensureInitialSelection(disabled, selectionEnabled);
          }
          timer = window.setTimeout(load, CONFIG_POLL_MS);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the active region is pulled offline by an admin (or was never valid),
  // move the user to a live one. A single transition: once the region is
  // selectable again the guard short-circuits, so this can't loop.
  useEffect(() => {
    if (!initializedRef.current) return;
    if (isRegionSelectable(regionId, disabledTerminalRegions)) return;
    const def = resolveDefaultRegion();
    const fallback = probeRegionIds.find((id) => id === def) ?? probeRegionIds[0] ?? def;
    applyRegion(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId, disabledKey, applyRegion]);

  // Footer/settings "refresh pings" → re-measure latency badges only. Reads the
  // current online set via ref so it never re-runs on unrelated config churn.
  useEffect(() => {
    if (pingNonce === 0) return; // initial measurement is owned by the auto-pick
    void runProbe(probeIdsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pingNonce]);

  const refreshRegionPings = useCallback(() => {
    setPingNonce((n) => n + 1);
  }, []);

  const setRegion = useCallback((id: RegionId) => {
    setPinned(true);
    applyRegion(id);
  }, [applyRegion]);

  const regions = useMemo(
    () =>
      REGION_IDS.filter((id) => isRegionSelectable(id, disabledTerminalRegions)).map(
        // "Local (dev)" is tree-shaken out in production (isRegionSelectable
        // returns false when NODE_ENV === "production").
        (id) => REGIONS[id],
      ),
    [disabledTerminalRegions],
  );

  const value = useMemo<Value>(() => ({
    region: REGIONS[regionId],
    regionId,
    setRegion,
    regions,
    regionSelectionEnabled,
    latencies,
    checking,
    refreshRegionPings,
  }), [
    regionId,
    setRegion,
    regions,
    regionSelectionEnabled,
    latencies,
    checking,
    refreshRegionPings,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRegion() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRegion must be used inside RegionProvider");
  return v;
}
