"use client";

// Celebration overlay for DEX-paid / live-migration moments. By default it
// can reserve the trading side panel so buys/sells stay usable. Backdrop is
// non-interactive (pointer-events: none) except on the card itself.
//
// Trigger contract: parent passes `triggerAt` (a monotonic timestamp from a
// hook's one-shot signal). Every distinct new value re-fires the overlay.
// Parent renders this only when triggerAt is set, so it mounts at the moment
// of the live event.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";

const VISIBLE_MS = 6000;
const CONFETTI_COUNT = 28;

/** Keep the trading side panel uncovered (token page layout). */
export interface ReserveSidePanel {
  side: "left" | "right";
  width: number;
}

interface Props {
  /** Monotonic ms timestamp; every new value re-fires the overlay. */
  triggerAt: number;
  /** Large headline, e.g. "DEX Paid" or "Migrated". */
  title: string;
  /** Sub-line under the symbol row, e.g. "Now trading on PumpSwap". */
  tagline?: string;
  /** Symbol + name shown beneath the avatar. */
  symbol?: string;
  name?: string;
  /** Token image; falls back to a 4-letter symbol tag if missing/errored. */
  image?: string;
  /** Optional CTA button. */
  cta?: { label: string; href: string };
  /** Accent colour. Drives the border, glow, ring, headline, CTA. Defaults
   *  to the brand `--accent` green. */
  accent?: string;
  /** Override the default confetti palette. */
  confettiColors?: string[];
  /** Aria label for screen readers. */
  ariaLabel?: string;
  /** Exclude the trading panel column from the overlay (fixed inset). */
  reserveSidePanel?: ReserveSidePanel;
}

interface Particle {
  left: string;
  size: number;
  color: string;
  tx: string;
  rot: string;
  dur: number;
  delay: number;
  shape: "rect" | "circle";
}

function makeParticles(seed: number, colors: string[]): Particle[] {
  // Deterministic-ish per trigger so repeated re-renders within one
  // celebration don't shuffle particles mid-fall. `Math.random` seeded by
  // mulberry32 keeps this dependency-free.
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return Array.from({ length: CONFETTI_COUNT }, () => ({
    left: `${(rand() * 100).toFixed(2)}%`,
    size: 6 + Math.floor(rand() * 8),                         // 6–13 px
    color: colors[Math.floor(rand() * colors.length)],
    tx: `${(rand() * 200 - 100).toFixed(0)}px`,               // ±100px drift
    rot: `${Math.floor(360 + rand() * 1080)}deg`,             // 360–1440°
    dur: 2.6 + rand() * 1.8,                                  // 2.6–4.4s
    delay: rand() * 0.6,                                      // 0–0.6s stagger
    shape: rand() < 0.5 ? "rect" : "circle",
  }));
}

const DEFAULT_CONFETTI = ["#3DD96F", "#3DD96F", "#3DD96F", "#FFD15C", "#5CC8FF", "#FF6FB5"];

export function CelebrationOverlay({
  triggerAt,
  title,
  tagline,
  symbol,
  name,
  image,
  cta,
  accent = "var(--accent)",
  confettiColors = DEFAULT_CONFETTI,
  ariaLabel,
  reserveSidePanel,
}: Props) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(true);
  // Trigger change → reset open + fresh confetti without parent re-keying.
  const lastTrigger = useRef(triggerAt);
  useEffect(() => {
    if (triggerAt !== lastTrigger.current) {
      lastTrigger.current = triggerAt;
      setOpen(true);
    }
  }, [triggerAt]);

  // Auto-dismiss + Esc handler.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(false), VISIBLE_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, triggerAt]);

  const particles = useMemo(
    () => makeParticles(triggerAt, confettiColors),
    [triggerAt, confettiColors],
  );
  const labelSymbol = symbol?.trim() || "TOKEN";
  const labelName = name?.trim();

  if (!open) return null;

  const panelReserve = reserveSidePanel && reserveSidePanel.width > 0
    ? reserveSidePanel
    : null;

  return (
    <div
      role="dialog"
      aria-label={ariaLabel ?? title}
      style={{
        position: "fixed",
        top: 0,
        bottom: 0,
        left: panelReserve?.side === "left" ? panelReserve.width : 0,
        right: panelReserve?.side === "right" ? panelReserve.width : 0,
        zIndex: 40,
        pointerEvents: "none",
        background:
          "radial-gradient(70% 50% at 50% 35%, color-mix(in srgb, currentColor 12%, transparent) 0%, rgba(8, 14, 12, 0.45) 55%, rgba(8, 14, 12, 0.62) 100%)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        animation: "celebration-backdrop-in 240ms ease-out both",
        display: "grid",
        placeItems: "center",
        alignContent: "start",
        paddingTop: "min(18vh, 140px)",
        overflow: "hidden",
        color: accent, // drives currentColor for backdrop bloom + card glow
      }}
    >
      {/* Confetti layer */}
      <div
        aria-hidden
        style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
      >
        {particles.map((p, i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              top: 0,
              left: p.left,
              width: p.size,
              height: p.shape === "rect" ? p.size * 1.6 : p.size,
              background: p.color,
              borderRadius: p.shape === "circle" ? "50%" : 2,
              opacity: 0,
              willChange: "transform, opacity",
              animation: `celebration-confetti-fall ${p.dur}s linear ${p.delay}s forwards`,
              // Per-particle vars consumed by the keyframe.
              ["--tx" as never]: p.tx,
              ["--rot" as never]: p.rot,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Card — `color: accent` drives the glow keyframe via currentColor. */}
      <div
        style={{
          position: "relative",
          pointerEvents: "auto",
          width: isMobile ? "min(90vw, 360px)" : "min(360px, calc(100vw - 48px))",
          padding: "22px 22px 18px",
          background: "linear-gradient(180deg, rgba(20, 30, 24, 0.96), rgba(12, 18, 15, 0.96))",
          border: "1px solid currentColor",
          color: accent,
          borderRadius: 14,
          animation:
            "celebration-card-in 360ms cubic-bezier(0.18, 1.18, 0.32, 1.18) both, celebration-glow 2.4s ease-in-out 360ms infinite",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Dismiss"
          className="tap-target"
          style={{
            position: "absolute",
            top: isMobile ? 4 : 8,
            right: isMobile ? 6 : 10,
            display: isMobile ? "inline-flex" : undefined,
            alignItems: isMobile ? "center" : undefined,
            justifyContent: isMobile ? "center" : undefined,
            background: "transparent",
            border: 0,
            color: "var(--paper-3)",
            font: "inherit",
            fontSize: 16,
            lineHeight: 1,
            padding: 4,
            cursor: "pointer",
          }}
        >
          ×
        </button>

        {/* Token avatar with accent ring */}
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: "50%",
            padding: 3,
            background: `conic-gradient(from 0deg, ${accent}, transparent 70%, ${accent})`,
            animation: "spin 6s linear infinite",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              background: "var(--ink-1)",
              overflow: "hidden",
              display: "grid",
              placeItems: "center",
            }}
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt={labelSymbol}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <span
                className="mono"
                style={{ color: accent, fontWeight: 700, fontSize: 20 }}
              >
                {labelSymbol.slice(0, 4)}
              </span>
            )}
          </div>
        </div>

        <div
          className="mono"
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: accent,
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>

        <div
          className="mono"
          style={{
            fontSize: 12,
            color: "var(--paper-2)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          ${labelSymbol}
          {labelName ? ` · ${labelName}` : ""}
        </div>

        {tagline && (
          <div style={{ fontSize: 12, color: "var(--paper-3)", lineHeight: 1.4 }}>
            {tagline}
          </div>
        )}

        {cta && (
          <a
            href={cta.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginTop: 4,
              padding: "8px 16px",
              background: accent,
              color: "var(--ink-1)",
              textDecoration: "none",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {cta.label}
          </a>
        )}

        {/* Auto-dismiss progress bar */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            background: "color-mix(in srgb, currentColor 22%, transparent)",
            borderBottomLeftRadius: 14,
            borderBottomRightRadius: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              background: accent,
              transformOrigin: "left",
              animation: `celebration-progress ${VISIBLE_MS}ms linear both`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
