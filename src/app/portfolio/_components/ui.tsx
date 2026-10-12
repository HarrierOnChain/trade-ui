"use client";
/**
 * Caesar-skin UI primitives — themed with Raze's green/cream tokens.
 *
 * Recreates the visual language of the Caesar trading app's portfolio
 * (bordered cards with muted header strips, glassy "premium" action buttons,
 * full-underline sub-tabs, pill search, muted-header data tables) using Raze's
 * inline-CSS + OKLCH design tokens — NOT Tailwind, and the green `--accent`
 * rather than Caesar's blue. Shape/structure matches Caesar; palette stays Raze.
 *
 * Consumed by tabs.tsx, PnlAreaChart, PnlCalendarModal.
 */

import React from "react";

/* ── PillSearch — rounded search with leading glyph ──────────────────── */

export function PillSearch({
  value, onChange, placeholder = "Search by name or address", width = 240, flex,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number | string;
  flex?: boolean;
}) {
  return (
    <div style={{ position: "relative", width: flex ? undefined : width, flex: flex ? "1 1 180px" : undefined, minWidth: 150, maxWidth: flex ? 320 : undefined }}>
      <span style={{
        position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
        color: "var(--paper-4)", pointerEvents: "none", display: "inline-flex",
      }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 L14 14" />
        </svg>
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "7px 12px 7px 30px",
          background: "var(--ink-0)", border: "1px solid var(--line-soft)",
          borderRadius: 999, color: "var(--paper)",
          fontSize: 12, fontFamily: "var(--font-ui)", outline: "none",
          transition: "border-color 120ms, box-shadow 120ms",
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-w)"; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "var(--line-soft)"; e.currentTarget.style.boxShadow = "none"; }}
      />
    </div>
  );
}

/* ── MiniToggle — compact 2-3 segment switch (USD/SOL, All/Buy/Sell) ─── */

export function MiniToggle<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: React.ReactNode }>;
}) {
  return (
    <div style={{
      display: "inline-flex", padding: 2, gap: 2,
      background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 999,
    }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              padding: "4px 11px", borderRadius: 999, border: "none",
              background: on ? "var(--accent)" : "transparent",
              color: on ? "var(--ink-0)" : "var(--paper-3)",
              fontSize: 11, fontWeight: 600, fontFamily: "var(--font-ui)",
              cursor: "pointer", transition: "background 120ms, color 120ms",
              display: "inline-flex", alignItems: "center", gap: 4, lineHeight: 1.4,
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

/* ── Data table chrome — Caesar muted-header tables ──────────────────── */

export const dataCell: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 12,
  color: "var(--paper)",
  borderBottom: "1px solid var(--line-soft)",
  whiteSpace: "nowrap",
};

export const dataCellRight: React.CSSProperties = {
  ...dataCell,
  textAlign: "right",
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
};

export function DataTable({
  headers, children, minWidth, cards = true,
}: {
  headers: Array<{ key: string; label: React.ReactNode; align?: "left" | "right" }>;
  children: React.ReactNode;
  minWidth?: number;
  /** Stacked label/value cards on a phone; off for tables already narrow there. */
  cards?: boolean;
}) {
  return (
    <div className="scroll-x" style={{ overflowX: "auto" }}>
      {/* `table-cards` is inert above 480px; at ≤480px it flips this table to
          stacked label/value cards (using each <td>'s data-label) and neutralises
          its min-width so it never forces horizontal scroll on a phone. */}
      <table className={cards ? "table-cards" : undefined} style={{
        width: "100%", minWidth, borderCollapse: "separate", borderSpacing: 0,
        fontFamily: "var(--font-ui)",
      }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h.key} style={{
                position: "sticky", top: 0, zIndex: 1,
                background: "var(--ink-0)",
                textAlign: h.align ?? "left",
                padding: "8px 12px",
                fontSize: 11, fontWeight: 500, color: "var(--paper-4)",
                borderBottom: "1px solid var(--line-soft)",
                whiteSpace: "nowrap",
              }}>{h.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({
  colSpan, title, body,
}: {
  colSpan: number;
  title: string;
  body?: string;
}) {
  return (
    <tr>
      <td data-label="" colSpan={colSpan} style={{ padding: "28px 12px", fontSize: 12.5, color: "var(--paper-4)" }}>
        {title}{body ? ` ${body}` : ""}
      </td>
    </tr>
  );
}

/* ── Small glyphs used by the Caesar surfaces ────────────────────────── */

export const UiGlyph = {
  receive: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 3 L4 10" /><path d="M4 5 V10 H9" />
    </svg>
  ),
  withdraw: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13 L12 6" /><path d="M12 11 V6 H7" />
    </svg>
  ),
  distribute: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="4" r="1.8" /><circle cx="3.5" cy="12" r="1.8" /><circle cx="12.5" cy="12" r="1.8" />
      <path d="M8 5.8 V8 M8 8 L4.4 10.6 M8 8 L11.6 10.6" />
    </svg>
  ),
  consolidate: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="3.5" cy="4" r="1.8" /><circle cx="12.5" cy="4" r="1.8" /><circle cx="8" cy="12" r="1.8" />
      <path d="M3.5 5.8 L7.4 9.8 M12.5 5.8 L8.6 9.8" />
    </svg>
  ),
  calendar: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5 H13.5" /><path d="M5.5 2 V4.5" /><path d="M10.5 2 V4.5" />
    </svg>
  ),
  check: (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6 L5 9 L10 3" />
    </svg>
  ),
  chevron: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6 L8 10 L12 6" />
    </svg>
  ),
};
