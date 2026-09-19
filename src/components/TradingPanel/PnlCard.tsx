"use client";
import React, { useRef, useState } from "react";
import { Icon, SolAmount } from "../atoms";

export interface PnlCardProps {
  totalPnl: number;
  bought: number;
  sold: number;
  holdingsValue: number;
  totalWallets: number;
  trades: number;
  tokenSymbol?: string;
  tokenAddress: string;
}

function fmtSol(v: number) {
  if (v > 0) return `+${v.toFixed(4)}`;
  if (v < 0) return v.toFixed(4);
  return v.toFixed(4);
}

// Share-ready receipt of the user's PnL on a token. The download path
// dynamically imports html2canvas so we don't take a hard dependency on
// it — when the lib isn't installed the user sees a fallback alert.
export function PnlCard({
  totalPnl, bought, sold, holdingsValue, totalWallets, trades,
  tokenSymbol, tokenAddress,
}: PnlCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const negative = totalPnl < 0;

  async function download() {
    setDownloading(true);
    try {
      // Optional dep — install html2canvas for share-card export.
      // Use a runtime-resolved spec so the bundler doesn't try to resolve
      // it at type/build time when the package isn't installed.
      const spec = "html2canvas";
      const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ spec).catch(() => null)) as
        | { default: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement> }
        | null;
      if (!mod || !cardRef.current) {
        alert("Install html2canvas to enable PnL card image export.");
        return;
      }
      const canvas = await mod.default(cardRef.current, {
        scale: 2,
        backgroundColor: null,
        logging: false,
        useCORS: true,
      });
      const png = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = png;
      a.download = `pnl-${tokenSymbol ?? tokenAddress.slice(0, 4)}.png`;
      a.click();
    } finally {
      setDownloading(false);
    }
  }

  const accent = negative ? "var(--sell)" : "var(--buy)";
  const accentDim = negative ? "var(--sell-w)" : "var(--buy-w)";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 420, margin: "0 auto" }}>
      <div
        ref={cardRef}
        style={{
          width: "100%",
          position: "relative",
          overflow: "hidden",
          borderRadius: 18,
          background: `linear-gradient(135deg, ${accentDim}, var(--ink-1))`,
          border: `1px solid ${accent}`,
          padding: 24,
          fontFamily: "var(--font-mono)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 8,
            background: "var(--ink-2)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: accent,
          }}>
            {Icon.bolt(18)}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--paper)", letterSpacing: "-0.01em" }}>
              Raze Terminal
            </div>
            <div style={{ fontSize: 11, color: accent }}>{tokenSymbol ?? tokenAddress.slice(0, 6) + "…" + tokenAddress.slice(-4)}</div>
          </div>
        </div>

        {/* Total PnL */}
        <div style={{ textAlign: "center", margin: "12px 0 16px" }}>
          <div style={{ fontSize: 11, color: "var(--paper-3)", letterSpacing: "0.06em" }}>TOTAL P&amp;L</div>
          <div style={{ marginTop: 4, fontSize: 32, fontWeight: 700, color: accent, letterSpacing: "-0.01em" }}>
            <SolAmount iconSize={18}>{fmtSol(totalPnl)}</SolAmount>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <Stat label="Wallets" value={String(totalWallets)} />
          <Stat label="Trades" value={String(trades)} accent={accent} />
          <Stat label="Bought" value={<SolAmount>{fmtSol(bought)}</SolAmount>} accent="var(--buy)" />
          <Stat label="Sold" value={<SolAmount>{fmtSol(sold)}</SolAmount>} accent="var(--sell)" />
        </div>

        <div style={{
          display: "flex", justifyContent: "space-between",
          paddingTop: 10, borderTop: "1px dashed var(--line-soft)",
          fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.04em",
        }}>
          <span>Holdings <SolAmount iconSize={9}>{holdingsValue.toFixed(4)}</SolAmount></span>
          <span>{tokenAddress.slice(0, 6)}…{tokenAddress.slice(-4)}</span>
        </div>
      </div>

      <button
        onClick={download}
        disabled={downloading}
        style={{
          marginTop: 14, width: "100%",
          padding: "10px 14px",
          background: accent, color: "var(--ink-0)",
          border: 0, borderRadius: 8,
          fontSize: 12, fontWeight: 600, letterSpacing: "0.06em",
          cursor: downloading ? "not-allowed" : "pointer",
          opacity: downloading ? 0.6 : 1,
        }}
      >
        {downloading ? "GENERATING…" : "DOWNLOAD PNL CARD"}
      </button>
    </div>
  );
}

function Stat({
  label, value, accent = "var(--paper)",
}: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      padding: "10px 12px",
      background: "var(--ink-0)",
      border: "1px solid var(--line-soft)",
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.06em" }}>{label.toUpperCase()}</div>
      <div style={{ marginTop: 3, fontSize: 16, fontWeight: 600, color: accent }}>{value}</div>
    </div>
  );
}
