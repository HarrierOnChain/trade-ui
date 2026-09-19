import React from "react";
import { Icon } from "./Icon";

/**
 * Glyph for a quote asset, keyed by its label. Covers the per-chain quote
 * registry (see lib/quoteMints.ts). Unknown labels fall back to ETH.
 */
export function QuoteAssetIcon({ label, size }: { label: string; size: number }) {
  switch (label) {
    case "SOL":
      return Icon.solana(size);
    case "ETH":
      return Icon.ethereum(size);
    case "BNB":
      return Icon.bsc(size);
    case "USDC":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" style={iconStyle}>
          <circle cx="16" cy="16" r="16" fill="#2775CA" />
          <path d="M10.15 9.1a9.3 9.3 0 0 0 0 13.8M21.85 9.1a9.3 9.3 0 0 1 0 13.8" stroke="#fff" strokeWidth="2.15" strokeLinecap="round" />
          <text x="16" y="21.2" textAnchor="middle" fontFamily="Geist, -apple-system, system-ui, sans-serif" fontSize="15" fontWeight="700" fill="#fff">$</text>
        </svg>
      );
    case "USD1":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" style={iconStyle}>
          <circle cx="16" cy="16" r="16" fill="#101820" />
          <circle cx="16" cy="16" r="11.5" stroke="#F2C86B" strokeWidth="2" />
          <path d="M15.1 8.7h3.4v14.6h-3.6v-9.7l-2.35 1.45-1.5-2.55 4.05-3.8Z" fill="#F7D98A" />
        </svg>
      );
    default:
      return Icon.ethereum(size);
  }
}

const iconStyle: React.CSSProperties = { display: "block", flexShrink: 0 };

/**
 * Amount rendered next to its quote-asset glyph — the quote-aware sibling of
 * `SolAmount`. Used by quick-buy surfaces so the amount is labelled with the
 * selected quote token (SOL/USDC/USD1/…) rather than a hardcoded SOL mark.
 */
export function QuoteAmount({
  label,
  children,
  iconSize = 11,
  gap = 3,
  className,
  style,
  iconPosition = "end",
}: {
  label: string;
  children: React.ReactNode;
  iconSize?: number;
  gap?: number;
  className?: string;
  style?: React.CSSProperties;
  iconPosition?: "start" | "end";
}) {
  const icon = (
    <span aria-label={label} style={{ display: "inline-flex", lineHeight: 0, flexShrink: 0 }}>
      <QuoteAssetIcon label={label} size={iconSize} />
    </span>
  );
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap, whiteSpace: "nowrap", ...style }}
    >
      {iconPosition === "start" && icon}
      <span>{children}</span>
      {iconPosition === "end" && icon}
    </span>
  );
}
