import { DEFAULT_REGION, REGION_IDS, REGION_STORAGE_KEY, REGIONS, isRegionSelectable, type RegionId } from "../lib/regions";

// ─────────────────────────────────────────────────────────────────────────────
// Region selection
//
// Every external network call from the browser now flows through the regional
// Terminal backend over the encrypted wire (see src/lib/wire/). Consequently
// this module no longer ships the Raze API key, the Raze API base, or any
// helper that built URLs against `*.raze.sh` — those are server-side concerns.
// ─────────────────────────────────────────────────────────────────────────────

export function getSelectedRegionId(): RegionId {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(REGION_STORAGE_KEY);
      // Honor a persisted selection only if it's still selectable — a depooled
      // region (e.g. old "de"/"fr"/"nl"/"local") must fall through to the default (cp),
      // otherwise a stale localStorage pick keeps hitting a dead/wrong backend.
      if (raw && (REGION_IDS as readonly string[]).includes(raw) && isRegionSelectable(raw as RegionId)) {
        return raw as RegionId;
      }
      const hostRegion = window.location.hostname.split(".")[0];
      if ((REGION_IDS as readonly string[]).includes(hostRegion) && hostRegion !== "local" && isRegionSelectable(hostRegion as RegionId)) {
        return hostRegion as RegionId;
      }
    } catch {
      /* ignore */
    }
  }
  return DEFAULT_REGION;
}

/** Terminal backend base for the currently-selected region. The wire
 *  singleton is keyed off this value, and it's also the prefix used for the
 *  one HTTP carve-out (`/img`) where image bytes have to be a real URL. */
export function getBackendBase(_regionId: RegionId = getSelectedRegionId()): string {
  return "";
}

/** Backend used only for `/img` byte proxying. */
export function getImgProxyBase(regionId: RegionId = getSelectedRegionId()): string {
  return getBackendBase(regionId);
}
