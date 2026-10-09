"use client";
import React from "react";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

/*
 * ── Shared modal kit ─────────────────────────────────────────────────────────
 *
 * One visual language for every modal, derived from SettingsModal:
 *   - Header bar: 14px 20px, 1px line-soft bottom border, upright 14/600 title
 *     (optional accent icon + eyebrow), bordered Icon.close button.
 *   - Body: scrollable, 16px 20px padding.
 *   - Footer: 12px 20px, 1px line-soft top border, ink-0, right-aligned actions.
 *
 * These render *inside* the shared <Modal> chrome (backdrop + card), which stays
 * the single source of the backdrop / card / mobile-sheet behaviour.
 */

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

/* ── Footer ──────────────────────────────────────────────────────────── */

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

/* ── Note paragraph ─────────────────────────────────────────────────────────── */

export function ModalNote({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 12, color: "var(--paper-3)", lineHeight: 1.55, margin: 0 }}>
      {children}
    </p>
  );
}
