"use client";
import React from "react";
import { useApp } from "../../contexts/AppContext";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { SolAmount } from "../atoms";

const AMOUNTS = [0.1, 0.5, 1, 5];

export function QuickBuyRow() {
  const { pushToast } = useApp();
  const isPhone = useIsPhone();

  // AuthGate guarantees the user is authed by the time QuickBuyRow
  // renders, so no in-line auth fallback is needed.
  function onQuick(v: number) {
    pushToast({
      title: "QUICK BUY ARMED",
      body: <>Next click on a token buys <SolAmount>{v}</SolAmount></>,
      tone: "buy",
    });
  }

  const buttons = AMOUNTS.map((v) => (
    <button
      key={v}
      onClick={() => onQuick(v)}
      className={isPhone ? "tap-target" : undefined}
      style={{
        fontSize: 10, fontFamily: "var(--font-mono)",
        padding: "3px 8px",
        background: "var(--ink-2)",
        border: "1px solid var(--line-soft)",
        borderRadius: 3,
        color: "var(--paper-2)",
        transition: "background 120ms, color 120ms, border-color 120ms",
        // On phone the buttons fill their grid cell instead of sizing to content.
        width: isPhone ? "100%" : undefined,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--buy-w)";
        e.currentTarget.style.color = "var(--buy)";
        e.currentTarget.style.borderColor = "var(--buy)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--ink-2)";
        e.currentTarget.style.color = "var(--paper-2)";
        e.currentTarget.style.borderColor = "var(--line-soft)";
      }}
    ><SolAmount iconSize={10}>{v}</SolAmount></button>
  ));

  return (
    <div style={{
      // Desktop: single inline row. Phone: label stacked above a 2×2 button grid
      // so 4 presets + label never overflow a 360px row.
      display: "flex",
      flexDirection: isPhone ? "column" : "row",
      alignItems: isPhone ? "stretch" : "center",
      gap: 6,
      padding: "8px 12px",
      borderBottom: "1px solid var(--line-soft)",
      background: "var(--ink-0)",
    }}>
      <span className="eyebrow" style={{ flexShrink: 0 }}>QUICK BUY</span>
      {isPhone ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 6,
        }}>
          {buttons}
        </div>
      ) : (
        buttons
      )}
    </div>
  );
}
