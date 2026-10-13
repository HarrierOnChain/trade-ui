"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClientNav } from "./ClientPages";
import { BrandMark, ChainIcon, Icon, QuoteAssetIcon, Tooltip } from "../atoms";
import type { BrandMarkHandle } from "../atoms/BrandMark";
import { useApp } from "../../contexts/AppContext";
import { useChain } from "../../contexts/ChainContext";
import { useUserWallets } from "../../hooks/useUserWallets";
import { useUserPreference } from "../../hooks/useUserPreference";
import { useIsPhone, useIsMobile } from "../../hooks/useMediaQuery";
import { useAppZoom } from "../../contexts/AppZoomContext";
import { quoteMints, defaultQuoteMint, findQuoteMint } from "../../lib/quoteMints";
import { PREF_KEYS } from "../TradingPanel/presets";
import { SettingsModal } from "./SettingsModal";
import { WalletSelectorPopup } from "../TradingPanel/WalletSelectorPopup";
import { lockNow } from "./LockGate";

function QuoteMintIcon({ label, size }: { label: string; size: number }) {
  return <QuoteAssetIcon label={label} size={size} />;
}

// Below this frame width (the AppZoom frame's own CSS width = innerWidth /
// effectiveZoom) the search bar collapses to a ⌘K icon so the full nav stays
// readable. Above it the bar shows and shrinks progressively via the grid.
// ~1280 leaves the nav + a comfortable (≥~220px) search + right cluster room;
// below it the bar would truncate, so we switch to the icon instead.
const SEARCH_COLLAPSE_WIDTH = 1400;

// Mirrors Sidebar's own key — writing it before opening the drawer deep-links
// the mobile menu's "Holdings" / "Wallets" entries to the right sidebar page
// (Sidebar re-reads this every time it opens).
const SIDEBAR_PAGE_KEY = "spool.sidebar.page";

type NavItem = { id: string; label: string; path: string; icon: React.ReactNode };

const NAV: NavItem[] = [
  { id: "discover", label: "Discover", path: "/discover", icon: Icon.trend(12) },
  { id: "monitor", label: "Trenches", path: "/trenches", icon: Icon.eyeLine(12) },
  { id: "portfolio", label: "Portfolio", path: "/portfolio", icon: Icon.portfolio(12) },
  { id: "swap", label: "Swap", path: "/swap", icon: Icon.swap(12) },
  { id: "bundler", label: "Bundler", path: "/bundler", icon: Icon.rocket(12) },
];

export function TopBar() {
  const { navigate, activePath } = useClientNav();
  const pathname = activePath;
  const { setSearchOpen, sidebarOpen, toggleSidebar } = useApp();
  const headerRef = useRef<HTMLElement>(null);
  const isPhone = useIsPhone();

  // Compute the AppZoom frame's own CSS width the SAME way the frame does
  // (`calc(100vw / effectiveZoom)`, effectiveZoom = isMobile ? 1 : zoom). This
  // is the real layout space the header gets — reading it from the zoom value +
  // innerWidth is exact and dodges the CSS-`zoom` measurement quirks that make
  // clientWidth/getBoundingClientRect unreliable inside a zoomed subtree.
  const { zoom } = useAppZoom();
  const isMobile = useIsMobile();
  const [viewportWidth, setViewportWidth] = useState<number>(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const frameWidth = viewportWidth / (isMobile ? 1 : zoom);

  // Phones always use the icon; below the frame-width threshold (tight laptops)
  // the middle search bar collapses to a ⌘K icon so the full nav wins the
  // space. Wide screens keep the bar — the grid shrinks it progressively first.
  const searchCompact = isPhone || frameWidth < SEARCH_COLLAPSE_WIDTH;

  // Mobile: the full nav can't fit, so it moves into a ☰ slide-in sheet.
  const [navOpen, setNavOpen] = useState(false);

  const brandRef = useRef<BrandMarkHandle | null>(null);
  const handleSidebarToggle = () => {
    brandRef.current?.spin();
    toggleSidebar();
  };

  const isActive = (p: string) => p === "/" ? pathname === "/" : pathname?.startsWith(p);
  const nav = NAV;
  const openSearch = () => setSearchOpen(true);

  if (isMobile) {
    return (
      <>
        <header
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "0 8px", height: 48,
            background: "var(--ink-1)",
            borderBottom: "1px solid var(--line-soft)",
            flexShrink: 0, position: "relative", zIndex: 10,
          }}
        >
          <button
            type="button"
            aria-label="Open menu"
            aria-haspopup="menu"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
            style={{ ...iconBtn, color: "var(--paper-2)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; e.currentTarget.style.background = "var(--ink-2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-2)"; e.currentTarget.style.background = "transparent"; }}
          >
            <HamburgerIcon />
          </button>
          <BrandMark ref={brandRef} size={40} ariaLabel="Go to Trenches" onClick={() => navigate("/trenches")} />
          <div style={{ flex: 1, minWidth: 0 }} />
          <HeaderSearchButton onOpen={openSearch} />
          <ConnectedMenu />
          <LockButton />
          <SettingsButton />
        </header>
        <MobileNavSheet
          open={navOpen}
          onClose={() => setNavOpen(false)}
          nav={nav}
          isActive={isActive}
          pathname={pathname}
          onNavigate={(p) => { navigate(p); setNavOpen(false); }}
          sidebarOpen={sidebarOpen}
          toggleSidebar={toggleSidebar}
        />
        <SettingsModal />
      </>
    );
  }

  return (
    <>
    <header
      ref={headerRef}
      style={{
      display: "grid",
      // Nav column is `auto` (sized to its content) so every tab title stays
      // visible; the search bar lives in the flexible 1fr column and shrinks to
      // its min before the nav ever has to scroll. The nav gets priority, and
      // the search bar is never removed on desktop — it just narrows.
      // Nav column is `max-content` so the full tab strip NEVER shrinks or
      // scrolls on desktop — the search (the 1fr column,
      // min 0) yields first and, once it'd get too small, collapses to the ⌘K
      // icon via `searchCompact`. The nav always wins the space.
      gridTemplateColumns: searchCompact
        ? "minmax(0, 1fr) auto"
        : "max-content minmax(0, 1fr) auto",
      alignItems: "center",
      gap: isPhone ? 6 : 14,
      padding: isPhone ? "0 8px" : "0 14px",
      height: 48,
      background: "var(--ink-1)",
      borderBottom: "1px solid var(--line-soft)",
      flexShrink: 0, position: "relative", zIndex: 10,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: isPhone ? 4 : 8,
        height: 48, minWidth: 0, overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
          <Tooltip content={sidebarOpen ? "Hide sidebar" : "Show sidebar"} placement="bottom">
            <SidebarChevron open={sidebarOpen} onClick={handleSidebarToggle} />
          </Tooltip>
          <BrandMark
            ref={brandRef}
            size={48}
            ariaLabel="Go to Monitor"
            onClick={() => navigate("/trenches")}
          />
        </div>
        <ScrollableNav
          items={nav}
          pathname={pathname}
          isActive={isActive}
          onNavigate={navigate}
        />
      </div>

      {!searchCompact && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          width: "100%", minWidth: 0,
          // Search hugs the right end of its column, next to the account
          // cluster; the header grid gap keeps the breathing room.
          justifyContent: "flex-end",
        }}>
          <HeaderSearchBar onOpen={openSearch} />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: isPhone ? 4 : 10 }}>
        {searchCompact && <HeaderSearchButton onOpen={openSearch} />}
        <ConnectedMenu />
        <LockButton />
        <SettingsButton />
      </div>
    </header>
    <SettingsModal />
    </>
  );
}

const iconBtn: React.CSSProperties = {
  width: 32, height: 32,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  color: "var(--paper-3)",
  border: "1px solid transparent",
  borderRadius: 4,
  transition: "color 120ms, background 120ms",
};

function HeaderSearchBar({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "0 14px", height: 32,
        maxWidth: 240, width: "100%",
        minWidth: 0,
        overflow: "hidden",
        background: "color-mix(in oklch, var(--ink-0) 55%, transparent)",
        border: "1px solid color-mix(in oklch, var(--line) 70%, transparent)",
        borderRadius: 999,
        color: "var(--paper-3)",
        fontSize: 12,
        whiteSpace: "nowrap",
        transition: "border-color 120ms, color 120ms, background 120ms",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "color-mix(in oklch, var(--line) 90%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "color-mix(in oklch, var(--line) 70%, transparent)";
      }}
    >
      <span style={{ flexShrink: 0, display: "inline-flex", lineHeight: 0 }}>{Icon.search(13)}</span>
      <span style={{
        flex: 1,
        minWidth: 0,
        textAlign: "left",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>Search tokens, wallets, contracts…</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <span className="kbd">⌘</span>
        <span className="kbd">K</span>
      </span>
    </button>
  );
}

function HeaderSearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip content="Search (⌘K)" placement="bottom">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Search"
        style={iconBtn}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--paper)";
          e.currentTarget.style.background = "var(--ink-2)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--paper-3)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        {Icon.search(14)}
      </button>
    </Tooltip>
  );
}

/** Lock the vault now, for every browser: the page goes back to the lock screen. */
function LockButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Tooltip content="Lock" placement="bottom">
      <button
        type="button"
        aria-label="Lock Trade UI"
        disabled={busy}
        onClick={() => { setBusy(true); void lockNow(); }}
        style={{ ...iconBtn, color: "var(--paper-3)", background: "transparent", cursor: busy ? "wait" : "pointer" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; e.currentTarget.style.background = "var(--ink-2)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-3)"; e.currentTarget.style.background = "transparent"; }}
      >
        {Icon.lock(15)}
      </button>
    </Tooltip>
  );
}

function SettingsButton() {
  const { openSettings } = useApp();
  const { navigate } = useClientNav();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <Tooltip content={open ? null : "Settings"} placement="bottom">
        <button
          type="button"
          aria-label="Settings menu"
          aria-haspopup="menu"
          aria-expanded={open}
          style={{ ...iconBtn, color: open ? "var(--paper)" : "var(--paper-3)", background: open ? "var(--ink-2)" : "transparent" }}
          onClick={() => setOpen((v) => !v)}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--paper)";
            e.currentTarget.style.background = "var(--ink-2)";
          }}
          onMouseLeave={(e) => {
            if (open) return;
            e.currentTarget.style.color = "var(--paper-3)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          {Icon.userSettings(15)}
        </button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 6,
            minWidth: 168,
            background: "var(--ink-1)",
            border: "1px solid var(--line-soft)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            padding: 4,
            zIndex: 50,
          }}
        >
          <SettingsMenuItem
            icon={Icon.userSettings(14)}
            label="Settings"
            onClick={() => { setOpen(false); openSettings(); }}
          />
          <SettingsMenuItem
            icon={Icon.wallet(14)}
            label="Wallets & security"
            onClick={() => { setOpen(false); navigate("/portfolio?security=1"); }}
          />
          <div style={{ height: 1, background: "var(--line-soft)", margin: "4px 6px" }} />
          <SettingsMenuItem
            danger
            icon={Icon.lock(14)}
            label="Lock now"
            onClick={() => { setOpen(false); void lockNow(); }}
          />
        </div>
      )}
    </div>
  );
}

function SettingsMenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const base = danger ? "var(--sell)" : "var(--paper-2)";
  const hover = danger ? "var(--sell)" : "var(--paper)";
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%",
        padding: "8px 10px",
        background: "transparent",
        border: 0,
        borderRadius: 5,
        color: base,
        fontFamily: "var(--font-sans, inherit)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        textAlign: "left",
        transition: "color 120ms, background 120ms",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = hover; e.currentTarget.style.background = "var(--ink-2)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = base; e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ display: "inline-flex", lineHeight: 0, flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}

function formatQuoteBalance(v: number): string {
  if (!isFinite(v)) return "–";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(2);
}

function useActiveWalletBalances() {
  const userWallets = useUserWallets();
  const wallets = userWallets.activeWallets;

  const { chainId } = useChain();
  const quoteBalances = useMemo(() => {
    const next: Record<string, { value: number; loading: boolean }> = {};
    for (const quote of quoteMints(chainId)) {
      let total = 0;
      let loading = false;
      for (const wallet of wallets) {
        const bal = userWallets.balances[wallet.id];
        if (!bal) {
          loading = userWallets.loading;
          continue;
        }
        if (bal.loading) loading = true;
        total += quote.mint ? (bal.tokens[quote.mint] ?? 0) : bal.sol;
      }
      next[quote.label] = { value: total, loading };
    }
    return next;
  }, [userWallets.balances, userWallets.loading, wallets, chainId]);

  return { quoteBalances };
}

/** Close a popover on a click outside `ref` or on Escape. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

const popover: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  background: "var(--ink-1)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  boxShadow: "0 16px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
  padding: 4,
  zIndex: 50,
};

/** The active chain (its logo and ticker) and a list to switch. */
function ChainPicker() {
  const { chain, chainId, setChain, chains } = useChain();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Chain: ${chain.name}`}
        title={`Chain: ${chain.name}`}
        onClick={() => setOpen((o) => !o)}
        className="mono"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          height: 32, padding: "0 8px",
          background: open ? "var(--ink-2)" : "transparent",
          border: 0, borderRadius: 6,
          color: "var(--paper)", fontSize: 12, fontWeight: 600, letterSpacing: "0.02em",
          cursor: "pointer", transition: "background 120ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = "transparent"; }}
      >
        <ChainIcon id={chainId} size={16} />
        {chain.label}
        <ChainChevron open={open} />
      </button>
      {open && (
        <div role="listbox" aria-label="Chain" style={{ ...popover, right: 0, width: 200 }}>
          {chains.map((c) => {
            const active = c.id === chainId;
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { setOpen(false); if (!active) setChain(c.id); }}
                style={{
                  display: "grid", gridTemplateColumns: "18px minmax(0, 1fr) auto 8px",
                  alignItems: "center", gap: 9,
                  width: "100%", minHeight: 32, padding: "6px 8px",
                  border: 0, borderRadius: 5,
                  background: active ? "var(--ink-2)" : "transparent",
                  color: active ? "var(--paper)" : "var(--paper-2)",
                  fontSize: 12, textAlign: "left", cursor: "pointer",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--ink-2)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <ChainIcon id={c.id} size={16} />
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", letterSpacing: "0.04em" }}>{c.label}</span>
                <ActiveDot on={active} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActiveDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 7, height: 7, borderRadius: 999,
        background: on ? "var(--accent)" : "transparent",
        boxShadow: on ? "0 0 7px color-mix(in oklch, var(--accent) 65%, transparent)" : "none",
      }}
    />
  );
}

/**
 * The trading wallets' balance in the coin trades pay with (the chain's coin,
 * or a stablecoin picked here), and the menu to pick the wallets and that coin.
 */
function WalletBalanceMenu() {
  const { chainId } = useChain();
  const { activeWallets } = useUserWallets();
  const { quoteBalances } = useActiveWalletBalances();
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const [buyInputLabel, setBuyInputLabel] = useUserPreference<string>(PREF_KEYS.buyInputMint, defaultQuoteMint().label);
  const [, setSellOutputLabel] = useUserPreference<string>(PREF_KEYS.sellOutputMint, defaultQuoteMint().label);
  const activeQuote = findQuoteMint(buyInputLabel, chainId);
  const quotes = quoteMints(chainId);
  const bal = quoteBalances[activeQuote.label];
  const balText = bal?.loading ? "…" : formatQuoteBalance(bal?.value ?? 0);

  const selectQuote = (label: string) => {
    setBuyInputLabel(label);
    setSellOutputLabel(label);
  };

  const payWith = quotes.length > 1 ? (
    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: "var(--paper-4)", textTransform: "uppercase", marginRight: 2 }}>
        Pay with
      </span>
      {quotes.map((q) => {
        const active = q.label === activeQuote.label;
        const b = quoteBalances[q.label];
        return (
          <Tooltip key={q.label} content={`${q.label}: ${b?.loading ? "…" : formatQuoteBalance(b?.value ?? 0)}`} placement="top">
            <button
              type="button"
              aria-pressed={active}
              onClick={() => selectQuote(q.label)}
              className="mono"
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                height: 22, padding: "0 6px",
                background: active ? "var(--ink-2)" : "transparent",
                border: `1px solid ${active ? "var(--line)" : "transparent"}`,
                borderRadius: 5,
                color: active ? "var(--paper)" : "var(--paper-3)",
                fontSize: 10.5, cursor: "pointer",
              }}
            >
              <QuoteMintIcon label={q.label} size={12} />
              {q.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  ) : undefined;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={pillRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${activeWallets.length} trading wallets, ${balText} ${activeQuote.label}`}
        title={`${activeWallets.length} trading wallet${activeWallets.length === 1 ? "" : "s"} · ${balText} ${activeQuote.label}`}
        onClick={() => setOpen((o) => !o)}
        className="mono"
        style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          height: 32, padding: "0 9px 0 10px",
          background: "var(--ink-0)",
          border: `1px solid ${open ? "var(--line)" : "var(--line-soft)"}`,
          borderRadius: 8,
          color: "var(--paper)", fontSize: 12, fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer", transition: "border-color 120ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--line)"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.borderColor = "var(--line-soft)"; }}
      >
        <span style={{ color: "var(--paper-3)", display: "inline-flex" }}>{Icon.wallet(13)}</span>
        <QuoteMintIcon label={activeQuote.label} size={14} />
        {balText}
        <ChainChevron open={open} />
      </button>
      {open && (
        <WalletSelectorPopup
          anchorRef={pillRef}
          inline
          footer={payWith}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function ConnectedMenu() {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <ChainPicker />
      <WalletBalanceMenu />
    </div>
  );
}

function ScrollableNav({
  items,
  pathname,
  isActive,
  onNavigate,
}: {
  items: typeof NAV;
  pathname: string;
  isActive: (path: string) => boolean;
  onNavigate: (path: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollHints = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 1);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  const scrollBy = useCallback((delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  useEffect(() => {
    updateScrollHints();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollHints, { passive: true });
    const ro = new ResizeObserver(updateScrollHints);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollHints);
      ro.disconnect();
    };
  }, [updateScrollHints, items]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const activeBtn = el.querySelector('[data-nav-active="true"]') as HTMLElement | null;
    activeBtn?.scrollIntoView({ inline: "nearest", block: "nearest" });
    requestAnimationFrame(updateScrollHints);
  }, [pathname, updateScrollHints]);

  return (
    <div style={{
      position: "relative",
      display: "flex",
      alignItems: "center",
      minWidth: 0,
      // Content-sized (not flex:1) so the header's `auto` nav column resolves to
      // the full tab strip and every title shows; it only shrinks/scrolls when
      // the viewport genuinely can't fit it.
      flex: "0 1 auto",
      marginLeft: 8,
    }}>
      <style>{`.topbar-nav-scroll::-webkit-scrollbar{display:none}
.raze-navbtn{display:inline-flex;align-items:center;padding:6px 10px;font-size:12px;font-weight:500;color:var(--paper);background:transparent;border:0;border-radius:5px;white-space:nowrap;flex-shrink:0;cursor:pointer;font-family:inherit;transition:color 120ms,background 120ms}
.raze-navbtn:hover{background:color-mix(in oklch, var(--amber) 15%, transparent);color:var(--amber)}
.raze-navbtn[data-nav-active="true"]{color:var(--amber)}
.raze-navbtn[data-nav-active="true"]:hover{background:transparent}`}</style>
      {canScrollLeft && (
        <NavScrollHint side="left" onClick={() => scrollBy(-140)} />
      )}
      <div
        ref={scrollerRef}
        className="topbar-nav-scroll"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          overflowX: "auto",
          overflowY: "hidden",
          minWidth: 0,
          flex: 1,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {items.map((it) => {
          const active = isActive(it.path);
          // Hover is CSS-only (`.raze-navbtn:hover`) — NOT imperative
          // onMouseEnter/Leave, which left the tint stuck on multiple tabs when
          // a re-render or a click-driven layout shift ate the mouseleave.
          // Idle = white, active page = accent text, hover = theme-tinted box.
          return (
            <button
              key={it.id}
              className="raze-navbtn"
              data-nav-active={active ? "true" : undefined}
              onClick={() => onNavigate(it.path)}
            >
              {it.label}
            </button>
          );
        })}
      </div>
      {canScrollRight && (
        <NavScrollHint side="right" onClick={() => scrollBy(140)} />
      )}
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Mobile primary navigation — a ☰ slide-in sheet (left drawer) holding the full
// tab list, plus deep-links into the Holdings/Wallets sidebar. The
// desktop nav strip can't fit on a phone, so it lives here instead.
function MobileNavSheet({
  open,
  onClose,
  nav,
  isActive,
  pathname,
  onNavigate,
  sidebarOpen,
  toggleSidebar,
}: {
  open: boolean;
  onClose: () => void;
  nav: NavItem[];
  isActive: (path: string) => boolean;
  pathname: string;
  onNavigate: (path: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const openSidebarPage = (page: "holdings" | "wallets") => {
    try { window.localStorage.setItem(SIDEBAR_PAGE_KEY, page); } catch { /* ignore */ }
    if (!sidebarOpen) toggleSidebar();
    onClose();
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden />
      <div
        className="drawer-panel"
        role="menu"
        aria-label="Main navigation"
        style={{
          width: "min(300px, 86vw)",
          background: "var(--ink-1)",
          borderRight: "1px solid var(--line-soft)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{
          height: 48, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 8px 0 14px",
          borderBottom: "1px solid var(--line-soft)",
        }}>
          <span className="eyebrow" style={{ fontSize: 10, letterSpacing: "0.16em", color: "var(--paper-3)" }}>MENU</span>
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            style={{ ...iconBtn, color: "var(--paper-3)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; e.currentTarget.style.background = "var(--ink-2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-3)"; e.currentTarget.style.background = "transparent"; }}
          >
            {Icon.close(16)}
          </button>
        </div>

        <nav style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {nav.map((it) => {
            const active = isActive(it.path);
            return (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                onClick={() => onNavigate(it.path)}
                style={{
                  display: "flex", alignItems: "center",
                  width: "100%", height: 46, padding: "0 14px",
                  border: 0, borderRadius: 8,
                  background: active ? "color-mix(in oklch, var(--amber) 15%, transparent)" : "transparent",
                  color: active ? "var(--amber)" : "var(--paper)",
                  fontSize: 15, fontWeight: active ? 600 : 500,
                  textAlign: "left", cursor: "pointer",
                  transition: "background 120ms, color 120ms",
                }}
              >
                {it.label}
              </button>
            );
          })}
        </nav>

        <div style={{ flexShrink: 0, borderTop: "1px solid var(--line-soft)", padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          <MobileChainPicker onPicked={onClose} />
          <MobileSheetSecondary label="Holdings" onClick={() => openSidebarPage("holdings")} />
          <MobileSheetSecondary label="Wallets" onClick={() => openSidebarPage("wallets")} />
        </div>
      </div>
    </>
  );
}

function MobileChainPicker({ onPicked }: { onPicked: () => void }) {
  const { chainId, setChain, chains } = useChain();
  return (
    <div style={{ padding: "6px 6px 10px" }}>
      <div className="eyebrow" style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--paper-4)", padding: "0 8px 8px" }}>CHAIN</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
        {chains.map((c) => {
          const active = c.id === chainId;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={active}
              aria-label={c.name}
              onClick={() => {
                if (c.id !== chainId) setChain(c.id);
                onPicked();
              }}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                padding: "8px 2px",
                border: `1px solid ${active ? "var(--accent)" : "var(--line-soft)"}`,
                borderRadius: 8,
                background: active ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "var(--ink-0)",
                color: active ? "var(--paper)" : "var(--paper-3)",
                cursor: "pointer",
              }}
            >
              <ChainIcon id={c.id} size={16} />
              <span className="mono" style={{ fontSize: 8, letterSpacing: "0.04em" }}>{c.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MobileSheetSecondary({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center",
        width: "100%", height: 40, padding: "0 14px",
        border: 0, borderRadius: 8, background: "transparent",
        color: "var(--paper-2)", fontSize: 13, fontWeight: 500,
        textAlign: "left", cursor: "pointer",
        transition: "background 120ms, color 120ms",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; e.currentTarget.style.color = "var(--paper)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--paper-2)"; }}
    >
      {label}
    </button>
  );
}

function NavScrollHint({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const isLeft = side === "left";
  return (
    <button
      type="button"
      aria-label={isLeft ? "Scroll navigation left" : "Scroll navigation right"}
      onClick={onClick}
      style={{
        position: "absolute",
        [isLeft ? "left" : "right"]: 0,
        top: 0,
        bottom: 0,
        width: 28,
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        background: isLeft
          ? "linear-gradient(to left, transparent, var(--ink-1) 60%)"
          : "linear-gradient(to right, transparent, var(--ink-1) 60%)",
        border: 0,
        cursor: "pointer",
        color: "var(--paper-3)",
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      {isLeft ? "‹" : "›"}
    </button>
  );
}

function SidebarChevron({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <svg
      role="button"
      tabIndex={0}
      aria-label={open ? "Hide sidebar" : "Show sidebar"}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={{
        cursor: "pointer",
        color: "var(--paper-3)",
        transform: open ? "rotate(0deg)" : "rotate(180deg)",
        transition: "transform 180ms ease, color 120ms",
        outline: "none",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-3)")}
    >
      <path d="M9 3 L5 7 L9 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChainChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      style={{ display: "block", color: "var(--paper-4)", marginLeft: 1 }}
    >
      <path
        d="M2.2 3.6 5 6.4l2.8-2.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          transform: open ? "rotate(180deg)" : "none",
          transformOrigin: "50% 50%",
          transition: "transform 120ms",
        }}
      />
    </svg>
  );
}
