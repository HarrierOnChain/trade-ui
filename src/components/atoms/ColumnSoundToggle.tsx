"use client";
import React from "react";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

interface Props {
  enabled: boolean;
  onToggle: () => void;
}

export function ColumnSoundToggle({ enabled, onToggle }: Props) {
  const color = enabled ? "var(--accent)" : "var(--paper)";
  const background = enabled ? "var(--accent-w)" : "transparent";
  const tip = enabled
    ? "Sound on — beep when a new token passes filters (click to mute)"
    : "Sound off — click to beep on new tokens passing filters";

  return (
    <Tooltip content={tip}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={tip}
        aria-pressed={enabled}
        style={{
          position: "relative",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          padding: "4px 8px", height: 26,
          color,
          background,
          border: `1px solid ${enabled ? color : "var(--line-soft)"}`,
          borderRadius: "var(--r-2)",
          cursor: "pointer",
          transition: "color 120ms, background 120ms, border-color 120ms",
        }}
      >
        {Icon.speaker(12)}
        {!enabled && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 5, right: 5,
              top: "50%",
              height: 1.4,
              background: "currentColor",
              transform: "translateY(-50%) rotate(-22deg)",
              borderRadius: 1,
              pointerEvents: "none",
              opacity: 0.85,
            }}
          />
        )}
      </button>
    </Tooltip>
  );
}
