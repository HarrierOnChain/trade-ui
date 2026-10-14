"use client";
/**
 * Portfolio — the wallets of this Trade UI and everything they hold, on one
 * page (it took over the Wallets page on 2026-10-11).
 *
 *   • Overview — value, cash and realized PnL of the wallets in view
 *   • Wallets  — every wallet in the vault: its value on this chain, the
 *                trading switch, its actions (send, export, rename, delete),
 *                new and imported keys, and the vault's lock
 *   • Tabs     — Holdings · Activity of the wallets in view
 *
 * "In view" is every wallet on this chain, or the one the wallet column
 * focuses. Focus is a view kept on this page only: it never changes which
 * wallets trade (the trading switch does, here and in the top-bar popup), and
 * the trading switch never changes the view.
 *
 * Wide (≥ 960px of page): wallets in a column beside the tabs, each part
 * scrolling on its own. Narrow: one scrolling page, wallets as a third tab.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useClientNav, useClientSearchParams } from "../../components/shell/ClientPages";
import { lockNow } from "../../components/shell/LockGate";
import { Btn, Icon } from "../../components/atoms";
import { useApp } from "../../contexts/AppContext";
import { useChain } from "../../contexts/ChainContext";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { usePortfolioScope } from "../../hooks/usePortfolioScope";
import { useWalletTradeStream, type StreamWallet } from "../../hooks/useWalletTradeStream";
import { useUserWallets, type UserWallet } from "../../hooks/useUserWallets";
import { useHiddenTokens } from "../../lib/hiddenTokens";
import { nativeSymbol } from "../../lib/chains";
import { shortAddr } from "../../lib/format";
import { tokenHref } from "../../lib/tokenHref";
import { quoteMints } from "../../lib/quoteMints";
import { familyOf } from "../../api/vaultWallets";
import {
  WALLETS_EVENT, auth, cachedWallets, vault,
  type ImportResult, type RuntimeConfig, type VaultWallet,
} from "../../lib/vault/client";
import type { TokenHolding } from "../../types";

import { TabBar, EmptyHero } from "./_components/atoms";
import { HoldingsTab, ActivityTab, type WalletTag } from "./_components/tabs";
import { Overview, type CashLine, type ViewScope } from "./_components/Overview";
import { WalletRail, type RailWallet, type WalletActions } from "./_components/WalletRail";
import { LegacyBanner } from "./_components/LegacyBanner";
import {
  DeleteModal, ExportModal, ImportModal, NewWalletModal, RenameModal, SecurityModal, SendModal,
} from "./_components/walletModals";

type Tab = "holdings" | "activity" | "wallets";

const WIDE_PX = 960;

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** The API's valuation of a holding, scaled to `amount` (the scope sums the
 *  same mint across wallets). Undefined when the API did not value it. */
function apiValueFor(md: TokenHolding | undefined, amount: number): number | undefined {
  if (md?.usdValue == null) return undefined;
  if (!(md.amount > 0)) return md.usdValue;
  return md.usdValue * (amount / md.amount);
}

/** Same words as the wallet provider's label for an unnamed wallet. */
function labelOf(w: VaultWallet): string {
  return w.label || `Wallet ${w.address.slice(0, 4)}`;
}

/** Every wallet in the vault, both families, kept in step with the server. */
function useVaultWallets(): { list: VaultWallet[]; loaded: boolean } {
  const [list, setList] = useState<VaultWallet[]>(() => cachedWallets());
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const sync = () => { setList(cachedWallets()); setLoaded(true); };
    window.addEventListener(WALLETS_EVENT, sync);
    vault.list().catch(() => {}).finally(() => setLoaded(true));
    return () => window.removeEventListener(WALLETS_EVENT, sync);
  }, []);
  return { list, loaded };
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The element's own width, followed as it resizes. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function PortfolioPage() {
  const { navigate: clientNav } = useClientNav();
  const params = useClientSearchParams();
  const { pushToast } = useApp();
  const { chainId } = useChain();
  const isPhone = useIsPhone();
  const [pageRef, pageWidth] = useWidth<HTMLDivElement>();
  // A hidden page measures 0: keep the last real layout.
  const [wide, setWide] = useState(true);
  useEffect(() => { if (pageWidth > 0) setWide(pageWidth >= WIDE_PX); }, [pageWidth]);

  const family = familyOf(chainId);
  const native = nativeSymbol(chainId);
  const nativePrice = useSolPrice() ?? 0;

  const userWallets = useUserWallets();
  const { wallets, balances, activeIds } = userWallets;
  const { list: vaultList, loaded: vaultLoaded } = useVaultWallets();

  const [tab, setTab] = useState<Tab>("holdings");
  useEffect(() => { if (wide && tab === "wallets") setTab("holdings"); }, [wide, tab]);

  /* ── Focus: every wallet, or one ───────────────────────────────────── */

  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = useMemo(() => (focusId ? wallets.find((w) => w.id === focusId) ?? null : null), [focusId, wallets]);
  // A deleted wallet, or a chain of the other family, ends the focus.
  useEffect(() => {
    if (focusId && !userWallets.loading && !focus) setFocusId(null);
  }, [focusId, focus, userWallets.loading]);
  const inView: UserWallet[] = useMemo(() => (focus ? [focus] : wallets), [focus, wallets]);

  const addrKey = useCallback((a: string) => (family === "evm" ? a.toLowerCase() : a), [family]);
  const avatarIndex = useMemo(() => new Map(vaultList.map((w, i) => [w.id, i])), [vaultList]);
  const vaultById = useMemo(() => new Map(vaultList.map((w) => [w.id, w])), [vaultList]);
  const tagByAddress = useMemo(() => new Map<string, WalletTag>(
    wallets.map((w) => [addrKey(w.pubkey), { label: w.displayLabel, avatarIndex: avatarIndex.get(w.id) ?? 0 }]),
  ), [wallets, avatarIndex, addrKey]);

  /* ── Market data for every wallet on this chain ────────────────────── */

  const allAddresses = useMemo(() => wallets.map((w) => w.pubkey), [wallets]);
  const scope = usePortfolioScope(allAddresses);

  // Live trades of every wallet, with a toast for each fill.
  const streamWallets: StreamWallet[] = useMemo(
    () => wallets.map((w) => ({ id: `user:${w.id}`, address: w.pubkey, label: w.displayLabel })),
    [wallets],
  );
  const stream = useWalletTradeStream(streamWallets, {
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

  // Token metadata (symbol / name / image / the API's valuation) from the REST
  // scope; amounts come from the live balance cache, the reliable source.
  const holdingMeta = useMemo(() => new Map(scope.holdings.map((h) => [h.mint, h])), [scope.holdings]);

  // USDC / USD1 are cash: in the overview's cash line, never a holding.
  const stables = useMemo(() => quoteMints(chainId).filter((q) => q.mint != null), [chainId]);
  const stableSet = useMemo(() => new Set(stables.map((q) => q.mint as string)), [stables]);

  // Live prices for every spot mint any wallet holds (each wallet's value).
  const spotKey = useMemo(() => {
    const mints = new Set<string>();
    for (const w of wallets) {
      for (const [m, amt] of Object.entries(balances[w.id]?.tokens ?? {})) {
        if (amt > 0 && !hiddenMints.has(m) && !stableSet.has(m)) mints.add(m);
      }
    }
    return [...mints].sort().join(",");
  }, [wallets, balances, hiddenMints, stableSet]);
  const spotMints = useMemo(() => (spotKey ? spotKey.split(",") : []), [spotKey]);
  const liveMap = useLiveTradePrices(spotMints);

  const tokenUsd = useCallback((mint: string, amount: number): number => {
    // The API's valuation wins, 0 included: it answers null when it does not
    // know, and a 0 is its verdict on an illiquid bag (a $3 pool whose last
    // dust print says $1.18/token priced one wallet's dust at $13.6M).
    const api = apiValueFor(holdingMeta.get(mint), amount);
    if (api != null) return api;
    const lp = liveMap.get(mint)?.price ?? 0;
    return lp > 0 && nativePrice > 0 ? lp * nativePrice * amount : 0;
  }, [holdingMeta, liveMap, nativePrice]);

  /* ── What each wallet is worth ─────────────────────────────────────── */

  const sums = useMemo(() => {
    const out = new Map<string, { native: number; valueUsd: number; known: boolean; stable: Record<string, number> }>();
    for (const w of wallets) {
      const b = balances[w.id];
      let tokens = 0;
      const stable: Record<string, number> = {};
      for (const [mint, amt] of Object.entries(b?.tokens ?? {})) {
        if (!(amt > 0)) continue;
        if (stableSet.has(mint)) { stable[mint] = amt; tokens += amt; continue; }
        if (hiddenMints.has(mint)) continue;
        tokens += tokenUsd(mint, amt);
      }
      const nat = b?.sol ?? 0;
      out.set(w.id, { native: nat, valueUsd: nat * nativePrice + tokens, known: (b?.updatedAt ?? 0) > 0, stable });
    }
    return out;
  }, [wallets, balances, stableSet, hiddenMints, tokenUsd, nativePrice]);

  const allTotal = useMemo(() => wallets.reduce((s, w) => s + (sums.get(w.id)?.valueUsd ?? 0), 0), [wallets, sums]);
  const allNative = useMemo(() => wallets.reduce((s, w) => s + (sums.get(w.id)?.native ?? 0), 0), [wallets, sums]);
  const balancesLoading = wallets.length > 0 && wallets.every((w) => !sums.get(w.id)?.known);
  const viewLoading = inView.length > 0 && inView.some((w) => !sums.get(w.id)?.known);

  const viewTotal = useMemo(() => inView.reduce((s, w) => s + (sums.get(w.id)?.valueUsd ?? 0), 0), [inView, sums]);
  const cash = useMemo<CashLine[]>(() => [
    { label: native, amount: inView.reduce((s, w) => s + (sums.get(w.id)?.native ?? 0), 0), stable: false },
    ...stables.map((q) => ({
      label: q.label,
      amount: inView.reduce((s, w) => s + (sums.get(w.id)?.stable[q.mint as string] ?? 0), 0),
      stable: true,
    })),
  ], [native, inView, sums, stables]);

  /* ── Holdings and activity of the wallets in view ──────────────────── */

  const { viewHoldings, holders } = useMemo(() => {
    const amounts = new Map<string, number>();
    const owners = new Map<string, WalletTag[]>();
    for (const w of inView) {
      for (const [m, amt] of Object.entries(balances[w.id]?.tokens ?? {})) {
        if (!(amt > 0) || hiddenMints.has(m) || stableSet.has(m)) continue;
        amounts.set(m, (amounts.get(m) ?? 0) + amt);
        const tag = tagByAddress.get(addrKey(w.pubkey));
        if (tag) owners.set(m, [...(owners.get(m) ?? []), tag]);
      }
    }
    const list: TokenHolding[] = [...amounts.entries()].map(([m, amount]) => {
      const md = holdingMeta.get(m);
      return { mint: m, amount, decimals: md?.decimals ?? 0, symbol: md?.symbol, name: md?.name, image: md?.image, usdValue: apiValueFor(md, amount) };
    });
    return { viewHoldings: list, holders: owners };
  }, [inView, balances, hiddenMints, stableSet, holdingMeta, tagByAddress, addrKey]);

  const inViewAddrs = useMemo(() => new Set(inView.map((w) => addrKey(w.pubkey))), [inView, addrKey]);
  const inViewStreamIds = useMemo(() => new Set(inView.map((w) => `user:${w.id}`)), [inView]);
  const liveAlerts = useMemo(
    () => stream.alerts.filter((a) => !hiddenMints.has(a.tokenMint) && inViewStreamIds.has(a.walletId)),
    [stream.alerts, hiddenMints, inViewStreamIds],
  );
  const visibleTrades = useMemo(
    () => scope.trades.filter((t) => !hiddenMints.has(t.tokenMint) && inViewAddrs.has(addrKey(t.signer))),
    [scope.trades, hiddenMints, inViewAddrs, addrKey],
  );
  const several = inView.length > 1;
  const walletOf = useCallback((signer: string) => tagByAddress.get(addrKey(signer)), [tagByAddress, addrKey]);

  /* ── Wallet column ─────────────────────────────────────────────────── */

  const railRows = useMemo<RailWallet[]>(() => wallets.map((w) => {
    const s = sums.get(w.id);
    const known = !!s?.known;
    return {
      wallet: vaultById.get(w.id) ?? { id: w.id, family, address: w.pubkey, label: w.label, createdAt: w.createdAt },
      label: w.displayLabel,
      avatarIndex: avatarIndex.get(w.id) ?? 0,
      native: known ? s!.native : null,
      valueUsd: known ? s!.valueUsd : null,
      trading: activeIds.has(w.id),
    };
  }), [wallets, sums, activeIds, vaultById, family, avatarIndex]);

  const otherRows = useMemo<RailWallet[]>(() => vaultList
    .filter((w) => w.family !== family)
    .map((w) => ({
      wallet: w, label: labelOf(w), avatarIndex: avatarIndex.get(w.id) ?? 0,
      native: null, valueUsd: null, trading: false,
    })), [vaultList, family, avatarIndex]);

  /* ── Wallet actions and dialogs ────────────────────────────────────── */

  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [exportW, setExportW] = useState<VaultWallet | null>(null);
  const [sendW, setSendW] = useState<VaultWallet | null>(null);
  const [renameW, setRenameW] = useState<VaultWallet | null>(null);
  const [deleteW, setDeleteW] = useState<VaultWallet | null>(null);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);

  useEffect(() => {
    auth.config().then(setConfig).catch(() => {});
  }, []);

  // `/portfolio?security=1` (the top bar's "Wallets & security") opens the
  // vault's settings, then the address goes back to plain /portfolio.
  useEffect(() => {
    if (params.get("security") == null) return;
    setSecurityOpen(true);
    window.history.replaceState(window.history.state, "", "/portfolio");
  }, [params]);

  // After creating or importing the first keys of this chain, trade with them.
  const adopt = useCallback((created: VaultWallet[]) => {
    const keys = created.filter((w) => w.family === family);
    if (keys.length > 0 && userWallets.activeIds.size === 0) userWallets.setActive([keys[0].id]);
  }, [family, userWallets]);
  const onImported = useCallback((r: ImportResult) => adopt(r.created), [adopt]);

  const actions = useMemo<WalletActions>(() => ({
    onCopy: (address) => {
      navigator.clipboard.writeText(address)
        .then(() => pushToast({ title: "ADDRESS COPIED", body: shortAddr(address, 6), tone: "success", duration: 2200 }))
        .catch(() => {});
    },
    onSend: setSendW,
    onExport: setExportW,
    onRename: setRenameW,
    onDelete: setDeleteW,
    onToggleTrading: userWallets.toggleActive,
  }), [pushToast, userWallets.toggleActive]);

  // Stable: the export dialog's two-minute auto-close restarts when it changes.
  const closeExport = useCallback(() => setExportW(null), []);

  const sendBalance = sendW && sendW.family === "sol" && family === "sol"
    ? (sums.get(sendW.id)?.known ? sums.get(sendW.id)!.native : null)
    : null;

  /* ── Render ────────────────────────────────────────────────────────── */

  const noWallets = vaultLoaded && vaultList.length === 0;
  const viewScope: ViewScope = focus
    ? { kind: "wallet", label: focus.displayLabel, avatarIndex: avatarIndex.get(focus.id) ?? 0 }
    : { kind: "all" };

  const pageStyle: React.CSSProperties = wide
    ? {
      flex: 1, minHeight: 0, overflow: "hidden",
      display: "flex", flexDirection: "column", gap: 32,
      padding: "28px 32px 20px",
      color: "var(--paper)", fontFamily: "var(--font-ui)",
    }
    : {
      flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
      display: "flex", flexDirection: "column", gap: 20,
      padding: "var(--pad-y) var(--pad-x) 32px",
      color: "var(--paper)", fontFamily: "var(--font-ui)",
    };

  const rail = (scroll: boolean) => (
    <WalletRail
      rows={railRows}
      others={otherRows}
      family={family}
      chainId={chainId}
      native={native}
      totalUsd={allTotal}
      totalNative={allNative}
      loading={(userWallets.loading && wallets.length === 0) || balancesLoading}
      focusId={focus?.id ?? null}
      onFocus={setFocusId}
      actions={actions}
      onNew={() => setNewOpen(true)}
      onImport={() => setImportOpen(true)}
      config={config}
      onSecurity={() => setSecurityOpen(true)}
      onLock={() => void lockNow()}
      scroll={scroll}
    />
  );

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: "holdings", label: "Holdings", count: viewHoldings.length },
    { value: "activity", label: "Activity", count: visibleTrades.length + liveAlerts.length },
    ...(!wide ? [{ value: "wallets" as const, label: "Wallets", count: wallets.length }] : []),
  ];

  const tabBar = <TabBar value={tab} onChange={setTab} tabs={tabs} />;

  const tabBody = (
    <>
      {tab === "holdings" && (
        <HoldingsTab
          holdings={viewHoldings}
          liveMap={liveMap}
          loading={viewLoading || (scope.loading && !scope.holdings.length)}
          native={native}
          holders={several ? holders : undefined}
          onTokenClick={(mint) => clientNav(tokenHref(mint))}
        />
      )}
      {tab === "activity" && (
        <ActivityTab
          trades={visibleTrades}
          liveAlerts={liveAlerts}
          solPrice={nativePrice}
          loading={scope.loading && !visibleTrades.length && liveAlerts.length === 0}
          walletOf={several ? walletOf : undefined}
          onTokenClick={(mint) => clientNav(tokenHref(mint))}
        />
      )}
    </>
  );

  return (
    <div ref={pageRef} style={pageStyle}>
      <LegacyBanner onMoved={adopt} />

      {noWallets ? (
        <>
          <EmptyHero
            title="Set up your first wallet."
            body="Create one, or import a key you already have. Keys stay encrypted in this Trade UI's vault and sign on its server."
            cta={<>
              <Btn tone="primary" onClick={() => setNewOpen(true)}>{Icon.plus(12)} New wallet</Btn>
              <Btn tone="ghost" onClick={() => setImportOpen(true)}>Import key</Btn>
            </>}
          />
        </>
      ) : (
        <>
          <Overview
            scope={viewScope}
            onShowAll={() => setFocusId(null)}
            addresses={inView.map((w) => w.pubkey)}
            native={native}
            nativePrice={nativePrice}
            totalValueUsd={viewTotal}
            cash={cash}
            loading={viewLoading}
            wide={pageWidth === 0 ? wide : pageWidth >= 720}
            phone={isPhone}
          />

          {wide ? (
            <div style={{
              flex: 1, minHeight: 0, display: "grid", gap: 36,
              gridTemplateColumns: `${pageWidth >= 1100 ? 320 : 300}px minmax(0, 1fr)`,
            }}>
              {rail(true)}
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
                {tabBar}
                {/* A plain block: the tab cards clip (overflow:hidden), and a
                    flex parent would shrink them instead of scrolling. */}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingTop: 12 }}>
                  {tabBody}
                </div>
              </div>
            </div>
          ) : (
            <>
              {tabBar}
              <div style={{ flexShrink: 0 }}>
                {tab === "wallets" ? rail(false) : tabBody}
              </div>
            </>
          )}
        </>
      )}

      <NewWalletModal open={newOpen} family={family} onClose={() => setNewOpen(false)} onCreated={adopt} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={onImported} />
      <ExportModal wallet={exportW} onClose={closeExport} />
      <SendModal
        wallet={sendW}
        balanceSol={sendBalance}
        onClose={() => setSendW(null)}
        onSent={() => void userWallets.refreshBalances()}
      />
      <RenameModal wallet={renameW} onClose={() => setRenameW(null)} />
      <DeleteModal wallet={deleteW} onClose={() => setDeleteW(null)} />
      <SecurityModal open={securityOpen} config={config} onConfig={setConfig} onClose={() => setSecurityOpen(false)} />
    </div>
  );
}
