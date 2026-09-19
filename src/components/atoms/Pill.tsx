import React from "react";

export type PillTone = "default" | "green" | "buy" | "sell" | "ghost" | "solid";
export type PillSize = "xs" | "sm";

export function Pill({
  children,
  tone = "default",
  size = "sm",
  style,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: PillTone; size?: PillSize }) {
  const tones: Record<PillTone, { bg: string; fg: string; bd: string }> = {
    default: { bg: "var(--ink-2)", fg: "var(--paper-2)", bd: "var(--line-soft)" },
    green:   { bg: "var(--accent-w)", fg: "var(--accent)", bd: "var(--accent)" },
    buy:     { bg: "var(--buy-w)", fg: "var(--buy)", bd: "var(--buy)" },
    sell:    { bg: "var(--sell-w)", fg: "var(--sell)", bd: "var(--sell)" },
    ghost:   { bg: "transparent", fg: "var(--paper-3)", bd: "var(--line-soft)" },
    solid:   { bg: "var(--paper)", fg: "var(--ink-0)", bd: "var(--paper)" },
  };
  const t = tones[tone];
  return (
    <span {...rest} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: size === "xs" ? "1px 6px" : "2px 8px",
      border: `1px solid ${t.bd}`,
      borderRadius: 999,
      background: t.bg, color: t.fg,
      fontSize: size === "xs" ? 10 : 11,
      fontFamily: "var(--font-mono)",
      letterSpacing: "0.02em",
      lineHeight: 1.3,
      ...style,
    }}>{children}</span>
  );
}
