import { fmtUsd } from "../../../lib/format";

/** A USD value; zero reads "$0.00" rather than fmtUsd's "$0.0000". */
export function fmtValue(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "$0.00";
  return fmtUsd(v);
}

/** A native-coin amount (SOL / ETH / BNB): four decimals under 10. */
export function fmtNative(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  if (v >= 10) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v < 0.0001) return "<0.0001";
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
