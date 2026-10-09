"use client";
import React, { useEffect, useRef, useState } from "react";
import { fmtPct } from "../../lib/format";
import { getActiveChain, nativeSymbol } from "../../lib/chains";
import { ChainIcon } from "./ChainIcon";
import { useIsMobile } from "../../hooks/useMediaQuery";

export function SolSymbol({
  size = 11,
  style,
}: {
  size?: number;
  style?: React.CSSProperties;
}) {
  const id = getActiveChain();
  return (
    <span
      aria-label={nativeSymbol(id)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 0,
        flexShrink: 0,
        ...style,
      }}
    >
      <ChainIcon id={id} size={size} />
    </span>
  );
}

export function SolAmount({
  children,
  iconSize = 11,
  gap = 3,
  className,
  style,
  iconPosition = "end",
}: {
  children: React.ReactNode;
  iconSize?: number;
  gap?: number;
  className?: string;
  style?: React.CSSProperties;
  iconPosition?: "start" | "end";
}) {
  const icon = <SolSymbol size={iconSize} />;
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {iconPosition === "start" && icon}
      <span>{children}</span>
      {iconPosition === "end" && icon}
    </span>
  );
}

// ── Change arrow ───────────────────────────────────────────────────────────
export function Change({ v, big }: { v?: number | null; big?: boolean }) {
  if (v == null) return <span style={{ color: "var(--paper-4)" }}>–</span>;
  const up = v >= 0;
  return (
    <span className="mono" style={{
      color: up ? "var(--buy)" : "var(--sell)",
      fontSize: big ? 14 : 11,
      fontWeight: 500,
    }}>
      {up ? "▲" : "▼"} {fmtPct(v)}
    </span>
  );
}

// ── Column header ──────────────────────────────────────────────────────────
export function ColumnHeader({
  title,
  count,
  icon,
  live = true,
  actions,
}: {
  title: React.ReactNode;
  count?: number | null;
  icon?: React.ReactNode;
  live?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 8,
      padding: "10px 12px", borderBottom: "1px solid var(--line-soft)",
      background: "var(--ink-1)", flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 }}>
        {icon}
        {typeof title === "string"
          ? <span style={{
              fontSize: 15, fontStyle: "normal", fontWeight: 700, letterSpacing: "-0.01em",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              minWidth: 0,
            }}>{title}</span>
          : title}
        {count != null && (
          <span className="mono" style={{ fontSize: 10, color: "var(--paper-3)" }}>· {count}</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {actions}
      </div>
    </div>
  );
}

// ── Modal shell ────────────────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  children,
  width = 460,
  align = "center",
  mobileVariant = "center",
}: {
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  width?: number;
  align?: "top" | "center";
  /** On phones (≤768px): "center" keeps a centered card sized to the viewport;
   *  "sheet" slides up from the bottom edge full-width. Desktop is unaffected. */
  mobileVariant?: "center" | "sheet";
}) {
  const isMobile = useIsMobile();
  // Drag-to-dismiss state for the mobile sheet grabber.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => {
    if (!open) { setDragY(0); setDragging(false); dragStart.current = null; }
  }, [open]);
  if (!open) return null;

  const startDrag = (e: React.PointerEvent) => {
    dragStart.current = e.clientY;
    setDragging(true);
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (dragStart.current == null) return;
    const dy = e.clientY - dragStart.current;
    setDragY(dy > 0 ? dy : 0);
  };
  const endDrag = () => {
    if (dragStart.current == null) return;
    const shouldClose = dragY > 90;
    dragStart.current = null;
    setDragging(false);
    setDragY(0);
    if (shouldClose) onClose?.();
  };

  // Mobile bottom-sheet variant — full-width, slides up, scrollable body.
  // Closes on backdrop tap or on a downward drag of the grabber.
  if (isMobile && mobileVariant === "sheet") {
    return (
      <div className="sheet-backdrop" onClick={() => onClose?.()}>
        <div
          className="sheet-panel"
          onClick={(e) => e.stopPropagation()}
          style={{
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: dragging ? "none" : "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <div
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label="Drag down to close"
            style={{ flexShrink: 0, padding: "2px 0 6px", touchAction: "none", cursor: "grab" }}
          >
            <div className="sheet-grabber" aria-hidden />
          </div>
          <div style={{ minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {children}
          </div>
        </div>
      </div>
    );
  }

  const topAlign = align === "top" && !isMobile;
  return (
    <div
      onClick={() => onClose?.()}
      style={{
        position: "fixed", inset: 0, zIndex: 40,
        background: "oklch(0.08 0.005 65 / 0.7)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: topAlign ? "flex-start" : "center",
        justifyContent: "center",
        paddingTop: topAlign ? 80 : 0,
        animation: "slideIn 180ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobile ? `min(${width}px, calc(100vw - 24px))` : width,
          maxWidth: isMobile ? "calc(100vw - 24px)" : "92vw",
          maxHeight: isMobile ? "90dvh" : "84vh",
          background: "var(--ink-1)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          boxShadow: "var(--shadow-pop)",
          overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
      >{children}</div>
    </div>
  );
}
