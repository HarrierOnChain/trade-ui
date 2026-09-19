"use client";
/**
 * Realized-PnL area chart for the portfolio header.
 */

import React, { useId } from "react";
import { fmtUsd } from "../../../lib/format";
import { PNL_TIMEFRAMES, type PnlSeriesPoint, type PnlTimeframe } from "./usePnlSeries";
import { UiGlyph } from "./ui";

const VB_W = 1000;
const VB_H = 88;

function tfLabel(tf: PnlTimeframe): string {
  if (tf === "ALL") return "All";
  return tf;
}

function buildPaths(series: PnlSeriesPoint[]): {
  line: string;
  area: string;
  zeroY: number | null;
} {
  const padT = 8;
  const padB = 10;
  if (series.length < 2) return { line: "", area: "", zeroY: null };

  const ys = series.map((p) => p.v);
  let min = Math.min(...ys, 0);
  let max = Math.max(...ys, 0);
  if (max - min <= 0) max = min + 1;
  const range = max - min;

  const mapX = (i: number) => (i / (series.length - 1)) * VB_W;
  const mapY = (v: number) => padT + (1 - (v - min) / range) * (VB_H - padT - padB);

  let line = "";
  series.forEach((p, i) => {
    line += `${i === 0 ? "M" : "L"}${mapX(i).toFixed(2)} ${mapY(p.v).toFixed(2)} `;
  });
  const area = `${line}L${VB_W} ${VB_H} L0 ${VB_H} Z`;
  const zeroY = min < 0 && max > 0 ? mapY(0) : null;

  return { line: line.trim(), area, zeroY };
}

export function PnlAreaChart({
  series, realizedUsd, timeframe, onTimeframe, onOpenCalendar, loading,
}: {
  series: PnlSeriesPoint[];
  realizedUsd: number;
  pct: number;
  timeframe: PnlTimeframe;
  onTimeframe: (tf: PnlTimeframe) => void;
  onOpenCalendar: () => void;
  loading?: boolean;
}) {
  const gradId = useId().replace(/:/g, "");
  const up = realizedUsd >= 0;
  const stroke = up ? "var(--buy)" : "var(--sell)";
  const { line, area, zeroY } = buildPaths(series);
  const hasData = series.length >= 2;

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 6,
      minWidth: 0, height: "100%", flex: 1,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
          <span className="eyebrow" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.1em" }}>
            Realized · {tfLabel(timeframe)}
          </span>
          <span className="mono" style={{
            fontSize: 16, fontWeight: 600, lineHeight: 1,
            color: realizedUsd === 0 ? "var(--paper-3)" : stroke,
            fontVariantNumeric: "tabular-nums",
          }}>
            {realizedUsd === 0 ? "—" : `${up ? "+" : "−"}${fmtUsd(Math.abs(realizedUsd))}`}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div
            role="tablist"
            aria-label="PnL timeframe"
            style={{
              display: "inline-flex", gap: 3, padding: 3,
              background: "var(--ink-2)", border: "1px solid var(--line-soft)", borderRadius: 999,
            }}
          >
            {PNL_TIMEFRAMES.map((tf) => {
              const on = tf === timeframe;
              return (
                <button
                  key={tf}
                  role="tab"
                  aria-selected={on}
                  onClick={() => onTimeframe(tf)}
                  style={{
                    padding: "4px 10px", borderRadius: 999, border: "none",
                    background: on ? "var(--accent)" : "transparent",
                    color: on ? "var(--ink-0)" : "var(--paper-3)",
                    fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)",
                    letterSpacing: "0.04em", cursor: "pointer",
                    transition: "background 120ms, color 120ms",
                  }}
                >{tfLabel(tf)}</button>
              );
            })}
          </div>
          <button
            onClick={onOpenCalendar}
            title="PnL calendar"
            aria-label="PnL calendar"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: "var(--ink-2)", border: "1px solid var(--line-soft)",
              color: "var(--paper-3)", cursor: "pointer",
              transition: "background 120ms, color 120ms, border-color 120ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--accent-w)";
              e.currentTarget.style.borderColor = "color-mix(in oklch, var(--accent) 40%, transparent)";
              e.currentTarget.style.color = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--ink-2)";
              e.currentTarget.style.borderColor = "var(--line-soft)";
              e.currentTarget.style.color = "var(--paper-3)";
            }}
          >
            {UiGlyph.calendar}
          </button>
        </div>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 32 }}>
        {hasData ? (
          <svg
            width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none" style={{ display: "block" }}
          >
            <defs>
              <linearGradient id={`pnlfill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                <stop offset="85%" stopColor={stroke} stopOpacity={0.04} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            {zeroY != null && (
              <line
                x1="0" y1={zeroY} x2={VB_W} y2={zeroY}
                stroke="var(--line-soft)" strokeWidth={1}
                vectorEffect="non-scaling-stroke" opacity={0.6}
              />
            )}
            <path d={area} fill={`url(#pnlfill-${gradId})`} stroke="none" />
            <path
              d={line} fill="none" stroke={stroke} strokeWidth={1.75}
              strokeLinejoin="round" strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <div style={{
            height: "100%", minHeight: 32, display: "flex", alignItems: "center",
            fontSize: 11, color: "var(--paper-4)",
          }}>
            {loading ? "Loading PnL…" : "No realized PnL in this window."}
          </div>
        )}
      </div>
    </div>
  );
}
