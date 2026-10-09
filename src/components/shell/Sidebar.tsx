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
import { useAlertStream } from "../../hooks/useAlertStream";
import { useDeployStream } from "../../hooks/useDeployStream";
import { useMigratingStream } from "../../hooks/useMigratingStream";
import { useMigrationStream } from "../../hooks/useMigrationStream";
import {
  useWalletTradeStream,
  type StreamWallet,
  type WalletTradeAlert,
} from "../../hooks/useWalletTradeStream";
import { Icon, QuoteAssetIcon, SolAmount, TokenIcon, Tooltip } from "../atoms";
import type { QuoteMint } from "../../lib/quoteMints";
import { fmtMcap, fmtNum, fmtUsd, shortAddr } from "../../lib/format";
import { formatAge, registerAge, unregisterAge } from "../../lib/ageRegistry";
import {
  PORTFOLIO_STORAGE_KEY,
  readUserWallets,
} from "../../lib/userWalletsMirror";
import { useHiddenMints } from "../../lib/hiddenTokens";
import { useRowImage } from "../../hooks/useRowImage";
import type { TokenEvent } from "../../types";
import {
  useTapeKinds,
  TAPE_KINDS,
  TAPE_VIEW_LABEL,
  type TapeKind,
} from "../../hooks/useTapeKinds";

type SidebarPage = "tape" | "wallets";
type WalletsView = "wallets" | "holdings";

const WALLETS_VIEW_OPTS: { id: WalletsView; label: string }[] = [
  { id: "wallets", label: "Wallets" },
  { id: "holdings", label: "Holdings" },
];

// Subset that maps to TokenEvent rows (TapeRow). The rest of the kinds
// render with their own components, so TapeItem stays narrow to keep
// TapeRow's prop shape unchanged.
type TokenEventKind = "deploy" | "migrating" | "migration" | "trending";
type TapeItem = TokenEvent & { _kind: TokenEventKind; _ts: number };

const SIDEBAR_PAGE_KEY = "spool.sidebar.page";
const TAPE_LIMIT = 60;

const PAGES: { id: SidebarPage; label: string }[] = [
  { id: "tape", label: "Tape" },
  { id: "wallets", label: "Wallets" },
];

const TAPE_EMPTY_COPY: Record<TapeKind, string> = {
  deploy: "Waiting for deploys…",
  migrating: "Waiting for migrating tokens…",
  migration: "Waiting for migrations…",
  trending: "Waiting for trending tokens…",
  mine: "Waiting for trades on your wallets…",
};

interface StoredWallet {
  id: string;
  label: string;
  address: string;
  createdAt: string;
  active?: boolean;
  /** Wallet kind; WATCH has no key (no quick trade). */
  kind?: "PLATFORM" | "WATCH";
}

function readStoredPage(): SidebarPage {
  if (typeof window === "undefined") return "tape";
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PAGE_KEY);
    if (raw === "tape" || raw === "wallets") return raw;
  } catch {
    /* ignore */
  }
  return "tape";
}

interface DropdownOption {
  key: string;
  label: string;
  active: boolean;
  accent: string; // small side-dot color (kind tone)
  onToggle: () => void;
}

function HeaderDropdown({
  title,
  side,
  options,
}: {
  title: string;
  /** Which edge of the active tab the attached menu should align to. */
  side: "left" | "center" | "right";
  options: DropdownOption[];
}) {
  const selected = options.filter((o) => o.active).length;
  const total = options.length;
  const anchorStyle: React.CSSProperties =
    side === "left"
      ? { left: 0 }
      : side === "right"
        ? { right: 0 }
        : { left: "50%", transform: "translateX(-50%)" };

  return (
    <div
      role="menu"
      style={{
        position: "absolute",
        top: "calc(100% - 1px)",
        ...anchorStyle,
        width: side === "center" ? 178 : 188,
        background: "var(--ink-1)",
        border: "1px solid var(--line)",
        borderRadius: side === "left" ? "0 4px 4px 4px" : side === "right" ? "4px 0 4px 4px" : "4px",
        boxShadow: "0 12px 24px -18px rgba(0,0,0,0.7)",
        overflow: "hidden",
        zIndex: 30,
        animation: "dropdownPop 90ms ease-out",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 25,
          padding: "0 9px",
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--ink-2)",
        }}
      >
        <span
          className="mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 8,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--paper-3)",
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: 999,
              background: "var(--accent)",
            }}
          />
          {title}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 8,
            letterSpacing: "0.06em",
            color: selected === 0 ? "var(--sell)" : "var(--paper-3)",
          }}
        >
          {selected}/{total}
        </span>
      </div>

      <div style={{ padding: 3, display: "flex", flexDirection: "column" }}>
        {options.map((opt) => (
          <DropdownCheckItem key={opt.key} option={opt} />
        ))}
      </div>
    </div>
  );
}

function DropdownCheckItem({ option }: { option: DropdownOption }) {
  const { label, active, accent, onToggle } = option;
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={active}
      onClick={onToggle}
      style={{
        display: "grid",
        gridTemplateColumns: "12px minmax(0, 1fr) 6px",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 28,
        padding: "0 8px",
        border: 0,
        borderRadius: 3,
        background: active ? "var(--ink-2)" : "transparent",
        color: active ? "var(--paper)" : "var(--paper-2)",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--ink-2)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 11,
          height: 11,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 2,
          border: "1px solid " + (active ? "var(--accent)" : "var(--line)"),
          background: active ? "var(--accent)" : "var(--ink-1)",
          transition: "background 0.12s, border-color 0.12s",
          flexShrink: 0,
        }}
      >
        {active && (
          <svg width={8} height={8} viewBox="0 0 9 9" fill="none">
            <path
              d="M1 4.5 L3.5 7 L8 1.5"
              stroke="oklch(0.14 0.006 65)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>

      <span
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: active ? 600 : 500,
        }}
      >
        {label}
      </span>

      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: accent,
          opacity: active ? 1 : 0.35,
          transition: "opacity 0.12s",
          flexShrink: 0,
        }}
      />
    </button>
  );
}

export function Sidebar() {
  const tapeMenuRef = useRef<HTMLDivElement>(null);
  const { sidebarOpen: open, toggleSidebar } = useApp();
  const isMobile = useIsMobile();

  const [page, setPage] = useState<SidebarPage>("tape");
  const { kinds: tapeKinds, toggleKind: toggleTapeKind } = useTapeKinds();
  const [tapeMenuOpen, setTapeMenuOpen] = useState(false);
  const [walletsMenuOpen, setWalletsMenuOpen] = useState(false);
  const [walletsView, setWalletsView] = useUserPreference<WalletsView>("sidebar.walletsView", "wallets");

  useEffect(() => {
    setPage(readStoredPage());
  }, []);

  const selectPage = (next: SidebarPage) => {
    if (next === "tape" && page === "tape") {
      setWalletsMenuOpen(false);
      setTapeMenuOpen((prev) => !prev);
      return;
    }
    if (next === "wallets" && page === "wallets") {
      setTapeMenuOpen(false);
      setWalletsMenuOpen((prev) => !prev);
      return;
    }
    setTapeMenuOpen(false);
    setWalletsMenuOpen(false);
    setPage(next);
    try {
      window.localStorage.setItem(SIDEBAR_PAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  // Outside-click / Escape closes header dropdowns.
  useEffect(() => {
    if (!tapeMenuOpen && !walletsMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!tapeMenuRef.current?.contains(event.target as Node)) {
        setTapeMenuOpen(false);
        setWalletsMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTapeMenuOpen(false);
        setWalletsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [tapeMenuOpen, walletsMenuOpen]);

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
        ref={tapeMenuRef}
        style={{
          height: 48,
          padding: "0 8px",
          borderBottom: "1px solid var(--line-soft)",
          display: "flex", alignItems: "center", gap: 2,
          flexShrink: 0,
          position: "relative",
        }}
      >
        <div style={{ display: "flex", gap: 2, flex: 1, minWidth: 0, alignItems: "center" }}>
          {PAGES.map((p, idx) => {
            const active = page === p.id;
            const isTape = p.id === "tape";
            const isWallets = p.id === "wallets";
            const hasMenu = isTape || isWallets;
            const menuOpen = (isTape && tapeMenuOpen) || (isWallets && walletsMenuOpen);
            const isFirst = idx === 0;
            const isLast = idx === PAGES.length - 1;

            const tapeOpts: DropdownOption[] = isTape
              ? TAPE_KINDS.map((k) => ({
                  key: k,
                  label: TAPE_VIEW_LABEL[k],
                  active: tapeKinds.includes(k),
                  accent:
                    k === "deploy"
                      ? "var(--buy)"
                      : k === "migration"
                        ? "var(--accent)"
                        : "var(--paper)",
                  onToggle: () => toggleTapeKind(k),
                }))
              : [];

            const walletsOpts: DropdownOption[] = isWallets
              ? WALLETS_VIEW_OPTS.map((v) => ({
                  key: v.id,
                  label: v.label,
                  active: walletsView === v.id,
                  accent: "var(--accent)",
                  onToggle: () => {
                    setWalletsView(v.id);
                    setWalletsMenuOpen(false);
                  },
                }))
              : [];

            return (
              <div
                key={p.id}
                style={{ flex: 1, minWidth: 0, position: "relative" }}
              >
                <Tooltip content={
                  isTape && active ? "Change tape feed"
                    : isWallets && active ? "Change wallets view"
                    : null
                }>
                <button
                  onClick={() => selectPage(p.id)}
                  aria-haspopup={hasMenu ? "menu" : undefined}
                  aria-expanded={hasMenu ? menuOpen : undefined}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 500,
                    border: "1px solid transparent",
                    borderColor: menuOpen
                      ? "var(--line-soft)"
                      : active
                        ? "transparent"
                        : "transparent",
                    borderBottomColor: menuOpen ? "var(--ink-1)" : "transparent",
                    borderRadius: menuOpen ? "4px 4px 0 0" : 4,
                    background: menuOpen || active ? "var(--ink-2)" : "transparent",
                    color: active ? "var(--paper)" : "var(--paper-3)",
                    cursor: "pointer",
                    textAlign: "center",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    transition: "background 120ms, color 120ms, border-color 120ms",
                  }}
                >
                  <span>
                    {isWallets && active
                      ? (WALLETS_VIEW_OPTS.find((v) => v.id === walletsView)?.label ?? p.label)
                      : p.label}
                  </span>
                  {hasMenu && active && (
                    <span
                      style={{
                        fontSize: 8,
                        opacity: 0.7,
                        fontStyle: "normal",
                        display: "inline-block",
                        transform: menuOpen ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.18s",
                      }}
                    >
                      ▾
                    </span>
                  )}
                </button>
                </Tooltip>

                {isTape && tapeMenuOpen && active && (
                  <HeaderDropdown
                    title="Tape Sources"
                    side={isFirst ? "left" : isLast ? "right" : "center"}
                    options={tapeOpts}
                  />
                )}
                {isWallets && walletsMenuOpen && active && (
                  <HeaderDropdown
                    title="Wallets View"
                    side={isFirst ? "left" : isLast ? "right" : "center"}
                    options={walletsOpts}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {page === "tape" && <TapePage kinds={tapeKinds} />}
      {page === "wallets" && <WalletsPage view={walletsView} />}
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
   Tape page
   ───────────────────────────────────────────────────────────── */

function getTapeEmptyCopy(kinds: TapeKind[]) {
  if (kinds.length === 0) return "Select one or more tape feeds.";
  if (kinds.length === 1) return TAPE_EMPTY_COPY[kinds[0]];
  return "Waiting for selected events…";
}

// Discriminated feed item — one of these per row in the unified Tape.
// Token-event kinds carry a TapeItem, wallet trades carry an alert. Sorted
// purely by `ts`.
type TapeFeedItem =
  | { kind: "token"; ts: number; token: TapeItem }
  | { kind: "alert"; ts: number; alert: WalletTradeAlert };

function TapePage({ kinds }: { kinds: TapeKind[] }) {
  const { navigate } = useClientNav();
  const hiddenMints = useHiddenMints();

  // Token-event sources.
  const { tokens: deploys } = useDeployStream();
  const { tokens: migrating } = useMigratingStream();
  const { tokens: migs } = useMigrationStream();
  const { tokens: trending } = useAlertStream();

  // Wallet source for trade alerts: the user's own wallets.
  const [userWallets, setUserWalletsState] = useState<StreamWallet[]>([]);
  useEffect(() => {
    setUserWalletsState(readUserWallets());
    const onStorage = (e: StorageEvent) => {
      if (e.key === PORTFOLIO_STORAGE_KEY) setUserWalletsState(readUserWallets());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Only subscribe upstream signers when the user has actually selected
  // "mine" — keeps the WS quiet when the tape is showing only token events.
  const tracedWallets = useMemo<StreamWallet[]>(
    () => (kinds.includes("mine") ? userWallets : []),
    [kinds, userWallets],
  );

  const walletStream = useWalletTradeStream(tracedWallets, { maxAlerts: 60, seedLimit: 5 });

  const items = useMemo<TapeFeedItem[]>(() => {
    const out: TapeFeedItem[] = [];
    const selected = new Set(kinds);

    if (selected.has("deploy")) {
      for (const t of deploys || []) {
        if (hiddenMints.has(t.mint_address)) continue;
        const ts = new Date(t.created_at || 0).getTime();
        out.push({ kind: "token", ts, token: { ...t, _kind: "deploy", _ts: ts } });
      }
    }
    if (selected.has("migrating")) {
      // Migrating items are snapshot-derived (no created_at), so fall back
      // to `now` so they still sort to the top when selected.
      const now = Date.now();
      for (const t of migrating || []) {
        if (hiddenMints.has(t.mint_address)) continue;
        const ts = new Date(t.created_at || 0).getTime() || now;
        out.push({ kind: "token", ts, token: { ...t, _kind: "migrating", _ts: ts } });
      }
    }
    if (selected.has("migration")) {
      for (const t of migs || []) {
        if (hiddenMints.has(t.mint_address)) continue;
        const ts = new Date(t.migrated_at || t.created_at || 0).getTime();
        out.push({ kind: "token", ts, token: { ...t, _kind: "migration", _ts: ts } });
      }
    }
    if (selected.has("trending")) {
      for (const t of trending || []) {
        if (hiddenMints.has(t.mint_address)) continue;
        const ts = new Date(t.created_at || 0).getTime();
        out.push({ kind: "token", ts, token: { ...t, _kind: "trending", _ts: ts } });
      }
    }
    if (selected.has("mine")) {
      for (const a of walletStream.alerts) {
        if (hiddenMints.has(a.tokenMint)) continue;
        out.push({ kind: "alert", ts: a.timestamp, alert: a });
      }
    }

    return out.sort((x, y) => y.ts - x.ts).slice(0, TAPE_LIMIT);
  }, [deploys, migrating, migs, trending, walletStream.alerts, kinds, hiddenMints]);

  return (
    <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
      {items.length === 0 && (
        <div style={{
          padding: 24, fontSize: 11, color: "var(--paper-4)",
          textAlign: "center", fontFamily: "var(--font-mono)",
        }}>
          {getTapeEmptyCopy(kinds)}
        </div>
      )}
      {items.map((item, i) => {
        if (item.kind === "token") {
          const t = item.token;
          return (
            <TapeRow
              key={`tk:${t.mint_address || i}:${t._kind}:${t._ts}`}
              t={t}
              rowIndex={i}
              onClick={() => navigate(tokenHref(t.mint_address))}
            />
          );
        }
        return (
          <WalletTradeRow
            key={`al:${item.alert.id}`}
            alert={item.alert}
            onClick={() => navigate(tokenHref(item.alert.tokenMint))}
          />
        );
      })}
    </div>
  );
}

function TapeChip({
  glyph,
  value,
  color = "var(--paper-4)",
  valueColor = "var(--paper-2)",
}: {
  glyph: React.ReactNode;
  value: React.ReactNode;
  color?: string;
  valueColor?: string;
}) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 10,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          color,
          lineHeight: 0,
        }}
      >
        {glyph}
      </span>
      <span style={{ color: valueColor, fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function TapeRow({ t, onClick, rowIndex = 0 }: { t: TapeItem; onClick: () => void; rowIndex?: number }) {
  const ageRef = React.useRef<HTMLSpanElement>(null);
  const resolvedImage = useRowImage(t.mint_address, t.image, rowIndex);
  useEffect(() => {
    const el = ageRef.current;
    if (!el || !t._ts) return;
    el.textContent = formatAge(t._ts);
    registerAge(el, t._ts);
    return () => unregisterAge(el);
  }, [t._ts]);

  const edgeColor =
    t._kind === "migration"
      ? "var(--accent)"
      : t._kind === "trending"
        ? "var(--paper)"
        : t._kind === "migrating"
          ? "var(--accent)"
          : "var(--buy)";

  const ticker = (t.symbol || "").trim() || shortAddr(t.mint_address, 4);

  // Right-rail primary value: mcap > volume24h > liquidity > "NEW".
  let primary: React.ReactNode = null;
  let primaryColor = "var(--paper)";
  if (t.marketCap != null && t.marketCap > 0) {
    primary = fmtMcap(t.marketCap);
  } else if (t.volume24h != null && t.volume24h > 0) {
    primary = `V ${fmtMcap(t.volume24h)}`;
  } else if (t.liquidity != null && t.liquidity > 0) {
    primary = `L ${fmtMcap(t.liquidity)}`;
  } else {
    primary = "NEW";
    primaryColor = "var(--paper-4)";
  }

  // Subline chip set — show whichever fields exist. Cap at 3 chips so the
  // line doesn't wrap on a 264px sidebar.
  const chips: React.ReactNode[] = [];
  if (t.creatorDeploys != null) {
    const devValue = String(t.creatorDeploys);
    chips.push(
      <TapeChip
        key="dev"
        glyph={Icon.dev(10)}
        value={devValue}
        color="var(--paper-3)"
      />,
    );
  }
  if (t.bundlePercentage != null && t.bundlePercentage > 0) {
    const warn = t.bundlePercentage > 10;
    chips.push(
      <TapeChip
        key="b"
        glyph={Icon.bundle(10)}
        value={`${t.bundlePercentage.toFixed(0)}%`}
        color={warn ? "var(--warn)" : "var(--sell)"}
        valueColor={warn ? "var(--warn)" : "var(--paper-2)"}
      />,
    );
  }
  if (t.sniperPercentage != null && t.sniperPercentage > 0 && chips.length < 3) {
    const warn = t.sniperPercentage > 8;
    chips.push(
      <TapeChip
        key="s"
        glyph={Icon.sniper(10)}
        value={`${t.sniperPercentage.toFixed(0)}%`}
        color={warn ? "var(--warn)" : "var(--paper-3)"}
        valueColor={warn ? "var(--warn)" : "var(--paper-2)"}
      />,
    );
  }
  if (t.holders != null && t.holders > 0 && chips.length < 3) {
    chips.push(
      <TapeChip
        key="h"
        glyph={Icon.holders(10)}
        value={fmtNum(t.holders)}
        color="var(--accent)"
      />,
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      className={(t as TokenEvent & { isNew?: boolean }).isNew ? "new-in" : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: "3px 38px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px 9px 0",
        width: "100%",
        borderBottom: "1px solid var(--line-soft)",
        background: "transparent",
        textAlign: "left",
        cursor: "pointer",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ink-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span
        aria-hidden="true"
        style={{ alignSelf: "stretch", background: edgeColor }}
      />
      <TokenIcon
        token={{ mint_address: t.mint_address, symbol: t.symbol, image: resolvedImage }}
        size={38}
      />
      <div
        style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}
      >
        <span
          className="ellipsis"
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--paper)",
            letterSpacing: "0.01em",
            lineHeight: 1.15,
          }}
        >
          {ticker}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            flexWrap: "nowrap",
            overflow: "hidden",
          }}
        >
          {chips}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 3,
          flexShrink: 0,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: primaryColor,
            letterSpacing: "0.02em",
            lineHeight: 1,
          }}
        >
          {primary}
        </span>
        <span
          ref={ageRef}
          className="mono"
          style={{
            fontSize: 9,
            color: "var(--paper-4)",
            letterSpacing: "0.04em",
            lineHeight: 1,
          }}
        >
          {t._ts ? formatAge(t._ts) : ""}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Wallets page
   ───────────────────────────────────────────────────────────── */

function WalletsPage({ view }: { view: WalletsView }) {
  const pathname = usePathname();
  const { navigate } = useClientNav();
  const userWallets = useUserWallets();
  const [quote] = useBuyQuoteMint();
  const [refreshing, setRefreshing] = useState(false);
  const hiddenMints = useHiddenMints();
  const solPrice = useSolPrice() ?? 0;
  const wallets: StoredWallet[] = useMemo(
    () =>
      userWallets.wallets
        .map((w) => ({
          id: w.id,
          label: w.displayLabel,
          address: w.pubkey,
          createdAt: w.createdAt,
          active: userWallets.activeIds.has(w.id),
          kind: w.kind,
        })),
    [userWallets.wallets, userWallets.activeIds],
  );
  const holdingsWallets = wallets;

  const activeMint = useMemo(() => {
    const parsed = pathname ? parseTokenPath(pathname) : null;
    return parsed?.address ?? null;
  }, [pathname]);
  const { info } = useTokenInfo(activeMint);
  const hasToken = !!activeMint;
  const balances = userWallets.balances;
  const hasLiveBalances = wallets.some((w) => (balances[w.id]?.updatedAt ?? 0) > 0);

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

  // ── Holdings view ─ aggregate every token held across all (non-connected)
  // wallets into a single per-mint total, the same way the Portfolio tab does.
  const holdingAgg = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of holdingsWallets) {
      const toks = balances[w.id]?.tokens;
      if (!toks) continue;
      for (const [mint, amt] of Object.entries(toks)) {
        if (!(amt > 0) || hiddenMints.has(mint)) continue;
        m.set(mint, (m.get(mint) ?? 0) + amt);
      }
    }
    return m;
  }, [holdingsWallets, balances, hiddenMints]);
  const holdingMints = useMemo(() => [...holdingAgg.keys()], [holdingAgg]);
  // Only subscribe to live WS prices while the Holdings view is actually open.
  const liveMap = useLiveTradePrices(view === "holdings" ? holdingMints : []);
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

  const handleRefreshBalances = async () => {
    if (refreshing || wallets.length === 0) return;
    setRefreshing(true);
    try {
      await userWallets.refreshBalances();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {view === "wallets" ? (
        <>
          {/* SOL / token balance header */}
          <div style={{
            height: 40, padding: "0 12px",
            borderBottom: "1px solid var(--line-soft)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontFamily: "var(--font-mono)", fontSize: 11,
            color: "var(--accent)",
          }}>
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
              <Tooltip content="Refresh balances">
                <button
                  type="button"
                  onClick={() => void handleRefreshBalances()}
                  disabled={refreshing || wallets.length === 0}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", border: "none", padding: 2,
                    color: "var(--paper-3)", cursor: refreshing || wallets.length === 0 ? "default" : "pointer",
                    opacity: refreshing || wallets.length === 0 ? 0.45 : 1,
                  }}
                >
                  {Icon.refresh(12)}
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Wallet list */}
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {wallets.length === 0 ? (
              <div style={{
                padding: 24, fontSize: 11, color: "var(--paper-4)",
                textAlign: "center", fontFamily: "var(--font-mono)", fontStyle: "italic",
              }}>
                No wallets available. Create or import them in the Wallets tab.
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
        </>
      ) : (
        <>
          {/* Holdings total header */}
          <div style={{
            height: 40, padding: "0 12px",
            borderBottom: "1px solid var(--line-soft)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontFamily: "var(--font-mono)", fontSize: 11,
            color: "var(--accent)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>Total</span>
              <SortGlyph />
              <span>{fmtUsd(holdingsTotalUsd)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--paper-4)" }}>
                {holdingRows.length} token{holdingRows.length === 1 ? "" : "s"}
              </span>
              <Tooltip content="Refresh balances">
                <button
                  type="button"
                  onClick={() => void handleRefreshBalances()}
                  disabled={refreshing || wallets.length === 0}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", border: "none", padding: 2,
                    color: "var(--paper-3)", cursor: refreshing || wallets.length === 0 ? "default" : "pointer",
                    opacity: refreshing || wallets.length === 0 ? 0.45 : 1,
                  }}
                >
                  {Icon.refresh(12)}
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Aggregated holdings list */}
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {holdingRows.length === 0 ? (
              <div style={{
                padding: 24, fontSize: 11, color: "var(--paper-4)",
                textAlign: "center", fontFamily: "var(--font-mono)", fontStyle: "italic",
              }}>
                {hasLiveBalances
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
        </>
      )}
    </div>
  );
}

/// One aggregated-holding row in the Holdings view of the Wallets tab.
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

  // Quick trades need a key and a chain the router swaps on.
  const canTrade = hasToken && swapsOn() && wallet.kind !== "WATCH";
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

/* WalletTradeRow renders a trade of one of the user's wallets in the
   merged Tape feed ("My Wallets" lane). */
function WalletTradeRow({
  alert,
  onClick,
}: {
  alert: WalletTradeAlert;
  onClick: () => void;
}) {
  const ageRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ageRef.current;
    if (!el || !alert.timestamp) return;
    el.textContent = formatAge(alert.timestamp);
    registerAge(el, alert.timestamp);
    return () => unregisterAge(el);
  }, [alert.timestamp]);

  const buy = alert.side === "buy";
  const newBg = `color-mix(in oklch, ${buy ? "var(--buy)" : "var(--sell)"} 10%, transparent)`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "4px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        width: "100%",
        borderBottom: "1px dashed var(--line-soft)",
        background: alert.isNew ? newBg : "transparent",
        textAlign: "left",
        cursor: "pointer",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ink-2)")}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = alert.isNew ? newBg : "transparent";
      }}
    >
      <span style={{
        width: 4, height: 28, borderRadius: 2,
        background: buy ? "var(--buy)" : "var(--sell)",
      }} />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span className="mono" style={{
            fontSize: 9, color: buy ? "var(--buy)" : "var(--sell)",
            letterSpacing: "0.08em", textTransform: "uppercase",
            fontWeight: 600, flexShrink: 0,
          }}>
            {alert.side}
          </span>
          <Tooltip content="My wallet">
            <span
              style={{
                display: "inline-block",
                width: 6, height: 6, borderRadius: 999,
                flexShrink: 0,
                background: "var(--accent)",
              }}
            />
          </Tooltip>
          <span className="mono ellipsis" style={{
            fontSize: 11, color: "var(--paper)",
            minWidth: 0, flex: 1,
          }}>
            {alert.walletLabel}
          </span>
        </div>
        <span className="mono ellipsis" style={{
          fontSize: 9, color: "var(--paper-4)",
          letterSpacing: "0.04em",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          {alert.solAmount > 0 && <SolAmount iconSize={8}>{alert.solAmount.toFixed(3)}</SolAmount>}
          {alert.solAmount > 0 && alert.tokenMint && <span>·</span>}
          {alert.tokenMint && <span>{shortAddr(alert.tokenMint, 4)}</span>}
        </span>
      </div>
      <span ref={ageRef} className="mono" style={{
        fontSize: 10, color: "var(--paper-3)", flexShrink: 0,
      }}>
        {formatAge(alert.timestamp)}
      </span>
    </div>
  );
}
