"use client";

import React from "react";
import type { WalletKind } from "../api/backend";
import {
  walletAvatarColor,
  walletAvatarFontSize,
  walletDisplayGlyph,
} from "../lib/walletAvatar";

export interface WalletAvatarProps {
  label: string;
  kind: WalletKind;
  index?: number;
  size?: number;
  customGlyph?: string | null;
  selected?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function WalletAvatar({
  label,
  kind,
  index = 0,
  size = 30,
  customGlyph,
  selected = false,
  title,
  onClick,
}: WalletAvatarProps) {
  const glyph = walletDisplayGlyph(label, customGlyph);
  const color = walletAvatarColor(index, kind);
  const ring = selected ? "var(--accent)" : color;
  const fontSize = walletAvatarFontSize(glyph, size);

  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: selected ? ring : `${color}1a`,
        border: selected
          ? `2px solid ${ring}`
          : `1.5px solid ${color}40`,
        color: selected ? "var(--ink-0)" : color,
        fontSize,
        fontWeight: 700,
        letterSpacing: glyph.length > 1 && !/\p{Extended_Pictographic}/u.test(glyph) ? 0.3 : 0,
        lineHeight: 1,
        userSelect: "none",
        fontFamily: /\p{Extended_Pictographic}/u.test(glyph) ? "inherit" : "var(--font-mono)",
        cursor: onClick ? "pointer" : undefined,
        padding: 0,
        boxShadow: selected
          ? `0 0 0 2px var(--ink-1), 0 0 0 3px ${ring}, 0 0 10px -1px color-mix(in oklch, var(--accent) 55%, transparent)`
          : "none",
        transition: "background 120ms, color 120ms, box-shadow 120ms, border-color 120ms",
      }}
      onMouseEnter={onClick ? (e) => {
        if (!selected) e.currentTarget.style.background = `${color}2e`;
      } : undefined}
      onMouseLeave={onClick ? (e) => {
        if (!selected) e.currentTarget.style.background = `${color}1a`;
      } : undefined}
      aria-label={onClick ? `Edit avatar for ${label}` : undefined}
    >
      {glyph}
    </Tag>
  );
}
