"use client";
import React, { useEffect, useMemo, useState } from "react";
import { tokenHref } from "../../lib/tokenHref";
import { explorerAccountUrl, explorerName } from "../../lib/chains";
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
import { fetchSignerCounts } from "../../api/client";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { fluidColsFit } from "../../lib/responsive";

const WINDOW_DAYS = 30;

type SpotTab = "holdings" | "activity" | "deployed";

export function WalletModal() {
  const { navigate } = useClientNav();
  const { walletModalAddress, closeWalletModal, pushToast } = useApp();
  const solPrice = useSolPrice();
  const [copied, setCopied] = useState(false);
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

  return (
    <Modal open={open} onClose={closeWalletModal} width={1040} align="top" mobileVariant={isMobile ? "sheet" : "center"}>
      <Header
        address={address ?? ""}
        copied={copied}
        onCopy={copy}
        onClose={closeWalletModal}
      />

      <div style={{
        flex: 1,
        minHeight: isMobile ? 0 : 320,
        maxHeight: isMobile ? "none" : "62vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        <SpotView
          address={address}
          solPrice={solPrice ?? 0}
          tab={spotTab}
          onTabChange={setSpotTab}
          onTokenClick={goToken}
        />
      </div>
    </Modal>
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
  // fetchWalletSummary takes unix seconds (it picks the API's 30d period).
  const window = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return { from: now - WINDOW_DAYS * 86_400, to: now };
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

  const lastTradeAt = stats?.lastTradeAt ? Date.parse(stats.lastTradeAt) : 0;

  return (
    <>
      <StatsRow
        loading={statsLoading || holdingsLoading}
        nativeSol={nativeSol}
        totalValueUsd={totalValueUsd}
        holdingsCount={holdings.filter((h) => !h.isNative && (h.usdValue ?? 0) > 0).length}
        pnlSol={stats?.realizedPnlSol ?? null}
        pnlUsd={stats?.realizedPnlUsd ?? null}
        pnlPct={stats?.realizedPnlPct ?? null}
        volumeSol={stats?.totalVolumeSol ?? null}
        volumeUsd={stats?.totalVolumeUsd ?? null}
        tradeCount={stats?.totalTrades ?? null}
        buys={stats?.totalBuys ?? null}
        sells={stats?.totalSells ?? null}
        winRate={stats?.winRate ?? null}
        uniqueTokens={stats?.uniqueTokensTraded ?? null}
      />

      <MetaStrip
        avgSol={stats?.avgTradeSizeSol ?? 0}
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
          {labelInfo ? "Wallet · Yours" : "Wallet"}
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
                background: "var(--accent)",
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
  uniqueTokens,
}: {
  loading: boolean;
  nativeSol: number;
  totalValueUsd: number;
  holdingsCount: number;
  pnlSol: number | null;
  pnlUsd: number | null;
  pnlPct: number | null | undefined;
  volumeSol: number | null;
  volumeUsd: number | null;
  tradeCount: number | null;
  buys: number | null;
  sells: number | null;
  winRate: number | null;
  uniqueTokens: number | null;
}) {
  const isPhone = useIsPhone();
  // Null: the API measured nothing for the period ("—", never a made-up 0).
  const pnlColor =
    pnlSol == null ? "var(--paper-3)" :
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
        primary={pnlSol == null ? "—" : (
          <span style={{ color: pnlColor }}>
            <SolAmount>
              {pnlSol > 0 ? "+" : ""}
              {fmtSol(pnlSol, Math.abs(pnlSol) < 10 ? 3 : 2)}
            </SolAmount>
          </span>
        )}
        sub={pnlUsd == null ? undefined : (
          <span style={{ color: pnlColor }}>
            {pnlUsd > 0 ? "+" : ""}
            {fmtUsd(pnlUsd)}
          </span>
        )}
        hint={pnlPct != null ? <Change v={pnlPct} /> : undefined}
        loading={loading}
      />
      <StatCard
        label={`Volume · ${WINDOW_DAYS}d`}
        primary={volumeSol == null ? "—" : <SolAmount>{fmtSol(volumeSol, volumeSol < 10 ? 2 : 1)}</SolAmount>}
        sub={volumeUsd == null ? undefined : fmtUsd(volumeUsd)}
        hint={`${fmtNum(tradeCount)} trades`}
        loading={loading}
      />
      <StatCard
        label={`Win rate · ${WINDOW_DAYS}d`}
        primary={winRate == null ? "—" : `${Math.round(winRate * 100)}%`}
        // Show what the API measured, no made-up 0s.
        sub={`${uniqueTokens ?? "—"} tokens`}
        hint={buys != null && sells != null && buys + sells > 0 ? (
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
  lastMs,
}: {
  avgSol: number;
  lastMs: number;
}) {
  const items: { k: string; v: React.ReactNode }[] = [];
  if (avgSol > 0) items.push({ k: "Avg", v: <SolAmount>{fmtSol(avgSol, 3)}</SolAmount> });
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
