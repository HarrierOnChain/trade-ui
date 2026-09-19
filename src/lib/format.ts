import type { TokenEvent } from "../types";

// ⚠️ HARDENING (P0-bis 2026-07-22): mai fidarsi che `v` sia davvero un number.
// Gli upstream possono serializzare numerici come stringhe JSON; il vecchio
// guard usava il GLOBAL `isFinite`, che coercisce le stringhe
// (`isFinite("0.01") === true`) e poi `v.toFixed()` crashava l'INTERO tree
// React. Coerciamo una volta qui e usiamo `Number.isFinite` — un formatter
// non deve MAI poter buttare giù la pagina per un dato sporco.
function asNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function fmtMcap(raw?: number | null): string {
  const v = asNum(raw);
  if (v == null) return "–";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function fmtNum(raw?: number | null): string {
  const v = asNum(raw);
  if (v == null) return "–";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export function fmtPrice(raw?: number | null): string {
  const v = asNum(raw);
  if (v == null) return "–";
  if (v < 1e-6) return `$${v.toExponential(2)}`;
  if (v < 0.01) return `$${v.toFixed(6)}`;
  if (v < 1) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtPct(raw?: number | null): string {
  const v = asNum(raw);
  if (v == null) return "–";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
}

export function fmtSol(raw?: number | null, d = 2): string {
  const v = asNum(raw);
  if (v == null) return "–";
  if (v >= 1e9) return `${(v / 1e9).toFixed(d > 1 ? 2 : d)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(d > 1 ? 2 : d)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(d > 1 ? 1 : d)}K`;
  return v.toFixed(d);
}

export function fmtUsd(raw?: number | null): string {
  const v = asNum(raw);
  if (v == null) return "–";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

export function tokenVolumeUsd(
  token: Pick<TokenEvent, "totalSolVolume" | "volume24h">,
  solPrice?: number | null,
  liveVolumeSol = 0,
): number | undefined {
  const restVolumeUsd =
    token.totalSolVolume != null && token.totalSolVolume > 0
      ? solPrice && solPrice > 0
        ? token.totalSolVolume * solPrice
        : undefined
      : token.volume24h != null && token.volume24h > 0
      ? token.volume24h
      : undefined;

  const liveVolumeUsd =
    solPrice && solPrice > 0 && liveVolumeSol > 0
      ? liveVolumeSol * solPrice
      : 0;

  if (restVolumeUsd != null) return restVolumeUsd + liveVolumeUsd;
  return liveVolumeUsd > 0 ? liveVolumeUsd : undefined;
}

export function shortAddr(a?: string | null, n = 4): string {
  if (!a) return "";
  if (a.length <= n * 2 + 1) return a;
  return `${a.slice(0, n)}…${a.slice(-n)}`;
}

/**
 * Display label for a DEX/platform — strips `DBC` / `Launchpad` suffixes,
 * leaves anything else intact. Used in token rows and headers so users see
 * `Meteora` / `Raydium` instead of `MeteoraDBC` / `RaydiumLaunchpad`.
 */
export function dexLabel(dex?: string | null): string {
  const raw = String(dex || "");
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("meteora")) return "Meteora";
  if (lower.includes("raydium")) return "Raydium";
  const aliases: Record<string, string> = {
    letsbonk: "LetsBonk",
    bonkers: "Bonkers",
    bags: "Bags",
    believe: "Believe",
    jupiterstudio: "Jupiter Studio",
    moonshot: "Moonshot",
    trendsfun: "Trends.fun",
    orynth: "Orynth",
    printr: "Printr",
    bankr: "Bankr",
    heaven: "Heaven",
    zorasolana: "Zora",
    tokenmillv2: "TokenMill",
    americafun: "America.fun",
    dubdub: "DubDub",
    cookingcity: "Cooking City",
    sendshot: "Sendshot",
    timefun: "Time.fun",
    xymint: "Xymint",
  };
  return aliases[lower] ?? raw;
}

// Launchpads that CPI the Pump.fun program: on-chain their curves/pools decode
// as PumpFun (pre-migration) or PumpSwap (post-migration), so an enrich / quote
// / live-trade `platform` of pumpfun/pumpswap is the *trade venue*, NOT the
// launchpad identity — it must never overwrite the launchpad label. The parser
// already relabels these (dex_parser.rs: "Mayhem CPIs PumpFun"). Extend this
// list as more pump-family launchpads appear.
const PUMP_FAMILY_LAUNCHPADS = ["mayhem"];

function isPumpFamilyLaunchpad(dex: string): boolean {
  const d = dex.toLowerCase();
  return PUMP_FAMILY_LAUNCHPADS.some((l) => d.includes(l));
}

/** True for the generic Pump.fun trade venue — the pumpfun bonding curve or the
 *  pumpswap AMM it migrates to (both contain "pump"). */
function isGenericPumpVenue(dex: string): boolean {
  return dex.toLowerCase().includes("pump");
}

/**
 * Pick the dex/platform label when a secondary source (`incoming`: batch
 * enrich, router quote, live trade) reports a platform for a token that already
 * has `current` (from the deploy stream / history). A pump-family launchpad
 * (Mayhem) keeps its identity against a generic PumpFun/PumpSwap venue so it is
 * never relabeled just because its curve/pool routes there; otherwise a
 * non-empty `incoming` wins (real migrations, first resolve, backfills).
 */
export function mergeDexLabel(
  current: string | null | undefined,
  incoming: string | null | undefined,
): string {
  const cur = String(current ?? "").trim();
  const inc = String(incoming ?? "").trim();
  if (!inc) return cur;
  if (!cur) return inc;
  if (isPumpFamilyLaunchpad(cur) && isGenericPumpVenue(inc)) return cur;
  return inc;
}

export function dexColor(dex?: string | null): string {
  const d = String(dex || "").toLowerCase();
  if (d.includes("pump"))    return "var(--dex-pump)";
  if (d.includes("mayhem"))  return "var(--dex-mayhem)";
  if (d.includes("meteora")) return "var(--dex-meteora)";
  if (d.includes("raydium")) return "var(--dex-raydium)";
  if (d.includes("orca"))    return "var(--dex-orca)";
  if (d.includes("jupiter")) return "var(--paper-2)";
  if (d.includes("bonk"))    return "oklch(0.72 0.15 48)";
  return "var(--accent)";
}
