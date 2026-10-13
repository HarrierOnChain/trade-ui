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
  // A launch measured from its first trade can move by millions of percent:
  // compact like the money columns (+1.7B%, not +1715116846.1%).
  const a = Math.abs(v);
  if (a >= 1e12) return `${s}${(v / 1e12).toFixed(1)}T%`;
  if (a >= 1e9) return `${s}${(v / 1e9).toFixed(1)}B%`;
  if (a >= 1e6) return `${s}${(v / 1e6).toFixed(1)}M%`;
  if (a >= 1e4) return `${s}${(v / 1e3).toFixed(1)}K%`;
  if (a >= 1e3) return `${s}${v.toFixed(0)}%`;
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
  // Negatives (a losing PnL) fell through every branch to "$-41906.2556".
  if (v < 0) return `-${fmtUsd(-v)}`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

/** A token's 24h volume in USD: the API's (`volume24h`), else its native
 *  volume at the coin's price; undefined when neither is known. */
export function tokenVolumeUsd(
  token: Pick<TokenEvent, "totalSolVolume" | "volume24h">,
  solPrice?: number | null,
): number | undefined {
  if (token.volume24h != null && token.volume24h > 0) return token.volume24h;
  if (token.totalSolVolume != null && token.totalSolVolume > 0 && solPrice && solPrice > 0) {
    return token.totalSolVolume * solPrice;
  }
  return undefined;
}

export function shortAddr(a?: string | null, n = 4): string {
  if (!a) return "";
  if (a.length <= n * 2 + 1) return a;
  return `${a.slice(0, n)}…${a.slice(-n)}`;
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
