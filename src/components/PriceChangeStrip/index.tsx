"use client";
import React from "react";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { fluidColsFit } from "../../lib/responsive";
import { Tooltip } from "../atoms";

// The API's change windows (it has no 4h / 12h).
const PERIODS: Array<{ key: "5m" | "1h" | "6h" | "24h"; label: string }> = [
  { key: "5m",  label: "5m"  },
  { key: "1h",  label: "1h"  },
  { key: "6h",  label: "6h"  },
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
  // The token's price and windows, kept live by the token channel (a tick's
  // price, the snapshot's windows).
  const { info } = useTokenInfo(mint);
  const isMobile          = useIsMobile();
  const isPhone           = useIsPhone();
  const priceUsd = info?.priceUsd ?? 0;

  return (
    <div style={{
      display: "grid",
      // Desktop keeps the fixed 5-up strip. Phones drop to 2 columns; tablets
      // fluid-fit ~90px tracks (≈3 up) so cells never get crushed below ~60px.
      gridTemplateColumns: isPhone
        ? "repeat(2, 1fr)"
        : isMobile
          ? fluidColsFit(90)
          : `repeat(${PERIODS.length}, 1fr)`,
      background: "var(--ink-1)",
      borderBottom: "1px solid var(--line-soft)",
      overflow: "hidden",
      flexShrink: 0,
    }}>
      {PERIODS.map(({ key, label }, idx) => {
        const w = info?.windows?.[key];
        const open = w?.openPriceUsd ?? 0;
        // The live price against the window's opening price (the API's), so
        // the cell moves with the ticks; the API's change without one.
        const pct =
          open > 0 && priceUsd > 0
            ? (priceUsd / open - 1) * 100
            : w?.priceChangePercent ?? null;
        const up = pct != null && pct >= 0;
        const color =
          pct == null ? "var(--paper-4)" : up ? "var(--buy)" : "var(--sell)";
        return (
          <Tooltip
            key={key}
            content={pct != null && Math.abs(pct) >= 1000 ? `${pct.toFixed(1)}%` : null}
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
                style={{ fontSize: 12, fontWeight: 500, color }}
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
