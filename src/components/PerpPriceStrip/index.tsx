"use client";
import React, { useEffect, useState } from "react";
import { fetchPerpCandles, type PerpCandle } from "../../api/client";
import { useIsPhone } from "../../hooks/useMediaQuery";

const PERIODS: Array<{ key: "5m" | "1h" | "4h" | "12h" | "24h"; label: string; ms: number }> = [
  { key: "5m",  label: "5m",  ms:    5 * 60 * 1000 },
  { key: "1h",  label: "1h",  ms:   60 * 60 * 1000 },
  { key: "4h",  label: "4h",  ms:   4 * 60 * 60 * 1000 },
  { key: "12h", label: "12h", ms:  12 * 60 * 60 * 1000 },
  { key: "24h", label: "24h", ms:  24 * 60 * 60 * 1000 },
];

interface Props {
  marketId: string | null;
  /** WS-driven last close in USD (already e6 → USD). When set, used as the
   *  numerator for every period so cells re-tick live. */
  livePrice?: number | null;
}

function fmtCompactPct(v: number): string {
  const sign = v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1000) {
    const k = abs / 1000;
    const rounded = k >= 10 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, "");
    return `${v < 0 ? "-" : sign}${rounded}k%`;
  }
  return `${sign}${v.toFixed(2)}%`;
}

export function PerpPriceStrip({ marketId, livePrice }: Props) {
  const isPhone = useIsPhone();
  // ≤480px each of 5 cells is only ~72px wide and unreadable, so drop the
  // 12h/24h periods and render the first 3 (5m/1h/4h) across 3 columns.
  const periods = isPhone ? PERIODS.slice(0, 3) : PERIODS;
  // Pull the highest-resolution series we can to anchor each period.
  // Use 1m candles (last 24h needs 1440 buckets — perp_ohlcv_1m allows 2k).
  const [candles, setCandles] = useState<PerpCandle[]>([]);
  useEffect(() => {
    if (!marketId) { setCandles([]); return; }
    let cancelled = false;
    fetchPerpCandles(marketId, "1m", 1500)
      .then((r) => { if (!cancelled) setCandles(r.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [marketId]);

  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const lastCandle = sorted[sorted.length - 1];
  // perp_ohlcv_* stores plain Float64 USD, so candle.close is already USD.
  const lastClose = livePrice ?? (lastCandle ? lastCandle.close : 0);
  const now = Date.now();

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isPhone ? "repeat(3, 1fr)" : "repeat(5, 1fr)",
      background: "var(--ink-1)",
      borderBottom: "1px solid var(--line-soft)",
      overflow: "hidden",
      flexShrink: 0,
    }}>
      {periods.map(({ key, label, ms }, idx) => {
        const cutoff = now - ms;
        // Anchor = first candle whose timestamp >= cutoff. Same semantic as
        // PriceChangeStrip: "what was the price about <period> ago".
        const anchor = sorted.find((c) => c.timestamp >= cutoff);
        const anchorPrice = anchor ? anchor.open : 0;
        const pct = anchorPrice > 0 && lastClose > 0
          ? ((lastClose - anchorPrice) / anchorPrice) * 100
          : null;
        const up = pct != null && pct >= 0;
        const color =
          pct == null ? "var(--paper-4)" : up ? "var(--buy)" : "var(--sell)";
        return (
          <div
            key={key}
            style={{
              padding: "8px 6px",
              borderLeft: idx === 0 ? "none" : "1px solid var(--line-soft)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            }}
          >
            <span className="eyebrow" style={{ fontSize: 9 }}>{label}</span>
            <span className="mono" style={{ fontSize: 12, fontWeight: 500, color }}>
              {pct == null ? "–" : fmtCompactPct(pct)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
