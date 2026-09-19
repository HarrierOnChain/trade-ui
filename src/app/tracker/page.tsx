"use client";
/**
 * Tracker dashboard — watchlist-first redesign.
 *
 * Layout mirrors the automation + portfolio surfaces:
 *   • Hero (title + intent + primary actions)
 *   • KPI tiles (wallets / handles / live alerts / 1h volume)
 *   • Tab nav: Wallets · X Handles · Feed
 *
 * Watchlist roster lives in WATCHLIST_STORAGE_KEY (lib/trackerWallets).
 * Per-wallet display preferences (order/star/hidden/muted/notes) live
 * in `_components/preferences.ts` — orthogonal to the roster.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useClientNav } from "../../components/shell/ClientPages";

import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { clampWidth, fluidColsFit } from "../../lib/responsive";
import { Btn } from "../../components/atoms";
import { tokenHref } from "../../lib/tokenHref";
import { AddXHandleModal } from "../../components/XTrackerColumn/AddXHandleModal";
import { useApp } from "../../contexts/AppContext";
import { useRegion } from "../../contexts/RegionContext";
import {
  useTrackerStream,
  type TrackedWallet,
  type TrackerAlert,
} from "../../hooks/useTrackerStream";
import { useXTracker, useXTweetFeed } from "../../hooks/useXTracker";
import { useHiddenTokens } from "../../lib/hiddenTokens";
import {
  WATCHLIST_STORAGE_KEY,
  makeWatchlistId,
  readWatchlist,
  writeWatchlist,
} from "../../lib/trackerWallets";
import { fmtUsd, shortAddr } from "../../lib/format";

import { KpiTile, TabBar, PortfolioGlyph } from "../portfolio/_components/atoms";
import { useTrackerPrefs } from "./_components/preferences";
import { WalletsTab } from "./_components/WalletsTab";
import { XHandlesTab } from "./_components/XHandlesTab";
import { FeedTab } from "./_components/FeedTab";
import {
  TrackWalletModal, EditNoteModal, RemoveWalletModal,
} from "./_components/modals";

type Tab = "wallets" | "handles" | "feed";

/* ── Aggregation helpers ─────────────────────────────────────────────── */

interface WalletStat {
  lastTs: number | null;
  liveCount: number;
  buys: number;
  sells: number;
}

function buildWalletStats(alerts: TrackerAlert[], wallets: TrackedWallet[]): Map<string, WalletStat> {
  const out = new Map<string, WalletStat>();
  for (const w of wallets) out.set(w.id, { lastTs: null, liveCount: 0, buys: 0, sells: 0 });
  for (const a of alerts) {
    const s = out.get(a.walletId);
    if (!s) continue;
    s.lastTs = s.lastTs == null ? a.timestamp : Math.max(s.lastTs, a.timestamp);
    if (a.isNew) s.liveCount += 1;
    if (a.side === "buy") s.buys += 1;
    else s.sells += 1;
  }
  return out;
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function TrackerPage() {
  const { navigate } = useClientNav();
  const { pushToast } = useApp();
  const { region } = useRegion();

  const [watchlist, setWatchlist] = useState<TrackedWallet[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("wallets");

  const [trackOpen, setTrackOpen] = useState(false);
  const [addXOpen, setAddXOpen] = useState(false);
  const [editNoteFor, setEditNoteFor] = useState<TrackedWallet | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TrackedWallet | null>(null);

  const xTracker = useXTracker();
  const xUsernames = useMemo(
    () => xTracker.handles.map((h) => h.handle.username),
    [xTracker.handles],
  );
  const xFeed = useXTweetFeed(xUsernames);

  const prefs = useTrackerPrefs();

  // Hydrate + cross-tab sync.
  useEffect(() => {
    setWatchlist(readWatchlist());
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCHLIST_STORAGE_KEY) setWatchlist(readWatchlist());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => { if (hydrated) writeWatchlist(watchlist); }, [watchlist, hydrated]);

  const stream = useTrackerStream(watchlist, {
    maxAlerts: 250,
    seedLimit: 25,
    onLive: (a) => {
      // Honor mute preference — silence toasts for muted wallets but
      // keep their alerts in the feed.
      if (prefs.muted.has(a.walletId)) return;
      pushToast({
        title: a.side === "buy" ? "BUY ALERT" : "SELL ALERT",
        body: `${a.walletLabel} · ${shortAddr(a.tokenMint, 4)}`,
        tone: a.side === "buy" ? "buy" : "sell",
      });
    },
  });

  const { hiddenMints } = useHiddenTokens();

  // Alerts visible to the feed (hidden-token blocklist applied).
  const visibleAlerts = useMemo(
    () => stream.alerts.filter((a) => !hiddenMints.has(a.tokenMint)),
    [stream.alerts, hiddenMints],
  );

  // Per-wallet stats roll-up
  const walletStats = useMemo(
    () => buildWalletStats(visibleAlerts, watchlist),
    [visibleAlerts, watchlist],
  );

  // KPI totals
  const kpi = useMemo(() => {
    const now = Date.now();
    const cutoff60 = now - 60 * 60 * 1000;
    const lastHour = visibleAlerts.filter((a) => a.timestamp >= cutoff60);
    const buys = lastHour.filter((a) => a.side === "buy").length;
    const sells = lastHour.length - buys;
    const solBuy  = lastHour.filter((a) => a.side === "buy").reduce((s, a) => s + a.solAmount, 0);
    const solSell = lastHour.filter((a) => a.side === "sell").reduce((s, a) => s + a.solAmount, 0);
    const usdSum  = lastHour.reduce((s, a) => s + (a.usdValue ?? 0), 0);
    const uniqueTokens = new Set(lastHour.map((a) => a.tokenMint)).size;
    const liveCount = visibleAlerts.filter((a) => a.isNew).length;
    return { buys, sells, solBuy, solSell, usdSum, uniqueTokens, liveCount };
  }, [visibleAlerts]);

  /* ── Mutations ─────────────────────────────────────────────────────── */

  function addWatch(args: { address: string; label: string; note: string }) {
    if (watchlist.some((w) => w.address === args.address)) {
      pushToast({ title: "ALREADY TRACKED", body: shortAddr(args.address, 6), tone: "default" });
      return;
    }
    const w: TrackedWallet = {
      id: makeWatchlistId(),
      label: args.label || `Wallet ${watchlist.length + 1}`,
      address: args.address,
      source: "watchlist",
    };
    setWatchlist((prev) => [...prev, w]);
    if (args.note) prefs.setNote(w.id, args.note);
    pushToast({ title: "WALLET TRACKED", body: w.label, tone: "buy" });
    setTrackOpen(false);
  }

  function renameWatch(id: string, label: string) {
    setWatchlist((prev) =>
      prev.map((w) => (w.id === id ? { ...w, label: label.trim() || w.label } : w)),
    );
  }

  function removeWatch(w: TrackedWallet) {
    setWatchlist((prev) => prev.filter((x) => x.id !== w.id));
    prefs.clearNote(w.id);
    if (prefs.starred.has(w.id)) prefs.toggleStar(w.id);
    if (prefs.hidden.has(w.id))  prefs.toggleHidden(w.id);
    if (prefs.muted.has(w.id))   prefs.toggleMuted(w.id);
    pushToast({ title: "REMOVED FROM WATCHLIST", body: w.label, tone: "default" });
    setRemoveTarget(null);
  }

  async function copyAddr(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      pushToast({ title: "COPIED", body: shortAddr(addr, 6), tone: "buy" });
    } catch { /* ignore */ }
  }

  /* ── Render ────────────────────────────────────────────────────────── */

  const tabCounts: Record<Tab, number> = {
    wallets: watchlist.length,
    handles: xTracker.handles.length,
    feed: visibleAlerts.length + xFeed.tweets.length,
  };

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      padding: "20px 24px 36px", overflow: "auto",
      color: "var(--paper)", fontFamily: "var(--font-ui)",
      gap: 18,
    }}>
      <Hero
        watchedCount={watchlist.length}
        handlesCount={xTracker.handles.length}
        refreshing={stream.loading}
        onRefresh={stream.refresh}
        onTrack={() => setTrackOpen(true)}
        onTrackX={() => setAddXOpen(true)}
      />

      <KpiRow
        watched={watchlist.length}
        starred={prefs.starred.size}
        muted={prefs.muted.size}
        live={kpi.liveCount}
        buys={kpi.buys}
        sells={kpi.sells}
        usdLastHour={kpi.usdSum}
        solBuy={kpi.solBuy}
        solSell={kpi.solSell}
        handles={xTracker.handles.length}
        loading={stream.loading && watchlist.length > 0 && visibleAlerts.length === 0}
      />

      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "wallets", label: "Wallets",   count: tabCounts.wallets },
          { value: "handles", label: "X Handles", count: tabCounts.handles },
          { value: "feed",    label: "Feed",      count: tabCounts.feed },
        ]}
      />

      {tab === "wallets" && (
        <WalletsTab
          wallets={watchlist}
          stats={walletStats}
          loading={!hydrated}
          onRename={renameWatch}
          onAdd={() => setTrackOpen(true)}
          actions={{
            copyAddr,
            edit: (w) => setEditNoteFor(w),
            remove: (w) => setRemoveTarget(w),
          }}
        />
      )}

      {tab === "handles" && (
        <XHandlesTab
          handles={xTracker.handles}
          regionBaseUrl={region.baseUrl}
          loading={xTracker.loading}
          onAdd={() => setAddXOpen(true)}
          onRemove={(id) => { void xTracker.remove(id); }}
        />
      )}

      {tab === "feed" && (
        <FeedTab
          alerts={visibleAlerts}
          tweets={xFeed.tweets}
          xHandles={xTracker.handles}
          regionBaseUrl={region.baseUrl}
          wallets={watchlist}
          loading={stream.loading && visibleAlerts.length === 0}
          onTokenClick={(mint) => navigate(tokenHref(mint))}
        />
      )}

      {/* Modals */}
      <TrackWalletModal
        open={trackOpen}
        existing={watchlist}
        onClose={() => setTrackOpen(false)}
        onSubmit={addWatch}
      />
      <AddXHandleModal open={addXOpen} onClose={() => setAddXOpen(false)} />
      <EditNoteModal
        wallet={editNoteFor}
        currentNote={editNoteFor ? (prefs.notes[editNoteFor.id] ?? "") : ""}
        onClose={() => setEditNoteFor(null)}
        onSubmit={(note) => {
          if (editNoteFor) {
            if (note.trim()) prefs.setNote(editNoteFor.id, note);
            else prefs.clearNote(editNoteFor.id);
          }
          setEditNoteFor(null);
        }}
      />
      <RemoveWalletModal
        wallet={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onSubmit={() => { if (removeTarget) removeWatch(removeTarget); }}
      />

      {/* Sidebar error surface (kept lightweight) */}
      {stream.error && (
        <div style={{
          padding: "10px 12px", borderRadius: 8,
          background: "var(--sell-w)",
          border: "1px solid color-mix(in oklch, var(--sell) 40%, transparent)",
          color: "var(--sell)", fontSize: 12, lineHeight: 1.45,
        }}>{stream.error}</div>
      )}
    </div>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────── */

function Hero({
  watchedCount, handlesCount, refreshing, onRefresh, onTrack, onTrackX,
}: {
  watchedCount: number;
  handlesCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  onTrack: () => void;
  onTrackX: () => void;
}) {
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  return (
    <header style={{
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      alignItems: isMobile ? "flex-start" : "flex-end",
      justifyContent: "space-between",
      gap: 16, flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, width: isMobile ? "100%" : undefined }}>
        <span className="eyebrow" style={{ fontSize: 10 }}>Tracker</span>
        <h1 className="ser" style={{
          fontStyle: "italic", fontSize: isMobile ? clampWidth(20, 5.5, 38) : 38, lineHeight: 1, margin: 0,
          color: "var(--paper)", letterSpacing: "-0.015em", fontWeight: 400,
        }}>
          Watch them, <span style={{ color: "var(--accent)" }}>front-run</span> them.
        </h1>
        <p style={{
          fontSize: 12, color: "var(--paper-3)", margin: 0, maxWidth: isPhone ? "none" : 620, lineHeight: 1.5,
        }}>
          Tail any wallet&apos;s trades the moment they land. Tail any X handle&apos;s
          tweets the moment they post. Drag to reorder, mute the noisy ones,
          star the alpha, and let the feed surface everything that matters.
        </p>
        {(watchedCount > 0 || handlesCount > 0) && (
          <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {watchedCount} {watchedCount === 1 ? "wallet" : "wallets"}
            </span>
            <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {handlesCount} {handlesCount === 1 ? "handle" : "handles"}
            </span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: isMobile ? "100%" : undefined }}>
        <Btn size="sm" tone="ghost" onClick={onRefresh} disabled={refreshing} icon={PortfolioGlyph.refresh}>
          {refreshing ? "Syncing…" : "Refresh"}
        </Btn>
        <Btn size="sm" tone="ghost"   onClick={onTrackX}>+ X handle</Btn>
        <Btn size="sm" tone="primary" onClick={onTrack}>+ Track wallet</Btn>
      </div>
    </header>
  );
}

/* ── KPI row ─────────────────────────────────────────────────────────── */

function KpiRow({
  watched, starred, muted, live, buys, sells, usdLastHour, solBuy, solSell, handles, loading,
}: {
  watched: number;
  starred: number;
  muted: number;
  live: number;
  buys: number;
  sells: number;
  usdLastHour: number;
  solBuy: number;
  solSell: number;
  handles: number;
  loading: boolean;
}) {
  const isPhone = useIsPhone();
  const net = solBuy - solSell;
  return (
    <div style={
      isPhone
        ? { display: "grid", gridTemplateColumns: fluidColsFit(140), gap: 12 }
        : { display: "flex", gap: 12, flexWrap: "wrap" }
    }>
      <KpiTile
        label="Tracked wallets"
        value={watched.toString()}
        sub={
          starred + muted > 0
            ? `${starred} starred · ${muted} muted`
            : "all live"
        }
        tone="accent"
        glyph="◎"
        loading={loading && watched === 0}
      />
      <KpiTile
        label="Live alerts"
        value={live > 0 ? live.toString() : "—"}
        sub={live > 0 ? "in this session" : "waiting for fills"}
        tone={live > 0 ? "buy" : "neutral"}
        glyph="●"
      />
      <KpiTile
        label="Fills · 1h"
        value={
          buys + sells === 0
            ? "—"
            : `${buys + sells}`
        }
        sub={
          buys + sells === 0
            ? "no recent activity"
            : `${buys} buys · ${sells} sells`
        }
        tone={
          buys === sells ? "neutral" :
          buys > sells   ? "buy"     :
          "sell"
        }
        glyph={buys >= sells ? "↑" : "↓"}
      />
      <KpiTile
        label="Net flow · 1h"
        value={
          buys + sells === 0
            ? "—"
            : net === 0
            ? "Balanced"
            : `${net >= 0 ? "+" : "−"}${Math.abs(net).toFixed(2)} SOL`
        }
        sub={
          usdLastHour > 0 ? `${fmtUsd(usdLastHour)} routed` : "no volume yet"
        }
        tone={net === 0 ? "neutral" : net > 0 ? "buy" : "sell"}
      />
      <KpiTile
        label="X handles"
        value={handles.toString()}
        sub={handles > 0 ? "tweets interleaved" : "none tracked"}
        tone="gold"
        glyph="𝕏"
      />
    </div>
  );
}
