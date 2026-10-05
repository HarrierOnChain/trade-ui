"use client";

import React, { useMemo, useState } from "react";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { fluidColsFit } from "../../lib/responsive";
import { fmtNum, fmtSol, fmtUsd } from "../../lib/format";
import { Icon, SolSymbol } from "../../components/atoms";
import { KpiTile, TabBar } from "../portfolio/_components/atoms";
import {
  useChainLeaderboard,
  type LeaderboardPlatform,
} from "../../hooks/useChainLeaderboard";
import { useKolLeaderboard } from "../../hooks/useKolLeaderboard";
import type { LeaderboardPeriod } from "../../types";
import {
  LeaderboardTable,
  chainToRows,
  kolToRows,
} from "./_components/LeaderboardTable";

type View = "all" | "kols";

const VIEWS: Array<{ value: View; label: string }> = [
  { value: "all", label: "All traders" },
  { value: "kols", label: "KOLs" },
];

const PERIODS: Array<{ value: LeaderboardPeriod; label: string }> = [
  { value: "daily", label: "24h" },
  { value: "weekly", label: "7d" },
  { value: "monthly", label: "30d" },
];

// The API's wallet leaderboard (/wallets/top) is chain-wide: there is no
// per-platform ranking, so the Pump.fun / Bonk / Raydium chips are gone rather
// than left clickable and doing nothing.
const PLATFORMS: Array<{ value: LeaderboardPlatform; label: string }> = [];

export default function LeaderboardPage() {
  const isPhone = useIsPhone();
  const [view, setView] = useState<View>("all");
  const [period, setPeriod] = useState<LeaderboardPeriod>("weekly");
  const [platform, setPlatform] = useState<LeaderboardPlatform>("all");

  const chain = useChainLeaderboard(period, platform);
  // Only load KOL data when the KOL tab is active. Firing both hooks on mount
  // sends leaderboard+summary+KOL queries simultaneously, each taking ~4-5s
  // on cold cache and compounding ClickHouse load to 15-25s wall time.
  const kols = useKolLeaderboard(view === "kols" ? period : null);

  const active = view === "kols" ? kols : chain;
  const loading = active.loading;
  const statsLoading = view === "all" ? chain.statsLoading : false;
  const error = active.error;
  const refresh = active.refresh;
  const solanaOnly = active.solanaOnly;
  const stats = view === "all" ? chain.stats : null;

  const rows = useMemo(
    () => (view === "kols" ? kolToRows(kols.entries) : chainToRows(chain.entries)),
    [view, kols.entries, chain.entries],
  );

  const kolKpi = useMemo(() => {
    if (view !== "kols") return null;
    const profitable = kols.entries.filter((e) => e.pnlSol > 0).length;
    const totalPnl = kols.entries.reduce((s, e) => s + e.pnlSol, 0);
    const top = kols.entries[0];
    return { count: kols.entries.length, profitable, totalPnl, top };
  }, [view, kols.entries]);

  if (solanaOnly) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, color: "var(--paper-3)", fontSize: 13, textAlign: "center",
      }}>
        Chain trader leaderboard is available on Solana. Switch chain to view rankings.
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
      gap: isPhone ? 12 : 16, padding: isPhone ? "12px 10px" : "16px 18px",
      overflow: "hidden",
    }}>
      <header style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span className="eyebrow" style={{ fontSize: 9, color: "var(--paper-3)" }}>
            Solana history
          </span>
          <h1 className="ser" style={{
            fontStyle: "italic", fontSize: isPhone ? 26 : 32, lineHeight: 1.05,
            color: "var(--paper)", letterSpacing: "-0.02em", fontWeight: 400, margin: 0,
          }}>
            Leaderboard
          </h1>
          <p style={{ fontSize: 12, color: "var(--paper-3)", margin: 0, maxWidth: 560 }}>
            {view === "kols"
              ? "Verified KOL wallets ranked by realized PnL."
              : "Top profitable wallets ranked by realized PnL across the chain."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading || statsLoading}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 12px", borderRadius: 8,
            border: "1px solid var(--line-soft)", background: "var(--ink-1)",
            color: "var(--paper-3)", fontSize: 12, cursor: loading || statsLoading ? "wait" : "pointer",
          }}
        >
          {Icon.refresh(12)}
          Refresh
        </button>
      </header>

      <TabBar tabs={VIEWS} value={view} onChange={setView} />

      <div style={{
        display: "grid",
        gridTemplateColumns: fluidColsFit(isPhone ? 140 : 160),
        gap: 12,
      }}>
        {view === "all" ? (
          <>
            <KpiTile
              label="Profitable wallets"
              value={stats ? fmtNum(stats.totalProfitableWallets) : "–"}
              loading={statsLoading && !stats}
              glyph={Icon.holders(14)}
            />
            <KpiTile
              label="Total PnL"
              value={stats ? (
                <><span className="sol"><SolSymbol size={11} /></span>{fmtSol(stats.totalPnlSol, 2)}</>
              ) : "–"}
              sub={stats ? fmtUsd(stats.totalPnlUsd) : undefined}
              tone="buy"
              loading={statsLoading && !stats}
              glyph={Icon.chart(14)}
            />
            <KpiTile
              label="Median PnL"
              value={stats ? (
                <><span className="sol"><SolSymbol size={11} /></span>{fmtSol(stats.medianPnlSol, 3)}</>
              ) : "–"}
              sub={stats ? fmtUsd(stats.medianPnlUsd) : undefined}
              loading={statsLoading && !stats}
            />
            <KpiTile
              label="Top trader"
              value={stats ? (
                <><span className="sol"><SolSymbol size={11} /></span>{fmtSol(stats.maxPnlSol, 2)}</>
              ) : "–"}
              sub={stats ? fmtUsd(stats.maxPnlUsd) : undefined}
              tone="gold"
              loading={statsLoading && !stats}
            />
          </>
        ) : (
          <>
            <KpiTile
              label="Verified KOLs"
              value={kolKpi ? fmtNum(kolKpi.count) : "–"}
              loading={loading && !kolKpi}
              glyph={Icon.holders(14)}
            />
            <KpiTile
              label="Profitable KOLs"
              value={kolKpi ? fmtNum(kolKpi.profitable) : "–"}
              loading={loading && !kolKpi}
              tone="buy"
            />
            <KpiTile
              label="Combined PnL"
              value={kolKpi ? (
                <><span className="sol"><SolSymbol size={11} /></span>{fmtSol(kolKpi.totalPnl, 2)}</>
              ) : "–"}
              loading={loading && !kolKpi}
            />
            <KpiTile
              label="Top KOL"
              value={kolKpi?.top ? (
                <><span className="sol"><SolSymbol size={11} /></span>{fmtSol(kolKpi.top.pnlSol, 2)}</>
              ) : "–"}
              sub={kolKpi?.top?.name}
              tone="gold"
              loading={loading && !kolKpi}
            />
          </>
        )}
      </div>

      <div style={{
        display: "flex", flexDirection: isPhone ? "column" : "row",
        alignItems: isPhone ? "stretch" : "center",
        justifyContent: "space-between", gap: 10,
      }}>
        <TabBar tabs={PERIODS} value={period} onChange={setPeriod} />
        {view === "all" && PLATFORMS.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: isPhone ? 0 : "0 4px" }}>
            {PLATFORMS.map((p) => {
              const on = platform === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPlatform(p.value)}
                  style={{
                    padding: "6px 12px", borderRadius: 999,
                    border: `1px solid ${on ? "var(--accent-d)" : "var(--line-soft)"}`,
                    background: on ? "var(--accent-w)" : "var(--ink-1)",
                    color: on ? "var(--accent)" : "var(--paper-3)",
                    fontSize: 11, fontWeight: on ? 600 : 500,
                    cursor: "pointer", fontFamily: "var(--font-ui)",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <LeaderboardTable
          entries={rows}
          loading={loading}
          error={error}
          kolMode={view === "kols"}
          emptyLabel={view === "kols" ? "No verified KOLs yet — seed them in Admin → KOLs" : undefined}
        />
      </div>
    </div>
  );
}
