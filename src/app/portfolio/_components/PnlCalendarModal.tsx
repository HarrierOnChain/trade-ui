"use client";
/**
 * PnL calendar — monthly realized-PnL heatmap (useMonthlyPnl).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "../../../components/atoms";
import { ModalShell } from "./atoms";
import { MiniToggle, UiGlyph } from "./ui";
import { fmtUsd, fmtSol } from "../../../lib/format";
import { useMonthlyPnl } from "./usePnlSeries";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Currency = "USD" | "SOL";

function fmtVal(currency: Currency, usd: number, sol: number): string {
  if (currency === "USD") {
    if (usd === 0) return "—";
    return `${usd > 0 ? "+" : "−"}${fmtUsd(Math.abs(usd))}`;
  }
  if (sol === 0) return "—";
  return `${sol > 0 ? "+" : "−"}${fmtSol(Math.abs(sol), 3)}`;
}

export function PnlCalendarModal({
  open, onClose, addresses, solPrice, native = "SOL", refreshKey = 0,
}: {
  open: boolean;
  onClose: () => void;
  addresses: string[];
  solPrice: number;
  /** The chain's native coin, for the second currency's label. */
  native?: string;
  refreshKey?: number;
}) {
  const [monthDate, setMonthDate] = useState(() => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
  });
  // Reset to the current month every time the modal opens so stale navigation
  // from a previous session doesn't persist between open/close cycles.
  useEffect(() => {
    if (open) {
      const n = new Date();
      setMonthDate(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)));
    }
  }, [open]);
  const [currency, setCurrency] = useState<Currency>("USD");

  const { byDay, totalUsd, totalSol, loading } = useMonthlyPnl(
    open ? addresses : [], monthDate, solPrice, refreshKey,
  );

  const year = monthDate.getUTCFullYear();
  const month = monthDate.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const now = new Date();
  const todayUtc = {
    y: now.getUTCFullYear(),
    m: now.getUTCMonth(),
    d: now.getUTCDate(),
  };

  const maxAbs = useMemo(() => Math.max(
    1e-9,
    ...[...byDay.values()].map((d) => Math.abs(currency === "USD" ? d.usd : d.sol)),
  ), [byDay, currency]);

  const { winDays, loseDays } = useMemo(() => {
    let win = 0;
    let lose = 0;
    for (const d of byDay.values()) {
      const v = currency === "USD" ? d.usd : d.sol;
      if (v > 0) win += 1;
      else if (v < 0) lose += 1;
    }
    return { winDays: win, loseDays: lose };
  }, [byDay, currency]);

  const nowUtc = new Date();
  const isCurrentOrFuture =
    year > nowUtc.getUTCFullYear() ||
    (year === nowUtc.getUTCFullYear() && month >= nowUtc.getUTCMonth());
  const stepMonth = (delta: number) => {
    if (delta > 0 && isCurrentOrFuture) return;
    setMonthDate(new Date(Date.UTC(year, month + delta, 1)));
  };

  const cells: Array<{ day: number } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });

  const totalShown = currency === "USD" ? totalUsd : totalSol;
  const totalTone = totalShown > 0 ? "var(--buy)" : totalShown < 0 ? "var(--sell)" : "var(--paper)";

  return (
    <Modal open={open} onClose={onClose} width={520}>
      <ModalShell title="PnL calendar" onClose={onClose}>
        {/* Month nav + currency */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CalNavBtn dir="prev" onClick={() => stepMonth(-1)} />
            <span className="ser" style={{
              fontStyle: "italic", fontSize: 16, fontWeight: 400,
              color: "var(--paper)", minWidth: 118, textAlign: "center",
            }}>
              {MONTHS[month].slice(0, 3)} {year}
            </span>
            <CalNavBtn dir="next" onClick={() => stepMonth(1)} disabled={isCurrentOrFuture} />
          </div>
          <MiniToggle<Currency>
            value={currency}
            onChange={setCurrency}
            options={[{ value: "USD", label: "USD" }, { value: "SOL", label: native }]}
          />
        </div>

        {/* Month summary */}
        <div style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          gap: 16, padding: "12px 0 4px",
          borderBottom: "1px solid var(--line-soft)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="eyebrow" style={{ fontSize: 8, color: "var(--paper-4)" }}>
              Month total · realized
            </span>
            <span className="mono" style={{
              fontSize: 22, fontWeight: 600, lineHeight: 1,
              color: loading ? "var(--paper-4)" : totalTone,
              fontVariantNumeric: "tabular-nums",
            }}>
              {loading ? "…" : fmtVal(currency, totalUsd, totalSol)}
            </span>
          </div>
          <div style={{ display: "flex", gap: 14, flexShrink: 0 }}>
            <DayCount label="Green days" value={winDays} tone="var(--buy)" />
            <DayCount label="Red days" value={loseDays} tone="var(--sell)" />
          </div>
        </div>

        {/* Weekday labels */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4,
          paddingTop: 10,
        }}>
          {WEEKDAYS.map((w) => (
            <span key={w} style={{
              textAlign: "center", fontSize: 9, fontWeight: 600,
              color: "var(--paper-4)", fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              {w}
            </span>
          ))}
        </div>

        {/* Heatmap grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4,
          opacity: loading ? 0.55 : 1, transition: "opacity 140ms",
        }}>
          {cells.map((cell, i) => {
            if (!cell) return <span key={`b${i}`} aria-hidden />;
            const data = byDay.get(cell.day);
            const val = data ? (currency === "USD" ? data.usd : data.sol) : 0;
            const has = data != null && val !== 0;
            const ratio = has ? Math.min(1, Math.abs(val) / maxAbs) : 0;
            const tone = val > 0 ? "var(--buy)" : "var(--sell)";
            const isToday = todayUtc.y === year && todayUtc.m === month && todayUtc.d === cell.day;
            const mix = has ? Math.round(10 + ratio * 42) : 0;

            return (
              <div
                key={cell.day}
                title={has ? fmtVal(currency, data!.usd, data!.sol) : "No realized PnL"}
                style={{
                  aspectRatio: "1",
                  minHeight: 44,
                  borderRadius: 8,
                  padding: "5px 4px",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 3,
                  background: has
                    ? `color-mix(in oklch, ${tone} ${mix}%, var(--ink-0))`
                    : "var(--ink-0)",
                  outline: isToday ? "1.5px solid color-mix(in oklch, var(--accent) 55%, transparent)" : "none",
                  outlineOffset: -1,
                  cursor: has ? "default" : "default",
                }}
              >
                <span className="mono" style={{
                  fontSize: 9,
                  color: isToday ? "var(--accent)" : "var(--paper-4)",
                  fontWeight: isToday ? 700 : 500,
                  fontVariantNumeric: "tabular-nums", lineHeight: 1,
                }}>
                  {cell.day}
                </span>
                {has && (
                  <span className="mono" style={{
                    fontSize: 8.5, fontWeight: 600, color: tone, lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                    maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap", textAlign: "center",
                  }}>
                    {currency === "USD"
                      ? `${val > 0 ? "+" : "−"}${compactUsd(Math.abs(val))}`
                      : `${val > 0 ? "+" : "−"}${fmtSol(Math.abs(val), 2)}`}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, paddingTop: 8,
        }}>
          <span style={{ fontSize: 10, color: "var(--paper-4)" }}>
            Realized PnL per UTC day
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <LegendSwatch color="var(--sell)" opacity={0.15} />
            <LegendSwatch color="var(--sell)" opacity={0.35} />
            <LegendSwatch color="var(--buy)" opacity={0.35} />
            <LegendSwatch color="var(--buy)" opacity={0.55} />
            <span style={{ fontSize: 9, color: "var(--paper-4)", marginLeft: 4 }}>intensity</span>
          </div>
        </div>

        {addresses.length === 0 && (
          <p style={{ fontSize: 11, color: "var(--paper-4)", textAlign: "center", margin: "8px 0 0" }}>
            Add an on-chain wallet to see realized PnL by day.
          </p>
        )}
      </ModalShell>
    </Modal>
  );
}

function compactUsd(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (v >= 100) return `${Math.round(v)}`;
  if (v >= 1) return v.toFixed(0);
  return v.toFixed(2);
}

function DayCount({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <span style={{ fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span className="mono" style={{
        fontSize: 13, fontWeight: 600, color: tone, fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </div>
  );
}

function LegendSwatch({ color, opacity }: { color: string; opacity: number }) {
  return (
    <span style={{
      width: 14, height: 14, borderRadius: 4,
      background: `color-mix(in oklch, ${color} ${Math.round(opacity * 100)}%, var(--ink-0))`,
      border: "1px solid var(--line-soft)",
    }} />
  );
}

function CalNavBtn({ dir, onClick, disabled }: { dir: "prev" | "next"; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous month" : "Next month"}
      style={{
        width: 30, height: 30, borderRadius: 8,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "var(--ink-0)", border: "1px solid var(--line-soft)",
        color: disabled ? "var(--paper-5)" : "var(--paper-3)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transform: dir === "prev" ? "rotate(90deg)" : "rotate(-90deg)",
        transition: "background 120ms, color 120ms, border-color 120ms, opacity 120ms",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "var(--accent-w)";
        e.currentTarget.style.borderColor = "color-mix(in oklch, var(--accent) 40%, transparent)";
        e.currentTarget.style.color = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "var(--ink-0)";
        e.currentTarget.style.borderColor = "var(--line-soft)";
        e.currentTarget.style.color = "var(--paper-3)";
      }}
    >
      {UiGlyph.chevron}
    </button>
  );
}
