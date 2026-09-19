"use client";
/**
 * Portfolio design primitives — same visual language as the automation
 * surface (see app/automation/_components/atoms.tsx).
 *
 * Cream-on-ink palette, violet accent, italic serif for display,
 * Geist UI, JetBrains Mono for numbers. Generous spacing, switch
 * toggles, segmented controls, big number steppers.
 */

import React, { useEffect, useRef, useState } from "react";
import { clampLeft, viewportMaxWidth } from "../../../lib/popover";
import { useIsPhone } from "../../../hooks/useMediaQuery";
import { ModalHeader, ModalFooter } from "../../../components/atoms";

/* ── Section card ────────────────────────────────────────────────────── */

export function SectionCard({
  eyebrow, title, hint, right, dense, children,
}: {
  eyebrow?: string;
  title?: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  dense?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section style={{
      background: "var(--ink-1)",
      border: "1px solid var(--line-soft)",
      borderRadius: 12,
      padding: dense ? "14px 16px" : "18px 20px",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      {(eyebrow || title || right) && (
        <header style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            {eyebrow && (
              <span className="eyebrow" style={{ fontSize: 9, color: "var(--paper-3)" }}>
                {eyebrow}
              </span>
            )}
            {title && (
              <h3 className="ser" style={{
                fontStyle: "italic", fontSize: 22, lineHeight: 1.1,
                color: "var(--paper)", letterSpacing: "-0.01em", fontWeight: 400,
                margin: 0,
              }}>{title}</h3>
            )}
            {hint && (
              <p style={{
                fontSize: 11, color: "var(--paper-3)", lineHeight: 1.5,
                maxWidth: 640, margin: 0,
              }}>{hint}</p>
            )}
          </div>
          {right && <div style={{ display: "flex", gap: 6, alignItems: "center" }}>{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* ── Field + grid ────────────────────────────────────────────────────── */

export function Field({
  label, hint, error, children, span = 1,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  span?: 1 | 2 | "full";
  children: React.ReactNode;
}) {
  const gridColumn = span === "full" ? "1 / -1" : span === 2 ? "span 2" : "span 1";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, gridColumn }}>
      <label style={{
        fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
        color: error ? "var(--sell)" : "var(--paper-3)", fontWeight: 500,
        fontFamily: "var(--font-mono)",
      }}>{label}</label>
      {children}
      {hint && !error && (
        <span style={{ fontSize: 11, color: "var(--paper-4)", lineHeight: 1.45 }}>{hint}</span>
      )}
      {error && <span style={{ fontSize: 11, color: "var(--sell)" }}>{error}</span>}
    </div>
  );
}

export function FieldGrid({ cols = 2, children }: { cols?: 1 | 2 | 3; children: React.ReactNode }) {
  return (
    <div style={{
      display: "grid", gap: 14,
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    }}>{children}</div>
  );
}

/* ── Inputs ──────────────────────────────────────────────────────────── */

const baseInputStyle: React.CSSProperties = {
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  color: "var(--paper)",
  padding: "9px 12px",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "var(--font-ui)",
  width: "100%",
  outline: "none",
  transition: "border-color 120ms, background 120ms, box-shadow 120ms",
};

export function TextInput({
  value, onChange, placeholder, mono, autoFocus, multiline, rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
  rows?: number;
}) {
  const styleProps: React.CSSProperties = {
    ...baseInputStyle,
    fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
    fontSize: mono ? 12 : 13,
    resize: multiline ? "vertical" : undefined,
    minHeight: multiline ? rows * 18 + 18 : undefined,
  };
  const focus = (e: React.FocusEvent<HTMLElement>) => {
    e.currentTarget.style.borderColor = "var(--accent)";
    e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-w)";
  };
  const blur = (e: React.FocusEvent<HTMLElement>) => {
    e.currentTarget.style.borderColor = "var(--line-soft)";
    e.currentTarget.style.boxShadow = "none";
  };
  if (multiline) {
    return (
      <textarea
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        style={styleProps}
        onFocus={focus}
        onBlur={blur}
      />
    );
  }
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={styleProps}
      onFocus={focus}
      onBlur={blur}
    />
  );
}

export function NumberInput({
  value, onChange, min, max, step, suffix, prefix, placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: React.ReactNode;
  prefix?: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "stretch",
      background: "var(--ink-0)",
      border: "1px solid var(--line-soft)",
      borderRadius: 8,
      transition: "border-color 120ms, box-shadow 120ms",
    }}>
      {prefix && (
        <span style={{
          display: "inline-flex", alignItems: "center", padding: "0 10px",
          color: "var(--paper-4)", fontSize: 11, fontFamily: "var(--font-mono)",
          borderRight: "1px solid var(--line-soft)",
        }}>{prefix}</span>
      )}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min} max={max} step={step ?? 1}
        placeholder={placeholder}
        style={{
          background: "transparent", border: "none", outline: "none",
          color: "var(--paper)", fontFamily: "var(--font-mono)",
          fontSize: 13, padding: "9px 12px", flex: 1, minWidth: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      />
      {suffix && (
        <span style={{
          display: "inline-flex", alignItems: "center", padding: "0 12px",
          color: "var(--paper-3)", fontSize: 11, fontFamily: "var(--font-mono)",
          letterSpacing: "0.02em", borderLeft: "1px solid var(--line-soft)",
          background: "color-mix(in oklch, var(--ink-1) 50%, transparent)",
          borderRadius: "0 7px 7px 0",
        }}>{suffix}</span>
      )}
    </div>
  );
}

/* ── Segmented ───────────────────────────────────────────────────────── */

export function Segmented<T extends string>({
  value, onChange, options, size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; hint?: string; count?: number }>;
  size?: "sm" | "md";
}) {
  const padY = size === "sm" ? 5 : 7;
  const padX = size === "sm" ? 10 : 14;
  return (
    <div role="tablist" style={{
      display: "inline-flex", padding: 3, gap: 2,
      background: "var(--ink-0)", border: "1px solid var(--line-soft)",
      borderRadius: 10,
    }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={(e) => { e.preventDefault(); onChange(o.value); }}
            style={{
              padding: `${padY}px ${padX}px`,
              fontSize: size === "sm" ? 11 : 12, fontWeight: 500,
              fontFamily: "var(--font-ui)",
              borderRadius: 7,
              background: on ? "var(--accent)" : "transparent",
              color: on ? "var(--ink-0)" : "var(--paper-2)",
              border: "none", cursor: "pointer",
              transition: "background 120ms, color 120ms",
              letterSpacing: "-0.005em",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
            title={o.hint}
          >
            {o.label}
            {o.count !== undefined && (
              <span style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 999,
                background: on
                  ? "color-mix(in oklch, var(--ink-0) 18%, transparent)"
                  : "var(--ink-2)",
                color: on ? "var(--ink-0)" : "var(--paper-4)",
                fontFamily: "var(--font-mono)", fontWeight: 600,
                lineHeight: 1.4,
              }}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Status / kind chips ─────────────────────────────────────────────── */

export type WalletKindHint = "PLATFORM" | "PHANTOM" | "DEMO" | "PRIVY";

const KIND_META: Record<WalletKindHint, { label: string; color: string; tint: string; glyph: string }> = {
  PLATFORM: { label: "Platform", color: "var(--accent)", tint: "var(--accent-w)", glyph: "◎" },
  PHANTOM:  { label: "Phantom",  color: "var(--info)",   tint: "oklch(0.75 0.10 230 / 0.14)", glyph: "P" },
  DEMO:     { label: "Demo",     color: "var(--gold)",   tint: "var(--gold-w)", glyph: "△" },
  PRIVY:    { label: "Privy",    color: "oklch(0.62 0.20 295)", tint: "oklch(0.62 0.20 295 / 0.14)", glyph: "✦" },
};

export function WalletKindChip({ kind, size = "sm" }: { kind: WalletKindHint; size?: "xs" | "sm" }) {
  const m = KIND_META[kind];
  const fs = size === "xs" ? 9 : 10;
  const py = size === "xs" ? 2 : 3;
  const px = size === "xs" ? 7 : 9;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: `${py}px ${px}px`, borderRadius: 999,
      background: m.tint, color: m.color,
      fontSize: fs, fontWeight: 600, letterSpacing: "0.04em",
      border: `1px solid color-mix(in oklch, ${m.color} 50%, transparent)`,
      lineHeight: 1.3,
      fontFamily: "var(--font-mono)", textTransform: "uppercase",
    }}>
      <span aria-hidden style={{ fontSize: fs + 1, lineHeight: 1 }}>{m.glyph}</span>
      {m.label}
    </span>
  );
}

export function ActiveDot({ on }: { on: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 9px", borderRadius: 999,
      background: on ? "color-mix(in oklch, var(--buy) 10%, transparent)" : "var(--ink-2)",
      border: `1px solid ${on ? "color-mix(in oklch, var(--buy) 38%, transparent)" : "var(--line-soft)"}`,
      color: on ? "var(--buy)" : "var(--paper-4)",
      fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase",
      fontFamily: "var(--font-mono)", fontWeight: 600,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 999,
        background: on ? "var(--buy)" : "var(--paper-4)",
        boxShadow: on ? "0 0 8px var(--buy)" : undefined,
        animation: on ? "pulseDot 2s ease-in-out infinite" : undefined,
      }} />
      {on ? "Selected" : "Idle"}
    </span>
  );
}

/* ── KPI tile ────────────────────────────────────────────────────────── */

export function KpiTile({
  label, value, sub, tone, glyph, loading,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "accent" | "buy" | "sell" | "gold" | "neutral";
  glyph?: React.ReactNode;
  loading?: boolean;
}) {
  const color =
    tone === "accent" ? "var(--accent)" :
    tone === "buy"    ? "var(--buy)" :
    tone === "sell"   ? "var(--sell)" :
    tone === "gold"   ? "var(--gold)" :
    "var(--paper)";
  return (
    <div style={{
      flex: 1, minWidth: 0,
      padding: "14px 16px",
      background: "var(--ink-1)",
      border: "1px solid var(--line-soft)",
      borderRadius: 12,
      display: "flex", flexDirection: "column", gap: 6,
      position: "relative", overflow: "hidden",
    }}>
      {glyph && (
        <span aria-hidden style={{
          position: "absolute", top: -8, right: -6,
          fontSize: 72, color, opacity: 0.06,
          fontFamily: "var(--font-dis)", fontStyle: "italic",
          lineHeight: 1, pointerEvents: "none",
        }}>{glyph}</span>
      )}
      <span className="eyebrow" style={{ fontSize: 9 }}>{label}</span>
      {loading ? (
        <span className="skeleton" style={{ height: 24, width: "60%", borderRadius: 4 }} />
      ) : (
        <span className="mono" style={{
          fontSize: 22, fontWeight: 500, color,
          letterSpacing: "-0.01em", lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}>{value}</span>
      )}
      {sub != null && (
        <span style={{
          fontSize: 11, color: "var(--paper-4)",
          fontFamily: "var(--font-mono)",
        }}>{sub}</span>
      )}
    </div>
  );
}

/* ── Tile (clickable card) ───────────────────────────────────────────── */

export function Tile({
  children, accent, onClick, padding = "14px 16px", elevated,
}: {
  children: React.ReactNode;
  accent?: string;
  onClick?: () => void;
  padding?: string | number;
  elevated?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        background: elevated ? "var(--ink-2)" : "var(--ink-1)",
        border: "1px solid var(--line-soft)",
        borderRadius: 12,
        padding,
        display: "flex", flexDirection: "column", gap: 10,
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 140ms, background 140ms",
      }}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.borderColor = "var(--line)"; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.borderColor = "var(--line-soft)"; } : undefined}
    >
      {accent && (
        <span style={{
          position: "absolute", inset: 0, right: "auto",
          width: 3, background: accent,
          borderRadius: "12px 0 0 12px",
          pointerEvents: "none",
        }} />
      )}
      {children}
    </div>
  );
}

/* ── Tab nav (the bar at the top of tab bodies) ──────────────────────── */

export function TabBar<T extends string>({
  tabs, value, onChange,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <nav style={{ display: "flex", borderBottom: "1px solid var(--line-soft)" }}>
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            style={{
              padding: "10px 16px 12px",
              position: "relative",
              background: "transparent",
              color: on ? "var(--paper)" : "var(--paper-3)",
              border: "none",
              cursor: "pointer",
              fontSize: 13, fontWeight: on ? 600 : 500,
              fontFamily: "var(--font-ui)",
              letterSpacing: "-0.005em",
              display: "inline-flex", alignItems: "center", gap: 7,
              transition: "color 120ms",
            }}
          >
            {t.label}
            {t.count !== undefined && (
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "1px 7px", borderRadius: 999,
                background: on ? "var(--accent-w)" : "var(--ink-2)",
                color: on ? "var(--accent)" : "var(--paper-4)",
                fontSize: 10, fontFamily: "var(--font-mono)",
                fontWeight: 600,
              }}>{t.count}</span>
            )}
            {on && (
              <span style={{
                position: "absolute", bottom: -1, left: 0, right: 0,
                height: 2, background: "var(--accent)",
                borderRadius: "2px 2px 0 0",
              }} />
            )}
          </button>
        );
      })}
    </nav>
  );
}

/* ── Inline editable label (click to edit) ──────────────────────────── */

export function InlineEditableLabel({
  value, onCommit, placeholder, maxLen = 32, fontSize = 14,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  maxLen?: number;
  fontSize?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else setDraft(value);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={maxLen}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") { setEditing(false); setDraft(value); }
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--ink-0)", border: "1px solid var(--accent)",
          borderRadius: 6, color: "var(--paper)",
          fontFamily: "var(--font-ui)", fontSize, fontWeight: 600,
          padding: "2px 8px", outline: "none",
          minWidth: 100,
          boxShadow: "0 0 0 3px var(--accent-w)",
          letterSpacing: "-0.005em",
        }}
      />
    );
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Click to rename"
      style={{
        background: "transparent", border: "1px solid transparent",
        color: "var(--paper)", padding: "2px 8px", borderRadius: 6,
        fontFamily: "var(--font-ui)", fontSize, fontWeight: 600,
        cursor: "text", textAlign: "left",
        letterSpacing: "-0.005em",
        transition: "background 100ms, border-color 100ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--ink-2)";
        e.currentTarget.style.borderColor = "var(--line-soft)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >{value || placeholder}</button>
  );
}

/* ── Tiny icon buttons (square) ──────────────────────────────────────── */

export function IconButton({
  onClick, title, children, tone = "neutral", disabled,
}: {
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  children: React.ReactNode;
  tone?: "neutral" | "danger" | "accent" | "gold";
  disabled?: boolean;
}) {
  const color =
    tone === "danger" ? "var(--sell)" :
    tone === "accent" ? "var(--accent)" :
    tone === "gold"   ? "var(--gold)" :
    "var(--paper-2)";
  const hoverBg =
    tone === "danger" ? "var(--sell-w)" :
    tone === "accent" ? "var(--accent-w)" :
    tone === "gold"   ? "var(--gold-w)" :
    "var(--ink-2)";
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 28, height: 28,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "transparent",
        border: "1px solid var(--line-soft)",
        borderRadius: 7,
        color, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "background 120ms, border-color 120ms, color 120ms",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = hoverBg;
        e.currentTarget.style.borderColor = color;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "var(--line-soft)";
      }}
    >{children}</button>
  );
}

/* ── Mini-glyph SVG icons used in WalletsTab actions ─────────────────── */

export const PortfolioGlyph = {
  drag: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="4" cy="3" r="1" fill="currentColor" />
      <circle cx="8" cy="3" r="1" fill="currentColor" />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="8" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="9" r="1" fill="currentColor" />
      <circle cx="8" cy="9" r="1" fill="currentColor" />
    </svg>
  ),
  star: (filled = false) => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M8 1.6 L10.06 5.85 L14.7 6.52 L11.35 9.78 L12.14 14.4 L8 12.22 L3.86 14.4 L4.65 9.78 L1.3 6.52 L5.94 5.85 Z" />
    </svg>
  ),
  send: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2 L7 9" />
      <path d="M14 2 L9.5 14 L7 9 L2 6.5 Z" />
    </svg>
  ),
  receive: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2 V12" />
      <path d="M3.5 7.5 L8 12 L12.5 7.5" />
      <path d="M3 14 H13" />
    </svg>
  ),
  burn: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14 C4.5 14 3 11.5 3 9.5 C3 7 5 6 5.5 4 C6 5.5 7.5 6.5 9 6 C9 7.5 8 8 8 9.5 C8 10.5 8.5 11 9 11 C10 11 10.5 10 10.5 9 C11.5 10 13 11 13 9.5 C13 12 11.5 14 8 14 Z" />
    </svg>
  ),
  copy: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M2 11 V3.5 A1.5 1.5 0 0 1 3.5 2 H11" />
    </svg>
  ),
  ext: (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2 H14 V7" />
      <path d="M14 2 L8 8" />
      <path d="M13 9.5 V13 A1 1 0 0 1 12 14 H3 A1 1 0 0 1 2 13 V4 A1 1 0 0 1 3 3 H6.5" />
    </svg>
  ),
  more: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  ),
  distribute: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12 V8 H13 V12" />
      <path d="M8 8 V4" />
      <path d="M3 12 L1.5 14 M5 14 H1.5 V12 M3 12 L4.5 14" />
      <path d="M8 12 L6.5 14 M10 14 H6.5 V12 M8 12 L9.5 14" />
      <path d="M13 12 L11.5 14 M15 14 H11.5 V12 M13 12 L14.5 14" />
    </svg>
  ),
  consolidate: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2 V6 L8 9 L13 6 V2" />
      <path d="M8 9 V14" />
      <path d="M6 12 L8 14 L10 12" />
    </svg>
  ),
  claimFees: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5 V11.5" />
      <path d="M10 6.5 C10 5.5 9 5 8 5 C7 5 6 5.5 6 6.5 C6 8 10 8 10 9.5 C10 10.5 9 11 8 11 C7 11 6 10.5 6 9.5" />
    </svg>
  ),
  key: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="11" r="2.6" />
      <path d="M7 9.2 L13.5 2.7" />
      <path d="M11.5 4.7 L13 6.2" />
      <path d="M9.5 6.7 L11 8.2" />
    </svg>
  ),
  fund: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2 V14" />
      <path d="M11 5 L8 2 L5 5" />
      <path d="M2 14 H14" />
    </svg>
  ),
  trash: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M3 4 H13" />
      <path d="M5.5 4 V2.5 H10.5 V4" />
      <path d="M4 4 L4.7 13.2 A1 1 0 0 0 5.7 14 H10.3 A1 1 0 0 0 11.3 13.2 L12 4" />
    </svg>
  ),
  refresh: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 8 A5.5 5.5 0 0 1 12.5 4.5" />
      <path d="M13.5 2 V5 H10.5" />
      <path d="M13.5 8 A5.5 5.5 0 0 1 3.5 11.5" />
      <path d="M2.5 14 V11 H5.5" />
    </svg>
  ),
  eyeOff: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2 L14 14" />
      <path d="M6.5 5 A3 3 0 0 1 11 8 M5.5 6.5 A3 3 0 0 0 10 10.5" />
      <path d="M3.5 4 C2 5.5 1.2 7.2 1 8 C1.5 10 4 13 8 13 C9.2 13 10.3 12.7 11.3 12.2 M14.5 9.5 C14.8 9 15 8.5 15 8 C14.5 6 12 3 8 3 C7.5 3 7 3.05 6.5 3.15" />
    </svg>
  ),
};

/* ── Skeleton row (loading state) ───────────────────────────────────── */

export function SkeletonTiles({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          height: 92, borderRadius: 12,
          background: "var(--ink-1)", border: "1px solid var(--line-soft)",
          position: "relative", overflow: "hidden",
        }}>
          <span className="skeleton" style={{
            position: "absolute", inset: 12, borderRadius: 6,
          }} />
        </div>
      ))}
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────── */

export function EmptyHero({
  title, body, cta, icon,
}: {
  title: React.ReactNode;
  body: React.ReactNode;
  cta?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const isPhone = useIsPhone();
  return (
    <div style={{
      padding: isPhone ? "24px 16px" : "36px 24px", borderRadius: 12,
      background: "var(--ink-1)",
      border: "1px dashed var(--line-soft)",
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 14, textAlign: "center",
    }}>
      {icon && (
        <div style={{
          width: isPhone ? 48 : 56, height: isPhone ? 48 : 56, borderRadius: "50%",
          background: "var(--accent-w)",
          border: "1px solid color-mix(in oklch, var(--accent) 30%, transparent)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 26, color: "var(--accent)",
          fontFamily: "var(--font-dis)", fontStyle: "italic",
        }}>{icon}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: isPhone ? "100%" : 480 }}>
        <h3 className="ser" style={{
          fontStyle: "italic", fontSize: 22, lineHeight: 1.1, margin: 0,
          color: "var(--paper)", letterSpacing: "-0.01em", fontWeight: 400,
        }}>{title}</h3>
        <p style={{ fontSize: 13, color: "var(--paper-3)", lineHeight: 1.5, margin: 0 }}>
          {body}
        </p>
      </div>
      {cta && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>{cta}</div>}
    </div>
  );
}

/* ── Dropdown menu (used by per-wallet "More" button) ────────────────── */

const POPOVER_MENU_WIDTH = 200;
const POPOVER_MENU_WIDTH_PHONE = 160;
const POPOVER_PHONE_MAX = 480;
const POPOVER_MENU_GAP = 6;
const POPOVER_VIEWPORT_PAD = 12;
const POPOVER_MAX_HEIGHT = 360;
const POPOVER_FLIP_THRESHOLD = 180;

function computePopoverMenuLayout(
  anchorRect: DOMRect,
  align: "start" | "end",
) {
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Narrower menu on phones so a right-edge anchor never overflows the viewport.
  const menuWidth = vw <= POPOVER_PHONE_MAX ? POPOVER_MENU_WIDTH_PHONE : POPOVER_MENU_WIDTH;

  const spaceBelow = vh - anchorRect.bottom - POPOVER_MENU_GAP - POPOVER_VIEWPORT_PAD;
  const spaceAbove = anchorRect.top - POPOVER_MENU_GAP - POPOVER_VIEWPORT_PAD;
  const openAbove = spaceBelow < POPOVER_FLIP_THRESHOLD && spaceAbove > spaceBelow;
  const maxHeight = Math.max(
    120,
    Math.min(POPOVER_MAX_HEIGHT, openAbove ? spaceAbove : spaceBelow),
  );

  const preferredLeft = align === "end"
    ? anchorRect.right - menuWidth
    : anchorRect.left;
  // Foundation popover helper — keeps the menu fully on-screen with edge gutters.
  const left = clampLeft(preferredLeft, menuWidth, vw);

  return {
    openAbove,
    maxHeight,
    left,
    menuWidth,
    top: openAbove ? undefined : anchorRect.bottom + POPOVER_MENU_GAP,
    bottom: openAbove ? vh - anchorRect.top + POPOVER_MENU_GAP : undefined,
  };
}

export function PopoverMenu({
  anchorRect, onClose, children, align = "end",
}: {
  anchorRect: DOMRect | null;
  onClose: () => void;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  const [layout, setLayout] = useState<ReturnType<typeof computePopoverMenuLayout> | null>(null);

  useEffect(() => {
    if (!anchorRect) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.("[data-pf-popover]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRect, onClose]);

  useEffect(() => {
    if (!anchorRect) {
      setLayout(null);
      return;
    }
    const update = () => setLayout(computePopoverMenuLayout(anchorRect, align));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRect, align]);

  if (!anchorRect || !layout) return null;

  return (
    <div
      data-pf-popover
      style={{
        position: "fixed",
        left: layout.left,
        ...(layout.openAbove ? { bottom: layout.bottom } : { top: layout.top }),
        zIndex: 60,
        width: layout.menuWidth,
        maxWidth: viewportMaxWidth(),
        maxHeight: layout.maxHeight,
        overflowY: "auto",
        overscrollBehavior: "contain",
        padding: 4,
        background: "var(--ink-1)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "var(--shadow-pop)",
        display: "flex", flexDirection: "column", gap: 1,
      }}
    >{children}</div>
  );
}

export function MenuItem({
  onClick, children, icon, tone = "neutral", disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "neutral" | "danger" | "accent";
  disabled?: boolean;
}) {
  const color =
    tone === "danger" ? "var(--sell)" :
    tone === "accent" ? "var(--accent)" :
    "var(--paper)";
  const hoverBg =
    tone === "danger" ? "var(--sell-w)" :
    tone === "accent" ? "var(--accent-w)" :
    "var(--ink-2)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 10px", borderRadius: 6,
        background: "transparent", border: "none",
        color, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        textAlign: "left", fontFamily: "var(--font-ui)", fontSize: 12,
        transition: "background 100ms",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = hoverBg; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {icon && <span style={{ width: 14, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>}
      <span style={{ flex: 1 }}>{children}</span>
    </button>
  );
}

/* ── Modal header / body / footer wrappers (replaces page.module.css) ── */

export function ModalShell({
  title, onClose, children, footer, width = 460,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  // Renders within an external <Modal /> — provides consistent header/body/footer
  // using the shared modal kit (same visual language as SettingsModal).
  void width;
  return (
    <>
      <ModalHeader title={title} onClose={onClose} />
      <div style={{
        flex: 1, minHeight: 0,
        padding: "16px 20px",
        display: "flex", flexDirection: "column", gap: 14,
        overflowY: "auto",
        background: "var(--ink-1)",
      }}>{children}</div>
      {footer && <ModalFooter>{footer}</ModalFooter>}
    </>
  );
}

/* ── ModalNote (paragraph used inside ModalShell body) ──────────────── */

export function ModalNote({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 12, color: "var(--paper-3)", lineHeight: 1.55, margin: 0,
    }}>{children}</p>
  );
}

/* ── Toast-friendly short-address ────────────────────────────────────── */

export function shortAddr(addr: string, head = 5, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
