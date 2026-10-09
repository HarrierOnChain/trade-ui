"use client";
/**
 * Portfolio — one combined view of everything you hold.
 *
 * Design intent (rewritten 2026-06): the dashboard is ALWAYS the sum of every
 * wallet you manage. There is no per-wallet "scope" selection — that used to
 * double as the global trading set and quietly re-scope the whole page, which
 * nobody could follow.
 *
 *   • Hero        — title + balance summary + realized-PnL chart
 *   • Tabs        — Holdings · Activity
 *
 * Wallets themselves are managed on the Wallets page (keys, watch addresses,
 * export, send); which wallets trade is picked in the top-bar wallet popup.
 */

import React, { useCallback, useMemo, useState } from "react";
import { useClientNav } from "../../components/shell/ClientPages";
import { Btn, Icon } from "../../components/atoms";
import { useApp } from "../../contexts/AppContext";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { usePortfolioScope } from "../../hooks/usePortfolioScope";
import { useWalletTradeStream, type StreamWallet } from "../../hooks/useWalletTradeStream";
import { useUserWallets, type UserWallet } from "../../hooks/useUserWallets";
import { useHiddenTokens } from "../../lib/hiddenTokens";
import { shortAddr } from "../../lib/format";
import { tokenHref } from "../../lib/tokenHref";
import { findQuoteMint, isStableQuoteMint } from "../../lib/quoteMints";
import type { TokenHolding } from "../../types";

import {
  TabBar, EmptyHero,
} from "./_components/atoms";
import { HoldingsTab, ActivityTab } from "./_components/tabs";
import { SpotSummary } from "./_components/SpotSummary";

/* ── Types ───────────────────────────────────────────────────────────── */

type Tab = "holdings" | "activity";

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

  const userWallets = useUserWallets();
  const { balances: liveBalances } = userWallets;

  const [tab, setTab] = useState<Tab>("holdings");

  // Every wallet of the vault on this chain: keys and watch-only addresses.
  const wallets: UserWallet[] = userWallets.wallets;
  const onChainWallets = wallets;
  const liveAddresses = useMemo(() => onChainWallets.map((w) => w.pubkey), [onChainWallets]);

  /* ── Live scope — always every on-chain wallet ─────────────────────── */

  const scope = usePortfolioScope(liveAddresses);

  // Live trade alerts for every on-chain wallet
  const streamWallets: StreamWallet[] = useMemo(
    () => onChainWallets.map((w) => ({
      id: `user:${w.id}`,
      address: w.pubkey,
      label: w.displayLabel,
    })),
    [onChainWallets],
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

  const liveAlerts = useMemo(
    () => stream.alerts.filter((a) => !hiddenMints.has(a.tokenMint)),
    [stream.alerts, hiddenMints],
  );
  const visibleTrades = useMemo(
    () => scope.trades.filter((t) => !hiddenMints.has(t.tokenMint)),
    [scope.trades, hiddenMints],
  );

  /* ── Data feeding the dashboard ─────────────────────────────────────── */

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

  // USDC / USD1 are cash quotes — show in Available, not the holdings table or uPnL.
  const spotHoldings = useMemo(
    () => liveHoldings.filter((h) => !isStableQuoteMint(h.mint)),
    [liveHoldings],
  );

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
  }, [onChainWallets, liveBalances, usdcMint, usd1Mint]);

  const stableCashUsd = quoteBalances.usdc + quoteBalances.usd1;

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
  const totalValueUsd = cacheNativeSol * solPrice + liveValueUsd + stableCashUsd;

  /* ── Render ────────────────────────────────────────────────────────── */

  const tabCounts: Record<Tab, number> = {
    holdings: spotHoldings.length,
    activity: visibleTrades.length + liveAlerts.length,
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

  // First run / no wallets on this chain
  if (!userWallets.loading && wallets.length === 0) {
    return (
      <div style={pageStyle}>
        <Hero modeControl={<ManageWalletsButton onClick={() => clientNav("/wallets")} />} />
        <EmptyHero
          title="Set up your first wallet."
          body="Create a wallet, import a key you already have, or watch any address. Keys stay in the encrypted vault of this Trade UI and sign here, without a prompt."
          icon="◎"
          cta={
            <Btn size="sm" tone="primary" onClick={() => clientNav("/wallets")}>+ Add a wallet</Btn>
          }
        />
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <SpotSummary
        addresses={liveAddresses}
        solPrice={solPrice}
        totalValueUsd={totalValueUsd}
        quoteBalances={quoteBalances}
        modeControl={<ManageWalletsButton onClick={() => clientNav("/wallets")} />}
      />

      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "holdings", label: "Holdings", count: tabCounts.holdings },
          { value: "activity", label: "Activity", count: tabCounts.activity },
        ]}
      />

      <div style={tabBodyStyle}>
      {tab === "holdings" && (
        <div style={{ flexShrink: 0 }}>
          <HoldingsTab
            holdings={spotHoldings}
            liveMap={liveMap}
            loading={scope.loading && !scope.holdings.length}
            onTokenClick={(mint) => clientNav(tokenHref(mint))}
          />
        </div>
      )}

      {tab === "activity" && (
        <div style={{ flexShrink: 0 }}>
          <ActivityTab
            trades={visibleTrades}
            liveAlerts={liveAlerts}
            solPrice={solPrice}
            loading={scope.loading && !visibleTrades.length && liveAlerts.length === 0}
            onTokenClick={(mint) => clientNav(tokenHref(mint))}
          />
        </div>
      )}
      </div>
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

/* ── Header actions ──────────────────────────────────────────────────── */

function ManageWalletsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        padding: "6px 14px", borderRadius: 999,
        background: "var(--ink-2)", border: "1px solid var(--line-soft)",
        cursor: "pointer", fontSize: 12, fontWeight: 500, color: "var(--paper-2)",
        transition: "border-color 120ms, color 120ms",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--paper)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line-soft)"; e.currentTarget.style.color = "var(--paper-2)"; }}
    >
      {Icon.key(12)} Manage wallets
    </button>
  );
}
