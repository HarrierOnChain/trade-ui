"use client";

import React, { useMemo } from "react";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { computeTokenMetrics } from "../../lib/tokenMetrics";
import { fmtNum } from "../../lib/format";
import { fluidColsFit } from "../../lib/responsive";
import { useIsPhone } from "../../hooks/useMediaQuery";
import type { TokenEvent } from "../../types";

interface Props {
  mint: string;
}

export function TokenMetricsGrid({ mint }: Props) {
  const isPhone = useIsPhone();
  const { info } = useTokenInfo(mint);
  const token = (info ?? {}) as TokenEvent;

  // The API's shares: the ten largest holders (pools, curves and burns left
  // out), and the creator with its linked wallets.
  const metrics = useMemo(
    () => computeTokenMetrics(token, {
      top10Pct: token.top10Percent,
      devHoldPct: token.devPercent ?? null,
    }),
    [token],
  );

  const cells: Array<{
    icon: React.ReactNode;
    value: React.ReactNode;
    label: string;
    tone?: "buy" | "sell" | "warn" | "paper";
  }> = [
    {
      icon: <UsersIcon size={12} />,
      value: token.top10Percent != null ? `${metrics.top10Pct.toFixed(1)}%` : "—",
      label: "Top 10 H.",
      tone: metrics.top10Pct > 50 ? "warn" : "paper",
    },
    {
      icon: <ChefIcon size={12} />,
      value: metrics.devHoldPct != null ? `${metrics.devHoldPct.toFixed(2)}%` : "—",
      label: "Dev H.",
      tone: "buy",
    },
    {
      icon: <CrosshairIcon size={12} />,
      value: `${metrics.sniperPct.toFixed(1)}%`,
      label: "Snipers H.",
      tone: metrics.sniperPct > 8 ? "warn" : "buy",
    },
    {
      icon: <DotsIcon size={12} />,
      value: `${metrics.bundlePct.toFixed(1)}%`,
      label: "Bundlers",
      tone: metrics.bundlePct > 10 ? "warn" : "sell",
    },
    {
      icon: <PeopleIcon size={12} />,
      value: fmtNum(metrics.holders),
      label: "Holders",
      tone: "paper",
    },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isPhone ? fluidColsFit(70) : "1fr 1fr 1fr",
      gap: 6,
      padding: "10px 12px 8px",
      borderTop: "1px solid var(--line-soft)",
    }}>
      {cells.map((cell) => (
        <StatCard key={cell.label} {...cell} />
      ))}
    </div>
  );
}

function StatCard({
  icon, value, label, tone = "paper",
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  tone?: "buy" | "sell" | "warn" | "paper";
}) {
  const valueColor =
    tone === "buy" ? "var(--buy)"
      : tone === "sell" ? "var(--sell)"
      : tone === "warn" ? "var(--warn)"
      : "var(--paper)";
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 2,
      padding: "10px 4px",
      background: "var(--ink-2)",
      border: "1px solid var(--line-soft)",
      borderRadius: 6,
    }}>
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 13, fontWeight: 600,
        color: valueColor,
        fontFamily: "var(--font-mono)",
      }}>
        <span style={{ color: valueColor, lineHeight: 0 }}>{icon}</span>
        {value}
      </span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

function UsersIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="11.5" cy="5.5" r="1.8" stroke="currentColor" strokeWidth="1.1" />
      <path d="M14 13.5c0-1.8-1.2-3-3-3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function ChefIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 7h10v6H3V7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CrosshairIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function DotsIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

function PeopleIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10.5" cy="5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 13c0-2 1.8-3.5 4-3.5M10.5 9.5c2.2 0 4 1.5 4 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
