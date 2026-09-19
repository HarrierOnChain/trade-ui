/** Canonical deep-link paths for the perps terminal: `/perps/jup-SOL`. */

export const PERP_VENUES = ["jup", "phoenix"] as const;
export type PerpVenueSlug = (typeof PERP_VENUES)[number];

export const DEFAULT_PERP_SLUG = "jup-SOL";
export const DEFAULT_PERP_PATH = `/perps/${DEFAULT_PERP_SLUG}`;

/** `jup:SOL-PERP` → `/perps/jup-SOL` */
export function marketIdToPerpPath(marketId: string): string {
  const colon = marketId.indexOf(":");
  if (colon <= 0) return DEFAULT_PERP_PATH;
  const venue = marketId.slice(0, colon);
  let symbol = marketId.slice(colon + 1);
  if (symbol.endsWith("-PERP")) symbol = symbol.slice(0, -5);
  if (!symbol || !PERP_VENUES.includes(venue as PerpVenueSlug)) return DEFAULT_PERP_PATH;
  return `/perps/${venue}-${symbol}`;
}

/** `/perps/jup-SOL` → `jup:SOL-PERP` */
export function perpPathToMarketId(pathname: string): string | null {
  const m = pathname.match(/^\/perps\/([^/?#]+)$/);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  for (const venue of PERP_VENUES) {
    const prefix = `${venue}-`;
    if (!slug.startsWith(prefix)) continue;
    const asset = slug.slice(prefix.length);
    if (!asset) return null;
    return `${venue}:${asset}-PERP`;
  }
  return null;
}

export function isPerpsPath(pathname: string): boolean {
  return pathname === "/perps" || pathname.startsWith("/perps/");
}

/** Legacy `/perpetuals?market=jup:SOL-PERP` → `/perps/jup-SOL`. */
export function legacyPerpetualsRedirect(marketQuery: string | null | undefined): string {
  if (marketQuery?.includes(":")) return marketIdToPerpPath(marketQuery);
  return DEFAULT_PERP_PATH;
}

export function perpHref(marketId: string): string {
  return marketIdToPerpPath(marketId);
}
