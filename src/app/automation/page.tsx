"use client";

// Automation dashboard — redesigned surface.
//
// Two-layer model:
//   • sniper (entries, snipe + copy unified) — pushed to N regional bots
//   • Backend ladders (autosell + autobuy) — evaluated per Position
//   • LimitOrders — pre-position price triggers (buy + sell)
//
// Gated on the user holding ≥1 PLATFORM wallet. The /automation/* routes
// 403 without one; we mirror the gate here for a clean empty state.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useBackend } from "../../api/backend";
import type {
  Sniper,
  Position,
  LimitOrder,
  WalletList,
} from "../../api/backend";
import { useApp } from "../../contexts/AppContext";
import { useUserWallets } from "../../hooks/useUserWallets";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { fluidCols } from "../../lib/responsive";
import { Btn } from "../../components/atoms";
import {
  PositionAutosellModal,
  PositionAutobuyModal,
  NewSniperModal,
  EditSniperModal,
  NewLimitOrderModal,
  ManageWalletListsModal,
} from "./_components/forms";
import {
  KIND_META, KpiTile, KindChip, StatusBadge, Tile, shortAddr,
  AUTO_LABEL, autoAddLabel,
} from "./_components/atoms";
import { AutomodePanel } from "./_components/automode";
import { AutoCleanPanel } from "./_components/autoClean";

type Tab = "snipers" | "positions" | "limits" | "lists" | "automode";

type AutomationData = {
  snipers: Sniper[];
  positions: Position[];
  limitOrders: LimitOrder[];
  walletLists: WalletList[];
  automodeCount: number;
};

export default function AutomationPage() {
  const client = useBackend();
  const { pushToast } = useApp();
  const { wallets } = useUserWallets();
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  const platformWallets = useMemo(
    () => wallets.filter((w) => w.kind === "PLATFORM"),
    [wallets],
  );

  const [data, setData] = useState<AutomationData>({
    snipers: [], positions: [], limitOrders: [], walletLists: [], automodeCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("snipers");
  const [newSniper, setNewSniper] = useState(false);
  const [editSniper, setEditSniper] = useState<Sniper | null>(null);
  const [newLimit, setNewLimit] = useState(false);
  const [manageLists, setManageLists] = useState(false);
  const [autosellPos, setAutosellPos] = useState<Position | null>(null);
  const [autobuyPos, setAutobuyPos] = useState<Position | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const [u, p, l, wl, am, vb] = await Promise.all([
        client.listSnipers().catch(() => ({ snipers: [] as Sniper[] })),
        client.listPositions({ reconcile: force }).catch(() => ({ positions: [] as Position[] })),
        client.listLimitOrders().catch(() => ({ limitOrders: [] as LimitOrder[] })),
        client.listWalletLists().catch(() => ({ walletLists: [] as WalletList[] })),
        client.listAutomode().catch(() => ({ sessions: [] })),
        client.listVolumeBots().catch(() => ({ sessions: [] })),
      ]);
      setData({
        snipers: u.snipers,
        positions: p.positions,
        limitOrders: l.limitOrders,
        walletLists: wl.walletLists,
        automodeCount: am.sessions.length + vb.sessions.length,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    if (platformWallets.length === 0) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh, platformWallets.length]);

  if (platformWallets.length === 0) {
    return <NoPlatformWalletState />;
  }

  const activeSnipers = data.snipers.filter((s) => s.status === "active").length;
  const pausedSnipers = data.snipers.filter((s) => s.status === "paused").length;
  const totalFires = data.snipers.reduce((acc, s) => acc + (s.fireCount ?? 0), 0);
  const activeLimits = data.limitOrders.filter((o) => o.status === "active").length;

  const tabCounts: Record<Tab, number> = {
    snipers: data.snipers.length,
    positions: data.positions.length,
    limits: activeLimits,
    lists: data.walletLists.length,
    automode: data.automodeCount,
  };

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      padding: isPhone ? "16px 12px 36px" : isMobile ? "16px 20px 32px" : "20px 24px 36px", overflow: "auto",
      color: "var(--paper)", fontFamily: "var(--font-ui)",
      gap: 18,
    }}>
      {/* ── Hero ───────────────────────────────────────────────── */}
      <header style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span className="eyebrow" style={{ fontSize: 10 }}>Automation</span>
          <h1 className="ser" style={{
            fontStyle: "italic", fontSize: isPhone ? 28 : 38, lineHeight: 1, margin: 0,
            color: "var(--paper)", letterSpacing: "-0.015em", fontWeight: 400,
          }}>
            Set it, <span style={{ color: "var(--accent)" }}>strike it.</span>
          </h1>
          <p style={{
            fontSize: 12, color: "var(--paper-3)", margin: 0, maxWidth: 620, lineHeight: 1.5,
          }}>
            Configure snipers that fan out to regional bots, attach ladder
            strategies to live positions, and queue limit orders that fire
            when mcap crosses your threshold.
          </p>
        </div>
        <div style={{
          display: "flex", gap: 8, flexWrap: "wrap",
          width: isPhone ? "100%" : undefined,
        }}>
          <Btn size="sm" onClick={() => void refresh(true)} disabled={refreshing} style={isPhone ? { flex: 1 } : undefined}>
            {refreshing ? "Reconciling…" : "↻ Refresh"}
          </Btn>
          <Btn size="sm" onClick={() => setManageLists(true)} style={isPhone ? { flex: 1 } : undefined}>Wallet lists</Btn>
          <Btn size="sm" tone="primary" onClick={() => setNewSniper(true)} style={isPhone ? { flex: 1 } : undefined}>{autoAddLabel("sniper")}</Btn>
          <Btn size="sm" tone="primary" onClick={() => setNewLimit(true)} style={isPhone ? { flex: 1 } : undefined}>{autoAddLabel("limit")}</Btn>
        </div>
      </header>

      {/* ── KPI tiles ──────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiTile
          label="Active snipers"
          value={loading ? "—" : activeSnipers}
          sub={pausedSnipers > 0 ? `${pausedSnipers} paused` : "all running"}
          tone="accent"
          glyph="◎"
        />
        <KpiTile
          label="Open Positions"
          value={loading ? "—" : data.positions.length}
          sub={data.positions.length === 0 ? "no bags" : "managed by engine"}
          tone="buy"
          glyph="↑"
        />
        <KpiTile
          label="Active Limits"
          value={loading ? "—" : activeLimits}
          sub={data.limitOrders.length > activeLimits ? `${data.limitOrders.length - activeLimits} filled/cancelled` : "armed"}
          tone="gold"
          glyph="✦"
        />
        <KpiTile
          label="Total Fires"
          value={loading ? "—" : totalFires.toLocaleString()}
          sub="lifetime · all snipers"
          tone="neutral"
          glyph="·"
        />
      </div>

      {/* ── Tab nav ───────────────────────────────────────────── */}
      <nav className={isMobile ? "scroll-x" : undefined} style={{
        display: "flex", gap: 0,
        borderBottom: "1px solid var(--line-soft)",
      }}>
        {([
          ["snipers", "snipers"],
          ["positions", "Positions"],
          ["limits", "Limit Orders"],
          ["lists", "Wallet Lists"],
          ["automode", "Automode"],
        ] as Array<[Tab, string]>).map(([key, label]) => {
          const on = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: isPhone ? "8px 12px 10px" : "10px 16px 12px",
                position: "relative",
                background: "transparent",
                color: on ? "var(--paper)" : "var(--paper-3)",
                border: "none",
                cursor: "pointer",
                fontSize: isPhone ? 11 : 13, fontWeight: on ? 600 : 500,
                fontFamily: "var(--font-ui)",
                letterSpacing: "-0.005em",
                flexShrink: isMobile ? 0 : undefined,
                whiteSpace: "nowrap",
                display: "inline-flex", alignItems: "center", gap: 7,
                transition: "color 120ms",
              }}
            >
              {label}
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "1px 7px", borderRadius: 999,
                background: on ? "var(--accent-w)" : "var(--ink-2)",
                color: on ? "var(--accent)" : "var(--paper-4)",
                fontSize: 10, fontFamily: "var(--font-mono)",
                fontWeight: 600,
              }}>{tabCounts[key]}</span>
              {on && (
                <span style={{
                  position: "absolute", bottom: -1, left: 0, right: 0,
                  height: 2, background: "var(--accent)",
                  borderRadius: "2px 2px 0 0",
                }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Tab body ──────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tab === "snipers" && (
          <SniperPanel
            rows={data.snipers}
            loading={loading}
            onChanged={() => refresh(false)}
            client={client}
            pushToast={pushToast}
            onEdit={setEditSniper}
            onCreate={() => setNewSniper(true)}
          />
        )}
        {tab === "positions" && (
          <PositionPanel
            rows={data.positions}
            loading={loading}
            onClose={async (p) => {
              try {
                await client.closePosition(p.id, 100);
                pushToast({ title: "POSITION CLOSED", body: p.symbol ?? p.mint.slice(0, 6), tone: "buy" });
                await refresh(false);
              } catch (e) {
                pushToast({ title: "CLOSE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
              }
            }}
            onEditAutosell={setAutosellPos}
            onEditAutobuy={setAutobuyPos}
          />
        )}
        {tab === "limits" && (
          <LimitPanel
            rows={data.limitOrders}
            loading={loading}
            onCancel={async (id) => {
              try {
                await client.cancelLimitOrder(id);
                await refresh(false);
              } catch (e) {
                pushToast({ title: "CANCEL FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
              }
            }}
            onCreate={() => setNewLimit(true)}
          />
        )}
        {tab === "lists" && (
          <WalletListsPanel
            rows={data.walletLists}
            loading={loading}
            onManage={() => setManageLists(true)}
          />
        )}
        {tab === "automode" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <AutomodePanel client={client} wallets={platformWallets} pushToast={pushToast} />
            <AutoCleanPanel client={client} wallets={platformWallets} pushToast={pushToast} />
          </div>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────── */}
      <ManageWalletListsModal
        open={manageLists}
        onClose={() => setManageLists(false)}
        onChanged={() => refresh(false)}
        walletLists={data.walletLists}
      />
      <NewSniperModal
        open={newSniper}
        onClose={() => setNewSniper(false)}
        onCreated={() => refresh(false)}
        walletLists={data.walletLists}
      />
      {editSniper && (
        <EditSniperModal
          sniper={editSniper}
          open
          onClose={() => setEditSniper(null)}
          onSaved={() => refresh(false)}
          walletLists={data.walletLists}
        />
      )}
      <NewLimitOrderModal
        open={newLimit}
        onClose={() => setNewLimit(false)}
        onCreated={() => refresh(false)}
      />
      {autosellPos && (
        <PositionAutosellModal
          position={autosellPos}
          open
          onClose={() => setAutosellPos(null)}
          onSaved={() => refresh(false)}
        />
      )}
      {autobuyPos && (
        <PositionAutobuyModal
          position={autobuyPos}
          open
          onClose={() => setAutobuyPos(null)}
          onSaved={() => refresh(false)}
        />
      )}
    </div>
  );
}

// ── Empty / no-wallet state ──────────────────────────────────────────

function NoPlatformWalletState() {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 40, gap: 18, color: "var(--paper)",
      fontFamily: "var(--font-ui)",
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: "50%",
        background: "var(--accent-w)",
        border: "1px solid color-mix(in oklch, var(--accent) 35%, transparent)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 38, color: "var(--accent)",
        fontFamily: "var(--font-dis)", fontStyle: "italic",
      }}>◎</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "center", maxWidth: 480 }}>
        <span className="eyebrow" style={{ fontSize: 10 }}>Automation</span>
        <h2 className="ser" style={{
          fontStyle: "italic", fontSize: 28, lineHeight: 1.1, margin: 0,
          color: "var(--paper)", letterSpacing: "-0.01em", fontWeight: 400,
        }}>
          Needs a platform wallet.
        </h2>
        <p style={{ fontSize: 13, color: "var(--paper-3)", lineHeight: 1.5, margin: 0 }}>
          The engine signs sells and ladder fills autonomously, which Phantom
          wallets cannot do. Create or import a platform wallet from the wallets
          panel to enable snipers, autosell, autobuy, and limit orders.
        </p>
      </div>
    </div>
  );
}

// ── sniper panel ────────────────────────────────────────────────────

function SniperPanel({
  rows, loading, onChanged, client, pushToast, onEdit, onCreate,
}: {
  rows: Sniper[];
  loading: boolean;
  onChanged: () => Promise<void>;
  client: ReturnType<typeof useBackend>;
  pushToast: ReturnType<typeof useApp>["pushToast"];
  onEdit: (s: Sniper) => void;
  onCreate: () => void;
}) {
  if (loading) return <SkeletonRows />;
  if (rows.length === 0) {
    return (
      <EmptyHero
        title="No snipers yet."
        body="Build a snipe + copy rule and we'll push it to up to 8 regional bots in parallel. First fire opens a position the engine then manages."
        cta={<Btn size="sm" tone="primary" onClick={onCreate}>Create first sniper</Btn>}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((s) => {
        const modes: string[] = [];
        if (s.snipeEnabled) modes.push("Snipe");
        if (s.copyEnabled) modes.push("Copy");
        const wallet = s.wallets[0]?.wallet;
        const isStopped = s.status === "stopped";
        return (
          <Tile key={s.id} accent={isStopped ? "var(--paper-4)" : "var(--accent)"}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 15, fontWeight: 600, color: "var(--paper)",
                    letterSpacing: "-0.005em",
                  }}>{s.name}</span>
                  <KindChip kind="SNIPER" size="xs" />
                  <StatusBadge status={s.status} />
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: "var(--paper-3)", fontFamily: "var(--font-mono)" }}>
                  <Meta label="Mode" value={modes.join(" + ") || "—"} />
                  <Meta label="Wallet" value={wallet ? (wallet.label ?? shortAddr(wallet.pubkey)) : "—"} mono />
                  <Meta label="Regions" value={s.regions.length === 0 ? "—" : s.regions.join(" · ").toUpperCase()} mono />
                  <Meta label="Fires" value={s.fireCount.toString()} tone={s.fireCount > 0 ? "buy" : undefined} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {!isStopped && (
                  <Btn size="xs" onClick={() => onEdit(s)}>Edit</Btn>
                )}
                {!isStopped && (
                  <Btn
                    size="xs"
                    onClick={async () => {
                      const next = s.status === "active" ? "paused" : "active";
                      try {
                        await client.updateSniper(s.id, { status: next });
                        await onChanged();
                      } catch (e) {
                        pushToast({ title: "UPDATE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
                      }
                    }}
                  >{s.status === "active" ? "Pause" : "Resume"}</Btn>
                )}
                {!isStopped && (
                  <Btn
                    size="xs" tone="sell"
                    onClick={async () => {
                      if (!confirm(`Stop ${s.name}? It can't be resumed afterwards.`)) return;
                      try {
                        await client.deleteSniper(s.id);
                        await onChanged();
                      } catch (e) {
                        pushToast({ title: "STOP FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
                      }
                    }}
                  >Stop</Btn>
                )}
                {isStopped && (
                  <Btn
                    size="xs"
                    onClick={async () => {
                      if (!confirm(`Delete ${s.name} permanently? Trade history stays; the rule row is removed.`)) return;
                      try {
                        await client.hardDeleteSniper(s.id);
                        await onChanged();
                      } catch (e) {
                        pushToast({ title: "DELETE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
                      }
                    }}
                  >Delete</Btn>
                )}
              </div>
            </div>
          </Tile>
        );
      })}
    </div>
  );
}

// ── Positions panel ──────────────────────────────────────────────────

function PositionPanel({
  rows, loading, onClose, onEditAutosell, onEditAutobuy,
}: {
  rows: Position[];
  loading: boolean;
  onClose: (p: Position) => void;
  onEditAutosell: (p: Position) => void;
  onEditAutobuy: (p: Position) => void;
}) {
  if (loading) return <SkeletonRows />;
  if (rows.length === 0) {
    return (
      <EmptyHero
        title="No open positions."
        body="Buy a token from the trading panel or fire a sniper. Once a bag opens you can attach autosell (TP/SL ladder) and autobuy (dip-buy + pyramid) strategies."
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((p) => (
        <Tile key={p.id} accent="var(--buy)">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--paper)" }}>
                  {p.symbol ?? shortAddr(p.mint)}
                </span>
                <span style={{
                  padding: "2px 7px", borderRadius: 999,
                  background: p.sniperId ? "var(--accent-w)" : "var(--ink-2)",
                  color: p.sniperId ? "var(--accent)" : "var(--paper-3)",
                  fontSize: 9, fontFamily: "var(--font-mono)",
                  letterSpacing: "0.05em", textTransform: "uppercase",
                  border: "1px solid var(--line-soft)",
                }}>
                  {p.sniperId ? "sniper" : "Manual / Limit"}
                </span>
              </div>
              <span style={{ fontSize: 10, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{p.mint}</span>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 4 }}>
                <BigStat label="Spent" value={`${p.totalBuySolSpent.toFixed(4)} ◎`} />
                <BigStat label="Tokens" value={p.totalTokens.toFixed(2)} />
                <BigStat label="Entry" value={p.entryPriceSol.toFixed(8)} sub="SOL/token" />
                <BigStat label="Wallet" value={p.wallet?.label ?? (p.wallet ? shortAddr(p.wallet.pubkey) : "—")} mono small />
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
              <Btn size="xs" onClick={() => onEditAutosell(p)}>↓ {AUTO_LABEL.autosell}</Btn>
              <Btn size="xs" onClick={() => onEditAutobuy(p)}>↑ {AUTO_LABEL.autobuy}</Btn>
              <Btn size="xs" tone="sell" onClick={() => onClose(p)}>Close 100%</Btn>
            </div>
          </div>
        </Tile>
      ))}
    </div>
  );
}

// ── Limit-order panel ────────────────────────────────────────────────

function LimitPanel({
  rows, loading, onCancel, onCreate,
}: {
  rows: LimitOrder[];
  loading: boolean;
  onCancel: (id: string) => void;
  onCreate: () => void;
}) {
  if (loading) return <SkeletonRows />;
  if (rows.length === 0) {
    return (
      <EmptyHero
        title="No limit orders."
        body="Queue a buy that fires when mcap dips below your trigger, or a sell that fires when it rises above. Both can run before a position exists."
        cta={<Btn size="sm" tone="primary" onClick={onCreate}>Create first limit</Btn>}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((o) => {
        const isBuy = o.side === "buy";
        return (
          <Tile key={o.id} accent={isBuy ? "var(--buy)" : "var(--sell)"}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 14, fontWeight: 600,
                    color: isBuy ? "var(--buy)" : "var(--sell)",
                    fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}>{o.side}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--paper)" }}>
                    {o.symbol ?? shortAddr(o.mint)}
                  </span>
                  <KindChip kind="LIMIT" size="xs" />
                  <StatusBadge status={o.status} />
                </div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 4 }}>
                  <BigStat
                    label={isBuy ? "Trigger MC (≤)" : "Trigger MC (≥)"}
                    value={`$${o.triggerMcapUsd.toLocaleString()}`}
                  />
                  <BigStat
                    label={isBuy ? "Buy" : "Sell"}
                    value={isBuy ? `${o.amount} ◎` : `${o.amount}%`}
                  />
                  <BigStat
                    label="Wallet"
                    value={o.wallet?.label ?? (o.wallet ? shortAddr(o.wallet.pubkey) : "—")}
                    mono small
                  />
                </div>
              </div>
              {o.status === "active" && (
                <Btn size="xs" tone="sell" onClick={() => onCancel(o.id)}>Cancel</Btn>
              )}
            </div>
          </Tile>
        );
      })}
    </div>
  );
}

// ── Wallet-lists panel ───────────────────────────────────────────────

function WalletListsPanel({
  rows, loading, onManage,
}: {
  rows: WalletList[];
  loading: boolean;
  onManage: () => void;
}) {
  if (loading) return <SkeletonRows />;
  if (rows.length === 0) {
    return (
      <EmptyHero
        title="No wallet lists yet."
        body="Wallet lists are reusable address sets that copy-buy snipers track. One list can power many snipers — edit the list and every sniper sees the change."
        cta={<Btn size="sm" tone="primary" onClick={onManage}>Create first list</Btn>}
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: fluidCols(280) }}>
      {rows.map((wl) => (
        <Tile key={wl.id} accent="var(--info)" onClick={onManage}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--paper)" }}>{wl.name}</span>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <BigStat label="Addresses" value={wl.entries.length.toString()} />
              <BigStat label="In use by" value={`${wl._count?.snipers ?? 0} sniper${(wl._count?.snipers ?? 0) === 1 ? "" : "s"}`} small />
            </div>
          </div>
        </Tile>
      ))}
    </div>
  );
}

// ── Tiny presentation primitives ─────────────────────────────────────

function Meta({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "buy" | "sell" }) {
  const color = tone === "buy" ? "var(--buy)" : tone === "sell" ? "var(--sell)" : "var(--paper-2)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{
        fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.06em",
        textTransform: "uppercase", fontFamily: "var(--font-mono)",
      }}>{label}</span>
      <span style={{
        fontSize: 11, color,
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        fontWeight: 500,
      }}>{value}</span>
    </span>
  );
}

function BigStat({
  label, value, sub, mono, small,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span className="eyebrow" style={{ fontSize: 9 }}>{label}</span>
      <span style={{
        fontSize: small ? 12 : 14,
        color: "var(--paper)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        fontWeight: 500,
        letterSpacing: "-0.005em",
        fontVariantNumeric: "tabular-nums",
      }}>{value}</span>
      {sub && <span style={{ fontSize: 9, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{sub}</span>}
    </div>
  );
}

function EmptyHero({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div style={{
      padding: "40px 32px", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center",
      background: "var(--ink-1)", border: "1px dashed var(--line-soft)",
      borderRadius: 12,
    }}>
      <h3 className="ser" style={{
        fontStyle: "italic", fontSize: 24, lineHeight: 1.1, margin: 0,
        color: "var(--paper)", letterSpacing: "-0.01em", fontWeight: 400,
      }}>{title}</h3>
      <p style={{ fontSize: 12, color: "var(--paper-3)", margin: 0, maxWidth: 480, lineHeight: 1.5 }}>{body}</p>
      {cta && <div style={{ marginTop: 6 }}>{cta}</div>}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton" style={{ height: 84, borderRadius: 12 }} />
      ))}
    </div>
  );
}

// Silence "unused" warnings if KIND_META is ever stripped.
void KIND_META;
