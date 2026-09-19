import React from "react";

export function RazeTerminalMark({ size = 18, color = "var(--accent)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.4" />
      <circle cx="12" cy="12" r="5.5" stroke={color} strokeWidth="1.4" />
      <line x1="12" y1="2" x2="12" y2="6.5" stroke={color} strokeWidth="1.4" />
      <line x1="12" y1="17.5" x2="12" y2="22" stroke={color} strokeWidth="1.4" />
    </svg>
  );
}

export function Brand({ small }: { small?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <RazeTerminalMark size={small ? 16 : 20} />
      <span className="ser" style={{
        fontSize: small ? 17 : 22,
        letterSpacing: "-0.02em",
        color: "var(--paper)",
        fontStyle: "italic",
        lineHeight: 1,
      }}>Raze Terminal</span>
    </div>
  );
}
