"use client";
import React, { useEffect, useState } from "react";
import { Tooltip } from "./Tooltip";
import { QuoteAssetIcon } from "./QuoteAssetIcon";
import { useQuickBuyAmount } from "../../hooks/useQuickBuyAmount";
import { useBuyQuoteMint } from "../../hooks/useBuyQuoteMint";
import { useIsPhone } from "../../hooks/useMediaQuery";

export function ColumnQuickBuyInput({ column }: { column?: string }) {
  const [amount, setAmount] = useQuickBuyAmount(column);
  const [quote] = useBuyQuoteMint();
  const isPhone = useIsPhone();
  const [text, setText] = useState(String(amount));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(amount));
  }, [amount, focused]);

  function commit() {
    const n = parseFloat(text);
    // Allow 0 → disables quick-buy (hides the hover ⚡ overlay on rows).
    if (Number.isFinite(n) && n >= 0) setAmount(n);
    else setText(String(amount));
  }

  return (
    <Tooltip content={`Quick-buy amount · pay with ${quote.label}`}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "0 8px",
          height: 26,
          background: "transparent",
          border: `1px solid ${focused ? "var(--accent)" : "var(--line-soft)"}`,
          borderRadius: "var(--r-2)",
          transition: "border-color 120ms",
        }}
      >
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setText(String(amount));
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          aria-label={`Quick-buy ${quote.label} amount`}
          style={{
            // Roomier numeric field on phone touch keyboards; desktop unchanged.
            width: isPhone ? 48 : 38,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--paper)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            padding: 0,
            textAlign: "right",
          }}
        />
        <span aria-label={quote.label} style={{ display: "inline-flex", lineHeight: 0, flexShrink: 0 }}>
          <QuoteAssetIcon label={quote.label} size={11} />
        </span>
      </span>
    </Tooltip>
  );
}
