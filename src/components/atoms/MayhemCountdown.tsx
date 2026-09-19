"use client";
// 24h countdown badge shown on mayhem tokens. Mayhem tokens have a
// fixed 24h trading window from creation; surfacing the remaining time
// inline with the socials row gives traders a glanceable "how long
// until this expires" signal without opening the chart.

import React, { useEffect, useRef } from "react";
import {
  formatCountdown,
  registerCountdown,
  unregisterCountdown,
} from "../../lib/ageRegistry";
import { Tooltip } from "./Tooltip";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

interface Props {
  // Token creation timestamp (ISO string or Date). The 24h window is
  // measured from this point.
  createdAt?: string | Date | null;
  /** Hide the badge once the timer hits zero (default true — a 00:00:00
   *  timer is just visual noise and the user explicitly asked to hide). */
  hideExpired?: boolean;
  fontSize?: number;
  /** Show seconds in the countdown (default true). Set false for compact rows. */
  showSeconds?: boolean;
}

export function MayhemCountdown({ createdAt, hideExpired = true, fontSize = 10, showSeconds = true }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  const startMs = createdAt
    ? (createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt))
    : NaN;
  const deadlineMs = Number.isFinite(startMs) ? startMs + TWENTY_FOUR_HOURS_MS : NaN;
  const expired = Number.isFinite(deadlineMs) && deadlineMs <= Date.now();
  const expiredText = showSeconds ? "00:00:00" : "00:00";

  useEffect(() => {
    const el = ref.current;
    if (!el || !Number.isFinite(deadlineMs)) return;
    el.textContent = formatCountdown(deadlineMs, expiredText, showSeconds);
    registerCountdown(el, deadlineMs, expiredText, showSeconds);
    return () => unregisterCountdown(el);
  }, [deadlineMs, showSeconds, expiredText]);

  if (!Number.isFinite(deadlineMs)) return null;
  if (expired && hideExpired) return null;

  return (
    <Tooltip content="Mayhem 24h trading window">
      <span
        className="mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          padding: "1px 5px",
          borderRadius: 3,
          background: "color-mix(in oklch, var(--sell, #ef4444) 16%, var(--ink-2) 84%)",
          color: "var(--sell, #ef4444)",
          fontSize,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.04em",
        }}
      >
        <span aria-hidden style={{ display: "inline-flex", lineHeight: 0 }}>
          <svg width={fontSize} height={fontSize} viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8.6" r="5.6" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 5.6V9l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5.5 2.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </span>
        <span ref={ref}>{formatCountdown(deadlineMs, expiredText, showSeconds)}</span>
      </span>
    </Tooltip>
  );
}
