"use client";
import React from "react";
import type { ChainSentiment } from "../../types";
import { getActiveChain, nativeSymbol } from "../../lib/chains";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { viewportMaxWidth } from "../../lib/popover";

export type SentimentTab = "status" | "components";

type SentimentDetails = ChainSentiment & {
  metrics?: {
    deployCount?: number;
    migrationCount?: number;
    tradeCount?: number;
    buyCount?: number;
    volumeSol?: number;
    proTradeCount?: number;
    sniperCount?: number;
    bundleCount?: number;
    avgHoldingSeconds?: number;
  };
  componentScores?: {
    volume?: number;
    buyCount?: number;
    tradeCount?: number;
    bundleRatio?: number;
    deployCount?: number;
    holdingTime?: number;
    sniperRatio?: number;
    proTradeRatio?: number;
    migrationBonus?: number;
  };
};

type Props = {
  activeTab: SentimentTab;
  onTabChange: (tab: SentimentTab) => void;
  sentiment: ChainSentiment | null;
  placement?: "above" | "below";
};

export function ChainHealthPopup({
  activeTab,
  onTabChange,
  sentiment,
  placement = "below",
}: Props) {
  const data = sentiment as SentimentDetails | null;
  const isPhone = useIsPhone();
  const score = Number(data?.score ?? 0);
  const tone = getScoreTone(score);
  const metrics = data?.metrics ?? {};
  const components = data?.componentScores ?? {};
  const label = data?.label ?? scoreLabel(score);
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

      <div
        style={{
          display: "flex",
          gap: 0,
          padding: 6,
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--ink-1)",
        }}
      >
        {(["status", "components"] as SentimentTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            style={{
              flex: 1,
              height: 26,
              borderRadius: 4,
              border: "0",
              background: activeTab === tab ? "var(--ink-2)" : "transparent",
              color: activeTab === tab ? "var(--paper)" : "var(--paper-3)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {tab === "status" ? "Status" : "Components"}
          </button>
        ))}
      </div>

      <div style={{ padding: 12 }}>
        <ScoreMeter score={score} tone={tone} disabled={!data} />

        {activeTab === "status" ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0 14px",
              marginTop: 12,
            }}
          >
            <MetricRow label="Trades" value={formatNumber(metrics.tradeCount)} />
            <MetricRow label="Volume" value={`${formatNumber(metrics.volumeSol)} ${nativeSymbol(getActiveChain())}`} />
            <MetricRow label="Buys" value={formatNumber(metrics.buyCount)} />
            <MetricRow label="Deploys" value={formatNumber(metrics.deployCount)} />
            <MetricRow label="Pro" value={formatNumber(metrics.proTradeCount)} />
            <MetricRow label="Avg Hold" value={formatTime(metrics.avgHoldingSeconds)} />
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginTop: 12,
            }}
          >
            <ScoreBar label="Volume" score={components.volume} />
            <ScoreBar label="Buy Count" score={components.buyCount} />
            <ScoreBar label="Trade Count" score={components.tradeCount} />
            <ScoreBar label="Pro Trades" score={components.proTradeRatio} />
            <ScoreBar label="Deploys" score={components.deployCount} />
          </div>
        )}
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

function ScoreBar({ label, score }: { label: string; score?: number }) {
  const safeScore = Number(score ?? 0);
  const tone = getScoreTone(safeScore);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 76, flexShrink: 0, fontSize: 10, color: "var(--paper-3)" }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 4, overflow: "hidden", borderRadius: 2, background: "var(--line-soft)" }}>
        <div
          style={{
            width: `${Math.max(0, Math.min(100, safeScore))}%`,
            height: "100%",
            borderRadius: 2,
            background: tone.color,
          }}
        />
      </div>
      <span style={{ width: 28, textAlign: "right", fontSize: 11, color: tone.color }}>
        {safeScore.toFixed(0)}
      </span>
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

function formatTime(seconds: number | undefined) {
  const n = Number(seconds ?? 0);
  if (!Number.isFinite(n)) return "0s";
  if (n >= 3600) return `${(n / 3600).toFixed(1)}h`;
  if (n >= 60) return `${(n / 60).toFixed(1)}m`;
  return `${n.toFixed(0)}s`;
}
