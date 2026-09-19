"use client";
import React from "react";

interface Props {
  points?: number[];
  width?: number;
  height?: number;
  color?: string;
}

/**
 * Minimal inline sparkline. Renders a flat centered line when no real data is
 * available so rows with no trades yet don't show fabricated movement.
 */
export function Sparkline({ points, width = 68, height = 22, color }: Props) {
  const pts = points ?? [];
  const hasData = pts.length >= 2;

  const min = hasData ? Math.min(...pts) : 0;
  const max = hasData ? Math.max(...pts) : 0;
  const rawRange = max - min;
  const isFlat = !hasData || rawRange <= 0 || !isFinite(rawRange);
  const range = isFlat ? 1 : rawRange;

  // When there's no data, draw a single horizontal stroke across the viewport.
  const d = isFlat
    ? `M0 ${(height / 2).toFixed(2)} L${width} ${(height / 2).toFixed(2)}`
    : pts
        .map((v, i) => {
          const x = (i / Math.max(1, pts.length - 1)) * width;
          const y = height - ((v - min) / range) * (height - 2) - 1;
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(2)}`;
        })
        .join(" ");

  const up = hasData && pts[pts.length - 1] >= pts[0];
  const c =
    color ??
    (isFlat ? "var(--paper-4)" : up ? "var(--buy)" : "var(--sell)");

  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <path
        d={d}
        fill="none"
        stroke={c}
        strokeWidth={isFlat ? 1 : 1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={isFlat ? 0.35 : 1}
      />
    </svg>
  );
}
