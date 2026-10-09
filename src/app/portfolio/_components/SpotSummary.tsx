"use client";
/**
 * Portfolio header — two-column band.
 * Left: title, hero value, inline stats. Right: realized-PnL chart.
 */

import React, { useState } from "react";
import { fmtSol, fmtUsd } from "../../../lib/format";
import { useIsMobile, useIsPhone } from "../../../hooks/useMediaQuery";
import { QuoteAssetIcon } from "../../../components/atoms";
import { PnlAreaChart } from "./PnlAreaChart";
import { PnlCalendarModal } from "./PnlCalendarModal";
import { usePnlSeries, type PnlTimeframe } from "./usePnlSeries";

export interface QuoteBalances {
  sol: number;
  usdc: number;
  usd1: number;
}

function fmtHeroUsd(v: number): string {
  if (!(v > 0)) return "—";
  return fmtUsd(v);
}

function fmtStable(v: number): string {
  if (!(v > 0)) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function MetricCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span className="eyebrow" style={{ fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.11em" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function QuoteAmount({ label, amount, kind }: {
  label: "SOL" | "USDC" | "USD1";
  amount: number;
  kind: "sol" | "stable";
}) {
  if (!(amount > 0)) return null;
  const text = kind === "sol" ? fmtSol(amount, amount < 10 ? 1 : 1) : fmtStable(amount);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
      color: "var(--paper)", fontSize: 13, fontWeight: 500,
    }}>
      <QuoteAssetIcon label={label} size={13} />
      <span>{text}</span>
      {kind === "stable" && (
        <span style={{ color: "var(--paper-4)", fontWeight: 500, fontSize: 10 }}>{label}</span>
      )}
    </span>
  );
}

export function SpotSummary({
  addresses, solPrice,
  totalValueUsd, quoteBalances,
  modeControl,
}: {
  addresses: string[];
  solPrice: number;
  totalValueUsd: number;
  quoteBalances: QuoteBalances;
  modeControl?: React.ReactNode;
}) {
  const [timeframe, setTimeframe] = useState<PnlTimeframe>("24H");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();

  const chart = usePnlSeries(addresses, timeframe, solPrice);
  const pct = chart.realizedUsd === 0
    ? 0
    : (chart.realizedUsd / Math.max(Math.abs(totalValueUsd - chart.realizedUsd), 1)) * 100;

  const hasQuotes = quoteBalances.sol > 0 || quoteBalances.usdc > 0 || quoteBalances.usd1 > 0;

  return (
    <>
      <div style={{
        display: isMobile ? "flex" : "grid",
        flexDirection: isMobile ? "column" : undefined,
        gridTemplateColumns: isMobile ? undefined : "minmax(0, 1fr) minmax(300px, 1.12fr)",
        gap: isMobile ? 20 : 32,
        alignItems: "stretch",
        minWidth: 0,
      }}>
        {/* Left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "flex-start", justifyContent: "space-between",
            gap: 16,
          }}>
            <div style={{ minWidth: 0 }}>
              <span className="eyebrow" style={{ fontSize: 10 }}>Portfolio</span>
              <h1 className="ser" style={{
                fontStyle: "italic",
                fontSize: isPhone ? 24 : 30,
                lineHeight: 1.08,
                margin: "4px 0 0",
                color: "var(--paper)",
                letterSpacing: "-0.02em",
                fontWeight: 400,
              }}>
                Everything you hold,{" "}
                <span style={{ color: "var(--accent)" }}>in one place</span>.
              </h1>
            </div>
            {modeControl && <div style={{ flexShrink: 0, paddingTop: 2 }}>{modeControl}</div>}
          </div>

          <div style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: isPhone ? "12px 20px" : "8px 32px",
            minWidth: 0,
          }}>
            <div className="mono" style={{
              fontSize: isPhone ? 32 : 40,
              fontWeight: 500,
              lineHeight: 1,
              color: totalValueUsd > 0 ? "var(--paper)" : "var(--paper-3)",
              letterSpacing: "-0.04em",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}>
              {fmtHeroUsd(totalValueUsd)}
            </div>

            <MetricCell label="Available">
              {hasQuotes ? (
                <div style={{
                  display: "flex", flexWrap: "wrap", alignItems: "center",
                  gap: "6px 12px", minHeight: 16,
                }}>
                  <QuoteAmount label="SOL" amount={quoteBalances.sol} kind="sol" />
                  <QuoteAmount label="USDC" amount={quoteBalances.usdc} kind="stable" />
                  <QuoteAmount label="USD1" amount={quoteBalances.usd1} kind="stable" />
                </div>
              ) : (
                <span className="mono" style={{
                  fontSize: 15, fontWeight: 500, lineHeight: 1,
                  color: "var(--paper-3)", fontVariantNumeric: "tabular-nums",
                }}>
                  —
                </span>
              )}
            </MetricCell>
          </div>
        </div>

        {/* Right — chart fills column height */}
        <div style={{
          minWidth: 0, width: "100%", height: "100%",
          minHeight: isMobile ? 100 : undefined,
          display: "flex", flexDirection: "column",
        }}>
          <PnlAreaChart
            series={chart.series}
            realizedUsd={chart.realizedUsd}
            pct={pct}
            timeframe={timeframe}
            onTimeframe={setTimeframe}
            onOpenCalendar={() => setCalendarOpen(true)}
            loading={chart.loading}
          />
        </div>
      </div>

      <PnlCalendarModal
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        addresses={addresses}
        solPrice={solPrice}
      />
    </>
  );
}
