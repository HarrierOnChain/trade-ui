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
 * Consumed by WalletsTab, tabs.tsx, SpotSummary, PnlAreaChart, PnlCalendarModal.
 */

import React from "react";

/* ── PanelCard — bordered card + muted header strip ──────────────────── */

export function PanelCard({
  title, right, header, pad = false, children, style, bodyStyle,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  /** Full custom header node — overrides title/right. */
  header?: React.ReactNode;
  /** Body padding: false = flush (tables), true = 14px, or a number. */
  pad?: boolean | number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}) {
  const bodyPad = pad === true ? 14 : pad === false ? 0 : pad;
  const showHeader = header != null || title != null || right != null;
  return (
    <div style={{
      background: "var(--ink-1)",
      border: "1px solid var(--line-soft)",
      borderRadius: 12,
      overflow: "hidden",
      boxShadow: "var(--shadow-sm)",
      display: "flex", flexDirection: "column", minWidth: 0,
      ...style,
    }}>
      {showHeader && (header != null ? (
        <div style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--ink-2)",
        }}>{header}</div>
      ) : (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, padding: "10px 14px",
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--ink-2)",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)" }}>{title}</span>
          {right && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{right}</div>}
        </div>
      ))}
      <div style={{ padding: bodyPad, minWidth: 0, ...bodyStyle }}>{children}</div>
    </div>
  );
}

/* ── PremiumButton — Caesar's glassy action button, in Raze green ────── */

export function PremiumButton({
  children, icon, onClick, disabled, variant = "glass", size = "md", full, title, style, type = "button",
}: {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "glass" | "solid";
  size?: "sm" | "md";
  full?: boolean;
  title?: string;
  style?: React.CSSProperties;
  type?: "button" | "submit";
}) {
  const h = size === "sm" ? 30 : 36;
  const fs = size === "sm" ? 11 : 12;
  const solid = variant === "solid";

  const restingShadow = solid
    ? "inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 10px -3px color-mix(in oklch, var(--accent) 55%, transparent)"
    : "inset 0 1px 0 color-mix(in oklch, var(--accent) 16%, transparent), 0 2px 8px -3px color-mix(in oklch, var(--accent) 30%, transparent)";
  const hoverShadow = solid
    ? "inset 0 1px 0 rgba(255,255,255,0.32), 0 4px 16px -3px color-mix(in oklch, var(--accent) 66%, transparent)"
    : "inset 0 1px 0 color-mix(in oklch, var(--accent) 24%, transparent), 0 4px 14px -3px color-mix(in oklch, var(--accent) 44%, transparent)";

  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    height: h, padding: "0 14px", borderRadius: 8,
    width: full ? "100%" : undefined,
    fontSize: fs, fontWeight: 600, fontFamily: "var(--font-ui)",
    letterSpacing: "-0.005em", whiteSpace: "nowrap",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    color: solid ? "var(--ink-0)" : "var(--paper)",
    border: `1px solid color-mix(in oklch, var(--accent) ${solid ? 90 : 46}%, transparent)`,
    background: solid
      ? "linear-gradient(180deg, color-mix(in oklch, var(--accent) 96%, white), var(--accent))"
      : "radial-gradient(120% 130% at 50% -12%, var(--accent-w), color-mix(in oklch, var(--accent) 7%, transparent) 55%, transparent), var(--ink-2)",
    boxShadow: restingShadow,
    transition: "transform 90ms ease-out, box-shadow 140ms, filter 140ms, background 140ms",
    ...style,
  };

  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      style={base}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "scale(1.02)";
        e.currentTarget.style.filter = "brightness(1.08)";
        e.currentTarget.style.boxShadow = hoverShadow;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.filter = "none";
        e.currentTarget.style.boxShadow = restingShadow;
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.97)"; }}
      onMouseUp={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(1.02)"; }}
    >
      {icon && <span style={{ display: "inline-flex" }}>{icon}</span>}
      {children}
    </button>
  );
}

/* ── SubTabs — Caesar's full-underline sub-tab row ───────────────────── */

export function SubTabs<T extends string>({
  tabs, value, onChange,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24, borderBottom: "1px solid var(--line-soft)" }}>
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            style={{
              position: "relative", padding: "0 0 11px", marginBottom: -1,
              background: "transparent", border: "none",
              borderBottom: `2px solid ${on ? "var(--accent)" : "transparent"}`,
              color: on ? "var(--accent)" : "var(--paper-3)",
              fontSize: 13, fontWeight: on ? 600 : 500, fontFamily: "var(--font-ui)",
              cursor: "pointer", transition: "color 140ms, border-color 140ms",
              display: "inline-flex", alignItems: "center", gap: 7,
            }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = "var(--paper)"; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = "var(--paper-3)"; }}
          >
            {t.label}
            {t.count != null && (
              <span style={{
                fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
                color: on ? "var(--accent)" : "var(--paper-4)",
                background: on ? "var(--accent-w)" : "var(--ink-2)",
                padding: "1px 6px", borderRadius: 999,
              }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

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

/* ── ShowToggle — Caesar's eye / switch "show hidden" control ─────────── */

export function ShowToggle({
  on, onToggle, label, icon,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 9px", borderRadius: 7,
        background: on ? "var(--accent-w)" : "transparent",
        border: `1px solid ${on ? "color-mix(in oklch, var(--accent) 36%, transparent)" : "var(--line-soft)"}`,
        color: on ? "var(--accent)" : "var(--paper-3)",
        fontSize: 11, fontWeight: 500, fontFamily: "var(--font-ui)", cursor: "pointer",
        transition: "background 120ms, border-color 120ms, color 120ms", whiteSpace: "nowrap",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/* ── Data table chrome — Caesar muted-header tables ──────────────────── */

export const dataCell: React.CSSProperties = {
  padding: "11px 14px",
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
  headers, children, minWidth,
}: {
  headers: Array<{ key: string; label: React.ReactNode; align?: "left" | "right" }>;
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="scroll-x" style={{ overflowX: "auto" }}>
      {/* `table-cards` is inert above 480px; at ≤480px it flips this table to
          stacked label/value cards (using each <td>'s data-label) and neutralises
          its min-width so it never forces horizontal scroll on a phone. */}
      <table className="table-cards" style={{
        width: "100%", minWidth, borderCollapse: "separate", borderSpacing: 0,
        fontFamily: "var(--font-ui)",
      }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h.key} style={{
                position: "sticky", top: 0, zIndex: 1,
                background: "var(--ink-2)",
                textAlign: h.align ?? "left",
                padding: "11px 14px",
                fontSize: 12, fontWeight: 600, color: "var(--paper-2)",
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

export function HoverRow({
  onClick, highlight, children,
}: {
  onClick?: () => void;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const base = highlight ? "color-mix(in oklch, var(--accent) 7%, transparent)" : "transparent";
  return (
    <tr
      onClick={onClick}
      style={{ background: base, transition: "background 100ms", cursor: onClick ? "pointer" : "default" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = base; }}
    >{children}</tr>
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
      <td data-label="" colSpan={colSpan} style={{ textAlign: "center", padding: "44px 16px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%", background: "var(--ink-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid var(--line)" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--paper-3)" }}>{title}</span>
          {body && <span style={{ fontSize: 11, color: "var(--paper-4)" }}>{body}</span>}
        </div>
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
