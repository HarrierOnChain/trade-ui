"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClientNav } from "./ClientPages";
import { BrandMark, ChainIcon, Icon, QuoteAssetIcon, Tooltip } from "../atoms";
import type { BrandMarkHandle } from "../atoms/BrandMark";
import { useApp } from "../../contexts/AppContext";
import { useRegion } from "../../contexts/RegionContext";
import { useChain } from "../../contexts/ChainContext";
import { BackendClient, useSession, writeSession } from "../../api/backend";
import { useUserWallets } from "../../hooks/useUserWallets";
import { useUserPreference } from "../../hooks/useUserPreference";
import { useIsPhone, useIsMobile } from "../../hooks/useMediaQuery";
import { useAppZoom } from "../../contexts/AppZoomContext";
import { quoteMints, defaultQuoteMint, findQuoteMint } from "../../lib/quoteMints";
import { PREF_KEYS } from "../TradingPanel/presets";
import { useLiveAlerts } from "../../contexts/LiveAlertsContext";
import { LiveAlertsPanel } from "./LiveAlertsPanel";
import { SettingsModal } from "./SettingsModal";
import { WalletSelectorPopup } from "../TradingPanel/WalletSelectorPopup";
import { useNotifAlerts } from "../../hooks/useNotifPrefs";

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
// the mobile menu's "Live Tape" / "Wallets" entries to the right sidebar page
// (Sidebar unmounts while closed, so it re-reads this on the next open).
const SIDEBAR_PAGE_KEY = "spool.sidebar.page";

type NavItem = { id: string; label: string; path: string; icon: React.ReactNode; cta?: boolean };

const NAV: NavItem[] = [
  { id: "monitor", label: "Monitor", path: "/monitor", icon: Icon.eyeLine(12) },
  { id: "portfolio", label: "Portfolio", path: "/portfolio", icon: Icon.portfolio(12) },
  {
    id: "swap", label: "Swap", path: "/swap",
    icon: (
      <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 5h9l-2.5-2.5M13 11H4l2.5 2.5" />
      </svg>
    ),
  },
  { id: "deploy", label: "Deploy", path: "/deploy", icon: Icon.rocket(12), cta: true },
];

export function TopBar() {
  const { navigate, activePath } = useClientNav();
  const pathname = activePath;
  const { authed, setSearchOpen, sidebarOpen, toggleSidebar, sysConfig, openAuthModal } = useApp();
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
          <BrandMark ref={brandRef} size={40} ariaLabel="Go to Monitor" onClick={() => navigate("/monitor")} />
          <div style={{ flex: 1, minWidth: 0 }} />
          <HeaderSearchButton onOpen={openSearch} />
          <AlertBell />
          {authed ? (
            <ConnectedMenu />
          ) : (
            <button
              type="button"
              aria-label="Log in or sign up"
              onClick={openAuthModal}
              style={{ ...iconBtn, color: "var(--paper-2)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; e.currentTarget.style.background = "var(--ink-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-2)"; e.currentTarget.style.background = "transparent"; }}
            >
              {Icon.userLine(18)}
            </button>
          )}
          {authed && <SettingsButton />}
        </header>
        <MobileNavSheet
          open={navOpen}
          onClose={() => setNavOpen(false)}
          nav={nav}
          isActive={isActive}
          pathname={pathname}
          onNavigate={(p) => { navigate(p); setNavOpen(false); }}
          onDeploy={() => { navigate("/deploy"); setNavOpen(false); }}
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
      // Nav column is `max-content` so the full tab strip (incl. the Deploy
      // CTA) NEVER shrinks or scrolls on desktop — the search (the 1fr column,
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
            onClick={() => navigate("/monitor")}
          />
        </div>
        <ScrollableNav
          items={nav}
          pathname={pathname}
          isActive={isActive}
          onNavigate={navigate}
          onDeploy={() => navigate("/deploy")}
        />
      </div>

      {!searchCompact && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          width: "100%", minWidth: 0,
          // Search hugs the right end of its column, next to the alert bell /
          // account cluster; the header grid gap keeps the breathing room.
          justifyContent: "flex-end",
        }}>
          <HeaderSearchBar onOpen={openSearch} />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: isPhone ? 4 : 10 }}>
        {searchCompact && <HeaderSearchButton onOpen={openSearch} />}
        <AlertBell />
        {!authed && <UnifiedChainBar />}
        {authed ? (
          <ConnectedMenu />
        ) : sysConfig?.publicViewEnabled ? (
          <>
            <button
              type="button"
              onClick={openAuthModal}
              className="mono"
              style={{
                padding: "0 14px", height: 32, fontSize: 11,
                letterSpacing: "0.06em", textTransform: "uppercase",
                color: "var(--paper-2)",
                background: "transparent",
                border: "1px solid var(--line-soft)",
                borderRadius: 4, cursor: "pointer",
                transition: "border-color 120ms, color 120ms",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--amber)"; e.currentTarget.style.color = "var(--paper)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line-soft)"; e.currentTarget.style.color = "var(--paper-2)"; }}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={openAuthModal}
              className="mono"
              style={{
                padding: "0 14px", height: 32, fontSize: 11,
                letterSpacing: "0.06em", textTransform: "uppercase",
                color: "var(--ink-0)",
                background: "var(--amber)",
                border: "1px solid var(--amber)",
                borderRadius: 4, cursor: "pointer",
                transition: "opacity 120ms",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
            >
              Sign up
            </button>
          </>
        ) : null}
        {authed && <SettingsButton />}
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

function SettingsButton() {
  const { setAuthed, pushToast, openSettings } = useApp();
  const { region } = useRegion();
  const session = useSession();
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

  async function disconnect() {
    if (session?.token) {
      const client = new BackendClient(region.baseUrl, session.token);
      void client.logout().catch(() => {});
    }
    writeSession(null);
    setAuthed(false);
    pushToast({ title: "DISCONNECTED", body: "Session ended", tone: "default" });
  }

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
          <div style={{ height: 1, background: "var(--line-soft)", margin: "4px 6px" }} />
          <SettingsMenuItem
            danger
            icon={
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M5 2H2.5A.5.5 0 0 0 2 2.5v7a.5.5 0 0 0 .5.5H5M8 8.5 10.5 6 8 3.5M4.5 6h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            label="Log Out"
            onClick={() => { setOpen(false); void disconnect(); }}
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

function AlertBell() {
  const { unreadCount, panelOpen, setPanelOpen } = useLiveAlerts();
  const [alertsEnabled] = useNotifAlerts();
  if (!alertsEnabled) return null;
  return (
    <div style={{ position: "relative" }}>
      <Tooltip content="Alerts" placement="bottom">
        <button
          style={{ ...iconBtn, color: panelOpen ? "var(--paper)" : "var(--paper-3)" }}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          <span style={{ position: "relative" }}>
            {Icon.bell(14)}
            {/* Badge only while there are UNREAD items — once the panel has
                been opened (markRead) the bell goes back to bare. */}
            {unreadCount > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -5,
                minWidth: 14, height: 14,
                background: "var(--accent)", color: "var(--ink-0)",
                borderRadius: 999,
                fontSize: 8, fontWeight: 700,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "0 3px",
                letterSpacing: 0,
                lineHeight: 1,
              }}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </span>
        </button>
      </Tooltip>
      <LiveAlertsPanel />
    </div>
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
  const phantom = useMemo(
    () => userWallets.wallets.find((w) => w.isConnected) ?? null,
    [userWallets.wallets],
  );
  const isDemoMode = useMemo(
    () => userWallets.activeWallets.some((w) => w.kind === "DEMO"),
    [userWallets.activeWallets],
  );
  const activePlatforms = useMemo(
    () => userWallets.activeWallets.filter((w) => w.kind === "PLATFORM"),
    [userWallets.activeWallets],
  );
  const usingPhantom = !isDemoMode && activePlatforms.length === 0 && !!phantom;
  const wallets = usingPhantom ? (phantom ? [phantom] : []) : userWallets.activeWallets;

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

function UnifiedChainBar({
  embedded = false,
  anchorRef,
  renderBar,
}: {
  embedded?: boolean;
  anchorRef?: React.RefObject<HTMLDivElement | null>;
  renderBar?: (segments: React.ReactNode) => React.ReactNode;
}) {
  const { authed } = useApp();
  const { chainId, setChain, chains } = useChain();
  const { quoteBalances } = useActiveWalletBalances();
  const [quoteOpen, setQuoteOpen] = useState(false);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = anchorRef ?? innerRef;
  const [buyInputLabel, setBuyInputLabel] = useUserPreference<string>(PREF_KEYS.buyInputMint, defaultQuoteMint().label);
  const [, setSellOutputLabel] = useUserPreference<string>(PREF_KEYS.sellOutputMint, defaultQuoteMint().label);
  const activeQuote = findQuoteMint(buyInputLabel, chainId);
  const quotes = quoteMints(chainId);
  const canSwitchQuote = quotes.length > 1;

  const selectQuote = (label: string) => {
    setBuyInputLabel(label);
    setSellOutputLabel(label);
    setQuoteOpen(false);
  };

  const switchChain = (id: typeof chainId) => {
    if (id === chainId) return;
    setQuoteOpen(false);
    setChain(id);
  };

  useEffect(() => {
    if (!quoteOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setQuoteOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setQuoteOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [quoteOpen, rootRef]);

  const quoteBal = quoteBalances[activeQuote.label];
  const quoteLoading = authed && !!quoteBal?.loading;
  const quoteValue = authed ? (quoteBal?.value ?? 0) : 0;

  const chainSegments = (
    <>
      {chains.map((c, i) => {
        const active = c.id === chainId;
        return (
          <React.Fragment key={c.id}>
            {i > 0 && (
              <span
                aria-hidden="true"
                style={{ width: 1, alignSelf: "stretch", background: "var(--line-soft)", flexShrink: 0, margin: "6px 0" }}
              />
            )}
            <Tooltip
              content={
                active
                  ? canSwitchQuote
                    ? `${c.name} · ${activeQuote.label} quote — click to switch`
                    : `${c.name} · active chain`
                  : `Switch to ${c.name}`
              }
              placement="bottom"
            >
              <button
                type="button"
                aria-pressed={active}
                aria-label={c.name}
                aria-haspopup={active && canSwitchQuote ? "listbox" : undefined}
                aria-expanded={active && canSwitchQuote ? quoteOpen : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (active && canSwitchQuote) {
                    setQuoteOpen((o) => !o);
                    return;
                  }
                  if (!active) switchChain(c.id);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: active ? "0 10px" : "0 8px",
                  height: 30,
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  opacity: active ? 1 : 0.45,
                  transition: "opacity 150ms",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.opacity = "0.7";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.opacity = "0.45";
                }}
              >
                {active
                  ? <QuoteMintIcon label={activeQuote.label} size={14} />
                  : <ChainIcon id={c.id} size={14} />}
                {active && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--paper)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {quoteLoading ? "…" : formatQuoteBalance(quoteValue)}
                  </span>
                )}
                {!active && (
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: "var(--paper-3)", letterSpacing: "0.04em" }}
                  >
                    {c.label}
                  </span>
                )}
                {active && canSwitchQuote && <ChainChevron open={quoteOpen} />}
              </button>
            </Tooltip>
          </React.Fragment>
        );
      })}
    </>
  );

  const quoteDropdown = quoteOpen ? (
    <div
      role="listbox"
      aria-label={`Quote on ${chains.find((c) => c.id === chainId)?.name ?? "chain"}`}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 4,
        width: 168,
        background: "var(--ink-1)",
        border: "1px solid var(--line-soft)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        padding: 4,
        zIndex: 50,
      }}
    >
      {quotes.map((q) => {
        const active = activeQuote.label === q.label;
        const bal = quoteBalances[q.label];
        return (
          <button
            key={q.label}
            type="button"
            role="option"
            aria-selected={active}
            onClick={(e) => { e.stopPropagation(); selectQuote(q.label); }}
            className="mono"
            style={{
              display: "grid",
              gridTemplateColumns: "18px minmax(0, 1fr) auto 8px",
              alignItems: "center",
              gap: 8,
              width: "100%",
              minHeight: 30,
              padding: "5px 8px",
              border: 0,
              background: active ? "var(--ink-2)" : "transparent",
              color: active ? "var(--paper)" : "var(--paper-2)",
              fontSize: 11,
              cursor: "pointer",
              borderRadius: 4,
              textAlign: "left",
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--ink-2)"; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
          >
            <QuoteMintIcon label={q.label} size={16} />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontWeight: 600 }}>
              {q.label}
            </span>
            <span style={{ color: "var(--paper-3)", fontVariantNumeric: "tabular-nums" }}>
              {authed && bal?.loading ? "…" : formatQuoteBalance(bal?.value ?? 0)}
            </span>
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: active ? "var(--accent)" : "transparent",
                boxShadow: active ? "0 0 7px color-mix(in oklch, var(--accent) 65%, transparent)" : "none",
              }}
            />
          </button>
        );
      })}
    </div>
  ) : null;

  if (embedded && renderBar) {
    return (
      <>
        {renderBar(chainSegments)}
        {quoteDropdown}
      </>
    );
  }

  if (embedded) {
    return <>{chainSegments}{quoteDropdown}</>;
  }

  return (
    <div
      ref={innerRef}
      style={{ position: "relative", display: "inline-flex" }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: 32,
          padding: 0,
          gap: 0,
          background: "var(--ink-0)",
          border: "1px solid var(--line-soft)",
          borderRadius: 6,
          flexShrink: 0,
          transition: "border-color 120ms",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line-soft)")}
      >
        {chainSegments}
      </div>
      {quoteDropdown}
    </div>
  );
}

function ConnectedMenu() {
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const walletBarRef = useRef<HTMLDivElement | null>(null);
  const userWallets = useUserWallets();

  const isDemoMode = useMemo(
    () => userWallets.activeWallets.some((w) => w.kind === "DEMO"),
    [userWallets.activeWallets],
  );

  const phantom = useMemo(
    () => userWallets.wallets.find((w) => w.isConnected) ?? null,
    [userWallets.wallets],
  );
  const activePlatforms = useMemo(
    () => userWallets.activeWallets.filter((w) => w.kind === "PLATFORM"),
    [userWallets.activeWallets],
  );
  const usingPhantom = !isDemoMode && activePlatforms.length === 0 && !!phantom;

  return (
    <div ref={menuRootRef} style={{ position: "relative", display: "inline-block" }}>
      <UnifiedChainBar
        embedded
        anchorRef={menuRootRef}
        renderBar={(segments) => (
          <Tooltip
            content={isDemoMode ? "Demo mode · trades simulate against live prices, no on-chain activity" : null}
            placement="bottom"
          >
            <div
              ref={walletBarRef}
              style={{
                display: "inline-flex", alignItems: "center",
                height: 32, padding: 0, gap: 0,
                background: "var(--ink-0)",
                border: isDemoMode ? "1px solid #ffb020" : "1px solid var(--line-soft)",
                borderRadius: 6,
                transition: "border-color 120ms",
              }}
              onMouseEnter={(e) => {
                if (!isDemoMode) e.currentTarget.style.borderColor = "var(--line)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = isDemoMode ? "#ffb020" : "var(--line-soft)";
              }}
            >
              {segments}
              <span style={{ width: 1, alignSelf: "stretch", background: "var(--line-soft)", flexShrink: 0, margin: "6px 0" }} />
              <Tooltip content={usingPhantom ? "Phantom signer · select platform wallets" : "Select wallets"} placement="bottom">
                <button
                  type="button"
                  aria-label={usingPhantom ? "Phantom signer · open wallet picker" : "Select wallets"}
                  aria-haspopup="dialog"
                  aria-expanded={walletPickerOpen}
                  onClick={() => setWalletPickerOpen((v) => !v)}
                  style={{
                    display: "inline-flex", alignItems: "center",
                    height: 30, padding: "0 9px",
                    background: "transparent", border: 0,
                    color: "var(--paper-3)", cursor: "pointer",
                    transition: "color 120ms",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-3)")}
                >
                  {usingPhantom ? Icon.phantom(13) : Icon.wallet(13)}
                </button>
              </Tooltip>
            </div>
          </Tooltip>
        )}
      />
      {walletPickerOpen && (
        <WalletSelectorPopup
          anchorRef={walletBarRef}
          inline
          onClose={() => setWalletPickerOpen(false)}
        />
      )}
    </div>
  );
}

function ScrollableNav({
  items,
  pathname,
  isActive,
  onNavigate,
  onDeploy,
}: {
  items: typeof NAV;
  pathname: string;
  isActive: (path: string) => boolean;
  onNavigate: (path: string) => void;
  onDeploy: () => void;
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
@keyframes razeShineSpin{to{rotate:360deg}}
@media (prefers-reduced-motion: reduce){.raze-shine-glow{animation:none!important}}
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
          if (it.cta) {
            return (
              <div
                key={it.id}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  margin: "0 4px 0 6px", flexShrink: 0,
                }}
              >
                <NavDivider />
                <NavCtaButton
                  item={it}
                  active={active}
                  onClick={onDeploy}
                />
              </div>
            );
          }
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
// tab list + the Deploy CTA, plus deep-links into the Tape/Wallets sidebar. The
// desktop nav strip can't fit on a phone, so it lives here instead.
function MobileNavSheet({
  open,
  onClose,
  nav,
  isActive,
  pathname,
  onNavigate,
  onDeploy,
  sidebarOpen,
  toggleSidebar,
}: {
  open: boolean;
  onClose: () => void;
  nav: NavItem[];
  isActive: (path: string) => boolean;
  pathname: string;
  onNavigate: (path: string) => void;
  onDeploy: () => void;
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

  const openSidebarPage = (page: "tape" | "wallets") => {
    try { window.localStorage.setItem(SIDEBAR_PAGE_KEY, page); } catch { /* ignore */ }
    if (!sidebarOpen) toggleSidebar();
    onClose();
  };

  const deploy = nav.find((n) => n.cta);
  const items = nav.filter((n) => !n.cta);

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

        {deploy && (
          <div style={{ padding: 12, flexShrink: 0 }}>
            <button
              type="button"
              onClick={onDeploy}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                width: "100%", height: 46,
                background: "var(--amber)", color: "var(--ink-0)",
                border: 0, borderRadius: 9,
                fontSize: 14, fontWeight: 700, letterSpacing: "0.01em",
                cursor: "pointer",
                boxShadow: "0 0 16px color-mix(in oklch, var(--amber) 30%, transparent)",
              }}
            >
              {deploy.icon}
              {deploy.label}
            </button>
          </div>
        )}

        <nav style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {items.map((it) => {
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
          <MobileSheetSecondary label="Live Tape" onClick={() => openSidebarPage("tape")} />
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

// Vertical faded divider (SVG gradient, no asset) — sets the Deploy CTA apart
// from the rest of the nav group. Sized to the 48px header.
function NavDivider() {
  return (
    <svg
      aria-hidden="true"
      width="1"
      height="24"
      viewBox="0 0 1 54"
      fill="none"
      style={{ flexShrink: 0, userSelect: "none", pointerEvents: "none", display: "block" }}
    >
      <line x1="0.5" y1="0" x2="0.500002" y2="54" stroke="url(#hdrDivider)" />
      <defs>
        <linearGradient id="hdrDivider" x1="-0.5" y1="0" x2="-0.499998" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#999999" stopOpacity="0" />
          <stop offset="0.495192" stopColor="#999999" />
          <stop offset="1" stopColor="#999999" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Primary "Deploy" CTA — animated shine border (rotating conic-gradient arm)
// so it reads as THE call-to-action in an otherwise monochrome nav. The outer
// wrap is the border (its padding = border thickness) with a spinning glow
// clipped by overflow:hidden; the inner sits on top. Colors are Raze accent
// (amber + white hot-spot) instead of the source purple. When on /deploy the
// text stays accent so the active state still registers.
function NavCtaButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-nav-active={active ? "true" : undefined}
      onClick={onClick}
      aria-label={item.label}
      style={{
        position: "relative",
        display: "inline-flex",
        padding: "2px",                // shine border thickness
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--ink-0)",    // base under the glow
        border: 0,
        cursor: "pointer",
        flexShrink: 0,
        lineHeight: 0,
      }}
      onMouseEnter={(e) => {
        const inner = e.currentTarget.querySelector<HTMLElement>("[data-shine-inner]");
        if (inner) inner.style.color = "var(--amber)";
      }}
      onMouseLeave={(e) => {
        const inner = e.currentTarget.querySelector<HTMLElement>("[data-shine-inner]");
        if (inner) inner.style.color = active ? "var(--amber)" : "var(--paper)";
      }}
    >
      <span
        className="raze-shine-glow"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "170%",
          aspectRatio: "1",
          translate: "-50% -50%",       // stays centered; `rotate` animates on top
          background:
            "conic-gradient(from 0deg, transparent 0deg, transparent 250deg, var(--amber) 306deg, #fff 324deg, var(--amber) 342deg, transparent 360deg)",
          animation: "razeShineSpin 3s linear infinite",
          pointerEvents: "none",
        }}
      />
      <span
        data-shine-inner
        style={{
          position: "relative",
          zIndex: 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 24,
          padding: "0 13px",
          borderRadius: 6,
          background: "var(--ink-1)",
          color: active ? "var(--amber)" : "var(--paper)",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          transition: "color 140ms",
        }}
      >
        {item.icon}
        {item.label}
      </span>
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
