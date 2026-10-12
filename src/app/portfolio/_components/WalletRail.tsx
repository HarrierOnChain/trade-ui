"use client";
/**
 * The portfolio's wallet column: every wallet in the vault, what it holds on
 * this chain, which ones trade, and what can be done with each key.
 *
 * A click focuses the portfolio on one wallet (value, PnL, holdings and
 * activity follow it) and opens its actions; "All wallets" goes back to the
 * sum. Focus is only a view: the trading switch is what picks the wallets the
 * next trade signs with, and nothing else changes it.
 *
 * Wallets of the other family (EVM keys on Solana, Solana keys on an EVM
 * chain) sit in a folded group: they can be managed here, their balances show
 * on their own chains.
 */
import React, { useState } from "react";
import { Icon, Tooltip } from "../../../components/atoms";
import { WalletAvatar } from "../../../components/WalletAvatar";
import { explorerAccountUrl, type ChainId } from "../../../lib/chains";
import { shortAddr } from "../../../lib/format";
import type { RuntimeConfig, VaultWallet, WalletFamily } from "../../../lib/vault/client";
import { fmtNative, fmtValue } from "./money";

export interface RailWallet {
  wallet: VaultWallet;
  label: string;
  /** Stable avatar colour: the wallet's place in the vault. */
  avatarIndex: number;
  /** Native coin on this chain; null while unknown or on another family. */
  native: number | null;
  /** USD value on this chain (native, tokens, stables); null while unknown. */
  valueUsd: number | null;
  trading: boolean;
}

export interface WalletActions {
  onCopy: (address: string) => void;
  onSend: (w: VaultWallet) => void;
  onExport: (w: VaultWallet) => void;
  onRename: (w: VaultWallet) => void;
  onDelete: (w: VaultWallet) => void;
  onToggleTrading: (id: string) => void;
}

const FAMILY_NAME: Record<WalletFamily, string> = { sol: "Solana", evm: "EVM" };

export function WalletRail({
  rows, others, family, chainId, native, totalUsd, totalNative, loading,
  focusId, onFocus, actions, onNew, onImport,
  config, onSecurity, onLock, scroll,
}: {
  rows: RailWallet[];
  others: RailWallet[];
  family: WalletFamily;
  chainId: ChainId;
  native: string;
  totalUsd: number;
  totalNative: number;
  loading: boolean;
  focusId: string | null;
  onFocus: (id: string | null) => void;
  actions: WalletActions;
  onNew: () => void;
  onImport: () => void;
  config: RuntimeConfig | null;
  onSecurity: () => void;
  onLock: () => void;
  /** Scroll inside the column (the desktop layout) instead of growing. */
  scroll?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [othersOpen, setOthersOpen] = useState(false);
  const [openOtherId, setOpenOtherId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const match = (r: RailWallet) =>
    !q || r.wallet.address.toLowerCase().includes(q) || r.label.toLowerCase().includes(q);
  const shownRows = rows.filter(match);
  const shownOthers = others.filter(match);
  const otherFamily: WalletFamily = family === "sol" ? "evm" : "sol";
  const othersShown = othersOpen || !!q;

  return (
    <aside aria-label="Wallets" style={{
      display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0,
      ...(scroll ? { overflowY: "auto", overflowX: "hidden" } : {}),
    }}>
      <header style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 4px 10px 12px" }}>
        <span style={{ fontSize: 12, color: "var(--paper-3)", flex: 1 }}>
          Wallets <span className="mono" style={{ color: "var(--paper-4)", marginLeft: 4 }}>{rows.length}</span>
        </span>
        <TextButton onClick={onNew}>{Icon.plus(11)} New</TextButton>
        <TextButton onClick={onImport}>Import</TextButton>
      </header>

      {rows.length + others.length > 6 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search wallets"
          aria-label="Search wallets"
          style={{
            margin: "0 0 8px", padding: "7px 12px", borderRadius: 8, outline: "none",
            background: "var(--ink-1)", border: "1px solid var(--line-soft)", color: "var(--paper)", fontSize: 12,
          }}
        />
      )}

      <div style={{ borderTop: "1px solid var(--line-soft)" }}>
        {rows.length > 0 && !q && (
          <Row
            selected={focusId === null}
            onClick={() => onFocus(null)}
            lead={<span style={allGlyph(focusId === null)}>{StackGlyph}</span>}
            title="All wallets"
            sub={`${rows.length} on ${FAMILY_NAME[family]}`}
            values={<Values usd={loading ? null : totalUsd} native={loading ? null : totalNative} symbol={native} />}
          />
        )}

        {loading && rows.length === 0 && others.length === 0 ? (
          <Note>Loading wallets…</Note>
        ) : rows.length === 0 ? (
          <Note>No {FAMILY_NAME[family]} wallet yet.</Note>
        ) : shownRows.length === 0 ? (
          <Note>No wallet matches.</Note>
        ) : (
          shownRows.map((r) => {
            const selected = focusId === r.wallet.id;
            return (
              <React.Fragment key={r.wallet.id}>
                <Row
                  selected={selected}
                  onClick={() => onFocus(selected ? null : r.wallet.id)}
                  lead={<WalletAvatar label={r.label} index={r.avatarIndex} size={28} />}
                  title={r.label}
                  sub={shortAddr(r.wallet.address, 4)}
                  values={<Values usd={r.valueUsd} native={r.native} symbol={native} />}
                  trailing={
                    <Tooltip content={r.trading ? "Trades: the panels and quick buys sign with it" : "Switch on to trade with it"}>
                      <span style={{ display: "inline-flex" }}>
                        <TradeSwitch on={r.trading} onChange={() => actions.onToggleTrading(r.wallet.id)} />
                      </span>
                    </Tooltip>
                  }
                />
                {selected && <Detail row={r} chainId={chainId} actions={actions} />}
              </React.Fragment>
            );
          })
        )}

        {others.length > 0 && (
          <>
            <button type="button" aria-expanded={othersShown} onClick={() => setOthersOpen((v) => !v)} style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 12px", background: "transparent", border: 0, borderBottom: "1px solid var(--line-soft)",
              cursor: "pointer", color: "var(--paper-4)", fontSize: 11.5, textAlign: "left",
            }}>
              <span>{FAMILY_NAME[otherFamily]} wallets <span className="mono" style={{ marginLeft: 4 }}>{others.length}</span></span>
              <span style={{ display: "inline-flex", transition: "transform 150ms", transform: othersShown ? "rotate(180deg)" : "none" }}>{Chevron}</span>
            </button>
            {othersShown && shownOthers.map((r) => {
              const open = openOtherId === r.wallet.id;
              return (
                <React.Fragment key={r.wallet.id}>
                  <Row
                    selected={open}
                    onClick={() => setOpenOtherId(open ? null : r.wallet.id)}
                    lead={<WalletAvatar label={r.label} index={r.avatarIndex} size={28} />}
                    title={r.label}
                    sub={shortAddr(r.wallet.address, 4)}
                    values={<span style={{ fontSize: 11, color: "var(--paper-4)" }}>on {FAMILY_NAME[otherFamily]}</span>}
                  />
                  {open && <Detail row={r} chainId={chainId} actions={actions} />}
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>

      <VaultLine config={config} onSecurity={onSecurity} onLock={onLock} />
    </aside>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

const Chevron = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6 L8 10 L12 6" />
  </svg>
);

const StackGlyph = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
    <path d="M8 2 L14 5 L8 8 L2 5 Z" />
    <path d="M2 8 L8 11 L14 8" />
    <path d="M2 11 L8 14 L14 11" />
  </svg>
);

function allGlyph(selected: boolean): React.CSSProperties {
  return {
    width: 28, height: 28, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
    color: selected ? "var(--accent)" : "var(--paper-3)", background: "var(--ink-2)",
  };
}

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "18px 12px", fontSize: 12, color: "var(--paper-4)" }}>{children}</div>;
}

function TextButton({ onClick, children, tone }: { onClick: () => void; children: React.ReactNode; tone?: "sell" }) {
  const base = tone === "sell" ? "var(--sell)" : "var(--paper-3)";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 6,
        background: "transparent", border: 0, cursor: "pointer", color: base, fontSize: 12, fontWeight: 500,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; if (!tone) e.currentTarget.style.color = "var(--paper)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = base; }}
    >{children}</button>
  );
}

/** A clickable row: Enter and Space act like a click. */
function Row({ selected, onClick, lead, title, sub, values, trailing }: {
  selected: boolean;
  onClick: () => void;
  lead: React.ReactNode;
  title: string;
  sub: string;
  values: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      role="button" tabIndex={0} aria-pressed={selected} aria-label={title}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
      }}
      style={{
        display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto 30px",
        alignItems: "center", gap: 10, padding: "10px 12px",
        cursor: "pointer", outline: "none", borderBottom: selected ? 0 : "1px solid var(--line-soft)",
        background: selected ? "var(--ink-1)" : "transparent",
        boxShadow: selected ? "inset 2px 0 0 var(--accent)" : "none",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--ink-1)"; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      {lead}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--paper)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--paper-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
      </div>
      {values}
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} style={{ display: "inline-flex", justifyContent: "flex-end" }}>
        {trailing}
      </span>
    </div>
  );
}

function Values({ usd, native, symbol }: { usd: number | null; native: number | null; symbol: string }) {
  return (
    <div className="mono" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, fontVariantNumeric: "tabular-nums" }}>
      {usd == null ? (
        <span className="skeleton" style={{ width: 48, height: 11, borderRadius: 3 }} />
      ) : (
        <span style={{ fontSize: 12.5, color: usd > 0 ? "var(--paper)" : "var(--paper-4)" }}>{fmtValue(usd)}</span>
      )}
      {native != null && (
        <span style={{ fontSize: 10.5, color: "var(--paper-4)", whiteSpace: "nowrap" }}>{fmtNative(native)} {symbol}</span>
      )}
    </div>
  );
}

/** The open wallet's address and actions, under its row. */
function Detail({ row, chainId, actions }: { row: RailWallet; chainId: ChainId; actions: WalletActions }) {
  const w = row.wallet;
  const explorerChain: ChainId = w.family === "sol" ? "sol" : (chainId === "sol" ? "eth" : chainId);
  return (
    <div style={{
      padding: "0 8px 10px 50px", background: "var(--ink-1)",
      boxShadow: "inset 2px 0 0 var(--accent)", borderBottom: "1px solid var(--line-soft)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, paddingBottom: 6 }}>
        <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: "var(--paper-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {w.address}
        </span>
        <Tooltip content="Copy address">
          <button type="button" aria-label="Copy address" onClick={() => actions.onCopy(w.address)} style={miniIcon}>{Icon.copy(11)}</button>
        </Tooltip>
        <Tooltip content="Open in explorer">
          <a href={explorerAccountUrl(w.address, explorerChain)} target="_blank" rel="noopener noreferrer"
            aria-label="Open in explorer" style={miniIcon}>{Icon.ext(11)}</a>
        </Tooltip>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", marginLeft: -8 }}>
        {w.family === "sol" && <TextButton onClick={() => actions.onSend(w)}>Send</TextButton>}
        <TextButton onClick={() => actions.onExport(w)}>Export key</TextButton>
        <TextButton onClick={() => actions.onRename(w)}>Rename</TextButton>
        <TextButton onClick={() => actions.onDelete(w)} tone="sell">Delete</TextButton>
      </div>
    </div>
  );
}

const miniIcon: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center",
  background: "transparent", border: 0, cursor: "pointer", color: "var(--paper-4)", flexShrink: 0,
};

function TradeSwitch({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Trade with this wallet"
      onClick={onChange}
      style={{
        width: 28, height: 16, borderRadius: 999, position: "relative", padding: 0, flexShrink: 0, cursor: "pointer",
        border: 0, background: on ? "var(--accent)" : "var(--ink-3)", transition: "background 150ms",
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: "50%",
        background: on ? "var(--ink-0)" : "var(--paper-3)", transition: "left 150ms",
      }} />
    </button>
  );
}

function lockText(m: number): string {
  if (m === 0) return "Never locks by itself";
  return `Locks after ${m < 60 ? `${m} min` : `${m / 60} h`} idle`;
}

/** The lock, in one line: state, auto-lock, settings, lock now. */
function VaultLine({ config, onSecurity, onLock }: {
  config: RuntimeConfig | null; onSecurity: () => void; onLock: () => void;
}) {
  const noRecovery = config?.recoveryKeySet === false;
  return (
    <div style={{ marginTop: "auto", paddingTop: 16 }}>
      {noRecovery && (
        <button type="button" onClick={onSecurity} style={{
          width: "100%", textAlign: "left", marginBottom: 8, padding: "8px 12px", borderRadius: 8, cursor: "pointer",
          fontSize: 11.5, lineHeight: 1.45, color: "var(--warn)",
          background: "color-mix(in oklch, var(--warn) 7%, transparent)",
          border: "1px solid color-mix(in oklch, var(--warn) 30%, transparent)",
        }}>
          No recovery key yet: a forgotten password would lose these wallets. Make one →
        </button>
      )}
      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: "10px 4px 0 12px",
        borderTop: "1px solid var(--line-soft)",
      }}>
        <span style={{ color: "var(--accent)", display: "inline-flex" }}>{Icon.shield(12)}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "var(--paper-4)", marginLeft: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {config ? lockText(config.autoLockMinutes) : "Vault unlocked"}
        </span>
        <TextButton onClick={onSecurity}>Security</TextButton>
        <TextButton onClick={onLock}>{Icon.lock(11)} Lock</TextButton>
      </div>
    </div>
  );
}
