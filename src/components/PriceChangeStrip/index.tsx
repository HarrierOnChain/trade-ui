"use client";
import React, { useMemo } from "react";
import { usePriceChanges } from "../../hooks/usePriceChanges";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { fluidColsFit } from "../../lib/responsive";
import { Tooltip } from "../atoms";

const PERIODS: Array<{ key: "5m" | "1h" | "4h" | "12h" | "24h"; label: string }> = [
  { key: "5m",  label: "5m"  },
  { key: "1h",  label: "1h"  },
  { key: "4h",  label: "4h"  },
  { key: "12h", label: "12h" },
  { key: "24h", label: "24h" },
];

interface Props { mint: string }

function fmtCompactPct(v: number): string {
  const sign = v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1000) {
    const k = abs / 1000;
    const rounded = k >= 10 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, "");
    return `${v < 0 ? "-" : sign}${rounded}k%`;
  }
  return `${sign}${v.toFixed(1)}%`;
}

export function PriceChangeStrip({ mint }: Props) {
  const { data: changes } = usePriceChanges(mint);
  const { info }          = useTokenInfo(mint);
  const isMobile          = useIsMobile();
  const isPhone           = useIsPhone();
  const mintList = useMemo(() => (mint ? [mint] : []), [mint]);
  const liveMap = useLiveTradePrices(mintList);
  const live = liveMap.get(mint);

  // Live-ticking "current" SOL price: WS first, then whatever the REST
  // price-changes call captured. The grid re-renders whenever either fires.
  const currentSol = live?.price ?? changes?.currentPrice ?? 0;

  // Fallback reference = dev buy. We compare the current SOL price against
  // creator_buy_price; supply and solPrice cancel out in the ratio so the %
  // change equals what you'd get from current-mcap / initial-mcap.
  const refSol = info?.creatorBuyPrice ?? 0;
  const fallbackPct =
    refSol > 0 && currentSol > 0 ? ((currentSol - refSol) / refSol) * 100 : null;

  return (
    <div style={{
      display: "grid",
      // Desktop keeps the fixed 5-up strip. Phones drop to 2 columns; tablets
      // fluid-fit ~90px tracks (≈3 up) so cells never get crushed below ~60px.
      gridTemplateColumns: isPhone
        ? "repeat(2, 1fr)"
        : isMobile
          ? fluidColsFit(90)
          : "repeat(5, 1fr)",
      background: "var(--ink-1)",
      borderBottom: "1px solid var(--line-soft)",
      overflow: "hidden",
      flexShrink: 0,
    }}>
      {PERIODS.map(({ key, label }, idx) => {
        const period = changes?.changes?.[key];
        const anchor = period?.price ?? 0;
        const trades = period?.trades ?? 0;
        // Real per-period change when the backend found a valid anchor with
        // activity; otherwise fall back to dev-buy → current so every cell
        // shows a meaningful, live-updating number instead of a row of "–".
        const livePct =
          anchor > 0 && trades > 0 && currentSol > 0
            ? ((currentSol - anchor) / anchor) * 100
            : null;
        const pct = livePct ?? fallbackPct;
        const isFallback = livePct == null && fallbackPct != null;
        const up = pct != null && pct >= 0;
        const color =
          pct == null ? "var(--paper-4)" : up ? "var(--buy)" : "var(--sell)";
        return (
          <Tooltip
            key={key}
            content={
              pct != null && Math.abs(pct) >= 1000
                ? `${pct.toFixed(1)}%`
                : isFallback
                  ? "vs dev-buy market cap (no per-period anchor available)"
                  : null
            }
          >
            <div
              style={{
                padding: "8px 6px",
                // First-cell-of-row check only holds for a single non-wrapping
                // row; on mobile the grid wraps so use a uniform left border.
                borderLeft: isMobile
                  ? "1px solid var(--line-soft)"
                  : idx === 0 ? "none" : "1px solid var(--line-soft)",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              }}
            >
              <span className="eyebrow" style={{ fontSize: 9 }}>{label}</span>
              <span
                className="mono"
                style={{
                  fontSize: 12, fontWeight: 500, color,
                  opacity: isFallback ? 0.65 : 1,
                }}
              >
                {pct == null ? "–" : fmtCompactPct(pct)}
              </span>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}
