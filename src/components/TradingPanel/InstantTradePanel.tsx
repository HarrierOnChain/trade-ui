"use client";
/**
 * Floating quick-trade card — exact design port of b33's
 * InstantTradePanel. Five numbered preset slots (P1..P5), draggable +
 * resizable (height 240..340; the second row of preset buttons appears
 * when height ≥ 300).
 *
 * Drag: pointer capture on the grip handle — 1:1 with pointer at any
 * zoom, never loses events even with fast moves.
 * Resize: pointer capture on the bottom edge handle.
 * Portal: document.body → position:fixed, completely outside the app
 * zoom frame's CSS transform.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUserPreference } from "../../hooks/useUserPreference";
import { useUserWallets } from "../../hooks/useUserWallets";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import {
  defaultInstantPresets, PREF_KEYS, PRESET_KEYS,
  type InstantPresets,
} from "./presets";

type TradeSide = "buy" | "sell";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mint: string;
  onTrade: (side: TradeSide, amount: number, isPercentage: boolean) => Promise<void>;
}

const MIN_W = 360;
const MIN_H = 250;
// Second rows appear at this threshold.
const EXTRA_ROW_H = 310;
// Fixed pixel overhead consumed by header, footer, padding, section headers, and flex gaps.
// Used to compute how much space is left for button rows.
const OVERHEAD_1ROW = 180; // 1 row per section (2 button rows total)
const OVERHEAD_2ROW = 204; // 2 rows per section (4 button rows total)

function padTo8(list: string[], fallbacks: string[]): string[] {
  const out = [...list];
  for (let i = out.length; i < 8; i++) out.push(fallbacks[i] ?? fallbacks[fallbacks.length - 1] ?? "0");
  return out.slice(0, 8);
}

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

export function InstantTradePanel({ isOpen, onClose, mint, onTrade }: Props) {
  const userWallets = useUserWallets();
  const { info } = useTokenInfo(mint);

  const [presets, setPresets] = useUserPreference<InstantPresets>(PREF_KEYS.instantPresets, defaultInstantPresets);
  const [activePreset, setActivePreset] = useUserPreference<string>(PREF_KEYS.instantActivePreset, "1");
  const [storedSize, setStoredSize] = useUserPreference<{ width: number; height: number }>(
    PREF_KEYS.instantSize, { width: 400, height: 240 },
  );
  const [savedPos, setSavedPos] = useUserPreference<{ x: number; y: number } | null>(PREF_KEYS.instantPos, null);

  const [size, setSize] = useState(storedSize);
  const sizeRef = useRef(size);
  useEffect(() => { sizeRef.current = size; }, [size]);

  // Sync stored size into local state when not actively resizing, clamping to
  // current bounds (handles migration from older stored values).
  const resizingRef = useRef(false);
  useEffect(() => {
    if (!resizingRef.current) setSize({
      width: Math.max(MIN_W, storedSize.width),
      height: Math.max(MIN_H, storedSize.height),
    });
  }, [storedSize]);

  const [, setPos] = useState<{ x: number; y: number } | null>(null);
  const posRef = useRef<{ x: number; y: number } | null>(null);

  const [tradingButton, setTradingButton] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState("");
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelOpacity, setPanelOpacity] = useUserPreference<number>(PREF_KEYS.instantOpacity, 0.95);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── Stable refs for callbacks ────────────────────────────────────────
  const onTradeRef = useRef(onTrade);
  const onCloseRef = useRef(onClose);
  const presetsRef = useRef(presets);
  const activePresetRef = useRef(activePreset);
  const activeWalletsRef = useRef(0);
  useEffect(() => { onTradeRef.current = onTrade; }, [onTrade]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { presetsRef.current = presets; }, [presets]);
  useEffect(() => { activePresetRef.current = activePreset; }, [activePreset]);

  // ── Wallet data ──────────────────────────────────────────────────────
  const activeWallets = userWallets.activeWallets.length
    ? userWallets.activeWallets
    : userWallets.wallets.filter((w) => !w.isConnected);
  const totalBalance = activeWallets.reduce((s, w) => s + (userWallets.balances[w.id]?.sol ?? 0), 0);
  const tokenHolding = activeWallets.reduce((s, w) => s + (userWallets.balances[w.id]?.tokens[mint] ?? 0), 0);
  const activeWalletsCount = activeWallets.length;
  useEffect(() => { activeWalletsRef.current = activeWalletsCount; }, [activeWalletsCount]);

  const tickerLabel = info?.symbol
    ? "$" + (info.symbol.length > 5 ? info.symbol.slice(0, 5) + "..." : info.symbol)
    : "$TOKEN";

  // ── Preset helpers ───────────────────────────────────────────────────
  const currentPreset = useMemo(() => {
    const fallback = defaultInstantPresets[activePreset] ?? defaultInstantPresets["1"];
    const stored = presets[activePreset] ?? { buyAmounts: [], sellAmounts: [] };
    return {
      buyAmounts: padTo8(stored.buyAmounts, fallback.buyAmounts),
      sellAmounts: padTo8(stored.sellAmounts, fallback.sellAmounts),
    };
  }, [activePreset, presets]);
  const showExtraButtons = size.height >= EXTRA_ROW_H;
  const numButtonRows = showExtraButtons ? 4 : 2;
  const overhead = showExtraButtons ? OVERHEAD_2ROW : OVERHEAD_1ROW;
  const btnH = Math.max(28, Math.floor((size.height - overhead) / numButtonRows));

  const handleTrade = useCallback(async (side: TradeSide, amount: string, buttonKey: string) => {
    setTradeError("");
    if (activeWalletsRef.current === 0) { setTradeError("No wallets selected"); return; }
    setTradingButton(buttonKey);
    try {
      const n = parseFloat(amount.replace("%", ""));
      if (!isFinite(n) || n <= 0) { setTradeError("Invalid amount"); return; }
      await onTradeRef.current(side, n, side === "sell" || amount.includes("%"));
    } catch (err) {
      setTradeError(err instanceof Error ? err.message : "Trade failed");
    } finally {
      setTradingButton(null);
    }
  }, []);

  const editPreset = useCallback((side: TradeSide, idx: number, val: string) => {
    const cleaned = val.replace(/[^0-9.%-]/g, "");
    const slot = activePresetRef.current;
    const cur = presetsRef.current[slot] ?? { buyAmounts: [], sellAmounts: [] };
    const list = side === "buy" ? [...cur.buyAmounts] : [...cur.sellAmounts];
    list[idx] = cleaned;
    setPresets({ ...presetsRef.current, [slot]: side === "buy" ? { ...cur, buyAmounts: list } : { ...cur, sellAmounts: list } });
  }, [setPresets]);

  // ── Drag via pointer capture ─────────────────────────────────────────
  const handleGripPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    // posRef.current is always initialised before first render, so this is safe
    const startPX = posRef.current!.x;
    const startPY = posRef.current!.y;

    const onMove = (ev: PointerEvent) => {
      const { width: w, height: h } = sizeRef.current;
      const next = {
        x: clamp(startPX + ev.clientX - startX, 0, window.innerWidth - w),
        y: clamp(startPY + ev.clientY - startY, 0, window.innerHeight - h),
      };
      posRef.current = next;
      setPos(next);
    };

    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (posRef.current) setSavedPos(posRef.current);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }, [setSavedPos]);

  // ── Resize via pointer capture (bottom / right / corner) ────────────
  const makeResizeHandler = useCallback((resizeW: boolean, resizeH: boolean) =>
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      resizingRef.current = true;

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = sizeRef.current.width;
      const startH = sizeRef.current.height;

      const onMove = (ev: PointerEvent) => {
        const maxW = window.innerWidth - (posRef.current?.x ?? 0);
        const maxH = window.innerHeight - (posRef.current?.y ?? 0);
        const newW = resizeW ? clamp(startW + ev.clientX - startX, MIN_W, maxW) : startW;
        const newH = resizeH ? clamp(startH + ev.clientY - startY, MIN_H, maxH) : startH;
        sizeRef.current = { width: newW, height: newH };
        setSize(prev => prev.width === newW && prev.height === newH ? prev : { width: newW, height: newH });
      };

      const onUp = () => {
        resizingRef.current = false;
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        setStoredSize({ ...sizeRef.current });
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
  [setStoredSize]);

  const handleResizeBottom = useMemo(() => makeResizeHandler(false, true), [makeResizeHandler]);
  const handleResizeRight  = useMemo(() => makeResizeHandler(true, false), [makeResizeHandler]);
  const handleResizeCorner = useMemo(() => makeResizeHandler(true, true),  [makeResizeHandler]);

  const toggleEditing = useCallback(() => setEditing((v) => !v), []);
  const handleClose = useCallback(() => onCloseRef.current(), []);

  // Forward wheel events to the element under the panel so that scrollable
  // content (e.g. the bubblemap SVG) keeps its zoom when the panel overlaps it.
  const handleWheelPassthrough = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.style.pointerEvents = "none";
    const below = document.elementFromPoint(e.clientX, e.clientY);
    el.style.pointerEvents = "";
    if (below) {
      below.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
      }));
    }
  }, []);

  // ── Memoised body ────────────────────────────────────────────────────
  const body = useMemo(() => (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", color: "#cbd5e1", fontFamily: "var(--font-ui, sans-serif)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, borderBottom: "1px solid #1F1F1F", fontSize: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            {PRESET_KEYS.map((p) => (
              <button key={p} onClick={() => setActivePreset(p)} style={{ background: "transparent", border: 0, padding: 0, fontSize: 12, fontWeight: 700, color: activePreset === p ? "#BA49EE" : "#94a3b8", cursor: "pointer" }}
                onMouseEnter={(e) => { if (activePreset !== p) e.currentTarget.style.color = "#e2e8f0"; }}
                onMouseLeave={(e) => { if (activePreset !== p) e.currentTarget.style.color = "#94a3b8"; }}>
                P{p}
              </button>
            ))}
          </div>
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              title="Panel settings"
              style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", color: settingsOpen || editing ? "#BA49EE" : "#94a3b8", display: "inline-flex", alignItems: "center" }}
            >
              <SettingsIcon size={12} />
            </button>
            {settingsOpen && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  zIndex: 10,
                  width: 220,
                  padding: 10,
                  background: "rgba(15,15,15,0.98)",
                  border: "1px solid #2A2A2A",
                  borderRadius: 8,
                  boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
                  display: "flex", flexDirection: "column", gap: 10,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "#94a3b8", textTransform: "uppercase" }}>
                    <span>Transparency</span>
                    <span style={{ color: "#cbd5e1", fontFamily: "var(--font-mono, monospace)" }}>
                      {Math.round((1 - panelOpacity) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={100}
                    step={1}
                    value={Math.round(panelOpacity * 100)}
                    onChange={(e) => setPanelOpacity(parseInt(e.target.value, 10) / 100)}
                    style={{ width: "100%", accentColor: "#BA49EE" }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { toggleEditing(); setSettingsOpen(false); }}
                  style={{
                    padding: "6px 10px",
                    fontSize: 11, fontWeight: 600,
                    background: editing ? "rgba(186,73,238,0.18)" : "transparent",
                    border: `1px solid ${editing ? "#BA49EE" : "#2A2A2A"}`,
                    borderRadius: 6,
                    color: editing ? "#BA49EE" : "#cbd5e1",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {editing ? "Done editing presets" : "Edit preset values"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Grip — drag handle */}
        <div
          onPointerDown={handleGripPointerDown}
          style={{ cursor: "move", touchAction: "none", userSelect: "none", color: "#64748b", flex: 1, display: "flex", justifyContent: "center" }}
        >
          <GripIcon size={16} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#1A1A1A", padding: "2px 8px", borderRadius: 9999, border: "1px solid #2A2A2A" }}>
            <WalletIcon size={12} color="#94a3b8" />
            <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{activeWalletsCount}</span>
          </div>
          <button onClick={handleClose} aria-label="Close" style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "#94a3b8", display: "inline-flex" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}>
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {tradeError && (
          <div style={{ fontSize: 10, color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 4, padding: "4px 8px", fontFamily: "var(--font-mono, monospace)" }}>{tradeError}</div>
        )}
        <SectionHeader label="Buy" ticker="SOL" value={totalBalance.toFixed(2)} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {currentPreset.buyAmounts.slice(0, 4).map((val, i) => (
            <PresetSlot key={`buy-${i}`} value={val} busy={tradingButton === `buy-${i}`} disabled={!!tradingButton} variant="buy" editing={editing} btnH={btnH} onClick={() => handleTrade("buy", val, `buy-${i}`)} onChange={(v) => editPreset("buy", i, v)} />
          ))}
        </div>
        {showExtraButtons && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {currentPreset.buyAmounts.slice(4).map((val, i) => (
              <PresetSlot key={`buy-${i + 4}`} value={val} busy={tradingButton === `buy-${i + 4}`} disabled={!!tradingButton} variant="buy" editing={editing} btnH={btnH} onClick={() => handleTrade("buy", val, `buy-${i + 4}`)} onChange={(v) => editPreset("buy", i + 4, v)} />
            ))}
          </div>
        )}
        <div style={{ marginTop: 4 }}>
          <SectionHeader label="Sell" sub="%" ticker={tickerLabel} value={tokenHolding > 0 ? formatHolding(tokenHolding) : "0"} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {currentPreset.sellAmounts.slice(0, 4).map((val, i) => (
            <PresetSlot key={`sell-${i}`} value={val} busy={tradingButton === `sell-${i}`} disabled={!!tradingButton} variant="sell" editing={editing} btnH={btnH} onClick={() => handleTrade("sell", val, `sell-${i}`)} onChange={(v) => editPreset("sell", i, v)} />
          ))}
        </div>
        {showExtraButtons && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {currentPreset.sellAmounts.slice(4).map((val, i) => (
              <PresetSlot key={`sell-${i + 4}`} value={val} busy={tradingButton === `sell-${i + 4}`} disabled={!!tradingButton} variant="sell" editing={editing} btnH={btnH} onClick={() => handleTrade("sell", val, `sell-${i + 4}`)} onChange={(v) => editPreset("sell", i + 4, v)} />
            ))}
          </div>
        )}
      </div>

      <Footer holding={tokenHolding} />
    </div>
  ), [
    activePreset, setActivePreset, editing, toggleEditing,
    settingsOpen, panelOpacity, setPanelOpacity,
    tradingButton, tradeError, totalBalance, tokenHolding, tickerLabel,
    activeWalletsCount, handleClose, handleTrade, editPreset,
    handleGripPointerDown, showExtraButtons, btnH, currentPreset,
  ]);

  if (!isOpen || !mounted) return null;

  // If posRef hasn't been set yet (first render after open), initialise it
  // from savedPos or screen centre. Updating a ref during render is safe —
  // it doesn't trigger a re-render. The drag handler always reads posRef so
  // this guarantees startPos is correct even before the first drag.
  if (!posRef.current) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const base = savedPos ?? { x: (vw - size.width) / 2, y: (vh - size.height) / 2 };
    posRef.current = {
      x: clamp(base.x, 0, vw - size.width),
      y: clamp(base.y, 0, vh - size.height),
    };
  }
  const currentPos = posRef.current;

  return createPortal(
    <div
      onWheel={handleWheelPassthrough}
      style={{
        position: "fixed",
        left: currentPos.x,
        top: currentPos.y,
        width: size.width,
        height: size.height,
        zIndex: 9999,
        willChange: "left, top",
        background: `rgba(10, 10, 10, ${panelOpacity})`,
        backdropFilter: panelOpacity < 0.9 ? "blur(6px)" : "none",
        WebkitBackdropFilter: panelOpacity < 0.9 ? "blur(6px)" : "none",
        border: "1px solid #1F1F1F",
        borderRadius: 12,
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
        overflow: "hidden",
        color: "#cbd5e1",
        fontFamily: "var(--font-ui, sans-serif)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {body}
      {/* Bottom resize handle */}
      <div onPointerDown={handleResizeBottom} style={{ position: "absolute", bottom: 0, left: 0, right: 10, height: 6, cursor: "ns-resize", touchAction: "none" }} />
      {/* Right resize handle */}
      <div onPointerDown={handleResizeRight} style={{ position: "absolute", top: 0, right: 0, bottom: 10, width: 6, cursor: "ew-resize", touchAction: "none" }} />
      {/* Bottom-right corner */}
      <div onPointerDown={handleResizeCorner} style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, cursor: "nwse-resize", touchAction: "none" }} />
    </div>,
    document.body,
  );
}

// ── Pieces ──────────────────────────────────────────────────────────

function SectionHeader({ label, sub, ticker, value }: { label: string; sub?: string; ticker: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
        {sub && <span style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, fontFamily: "var(--font-mono, monospace)", color: "#94a3b8" }}>
        <span style={{ color: "#BA49EE", fontWeight: 700 }}>{ticker}</span>
        <span>{value}</span>
      </div>
    </div>
  );
}

function PresetSlot({ value, busy, disabled, variant, editing, btnH, onClick, onChange }: {
  value: string; busy: boolean; disabled: boolean; variant: TradeSide;
  editing: boolean; btnH: number; onClick: () => void; onChange: (next: string) => void;
}) {
  const isBuy = variant === "buy";
  const fg = isBuy ? "#00FF88" : "#FF3366";
  const bd = isBuy ? "#154A32" : "#5A1A2A";
  const hoverBg = isBuy ? "rgba(0, 255, 136, 0.1)" : "rgba(255, 51, 102, 0.1)";
  const fontSize = Math.min(16, Math.max(11, Math.round(btnH * 0.38)));
  if (editing) {
    return (
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ height: btnH, width: "100%", padding: "0 8px", borderRadius: 100, border: `1px solid ${bd}`, color: fg, background: "transparent", fontFamily: "var(--font-mono, monospace)", fontSize, textAlign: "center", outline: "none" }} />
    );
  }
  return (
    <button disabled={disabled} onClick={onClick}
      style={{ height: btnH, width: "100%", borderRadius: 100, border: `1px solid ${bd}`, color: fg, background: "transparent", fontFamily: "var(--font-mono, monospace)", fontSize, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, transition: "background 120ms" }}
      onMouseEnter={(e) => { if (disabled) return; e.currentTarget.style.background = hoverBg; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
      {busy ? <SpinnerIcon size={Math.round(btnH * 0.35)} /> : value}
    </button>
  );
}

function Footer({ holding }: { holding: number }) {
  const bought = 0, sold = 0, pnl = 0;
  const cell: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 4 };
  const div: React.CSSProperties = { borderRight: "1px solid #1F1F1F" };
  return (
    <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", borderTop: "1px solid #1F1F1F", fontSize: 12, fontFamily: "var(--font-mono, monospace)", padding: "8px 0", background: "#0A0A0A" }}>
      <div style={{ ...cell, ...div }} title="Bought"><LayersIcon size={10} color="#fff" /><span style={{ color: "#00FF88" }}>{bought.toFixed(3)}</span></div>
      <div style={{ ...cell, ...div }} title="Sold"><LayersIcon size={10} color="#fff" /><span style={{ color: "#FF3366" }}>{sold.toFixed(3)}</span></div>
      <div style={{ ...cell, ...div }} title="Holding"><LayersIcon size={10} color="#fff" /><span style={{ color: "#cbd5e1" }}>{holding.toFixed(3)}</span></div>
      <div style={cell} title="PnL"><LayersIcon size={10} color="#fff" /><span style={{ color: pnl >= 0 ? "#00FF88" : "#FF3366" }}>{(pnl >= 0 ? "+" : "") + pnl.toFixed(3)}</span></div>
    </div>
  );
}

function formatHolding(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

// ── Icons ────────────────────────────────────────────────────────────

function WalletIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>;
}
function XIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
function LayersIcon({ size = 10, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.91a1 1 0 0 0 0-1.83Z" /><path d="M2 12.18 12 17l10-4.82" /><path d="M2 17.18 12 22l10-4.82" /></svg>;
}
function GripIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="1" /><circle cx="19" cy="9" r="1" /><circle cx="5" cy="9" r="1" /><circle cx="12" cy="15" r="1" /><circle cx="19" cy="15" r="1" /><circle cx="5" cy="15" r="1" /></svg>;
}
function SettingsIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function SpinnerIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ animation: "spin 1s linear infinite" }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
