"use client";
import React from "react";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";
import { useIsPhone } from "../../hooks/useMediaQuery";

/*
 * ── Shared modal kit ─────────────────────────────────────────────────────────
 *
 * One visual language for every modal, derived from SettingsModal:
 *   - Header bar: 14px 20px, 1px line-soft bottom border, upright 14/600 title
 *     (optional accent icon + eyebrow), bordered Icon.close button.
 *   - Body: scrollable, 16px 20px padding.
 *   - Footer: 12px 20px, 1px line-soft top border, ink-0, right-aligned actions.
 *   - Row / Toggle / select / input primitives shared by all bodies.
 *
 * These render *inside* the shared <Modal> chrome (backdrop + card), which stays
 * the single source of the backdrop / card / mobile-sheet behaviour.
 */

/* ── Field control styles ──────────────────────────────────────────────────── */

export const modalSelectStyle: React.CSSProperties = {
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  borderRadius: 6,
  padding: "6px 10px",
  color: "var(--paper)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  cursor: "pointer",
  outline: "none",
  minWidth: 120,
};

export const modalInputStyle: React.CSSProperties = {
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  borderRadius: 6,
  padding: "6px 10px",
  color: "var(--paper)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  width: 100,
  textAlign: "right",
  outline: "none",
};

/* ── Header ─────────────────────────────────────────────────────────────────── */

export function ModalHeader({
  title,
  icon,
  eyebrow,
  onClose,
  extra,
}: {
  title: React.ReactNode;
  /** Optional accent-tinted glyph shown left of the title. */
  icon?: React.ReactNode;
  /** Optional uppercase kicker rendered above the title. */
  eyebrow?: React.ReactNode;
  onClose: () => void;
  /** Optional controls rendered just before the close button. */
  extra?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "14px 20px",
        borderBottom: "1px solid var(--line-soft)",
        display: "flex",
        alignItems: eyebrow ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: 12,
        background: "var(--ink-1)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          {icon && <span style={{ display: "inline-flex", color: "var(--accent)", flexShrink: 0 }}>{icon}</span>}
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--paper)",
              letterSpacing: "-0.01em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </span>
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {extra}
        <ModalCloseButton onClose={onClose} />
      </div>
    </div>
  );
}

export function ModalCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Tooltip content="Close">
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          padding: 6,
          color: "var(--paper-3)",
          background: "transparent",
          border: "1px solid var(--line-soft)",
          borderRadius: 6,
          cursor: "pointer",
          display: "inline-flex",
          transition: "color 120ms, border-color 120ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; e.currentTarget.style.borderColor = "var(--line)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-3)"; e.currentTarget.style.borderColor = "var(--line-soft)"; }}
      >
        {Icon.close(11)}
      </button>
    </Tooltip>
  );
}

/* ── Body / footer ──────────────────────────────────────────────────────────── */

export function ModalBody({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        padding: "16px 20px",
        background: "var(--ink-1)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 8,
        padding: "12px 20px",
        borderTop: "1px solid var(--line-soft)",
        background: "var(--ink-0)",
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

/* ── Section wrapper ────────────────────────────────────────────────────────── */

export function ModalSection({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <div style={{ display: "flex", flexDirection: "column", ...style }}>{children}</div>;
}

/* ── Setting row: label + hint on the left, control on the right ────────────── */

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isPhone = useIsPhone();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isPhone ? "1fr" : "1fr auto",
        alignItems: isPhone ? "stretch" : "center",
        gap: isPhone ? 8 : 16,
        padding: "12px 0",
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: "var(--paper)" }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--paper-4)" }}>{hint}</span>}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: isPhone ? "wrap" : undefined,
          justifyContent: isPhone ? "flex-start" : "flex-end",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ── Key/value row: eyebrow label + value, no bottom border ─────────────────── */

export function ModalKvRow({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  const isPhone = useIsPhone();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isPhone ? "column" : "row",
        alignItems: isPhone ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: isPhone ? 4 : 0,
      }}
    >
      <span className="eyebrow">{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

/* ── Toggle switch (36×20) ──────────────────────────────────────────────────── */

export function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? "var(--accent, var(--amber))" : "var(--ink-2)",
        border: "1px solid var(--line-soft)",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 150ms",
        padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: on ? 17 : 1,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--paper)",
          transition: "left 150ms",
        }}
      />
    </button>
  );
}

/* ── Note paragraph ─────────────────────────────────────────────────────────── */

export function ModalNote({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 12, color: "var(--paper-3)", lineHeight: 1.55, margin: 0 }}>
      {children}
    </p>
  );
}
