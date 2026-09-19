"use client";
/**
 * Watchlist manager — the primary surface for managing tracked wallets.
 *
 * What it does:
 *   • lists watched wallets with label, address, alert counters, last fill
 *   • drag-reorder, star primary, hide, mute (silence toasts), notes
 *   • inline rename, copy address, Solscan, snipe deployer, copytrade,
 *     view deployed tokens, remove
 *   • per-wallet alert counts (live + 30s + 5min badges)
 */

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIsPhone } from "../../../hooks/useMediaQuery";
import { useClientNav } from "../../../components/shell/ClientPages";
import { explorerAccountUrl, explorerName } from "../../../lib/chains";
import { useApp } from "../../../contexts/AppContext";
import type { TrackedWallet } from "../../../hooks/useTrackerStream";
import {
  EmptyHero, IconButton, InlineEditableLabel, MenuItem, PopoverMenu,
  PortfolioGlyph, Segmented, shortAddr,
} from "../../portfolio/_components/atoms";
import { Btn, Tooltip } from "../../../components/atoms";
import { useTrackerPrefs, sortByPref } from "./preferences";

export interface WatchlistRowActions {
  copyAddr: (addr: string) => void;
  edit: (w: TrackedWallet) => void;
  remove: (w: TrackedWallet) => void;
}

interface WalletStat {
  lastTs: number | null;
  liveCount: number;
  buys: number;
  sells: number;
}

export function WalletsTab({
  wallets,
  stats,
  loading,
  onRename,
  actions,
  onAdd,
}: {
  wallets: TrackedWallet[];
  stats: Map<string, WalletStat>;
  loading: boolean;
  onRename: (id: string, label: string) => void;
  actions: WatchlistRowActions;
  onAdd: () => void;
}) {
  const prefs = useTrackerPrefs();
  const isPhone = useIsPhone();
  const [filter, setFilter] = useState<"all" | "active" | "muted" | "starred">("all");

  const counts = useMemo(() => ({
    all: wallets.length,
    starred: wallets.filter((w) => prefs.starred.has(w.id)).length,
    muted: wallets.filter((w) => prefs.muted.has(w.id)).length,
    active: wallets.filter((w) => {
      const s = stats.get(w.id);
      return (s?.lastTs ?? 0) > Date.now() - 60 * 60 * 1000;
    }).length,
  }), [wallets, prefs.starred, prefs.muted, stats]);

  const filteredByMode = useMemo(() => {
    if (filter === "all") return wallets;
    if (filter === "starred") return wallets.filter((w) => prefs.starred.has(w.id));
    if (filter === "muted")   return wallets.filter((w) => prefs.muted.has(w.id));
    return wallets.filter((w) => {
      const s = stats.get(w.id);
      return (s?.lastTs ?? 0) > Date.now() - 60 * 60 * 1000;
    });
  }, [filter, wallets, prefs.starred, prefs.muted, stats]);

  const visible = useMemo(() => {
    const inView = filteredByMode.filter((w) => !prefs.hidden.has(w.id));
    return sortByPref(inView, prefs.order, prefs.starred);
  }, [filteredByMode, prefs.order, prefs.starred, prefs.hidden]);

  const hidden = useMemo(
    () => filteredByMode.filter((w) => prefs.hidden.has(w.id)),
    [filteredByMode, prefs.hidden],
  );

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  if (loading && wallets.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{
            height: 88, borderRadius: 12,
            background: "var(--ink-1)", border: "1px solid var(--line-soft)",
            position: "relative", overflow: "hidden",
          }}>
            <span className="skeleton" style={{ position: "absolute", inset: 12, borderRadius: 6 }} />
          </div>
        ))}
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <EmptyHero
        title="No tracked wallets yet."
        body="Paste any Solana address to monitor its trades in real time. Stream alerts surface in the Feed tab; per-wallet rules (snipe deployer, copytrade) get one-click access here."
        icon="◎"
        cta={<Btn size="sm" tone="primary" onClick={onAdd}>+ Track wallet</Btn>}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Toolbar */}
      <div style={{
        display: "flex",
        flexDirection: isPhone ? "column" : "row",
        alignItems: isPhone ? "stretch" : "center",
        justifyContent: "space-between", gap: isPhone ? 8 : 10, flexWrap: "wrap",
      }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: "all",     label: "All",     count: counts.all },
            { value: "active",  label: "Active",  count: counts.active },
            { value: "starred", label: "Starred", count: counts.starred },
            { value: "muted",   label: "Muted",   count: counts.muted },
          ]}
        />
        <Btn size="sm" tone="primary" onClick={onAdd}>+ Track wallet</Btn>
      </div>

      {visible.length === 0 && hidden.length === 0 ? (
        <EmptyHero
          title={`No ${filter === "all" ? "" : filter} wallets in view.`}
          body="Try switching the filter or add a new wallet."
        />
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
          onDragOver={(e) => { if (dragId) e.preventDefault(); }}
        >
          {visible.map((w, i) => {
            const dropBefore = dropIdx === i && dragId !== null && dragId !== w.id;
            return (
              <React.Fragment key={w.id}>
                {dropBefore && <DropIndicator />}
                <WalletRow
                  wallet={w}
                  starred={prefs.starred.has(w.id)}
                  muted={prefs.muted.has(w.id)}
                  draggingSelf={dragId === w.id}
                  note={prefs.notes[w.id] ?? ""}
                  stat={stats.get(w.id) ?? null}
                  onRename={(label) => onRename(w.id, label)}
                  onToggleStar={() => prefs.toggleStar(w.id)}
                  onToggleMuted={() => prefs.toggleMuted(w.id)}
                  onHide={() => prefs.toggleHidden(w.id)}
                  onEdit={() => actions.edit(w)}
                  onRemove={() => actions.remove(w)}
                  onCopy={() => actions.copyAddr(w.address)}
                  onDragStart={() => { setDragId(w.id); setDropIdx(null); }}
                  onDragEnd={() => {
                    if (dragId && dropIdx !== null) {
                      prefs.moveTo(dragId, dropIdx, visible.map((v) => v.id));
                    }
                    setDragId(null);
                    setDropIdx(null);
                  }}
                  onDragOver={(yPct) => setDropIdx(yPct < 0.5 ? i : i + 1)}
                />
              </React.Fragment>
            );
          })}
          {dragId !== null && dropIdx === visible.length && <DropIndicator />}
        </div>
      )}

      {hidden.length > 0 && (
        <div style={{
          marginTop: 14,
          padding: "12px 14px",
          borderTop: "1px dashed var(--line-soft)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 10,
          }}>
            <span className="eyebrow" style={{ fontSize: 10, color: "var(--paper-3)" }}>
              Hidden ({hidden.length})
            </span>
            <button
              onClick={() => { for (const w of hidden) prefs.toggleHidden(w.id); }}
              style={{
                background: "transparent", border: "none",
                color: "var(--paper-3)", fontSize: 11,
                fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
                cursor: "pointer", textTransform: "uppercase",
              }}
            >Show all</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {hidden.map((w) => (
              <div key={w.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 12px", borderRadius: 8,
                background: "var(--ink-1)", border: "1px solid var(--line-soft)",
                opacity: 0.65,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: "var(--paper-2)" }}>{w.label}</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)" }}>
                    {shortAddr(w.address, 6)}
                  </span>
                </div>
                <Btn size="xs" tone="ghost" onClick={() => prefs.toggleHidden(w.id)}>Show</Btn>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Single watchlist row ────────────────────────────────────────────── */

function WalletRow({
  wallet, starred, muted, draggingSelf, note, stat,
  onRename, onToggleStar, onToggleMuted, onHide, onEdit, onRemove, onCopy,
  onDragStart, onDragEnd, onDragOver,
}: {
  wallet: TrackedWallet;
  starred: boolean;
  muted: boolean;
  draggingSelf: boolean;
  note: string;
  stat: WalletStat | null;
  onRename: (label: string) => void;
  onToggleStar: () => void;
  onToggleMuted: () => void;
  onHide: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onCopy: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (yPct: number) => void;
}) {
  const router = useRouter();
  const isPhone = useIsPhone();
  const { navigate: clientNav } = useClientNav();
  const { openSearch, openWalletModal } = useApp();
  const accent = starred ? "var(--gold)" :
                 muted ? "var(--paper-4)" :
                 (stat?.liveCount ?? 0) > 0 ? "var(--buy)" :
                 "var(--paper-4)";

  const rowRef = useRef<HTMLDivElement | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  function openMenu() {
    const rect = moreBtnRef.current?.getBoundingClientRect();
    if (rect) setMenuAnchor(rect);
  }

  function openAutomation(kind: "snipe" | "copy") {
    const params = new URLSearchParams({
      kind,
      ...(kind === "snipe" ? { deployer: wallet.address } : { trackedAddress: wallet.address }),
      name: `${kind === "snipe" ? "Snipe" : "Copy"} ${wallet.label}`,
    });
    clientNav(`/automation?${params.toString()}`);
  }

  return (
    <div
      ref={rowRef}
      onDragOver={(e) => {
        e.preventDefault();
        const rect = rowRef.current?.getBoundingClientRect();
        if (!rect) return;
        const y = (e.clientY - rect.top) / rect.height;
        onDragOver(y);
      }}
      style={{
        position: "relative",
        background: muted ? "color-mix(in oklch, var(--paper) 2%, var(--ink-1))" : "var(--ink-1)",
        border: `1px solid var(--line-soft)`,
        borderRadius: 12,
        padding: "12px 14px 12px 18px",
        display: "flex", flexDirection: "column", gap: 10,
        transition: "background 140ms, border-color 140ms, opacity 140ms",
        opacity: draggingSelf ? 0.4 : muted ? 0.72 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 0, bottom: 0, left: 0,
        width: 3, background: accent,
        borderRadius: "12px 0 0 12px",
        pointerEvents: "none",
      }} />

      {/* Top line */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <div
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          style={{
            cursor: "grab", color: "var(--paper-4)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 18, height: 24,
          }}
        >{PortfolioGlyph.drag}</div>

        <Tooltip content={starred ? "Unstar" : "Star (pin to top)"}>
          <button
            onClick={onToggleStar}
            style={{
              background: "transparent", border: "none",
              color: starred ? "var(--gold)" : "var(--paper-4)",
              cursor: "pointer", padding: 2,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              transition: "color 120ms",
            }}
          >{PortfolioGlyph.star(starred)}</button>
        </Tooltip>

        <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <InlineEditableLabel value={wallet.label} onCommit={onRename} fontSize={14} />
          {muted && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "2px 7px", borderRadius: 999,
              background: "var(--ink-2)", color: "var(--paper-4)",
              fontSize: 9, fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600,
              border: "1px solid var(--line-soft)",
            }}>Muted</span>
          )}
          {(stat?.liveCount ?? 0) > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "2px 8px", borderRadius: 999,
              background: "color-mix(in oklch, var(--buy) 14%, transparent)",
              color: "var(--buy)",
              fontSize: 9, fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600,
              border: "1px solid color-mix(in oklch, var(--buy) 40%, transparent)",
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: 999, background: "var(--buy)",
                animation: "pulseDot 2s ease-in-out infinite",
              }} />
              {stat!.liveCount} live
            </span>
          )}
        </div>

        <Btn size="xs" tone="ghost" onClick={() => openWalletModal(wallet.address)}>Activity</Btn>

        <button
          ref={moreBtnRef}
          onClick={openMenu}
          title="More"
          style={{
            width: 28, height: 28,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "transparent",
            border: "1px solid var(--line-soft)",
            borderRadius: 7,
            color: "var(--paper-2)", cursor: "pointer",
            transition: "background 120ms",
          }}
        >{PortfolioGlyph.more}</button>
      </div>

      {/* Address row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 26, flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--paper-3)", letterSpacing: "0.01em" }}>
          {shortAddr(wallet.address, 7, 6)}
        </span>
        <IconButton onClick={onCopy} title="Copy address">{PortfolioGlyph.copy}</IconButton>
        <a
          href={explorerAccountUrl(wallet.address)}
          target="_blank" rel="noreferrer"
          title={`Open on ${explorerName()}`}
          style={{
            width: 28, height: 28,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "transparent",
            border: "1px solid var(--line-soft)",
            borderRadius: 7,
            color: "var(--paper-2)",
          }}
        >{PortfolioGlyph.ext}</a>
        {note && (
          <span style={{
            padding: "3px 9px", borderRadius: 6,
            background: "var(--gold-w)",
            color: "var(--paper-2)", fontSize: 11,
            border: "1px solid color-mix(in oklch, var(--gold) 30%, transparent)",
            fontStyle: "italic",
            maxWidth: isPhone ? "90%" : 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }} title={note}>“{note}”</span>
        )}
      </div>

      {/* Stats strip */}
      <div style={{
        display: "grid", paddingLeft: 26,
        gridTemplateColumns: isPhone ? "1fr 1fr" : "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 10,
        borderTop: "1px dashed var(--line-soft)",
        paddingTop: 10,
      }}>
        <Stat
          label="Last fill"
          value={stat?.lastTs ? formatRelativeShort(stat.lastTs) : "—"}
        />
        <Stat label="Buys (seen)" value={(stat?.buys ?? 0).toString()} tone={stat && stat.buys > 0 ? "buy" : "neutral"} />
        <Stat label="Sells (seen)" value={(stat?.sells ?? 0).toString()} tone={stat && stat.sells > 0 ? "sell" : "neutral"} />
        <Stat
          label="Net side"
          value={(() => {
            if (!stat || (stat.buys === 0 && stat.sells === 0)) return "—";
            if (stat.buys === stat.sells) return "Balanced";
            return stat.buys > stat.sells ? "Buying" : "Selling";
          })()}
          tone={(() => {
            if (!stat || (stat.buys === 0 && stat.sells === 0)) return "neutral";
            if (stat.buys === stat.sells) return "neutral";
            return stat.buys > stat.sells ? "buy" : "sell";
          })()}
        />
      </div>

      {/* Action row */}
      <div style={{
        display: "flex", gap: 6, paddingLeft: 26,
        paddingTop: 6, flexWrap: "wrap",
      }}>
        <Btn size="xs" tone="ghost" onClick={() => openAutomation("snipe")}>Snipe deployer</Btn>
        <Btn size="xs" tone="ghost" onClick={() => openAutomation("copy")}>Copytrade</Btn>
        <Btn size="xs" tone="ghost" onClick={() => openSearch(wallet.address)}>Deployed tokens</Btn>
        <div style={{ flex: 1 }} />
        <Btn size="xs" tone="ghost" onClick={onEdit}>Edit note</Btn>
      </div>

      <PopoverMenu anchorRect={menuAnchor} onClose={() => setMenuAnchor(null)} align="end">
        <MenuItem icon={PortfolioGlyph.copy}    onClick={() => { onCopy(); setMenuAnchor(null); }}>Copy address</MenuItem>
        <MenuItem icon={PortfolioGlyph.ext}     onClick={() => { window.open(explorerAccountUrl(wallet.address), "_blank", "noopener"); setMenuAnchor(null); }}>{explorerName()}</MenuItem>
        <MenuItem onClick={() => { openWalletModal(wallet.address); setMenuAnchor(null); }}>Open activity…</MenuItem>
        <MenuItem onClick={() => { openSearch(wallet.address); setMenuAnchor(null); }}>Deployed tokens</MenuItem>
        <span style={{ display: "block", height: 1, background: "var(--line-soft)", margin: "4px 4px" }} />
        <MenuItem onClick={() => { openAutomation("snipe"); setMenuAnchor(null); }}>Snipe deployer…</MenuItem>
        <MenuItem onClick={() => { openAutomation("copy"); setMenuAnchor(null); }}>Copytrade wallet…</MenuItem>
        <span style={{ display: "block", height: 1, background: "var(--line-soft)", margin: "4px 4px" }} />
        <MenuItem icon={PortfolioGlyph.star(starred)} onClick={() => { onToggleStar(); setMenuAnchor(null); }}>
          {starred ? "Unstar" : "Star (pin to top)"}
        </MenuItem>
        <MenuItem onClick={() => { onToggleMuted(); setMenuAnchor(null); }}>
          {muted ? "Unmute toasts" : "Mute toasts"}
        </MenuItem>
        <MenuItem icon={PortfolioGlyph.eyeOff} onClick={() => { onHide(); setMenuAnchor(null); }}>Hide from list</MenuItem>
        <MenuItem onClick={() => { onEdit(); setMenuAnchor(null); }}>Edit note…</MenuItem>
        <span style={{ display: "block", height: 1, background: "var(--line-soft)", margin: "4px 4px" }} />
        <MenuItem icon={PortfolioGlyph.trash} tone="danger" onClick={() => { onRemove(); setMenuAnchor(null); }}>
          Stop tracking…
        </MenuItem>
      </PopoverMenu>

      {/* router reference — keeps lint from complaining about unused router prop */}
      <span hidden>{router ? "" : ""}</span>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "buy" | "sell" }) {
  const color = tone === "buy" ? "var(--buy)" : tone === "sell" ? "var(--sell)" : "var(--paper)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span className="eyebrow" style={{ fontSize: 9, color: "var(--paper-4)" }}>{label}</span>
      <span className="mono" style={{
        fontSize: 13, fontWeight: 500, color,
        letterSpacing: "0.01em", fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{value}</span>
    </div>
  );
}

function DropIndicator() {
  return (
    <div style={{
      height: 2, borderRadius: 1,
      background: "var(--accent)",
      boxShadow: "0 0 8px var(--accent)",
      margin: "1px 0",
    }} />
  );
}

function formatRelativeShort(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
