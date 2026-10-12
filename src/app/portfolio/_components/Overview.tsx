"use client";
/**
 * The portfolio's head: what the view covers (every wallet, or the focused
 * one), its value, the cash it can trade with, and the realized-PnL chart.
 */
import React, { useState } from "react";
import { QuoteAssetIcon } from "../../../components/atoms";
import { WalletAvatar } from "../../../components/WalletAvatar";
import { PnlAreaChart } from "./PnlAreaChart";
import { PnlCalendarModal } from "./PnlCalendarModal";
import { usePnlSeries, type PnlTimeframe } from "./usePnlSeries";
import { fmtNative, fmtValue } from "./money";

export interface CashLine {
  /** SOL / ETH / BNB / USDC / USD1 */
  label: string;
  amount: number;
  stable: boolean;
}

export type ViewScope =
  | { kind: "all" }
  | { kind: "wallet"; label: string; avatarIndex: number };

function fmtStable(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function Overview({
  scope, onShowAll, addresses, native, nativePrice, totalValueUsd, cash, loading, wide, phone,
}: {
  scope: ViewScope;
  onShowAll: () => void;
  /** The wallets the PnL covers. */
  addresses: string[];
  /** SOL / ETH / BNB */
  native: string;
  nativePrice: number;
  totalValueUsd: number;
  cash: CashLine[];
  loading: boolean;
  wide: boolean;
  phone: boolean;
}) {
  const [timeframe, setTimeframe] = useState<PnlTimeframe>("24H");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const chart = usePnlSeries(addresses, timeframe, nativePrice);
  const pct = chart.realizedUsd === 0
    ? 0
    : (chart.realizedUsd / Math.max(Math.abs(totalValueUsd - chart.realizedUsd), 1)) * 100;
  const shownCash = cash.filter((c) => c.amount > 0);

  return (
    <section style={{
      display: "grid",
      gridTemplateColumns: wide ? "minmax(0, 1fr) minmax(320px, 1.1fr)" : "minmax(0, 1fr)",
      gap: wide ? 40 : 20, alignItems: "start", minWidth: 0, flexShrink: 0,
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <ScopeTitle scope={scope} onShowAll={onShowAll} />

        <div className="mono" style={{
          fontSize: phone ? 34 : 44, fontWeight: 500, lineHeight: 1,
          color: totalValueUsd > 0 ? "var(--paper)" : "var(--paper-3)",
          letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums",
        }}>
          {loading
            ? <span className="skeleton" style={{ display: "inline-block", width: 180, height: 38, borderRadius: 6 }} />
            : fmtValue(totalValueUsd)}
        </div>

        <div className="mono" style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 16px", minHeight: 18,
          fontSize: 12, color: "var(--paper-2)", fontVariantNumeric: "tabular-nums",
        }}>
          {shownCash.map((c) => (
            <span key={c.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <QuoteAssetIcon label={c.label} size={12} />
              {c.stable ? fmtStable(c.amount) : fmtNative(c.amount)}
              <span style={{ color: "var(--paper-4)" }}>{c.label}</span>
            </span>
          ))}
          {shownCash.length === 0 && !loading && (
            <span style={{ color: "var(--paper-4)" }}>No {native} to trade with</span>
          )}
        </div>
      </div>

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", height: wide ? 128 : 112 }}>
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

      <PnlCalendarModal
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        addresses={addresses}
        solPrice={nativePrice}
        native={native}
      />
    </section>
  );
}

function ScopeTitle({ scope, onShowAll }: { scope: ViewScope; onShowAll: () => void }) {
  const title: React.CSSProperties = {
    fontSize: 14, fontWeight: 500, margin: 0, color: "var(--paper-2)",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
  };
  if (scope.kind === "all") return <h1 style={title}>All wallets</h1>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <WalletAvatar label={scope.label} index={scope.avatarIndex} size={20} />
      <h1 style={{ ...title, color: "var(--paper)" }}>{scope.label}</h1>
      <button type="button" onClick={onShowAll} style={{
        flexShrink: 0, padding: "2px 6px", borderRadius: 6, cursor: "pointer",
        background: "transparent", border: 0, color: "var(--paper-4)", fontSize: 12,
      }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-4)"; }}
      >
        × All wallets
      </button>
    </div>
  );
}
