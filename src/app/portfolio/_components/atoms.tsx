"use client";
/**
 * Portfolio design primitives.
 *
 * Cream-on-ink palette, violet accent, italic serif for display,
 * Geist UI, JetBrains Mono for numbers. Generous spacing, switch
 * toggles, segmented controls, big number steppers.
 */

import React from "react";
import { useIsPhone } from "../../../hooks/useMediaQuery";
import { ModalHeader, ModalFooter } from "../../../components/atoms";

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
