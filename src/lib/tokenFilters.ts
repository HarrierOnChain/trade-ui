/**
 * Monitor column filters: what each column keeps, which token field every
 * filter reads, and the gate the columns apply.
 *
 * Every filter here reads a field the API really sends (lib/columnSeen.ts
 * decides, per chain and column, which of them the modal shows). Type-only
 * imports, so `node --test` can load it (src/lib/tokenFilters.test.ts).
 */
import type { TokenEvent } from "../types";

export type ColumnKey = "trending" | "deploy" | "migrating" | "migration";

export const COLUMN_KEYS: ColumnKey[] = ["trending", "deploy", "migrating", "migration"];

export interface Range {
  min?: number;
  max?: number;
}

export type RangeKey =
  | "top10Percent"
  | "devPercent"
  | "insidersPercent"
  | "sniperPercentage"
  | "bundlePercentage"
  | "freshWalletsPercent"
  | "botsPercent"
  | "buyTaxPercent"
  | "sellTaxPercent"
  | "creatorDeploys"
  | "marketCap"
  | "liquidity"
  | "volume24h"
  | "priceChange"
  | "tradeCount"
  | "buyCount"
  | "sellCount"
  | "holders"
  | "graduationPercent"
  | "ageMinutes";

export type FlagKey =
  | "hideHoneypot"
  | "requireMintRenounced"
  | "requireFreezeRenounced"
  | "requireTwitter"
  | "requireWebsite"
  | "requireTelegram"
  | "requireDiscord";

export type ColumnFilters = {
  /** Hide tokens with no trades and no volume, and same-name duplicates. */
  spam: boolean;
  /** Launchpads hidden from the column, per chain, as `platformKey`s. A
   *  launchpad not listed shows, so one the column has never seen is never
   *  hidden. */
  hiddenPlatforms: Record<string, string[]>;
  search: string;
  exclude: string;
} & Record<RangeKey, Range> & Record<FlagKey, boolean>;

export type FilterTab = "audit" | "metrics" | "socials";

export interface RangeSpec {
  key: RangeKey;
  tab: "audit" | "metrics";
  label: string;
  hint?: string;
  unit?: "pct" | "usd" | "native" | "min";
  /** The row's value; `undefined` while the API has not said. */
  value: (t: TokenEvent, now?: number) => number | undefined;
}

export interface FlagSpec {
  key: FlagKey;
  tab: "audit" | "socials";
  label: string;
  hint?: string;
  /** What the row says about the field (`undefined` = nothing yet). */
  observe: (t: TokenEvent) => boolean | undefined;
  /** Whether the row passes with the flag on; `undefined` while unknown. */
  pass: (t: TokenEvent) => boolean | undefined;
}

function ageMinutes(t: TokenEvent, now = Date.now()): number | undefined {
  const created = Date.parse(t.created_at);
  return Number.isFinite(created) ? (now - created) / 60_000 : undefined;
}

export const RANGE_FILTERS: RangeSpec[] = [
  { key: "top10Percent", tab: "audit", label: "Top 10 holders", unit: "pct",
    hint: "Supply held by the ten largest holders", value: (t) => t.top10Percent },
  { key: "devPercent", tab: "audit", label: "Dev holding", unit: "pct",
    hint: "Supply held by the creator and linked wallets", value: (t) => t.devPercent },
  { key: "insidersPercent", tab: "audit", label: "Insiders", unit: "pct",
    hint: "Supply held by insider wallets", value: (t) => t.insidersPercent },
  { key: "sniperPercentage", tab: "audit", label: "Snipers", unit: "pct",
    hint: "Supply held by wallets that bought in the first blocks", value: (t) => t.sniperPercentage },
  { key: "bundlePercentage", tab: "audit", label: "Bundlers", unit: "pct",
    hint: "Supply bought in bundled transactions", value: (t) => t.bundlePercentage },
  { key: "freshWalletsPercent", tab: "audit", label: "Fresh wallets", unit: "pct",
    hint: "Holders whose wallet is brand new", value: (t) => t.freshWalletsPercent },
  { key: "botsPercent", tab: "audit", label: "Bots", unit: "pct",
    hint: "Holders that are trading bots", value: (t) => t.botsPercent },
  { key: "buyTaxPercent", tab: "audit", label: "Buy tax", unit: "pct",
    hint: "Transfer tax on buys", value: (t) => t.buyTaxPercent },
  { key: "sellTaxPercent", tab: "audit", label: "Sell tax", unit: "pct",
    hint: "Transfer tax on sells", value: (t) => t.sellTaxPercent },
  { key: "creatorDeploys", tab: "audit", label: "Dev deploys",
    hint: "Tokens this dev has launched", value: (t) => t.creatorDeploys },

  { key: "marketCap", tab: "metrics", label: "Market cap", unit: "usd", value: (t) => t.marketCap },
  { key: "liquidity", tab: "metrics", label: "Liquidity", unit: "usd", value: (t) => t.liquidity },
  { key: "volume24h", tab: "metrics", label: "Volume 24h", unit: "native",
    value: (t) => t.totalSolVolume },
  { key: "priceChange", tab: "metrics", label: "Price change 24h", unit: "pct", value: (t) => t.priceChange },
  { key: "tradeCount", tab: "metrics", label: "Trades 24h",
    value: (t) => t.tradeCount },
  { key: "buyCount", tab: "metrics", label: "Buys 24h", value: (t) => t.buyCount },
  { key: "sellCount", tab: "metrics", label: "Sells 24h", value: (t) => t.sellCount },
  { key: "holders", tab: "metrics", label: "Holders", value: (t) => t.holders },
  { key: "graduationPercent", tab: "metrics", label: "Bonding curve", unit: "pct",
    hint: "How full the launchpad curve is", value: (t) => t.graduationPercent },
  { key: "ageMinutes", tab: "metrics", label: "Age", unit: "min",
    value: (t, now) => ageMinutes(t, now) },
];

const present = (v: string | null | undefined) => Boolean(v && v.trim());

export const FLAG_FILTERS: FlagSpec[] = [
  { key: "hideHoneypot", tab: "audit", label: "Hide honeypots",
    hint: "Tokens flagged as impossible to sell",
    observe: (t) => t.honeypot,
    // Only a known honeypot is hidden: most rows carry no verdict.
    pass: (t) => t.honeypot !== true },
  { key: "requireMintRenounced", tab: "audit", label: "Mint renounced",
    hint: "Nobody can mint more",
    observe: (t) => t.mintRenounced, pass: (t) => t.mintRenounced },
  { key: "requireFreezeRenounced", tab: "audit", label: "Freeze renounced",
    hint: "Nobody can freeze holders",
    observe: (t) => t.freezeRenounced, pass: (t) => t.freezeRenounced },
  { key: "requireTwitter", tab: "socials", label: "X / Twitter",
    observe: (t) => present(t.twitter), pass: (t) => present(t.twitter) },
  { key: "requireWebsite", tab: "socials", label: "Website",
    observe: (t) => present(t.website), pass: (t) => present(t.website) },
  { key: "requireTelegram", tab: "socials", label: "Telegram",
    observe: (t) => present(t.telegram), pass: (t) => present(t.telegram) },
  { key: "requireDiscord", tab: "socials", label: "Discord",
    observe: (t) => present(t.discord), pass: (t) => present(t.discord) },
];

/** The launchpad a row is filed under: its name, lowercase; `""` = none. */
export function platformKey(dex: string | null | undefined): string {
  return String(dex ?? "").trim().toLowerCase();
}

export function isRangeSet(r: Range | undefined): boolean {
  return r != null && (r.min != null || r.max != null);
}

export function defaultFilters(): ColumnFilters {
  const f = {
    spam: false,
    hiddenPlatforms: {},
    search: "",
    exclude: "",
  } as ColumnFilters;
  for (const s of RANGE_FILTERS) f[s.key] = {};
  for (const s of FLAG_FILTERS) f[s.key] = false;
  return f;
}

function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * A stored column (any older shape) over the current defaults. The old
 * `platforms` list (the launchpads kept, from a fixed per-chain set the API
 * did not match) is dropped: every launchpad shows again.
 */
export function reviveColumnFilters(raw: unknown): ColumnFilters {
  const f = defaultFilters();
  if (!raw || typeof raw !== "object") return f;
  const o = raw as Record<string, unknown>;
  if (typeof o.spam === "boolean") f.spam = o.spam;
  if (typeof o.search === "string") f.search = o.search;
  if (typeof o.exclude === "string") f.exclude = o.exclude;
  const hidden = o.hiddenPlatforms;
  if (hidden && typeof hidden === "object") {
    for (const [chain, list] of Object.entries(hidden as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const keys = [...new Set(list.filter((v): v is string => typeof v === "string").map(platformKey))];
      if (keys.length) f.hiddenPlatforms[chain] = keys;
    }
  }
  for (const s of RANGE_FILTERS) {
    const r = o[s.key];
    if (!r || typeof r !== "object") continue;
    const min = finite((r as Range).min);
    const max = finite((r as Range).max);
    f[s.key] = { ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) };
  }
  for (const s of FLAG_FILTERS) {
    if (typeof o[s.key] === "boolean") f[s.key] = o[s.key] as boolean;
  }
  return f;
}

/** Active filters per modal tab on `chain`. */
export function tabCounts(f: ColumnFilters, chain: string): Record<"protocols" | FilterTab, number> {
  const n = { protocols: (f.hiddenPlatforms[chain]?.length ?? 0) > 0 ? 1 : 0, audit: 0, metrics: 0, socials: 0 };
  for (const s of RANGE_FILTERS) if (isRangeSet(f[s.key])) n[s.tab]++;
  for (const s of FLAG_FILTERS) if (f[s.key]) n[s.tab]++;
  return n;
}

/** Non-default filters of a column on `chain` (the badge count). */
export function countActive(f: ColumnFilters, chain: string): number {
  const n = tabCounts(f, chain);
  return (f.spam ? 1 : 0) + (f.search.trim() ? 1 : 0) + (f.exclude.trim() ? 1 : 0) +
    n.protocols + n.audit + n.metrics + n.socials;
}

/** Whether `f` can hide anything at all, on any chain. */
export function isFiltering(f: ColumnFilters): boolean {
  if (f.spam || f.search.trim() || f.exclude.trim()) return true;
  if (Object.values(f.hiddenPlatforms).some((l) => l.length > 0)) return true;
  return RANGE_FILTERS.some((s) => isRangeSet(f[s.key])) || FLAG_FILTERS.some((s) => f[s.key]);
}

/**
 * A row with no trades and no volume. With `unknownPasses`, a row whose
 * activity the API has not reported yet is not counted as dead.
 */
export function isSpamToken(t: TokenEvent, unknownPasses = false): boolean {
  const active =
    (t.tradeCount ?? 0) > 0 ||
    (t.totalSolVolume ?? 0) > 0 ||
    (t.volume24h ?? 0) > 0;
  if (active) return false;
  const known = t.tradeCount != null || t.totalSolVolume != null || t.volume24h != null;
  return known || !unknownPasses;
}

function parseKeywords(raw: string): string[] {
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function matchesAnyKeyword(t: TokenEvent, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const hay = `${t.name || ""} ${t.symbol || ""}`.toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

export interface GateOptions {
  /**
   * A value the row does not carry yet passes. The boards pick their visible
   * rows this way: a row is enriched (volume, safety…) only once it is
   * visible, so a strict gate there would never let it in.
   */
  optimistic?: boolean;
  now?: number;
}

/**
 * True if the token passes every filter of the column, on the row's own
 * figures (the API's, kept current by board updates). A filter on a value the
 * row does not have fails it, unless `optimistic`.
 */
export function passesFilters(
  t: TokenEvent,
  f: ColumnFilters,
  opts: GateOptions = {},
): boolean {
  const optimistic = opts.optimistic === true;
  const hidden = f.hiddenPlatforms[t.chain ?? ""];
  if (hidden && hidden.length > 0 && hidden.includes(platformKey(t.dex))) return false;

  if (f.spam && isSpamToken(t, optimistic)) return false;

  const include = parseKeywords(f.search);
  if (include.length > 0 && !matchesAnyKeyword(t, include)) return false;
  const exclude = parseKeywords(f.exclude);
  if (exclude.length > 0 && matchesAnyKeyword(t, exclude)) return false;

  const now = opts.now ?? Date.now();
  for (const s of RANGE_FILTERS) {
    const r = f[s.key];
    if (!isRangeSet(r)) continue;
    const v = s.value(t, now);
    if (v == null) {
      if (optimistic) continue;
      return false;
    }
    if (r.min != null && v < r.min) return false;
    if (r.max != null && v > r.max) return false;
  }

  for (const s of FLAG_FILTERS) {
    if (!f[s.key]) continue;
    const ok = s.pass(t);
    if (ok === undefined) {
      if (optimistic) continue;
      return false;
    }
    if (!ok) return false;
  }
  return true;
}
