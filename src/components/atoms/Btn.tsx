import React from "react";

export type BtnTone = "primary" | "buy" | "sell" | "solid" | "ghost" | "quiet";
export type BtnSize = "xs" | "sm" | "md" | "lg";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: BtnTone;
  size?: BtnSize;
  icon?: React.ReactNode;
}

export function Btn({
  children,
  tone = "ghost",
  size = "md",
  icon,
  style,
  ...rest
}: Props) {
  const sizes: Record<BtnSize, { pad: string; fs: number; h: number }> = {
    xs: { pad: "4px 8px", fs: 11, h: 22 },
    sm: { pad: "5px 10px", fs: 12, h: 26 },
    md: { pad: "7px 14px", fs: 12, h: 32 },
    lg: { pad: "10px 18px", fs: 13, h: 40 },
  };
  const tones: Record<BtnTone, { bg: string; fg: string; bd: string }> = {
    primary: { bg: "var(--accent)", fg: "var(--ink-0)", bd: "var(--accent)" },
    buy:     { bg: "var(--buy)", fg: "var(--ink-0)", bd: "var(--buy)" },
    sell:    { bg: "var(--sell)", fg: "#fff", bd: "var(--sell)" },
    solid:   { bg: "var(--paper)", fg: "var(--ink-0)", bd: "var(--paper)" },
    ghost:   { bg: "transparent", fg: "var(--paper)", bd: "var(--line)" },
    quiet:   { bg: "var(--ink-1)", fg: "var(--paper-2)", bd: "transparent" },
  };
  const s = sizes[size];
  const t = tones[tone];
  return (
    <button {...rest} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
      padding: s.pad, height: s.h,
      fontSize: s.fs, fontWeight: 500,
      background: t.bg, color: t.fg,
      border: `1px solid ${t.bd}`,
      borderRadius: 4,
      transition: "background 120ms, border-color 120ms, transform 80ms",
      fontFamily: "var(--font-ui)",
      letterSpacing: "-0.005em",
      whiteSpace: "nowrap",
      ...style,
    }}>{icon}{children}</button>
  );
}
