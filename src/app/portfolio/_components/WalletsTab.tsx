"use client";
/**
 * Wallet manager — reskinned to the Caesar trading app's "Wallet" view, in
 * Raze's green/cream palette. A single bordered card splits into:
 *
 *   • Wallet manager (left) — search + show-hidden toggle + Import / Create,
 *     a column header row, and single-select wallet rows (avatar highlights +
 *     ★ primary + address-copy + SOL balance/USD + token count + hover
 *     actions). A per-row "More" menu keeps the full action set.
 *   • Balance panel (right) — aggregate / target SOL balance with a wallet
 *     picker and 2×2 premium buttons (Receive / Withdraw / Distribute /
 *     Consolidate).
 *
 * Selection is single-wallet, purely cosmetic — it drives the balance panel + which
 * wallet the panel's buttons target. It does NOT re-scope trading (that lives
 * in the top bar and is shown read-only via the "Trading" badge). Every wallet
 * action still routes through the unchanged `actions` contract + modals.
 */

import React, { useMemo, useRef, useState } from "react";
import type { UserWallet } from "../../../hooks/useUserWallets";
import { useIsMobile, useIsPhone } from "../../../hooks/useMediaQuery";
import { useBuyQuoteMint } from "../../../hooks/useBuyQuoteMint";
import type { WalletSummaryItem } from "../../../types";
import {
  InlineEditableLabel, MenuItem, PopoverMenu, PortfolioGlyph,
  EmptyHero, shortAddr,
} from "./atoms";
import { Btn } from "../../../components/atoms";
import { PremiumButton, PillSearch, ShowToggle, UiGlyph } from "./ui";
import { useWalletPrefs, sortByPref } from "./preferences";
import { fmtUsd } from "../../../lib/format";
import { explorerAccountUrl, explorerName } from "../../../lib/chains";
import { WalletAvatar } from "../../../components/WalletAvatar";
import { WalletAvatarPicker } from "./WalletAvatarPicker";

/** Per-wallet actions. No selection/scope here — these all open a modal. */
export interface WalletRowAction {
  send: (w: UserWallet) => void;
  receive: (w: UserWallet) => void;
  fund: (w: UserWallet) => void;
  burn: (w: UserWallet) => void;
  consolidate: (w: UserWallet) => void;
  claimFees: (w: UserWallet) => void;
  exportKey: (w: UserWallet) => void;
  rename: (w: UserWallet) => void;
  delete: (w: UserWallet) => void;
  resetDemo: (w: UserWallet) => void;
  copyAddr: (addr: string) => void;
}

const ROW_COLS = "minmax(0, 5fr) minmax(64px, 3fr) minmax(48px, 1.6fr) minmax(96px, 2fr)";

export function WalletsTab({
  wallets,
  tradingIds,
  summaryByAddr,
  liveBalances,
  solPrice,
  loading,
  onRename,
  actions,
  onCreate,
  onImport,
  onCreateDemo,
}: {
  wallets: UserWallet[];
  /** Read-only: wallet ids in the global trading scope (set in the top bar). */
  tradingIds: Set<string>;
  summaryByAddr: Map<string, WalletSummaryItem>;
  liveBalances: Record<string, { sol: number; tokens: Record<string, number>; loading: boolean }>;
  solPrice: number;
  loading: boolean;
  onRename: (id: string, label: string) => Promise<void>;
  actions: WalletRowAction;
  onCreate: () => void;
  onImport: () => void;
  onCreateDemo: () => void;
}) {
  const prefs = useWalletPrefs();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* ── Filtering / ordering ──────────────────────────────────────────── */

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return wallets;
    return wallets.filter(
      (w) => w.displayLabel.toLowerCase().includes(q) || w.pubkey.toLowerCase().includes(q),
    );
  }, [wallets, search]);

  const visible = useMemo(() => {
    const v = searched.filter((w) => showHidden || !prefs.hidden.has(w.id));
    return sortByPref(v, prefs.order, prefs.starred);
  }, [searched, showHidden, prefs.order, prefs.starred, prefs.hidden]);

  /* ── Balance helpers ───────────────────────────────────────────────── */

  // Active quote the user picked in Settings → Trading (SOL / USDC / USD1).
  // Wallet balances render in this quote instead of always SOL. Every non-SOL
  // quote on Solana is a USD stable, so its USD price is ~1; SOL uses solPrice.
  const [quote] = useBuyQuoteMint();
  const quoteUsdPrice = quote.mint == null ? solPrice : 1;

  // Balance of the active quote asset: native SOL when the quote is SOL, else
  // the wallet's holding of that quote token (mirrors the trading panel).
  function nativeBal(w: UserWallet): number | null {
    if (w.kind === "DEMO") return w.solBalance ?? 0;
    const b = liveBalances[w.id];
    if (!b) return null;
    if (quote.mint == null) return b.loading && b.sol === 0 ? null : b.sol;
    return b.tokens?.[quote.mint] ?? 0;
  }
  function tokenCount(w: UserWallet): number {
    const b = liveBalances[w.id];
    return b && b.tokens ? Object.keys(b.tokens).length : 0;
  }
  const usd = (bal: number | null): number => (bal != null && quoteUsdPrice > 0 ? bal * quoteUsdPrice : 0);

  const onChain = useMemo(() => visible.filter((w) => w.kind !== "DEMO"), [visible]);

  // Single-select: the balance panel acts on exactly one wallet (or none).
  // Nothing selected ⇒ the panel shows an empty prompt.
  const actionWallet = useMemo(
    () => onChain.find((w) => w.id === selectedId) ?? null,
    [onChain, selectedId],
  );
  const panelSol = useMemo(
    () => (actionWallet ? nativeBal(actionWallet) ?? 0 : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actionWallet, liveBalances, quote.mint],
  );

  // Selecting a wallet drives the balance panel — demo wallets can't act there,
  // so they're not selectable. Clicking the selected wallet again deselects it.
  function selectWallet(w: UserWallet) {
    if (w.kind === "DEMO") return;
    setSelectedId((prev) => (prev === w.id ? null : w.id));
  }

  /* ── Loading / empty ───────────────────────────────────────────────── */

  if (loading && wallets.length === 0) {
    return (
      <div style={{
        height: 360, borderRadius: 12,
        background: "var(--ink-1)", border: "1px solid var(--line-soft)",
        position: "relative", overflow: "hidden",
      }}>
        <span className="skeleton" style={{ position: "absolute", inset: 14, borderRadius: 8 }} />
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <EmptyHero
        title="No wallets yet."
        body="Create a platform wallet for autonomous signing, import an existing keypair, or spin up a demo wallet for paper trading."
        icon="◎"
        cta={
          <>
            <Btn size="sm" tone="primary" onClick={onCreate}>+ Create wallet</Btn>
            <Btn size="sm" tone="ghost"   onClick={onImport}>Import keypair</Btn>
            <Btn size="sm" tone="ghost"   onClick={onCreateDemo}>+ Demo wallet</Btn>
          </>
        }
      />
    );
  }

  const hiddenCount = searched.filter((w) => prefs.hidden.has(w.id)).length;

  return (
    <div style={{
      // No overflow:hidden here — it would clip position:sticky on the balance
      // panel. Top corners are rounded on the inner bars instead (the bottom
      // corners sit over transparent children, so the card's own radius shows).
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      flexWrap: isMobile ? "nowrap" : "wrap",
      alignItems: "stretch",
      background: "var(--ink-1)", border: "1px solid var(--line-soft)",
      borderRadius: 12, boxShadow: "var(--shadow-sm)",
    }}>
      {/* ── Wallet manager (left) ─────────────────────────────────────── */}
      <div style={{ flex: isMobile ? "1 1 100%" : "1 1 460px", minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "10px 14px", borderBottom: "1px solid var(--line-soft)", background: "var(--ink-2)",
          borderTopLeftRadius: 12,
        }}>
          <PillSearch value={search} onChange={setSearch} flex placeholder="Search by name or address" />
          {hiddenCount > 0 && (
            <ShowToggle
              on={showHidden}
              onToggle={() => setShowHidden((v) => !v)}
              label={`Show hidden (${hiddenCount})`}
              icon={PortfolioGlyph.eyeOff}
            />
          )}
          <div style={{ flex: 1 }} />
          <PremiumButton size="sm" variant="glass" onClick={onImport} icon={<span style={{ fontSize: 12, lineHeight: 1 }}>↑</span>}>Import</PremiumButton>
          <PremiumButton size="sm" variant="solid" onClick={onCreate} icon={<span style={{ fontSize: 13, lineHeight: 1 }}>+</span>}>Create Wallet</PremiumButton>
        </div>

        {/* Column headers — only meaningful for the grid row layout; phone
            rows render as stacked cards, so suppress the header there. */}
        <div className="hide-phone" style={{
          display: "grid", gridTemplateColumns: ROW_COLS, gap: 8,
          padding: "8px 14px", borderBottom: "1px solid var(--line-soft)", background: "var(--ink-1)",
        }}>
          <ColHead>Wallet</ColHead>
          <ColHead>Balance</ColHead>
          <ColHead>Tokens</ColHead>
          <ColHead align="right">Actions</ColHead>
        </div>

        {/* Rows flow naturally and scroll with the tab-body; the balance panel
            on the right is pinned via position:sticky so it stays put. On phones
            the fixed minHeight:200 can strand content under the chrome, and rows
            become full-width cards (no horizontal overflow), so drop both. */}
        <div style={{ flex: 1, minHeight: isMobile ? 0 : 200, overflowX: isMobile ? "visible" : "auto" }}>
          {visible.length === 0 ? (
            <div style={{ padding: "44px 16px", textAlign: "center", color: "var(--paper-4)", fontSize: 13 }}>
              No wallets match{search ? ` “${search}”` : ""}.
            </div>
          ) : (
            visible.map((w, index) => (
              <WalletRow
                key={w.id}
                wallet={w}
                index={index}
                avatarGlyph={prefs.avatars[w.id] ?? null}
                onSetAvatar={(glyph) => prefs.setAvatar(w.id, glyph)}
                selectable={w.kind !== "DEMO"}
                selected={selectedId === w.id}
                starred={prefs.starred.has(w.id)}
                trading={tradingIds.has(w.id)}
                hidden={prefs.hidden.has(w.id)}
                nativeBal={nativeBal(w)}
                usd={usd(nativeBal(w))}
                quoteLabel={quote.label}
                tokenCount={tokenCount(w)}
                summary={summaryByAddr.get(w.pubkey) ?? null}
                onSelect={() => selectWallet(w)}
                onToggleStar={() => prefs.toggleStar(w.id)}
                onHide={() => prefs.toggleHidden(w.id)}
                onRename={(label) => onRename(w.id, label)}
                onCopy={() => actions.copyAddr(w.pubkey)}
                actions={actions}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Balance panel (right) ─────────────────────────────────────── */}
      <BalancePanel
        wallets={onChain}
        total={onChain.length}
        panelSol={panelSol}
        panelUsd={usd(panelSol)}
        quoteUsdPrice={quoteUsdPrice}
        quoteLabel={quote.label}
        nativeBal={nativeBal}
        onSelect={(id) => setSelectedId(id)}
        actionWallet={actionWallet}
        actions={actions}
      />
    </div>
  );
}

/* ── Column header ───────────────────────────────────────────────────── */

function ColHead({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <span className="eyebrow" style={{
      fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.08em",
      textTransform: "uppercase", textAlign: align, fontFamily: "var(--font-mono)",
    }}>{children}</span>
  );
}

/* ── Read-only "in the trading scope" badge ──────────────────────────── */

function TradingBadge() {
  return (
    <span
      title="This wallet is selected for trading in the top bar. Change it there."
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "1px 6px", borderRadius: 999,
        background: "var(--accent-w)", color: "var(--accent)",
        fontSize: 8, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
        fontFamily: "var(--font-mono)", lineHeight: 1.3,
        border: "1px solid color-mix(in oklch, var(--accent) 40%, transparent)",
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: 999, background: "var(--accent)" }} />
      Trading
    </span>
  );
}

/* ── Single wallet row ───────────────────────────────────────────────── */

function WalletRow({
  wallet, index, avatarGlyph, onSetAvatar,
  selectable, selected, starred, trading, hidden, nativeBal, usd, quoteLabel, tokenCount, summary,
  onSelect, onToggleStar, onHide, onRename, onCopy, actions,
}: {
  wallet: UserWallet;
  index: number;
  avatarGlyph: string | null;
  onSetAvatar: (glyph: string | null) => void;
  selectable: boolean;
  selected: boolean;
  starred: boolean;
  trading: boolean;
  hidden: boolean;
  nativeBal: number | null;
  usd: number;
  quoteLabel: string;
  tokenCount: number;
  summary: WalletSummaryItem | null;
  onSelect: () => void;
  onToggleStar: () => void;
  onHide: () => void;
  onRename: (label: string) => Promise<void>;
  onCopy: () => void;
  actions: WalletRowAction;
}) {
  const isDemo = wallet.kind === "DEMO";
  const isPhone = useIsPhone();
  const accent = starred ? "var(--gold)" :
                 isDemo ? "var(--gold)" :
                 wallet.kind === "PHANTOM" ? "var(--info)" :
                 "var(--accent)";
  const [hover, setHover] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const avatarRef = useRef<HTMLSpanElement | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const hasStats = summary && (summary.totalTrades > 0 || summary.totalVolumeUsd > 0);

  return (
    <div
      onClick={selectable ? onSelect : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={isPhone ? "row-actions-hover" : undefined}
      style={{
        position: "relative",
        // Phone: stacked card (identity / balance / tokens / actions). Desktop &
        // tablet keep the 4-column grid byte-identical.
        ...(isPhone
          ? { display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }
          : { display: "grid", gridTemplateColumns: ROW_COLS, gap: 8, alignItems: "center" }),
        padding: "11px 14px", cursor: selectable ? "pointer" : "default",
        borderBottom: "1px solid var(--line-soft)",
        background: selected ? "color-mix(in oklch, var(--accent) 8%, transparent)" : hover ? "var(--ink-2)" : "transparent",
        opacity: hidden ? 0.6 : 1,
        transition: "background 120ms",
      }}
    >
      {/* Left accent rail when selected/starred */}
      <span style={{
        position: "absolute", top: 0, bottom: 0, left: 0, width: 2,
        background: selected || starred ? accent : "transparent",
        transition: "background 120ms",
      }} />

      {/* Wallet identity */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        {/* Avatar — click to customize letter/emoji; selection ring when active. */}
        <span ref={avatarRef} onClick={stop}>
          <WalletAvatar
            label={wallet.displayLabel}
            kind={wallet.kind}
            index={index}
            size={30}
            customGlyph={avatarGlyph}
            selected={selected}
            title="Customize avatar"
            onClick={(e) => {
              e.stopPropagation();
              const r = avatarRef.current?.getBoundingClientRect();
              if (r) setAvatarPickerOpen(true);
            }}
          />
        </span>
        <WalletAvatarPicker
          open={avatarPickerOpen}
          anchorRect={avatarRef.current?.getBoundingClientRect() ?? null}
          walletId={wallet.id}
          label={wallet.displayLabel}
          kind={wallet.kind}
          index={index}
          customGlyph={avatarGlyph}
          onSave={onSetAvatar}
          onClose={() => setAvatarPickerOpen(false)}
        />

        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            {starred && (
              <span style={{ color: "var(--gold)", display: "inline-flex", flexShrink: 0 }} title="Primary wallet">
                {PortfolioGlyph.star(true)}
              </span>
            )}
            <span style={{ minWidth: 0 }} onClick={stop}>
              <InlineEditableLabel value={wallet.displayLabel} onCommit={onRename} fontSize={13} />
            </span>
            {trading && <TradingBadge />}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--paper-4)" }} title={wallet.pubkey}>
              {shortAddr(wallet.pubkey, 4, 4)}
            </span>
            <button
              onClick={(e) => { stop(e); onCopy(); }}
              title="Copy address"
              style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--paper-4)", display: "inline-flex", opacity: (hover || isPhone) ? 1 : 0, transition: "opacity 120ms, color 120ms" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-4)"; }}
            >{PortfolioGlyph.copy}</button>
            {hasStats && summary!.realizedPnlUsd !== 0 && (
              <span className="mono" style={{
                fontSize: 10, color: summary!.realizedPnlUsd > 0 ? "var(--buy)" : "var(--sell)",
                fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
              }}>
                · 30d {summary!.realizedPnlUsd > 0 ? "+" : "−"}{fmtUsd(Math.abs(summary!.realizedPnlUsd))}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Balance */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)", fontVariantNumeric: "tabular-nums" }}>
          {nativeBal == null ? "…" : nativeBal.toFixed(3)}
          <span style={{ color: "var(--paper-4)", fontSize: 10, marginLeft: 3 }}>{quoteLabel}</span>
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--paper-4)", fontVariantNumeric: "tabular-nums" }}>
          {isDemo ? "Paper" : nativeBal == null ? "—" : `~${fmtUsd(usd)}`}
        </span>
      </div>

      {/* Token count — on phone the column header is hidden, so prefix a label. */}
      <span className="mono" style={{
        fontSize: 13, fontWeight: 500,
        color: tokenCount > 0 ? "var(--paper)" : "var(--paper-4)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {isPhone && (
          <span style={{ color: "var(--paper-4)", fontSize: 10, marginRight: 5 }}>Tokens</span>
        )}
        {tokenCount}
      </span>

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: isPhone ? "flex-start" : "flex-end", gap: 2 }} onClick={stop}>
        {!isDemo && (
          <RowIcon href={explorerAccountUrl(wallet.pubkey)} title={`View on ${explorerName()}`} visible={hover || isPhone}>
            {PortfolioGlyph.ext}
          </RowIcon>
        )}
        {wallet.kind === "PLATFORM" && (
          <RowIcon onClick={() => actions.exportKey(wallet)} title="Export private key" visible={hover || isPhone}>
            {PortfolioGlyph.key}
          </RowIcon>
        )}
        <RowIcon onClick={onToggleStar} title={starred ? "Unstar" : "Set as primary"} visible={hover || starred || isPhone} active={starred}>
          {PortfolioGlyph.star(starred)}
        </RowIcon>
        <button
          ref={moreBtnRef}
          onClick={() => { const r = moreBtnRef.current?.getBoundingClientRect(); if (r) setMenuAnchor(r); }}
          title="More actions"
          style={{
            width: 26, height: 26, borderRadius: 6,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "1px solid transparent",
            color: "var(--paper-3)", cursor: "pointer", transition: "background 120ms, border-color 120ms, color 120ms",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-3)"; e.currentTarget.style.borderColor = "var(--line-soft)"; e.currentTarget.style.color = "var(--paper)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = "var(--paper-3)"; }}
        >{PortfolioGlyph.more}</button>
      </div>

      {/* More menu */}
      <PopoverMenu anchorRect={menuAnchor} onClose={() => setMenuAnchor(null)} align="end">
        <MenuItem icon={PortfolioGlyph.copy}    onClick={() => { onCopy(); setMenuAnchor(null); }}>Copy address</MenuItem>
        <MenuItem icon={PortfolioGlyph.send}    onClick={() => { actions.send(wallet); setMenuAnchor(null); }}>Send…</MenuItem>
        <MenuItem icon={PortfolioGlyph.receive} onClick={() => { actions.receive(wallet); setMenuAnchor(null); }}>Receive</MenuItem>
        {!isDemo && (
          <>
            <MenuItem icon={PortfolioGlyph.fund}        onClick={() => { actions.fund(wallet); setMenuAnchor(null); }}>Fund (SplitNOW)…</MenuItem>
            <MenuItem icon={PortfolioGlyph.consolidate} onClick={() => { actions.consolidate(wallet); setMenuAnchor(null); }}>Consolidate into here…</MenuItem>
            <MenuItem icon={PortfolioGlyph.claimFees}   onClick={() => { actions.claimFees(wallet); setMenuAnchor(null); }}>Claim fees…</MenuItem>
            <MenuItem icon={PortfolioGlyph.burn}        onClick={() => { actions.burn(wallet); setMenuAnchor(null); }}>Burn dust…</MenuItem>
          </>
        )}
        <span style={{ display: "block", height: 1, background: "var(--line-soft)", margin: "4px 4px" }} />
        <MenuItem onClick={() => { actions.rename(wallet); setMenuAnchor(null); }}>Rename…</MenuItem>
        <MenuItem icon={PortfolioGlyph.star(starred)} onClick={() => { onToggleStar(); setMenuAnchor(null); }}>
          {starred ? "Unstar" : "Set as primary"}
        </MenuItem>
        <MenuItem icon={PortfolioGlyph.eyeOff} onClick={() => { onHide(); setMenuAnchor(null); }}>{hidden ? "Unhide" : "Hide from list"}</MenuItem>
        {isDemo && (
          <MenuItem icon={PortfolioGlyph.refresh} tone="accent" onClick={() => { actions.resetDemo(wallet); setMenuAnchor(null); }}>
            Reset demo balance
          </MenuItem>
        )}
        {wallet.kind === "PLATFORM" && (
          <MenuItem icon={PortfolioGlyph.key} tone="danger" onClick={() => { actions.exportKey(wallet); setMenuAnchor(null); }}>
            Export private key…
          </MenuItem>
        )}
        {!wallet.isConnected && (
          <MenuItem icon={PortfolioGlyph.trash} tone="danger" onClick={() => { actions.delete(wallet); setMenuAnchor(null); }}>
            Delete wallet…
          </MenuItem>
        )}
      </PopoverMenu>
    </div>
  );
}

function RowIcon({
  children, onClick, href, title, visible, active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  title: string;
  visible: boolean;
  active?: boolean;
}) {
  const style: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 6,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "transparent", border: "1px solid transparent",
    color: active ? "var(--gold)" : "var(--paper-3)", cursor: "pointer",
    opacity: visible ? 1 : 0, transition: "opacity 120ms, background 120ms, color 120ms",
  };
  const enter = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = "var(--ink-3)"; e.currentTarget.style.color = active ? "var(--gold)" : "var(--paper)"; };
  const leave = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = active ? "var(--gold)" : "var(--paper-3)"; };
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" title={title} style={style} onMouseEnter={enter} onMouseLeave={leave}>{children}</a>
    );
  }
  return (
    <button onClick={onClick} title={title} style={style} onMouseEnter={enter} onMouseLeave={leave}>{children}</button>
  );
}

/* ── Balance panel (right column) ────────────────────────────────────── */

function BalancePanel({
  wallets, total, panelSol, panelUsd, quoteUsdPrice, quoteLabel, nativeBal, onSelect, actionWallet, actions,
}: {
  wallets: UserWallet[];
  total: number;
  panelSol: number;
  panelUsd: number;
  quoteUsdPrice: number;
  quoteLabel: string;
  nativeBal: (w: UserWallet) => number | null;
  onSelect: (id: string) => void;
  actionWallet: UserWallet | null;
  actions: WalletRowAction;
}) {
  const ddRef = useRef<HTMLButtonElement | null>(null);
  const [ddAnchor, setDdAnchor] = useState<DOMRect | null>(null);
  const isMobile = useIsMobile();
  const hasSelection = actionWallet != null;
  const ddLabel = actionWallet ? actionWallet.displayLabel : "Select wallet";

  return (
    <div style={{
      // Mobile: stacks full-width BELOW the wallet list (no fixed basis, no
      // side border, not pinned — sticky-to-100vh would strand it). Desktop &
      // tablet keep the pinned 320px side panel byte-identical.
      ...(isMobile
        ? {
            flex: "1 1 100%", minWidth: 0,
            borderTop: "1px solid var(--line-soft)",
          }
        : {
            flex: "0 0 320px", minWidth: 280,
            borderLeft: "1px solid var(--line-soft)",
            // Pin the actions panel: sticks to the top of the tab-body scroll while
            // the wallet list on the left scrolls. alignSelf:flex-start keeps it at
            // content height (a stretched, viewport-tall panel couldn't pin).
            position: "sticky", top: 0, alignSelf: "flex-start",
            maxHeight: "calc(100dvh - 16px)", overflowY: "auto",
          }),
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        padding: "10px 14px", borderBottom: "1px solid var(--line-soft)", background: "var(--ink-2)",
        borderTopRightRadius: 12,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)" }}>Wallets ({total})</span>
        <button
          ref={ddRef}
          onClick={() => { const r = ddRef.current?.getBoundingClientRect(); setDdAnchor(ddAnchor ? null : r ?? null); }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 9px", borderRadius: 7,
            background: "var(--ink-0)", border: "1px solid var(--line-soft)",
            color: hasSelection ? "var(--paper-2)" : "var(--paper-4)", fontSize: 11, fontWeight: 500, cursor: "pointer",
            maxWidth: isMobile ? 220 : 170, transition: "border-color 120ms",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "color-mix(in oklch, var(--accent) 40%, transparent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line-soft)"; }}
          title="Pick the wallet these actions target"
        >
          <span style={{ display: "inline-flex", color: "var(--accent)" }}>◎</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ddLabel}</span>
          <span style={{ display: "inline-flex", color: "var(--paper-4)" }}>{UiGlyph.chevron}</span>
        </button>
        <PopoverMenu anchorRect={ddAnchor} onClose={() => setDdAnchor(null)} align="end">
          {wallets.map((w) => (
            <MenuItem key={w.id} onClick={() => { onSelect(w.id); setDdAnchor(null); }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.displayLabel}</span>
                <span className="mono" style={{ color: "var(--paper-4)", fontSize: 11 }}>{fmtUsd((nativeBal(w) ?? 0) * quoteUsdPrice)}</span>
              </span>
            </MenuItem>
          ))}
        </PopoverMenu>
      </div>

      {hasSelection ? (
        /* Selected balance + actions */
        <div style={{ flex: 1, padding: "26px 18px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <span style={{
              width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "var(--accent-w)", color: "var(--accent)", fontSize: 20,
              border: "1px solid color-mix(in oklch, var(--accent) 30%, transparent)",
            }}>◎</span>
            <div style={{ textAlign: "center" }}>
              <div className="eyebrow" style={{ fontSize: 9, color: "var(--paper-4)", marginBottom: 3 }}>
                Wallet Balance
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--paper)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                {panelSol.toFixed(4)} <span style={{ fontSize: 13, color: "var(--paper-4)" }}>{quoteLabel}</span>
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--paper-4)", fontVariantNumeric: "tabular-nums" }}>
                ~{fmtUsd(panelUsd)}
              </div>
            </div>
          </div>

          {/* 2×2 premium actions */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <PremiumButton full size="md" variant="glass" icon={UiGlyph.receive}
              onClick={() => actionWallet && actions.receive(actionWallet)}>Receive</PremiumButton>
            <PremiumButton full size="md" variant="glass" icon={UiGlyph.withdraw}
              onClick={() => actionWallet && actions.send(actionWallet)}>Withdraw</PremiumButton>
            <PremiumButton full size="md" variant="glass" icon={UiGlyph.consolidate}
              onClick={() => actionWallet && actions.consolidate(actionWallet)}>Consolidate</PremiumButton>
          </div>
          {actionWallet && (
            <p style={{ fontSize: 10.5, color: "var(--paper-4)", textAlign: "center", margin: 0, lineHeight: 1.5 }}>
              Acting on <span style={{ color: "var(--paper-2)" }}>{actionWallet.displayLabel}</span>
              {" · "}{shortAddr(actionWallet.pubkey, 4, 4)}
            </p>
          )}
        </div>
      ) : (
        /* Empty — nothing selected yet */
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 12, padding: "28px 24px", textAlign: "center",
        }}>
          <span style={{
            width: 46, height: 46, borderRadius: "50%", flexShrink: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "var(--ink-2)", color: "var(--paper-4)", fontSize: 20,
            border: "1px solid var(--line-soft)",
          }}>◎</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, maxWidth: isMobile ? "100%" : 230 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--paper-2)" }}>No wallet selected</span>
            <span style={{ fontSize: 11.5, color: "var(--paper-4)", lineHeight: 1.55 }}>
              Select a wallet on the left (or pick one above) to receive, withdraw or consolidate.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
