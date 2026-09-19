"use client";

// Auto Clean UI — rotates token supply out of "seller" wallets into fresh
// "buyer" wallets. Shared by the token/live trading panel (mint-scoped) and the
// /automation tab (cross-token), and queued as a draft from the /deploy form.
//
//   <AutoCleanPanel client wallets pushToast [mint] [symbol] /> — self-fetches
//   the user's Auto Clean sessions, polls live progress while one runs, renders
//   the list with run-now / pause / stop / delete + an expandable step log, and
//   hosts the create modal.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Btn, Icon, Modal } from "../../../components/atoms";
import { useApp } from "../../../contexts/AppContext";
import { useIsPhone } from "../../../hooks/useMediaQuery";
import { clampLeft, viewportMaxWidth } from "../../../lib/popover";
import { explorerTxUrl } from "../../../lib/chains";
import type { useBackend } from "../../../api/backend";
import type {
  AutoCleanSession, AutoCleanCreateBody, AutoCleanMode, AutoCleanBuyerUnit, AutoCleanLegOrder, AutoCleanStep,
} from "../../../api/backend";
import type { UserWallet } from "../../../hooks/useUserWallets";
import {
  StatusBadge, shortAddr,
  AUTO_LABEL, autoAddLabel,
} from "./atoms";
import { AdvActionCard } from "./automode";

type Client = ReturnType<typeof useBackend>;
type Toast = ReturnType<typeof useApp>["pushToast"];

// A bundle row = one fully-modular holder→buyer pairing: a holder dumps the supply
// that a chosen buyer re-acquires, riding one atomic Jito bundle. The rotation is
// composed as a list of these. One holder may appear across several bundles.
interface BundleRow {
  id: string;            // local row key
  sellerId: string;      // holder wallet id (dumps the supply / funds the buy)
  buyerId: string;       // buyer wallet id (re-acquires the supply)
  amount: string;        // what the buyer acquires
  unit: AutoCleanBuyerUnit;
}

// Fixed execution defaults — not exposed in the create modal UI.
const AUTO_CLEAN_SLIPPAGE_PCT = 99;
const AUTO_CLEAN_REPEAT_COUNT = 1;
const AUTO_CLEAN_REPEAT_DELAY_SEC = 0;

function buildBody(s: {
  mode: AutoCleanMode; bundles: BundleRow[]; legOrder: AutoCleanLegOrder;
  sellRemaining: boolean; startActive: boolean; execMode: "bundle" | "sequential";
  delayMinMs: number; delayMaxMs: number;
}): Omit<AutoCleanCreateBody, "mint" | "symbol"> {
  // Each complete bundle becomes one buyer carrying its explicit holder pairing
  // (sellerWalletId), submitted in row order. The sellers pool = the distinct
  // holders used across all bundles.
  const valid = s.bundles.filter(
    (b) => b.sellerId && b.buyerId && b.sellerId !== b.buyerId && parseFloat(b.amount) > 0,
  );
  const buyers = valid.map((b) => ({
    walletId: b.buyerId, amount: parseFloat(b.amount), unit: b.unit, sellerWalletId: b.sellerId,
  }));
  const sellerIds: string[] = [];
  for (const b of valid) if (!sellerIds.includes(b.sellerId)) sellerIds.push(b.sellerId);
  const sellers = sellerIds.map((walletId) => ({ walletId }));
  return {
    // Always an ATOMIC clean (one Jito bundle, link-broken). Funding source per
    // (buyers need no SOL); "funded" = buyers re-buy with their OWN pre-existing SOL.
    mode: s.mode,
    sellers,
    buyers,
    execMode: s.execMode,
    // Self-funded only — seller-funded is always sell-first (buyer funded by the sale).
    legOrder: s.mode === "funded" ? s.legOrder : "sellFirst",
    // Per-trade spacing between consecutive units (bundles / pairs), honored in
    // BOTH bundle and rpc modes. 0 = back-to-back (confirmations run in the bg).
    delayMinMs: s.delayMinMs,
    delayMaxMs: s.delayMaxMs,
    sellRemaining: s.sellRemaining,
    slippageBps: Math.round(AUTO_CLEAN_SLIPPAGE_PCT * 100),
    repeatCount: AUTO_CLEAN_REPEAT_COUNT,
    repeatDelaySec: AUTO_CLEAN_REPEAT_DELAY_SEC,
    status: s.startActive ? "active" : "paused",
  };
}

// ── Panel ────────────────────────────────────────────────────────────────

export function AutoCleanPanel({
  client, wallets, pushToast, mint, symbol,
  embedded, createOpen, onCreateClose, refreshNonce,
}: {
  client: Client;
  wallets: UserWallet[];
  pushToast: Toast;
  mint?: string;
  symbol?: string | null;
  /** Embedded in a unified parent panel: hide own button + prose; the parent
   *  renders the action grid and drives the create modal via `createOpen`. */
  embedded?: boolean;
  createOpen?: boolean;
  onCreateClose?: () => void;
  refreshNonce?: number;
}) {
  const [sessions, setSessions] = useState<AutoCleanSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [createInternal, setCreateInternal] = useState(false);
  const create = embedded ? !!createOpen : createInternal;
  const setCreate = (v: boolean) => {
    if (embedded) { if (!v) onCreateClose?.(); }
    else setCreateInternal(v);
  };

  const refresh = useCallback(async () => {
    const r = await client.listAutoClean(mint ? { mint } : {}).catch(() => ({ sessions: [] as AutoCleanSession[] }));
    setSessions(r.sessions);
    setLoading(false);
  }, [client, mint]);

  useEffect(() => { void refresh(); }, [refresh, refreshNonce]);

  // Poll live while any session is active so the step log animates.
  const anyActive = sessions.some((s) => s.status === "active");
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [anyActive, refresh]);

  const platform = useMemo(() => wallets.filter((w) => w.kind === "PLATFORM"), [wallets]);

  async function setStatus(id: string, status: "paused" | "active" | "stopped") {
    try { await client.setAutoCleanStatus(id, status); await refresh(); }
    catch (e) { pushToast({ title: "UPDATE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" }); }
  }
  async function runNow(id: string) {
    try { await client.runAutoClean(id); await refresh(); pushToast({ title: `${AUTO_LABEL.clean} started`, body: "rotation firing", tone: "buy" }); }
    catch (e) { pushToast({ title: "RUN FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" }); }
  }
  async function remove(id: string) {
    if (!confirm(`Delete this ${AUTO_LABEL.clean} session permanently?`)) return;
    try { await client.deleteAutoClean(id); await refresh(); }
    catch (e) { pushToast({ title: "DELETE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" }); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!embedded && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn size="sm" tone="primary" onClick={() => setCreate(true)}>{autoAddLabel("clean")}</Btn>
          <Btn size="sm" onClick={() => void refresh()}>↻</Btn>
        </div>
      )}

      {loading ? (
        <div className="skeleton" style={{ height: 72, borderRadius: 12 }} />
      ) : sessions.length === 0 ? (
        embedded ? null : (
          <div style={{
            padding: "26px 20px", textAlign: "center", borderRadius: 12,
            background: "var(--ink-1)", border: "1px dashed var(--line-soft)",
            color: "var(--paper-3)", fontSize: 12, lineHeight: 1.5,
          }}>
            No {AUTO_LABEL.clean} sessions yet. Rotate token supply out of one set of
            wallets into fresh wallets — optionally self-funding the buyers from
            the sale proceeds via the privacy-pool distribute.
          </div>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sessions.map((s) => (
            <CleanRow key={s.id} s={s} wallets={platform}
              onStatus={(st) => setStatus(s.id, st)} onRun={() => runNow(s.id)} onDelete={() => remove(s.id)} />
          ))}
        </div>
      )}

      {create && (
        <NewAutoCleanModal
          open onClose={() => setCreate(false)} onCreated={() => { setCreate(false); void refresh(); }}
          client={client} wallets={platform} mint={mint} symbol={symbol} />
      )}
    </div>
  );
}

// ── Session row + live step log ────────────────────────────────────────────

function CleanRow({ s, wallets, onStatus, onRun, onDelete }: {
  s: AutoCleanSession; wallets: UserWallet[];
  onStatus: (st: "paused" | "active" | "stopped") => void; onRun: () => void; onDelete: () => void;
}) {
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(s.status === "active");
  const label = useCallback((wid: string) => {
    const w = wallets.find((x) => x.id === wid);
    return w ? (w.displayLabel || shortAddr(w.pubkey)) : wid.slice(0, 6);
  }, [wallets]);
  const steps = Array.isArray(s.lastRun) ? s.lastRun : [];
  const stopped = s.status === "stopped";
  return (
    <div style={{ background: "var(--ink-1)", border: "1px solid var(--line-soft)", borderLeft: "3px solid var(--info)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--info)", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "var(--font-mono)" }}>{AUTO_LABEL.clean}</span>
            <span style={{ fontSize: 11, color: "var(--paper-3)", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>{s.mode}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)" }}>{s.symbol ?? shortAddr(s.mint)}</span>
            <StatusBadge status={s.status} />
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Stat label="Sellers" value={String(s.sellers.length)} />
            <Stat label="Buyers" value={String(s.buyers.length)} />
            <Stat label="Rotations" value={s.repeatCount === 0 ? `${s.rotationCount} · ∞` : `${s.rotationCount} / ${s.repeatCount}`} />
            <Stat label="Sold" value={`${s.totalSoldSol.toFixed(3)} ◎`} />
            <Stat label="Exec" value={s.execMode} />
          </div>
          {s.pausedReason && stopped && (
            <span style={{ fontSize: 10, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>ended: {s.pausedReason}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", alignItems: "flex-start" }}>
          {!stopped && s.status === "active" && <Btn size="xs" onClick={() => onStatus("paused")}>Pause</Btn>}
          {s.status !== "active" && <Btn size="xs" tone="primary" onClick={onRun}>Clean now</Btn>}
          {!stopped && <Btn size="xs" tone="sell" onClick={() => onStatus("stopped")}>Stop</Btn>}
          {stopped && <Btn size="xs" tone="sell" onClick={onDelete}>Delete</Btn>}
          {steps.length > 0 && <Btn size="xs" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Log"}</Btn>}
        </div>
      </div>

      {open && steps.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--line-soft)", paddingTop: 8, maxHeight: isPhone ? 150 : 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
          {steps.slice(-60).map((st) => <StepLine key={st.seq} st={st} label={label} />)}
        </div>
      )}
    </div>
  );
}

function StepLine({ st, label }: { st: AutoCleanStep; label: (id: string) => string }) {
  const isPhone = useIsPhone();
  const tone = st.status === "success" ? "var(--buy)" : st.status === "error" ? "var(--sell)" : "var(--paper-3)";
  const icon = st.status === "success" ? "✓" : st.status === "error" ? "✕" : "…";
  const sig = st.signature || st.bundleId;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: isPhone ? 4 : 8, fontSize: 10.5, fontFamily: "var(--font-mono)" }}>
      <span style={{ color: tone, width: 10, flexShrink: 0 }}>{icon}</span>
      <span style={{ color: "var(--paper-4)", width: 16, flexShrink: 0 }}>r{st.rotation}</span>
      {/* On phones the fixed-width action/wallet columns blow past 360px; let them
          flex and drop the wallet label entirely (.hide-phone) to free space. */}
      <span style={{
        color: "var(--paper-2)", textTransform: "uppercase",
        width: isPhone ? "auto" : 96, flex: isPhone ? "0 1 auto" : undefined,
        minWidth: isPhone ? "auto" : undefined, whiteSpace: "nowrap",
      }}>{st.action.replace("_", " ")}</span>
      <span className="hide-phone" style={{ color: "var(--paper-3)", width: 90 }}>{st.label ?? label(st.wallet)}</span>
      <span style={{ color: "var(--paper-2)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {st.amount ?? ""}{st.error ? ` — ${st.error}` : ""}
      </span>
      {sig && st.status === "success" && (
        <a href={explorerTxUrl(sig)} target="_blank" rel="noreferrer" style={{ color: "var(--info)", textDecoration: "none", flexShrink: 0 }}>↗</a>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--paper)", fontFamily: "var(--font-mono)" }}>{value}</span>
    </span>
  );
}

// ── Modal atoms (editorial "rotation ledger" shell) ────────────────────────

const CleanIc = {
  caret: (s = 11) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6.5 8 10.5l4-4" />
    </svg>
  ),
  plus: (s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  ),
  arrow: (s = 13) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  ),
};

function Eyebrow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span className="eyebrow" style={style}>{children}</span>;
}

// Settings-modal field primitives, mirrored from SettingsModal.tsx so Auto Clean
// reads as the same surface: a label/hint row with a right-aligned control, the
// pill toggle, and the ink-0 input styling.
const acDelayInput: React.CSSProperties = {
  width: 64, flexShrink: 0, background: "var(--ink-0)", border: "1px solid var(--line-soft)",
  color: "var(--paper)", padding: "7px 9px", borderRadius: 6, fontSize: 12,
  fontFamily: "var(--font-mono)", textAlign: "right", outline: "none",
};

const acInputStyle: React.CSSProperties = {
  background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 6,
  padding: "6px 10px", color: "var(--paper)", fontFamily: "var(--font-mono)",
  fontSize: 11, width: 96, textAlign: "right", outline: "none",
};

function SettingRow({ label, hint, children, last }: {
  label: React.ReactNode; hint?: string; children: React.ReactNode; last?: boolean;
}) {
  const isPhone = useIsPhone();
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isPhone ? "1fr" : "1fr auto",
      alignItems: isPhone ? "start" : "center", gap: isPhone ? 8 : 16,
      padding: "12px 0", borderBottom: last ? undefined : "1px solid var(--line-soft)",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: "var(--paper)" }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--paper-4)", lineHeight: 1.4 }}>{hint}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{children}</div>
    </div>
  );
}

function SettingToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      style={{
        width: 36, height: 20, borderRadius: 999,
        background: on ? "var(--accent, var(--amber))" : "var(--ink-2)",
        border: "1px solid var(--line-soft)", position: "relative", cursor: "pointer",
        transition: "background 150ms", padding: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 1, left: on ? 17 : 1, width: 16, height: 16,
        borderRadius: "50%", background: "var(--paper)", transition: "left 150ms",
      }} />
    </button>
  );
}

function acFooterBtn(kind: "primary" | "ghost" | "disabled"): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px",
    fontSize: 11, letterSpacing: "0.04em", fontFamily: "var(--font-mono)",
    borderRadius: 6, textTransform: "uppercase",
  };
  if (kind === "primary") return { ...base, background: "var(--paper)", color: "var(--ink-0)", border: "1px solid var(--paper)", cursor: "pointer" };
  if (kind === "disabled") return { ...base, background: "transparent", color: "var(--paper-4)", border: "1px solid var(--line-soft)", cursor: "not-allowed", opacity: 0.55 };
  return { ...base, background: "transparent", color: "var(--paper-2)", border: "1px solid var(--line-soft)", cursor: "pointer" };
}

function TokenChip({ symbol }: { symbol: string }) {
  const letter = (symbol.trim()[0] ?? "?").toUpperCase();
  return (
    <span style={{
      width: 18, height: 18, borderRadius: 4, flexShrink: 0,
      background: "color-mix(in oklch, var(--accent) 26%, var(--ink-2))",
      border: "1px solid var(--line-soft)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, color: "var(--paper)",
    }}>{letter}</span>
  );
}

// ── Bundle composer (modular holder → buyer pairs) ─────────────────────────

function WalletSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (id: string) => void; placeholder: string;
  options: Array<{ id: string; label: string; meta?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateMenuPos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxH = 220;
    const gap = 5;
    let top = rect.bottom + gap;
    if (top + maxH > window.innerHeight - 8 && rect.top - maxH - gap > 8) {
      top = rect.top - maxH - gap;
    }
    // Keep the menu on-screen: when the trigger sits near the right edge of a
    // narrow phone, rect.left + rect.width would overflow — clamp the left so the
    // menu stays within the viewport (paired with maxWidth on the menu element).
    setMenuPos({ top, left: clampLeft(rect.left, rect.width), width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPos();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", updateMenuPos);
    window.addEventListener("scroll", updateMenuPos, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", updateMenuPos);
      window.removeEventListener("scroll", updateMenuPos, true);
    };
  }, [open, updateMenuPos]);

  const cur = options.find((o) => o.id === value);

  const menu = open && menuPos ? createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width,
        maxWidth: viewportMaxWidth(),
        zIndex: 10050,
        background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 8,
        boxShadow: "var(--shadow-pop)", padding: 5, maxHeight: 220, overflowY: "auto",
      }}
    >
      {options.length === 0 && (
        <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>
          no eligible wallets
        </div>
      )}
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => { onChange(o.id); setOpen(false); }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%",
            padding: "7px 9px", borderRadius: 5,
            background: o.id === value ? "var(--ink-3)" : "transparent",
            color: "var(--paper)", textAlign: "left", border: "none", cursor: "pointer",
          }}
          onMouseEnter={(e) => { if (o.id !== value) e.currentTarget.style.background = "var(--ink-1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = o.id === value ? "var(--ink-3)" : "transparent"; }}
        >
          <span style={{ fontSize: 12.5 }}>{o.label}</span>
          {o.meta && <span className="mono" style={{ fontSize: 10.5, color: "var(--paper-4)" }}>{o.meta}</span>}
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <span ref={rootRef} style={{ position: "relative", flex: 1, minWidth: 110 }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          const next = !open;
          if (next) updateMenuPos();
          setOpen(next);
        }}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
          background: "var(--ink-0)",
          border: `1px solid ${value ? "var(--accent)" : "var(--line-soft)"}`,
          color: value ? "var(--paper)" : "var(--paper-4)",
          padding: "7px 9px", borderRadius: 6, fontSize: 12,
          fontFamily: "var(--font-mono)", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cur ? cur.label : placeholder}
        </span>
        <span style={{ opacity: 0.6, display: "inline-flex", flexShrink: 0 }}>{CleanIc.caret(10)}</span>
      </button>
      {menu}
    </span>
  );
}

function BundleComposer({ wallets, bundles, setBundles, tokenOf, solOf, preview, loading, loaded, tokenSymbol }: {
  wallets: UserWallet[]; bundles: BundleRow[]; setBundles: (b: BundleRow[]) => void;
  tokenOf: (id: string) => number; solOf: (id: string) => number;
  preview: boolean; loading: boolean; loaded: boolean; tokenSymbol?: string | null;
}) {
  const isPhone = useIsPhone();
  if (wallets.length === 0) return <Empty>No platform wallets.</Empty>;
  const rid = () => Math.random().toString(36).slice(2);
  const lbl = (w: UserWallet) => w.displayLabel || shortAddr(w.pubkey);

  const isHolder = (id: string) => tokenOf(id) > 0;
  const holders = wallets.filter((w) => isHolder(w.id));
  const activeHolderIds = new Set(bundles.filter((b) => b.buyerId).map((b) => b.sellerId));

  const addBuyer = (holderId: string) =>
    setBundles([...bundles, { id: rid(), sellerId: holderId, buyerId: "", amount: "", unit: "token" }]);
  const update = (id: string, patch: Partial<BundleRow>) =>
    setBundles(bundles.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const remove = (id: string) => setBundles(bundles.filter((b) => b.id !== id));

  const buyerOptionsFor = (holderId: string) =>
    wallets
      .filter((w) => w.id !== holderId && !activeHolderIds.has(w.id) && !isHolder(w.id))
      .map((w) => ({ id: w.id, label: lbl(w), meta: loaded ? `${solOf(w.id).toFixed(2)} ◎` : "" }));

  if (holders.length === 0) {
    return <Empty>{loading ? "loading balances…" : "No wallets hold this token or have a deploy buy set yet."}</Empty>;
  }

  const sym = tokenSymbol?.trim() || "TOK";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {holders.map((h) => {
        const rows = bundles.filter((b) => b.sellerId === h.id);
        const tb = tokenOf(h.id);
        const buyerOpts = buyerOptionsFor(h.id);
        const live = rows.filter((b) => b.buyerId && parseFloat(b.amount) > 0);
        return (
          <div key={h.id} style={{
            border: "1px solid var(--line-soft)", borderRadius: 10, background: "var(--ink-0)", overflow: "hidden",
          }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              padding: "10px 14px", borderBottom: "1px solid var(--line-soft)",
              background: "var(--ink-1)",
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <Eyebrow style={{ fontSize: 9, flexShrink: 0, color: "var(--accent)" }}>Holder</Eyebrow>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: "var(--paper)", whiteSpace: "nowrap",
                }}>{lbl(h)}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", flexShrink: 0 }}>{shortAddr(h.pubkey)}</span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--paper)", fontVariantNumeric: "tabular-nums" }}>
                  {preview ? "~" : ""}{fmtAmt(tb)}
                </span>
                <Eyebrow style={{ fontSize: 8 }}>holds · {sym}</Eyebrow>
              </span>
            </div>

            <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
              {rows.length === 0 && (
                <span style={{ fontSize: 11, color: "var(--paper-4)", fontFamily: "var(--font-mono)", paddingLeft: 18 }}>
                  no buyers yet — add one to start the rotation
                </span>
              )}
              {rows.map((b) => (
                <div key={b.id} style={{
                  display: "flex", alignItems: "center", gap: 7,
                  // On phones the buyer-select + amount + unit + remove can't fit on
                  // one 360px line; allow it to wrap so the select takes the first
                  // row and amount/unit/remove flow underneath.
                  flexWrap: isPhone ? "wrap" : "nowrap",
                }}>
                  <span style={{ color: "var(--paper-4)", fontSize: 14, flexShrink: 0, width: 12 }}>↳</span>
                  <WalletSelect value={b.buyerId} onChange={(id) => update(b.id, { buyerId: id })} options={buyerOpts} placeholder="Buyer…" />
                  <input value={b.amount} placeholder="0" inputMode="decimal"
                    onChange={(e) => update(b.id, { amount: e.target.value.replace(/[^0-9.]/g, "") })}
                    style={{
                      width: isPhone ? "auto" : 78, flex: isPhone ? 1 : undefined, minWidth: isPhone ? 60 : undefined,
                      flexShrink: 0, background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                      color: "var(--paper)", padding: "7px 9px", borderRadius: 6, fontSize: 12,
                      fontFamily: "var(--font-mono)", textAlign: "right", outline: "none",
                    }} />
                  <button type="button" onClick={() => update(b.id, { unit: b.unit === "token" ? "sol" : "token" })} title="buyer acquires — toggle unit"
                    style={{
                      width: 42, flexShrink: 0, background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                      color: "var(--paper-2)", padding: "7px 0", borderRadius: 6, fontSize: 9.5, fontWeight: 700,
                      fontFamily: "var(--font-mono)", letterSpacing: ".04em", cursor: "pointer",
                    }}>{b.unit === "token" ? "TOK" : "SOL"}</button>
                  <button type="button" aria-label="remove buyer" onClick={() => remove(b.id)} style={{
                    width: 28, height: 28, flexShrink: 0, background: "transparent",
                    border: "1px solid var(--line-soft)", borderRadius: 6, color: "var(--paper-4)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--sell)"; e.currentTarget.style.borderColor = "var(--sell)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-4)"; e.currentTarget.style.borderColor = "var(--line-soft)"; }}
                  >{Icon.close(12)}</button>
                </div>
              ))}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                marginTop: 1, paddingLeft: 18,
              }}>
                <button type="button" onClick={() => addBuyer(h.id)} style={{
                  display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
                  padding: "5px 11px", background: "transparent", color: "var(--accent)",
                  border: "1px dashed var(--accent)", borderRadius: 6, fontSize: 10,
                  fontFamily: "var(--font-mono)", letterSpacing: ".06em", textTransform: "uppercase", cursor: "pointer",
                }}>{CleanIc.plus(11)} Add buyer</button>
                {live.length > 0 && (
                  <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", letterSpacing: ".04em" }}>
                    sells → {live.length} buyer{live.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: "var(--paper-4)", padding: "10px 4px" }}>{children}</div>;
}
function fmtAmt(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(2);
}

// ── Create modal (also draft mode for /deploy) ─────────────────────────────

export function NewAutoCleanModal({
  open, onClose, onCreated, client, wallets, mint, symbol, onDraft, previewSupply,
}: {
  open: boolean; onClose: () => void; onCreated: () => void;
  client: Client; wallets: UserWallet[]; mint?: string; symbol?: string | null;
  // Draft mode (deploy "before launch"): return the config instead of creating.
  onDraft?: (body: Omit<AutoCleanCreateBody, "mint" | "symbol">) => void;
  // Deploy preview: tokens each wallet WILL hold after launch (from the planned
  // bundle buys). Shown as fake supply in the seller column pre-launch so the
  // user can pick their deploy buy-wallets as sellers before the token exists.
  previewSupply?: Record<string, number>;
}) {
  const { pushToast } = useApp();
  const [mintInput, setMintInput] = useState(mint ?? "");
  const [mode, setMode] = useState<AutoCleanMode>("funded");
  // The rotation as a list of explicit holder→buyer bundles (modular composer).
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  // Self-funded bundle leg order. Default "sellFirst" (holder dumps then re-buy).
  const [legOrder, setLegOrder] = useState<AutoCleanLegOrder>("sellFirst");
  const [sellRemaining, setSellRemaining] = useState(false);
  const [startActive, setStartActive] = useState(true);
  // Debug/advanced: send the sell + buy as separate RPC txs instead of one atomic
  // Jito bundle, so a failing leg (e.g. a reverting sell) lands on-chain with a
  // signature we can inspect. Default "bundle" (atomic, safe). ⚠ sequential is NOT
  // atomic — a sell can land without its re-buy.
  const [execMode, setExecMode] = useState<"bundle" | "sequential">("bundle");
  // Per-trade delay between consecutive units (bundles / rpc pairs), randomized in
  // [min,max]. Default 0/0 = no delay, units fire back-to-back (confirmations run
  // in the background). Applies to both bundle and sequential exec.
  const [delayMin, setDelayMin] = useState("0");
  const [delayMax, setDelayMax] = useState("0");
  const [busy, setBusy] = useState(false);

  const effMint = (mint ?? mintInput).trim();
  // A bundle counts once it's fully specified (holder ≠ buyer, positive amount).
  const validBundles = bundles.filter(
    (b) => b.sellerId && b.buyerId && b.sellerId !== b.buyerId && parseFloat(b.amount) > 0,
  );
  const holderCount = new Set(validBundles.map((b) => b.sellerId)).size;
  const buyerCount = validBundles.length;
  const canSave = (!!effMint || !!onDraft) && validBundles.length > 0 && !busy;

  // Live on-chain balances per wallet so sellers can only be picked among the
  // wallets that ACTUALLY hold the token (b33 supply-cleaner reference). When
  // there's no mint yet (the /deploy draft, pre-launch) balances don't exist —
  // the sellers will be the deploy wallets that hold supply only after launch,
  // so we skip the zero-supply gate and just flag it.
  const mintKnown = effMint.length >= 32;
  const [rawBal, setRawBal] = useState<Record<string, { sol: number; tokens: Record<string, number> }>>({});
  const [balLoaded, setBalLoaded] = useState(false);
  const [balLoading, setBalLoading] = useState(false);
  const fetchBalances = useCallback(async () => {
    if (wallets.length === 0) return;
    setBalLoading(true);
    try {
      const r = await client.walletBalances(wallets.map((w) => w.id));
      const map: Record<string, { sol: number; tokens: Record<string, number> }> = {};
      for (const [wid, entry] of Object.entries(r.balances)) {
        if (entry && (entry as { ok?: boolean }).ok) {
          const b = (entry as { balances: { sol: number; tokens: Array<{ mint: string; amount: number }> } }).balances;
          const tokens: Record<string, number> = {};
          for (const t of b.tokens ?? []) tokens[t.mint] = t.amount;
          map[wid] = { sol: b.sol ?? 0, tokens };
        }
      }
      setRawBal(map);
      setBalLoaded(true);
    } catch { /* leave unloaded — no gate */ } finally { setBalLoading(false); }
  }, [client, wallets]);
  useEffect(() => { void fetchBalances(); }, [fetchBalances]);
  // Supply per wallet: real on-chain balance once a mint is live, else the
  // deploy preview (tokens the wallet WILL hold after launch from the bundle).
  const previewMode = !mintKnown && !!previewSupply && Object.keys(previewSupply).length > 0;
  const supplyKnown = mintKnown ? balLoaded : previewMode;
  const tokenOf = useCallback(
    (id: string) => (mintKnown ? (rawBal[id]?.tokens[effMint] ?? 0) : (previewSupply?.[id] ?? 0)),
    [mintKnown, rawBal, effMint, previewSupply],
  );
  const solOf = useCallback((id: string) => rawBal[id]?.sol ?? 0, [rawBal]);

  // Once supply is known, drop any buyer association whose holder turns out to
  // hold no supply (e.g. a wallet that won't hold the launched token) — its
  // holder card disappears, so the orphaned rows must go too.
  useEffect(() => {
    if (!supplyKnown) return;
    setBundles((cur) => {
      const next = cur.filter((b) => tokenOf(b.sellerId) > 0);
      return next.length === cur.length ? cur : next;
    });
  }, [supplyKnown, tokenOf]);

  async function save() {
    if (!canSave) return;
    const dMin = Math.max(0, Math.round(Number(delayMin) || 0));
    const dMax = Math.max(dMin, Math.round(Number(delayMax) || 0));
    const body = buildBody({ mode, bundles, legOrder, sellRemaining, startActive, execMode, delayMinMs: dMin, delayMaxMs: dMax });
    if (onDraft) { onDraft(body); onCreated(); return; }
    setBusy(true);
    try {
      await client.createAutoClean({ ...body, mint: effMint, symbol: symbol ?? undefined });
      pushToast({ title: startActive ? `${AUTO_LABEL.clean} started` : `${AUTO_LABEL.clean} saved`, body: symbol ?? shortAddr(effMint), tone: "buy" });
      onCreated();
    } catch (e) {
      pushToast({ title: "CREATE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally { setBusy(false); }
  }

  const displaySymbol = symbol?.trim() || (effMint ? shortAddr(effMint, 4) : "token");
  const saveLabel = busy
    ? "Saving…"
    : onDraft
      ? "Queue for launch"
      : startActive
        ? "Clean now"
        : "Save paused";

  return (
    <Modal open={open} onClose={onClose} width={720} align="center" mobileVariant="sheet">
      <div style={{
        display: "flex", flexDirection: "column", minHeight: 0,
        maxHeight: "min(86vh, 800px)", background: "var(--ink-1)",
      }}>
        {/* header — mirrors SettingsModal's section header */}
        <div style={{
          padding: "14px 20px", borderBottom: "1px solid var(--line-soft)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          background: "var(--ink-1)", flexShrink: 0,
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 14, color: "var(--paper)", fontWeight: 600 }}>{AUTO_LABEL.clean}</span>
            <Eyebrow style={{ color: "var(--paper-4)" }}>supply rotation</Eyebrow>
            {effMint && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "3px 9px",
                border: "1px solid var(--line-soft)", borderRadius: 999, background: "var(--ink-0)",
              }}>
                <TokenChip symbol={displaySymbol} />
                <span style={{ fontSize: 12, color: "var(--paper)" }}>{displaySymbol}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)" }}>{shortAddr(effMint)}</span>
              </span>
            )}
          </span>
          <button onClick={onClose} aria-label="Close" style={{
            padding: 6, color: "var(--paper-3)", background: "transparent",
            border: "1px solid var(--line-soft)", borderRadius: 6, cursor: "pointer", display: "inline-flex",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-3)"; }}
          >{Icon.close(11)}</button>
        </div>

        {/* body — single scrolling pane */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", minHeight: 0 }}>
          {!mint && !onDraft && (
            <div style={{ paddingBottom: 16 }}>
              <Eyebrow style={{ display: "block", paddingBottom: 6 }}>Token mint</Eyebrow>
              <input value={mintInput} onChange={(e) => setMintInput(e.target.value)} placeholder="mint address"
                style={{ ...acInputStyle, width: "100%", textAlign: "left", fontSize: 12, padding: "8px 12px" }} />
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 6 }}>
            <Eyebrow>Holders → Buyers</Eyebrow>
            {mintKnown && (
              <button type="button" onClick={() => void fetchBalances()} style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px",
                background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 6,
                color: "var(--paper-3)", fontSize: 10, fontFamily: "var(--font-mono)", cursor: "pointer",
              }}>{balLoading ? "…" : "↻ balances"}</button>
            )}
          </div>
          <span style={{ fontSize: 11, color: "var(--paper-4)", lineHeight: 1.5, display: "block", paddingBottom: 10 }}>
            Each holder dumps the supply its buyers re-acquire. Add one or more buyers per holder — every
            holder→buyer pairing rides its own atomic bundle. A wallet that holds supply can&apos;t double as a buyer.
          </span>
          <span style={{
            fontSize: 10.5, display: "block", paddingBottom: 10,
            color: (mintKnown || previewMode) ? "var(--paper-4)" : "var(--warn)",
            fontFamily: "var(--font-mono)", lineHeight: 1.4,
          }}>
            {mintKnown
              ? (balLoading ? "loading balances…" : balLoaded ? "live balances — each holder must hold supply" : "")
              : previewMode ? "preview supply — what your deploy buy-wallets will hold after launch"
              : "token not live yet — holders will be the deploy wallets that hold supply after launch"}
          </span>
          <BundleComposer
            wallets={wallets} bundles={bundles} setBundles={setBundles}
            tokenOf={tokenOf} solOf={solOf} preview={previewMode}
            loading={mintKnown && balLoading} loaded={balLoaded} tokenSymbol={symbol}
          />

          <div style={{ borderTop: "1px solid var(--line-soft)", marginTop: 18, paddingTop: 8 }}>
            <Eyebrow style={{ display: "block", paddingBottom: 2 }}>How it runs</Eyebrow>
            <SettingRow
              label="Buy first"
              hint={legOrder === "buyFirst"
                ? "Buyer acquires first, then the holder dumps into it — bundle order [buy, sell]."
                : "Off — holder dumps first, then the buyer re-buys — bundle order [sell, buy]."}
            >
              <SettingToggle on={legOrder === "buyFirst"} onChange={(v) => setLegOrder(v ? "buyFirst" : "sellFirst")} />
            </SettingRow>
            <SettingRow
              label="Separate RPC (debug)"
              hint={execMode === "sequential"
                ? "On — sell & buy go as separate RPC txs (not one atomic bundle). A failing leg lands on-chain with a signature you can inspect. ⚠ not atomic: a sell can land without its re-buy."
                : "Off — atomic Jito bundle [sell, buy] (recommended). A failing leg silently doesn't land."}
            >
              <SettingToggle on={execMode === "sequential"} onChange={(v) => setExecMode(v ? "sequential" : "bundle")} />
            </SettingRow>
            <SettingRow
              label="Delay between trades"
              hint={(Number(delayMin) || 0) === 0 && (Number(delayMax) || 0) === 0
                ? "0 = back-to-back, no delay (confirmations run in the background). Applies to bundle & rpc."
                : `Random pause between each ${execMode === "sequential" ? "rpc tx" : "bundle"} — ${Number(delayMin) || 0}–${Math.max(Number(delayMin) || 0, Number(delayMax) || 0)} ms.`}
            >
              <input value={delayMin} placeholder="0" inputMode="numeric"
                onChange={(e) => setDelayMin(e.target.value.replace(/[^0-9]/g, ""))}
                title="min delay (ms)" style={acDelayInput} />
              <span style={{ color: "var(--paper-4)", fontSize: 12 }}>–</span>
              <input value={delayMax} placeholder="0" inputMode="numeric"
                onChange={(e) => setDelayMax(e.target.value.replace(/[^0-9]/g, ""))}
                title="max delay (ms)" style={acDelayInput} />
              <span style={{ color: "var(--paper-4)", fontSize: 11 }}>ms</span>
            </SettingRow>
            <SettingRow
              label="Sell remaining"
              hint="Dump each holder's leftover supply at the end of every rotation."
              last={!!onDraft}
            >
              <SettingToggle on={sellRemaining} onChange={setSellRemaining} />
            </SettingRow>
            {!onDraft && (
              <SettingRow
                label="Run immediately"
                hint="Otherwise it's saved paused — fire it later with Clean now."
                last
              >
                <SettingToggle on={startActive} onChange={setStartActive} />
              </SettingRow>
            )}
          </div>
        </div>

        {/* footer */}
        <div style={{
          padding: "14px 20px", borderTop: "1px solid var(--line-soft)", background: "var(--ink-1)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", flexShrink: 0,
        }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--paper-3)", letterSpacing: ".03em" }}>
            {validBundles.length} bundle{validBundles.length !== 1 ? "s" : ""}
            <span style={{ color: "var(--paper-4)" }}> · {holderCount} holder{holderCount !== 1 ? "s" : ""} → {buyerCount} buyer{buyerCount !== 1 ? "s" : ""}</span>
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} style={acFooterBtn("ghost")}>Cancel</button>
            <button type="button" onClick={() => void save()} disabled={!canSave} style={acFooterBtn(canSave ? "primary" : "disabled")}>
              {saveLabel}
              {!busy && !onDraft && startActive && canSave ? CleanIc.arrow(13) : null}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Deploy draft helpers ───────────────────────────────────────────────────

export interface CleanDraft {
  id: string;
  summary: string;
  body: Omit<AutoCleanCreateBody, "mint" | "symbol">;
}

/// A compact draft configurator for the /deploy "Market" tab. Queues an Auto
/// Clean session that arms (paused) on the new token the instant it launches —
/// since selling needs holdings, it's created paused and fired post-launch.
export function AutoCleanDraftConfig({ client, wallets, value, onChange, previewSupply, embedded }: {
  client: Client; wallets: UserWallet[]; value: CleanDraft[]; onChange: (next: CleanDraft[]) => void;
  // Tokens each wallet will hold after launch (from the planned bundle buys),
  // shown as fake supply in the seller column pre-launch.
  previewSupply?: Record<string, number>;
  /** Render only the add-button (+ modal) so a parent can frame a unified panel. */
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const platform = useMemo(() => wallets.filter((w) => w.kind === "PLATFORM"), [wallets]);
  const rid = () => Math.random().toString(36).slice(2);

  const button = <Btn size="sm" tone="primary" onClick={() => setOpen(true)}>{autoAddLabel("clean")}</Btn>;
  const modal = open ? (
    <NewAutoCleanModal
      open onClose={() => setOpen(false)} onCreated={() => setOpen(false)}
      client={client} wallets={platform} previewSupply={previewSupply}
      onDraft={(b) => {
        onChange([...value, {
          id: rid(),
          summary: `${AUTO_LABEL.clean} · ${b.mode} · ${b.sellers.length}→${b.buyers.length}w · ${b.execMode}`,
          body: { ...b, status: "paused" },
        }]);
        setOpen(false);
      }} />
  ) : null;

  if (embedded) return (
    <>
      <AdvActionCard icon={Icon.autoclean(18)} tint="var(--accent)" title="Auto-clean"
        desc="Shuffles supply between your wallets so holdings look organic — queued paused, you fire it when ready."
        count={value.length} onClick={() => setOpen(true)} />
      {modal}
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 11, color: "var(--paper-3)", lineHeight: 1.5 }}>
        Queue a supply rotation that arms on the new token — sellers sell, buyers
        re-buy (optionally self-funded via distribute). Created paused; fire it
        from the token page once your wallets hold supply.
      </span>
      {value.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {value.map((d) => (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 8 }}>
              <span style={{ fontSize: 11, color: "var(--paper)", fontFamily: "var(--font-mono)" }}>{d.summary}</span>
              <Btn size="xs" tone="sell" onClick={() => onChange(value.filter((x) => x.id !== d.id))}>Remove</Btn>
            </div>
          ))}
        </div>
      )}
      <div>{button}</div>
      {modal}
    </div>
  );
}

/// Arm every queued Auto Clean draft on the freshly-launched mint (paused).
export async function applyAutoCleanDrafts(
  client: Client, mint: string, symbol: string | undefined, drafts: CleanDraft[],
): Promise<number> {
  let armed = 0;
  for (const d of drafts) {
    // Created paused with the awaiting-supply sentinel: the engine flips them to
    // active automatically once the seller wallets hold the launched supply.
    try { await client.createAutoClean({ ...d.body, mint, symbol, status: "paused", pausedReason: "awaiting_launch_supply" }); armed++; }
    catch { /* skip individual failures */ }
  }
  return armed;
}
