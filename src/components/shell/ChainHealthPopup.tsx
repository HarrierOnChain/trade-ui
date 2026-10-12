"use client";
import React from "react";
import type { ChainSentiment } from "../../types";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { viewportMaxWidth } from "../../lib/popover";

type Props = {
  sentiment: ChainSentiment | null;
  placement?: "above" | "below";
};

/** Buy pressure on the chain: buys against sells over the last hour, summed
 *  by the API over the top 100 trending tokens by trades (the `trending`
 *  channel's summary, useChainSentiment). */
export function ChainHealthPopup({ sentiment, placement = "below" }: Props) {
  const data = sentiment;
  const isPhone = useIsPhone();
  const score = Number(data?.score ?? 0);
  const tone = getScoreTone(score);
  const label = scoreLabel(score);
  const verticalPosition =
    placement === "above"
      ? { bottom: "calc(100% + 8px)" }
      : { top: "calc(100% + 8px)" };

  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        width: isPhone ? viewportMaxWidth() : 328,
        maxWidth: isPhone ? viewportMaxWidth() : "calc(100vw - 24px)",
        zIndex: 80,
        padding: 0,
        borderRadius: 4,
        background: "var(--ink-1)",
        border: "1px solid var(--line-soft)",
        boxShadow: "var(--shadow-pop)",
        fontFamily: "var(--font-mono)",
        overflow: "hidden",
        ...verticalPosition,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: placement === "below" ? -8 : "auto",
          bottom: placement === "above" ? -8 : "auto",
          right: 0,
          width: "100%",
          height: 8,
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 12px 10px",
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--ink-2)",
        }}
      >
        <div>
          <div className="eyebrow" style={{ fontSize: 9 }}>
            Chain Health
          </div>
          <div style={{ marginTop: 4, color: "var(--paper-2)", fontSize: 12 }}>
            {data ? label : "Loading chain health"}
          </div>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 4,
            color: data ? tone.color : "var(--paper-4)",
            fontSize: 24,
            lineHeight: 1,
          }}
        >
          {data ? score.toFixed(0) : "..."}
          <span style={{ color: "var(--paper-4)", fontSize: 10 }}>/100</span>
        </div>
      </div>

      <div style={{ padding: 12 }}>
        <ScoreMeter score={score} tone={tone} disabled={!data} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0 14px",
            marginTop: 12,
          }}
        >
          <MetricRow label="Buys" value={data ? `${Math.round(data.buyRatio * 100)}%` : "–"} />
          <MetricRow label="Trades 1h" value={data ? formatNumber(data.trades) : "–"} />
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
        padding: "7px 0",
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--paper-4)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 12, color: "var(--paper-2)", textAlign: "right" }}>{value}</div>
    </div>
  );
}

function ScoreMeter({ score, tone, disabled }: { score: number; tone: ScoreTone; disabled: boolean }) {
  return (
    <div style={{ opacity: disabled ? 0.45 : 1 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 6,
          color: "var(--paper-4)",
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        <span>Fear</span>
        <span>Neutral</span>
        <span>Greed</span>
      </div>
      <div style={{ height: 6, overflow: "hidden", borderRadius: 2, background: "var(--line-soft)" }}>
        <div
          style={{
            width: `${Math.max(0, Math.min(100, score))}%`,
            height: "100%",
            borderRadius: 2,
            background: tone.color,
            transition: "width 180ms ease",
          }}
        />
      </div>
    </div>
  );
}

type ScoreTone = {
  color: string;
};

function getScoreTone(score: number): ScoreTone {
  if (score >= 70) return { color: "var(--buy)" };
  if (score >= 40) return { color: "var(--warn)" };
  return { color: "var(--sell)" };
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Bullish";
  if (score >= 60) return "Positive";
  if (score >= 40) return "Neutral";
  if (score >= 20) return "Bearish";
  return "Fearful";
}

function formatNumber(value: number | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
