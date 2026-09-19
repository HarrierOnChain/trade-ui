"use client";
import React from "react";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

interface Props {
  hovered: boolean;
  enabled: boolean;
  onToggle: () => void;
}

export function ColumnPauseToggle({ hovered, enabled, onToggle }: Props) {
  const color = !enabled
    ? "var(--accent)"
    : hovered
    ? "var(--sell)"
    : "var(--paper)";

  const accented = !enabled || hovered;
  const background = !enabled
    ? "var(--accent-w)"
    : hovered
    ? "var(--sell-w)"
    : "transparent";

  const tip = !enabled
    ? "Auto-pause off — click to enable"
    : hovered
    ? "Paused while hovering — click to disable"
    : "Auto-pause on hover — click to disable";

  return (
    <Tooltip content={tip}>
      <button
        onClick={onToggle}
        aria-label={tip}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 8px", height: 26,
          color,
          background,
          border: `1px solid ${accented ? color : "var(--line-soft)"}`,
          borderRadius: "var(--r-2)",
          cursor: "pointer",
          transition: "color 120ms, background 120ms, border-color 120ms",
        }}
      >
        {enabled ? Icon.pause(12) : Icon.play(12)}
      </button>
    </Tooltip>
  );
}
