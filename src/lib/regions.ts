/**
 * Terminal backend regions: CP (global) + NY (US East).
 *
 * Public data-plane: api (history), local gateway (tx/RPC), router, ws.
 * Browser reads use the backend wire; `razeHttpUrl` is the history host (api).
 *
 * Hostnames (2026-07-20):
 *   cp → https://global.raze.sh  (CP 103.7.55.178, ENGINE primary)
 *   ny → https://nyc.raze.sh     (ns2 82.38.44.166, ENGINE OFF replica)
 * Legacy aliases still live: app.raze.bot/terminal/backend, ny.raze.sh.
 */

export const REGIONAL_REGION_IDS = ["cp", "ny"] as const;
export const REGION_IDS = ["local", ...REGIONAL_REGION_IDS] as const;
export type RegionId = (typeof REGION_IDS)[number];
export type RegionalRegionId = (typeof REGIONAL_REGION_IDS)[number];

/** Legacy ids kept depooled so stale localStorage picks fall through to cp.
 *  "ny" was re-pooled 2026-07-09 (terminal2-backend replica live on ns2) —
 *  see 10-Decisions/2026-07-09-ny-raze-sh-repoint-ns2-backend.md;
 *  2026-07-20 renamed public host to nyc.raze.sh (+ global.raze.sh for cp). */
export const DEPOOLED_REGION_IDS = [
  "ca", "de", "sg", "fr", "nl", "uk", "jp", "ams",
] as const;

export function isDepooled(id: RegionId): boolean {
  return (DEPOOLED_REGION_IDS as readonly string[]).includes(id);
}

/** Whether a region may appear in the footer picker / AUTO rotation. */
export function isRegionSelectable(
  id: RegionId,
  adminDisabled: readonly string[] = [],
): boolean {
  if (id === "local") return process.env.NODE_ENV !== "production";
  if (isDepooled(id)) return false;
  return !(adminDisabled as readonly string[]).includes(id);
}

export function selectableRegionalIds(adminDisabled: readonly string[] = []): RegionalRegionId[] {
  return REGIONAL_REGION_IDS.filter((id) => isRegionSelectable(id, adminDisabled));
}

/** Regional backends actually offered/probed (canonical set minus depooled). */
export const ACTIVE_REGIONAL_REGION_IDS: readonly RegionalRegionId[] =
  REGIONAL_REGION_IDS.filter((id) => !isDepooled(id));

export interface Region {
  id: RegionId;
  label: string;
  flag: string;
  baseUrl: string;
  razeHttpUrl: string;
  razeWsUrl: string;
}

const TERMINAL_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

// Next only inlines NEXT_PUBLIC_* when accessed as a static property
// (`process.env.NEXT_PUBLIC_FOO`). Dynamic `process.env[key]` stays empty in
// the browser bundle — always list each key explicitly here.
function backendUrl(id: RegionId, fallback: string): string {
  const v =
    id === "local" ? process.env.NEXT_PUBLIC_BACKEND_URL_LOCAL
    : id === "cp" ? process.env.NEXT_PUBLIC_BACKEND_URL_CP
    : id === "ny" ? process.env.NEXT_PUBLIC_BACKEND_URL_NY
    : undefined;
  return (v && v.trim()) || fallback;
}

function razeHttpUrl(id: RegionId, fallback: string): string {
  const v =
    id === "local" ? process.env.NEXT_PUBLIC_RAZE_HTTP_URL_LOCAL
    : id === "cp" ? process.env.NEXT_PUBLIC_RAZE_HTTP_URL_CP
    : id === "ny" ? process.env.NEXT_PUBLIC_RAZE_HTTP_URL_NY
    : undefined;
  return (v && v.trim()) || fallback;
}

function razeWsUrl(id: RegionId, fallback: string): string {
  const v =
    id === "local" ? process.env.NEXT_PUBLIC_RAZE_WS_URL_LOCAL
    : id === "cp" ? process.env.NEXT_PUBLIC_RAZE_WS_URL_CP
    : id === "ny" ? process.env.NEXT_PUBLIC_RAZE_WS_URL_NY
    : undefined;
  return (v && v.trim()) || fallback;
}

function localBackendFallback(): string {
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return `${window.location.origin}${TERMINAL_BASE_PATH}/backend`;
  }
  return "http://127.0.0.1:4000";
}

export const REGIONS: Record<RegionId, Region> = {
  local: {
    id: "local",
    label: "Local (dev)",
    flag: "DEV",
    baseUrl: backendUrl("local", localBackendFallback()),
    razeHttpUrl: razeHttpUrl("local", "https://api.raze.bot"),
    razeWsUrl: razeWsUrl("local", "wss://ws.raze.bot"),
  },
  cp: {
    id: "cp",
    label: "Global",
    flag: "Global",
    baseUrl: backendUrl("cp", "https://global.raze.sh"),
    razeHttpUrl: razeHttpUrl("cp", "https://api.raze.bot"),
    razeWsUrl: razeWsUrl("cp", "wss://ws.raze.bot"),
  },
  ny: {
    id: "ny",
    label: "US East",
    flag: "US",
    baseUrl: backendUrl("ny", "https://nyc.raze.sh"),
    razeHttpUrl: razeHttpUrl("ny", "https://api.raze.bot"),
    razeWsUrl: razeWsUrl("ny", "wss://ws.raze.bot"),
  },
};

const envDefault = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_DEFAULT_REGION) || "";
const SAFE_DEFAULT_REGION: RegionId =
  process.env.NODE_ENV === "production" ? "cp" : "local";
const envDefaultUsable =
  (REGION_IDS as readonly string[]).includes(envDefault) &&
  isRegionSelectable(envDefault as RegionId);
export const DEFAULT_REGION: RegionId = envDefaultUsable
  ? (envDefault as RegionId)
  : SAFE_DEFAULT_REGION;

export function resolveDefaultRegion(): RegionId {
  if (envDefaultUsable) {
    return envDefault as RegionId;
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname.split(".")[0];
    if (host === "app" || host === "cp" || host === "global") {
      return "cp";
    }
    if (host === "ny" || host === "nyc") {
      return "ny";
    }
  }
  return DEFAULT_REGION;
}

// v5 — chart-dev (2026-07-21): clears stale v4 picks that pinned "cp" while
// the local backend URL bake was broken (dynamic process.env[key] → 127.0.0.1).
export const REGION_STORAGE_KEY = "trade.region.v5";
export const REGION_PIN_STORAGE_KEY = "trade.region.pin.v1";
export const REGION_CHANGED_EVENT = "terminal:region-changed";
