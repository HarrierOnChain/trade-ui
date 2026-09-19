"use client";
import React from "react";
import { quoteMints, type QuoteMint } from "../../lib/quoteMints";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { QuoteAssetIcon } from "../atoms/QuoteAssetIcon";
import { Tooltip, type TooltipPlacement } from "../atoms/Tooltip";

type Props = {
  selected: QuoteMint;
  onSelect: (label: string) => void;
  ariaLabel: string;
  balances?: Partial<Record<string, string>>;
  tooltipPlacement?: TooltipPlacement;
  style?: React.CSSProperties;
};

export function QuoteMintSelector({
  selected,
  onSelect,
  ariaLabel,
  balances,
  tooltipPlacement = "top",
  style,
}: Props) {
  const showBalances = !!balances;
  const isPhone = useIsPhone();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        ...selectorStyle,
        // On phone allow the asset chips to wrap to a second line instead of
        // pushing the row past the viewport edge (4+ balance chips × 54px).
        ...(isPhone
          ? { display: "flex", flexWrap: "wrap", maxWidth: "100%" }
          : null),
        ...style,
      }}
    >
      {quoteMints().map((mint) => {
        const active = mint.label === selected.label;
        return (
          <Tooltip key={mint.label} content={`${ariaLabel} ${mint.label}`} placement={tooltipPlacement}>
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${ariaLabel} ${mint.label}`}
              onClick={() => onSelect(mint.label)}
              style={buttonStyle(active, showBalances)}
            >
              <QuoteAssetIcon label={mint.label} size={14} />
              {showBalances && (
                <span style={balanceStyle}>
                  {balances[mint.label] ?? "–"}
                </span>
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

const selectorStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: 2,
  background: "var(--ink-2)",
  border: "1px solid var(--line-soft)",
  borderRadius: 4,
};

function buttonStyle(active: boolean, withBalance: boolean): React.CSSProperties {
  return {
    width: withBalance ? 54 : 22,
    height: 22,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: withBalance ? 4 : 0,
    color: active ? "var(--paper)" : "var(--paper-3)",
    background: active ? "color-mix(in oklch, var(--paper) 12%, var(--ink-2))" : "transparent",
    border: `1px solid ${active ? "var(--paper-4)" : "transparent"}`,
    borderRadius: 3,
    cursor: "pointer",
    opacity: active ? 1 : 0.58,
    transition: "background 120ms ease, border-color 120ms ease, opacity 120ms ease",
  };
}

const balanceStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: 0,
};

