"use client";
import React, { useEffect, useMemo, useState } from "react";
import { tokenHref } from "../../lib/tokenHref";
import { explorerAccountUrl, explorerName, explorerTxUrl } from "../../lib/chains";
import { useClientNav } from "./ClientPages";
import { Modal, Icon, Change, SolAmount, TokenIdentity, Tooltip } from "../atoms";
import { WalletTrades } from "../WalletTrades";
import { useApp } from "../../contexts/AppContext";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useWalletHoldings } from "../../hooks/useWalletHoldings";
import { useWalletSummaryBatch } from "../../hooks/useWalletSummaryBatch";
import { fmtNum, fmtPct, fmtSol, fmtUsd, shortAddr } from "../../lib/format";
import { formatAge } from "../../lib/ageRegistry";
import { useWalletLabel } from "../../hooks/useWalletLabels";
import {
  fetchPerpWalletPnl,
  fetchPerpWalletPositions,
  fetchPerpWalletLiquidations,
  fetchSignerCounts,
  type PerpPosition,
  type PerpLiquidation,
} from "../../api/client";
import { usePerpLivePrices, liveUnrealizedPnl } from "../../hooks/usePerpLivePrices";
import { perpHref } from "../../lib/perpRoutes";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { fluidColsFit } from "../../lib/responsive";

const WINDOW_DAYS = 30;

type Mode = "spot" | "perps";
type SpotTab = "holdings" | "activity" | "deployed";

export function WalletModal() {
  const { navigate } = useClientNav();
  const { walletModalAddress, closeWalletModal, pushToast } = useApp();
  const solPrice = useSolPrice();
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<Mode>("spot");
  const [spotTab, setSpotTab] = useState<SpotTab>("holdings");
  const isMobile = useIsMobile();

  const address = walletModalAddress;
  const open = !!address;

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      pushToast({ title: "COPIED", body: shortAddr(address, 6), tone: "buy" });
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const goToken = (mint: string) => {
    closeWalletModal();
    navigate(tokenHref(mint));
  };

  const goPerpMarket = (marketId: string) => {
    closeWalletModal();
    navigate(perpHref(marketId));
  };

  return (
    <Modal open={open} onClose={closeWalletModal} width={1040} align="top" mobileVariant={isMobile ? "sheet" : "center"}>
      <Header
        address={address ?? ""}
        copied={copied}
        onCopy={copy}
        onClose={closeWalletModal}
      />

      <ModeToggle mode={mode} onChange={setMode} />

      <div style={{
        flex: 1,
        minHeight: isMobile ? 0 : 320,
        maxHeight: isMobile ? "none" : "62vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        {mode === "spot" ? (
          <SpotView
            address={address}
            solPrice={solPrice ?? 0}
            tab={spotTab}
            onTabChange={setSpotTab}
            onTokenClick={goToken}
          />
        ) : (
          <PerpsView address={address} onMarketClick={goPerpMarket} />
        )}
      </div>
    </Modal>
  );
}

/* ───────── Mode toggle (SPOT / PERPS) ───────── */

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const opts: { id: Mode; label: string; sub: string }[] = [
    { id: "spot", label: "Spot", sub: "Holdings · trades · realized PnL" },
    { id: "perps", label: "Perps", sub: "Positions · volume · liquidations" },
  ];
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      borderBottom: "1px solid var(--line-soft)",
      background: "var(--ink-0)",
    }}>
      {opts.map((o) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              padding: "12px 16px",
              background: active ? "var(--ink-1)" : "transparent",
              border: 0,
              borderBottom: "2px solid " + (active ? "var(--paper)" : "transparent"),
              marginBottom: -1,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 2,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 12,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: active ? "var(--paper)" : "var(--paper-3)",
                fontWeight: 700,
              }}
            >
              {o.label}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 9,
                color: "var(--paper-4)",
                letterSpacing: "0.06em",
              }}
            >
              {o.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────── Spot view ───────── */

function SpotView({
  address,
  solPrice,
  tab,
  onTabChange,
  onTokenClick,
}: {
  address: string | null;
  solPrice: number;
  tab: SpotTab;
  onTabChange: (t: SpotTab) => void;
  onTokenClick: (mint: string) => void;
}) {
  const window = useMemo(() => {
    const now = Date.now();
    return { from: now - WINDOW_DAYS * 86_400_000, to: now };
  }, []);

  const addressList = useMemo(() => (address ? [address] : []), [address]);
  const { summaries, loading: statsLoading } = useWalletSummaryBatch(addressList, window);
  const stats = summaries[0] ?? null;

  const { holdings, summary: holdingsSummary, loading: holdingsLoading } = useWalletHoldings(address);

  const nativeSol = holdingsSummary?.totalSolBalance ?? 0;
  const tokensUsd = useMemo(() => {
    let v = 0;
    for (const h of holdings) {
      if (h.isNative) continue;
      if (typeof h.usdValue === "number") v += h.usdValue;
    }
    return v;
  }, [holdings]);
  const nativeUsd = solPrice > 0 ? nativeSol * solPrice : 0;
  const totalValueUsd = nativeUsd + tokensUsd;

  const firstTradeAt = stats?.firstTradeAt ? Date.parse(stats.firstTradeAt) : 0;
  const lastTradeAt = stats?.lastTradeAt ? Date.parse(stats.lastTradeAt) : 0;

  return (
    <>
      <StatsRow
        loading={statsLoading || holdingsLoading}
        nativeSol={nativeSol}
        totalValueUsd={totalValueUsd}
        holdingsCount={holdings.filter((h) => !h.isNative && (h.usdValue ?? 0) > 0).length}
        pnlSol={stats?.realizedPnlSol ?? 0}
        pnlUsd={stats?.realizedPnlUsd ?? 0}
        pnlPct={stats?.realizedPnlPct ?? null}
        volumeSol={stats?.totalVolumeSol ?? 0}
        volumeUsd={stats?.totalVolumeUsd ?? 0}
        tradeCount={stats?.totalTrades ?? 0}
        buys={stats?.totalBuys ?? 0}
        sells={stats?.totalSells ?? 0}
        winRate={stats?.winRate ?? 0}
        winningTokens={stats?.winningTokens ?? 0}
        uniqueTokens={stats?.uniqueTokensTraded ?? 0}
      />

      <MetaStrip
        avgSol={stats?.avgTradeSizeSol ?? 0}
        largestSol={stats?.largestTradeSol ?? 0}
        feesSol={stats?.totalFees ?? 0}
        pro={stats?.proTradeCount ?? 0}
        sniper={stats?.sniperCount ?? 0}
        bundle={stats?.bundleCount ?? 0}
        firstMs={firstTradeAt}
        lastMs={lastTradeAt}
      />

      <SpotTabs tab={tab} onChange={onTabChange} />

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "holdings" && (
          <HoldingsList
            loading={holdingsLoading}
            holdings={holdings}
            solPrice={solPrice}
            onTokenClick={onTokenClick}
          />
        )}
        {tab === "activity" && (
          <WalletTrades address={address} solPrice={solPrice} onTokenClick={onTokenClick} />
        )}
        {tab === "deployed" && (
          <DeployedList address={address} onTokenClick={onTokenClick} />
        )}
      </div>
    </>
  );
}

/* ───────── Deployed tokens list ───────── */

function DeployedList({
  address,
  onTokenClick,
}: {
  address: string | null;
  onTokenClick: (mint: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [deployTokens, setDeployTokens] = useState<string[]>([]);
  const [migrationSet, setMigrationSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!address) {
      setDeployTokens([]);
      setMigrationSet(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchSignerCounts(address, true)
      .then((r) => {
        if (cancelled) return;
        const d = r?.data;
        // The signer-counts endpoint doesn't dedupe — a wallet that
        // re-deploys the same mint (or whose deploy lands twice in the
        // ClickHouse ReplacingMergeTree before merge) shows the mint more
        // than once. Strip duplicates so the React rows stay keyed.
        const deploys = Array.isArray(d?.deployTokens) ? [...new Set(d.deployTokens)] : [];
        const migrations = Array.isArray(d?.migrationTokens) ? d.migrationTokens : [];
        setDeployTokens(deploys);
        setMigrationSet(new Set(migrations));
      })
      .catch(() => {
        if (cancelled) return;
        setDeployTokens([]);
        setMigrationSet(new Set());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [address]);

  if (loading) {
    return (
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 36, borderRadius: 4 }} />
        ))}
      </div>
    );
  }

  if (deployTokens.length === 0) {
    return (
      <div style={{
        padding: 32, textAlign: "center",
        color: "var(--paper-4)", fontSize: 11,
        fontFamily: "var(--font-mono)",
      }}>
        No tokens deployed by this wallet.
      </div>
    );
  }

  const migratedCount = deployTokens.filter((m) => migrationSet.has(m)).length;

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{
        padding: "8px 14px",
        borderBottom: "1px solid var(--line-soft)",
        background: "var(--ink-1)",
        display: "flex", gap: 14, alignItems: "center",
      }}>
        <MetaPair k="Deployed" v={fmtNum(deployTokens.length)} />
        <MetaPair k="Migrated" v={`${fmtNum(migratedCount)} (${deployTokens.length > 0 ? Math.round((migratedCount / deployTokens.length) * 100) : 0}%)`} />
      </div>
      <table className="table-cards" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{
            position: "sticky", top: 0, zIndex: 1,
            background: "var(--ink-1)",
            borderBottom: "1px solid var(--line-soft)",
          }}>
            <Th>Token</Th>
            <Th align="right">Status</Th>
          </tr>
        </thead>
        <tbody>
          {deployTokens.map((mint, i) => {
            const migrated = migrationSet.has(mint);
            return (
              <tr
                key={mint || i}
                style={{ cursor: "pointer", borderBottom: "1px dashed var(--line-soft)" }}
                onClick={() => onTokenClick(mint)}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ink-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Td label="Token">
                  <TokenIdentity
                    mint={mint}
                    showImage
                    compact
                    size="xs"
                    onOpen={onTokenClick}
                    chartToken={{ mint_address: mint, name: "", symbol: "", dex: "", created_at: "" }}
                  />
                </Td>
                <Td align="right" label="Status">
                  <span
                    className="mono"
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      padding: "2px 6px",
                      borderRadius: 3,
                      border: "1px solid var(--line-soft)",
                      color: migrated ? "var(--accent)" : "var(--paper-4)",
                      background: "rgba(255,255,255,0.04)",
                    }}
                  >
                    {migrated ? "Migrated" : "Deployed"}
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ───────── Header ───────── */

function Header({
  address,
  copied,
  onCopy,
  onClose,
}: {
  address: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  const labelInfo = useWalletLabel(address);
  return (
    <div style={{
      padding: "14px 18px",
      borderBottom: "1px solid var(--line-soft)",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: "linear-gradient(135deg, var(--ink-2), var(--ink-3, var(--ink-2)))",
        border: "1px solid var(--line-soft)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--paper-3)",
        flexShrink: 0,
      }}>
        {Icon.wallet ? Icon.wallet(16) : <span className="mono" style={{ fontSize: 11 }}>W</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span className="eyebrow">
          {labelInfo
            ? labelInfo.source === "watchlist" ? "Wallet · Watchlist" : "Wallet · Yours"
            : "Wallet"}
        </span>
        {labelInfo && (
          <span
            className="ellipsis"
            style={{
              fontSize: 13,
              color: "var(--paper)",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: labelInfo.source === "watchlist" ? "var(--amber)" : "var(--accent)",
                flexShrink: 0,
              }}
            />
            {labelInfo.label}
          </span>
        )}
        <Tooltip content={address ?? null} mono>
          <span
            className="mono ellipsis"
            style={{
              fontSize: labelInfo ? 11 : 13,
              color: labelInfo ? "var(--paper-3)" : "var(--paper)",
              letterSpacing: "0.02em",
            }}
          >
            {address ? shortAddr(address, 10) : ""}
          </span>
        </Tooltip>
      </div>
      <PillAction onClick={onCopy} title={copied ? "Copied" : "Copy address"}>
        {copied ? Icon.check(11) : Icon.copy(11)}
        <span>{copied ? "Copied" : "Copy"}</span>
      </PillAction>
      {address && (
        <PillAction as="a" href={explorerAccountUrl(address)} target="_blank" rel="noreferrer" title={`View on ${explorerName()}`}>
          {Icon.ext(10)}
          <span>{explorerName()}</span>
        </PillAction>
      )}
      <Tooltip content="Close">
      <button
        onClick={onClose}
        style={{
          padding: 7,
          color: "var(--paper-3)",
          background: "transparent",
          border: "1px solid var(--line-soft)",
          borderRadius: 6,
          cursor: "pointer",
          display: "inline-flex",
        }}
      >
        {Icon.close(12)}
      </button>
      </Tooltip>
    </div>
  );
}

function PillAction({
  children,
  onClick,
  title,
  as,
  href,
  target,
  rel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  as?: "a";
  href?: string;
  target?: string;
  rel?: string;
}) {
  const style: React.CSSProperties = {
    padding: "6px 10px",
    color: "var(--paper-2)",
    background: "var(--ink-2)",
    border: "1px solid var(--line-soft)",
    borderRadius: 6,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    cursor: "pointer",
  };
  if (as === "a") {
    return (
      <Tooltip content={title ?? null}>
        <a href={href} target={target} rel={rel} style={style}>
          {children}
        </a>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={title ?? null}>
      <button type="button" onClick={onClick} style={style}>
        {children}
      </button>
    </Tooltip>
  );
}

/* ───────── Stats row ───────── */

function StatsRow({
  loading,
  nativeSol,
  totalValueUsd,
  holdingsCount,
  pnlSol,
  pnlUsd,
  pnlPct,
  volumeSol,
  volumeUsd,
  tradeCount,
  buys,
  sells,
  winRate,
  winningTokens,
  uniqueTokens,
}: {
  loading: boolean;
  nativeSol: number;
  totalValueUsd: number;
  holdingsCount: number;
  pnlSol: number;
  pnlUsd: number;
  pnlPct: number | null | undefined;
  volumeSol: number;
  volumeUsd: number;
  tradeCount: number;
  buys: number;
  sells: number;
  winRate: number;
  winningTokens: number;
  uniqueTokens: number;
}) {
  const isPhone = useIsPhone();
  const pnlColor =
    pnlSol > 0 ? "var(--accent)" : pnlSol < 0 ? "var(--sell)" : "var(--paper-3)";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isPhone ? fluidColsFit(140) : "repeat(4, minmax(0, 1fr))",
      gap: 8,
      padding: "12px 14px",
      borderBottom: "1px solid var(--line-soft)",
      background: "var(--ink-0)",
    }}>
      <StatCard
        label="Balance"
        primary={<SolAmount>{fmtSol(nativeSol, nativeSol < 10 ? 3 : 2)}</SolAmount>}
        sub={`Portfolio ${fmtUsd(totalValueUsd)}`}
        hint={holdingsCount > 0 ? `${holdingsCount} token${holdingsCount === 1 ? "" : "s"}` : undefined}
        loading={loading}
      />
      <StatCard
        label={`Realized PnL · ${WINDOW_DAYS}d`}
        primary={
          <span style={{ color: pnlColor }}>
            <SolAmount>
              {pnlSol > 0 ? "+" : ""}
              {fmtSol(pnlSol, Math.abs(pnlSol) < 10 ? 3 : 2)}
            </SolAmount>
          </span>
        }
        sub={
          <span style={{ color: pnlColor }}>
            {pnlUsd > 0 ? "+" : ""}
            {fmtUsd(pnlUsd)}
          </span>
        }
        hint={pnlPct != null ? <Change v={pnlPct} /> : undefined}
        loading={loading}
      />
      <StatCard
        label={`Volume · ${WINDOW_DAYS}d`}
        primary={<SolAmount>{fmtSol(volumeSol, volumeSol < 10 ? 2 : 1)}</SolAmount>}
        sub={fmtUsd(volumeUsd)}
        hint={`${fmtNum(tradeCount)} trades`}
        loading={loading}
      />
      <StatCard
        label={`Win rate · ${WINDOW_DAYS}d`}
        primary={`${Math.round(winRate * 100)}%`}
        // The API reports tokens traded but not how many won, and buy/sell
        // counts only for some periods: show what is known, no made-up 0s.
        sub={winningTokens > 0 ? `${winningTokens}/${uniqueTokens} tokens` : `${uniqueTokens} tokens`}
        hint={buys + sells > 0 ? (
          <span>
            <span style={{ color: "var(--accent)" }}>{fmtNum(buys)}B</span>
            <span style={{ color: "var(--paper-4)" }}> · </span>
            <span style={{ color: "var(--sell)" }}>{fmtNum(sells)}S</span>
          </span>
        ) : undefined}
        loading={loading}
      />
    </div>
  );
}

function StatCard({
  label,
  primary,
  sub,
  hint,
  loading,
}: {
  label: string;
  primary: React.ReactNode;
  sub?: React.ReactNode;
  hint?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div style={{
      padding: "10px 12px",
      border: "1px solid var(--line-soft)",
      borderRadius: 8,
      background: "var(--ink-1)",
      display: "flex", flexDirection: "column", gap: 4,
      minWidth: 0,
    }}>
      <span className="mono" style={{
        fontSize: 9, color: "var(--paper-4)",
        letterSpacing: "0.1em", textTransform: "uppercase",
      }}>
        {label}
      </span>
      {loading ? (
        <div className="skeleton" style={{ height: 18, width: "70%", borderRadius: 3 }} />
      ) : (
        <span className="mono ellipsis" style={{
          fontSize: 16, color: "var(--paper)", fontWeight: 600, letterSpacing: "0.01em",
        }}>
          {primary}
        </span>
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        {sub && (
          <span className="mono" style={{ fontSize: 10, color: "var(--paper-3)" }}>
            {sub}
          </span>
        )}
        {hint && (
          <span className="mono" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.06em" }}>
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

/* ───────── Meta strip ───────── */

function MetaStrip({
  avgSol,
  largestSol,
  feesSol,
  pro,
  sniper,
  bundle,
  firstMs,
  lastMs,
}: {
  avgSol: number;
  largestSol: number;
  feesSol: number;
  pro: number;
  sniper: number;
  bundle: number;
  firstMs: number;
  lastMs: number;
}) {
  const items: { k: string; v: React.ReactNode }[] = [];
  if (avgSol > 0) items.push({ k: "Avg", v: <SolAmount>{fmtSol(avgSol, 3)}</SolAmount> });
  if (largestSol > 0) items.push({ k: "Largest", v: <SolAmount>{fmtSol(largestSol, 2)}</SolAmount> });
  if (feesSol > 0) items.push({ k: "Fees", v: <SolAmount>{fmtSol(feesSol, 3)}</SolAmount> });
  if (firstMs > 0) items.push({ k: "First", v: formatAge(firstMs) + " ago" });
  if (lastMs > 0) items.push({ k: "Last", v: formatAge(lastMs) + " ago" });

  return (
    <div style={{
      padding: "8px 14px",
      borderBottom: "1px solid var(--line-soft)",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      background: "var(--ink-1)",
    }}>
      {items.map((it) => (
        <MetaPair key={it.k} k={it.k} v={it.v} />
      ))}
      <div style={{ flex: 1 }} />
      {pro > 0 && <Flag label="Pro" count={pro} color="var(--paper)" />}
      {sniper > 0 && <Flag label="Sniper" count={sniper} color="var(--sell)" />}
      {bundle > 0 && <Flag label="Bundle" count={bundle} color="var(--warn)" />}
    </div>
  );
}

function MetaPair({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <span className="mono" style={{
      fontSize: 10, color: "var(--paper-3)",
      letterSpacing: "0.06em", display: "inline-flex", gap: 5,
    }}>
      <span style={{ color: "var(--paper-4)", textTransform: "uppercase" }}>{k}</span>
      <span>{v}</span>
    </span>
  );
}

function Flag({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span className="mono" style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 6px",
      fontSize: 9,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid var(--line-soft)",
      borderRadius: 3,
    }}>
      <span>{label}</span>
      <span style={{ opacity: 0.7 }}>{count}</span>
    </span>
  );
}

/* ───────── Tabs ───────── */

function SpotTabs({ tab, onChange }: { tab: SpotTab; onChange: (t: SpotTab) => void }) {
  const tabs: { id: SpotTab; label: string }[] = [
    { id: "holdings", label: "Holdings" },
    { id: "activity", label: "Activity" },
    { id: "deployed", label: "Deployed" },
  ];
  return (
    <div style={{
      display: "flex",
      borderBottom: "1px solid var(--line-soft)",
      padding: "0 10px",
      background: "var(--ink-1)",
    }}>
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="mono"
            style={{
              padding: "10px 14px",
              background: "transparent",
              border: 0,
              borderBottom: "2px solid " + (active ? "var(--paper)" : "transparent"),
              marginBottom: -1,
              color: active ? "var(--paper)" : "var(--paper-3)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ───────── Holdings list (rich, USD-sorted) ───────── */

function HoldingsList({
  loading,
  holdings,
  solPrice,
  onTokenClick,
}: {
  loading: boolean;
  holdings: ReturnType<typeof useWalletHoldings>["holdings"];
  solPrice: number;
  onTokenClick: (mint: string) => void;
}) {
  const rows = useMemo(() => {
    // Holdings can include the same mint twice when an account holds the
    // token across multiple ATAs / wrapped variants — fold duplicates so
    // the row keys (and the displayed totals) stay unique.
    const byMint = new Map<string, (typeof holdings)[number]>();
    let nextEmptyIdx = 0;
    for (const h of holdings) {
      if (h.isNative) continue;
      if ((h.usdValue ?? 0) <= 0 && (h.amount ?? 0) <= 0) continue;
      const key = h.mint || `__no-mint-${nextEmptyIdx++}`;
      const existing = byMint.get(key);
      if (!existing) {
        byMint.set(key, { ...h });
      } else {
        existing.amount = (existing.amount ?? 0) + (h.amount ?? 0);
        existing.usdValue = (existing.usdValue ?? 0) + (h.usdValue ?? 0);
      }
    }
    return [...byMint.values()].sort(
      (a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0),
    );
  }, [holdings]);

  const totalUsd = rows.reduce((s, h) => s + (h.usdValue ?? 0), 0);

  if (loading) {
    return (
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 36, borderRadius: 4 }} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={{
        padding: 32, textAlign: "center",
        color: "var(--paper-4)", fontSize: 11,
        fontFamily: "var(--font-mono)",
      }}>
        No token holdings.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <table className="table-cards" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{
            position: "sticky", top: 0, zIndex: 1,
            background: "var(--ink-1)",
            borderBottom: "1px solid var(--line-soft)",
          }}>
            <Th>Token</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Value</Th>
            <Th align="right">Share</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => {
            const usd = h.usdValue ?? 0;
            const share = totalUsd > 0 ? (usd / totalUsd) * 100 : 0;
            const solValue = solPrice > 0 ? usd / solPrice : 0;
            return (
              <tr
                key={h.mint || i}
                style={{ cursor: h.mint ? "pointer" : "default", borderBottom: "1px dashed var(--line-soft)" }}
                onClick={() => h.mint && onTokenClick(h.mint)}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ink-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Td label="Token">
                  <TokenIdentity
                    mint={h.mint}
                    symbol={h.symbol}
                    name={h.name}
                    image={h.image}
                    showImage
                    compact
                    size="xs"
                    onOpen={onTokenClick}
                    chartToken={{ mint_address: h.mint, name: h.name ?? "", symbol: h.symbol ?? "", dex: "", created_at: "" }}
                    chartSolPrice={solPrice}
                  />
                </Td>
                <Td align="right" mono label="Amount">{fmtTokenAmount(h.amount, h.decimals)}</Td>
                <Td align="right" label="Value">
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <span className="mono" style={{ color: "var(--paper)" }}>{fmtUsd(usd)}</span>
                    {solValue > 0 && (
                      <span className="mono" style={{ color: "var(--paper-4)", fontSize: 10 }}>
                        <SolAmount iconSize={10}>{fmtSol(solValue, solValue < 10 ? 3 : 2)}</SolAmount>
                      </span>
                    )}
                  </div>
                </Td>
                <Td align="right" mono label="Share">{fmtPct(share).replace("+", "")}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="mono"
      style={{
        textAlign: align ?? "left",
        padding: "8px 12px",
        fontSize: 9,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--paper-4)",
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  mono,
  label,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  label?: string;
}) {
  return (
    <td
      className={mono ? "mono" : undefined}
      data-label={label}
      style={{
        textAlign: align ?? "left",
        padding: "8px 12px",
        color: "var(--paper-2)",
      }}
    >
      {children}
    </td>
  );
}

function fmtTokenAmount(amount: number, decimals = 0): string {
  const n = decimals > 0 ? amount / 10 ** decimals : amount;
  if (!isFinite(n)) return "–";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(Math.min(4, Math.max(2, decimals)));
}

/* ───────── Perps tab ─────────
 * Three sources, all from the history crate's `/perp/wallets/{address}/*`
 * endpoints:
 *   - perp-pnl         → per-market volume / fees / size (gross PnL pending
 *                        in the upstream parser; today's `net_pnl_e6` is
 *                        just `-fees_paid_e6`)
 *   - perp-positions   → currently open positions (size, entry, collateral)
 *   - perp-liquidations → events where this wallet got liquidated
 */

interface PerpPnlRow {
  market_id: string;
  venue: string;
  long_size: number;
  short_size: number;
  volume_usd_e6: number;
  fees_paid_e6: number;
  gross_pnl_e6: number;
  net_pnl_e6: number;
  first_fill_ts: number;
  last_fill_ts: number;
}

const e6n = (n: number) => n / 1_000_000;
const fmtUsdCompact = (n: number): string => {
  if (!Number.isFinite(n)) return "–";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(2)}`;
};

function PerpsView({
  address,
  onMarketClick,
}: {
  address: string | null;
  onMarketClick?: (marketId: string) => void;
}) {
  const [pnl, setPnl] = useState<PerpPnlRow[]>([]);
  const [positions, setPositions] = useState<PerpPosition[]>([]);
  const [liquidations, setLiquidations] = useState<(PerpLiquidation & { market_id: string; venue: string })[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setPnl([]);
      setPositions([]);
      setLiquidations([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // The history handlers return `{success: false, error}` (no `data`)
    // when the SQL fails, so each branch needs an Array.isArray guard
    // — `.data` can be undefined on error, which would explode the
    // `for (const r of pnl)` walk in `totals`.
    Promise.all([
      fetchPerpWalletPnl(address)
        .then((r) => Array.isArray(r.data) ? (r.data as PerpPnlRow[]) : [])
        .catch(() => [] as PerpPnlRow[]),
      fetchPerpWalletPositions(address)
        .then((r) => Array.isArray(r.data) ? r.data : [])
        .catch(() => [] as PerpPosition[]),
      fetchPerpWalletLiquidations(address, 50)
        .then((r) => Array.isArray(r.data) ? r.data : [])
        .catch(() => [] as (PerpLiquidation & { market_id: string; venue: string })[]),
    ]).then(([p, pos, liq]) => {
      if (cancelled) return;
      setPnl(p);
      setPositions(pos);
      setLiquidations(liq);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [address]);

  const totals = useMemo(() => {
    let volume = 0, fees = 0, longSize = 0, shortSize = 0, firstTs = 0, lastTs = 0;
    for (const r of pnl) {
      volume += r.volume_usd_e6;
      fees += r.fees_paid_e6;
      longSize += r.long_size;
      shortSize += r.short_size;
      if (r.first_fill_ts && (!firstTs || r.first_fill_ts < firstTs)) firstTs = r.first_fill_ts;
      if (r.last_fill_ts > lastTs) lastTs = r.last_fill_ts;
    }
    return {
      volumeUsd: e6n(volume),
      feesUsd: e6n(fees),
      longSizeUsd: e6n(longSize),
      shortSizeUsd: e6n(shortSize),
      marketsTraded: pnl.length,
      openPositions: positions.length,
      liqCount: liquidations.length,
      firstTs,
      lastTs,
    };
  }, [pnl, positions, liquidations]);

  if (!address) return null;

  const empty = !loading && pnl.length === 0 && positions.length === 0 && liquidations.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "auto" }}>
      <PerpStatsRow loading={loading} totals={totals} />

      {empty ? (
        <div style={{
          padding: "32px 18px",
          color: "var(--paper-3)",
          fontSize: 12,
          textAlign: "center",
        }}>
          No perp activity from this wallet yet
        </div>
      ) : (
        <>
          {positions.length > 0 && (
            <PerpSection title="Open Positions">
              <PerpPositionsTable positions={positions} onMarketClick={onMarketClick} />
            </PerpSection>
          )}
          {pnl.length > 0 && (
            <PerpSection title="Per-Market Activity">
              <PerpPnlTable rows={pnl} onMarketClick={onMarketClick} />
            </PerpSection>
          )}
          {liquidations.length > 0 && (
            <PerpSection title="Liquidations">
              <PerpLiquidationsTable rows={liquidations} onMarketClick={onMarketClick} />
            </PerpSection>
          )}
        </>
      )}
    </div>
  );
}

function PerpStatsRow({
  loading,
  totals,
}: {
  loading: boolean;
  totals: {
    volumeUsd: number;
    feesUsd: number;
    longSizeUsd: number;
    shortSizeUsd: number;
    marketsTraded: number;
    openPositions: number;
    liqCount: number;
    firstTs: number;
    lastTs: number;
  };
}) {
  const isPhone = useIsPhone();
  const Cell = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) => (
    <div style={{
      flex: isPhone ? "1 1 45%" : 1,
      minWidth: 0,
      padding: "10px 14px",
      borderRight: "1px solid var(--line-soft)",
      display: "flex",
      flexDirection: "column",
      gap: 2,
    }}>
      <span className="eyebrow">{label}</span>
      <span style={{
        fontSize: 13,
        color: loading ? "var(--paper-4)" : "var(--paper)",
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
      }}>{loading ? "—" : value}</span>
      {hint != null && (
        <span style={{ fontSize: 10, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{hint}</span>
      )}
    </div>
  );

  const directional = totals.longSizeUsd + totals.shortSizeUsd;
  const longShare = directional > 0 ? totals.longSizeUsd / directional : 0;
  const lastSeen = totals.lastTs ? formatAge(totals.lastTs) : "—";

  return (
    <div style={{
      display: "flex",
      flexWrap: isPhone ? "wrap" : "nowrap",
      alignItems: "stretch",
      borderBottom: "1px solid var(--line-soft)",
      background: "var(--ink-1)",
    }}>
      <Cell label="Volume" value={fmtUsdCompact(totals.volumeUsd)} hint={`${totals.marketsTraded} market${totals.marketsTraded === 1 ? "" : "s"}`} />
      <Cell label="Fees Paid" value={fmtUsdCompact(totals.feesUsd)} />
      <Cell
        label="Long / Short"
        value={`${(longShare * 100).toFixed(0)}% / ${((1 - longShare) * 100).toFixed(0)}%`}
        hint={`${fmtUsdCompact(totals.longSizeUsd)} / ${fmtUsdCompact(totals.shortSizeUsd)}`}
      />
      <Cell
        label="Open Positions"
        value={totals.openPositions}
        hint={totals.liqCount ? `${totals.liqCount} liquidation${totals.liqCount === 1 ? "" : "s"}` : undefined}
      />
      <div style={{
        flex: isPhone ? "1 1 45%" : 1,
        minWidth: 0,
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}>
        <span className="eyebrow">Last Fill</span>
        <span style={{
          fontSize: 13,
          color: loading ? "var(--paper-4)" : "var(--paper)",
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
        }}>{loading ? "—" : lastSeen}</span>
      </div>
    </div>
  );
}

function PerpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", borderBottom: "1px solid var(--line-soft)" }}>
      <div style={{
        padding: "8px 14px",
        background: "var(--ink-1)",
        borderBottom: "1px solid var(--line-soft)",
      }}>
        <span className="eyebrow">{title}</span>
      </div>
      {children}
    </div>
  );
}

function marketLabel(market_id: string): string {
  return market_id.includes(":") ? market_id.split(":")[1] : market_id;
}

function MarketCell({
  marketId,
  onMarketClick,
}: {
  marketId: string;
  onMarketClick?: (marketId: string) => void;
}) {
  if (!onMarketClick) {
    return <span style={{ color: "var(--paper)" }}>{marketLabel(marketId)}</span>;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onMarketClick(marketId);
      }}
      style={{
        background: "transparent",
        border: 0,
        padding: 0,
        color: "var(--paper)",
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
        textDecoration: "underline dotted",
        textUnderlineOffset: 3,
      }}
    >
      {marketLabel(marketId)}
    </button>
  );
}

function PerpPositionsTable({
  positions,
  onMarketClick,
}: {
  positions: PerpPosition[];
  onMarketClick?: (marketId: string) => void;
}) {
  const livePrices = usePerpLivePrices(positions.map((p) => p.market_id));
  return (
    <table className="table-cards" style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <thead>
        <tr style={{ color: "var(--paper-4)", textAlign: "left", borderBottom: "1px solid var(--line-soft)" }}>
          <th style={{ padding: "6px 14px", fontWeight: 500 }}>Market</th>
          <th style={{ padding: "6px 14px", fontWeight: 500 }}>Side</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Size</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Entry</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Collateral</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>uPnL</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const sizeUsd = e6n(p.size);
          const entryUsd = e6n(p.entry_price);
          const upnl = liveUnrealizedPnl(
            p.side,
            sizeUsd,
            entryUsd,
            livePrices[p.market_id],
            e6n(p.unrealized_pnl),
          );
          const inProfit = upnl >= 0;
          return (
            <tr key={p.position_pubkey} style={{ borderBottom: "1px solid var(--line-soft)" }}>
              <td data-label="Market" style={{ padding: "6px 14px" }}>
                <MarketCell marketId={p.market_id} onMarketClick={onMarketClick} />
              </td>
              <td data-label="Side" style={{ padding: "6px 14px", color: p.side === "long" ? "var(--buy)" : "var(--sell)", fontWeight: 600, textTransform: "uppercase" }}>
                {p.side}
              </td>
              <td data-label="Size" style={{ padding: "6px 14px", textAlign: "right", color: "var(--paper-2)" }}>{fmtUsdCompact(sizeUsd)}</td>
              <td data-label="Entry" style={{ padding: "6px 14px", textAlign: "right", color: "var(--paper-2)" }}>{fmtUsd(entryUsd)}</td>
              <td data-label="Collateral" style={{ padding: "6px 14px", textAlign: "right", color: "var(--paper-3)" }}>{fmtUsdCompact(e6n(p.collateral))}</td>
              <td data-label="uPnL" style={{ padding: "6px 14px", textAlign: "right", color: inProfit ? "var(--buy)" : "var(--sell)", fontWeight: 600 }}>
                {fmtUsdCompact(upnl)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PerpPnlTable({
  rows,
  onMarketClick,
}: {
  rows: PerpPnlRow[];
  onMarketClick?: (marketId: string) => void;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.volume_usd_e6 - a.volume_usd_e6),
    [rows],
  );
  return (
    <table className="table-cards" style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <thead>
        <tr style={{ color: "var(--paper-4)", textAlign: "left", borderBottom: "1px solid var(--line-soft)" }}>
          <th style={{ padding: "6px 14px", fontWeight: 500 }}>Market</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Volume</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Long</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Short</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Fees</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Last</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={`${r.venue}:${r.market_id}`} style={{ borderBottom: "1px solid var(--line-soft)" }}>
            <td data-label="Market" style={{ padding: "6px 14px" }}>
              <MarketCell marketId={r.market_id} onMarketClick={onMarketClick} />
            </td>
            <td data-label="Volume" style={{ padding: "6px 14px", textAlign: "right", color: "var(--paper-2)" }}>{fmtUsdCompact(e6n(r.volume_usd_e6))}</td>
            <td data-label="Long" style={{ padding: "6px 14px", textAlign: "right", color: "var(--buy)" }}>{fmtUsdCompact(e6n(r.long_size))}</td>
            <td data-label="Short" style={{ padding: "6px 14px", textAlign: "right", color: "var(--sell)" }}>{fmtUsdCompact(e6n(r.short_size))}</td>
            <td data-label="Fees" style={{ padding: "6px 14px", textAlign: "right", color: "var(--paper-3)" }}>{fmtUsdCompact(e6n(r.fees_paid_e6))}</td>
            <td data-label="Last" style={{ padding: "6px 14px", textAlign: "right", color: "var(--paper-3)" }}>
              {r.last_fill_ts ? formatAge(r.last_fill_ts) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PerpLiquidationsTable({
  rows,
  onMarketClick,
}: {
  rows: (PerpLiquidation & { market_id: string; venue: string })[];
  onMarketClick?: (marketId: string) => void;
}) {
  return (
    <table className="table-cards" style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <thead>
        <tr style={{ color: "var(--paper-4)", textAlign: "left", borderBottom: "1px solid var(--line-soft)" }}>
          <th style={{ padding: "6px 14px", fontWeight: 500 }}>Time</th>
          <th style={{ padding: "6px 14px", fontWeight: 500 }}>Market</th>
          <th style={{ padding: "6px 14px", fontWeight: 500 }}>Side</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Size Closed</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Oracle Px</th>
          <th style={{ padding: "6px 14px", fontWeight: 500, textAlign: "right" }}>Tx</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.signature || `${l.position_pubkey}:${l.timestamp}`} style={{ borderBottom: "1px solid var(--line-soft)" }}>
            <td data-label="Time" style={{ padding: "6px 14px", color: "var(--paper-3)" }}>{l.timestamp ? formatAge(l.timestamp) : "—"}</td>
            <td data-label="Market" style={{ padding: "6px 14px" }}>
              <MarketCell marketId={l.market_id} onMarketClick={onMarketClick} />
            </td>
            <td data-label="Side" style={{ padding: "6px 14px", color: l.side === "long" ? "var(--buy)" : "var(--sell)", fontWeight: 600, textTransform: "uppercase" }}>
              {l.side}
            </td>
            <td data-label="Size Closed" style={{ padding: "6px 14px", textAlign: "right", color: "var(--paper-2)" }}>{fmtUsdCompact(e6n(l.size_closed))}</td>
            <td data-label="Oracle Px" style={{ padding: "6px 14px", textAlign: "right", color: "var(--paper-2)" }}>{fmtUsd(e6n(l.oracle_price))}</td>
            <td data-label="Tx" style={{ padding: "6px 14px", textAlign: "right" }}>
              {l.signature ? (
                <a
                  href={explorerTxUrl(l.signature)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--paper-4)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {Icon.ext(10)}
                </a>
              ) : (
                <span style={{ color: "var(--paper-4)" }}>—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
