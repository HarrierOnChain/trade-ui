"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { parseTokenPath, tokenHref } from "../../lib/tokenHref";
import { swapsOn } from "../../lib/chains";
import { useClientNav } from "./ClientPages";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useApp } from "../../contexts/AppContext";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { useUserWallets } from "../../hooks/useUserWallets";
import { useQuickBuy } from "../../hooks/useQuickBuy";
import { useQuickSell } from "../../hooks/useQuickSell";
import { useQuickBuyAmount } from "../../hooks/useQuickBuyAmount";
import { useBuyQuoteMint } from "../../hooks/useBuyQuoteMint";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import {
  getCachedPublicMetadata,
  fetchPublicMetadata,
  type MetaResult,
} from "../../api/metadata";
import { useUserPreference } from "../../hooks/useUserPreference";
import {
  PREF_KEYS,
  defaultInstantPresets,
  resolvePresetValue,
  isValidPresetValue,
  type InstantPresets,
  type PresetKey,
} from "../TradingPanel/presets";
import { Icon, QuoteAssetIcon, TokenIcon, Tooltip } from "../atoms";
import type { QuoteMint } from "../../lib/quoteMints";
import { fmtNum, fmtUsd, shortAddr } from "../../lib/format";
import { useHiddenMints } from "../../lib/hiddenTokens";

type SidebarPage = "holdings" | "wallets";

const SIDEBAR_PAGE_KEY = "spool.sidebar.page";

const PAGES: { id: SidebarPage; label: string }[] = [
  { id: "holdings", label: "Holdings" },
  { id: "wallets", label: "Wallets" },
];

interface StoredWallet {
  id: string;
  label: string;
  address: string;
  createdAt: string;
  active?: boolean;
}

function readStoredPage(): SidebarPage {
  if (typeof window === "undefined") return "holdings";
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PAGE_KEY);
    if (raw === "holdings" || raw === "wallets") return raw;
  } catch {
    /* ignore */
  }
  return "holdings";
}

export function Sidebar() {
  const { sidebarOpen: open, toggleSidebar } = useApp();
  const isMobile = useIsMobile();

  const [page, setPage] = useState<SidebarPage>("holdings");

  // Re-read on every open: the mobile menu picks the page in storage before
  // opening the drawer.
  useEffect(() => {
    if (open) setPage(readStoredPage());
  }, [open]);

  const selectPage = (next: SidebarPage) => {
    setPage(next);
    try {
      window.localStorage.setItem(SIDEBAR_PAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;

  const aside = (
    <aside style={{
      width: isMobile ? "100%" : 264,
      height: isMobile ? "100%" : undefined,
      flexShrink: 0,
      background: "var(--ink-1)",
      borderRight: "1px solid var(--line-soft)",
      display: "flex", flexDirection: "column",
      overflow: "hidden", position: "relative",
    }}>
      <div
        role="tablist"
        style={{
          height: 48,
          padding: "0 8px",
          borderBottom: "1px solid var(--line-soft)",
          display: "flex", alignItems: "center", gap: 2,
          flexShrink: 0,
        }}
      >
        {PAGES.map((p) => {
          const active = page === p.id;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={active}
              onClick={() => selectPage(p.id)}
              style={{
                flex: 1,
                minWidth: 0,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 500,
                border: "1px solid transparent",
                borderRadius: 4,
                background: active ? "var(--ink-2)" : "transparent",
                color: active ? "var(--paper)" : "var(--paper-3)",
                cursor: "pointer",
                textAlign: "center",
                transition: "background 120ms, color 120ms",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {page === "holdings" && <HoldingsPage />}
      {page === "wallets" && <WalletsPage />}
    </aside>
  );

  // On phones/tablets the 264px rail would swallow the screen, so render it as
  // an off-canvas overlay drawer (driven by the same sidebarOpen state) that
  // sits above the content with a tap-to-dismiss backdrop.
  if (isMobile) {
    return (
      <>
        <div className="drawer-backdrop" onClick={() => toggleSidebar()} aria-hidden />
        <div className="drawer-panel" style={{ width: "min(264px, 86vw)" }}>{aside}</div>
      </>
    );
  }

  return aside;
}

/* ─────────────────────────────────────────────────────────────
   Shared: wallet list + balance refresh
   ───────────────────────────────────────────────────────────── */

function useSidebarWallets() {
  const userWallets = useUserWallets();
  const [refreshing, setRefreshing] = useState(false);
  const wallets: StoredWallet[] = useMemo(
    () =>
      userWallets.wallets
        .map((w) => ({
          id: w.id,
          label: w.displayLabel,
          address: w.pubkey,
          createdAt: w.createdAt,
          active: userWallets.activeIds.has(w.id),
        })),
    [userWallets.wallets, userWallets.activeIds],
  );

  const refresh = async () => {
    if (refreshing || wallets.length === 0) return;
    setRefreshing(true);
    try {
      await userWallets.refreshBalances();
    } finally {
      setRefreshing(false);
    }
  };

  return { userWallets, wallets, balances: userWallets.balances, refreshing, refresh };
}

function RefreshButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Tooltip content="Refresh balances">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", padding: 2,
          color: "var(--paper-3)", cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.45 : 1,
        }}
      >
        {Icon.refresh(12)}
      </button>
    </Tooltip>
  );
}

const pageHeaderStyle: React.CSSProperties = {
  height: 40, padding: "0 12px",
  borderBottom: "1px solid var(--line-soft)",
  display: "flex", alignItems: "center", justifyContent: "space-between",
  fontFamily: "var(--font-mono)", fontSize: 11,
  color: "var(--accent)",
  flexShrink: 0,
};

const emptyStyle: React.CSSProperties = {
  padding: 24, fontSize: 11, color: "var(--paper-4)",
  textAlign: "center", fontFamily: "var(--font-mono)", fontStyle: "italic",
};

/* ─────────────────────────────────────────────────────────────
   Holdings page
   ───────────────────────────────────────────────────────────── */

function HoldingsPage() {
  const { navigate } = useClientNav();
  const { wallets, balances, refreshing, refresh } = useSidebarWallets();
  const hiddenMints = useHiddenMints();
  const solPrice = useSolPrice() ?? 0;
  const hasLiveBalances = wallets.some((w) => (balances[w.id]?.updatedAt ?? 0) > 0);

  // Every token held across all wallets, summed per mint the same way the
  // Portfolio tab does.
  const holdingAgg = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of wallets) {
      const toks = balances[w.id]?.tokens;
      if (!toks) continue;
      for (const [mint, amt] of Object.entries(toks)) {
        if (!(amt > 0) || hiddenMints.has(mint)) continue;
        m.set(mint, (m.get(mint) ?? 0) + amt);
      }
    }
    return m;
  }, [wallets, balances, hiddenMints]);
  const holdingMints = useMemo(() => [...holdingAgg.keys()], [holdingAgg]);
  const liveMap = useLiveTradePrices(holdingMints);
  const holdingRows = useMemo(() => {
    const out = holdingMints.map((mint) => {
      const amount = holdingAgg.get(mint) ?? 0;
      const lp = liveMap.get(mint)?.price ?? 0;
      const usd = lp > 0 && solPrice > 0 ? lp * solPrice * amount : 0;
      return { mint, amount, usd };
    });
    out.sort((a, b) => b.usd - a.usd || b.amount - a.amount);
    return out;
  }, [holdingMints, holdingAgg, liveMap, solPrice]);
  const holdingsTotalUsd = useMemo(
    () => holdingRows.reduce((s, r) => s + r.usd, 0),
    [holdingRows],
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={pageHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>Total</span>
          <SortGlyph />
          <span>{fmtUsd(holdingsTotalUsd)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--paper-4)" }}>
            {holdingRows.length} token{holdingRows.length === 1 ? "" : "s"}
          </span>
          <RefreshButton
            busy={refreshing || wallets.length === 0}
            onClick={() => void refresh()}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {holdingRows.length === 0 ? (
          <div style={emptyStyle}>
            {wallets.length === 0
              ? "No wallets available. Create or import them on the Portfolio page."
              : hasLiveBalances
                ? "No tokens held across your wallets."
                : "Waiting for balances…"}
          </div>
        ) : (
          holdingRows.map((r) => (
            <HoldingRow
              key={r.mint}
              mint={r.mint}
              amount={r.amount}
              usd={r.usd}
              onClick={() => navigate(tokenHref(r.mint))}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Wallets page
   ───────────────────────────────────────────────────────────── */

function WalletsPage() {
  const pathname = usePathname();
  const { userWallets, wallets, balances, refreshing, refresh } = useSidebarWallets();
  const [quote] = useBuyQuoteMint();

  const activeMint = useMemo(() => {
    const parsed = pathname ? parseTokenPath(pathname) : null;
    return parsed?.address ?? null;
  }, [pathname]);
  const { info } = useTokenInfo(activeMint);
  const hasToken = !!activeMint;

  const totalQuote = useMemo(
    () => wallets.reduce((acc, w) => acc + walletQuoteBalance(balances[w.id], quote), 0),
    [wallets, balances, quote],
  );
  const totalToken = useMemo(() => {
    if (!activeMint) return 0;
    return wallets.reduce(
      (acc, w) => acc + (balances[w.id]?.tokens[activeMint] ?? 0),
      0,
    );
  }, [wallets, balances, activeMint]);
  const rawSymbol = info?.symbol?.trim() || "";
  const tickerLabel = hasToken
    ? "$" + (rawSymbol ? (rawSymbol.length > 5 ? rawSymbol.slice(0, 5) + "…" : rawSymbol) : "TOKEN")
    : "";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* SOL / token balance header */}
      <div style={pageHeaderStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Tooltip content={quote.label}>
            <span style={{ display: "inline-flex", lineHeight: 0, color: "var(--accent)" }}>
              <QuoteAssetIcon label={quote.label} size={12} />
            </span>
          </Tooltip>
          <SortGlyph />
          <span>{fmtQuoteBalance(totalQuote, quote.label)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {hasToken && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>{tickerLabel}</span>
              <SortGlyph />
              <span>{fmtNum(totalToken)}</span>
            </div>
          )}
          <RefreshButton
            busy={refreshing || wallets.length === 0}
            onClick={() => void refresh()}
          />
        </div>
      </div>

      {/* Wallet list */}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {wallets.length === 0 ? (
          <div style={emptyStyle}>
            No wallets available. Create or import them on the Portfolio page.
          </div>
        ) : (
          wallets.map((w) => {
            const bal = balances[w.id];
            const balanceKnown = (bal?.updatedAt ?? 0) > 0;
            const tokenAmount = bal && activeMint ? bal.tokens[activeMint] ?? 0 : 0;
            return (
              <WalletRow
                key={w.id}
                wallet={w}
                quote={quote}
                activeMint={activeMint}
                quoteBalance={walletQuoteBalance(bal, quote)}
                tokenBalance={tokenAmount}
                balanceKnown={balanceKnown}
                loading={(refreshing && !balanceKnown) || (!!bal?.loading && !balanceKnown)}
                onClick={() => userWallets.toggleActive(w.id)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

/// One aggregated-holding row of the Holdings page.
/// Resolves symbol / image lazily (cache-first, then a single public
/// metadata fetch) so a long bag list doesn't fan out a heavy per-row
/// REST call the way useTokenInfo would.
function HoldingRow({
  mint,
  amount,
  usd,
  onClick,
}: {
  mint: string;
  amount: number;
  usd: number;
  onClick: () => void;
}) {
  const [meta, setMeta] = useState<MetaResult | null>(() => getCachedPublicMetadata(mint));
  useEffect(() => {
    if (meta?.symbol || meta?.image) return;
    let cancelled = false;
    fetchPublicMetadata(mint)
      .then((next) => { if (!cancelled) setMeta(next); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mint]); // eslint-disable-line react-hooks/exhaustive-deps

  const symbol = meta?.symbol?.trim() || shortAddr(mint, 4);
  const name = meta?.name?.trim() || "";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 10px 6px 8px",
        borderBottom: "1px solid var(--line-soft)",
        cursor: "pointer",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ink-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <TokenIcon
        token={{ mint_address: mint, symbol, image: meta?.image ?? null }}
        size={20}
      />
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <span className="mono ellipsis" style={{
          fontSize: 12, color: "var(--paper-2)", fontWeight: 600,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {symbol}
        </span>
        <span className="mono ellipsis" style={{
          fontSize: 9, color: "var(--paper-4)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {name || shortAddr(mint, 4)}
        </span>
      </div>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, flexShrink: 0,
      }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--paper-2)" }}>
          {fmtUsd(usd)}
        </span>
        <span className="mono" style={{ fontSize: 9, color: "var(--paper-4)" }}>
          {fmtNum(amount)}
        </span>
      </div>
    </div>
  );
}

function WalletRow({
  wallet,
  quote,
  activeMint,
  quoteBalance,
  tokenBalance,
  balanceKnown,
  loading,
  onClick,
}: {
  wallet: StoredWallet;
  quote: QuoteMint;
  activeMint: string | null;
  quoteBalance: number;
  tokenBalance: number;
  balanceKnown: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const selected = !!wallet.active;
  const hasToken = !!activeMint;

  // Quick buy / sell are mint-scoped — only meaningful on a token route.
  // The hook is stateless apart from `busy`, so per-row instances are
  // cheap; passing walletId targets just this row's wallet regardless
  // of which wallets are active in the column scope.
  const { run: runBuy, busy: buyBusy } = useQuickBuy(activeMint ?? "");
  const { run: runSell, busy: sellBusy } = useQuickSell(activeMint ?? "");
  const [quickBuyAmount] = useQuickBuyAmount();

  // Hover-fan presets — pull the user's active InstantPresets slot and
  // surface entries 2-4 (indices 1, 2, 3) so the bolt itself stays the
  // primary "1st" action and the fan reveals the next three picks.
  const [instantPresets] = useUserPreference<InstantPresets>(
    PREF_KEYS.instantPresets, defaultInstantPresets,
  );
  const [activePresetKey] = useUserPreference<PresetKey>(
    PREF_KEYS.instantActivePreset, "1",
  );
  const slot = instantPresets[activePresetKey] ?? defaultInstantPresets[activePresetKey] ?? defaultInstantPresets["1"];
  // Keep the raw preset strings — a preset can be a range ("0.01-0.05")
  // that resolves to a random amount per fire. Collapsing to Number() here
  // turned every range into NaN and silently dropped it from the fan, so
  // range presets never appeared. `isValidPresetValue` accepts both plain
  // and range forms; `resolvePresetValue` picks the concrete amount at click.
  const buyFan = slot.buyAmounts
    .slice(1, 4)
    .map((s) => String(s))
    .filter((s) => isValidPresetValue(s));
  const sellFan = slot.sellAmounts
    .slice(1, 4)
    .map((s) => String(s).replace(/%/g, ""))
    .filter((s) => isValidPresetValue(s));

  // Quick trades need a chain the router swaps on.
  const canTrade = hasToken && swapsOn();
  const canSell = canTrade && balanceKnown && tokenBalance > 0;

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center",
        gap: 8,
        padding: "6px 10px 6px 8px",
        borderBottom: "1px solid var(--line-soft)",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        background: selected ? "var(--accent-dim)" : "transparent",
        cursor: "pointer",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--ink-2)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Quick Buy ⚡ */}
      {canTrade && (
        <BoltButton
          tone="buy"
          busy={buyBusy}
          disabled={false}
          onClick={() => { if (quickBuyAmount > 0) void runBuy(quickBuyAmount, wallet.id); }}
          fan={buyFan.map((raw) => ({
            label: formatBuyPreset(raw),
            disabled: buyBusy,
            onClick: () => {
              const n = Number(resolvePresetValue(raw));
              if (Number.isFinite(n) && n > 0) void runBuy(n, wallet.id);
            },
          }))}
        />
      )}

      {/* Quote balance (SOL / USDC / … — matches buy quote preference) */}
      <span
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--accent)",
          fontWeight: selected ? 700 : 500,
          opacity: loading ? 0.5 : 1,
          minWidth: 38,
          textAlign: "right",
          flexShrink: 0,
        }}
        title={loading ? "Loading balance…" : balanceKnown ? `${quoteBalance.toFixed(4)} ${quote.label}` : "Waiting for balance…"}
      >
        {fmtQuoteBalance(quoteBalance, quote.label)}
      </span>

      {/* Wallet label */}
      <span
        className="mono ellipsis"
        style={{
          fontSize: 12,
          color: selected ? "var(--paper)" : "var(--paper-2)",
          fontWeight: selected ? 700 : 500,
          flex: 1,
          minWidth: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {wallet.label || shortAddr(wallet.address, 5)}
        </span>
      </span>

      {/* Token amount */}
      {hasToken && (
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: tokenBalance > 0 ? "var(--paper-2)" : "var(--paper-4)",
            opacity: loading ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          {fmtNum(tokenBalance)}
        </span>
      )}

      {/* Quick Sell ⚡ */}
      {canTrade && (
        <BoltButton
          tone="sell"
          busy={sellBusy}
          disabled={!canSell}
          onClick={() => void runSell(100, wallet.id)}
          fan={sellFan.map((raw) => ({
            label: `${formatSellPreset(raw)}%`,
            disabled: sellBusy || !canSell,
            onClick: () => {
              const n = Number(resolvePresetValue(raw));
              if (Number.isFinite(n) && n > 0) void runSell(n, wallet.id);
            },
          }))}
        />
      )}
    </div>
  );
}

/// Compact bolt button used by both Quick Buy (left) and Quick Sell
/// (right) on each wallet row. Stops the row click from toggling the
/// wallet's active state when the button itself is clicked.
///
/// Visual styling lives in globals.css — `.sidebar-bolt-btn` plus the
/// `.sidebar-bolt-{buy,sell}` tone modifier — so the radial gradient,
/// hover glow, bolt-spin animation, and the hover-fan reveal can use
/// CSS pseudo-states (which inline React styles can't express). The
/// `fan` prop seeds three preset pills that animate out on wrap hover.
interface FanItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}
function BoltButton({
  tone,
  busy,
  disabled,
  onClick,
  fan,
}: {
  tone: "buy" | "sell";
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  fan?: FanItem[];
}) {
  const isInert = disabled || busy;
  const fanItems = (fan ?? []).slice(0, 3);

  // Portal the fan to <body> so the radial spread isn't clipped by the
  // wallet list's `overflow: auto` and can't paint behind the SOL header
  // above it. Position is computed from the bolt's bounding rect on
  // every show / scroll / resize and the fan uses `position: fixed`.
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  function recompute() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }

  useEffect(() => {
    if (!open) return;
    recompute();
    const onScrollOrResize = () => recompute();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  function show() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (!open) recompute();
    setOpen(true);
  }
  function hide() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // Brief delay so transitioning from bolt → fan pill (or vice versa)
    // doesn't blink the fan closed.
    closeTimer.current = setTimeout(() => setOpen(false), 80);
  }

  const showFan = open && fanItems.length > 0 && origin != null && mounted;

  return (
    <span
      className={`sidebar-bolt-wrap sidebar-bolt-wrap-${tone}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <button
        ref={btnRef}
        type="button"
        disabled={isInert}
        className={`sidebar-bolt-btn sidebar-bolt-${tone}`}
        onClick={(e) => { e.stopPropagation(); if (!isInert) onClick(); }}
      >
        {Icon.bolt(10)}
      </button>
      {showFan && createPortal(
        <span
          className={`sidebar-bolt-fan sidebar-bolt-fan-${tone} sidebar-bolt-fan-open`}
          style={{ left: origin.x, top: origin.y }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {fanItems.map((item, i) => (
            <button
              key={i}
              type="button"
              disabled={!!item.disabled}
              className={`sidebar-bolt-preset p${i + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                if (item.disabled) return;
                item.onClick();
                if (closeTimer.current) clearTimeout(closeTimer.current);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </span>,
        document.body,
      )}
    </span>
  );
}

/// Format a SOL amount compactly for the fan-button label so 0.005 fits
/// in 34px wide. Drops trailing zeros, keeps small values readable.
function formatBuyAmount(n: number): string {
  if (n >= 100) return `${Math.round(n)}`;
  if (n >= 10) return n.toFixed(0);
  if (n >= 1) return n.toFixed(2).replace(/\.?0+$/, "");
  if (n >= 0.01) return n.toFixed(3).replace(/\.?0+$/, "");
  return n.toFixed(4).replace(/\.?0+$/, "");
}

// Preset display helpers — keep the range form ("0.01-0.05") legible on the
// fan pill instead of collapsing it to a single number.
function formatBuyPreset(raw: string): string {
  const parts = raw.split("-");
  if (parts.length === 2) return `${formatBuyAmount(Number(parts[0]))}-${formatBuyAmount(Number(parts[1]))}`;
  return formatBuyAmount(Number(raw));
}

function formatSellPreset(raw: string): string {
  // Sell values are already stripped of "%"; ranges stay as "min-max".
  const parts = raw.split("-");
  if (parts.length === 2) return `${Number(parts[0])}-${Number(parts[1])}`;
  return `${Number(raw)}`;
}

function walletQuoteBalance(
  bal: { sol: number; tokens: Record<string, number> } | undefined,
  quote: QuoteMint,
): number {
  if (!bal) return 0;
  if (quote.mint === null) return bal.sol;
  return bal.tokens[quote.mint] ?? 0;
}

function fmtQuoteBalance(amount: number, label: string): string {
  if (amount < 0.001) return "0";
  if (label === "SOL") return amount >= 1 ? amount.toFixed(2) : amount.toFixed(3);
  if (amount >= 1000) return amount.toFixed(0);
  if (amount >= 1) return amount.toFixed(2);
  return amount.toFixed(amount < 0.01 ? 4 : 2);
}

function SortGlyph() {
  return (
    <svg width={10} height={10} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block", color: "var(--paper-4)" }}>
      <path d="M5 3v10M2.5 5.5 5 3l2.5 2.5M11 13V3M8.5 10.5 11 13l2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
