"use client";
/**
 * Portfolio — one combined view of everything you hold.
 *
 * Design intent (rewritten 2026-06): the dashboard is ALWAYS the sum of every
 * wallet you manage. There is no per-wallet "scope" selection — that used to
 * double as the global trading set and quietly re-scope the whole page, which
 * nobody could follow. The only switch is Live ↔ Demo (real money vs paper),
 * and it only appears when you actually own a demo wallet.
 *
 *   • Hero        — title + balance summary + realized-PnL chart
 *   • Mode toggle — Live / Demo (conditional)
 *   • Tabs        — Wallets · Holdings · Activity
 *
 * Trading scope (which wallets sign orders) lives in the top-bar wallet popup.
 * We only reflect it, read-only, as a "Trading" badge in the Wallets tab.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useClientNav } from "../../components/shell/ClientPages";
import { Btn } from "../../components/atoms";
import { useApp } from "../../contexts/AppContext";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { usePortfolioScope } from "../../hooks/usePortfolioScope";
import { useWalletSummaryBatch } from "../../hooks/useWalletSummaryBatch";
import { useTrackerStream, type TrackedWallet } from "../../hooks/useTrackerStream";
import { useUserWallets, type UserWallet, type BulkWalletResult } from "../../hooks/useUserWallets";
import { useBackend } from "../../api/backend";
import { type DemoWalletSummary } from "../../api/backend";
import { onDemoChanged } from "../../lib/demoEvents";
import { useHiddenTokens } from "../../lib/hiddenTokens";
import { shortAddr } from "../../lib/format";
import { tokenHref } from "../../lib/tokenHref";
import { findQuoteMint, isStableQuoteMint, stableQuoteMintAddresses } from "../../lib/quoteMints";
import type { Trade, TokenHolding } from "../../types";

import {
  TabBar, EmptyHero,
} from "./_components/atoms";
import { WalletsTab } from "./_components/WalletsTab";
import { HoldingsTab, ActivityTab } from "./_components/tabs";
import { SpotSummary } from "./_components/SpotSummary";
import { aggregateDemoScopes } from "./_components/demoScope";
import {
  CreateWalletModal, ImportWalletModal, CreateDemoWalletModal,
  RenameWalletModal, SendModal, ReceiveModal, BurnModal,
  ConsolidateModal, ClaimFeesModal, ExportKeyModal,
  FundModal,
  DeleteWalletModal, ResetDemoModal,
} from "./_components/modals";

/* ── Types ───────────────────────────────────────────────────────────── */

type Tab = "wallets" | "holdings" | "activity";

/* ── Page ────────────────────────────────────────────────────────────── */

/** The API's valuation of a holding, scaled to `amount` (the scope sums the
 *  same mint across wallets). Undefined when the API did not value it. */
function apiValueFor(md: TokenHolding | undefined, amount: number): number | undefined {
  if (md?.usdValue == null) return undefined;
  if (!(md.amount > 0)) return md.usdValue;
  return md.usdValue * (amount / md.amount);
}

export default function PortfolioPage() {
  const { navigate: clientNav } = useClientNav();
  const { pushToast } = useApp();
  const isMobile = useIsMobile();
  const solPrice = useSolPrice() ?? 0;
  const client = useBackend();

  const userWallets = useUserWallets();
  const {
    activeIds: tradingIds,   // read-only here — drives the "Trading" badge only
    setActive: setTradingWallets,
    balances: liveBalances,
  } = userWallets;

  // Modal + view state
  const [tab, setTab] = useState<Tab>("wallets");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [renameWallet, setRenameWallet] = useState<UserWallet | null>(null);
  const [sendWallet, setSendWallet] = useState<UserWallet | null>(null);
  const [receiveWallet, setReceiveWallet] = useState<UserWallet | null>(null);
  const [fundWallet, setFundWallet] = useState<UserWallet | null>(null);
  const [burnWallet, setBurnWallet] = useState<UserWallet | null>(null);
  const [consolidateWallet, setConsolidateWallet] = useState<UserWallet | null>(null);
  const [claimFeesWallet, setClaimFeesWallet] = useState<UserWallet | null>(null);
  const [exportKeyWallet, setExportKeyWallet] = useState<UserWallet | null>(null);
  const [deleteWallet, setDeleteWallet] = useState<UserWallet | null>(null);
  const [resetDemoWallet, setResetDemoWallet] = useState<UserWallet | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Portfolio surfaces managed wallets only. Phantom is the login identity
  // (shown in the TopBar), not a tradeable wallet here.
  const wallets: UserWallet[] = useMemo(
    () => userWallets.wallets.filter((w) => !w.isConnected),
    [userWallets.wallets],
  );
  const onChainWallets = useMemo(() => wallets.filter((w) => w.kind !== "DEMO"), [wallets]);
  const demoWallets = useMemo(() => wallets.filter((w) => w.kind === "DEMO"), [wallets]);
  const liveAddresses = useMemo(() => onChainWallets.map((w) => w.pubkey), [onChainWallets]);

  // Live ↔ Demo (paper) view. Demo is only reachable once the user owns a demo
  // wallet — the Hero mode toggle and the Wallets-tab "Demo" button both gate on
  // that. There is exactly one demo wallet per user (enforced backend-side), so
  // the Demo view is a single paper account, not an aggregate.
  const [usingDemo, setUsingDemo] = useState(false);

  // The "Demo" button is dual-purpose: with no paper wallet yet it opens the
  // create modal; once one exists it switches the dashboard into the Demo view.
  function openDemo() {
    if (demoWallets.length > 0) setUsingDemo(true);
    else setDemoOpen(true);
  }

  // If the demo wallet is deleted while we're viewing it, fall back to Live so
  // the dashboard never sits on an empty paper scope.
  useEffect(() => {
    if (usingDemo && demoWallets.length === 0) setUsingDemo(false);
  }, [usingDemo, demoWallets.length]);

  // 30-day window — covers the longest PnL/performance range we display
  const range = useMemo(() => {
    const now = Date.now();
    const from = now - 30 * 86_400 * 1000;
    return {
      fromMs: from, toMs: now,
      fromSec: Math.floor(from / 1000), toSec: Math.floor(now / 1000),
      resolution: "1d" as const,
    };
  }, []);

  // One-shot batch summary for every on-chain wallet
  const summary = useWalletSummaryBatch(
    liveAddresses,
    { from: range.fromMs, to: range.toMs },
    refreshTick,
  );
  const summaryByAddr = useMemo(() => {
    const m = new Map<string, (typeof summary.summaries)[number]>();
    for (const s of summary.summaries) m.set(s.address, s);
    return m;
  }, [summary.summaries]);

  /* ── Demo data — fetched for ALL demo wallets, then aggregated ──────── */

  const [demoSummaries, setDemoSummaries] = useState<Record<string, DemoWalletSummary>>({});
  const demoKey = useMemo(() => demoWallets.map((w) => w.id).join(","), [demoWallets]);
  useEffect(() => {
    if (demoWallets.length === 0) { setDemoSummaries({}); return; }
    let cancelled = false;
    const fetchAll = async () => {
      const entries = await Promise.all(
        demoWallets.map(async (w) => {
          try { return [w.id, await client.demoSummary(w.id)] as const; }
          catch { return null; }
        }),
      );
      if (cancelled) return;
      const map: Record<string, DemoWalletSummary> = {};
      for (const e of entries) if (e) map[e[0]] = e[1];
      setDemoSummaries(map);
    };
    void fetchAll();
    const off = onDemoChanged(() => { if (!cancelled) void fetchAll(); });
    const iv = setInterval(fetchAll, 8_000);
    return () => { cancelled = true; off(); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, demoKey, refreshTick]);

  const demoScope = useMemo(() => {
    if (demoWallets.length === 0) return null;
    const parts = demoWallets
      .map((w) => { const s = demoSummaries[w.id]; return s ? { summary: s, pubkey: w.pubkey } : null; })
      .filter((p): p is { summary: DemoWalletSummary; pubkey: string } => p != null);
    return parts.length ? aggregateDemoScopes(parts) : null;
  }, [demoWallets, demoSummaries]);
  const demoReady = demoScope != null;

  /* ── Live scope — always every on-chain wallet ─────────────────────── */

  const scope = usePortfolioScope(
    liveAddresses,
    { from: range.fromSec, to: range.toSec, resolution: range.resolution },
    refreshTick,
  );

  // Tracker stream — live alerts for every on-chain wallet
  const trackedWallets: TrackedWallet[] = useMemo(
    () => onChainWallets.map((w) => ({
      id: `user:${w.id}`,
      address: w.pubkey,
      label: w.displayLabel,
      source: "user" as const,
    })),
    [onChainWallets],
  );
  const stream = useTrackerStream(trackedWallets, {
    maxAlerts: 80,
    seedLimit: 0,
    onLive: (a) => {
      pushToast({
        title: a.side === "buy" ? "BUY ALERT" : "SELL ALERT",
        body: `${a.walletLabel} · ${shortAddr(a.tokenMint, 4)}`,
        tone: a.side === "buy" ? "buy" : "sell",
      });
    },
  });

  const { hiddenMints } = useHiddenTokens();

  const liveAlerts = useMemo(
    () => stream.alerts.filter((a) => !hiddenMints.has(a.tokenMint)),
    [stream.alerts, hiddenMints],
  );
  const visibleTrades = useMemo(
    () => scope.trades.filter((t) => !hiddenMints.has(t.tokenMint)),
    [scope.trades, hiddenMints],
  );

  // Stats roll-up across every on-chain wallet
  const stats = useMemo(() => {
    const holdings = scope.holdings.filter(
      (h) => !h.isNative && ((h.usdValue ?? 0) > 0 || h.amount > 0)
        && !hiddenMints.has(h.mint) && !isStableQuoteMint(h.mint),
    );
    const nativeSol = scope.walletSnapshots.reduce((s, w) => s + w.nativeSol, 0);
    const activeAddresses = scope.walletSnapshots.filter(
      (w) => w.holdingsCount > 0 || w.nativeSol > 0 || w.recentTrades > 0,
    ).length;

    let trades = 0, pnlUsd = 0, volumeUsd = 0;
    for (const a of liveAddresses) {
      const s = summaryByAddr.get(a);
      if (!s) continue;
      trades += s.totalTrades ?? 0;
      pnlUsd += s.realizedPnlUsd ?? 0;
      volumeUsd += s.totalVolumeUsd ?? 0;
    }
    return { holdings, nativeSol, activeAddresses, trades, pnlUsd, volumeUsd };
  }, [scope, summaryByAddr, liveAddresses, hiddenMints]);

  /* ── Effective (mode-aware) data feeding the dashboard ─────────────── */

  // Live token holdings, sourced from the stream-fed balance cache (current
  // on-chain amounts — the reliable source the Wallets tab uses) and enriched
  // with REST-scope metadata (symbol / name / image) when present. The REST
  // scope's holdings list often comes back empty even when wallets hold tokens,
  // which is what showed "0 tokens". usdValue is left unset so holdingUsd
  // reprices the live amount via liveMap.
  // Metadata (decimals / symbol / name / image) for live token amounts,
  // sourced from the REST scope when present. The stream-fed cache carries
  // only mint→amount, so we enrich from here. Shared by the aggregate
  // `liveHoldings` and the per-wallet `holdingsForWallet` the modals use.
  const holdingMeta = useMemo(
    () => new Map(scope.holdings.map((h) => [h.mint, h])),
    [scope.holdings],
  );

  const liveHoldings = useMemo<TokenHolding[]>(() => {
    const amounts = new Map<string, number>();
    for (const w of onChainWallets) {
      const toks = liveBalances[w.id]?.tokens;
      if (!toks) continue;
      for (const [m, amt] of Object.entries(toks)) {
        if (!(amt > 0) || hiddenMints.has(m)) continue;
        amounts.set(m, (amounts.get(m) ?? 0) + amt);
      }
    }
    return [...amounts.entries()].map(([m, amount]) => {
      const md = holdingMeta.get(m);
      return { mint: m, amount, decimals: md?.decimals ?? 0, symbol: md?.symbol, name: md?.name, image: md?.image, usdValue: apiValueFor(md, amount) };
    });
  }, [onChainWallets, liveBalances, hiddenMints, holdingMeta]);

  // Per-wallet live balances for the action modals. Receive / Withdraw /
  // Distribute / Consolidate / Burn each act on ONE specific wallet, so they
  // must reflect that wallet's balance — not the aggregate roll-up. Both pull
  // from the stream-fed cache (keyed by wallet id), the same reliable source
  // the wallet rows + KPIs read; the REST scope is frequently empty/stale.
  const solForWallet = useCallback(
    (w: UserWallet): number =>
      w.kind === "DEMO" ? (w.solBalance ?? 0) : (liveBalances[w.id]?.sol ?? 0),
    [liveBalances],
  );
  const holdingsForWallet = useCallback(
    (w: UserWallet): TokenHolding[] => {
      const toks = liveBalances[w.id]?.tokens;
      if (!toks) return [];
      const out: TokenHolding[] = [];
      for (const [mint, amount] of Object.entries(toks)) {
        if (!(amount > 0) || hiddenMints.has(mint)) continue;
        const md = holdingMeta.get(mint);
        out.push({ mint, amount, decimals: md?.decimals ?? 0, symbol: md?.symbol, name: md?.name, image: md?.image, usdValue: apiValueFor(md, amount) });
      }
      return out;
    },
    [liveBalances, hiddenMints, holdingMeta],
  );

  const effectiveHoldings = usingDemo ? (demoScope?.holdings ?? []) : liveHoldings;
  // USDC / USD1 are cash quotes — show in Available, not the holdings table or uPnL.
  const spotHoldings = useMemo(
    () => effectiveHoldings.filter((h) => !isStableQuoteMint(h.mint)),
    [effectiveHoldings],
  );
  const effectiveTrades = usingDemo ? (demoScope?.trades ?? []) : visibleTrades;

  // Live price map for tradable spot mints only (no stable-quote streaming).
  const spotMints = useMemo(() => spotHoldings.map((h) => h.mint), [spotHoldings]);
  const liveMap = useLiveTradePrices(spotMints);

  const holdingUsd = useCallback(
    (h: TokenHolding): number => {
      // The API's valuation wins, 0 included: it answers null when it does not
      // know, and a 0 is its verdict on an illiquid bag (a $3 pool whose last
      // dust print says $1.18/token priced one wallet's dust at $13.6M).
      if (h.usdValue != null) return h.usdValue;
      const lp = liveMap.get(h.mint)?.price ?? 0;
      return lp > 0 && solPrice > 0 ? lp * solPrice * h.amount : 0;
    },
    [liveMap, solPrice],
  );
  const liveValueUsd = useMemo(
    () => spotHoldings.reduce((s, h) => s + holdingUsd(h), 0),
    [spotHoldings, holdingUsd],
  );

  const usdcMint = findQuoteMint("USDC").mint!;
  const usd1Mint = findQuoteMint("USD1").mint!;
  const quoteBalances = useMemo(() => {
    if (usingDemo) {
      const usd1FromHoldings = (demoScope?.holdings ?? [])
        .find((h) => h.mint === usd1Mint)?.amount ?? 0;
      return {
        sol: demoScope?.solBalance ?? 0,
        usdc: demoScope?.usdcBalance ?? 0,
        usd1: usd1FromHoldings,
      };
    }
    let sol = 0;
    let usdc = 0;
    let usd1 = 0;
    for (const w of onChainWallets) {
      const b = liveBalances[w.id];
      if (!b) continue;
      sol += b.sol ?? 0;
      usdc += b.tokens?.[usdcMint] ?? 0;
      usd1 += b.tokens?.[usd1Mint] ?? 0;
    }
    return { sol, usdc, usd1 };
  }, [usingDemo, demoScope, onChainWallets, liveBalances, usdcMint, usd1Mint]);

  const stableCashUsd = quoteBalances.usdc + quoteBalances.usd1;

  // Spot unrealized PnL = tradable holdings mark-to-market − FIFO cost basis.
  // FIFO must use full trade history (no time window) — a windowed fetch only
  // sees recent buys and leaves unrealizedCostSol at 0 for older bags.
  const spotUnrealizedUsd = useMemo<number | null>(() => {
    if (usingDemo) return null;
    if (scope.loading && !scope.pnl) return null;
    const pnlData = scope.pnl?.data;
    if (!pnlData) return null;
    // No cost basis per token (the API reports none): unknown, not "+value".
    if (pnlData.tokens.length === 0) return null;
    if (solPrice <= 0) return null;

    const heldMints = new Set(spotHoldings.map((h) => h.mint));
    const stableMints = new Set(stableQuoteMintAddresses());
    const costSol = pnlData.tokens
      .filter((t) => !stableMints.has(t.mint) && heldMints.has(t.mint))
      .reduce((s, t) => s + t.unrealizedCostSol, 0);

    return liveValueUsd - costSol * solPrice;
  }, [usingDemo, scope.loading, scope.pnl, spotHoldings, liveValueUsd, solPrice]);

  /* ── KPI values ────────────────────────────────────────────────────── */

  // Native SOL across every on-chain wallet, sourced from the live balance
  // cache — the same stream-fed source the Wallets-tab rows use. The REST
  // portfolio scope frequently omits `summary.totalSolBalance`, which left both
  // this KPI and the live Portfolio value stuck at "—" even with SOL on hand.
  const cacheNativeSol = useMemo(
    () => onChainWallets.reduce((sum, w) => sum + (liveBalances[w.id]?.sol ?? 0), 0),
    [onChainWallets, liveBalances],
  );

  // Portfolio value = SOL + tradable tokens (stream-priced) + stables at face value.
  const totalValueUsd = usingDemo
    ? ((demoScope?.solBalance ?? 0) * solPrice + liveValueUsd + stableCashUsd)
    : (cacheNativeSol * solPrice + liveValueUsd + stableCashUsd);
  const pnlUsd = usingDemo ? ((demoScope?.realizedPnlSol ?? 0) * solPrice) : stats.pnlUsd;

  /* ── Actions ───────────────────────────────────────────────────────── */

  function refresh() {
    setRefreshTick((n) => n + 1);
    pushToast({ title: "REFRESHING", body: "Resyncing wallets", tone: "default" });
  }

  async function copyAddr(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      pushToast({ title: "COPIED", body: shortAddr(addr, 6), tone: "buy" });
    } catch { /* ignore */ }
  }

  async function handleRename(id: string, label: string) {
    try { await userWallets.rename(id, label); }
    catch (err) {
      pushToast({ title: "RENAME FAILED", body: err instanceof Error ? err.message : String(err), tone: "sell" });
      throw err;
    }
  }

  async function handleDelete() {
    if (!deleteWallet) return;
    const target = deleteWallet;
    try {
      await userWallets.remove(target.id);
      pushToast({ title: "WALLET REMOVED", body: target.displayLabel, tone: "default" });
      setDeleteWallet(null);
    } catch (err) {
      pushToast({ title: "REMOVE FAILED", body: err instanceof Error ? err.message : String(err), tone: "sell" });
    }
  }

  async function handleResetDemo() {
    if (!resetDemoWallet) return;
    try {
      await userWallets.resetDemo(resetDemoWallet.id);
      setResetDemoWallet(null);
    } catch (err) {
      pushToast({ title: "RESET FAILED", body: err instanceof Error ? err.message : String(err), tone: "sell" });
    }
  }

  async function handleCreate(
    label: string,
    count: number,
    onProgress: (done: number, total: number) => void,
  ) {
    const res = await userWallets.createPlatformBulk(count, { labelPrefix: label || undefined, onProgress });
    // Trade with the first new wallet; the modal owns closing (it may stay open
    // to show a partial-run summary).
    if (res.created[0]) setTradingWallets([res.created[0].id]);
    return res;
  }

  async function handleImport(
    entries: Array<{ secret: string; label?: string }>,
    onProgress: (done: number, total: number) => void,
  ) {
    const res = await userWallets.importPlatformBulk(entries, { onProgress });
    if (res.created[0]) setTradingWallets([res.created[0].id]);
    return res;
  }

  async function handleCreateDemo(args: { label?: string; initialSol: number; initialUsdc: number }) {
    const created = await userWallets.createDemo(args);
    setTradingWallets([created.id]); // make the new paper wallet the active trader
    setDemoOpen(false);
    setUsingDemo(true); // land straight in the Demo view with the new paper wallet
  }

  /* ── Render ────────────────────────────────────────────────────────── */

  const tabCounts: Record<Tab, number> = {
    wallets: (usingDemo ? demoWallets : onChainWallets).length,
    holdings: spotHoldings.length,
    activity: usingDemo ? effectiveTrades.length : visibleTrades.length + liveAlerts.length,
  };

  const modalCtx = {
    client,
    allWallets: wallets,
    solForWallet,
    holdingsForWallet,
    // Keyed by pubkey for ConsolidateModal (it looks balances up by address).
    // liveBalances is keyed by wallet id — index by w.id, not w.pubkey.
    balancesByAddr: Object.fromEntries(
      wallets.map((w) => [w.pubkey, liveBalances[w.id]?.sol ?? 0]),
    ),
    // Wallet cap, surfaced to the create/import modals for the "N of LIMIT used"
    // note and to pre-cap bulk quantity.
    walletLimit: userWallets.walletLimit,
    walletCount: userWallets.walletCount,
    walletsRemaining: userWallets.walletsRemaining,
  };
  const modalState = {
    createOpen, importOpen, demoOpen,
    renameWallet, sendWallet, receiveWallet, fundWallet, burnWallet,
    consolidateWallet, claimFeesWallet, exportKeyWallet,
    deleteWallet, resetDemoWallet,
  };
  const modalSetters = {
    setCreateOpen, setImportOpen, setDemoOpen,
    setRenameWallet, setSendWallet, setReceiveWallet, setFundWallet, setBurnWallet,
    setConsolidateWallet, setClaimFeesWallet, setExportKeyWallet,
    setDeleteWallet, setResetDemoWallet,
  };
  const modalHandlers = {
    handleCreate, handleImport, handleCreateDemo,
    handleRename: async (label: string) => {
      if (!renameWallet) return;
      await handleRename(renameWallet.id, label);
      setRenameWallet(null);
    },
    handleDelete, handleResetDemo,
  };

  const pageStyle: React.CSSProperties = {
    flex: 1, display: "flex", flexDirection: "column",
    padding: isMobile ? "var(--pad-y) var(--pad-x)" : "20px 24px 36px",
    overflow: "hidden", minHeight: 0,
    color: "var(--paper)", fontFamily: "var(--font-ui)", gap: isMobile ? 12 : 18,
  };
  // Fixed header (Hero/KPI/Tabs) + this block scroll region for the active tab.
  // MUST stay a plain block (not a flex column): the tab cards use
  // overflow:hidden → scroll-container flex items with min-height:auto→0, which
  // a flex parent would shrink+clip. As a block they keep natural height and
  // overflow into this region's scroll. The Wallets balance panel is pinned
  // separately via position:sticky inside its card.
  const tabBodyStyle: React.CSSProperties = {
    flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
    display: "block",
  };

  // First-run / no wallets at all
  if (!userWallets.loading && wallets.length === 0) {
    return (
      <div style={pageStyle}>
        <Hero />
        <EmptyHero
          title="Set up your first wallet."
          body="Platform wallets are managed by Raze — they sign automatically for ladders, snipers and limit orders. Import an existing keypair, or try a demo wallet to paper-trade with live prices. (Phantom is your connect identity, shown in the top bar.)"
          icon="◎"
          cta={
            <>
              <Btn size="sm" tone="primary" onClick={() => setCreateOpen(true)}>+ Create wallet</Btn>
              <Btn size="sm" tone="ghost"   onClick={() => setImportOpen(true)}>Import keypair</Btn>
              <Btn size="sm" tone="ghost"   onClick={() => setDemoOpen(true)}>Try demo wallet</Btn>
            </>
          }
        />
        <Modals state={modalState} setters={modalSetters} handlers={modalHandlers} ctx={modalCtx} />
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <SpotSummary
        addresses={liveAddresses}
        solPrice={solPrice}
        refreshKey={refreshTick}
        totalValueUsd={totalValueUsd}
        unrealizedUsd={spotUnrealizedUsd}
        quoteBalances={quoteBalances}
        usingDemo={usingDemo}
        modeControl={
          demoWallets.length > 0 ? (
            <ModeToggle
              value={usingDemo ? "demo" : "live"}
              onChange={(m) => setUsingDemo(m === "demo")}
            />
          ) : (
            <DemoCreateButton onClick={openDemo} />
          )
        }
      />

      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "wallets",  label: "Wallets",  count: tabCounts.wallets },
          { value: "holdings", label: "Holdings", count: tabCounts.holdings },
          { value: "activity", label: "Activity", count: tabCounts.activity },
        ]}
      />

      <div style={tabBodyStyle}>
      {tab === "wallets" && (
        <WalletsTab
          // Demo view lists the paper wallet (so it can be reset/managed); Live
          // view lists the on-chain wallets.
          wallets={usingDemo ? demoWallets : onChainWallets}
          tradingIds={tradingIds}
          summaryByAddr={summaryByAddr}
          liveBalances={liveBalances}
          solPrice={solPrice}
          loading={userWallets.loading}
          onRename={handleRename}
          onCreate={() => setCreateOpen(true)}
          onImport={() => setImportOpen(true)}
          onCreateDemo={openDemo}
          actions={{
            send: setSendWallet,
            receive: setReceiveWallet,
            fund: setFundWallet,
            burn: setBurnWallet,
            consolidate: setConsolidateWallet,
            claimFees: setClaimFeesWallet,
            exportKey: setExportKeyWallet,
            rename: setRenameWallet,
            delete: setDeleteWallet,
            resetDemo: setResetDemoWallet,
            copyAddr,
          }}
        />
      )}

      {tab === "holdings" && (
        <div style={{ flexShrink: 0 }}>
          <HoldingsTab
            holdings={spotHoldings}
            liveMap={liveMap}
            loading={usingDemo ? !demoReady : (scope.loading && !scope.holdings.length)}
            onTokenClick={(mint) => clientNav(tokenHref(mint))}
          />
        </div>
      )}

      {tab === "activity" && (
        <div style={{ flexShrink: 0 }}>
          <ActivityTab
            trades={effectiveTrades}
            liveAlerts={usingDemo ? [] : liveAlerts}
            solPrice={solPrice}
            loading={
              usingDemo
                ? !demoReady
                : (scope.loading && !visibleTrades.length && liveAlerts.length === 0)
            }
            onTokenClick={(mint) => clientNav(tokenHref(mint))}
          />
        </div>
      )}
      </div>

      <Modals state={modalState} setters={modalSetters} handlers={modalHandlers} ctx={modalCtx} />
    </div>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────── */

function Hero({ modeControl }: { modeControl?: React.ReactNode }) {
  const isPhone = useIsPhone();
  return (
    <header style={{
      display: "flex", alignItems: "flex-end", justifyContent: "space-between",
      gap: 16, flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <span className="eyebrow" style={{ fontSize: 10 }}>Portfolio</span>
        <h1 className="ser" style={{
          fontStyle: "italic", fontSize: isPhone ? 28 : 38, lineHeight: 1, margin: 0,
          color: "var(--paper)", letterSpacing: "-0.015em", fontWeight: 400,
        }}>
          Everything you hold, <span style={{ color: "var(--accent)" }}>in one place</span>.
        </h1>
        <p style={{
          fontSize: 12, color: "var(--paper-3)", margin: 0,
          maxWidth: 620, lineHeight: 1.5,
        }}>
          Balances, holdings and trades across every wallet you manage.
        </p>
      </div>
      {modeControl}
    </header>
  );
}

/* ── Live / Demo mode toggle ─────────────────────────────────────────── */

function DemoCreateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Create a paper-trading wallet"
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 14px", borderRadius: 999,
        background: "var(--ink-2)", border: "1px solid var(--line-soft)",
        cursor: "pointer",
        fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
        fontFamily: "var(--font-mono)", color: "var(--gold)",
        transition: "background 120ms, border-color 120ms, color 120ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "color-mix(in oklch, var(--gold) 12%, var(--ink-2))";
        e.currentTarget.style.borderColor = "color-mix(in oklch, var(--gold) 35%, var(--line-soft))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--ink-2)";
        e.currentTarget.style.borderColor = "var(--line-soft)";
      }}
    >
      <span style={{ fontSize: 12, lineHeight: 1 }}>+</span>
      Demo
    </button>
  );
}

function ModeToggle({
  value, onChange,
}: {
  value: "live" | "demo";
  onChange: (m: "live" | "demo") => void;
}) {
  const opts: Array<{ key: "live" | "demo"; label: string; accent: string }> = [
    { key: "live", label: "Live", accent: "var(--accent)" },
    { key: "demo", label: "Demo", accent: "var(--gold)" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Portfolio mode"
      style={{
        display: "inline-flex", gap: 3, padding: 3, borderRadius: 999,
        background: "var(--ink-2)", border: "1px solid var(--line-soft)",
      }}
    >
      {opts.map((o) => {
        const on = value === o.key;
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            title={o.key === "demo" ? "Paper-trading view — simulated fills against live prices" : "Real on-chain wallets"}
            style={{
              padding: "4px 16px", borderRadius: 999, border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
              background: on ? o.accent : "transparent",
              color: on ? "var(--ink-0)" : "var(--paper-4)",
              transition: "background 120ms, color 120ms",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Modal aggregator (declutters the orchestrator) ──────────────────── */

function Modals({
  state, setters, handlers, ctx,
}: {
  state: {
    createOpen: boolean; importOpen: boolean; demoOpen: boolean;
    renameWallet: UserWallet | null;
    sendWallet: UserWallet | null;
    receiveWallet: UserWallet | null;
    fundWallet: UserWallet | null;
    burnWallet: UserWallet | null;
    consolidateWallet: UserWallet | null;
    claimFeesWallet: UserWallet | null;
    exportKeyWallet: UserWallet | null;
    deleteWallet: UserWallet | null;
    resetDemoWallet: UserWallet | null;
  };
  setters: {
    setCreateOpen: (b: boolean) => void;
    setImportOpen: (b: boolean) => void;
    setDemoOpen: (b: boolean) => void;
    setRenameWallet: (w: UserWallet | null) => void;
    setSendWallet: (w: UserWallet | null) => void;
    setReceiveWallet: (w: UserWallet | null) => void;
    setFundWallet: (w: UserWallet | null) => void;
    setBurnWallet: (w: UserWallet | null) => void;
    setConsolidateWallet: (w: UserWallet | null) => void;
    setClaimFeesWallet: (w: UserWallet | null) => void;
    setExportKeyWallet: (w: UserWallet | null) => void;
    setDeleteWallet: (w: UserWallet | null) => void;
    setResetDemoWallet: (w: UserWallet | null) => void;
  };
  handlers: {
    handleCreate: (label: string, count: number, onProgress: (done: number, total: number) => void) => Promise<BulkWalletResult>;
    handleImport: (entries: Array<{ secret: string; label?: string }>, onProgress: (done: number, total: number) => void) => Promise<BulkWalletResult>;
    handleCreateDemo: (args: { label?: string; initialSol: number; initialUsdc: number }) => Promise<void>;
    handleRename: (label: string) => Promise<void>;
    handleDelete: () => Promise<void>;
    handleResetDemo: () => Promise<void>;
  };
  ctx: {
    client: ReturnType<typeof useBackend>;
    allWallets: UserWallet[];
    solForWallet: (w: UserWallet) => number;
    holdingsForWallet: (w: UserWallet) => TokenHolding[];
    balancesByAddr: Record<string, number>;
    walletLimit: number;
    walletCount: number;
    walletsRemaining: number;
  };
}) {
  return (
    <>
      <CreateWalletModal
        open={state.createOpen}
        onClose={() => setters.setCreateOpen(false)}
        onSubmit={handlers.handleCreate}
        limit={ctx.walletLimit}
        used={ctx.walletCount}
        remaining={ctx.walletsRemaining}
      />
      <ImportWalletModal
        open={state.importOpen}
        onClose={() => setters.setImportOpen(false)}
        onSubmit={handlers.handleImport}
        limit={ctx.walletLimit}
        used={ctx.walletCount}
        remaining={ctx.walletsRemaining}
      />
      <CreateDemoWalletModal
        open={state.demoOpen}
        onClose={() => setters.setDemoOpen(false)}
        onSubmit={handlers.handleCreateDemo}
      />
      <RenameWalletModal
        wallet={state.renameWallet}
        onClose={() => setters.setRenameWallet(null)}
        onSubmit={handlers.handleRename}
      />
      <SendModal
        wallet={state.sendWallet}
        holdings={state.sendWallet ? ctx.holdingsForWallet(state.sendWallet) : []}
        allWallets={ctx.allWallets}
        nativeBal={state.sendWallet ? ctx.solForWallet(state.sendWallet) : 0}
        client={ctx.client}
        onClose={() => setters.setSendWallet(null)}
      />
      <ReceiveModal
        wallet={state.receiveWallet}
        nativeBal={state.receiveWallet ? ctx.solForWallet(state.receiveWallet) : 0}
        onClose={() => setters.setReceiveWallet(null)}
      />
      <FundModal
        wallet={state.fundWallet}
        allWallets={ctx.allWallets}
        client={ctx.client}
        onClose={() => setters.setFundWallet(null)}
      />
      <BurnModal
        wallet={state.burnWallet}
        holdings={state.burnWallet ? ctx.holdingsForWallet(state.burnWallet) : []}
        client={ctx.client}
        onClose={() => setters.setBurnWallet(null)}
      />
      <ConsolidateModal
        wallet={state.consolidateWallet}
        allWallets={ctx.allWallets}
        balancesByAddr={ctx.balancesByAddr}
        client={ctx.client}
        onClose={() => setters.setConsolidateWallet(null)}
      />
      <ClaimFeesModal
        wallet={state.claimFeesWallet}
        client={ctx.client}
        onClose={() => setters.setClaimFeesWallet(null)}
      />
      <ExportKeyModal
        wallet={state.exportKeyWallet}
        client={ctx.client}
        onClose={() => setters.setExportKeyWallet(null)}
      />
      <DeleteWalletModal
        wallet={state.deleteWallet}
        onClose={() => setters.setDeleteWallet(null)}
        onSubmit={handlers.handleDelete}
      />
      <ResetDemoModal
        wallet={state.resetDemoWallet}
        onClose={() => setters.setResetDemoWallet(null)}
        onSubmit={handlers.handleResetDemo}
      />
    </>
  );
}
