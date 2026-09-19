"use client";

import React, { useMemo } from "react";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useHolders } from "../../hooks/useHolders";
import { useDexPaid } from "../../hooks/useDexPaid";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import {
  computeTokenMetrics,
  devHoldPct,
  top10HoldPct,
} from "../../lib/tokenMetrics";
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
  const { holders: holderRows, supply } = useHolders(mint);
  const { dexPaid, dexscreenerUrl } = useDexPaid(mint);
  const liveMap = useLiveTradePrices(useMemo(() => [mint], [mint]));
  const live = liveMap.get(mint);
  const token = (info ?? {}) as TokenEvent;

  const metrics = useMemo(() => {
    const top10 = top10HoldPct(holderRows, supply);
    const devPct = devHoldPct(holderRows, token.signer);
    return computeTokenMetrics(token, live, {
      top10Pct: top10 > 0 ? top10 : undefined,
      devHoldPct: devPct,
    });
  }, [token, live, holderRows, supply]);

  const dexPaidKnown = typeof dexPaid === "boolean";
  const dexPaidValue = dexPaidKnown
    ? (dexPaid ? "YES" : "NO")
    : "—";

  const cells: Array<{
    icon: React.ReactNode;
    value: React.ReactNode;
    label: string;
    tone?: "buy" | "sell" | "warn" | "paper";
    href?: string;
  }> = [
    {
      icon: <UsersIcon size={12} />,
      value: holderRows.length > 0 ? `${metrics.top10Pct.toFixed(1)}%` : "—",
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
    {
      icon: <ShieldIcon size={12} />,
      value: dexPaidValue,
      label: "Dexscreener",
      tone: dexPaid === true ? "buy" : "paper",
      href: dexPaid === true ? dexscreenerUrl : undefined,
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
  icon, value, label, tone = "paper", href,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  tone?: "buy" | "sell" | "warn" | "paper";
  href?: string;
}) {
  const valueColor =
    tone === "buy" ? "var(--buy)"
      : tone === "sell" ? "var(--sell)"
      : tone === "warn" ? "var(--warn)"
      : "var(--paper)";
  const valueNode = (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 13, fontWeight: 600,
      color: valueColor,
      fontFamily: "var(--font-mono)",
    }}>
      <span style={{ color: valueColor, lineHeight: 0 }}>{icon}</span>
      {value}
    </span>
  );
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 2,
      padding: "10px 4px",
      background: "var(--ink-2)",
      border: "1px solid var(--line-soft)",
      borderRadius: 6,
    }}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title="DexScreener Enhanced Info"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          {valueNode}
        </a>
      ) : valueNode}
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

function ShieldIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5L3 3.5v4c0 3 2.2 5.5 5 6.5 2.8-1 5-3.5 5-6.5v-4L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
