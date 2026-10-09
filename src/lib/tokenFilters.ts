import type { TokenEvent } from "../types";
import type { LivePrice } from "../hooks/useLiveTradePrices";
import type { ColumnFilters, Range } from "../contexts/FiltersContext";
import { isSpamToken } from "./activity";
import { platforms } from "../components/PlatformFilter";
import { PLATFORM_FAMILY } from "./launchpadPlatforms.generated";

function inRange(value: number | undefined, r: Range): boolean {
  if (r.min == null && r.max == null) return true;
  if (value == null) return false;
  if (r.min != null && value < r.min) return false;
  if (r.max != null && value > r.max) return false;
  return true;
}

function parseKeywords(raw: string): string[] {
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function matchesAnyKeyword(t: TokenEvent, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const hay = `${t.name || ""} ${t.symbol || ""}`.toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

/**
 * Platform gate for a comma-joined platform filter (`platformString`). Same
 * rule as `passesFilters`: an empty filter or an unknown platform passes, so a
 * launchpad the chips do not list yet is never hidden; a known one must be
 * selected.
 */
export function platformAllowed(dex: string | undefined, platformFilter?: string): boolean {
  if (!platformFilter || !dex) return true;
  const d = dex.trim().toLowerCase();
  const known = platforms().some((p) => p.value.toLowerCase() === d) ||
    Object.keys(PLATFORM_FAMILY).some((b) => b.toLowerCase() === d);
  if (!known) return true;
  return platformFilter.toLowerCase().split(",").some((p) => p.trim() === d);
}

/**
 * True if the token passes all enabled filters. Live WS metrics (`live`) augment
 * REST fields where provided so the "last-seen-volume" style filters still work
 * before the next enrichment tick lands.
 */
export function passesFilters(
  t: TokenEvent,
  live: LivePrice | undefined,
  f: ColumnFilters,
): boolean {
  // Platform — empty = all. Each chip is an exact `platform` match (Bags ≠
  // MeteoraDBC). Unknown platforms always pass so new brands aren't hidden
  // before a chip exists for them.
  if (f.platforms.length > 0 && t.dex) {
    const known = platforms();
    const dex = t.dex.trim().toLowerCase();
    const familyByBrand = new Map(
      Object.entries(PLATFORM_FAMILY).map(([brand, family]) => [
        brand.toLowerCase(),
        family.toLowerCase(),
      ]),
    );
    const dexIsKnown =
      known.some((p) => p.value.toLowerCase() === dex) || familyByBrand.has(dex);
    const selected = new Set(f.platforms.map((p) => p.toLowerCase()));
    if (dexIsKnown && !selected.has(dex)) return false;
  }

  if (f.spam && isSpamToken(t, live)) return false;

  // Keywords
  const include = parseKeywords(f.search);
  if (include.length > 0 && !matchesAnyKeyword(t, include)) return false;
  const exclude = parseKeywords(f.exclude);
  if (exclude.length > 0 && matchesAnyKeyword(t, exclude)) return false;

  // Audit
  if (!inRange(t.bundlePercentage, f.bundlePercentage)) return false;
  if (!inRange(t.sniperPercentage, f.sniperPercentage)) return false;
  if (!inRange(t.creatorDeploys,   f.creatorDeploys))   return false;

  // $ Metrics — prefer live where the WS delta has ticked
  const effTradeCount = (t.tradeCount ?? 0) + (live?.tradeCount ?? 0);
  // The Volume filter is in the native coin (SOL/ETH/BNB), like live.volumeSol;
  // volume24h is USD and must not be mixed in.
  const effVolume = (t.totalSolVolume ?? 0) + (live?.volumeSol ?? 0);

  if (!inRange(t.marketCap,       f.marketCap))       return false;
  if (!inRange(effVolume,         f.volume24h))       return false;
  if (!inRange(t.liquidity,       f.liquidity))       return false;
  if (!inRange(t.priceChange,     f.priceChange))     return false;
  if (!inRange(effTradeCount,     f.tradeCount))      return false;
  if (!inRange(t.holders,         f.holders))         return false;

  // Age (minutes since created_at)
  if (f.ageMinutes.min != null || f.ageMinutes.max != null) {
    const created = Date.parse(t.created_at);
    if (!Number.isFinite(created)) return false;
    const minutes = (Date.now() - created) / 60_000;
    if (!inRange(minutes, f.ageMinutes)) return false;
  }

  // Socials
  if (f.requireTwitter  && !t.twitter)  return false;
  if (f.requireWebsite  && !t.website)  return false;
  if (f.requireTelegram && !t.telegram) return false;

  return true;
}
