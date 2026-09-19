"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../../contexts/AppContext";
import { Tooltip } from "../atoms";
import {
  useTapeKinds,
  TAPE_KINDS,
  TAPE_VIEW_LABEL,
  TAPE_VIEW_SHORT,
  TAPE_ACCENT,
  DEFAULT_TAPE_KINDS,
  type TapeKind,
} from "../../hooks/useTapeKinds";

// ── Preferences ──────────────────────────────────────────────────────────────

type DisplayMode = "full" | "compact" | "icon";

const QB_DISPLAY_KEY = "spool.quickbar.display";
const QB_VISIBLE_KEY = "spool.quickbar.visible";
const QB_HOTKEYS_KEY = "spool.quickbar.hotkeys.enabled";
const QB_HOTKEY_PREFIX = "spool.quickbar.hotkey.";

function readQBDisplay(): DisplayMode {
  try {
    const v = localStorage.getItem(QB_DISPLAY_KEY);
    if (v === "full" || v === "compact" || v === "icon") return v;
  } catch { /* ignore */ }
  return "compact";
}

function readQBVisible(): TapeKind[] {
  try {
    const raw = localStorage.getItem(QB_VISIBLE_KEY);
    if (!raw) return [...TAPE_KINDS];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return TAPE_KINDS.filter((k) => parsed.includes(k));
  } catch { /* ignore */ }
  return [...TAPE_KINDS];
}

function readQBHotkeysEnabled(): boolean {
  try { return localStorage.getItem(QB_HOTKEYS_KEY) !== "0"; } catch { return true; }
}

export function readQBHotkey(kind: TapeKind): string {
  try { return localStorage.getItem(QB_HOTKEY_PREFIX + kind) ?? ""; } catch { return ""; }
}

function writeQBHotkey(kind: TapeKind, key: string) {
  try { localStorage.setItem(QB_HOTKEY_PREFIX + kind, key); } catch { /* ignore */ }
}

// ── Lucide / Heroicons-style SVG icons ───────────────────────────────────────

export function IconDeploy({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <path d="M12 2C8.5 2 4 6.5 4 12c0 2 .6 3.8 1.6 5.3L4 20l2.7-1.6C8.2 19.4 10 20 12 20s3.8-.6 5.3-1.6L20 20l-1.6-2.7C19.4 15.8 20 14 20 12c0-5.5-4.5-10-8-10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="11" r="2.5" fill="currentColor"/>
    </svg>
  );
}

export function IconMigrating({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <path d="M5 12h14M14 7l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" opacity="0.5"/>
    </svg>
  );
}

export function IconMigration({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconTrending({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <path d="M3 17l5-5 4 4 9-10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16 6h5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconMine({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <rect x="2" y="7" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="16" cy="14" r="2" fill="currentColor"/>
      <path d="M2 11h20M7 7V5a2 2 0 012-2h6a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function IconWatch({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <path d="M2 12C4 7 7.5 4.5 12 4.5S20 7 22 12c-2 5-5.5 7.5-10 7.5S4 17 2 12Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  );
}

export function IconX({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.732-8.835L2.216 2.25H8.48l4.265 5.634L18.244 2.25Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/>
    </svg>
  );
}

export function IconSettings({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export const TAPE_ICON: Record<TapeKind, React.FC<{ size?: number }>> = {
  deploy: IconDeploy,
  migrating: IconMigrating,
  migration: IconMigration,
  trending: IconTrending,
  mine: IconMine,
  watch: IconWatch,
  x: IconX,
};

// ── Inline footer buttons ─────────────────────────────────────────────────────
// Renders inside StatusFooter — no wrapper bar, uses height:"100%" like other
// footer elements.

export function FooterTapeButtons() {
  const { kinds, toggleKind } = useTapeKinds();
  const { sidebarOpen, toggleSidebar } = useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [display, setDisplayState] = useState<DisplayMode>("compact");
  const [visible, setVisibleState] = useState<TapeKind[]>([...TAPE_KINDS]);
  const [hotkeysEnabled, setHotkeysEnabledState] = useState(true);

  useEffect(() => {
    setDisplayState(readQBDisplay());
    setVisibleState(readQBVisible());
    setHotkeysEnabledState(readQBHotkeysEnabled());
  }, []);

  const setDisplay = (v: DisplayMode) => {
    setDisplayState(v);
    try { localStorage.setItem(QB_DISPLAY_KEY, v); } catch { /* ignore */ }
  };
  const setVisible = (v: TapeKind[]) => {
    setVisibleState(v);
    try { localStorage.setItem(QB_VISIBLE_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  };
  const setHotkeysEnabled = (v: boolean) => {
    setHotkeysEnabledState(v);
    try { localStorage.setItem(QB_HOTKEYS_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  };

  function handleTapeClick(kind: TapeKind) {
    if (!sidebarOpen) toggleSidebar();
    toggleKind(kind);
  }

  useEffect(() => {
    if (!hotkeysEnabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      for (const kind of TAPE_KINDS) {
        const hk = readQBHotkey(kind);
        if (hk && e.key.toLowerCase() === hk.toLowerCase()) {
          handleTapeClick(kind);
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkeysEnabled, sidebarOpen]);

  const visibleButtons = TAPE_KINDS.filter((k) => visible.includes(k));

  return (
    <>
      {/* Gear */}
      <Tooltip content="Tracker settings" placement="top">
        <button
          type="button"
          aria-label="Tracker settings"
          onClick={() => setSettingsOpen(true)}
          style={{
            ...footerBtnBase,
            padding: "0 8px",
            color: settingsOpen ? "var(--paper)" : "var(--paper-2)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = settingsOpen ? "var(--paper)" : "var(--paper-2)")}
        >
          <IconSettings size={14} />
        </button>
      </Tooltip>

      {visibleButtons.map((kind) => {
        const active = kinds.includes(kind);
        const Ic = TAPE_ICON[kind];
        const accent = TAPE_ACCENT[kind];
        const label = display === "full" ? TAPE_VIEW_LABEL[kind] : TAPE_VIEW_SHORT[kind];
        return (
          <Tooltip key={kind} content={TAPE_VIEW_LABEL[kind]} placement="top">
            <button
              type="button"
              aria-pressed={active}
              onClick={() => handleTapeClick(kind)}
              style={{
                ...footerBtnBase,
                padding: display === "icon" ? "0 7px" : "0 8px",
                color: active ? "var(--paper)" : "var(--paper-2)",
                background: active ? "var(--ink-2)" : "transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--paper)";
                if (!active) e.currentTarget.style.background = "color-mix(in oklch, var(--ink-2) 60%, transparent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = active ? "var(--paper)" : "var(--paper-2)";
                e.currentTarget.style.background = active ? "var(--ink-2)" : "transparent";
              }}
            >
              <span style={{ position: "relative", display: "inline-flex", lineHeight: 0, alignItems: "center" }}>
                <Ic size={14} />
                {active && (
                  <span style={{
                    position: "absolute",
                    top: -2, right: -3,
                    width: 4, height: 4,
                    borderRadius: 999,
                    background: accent,
                    boxShadow: `0 0 4px ${accent}`,
                  }} />
                )}
              </span>
              {display !== "icon" && (
                <span className="mono" style={{ fontSize: 9, letterSpacing: "0.06em", lineHeight: 1, whiteSpace: "nowrap" }}>
                  {label}
                </span>
              )}
            </button>
          </Tooltip>
        );
      })}

      {settingsOpen && (
        <TapeQuickBarSettings
          display={display}
          setDisplay={setDisplay}
          visible={visible}
          setVisible={setVisible}
          hotkeysEnabled={hotkeysEnabled}
          setHotkeysEnabled={setHotkeysEnabled}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}

const footerBtnBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: "100%",
  background: "transparent",
  border: 0,
  borderRadius: 0,
  cursor: "pointer",
  flexShrink: 0,
  fontFamily: "var(--font-mono)",
  transition: "color 100ms, background 100ms",
};

// ── Settings modal ────────────────────────────────────────────────────────────

type HotkeyState = Record<TapeKind, string>;

function TapeQuickBarSettings({
  display,
  setDisplay,
  visible,
  setVisible,
  hotkeysEnabled,
  setHotkeysEnabled,
  onClose,
}: {
  display: DisplayMode;
  setDisplay: (v: DisplayMode) => void;
  visible: TapeKind[];
  setVisible: (v: TapeKind[]) => void;
  hotkeysEnabled: boolean;
  setHotkeysEnabled: (v: boolean) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TapeKind>("deploy");
  const [hotkeys, setHotkeys] = useState<HotkeyState>(() =>
    Object.fromEntries(TAPE_KINDS.map((k) => [k, readQBHotkey(k)])) as HotkeyState
  );
  const [listeningFor, setListeningFor] = useState<TapeKind | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listeningFor) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      const key = e.key === "Escape" ? "" : e.key.length === 1 ? e.key.toLowerCase() : "";
      const next = { ...hotkeys, [listeningFor]: key };
      setHotkeys(next);
      writeQBHotkey(listeningFor, key);
      setListeningFor(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [listeningFor, hotkeys]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !listeningFor) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, listeningFor]);

  const toggleVisible = (kind: TapeKind) => {
    const next = visible.includes(kind) ? visible.filter((k) => k !== kind) : [...visible, kind];
    setVisible(TAPE_KINDS.filter((k) => next.includes(k)));
  };

  const reset = () => {
    setDisplay("compact");
    setVisible([...TAPE_KINDS]);
    setHotkeysEnabled(true);
    const cleared = Object.fromEntries(TAPE_KINDS.map((k) => [k, ""])) as HotkeyState;
    setHotkeys(cleared);
    TAPE_KINDS.forEach((k) => writeQBHotkey(k, ""));
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "oklch(0.08 0.005 65 / 0.6)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div ref={modalRef} style={{
        width: 520,
        background: "var(--ink-1)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px 12px",
          borderBottom: "1px solid var(--line-soft)",
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--paper)" }}>Trackers Settings</span>
          <button type="button" onClick={onClose} style={{
            background: "transparent", border: 0,
            color: "var(--paper-3)", cursor: "pointer", padding: 4, lineHeight: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Source tabs */}
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "10px 16px",
          borderBottom: "1px solid var(--line-soft)",
          overflowX: "auto",
        }}>
          {TAPE_KINDS.map((kind) => {
            const Ic = TAPE_ICON[kind];
            const isVisible = visible.includes(kind);
            const isActive = activeTab === kind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setActiveTab(kind)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 10px",
                  borderRadius: 6,
                  fontSize: 11, fontWeight: 500,
                  background: isActive ? "var(--accent)" : "transparent",
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--line-soft)"}`,
                  color: isActive ? "var(--ink-0)" : isVisible ? "var(--paper-2)" : "var(--paper-4)",
                  cursor: "pointer",
                  opacity: isVisible ? 1 : 0.5,
                  flexShrink: 0,
                  transition: "background 120ms, color 120ms, border-color 120ms",
                }}
              >
                <Ic size={12} />
                {TAPE_VIEW_SHORT[kind]}
              </button>
            );
          })}
        </div>

        {/* Display mode */}
        <div style={{ padding: "16px 16px 0" }}>
          <div className="eyebrow" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.12em", marginBottom: 10 }}>DISPLAY MODE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {(["full", "compact", "icon"] as DisplayMode[]).map((mode) => {
              const Ic = TAPE_ICON[activeTab];
              const isSelected = display === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDisplay(mode)}
                  style={{
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 8,
                    padding: "14px 8px",
                    borderRadius: 8,
                    border: `2px solid ${isSelected ? "var(--accent)" : "var(--line-soft)"}`,
                    background: isSelected ? "color-mix(in oklch, var(--accent) 8%, transparent)" : "var(--ink-0)",
                    cursor: "pointer",
                    transition: "border-color 120ms, background 120ms",
                  }}
                >
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--paper-2)" }}>
                    <Ic size={14} />
                    {mode !== "icon" && (
                      <span className="mono" style={{ fontSize: mode === "full" ? 11 : 10, color: "var(--paper)" }}>
                        {mode === "full" ? TAPE_VIEW_LABEL[activeTab] : TAPE_VIEW_SHORT[activeTab]}
                      </span>
                    )}
                  </div>
                  <span className="eyebrow" style={{ fontSize: 9, color: isSelected ? "var(--accent)" : "var(--paper-3)", letterSpacing: "0.1em" }}>
                    {mode === "full" ? "Full" : mode === "compact" ? "Compact" : "Icon"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Visibility */}
        <div style={{ padding: "14px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--paper-2)" }}>
            Show "{TAPE_VIEW_LABEL[activeTab]}" in footer
          </span>
          <Toggle value={visible.includes(activeTab)} onChange={() => toggleVisible(activeTab)} />
        </div>

        {/* Hotkeys */}
        <div style={{ padding: "14px 16px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div className="eyebrow" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.12em" }}>HOTKEYS</div>
            <Toggle value={hotkeysEnabled} onChange={() => setHotkeysEnabled(!hotkeysEnabled)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {TAPE_KINDS.map((kind) => {
              const Ic = TAPE_ICON[kind];
              const hk = hotkeys[kind];
              const isListening = listeningFor === kind;
              return (
                <div key={kind} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "5px 8px",
                  borderRadius: 4,
                  background: "var(--ink-0)",
                  border: "1px solid var(--line-soft)",
                  opacity: hotkeysEnabled ? 1 : 0.4,
                }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--paper-3)" }}>
                    <Ic size={11} />
                    <span className="mono" style={{ fontSize: 9, color: "var(--paper-2)" }}>
                      {TAPE_VIEW_SHORT[kind]}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={!hotkeysEnabled}
                    onClick={() => setListeningFor(kind)}
                    className="mono"
                    style={{
                      minWidth: 20,
                      padding: "1px 5px",
                      borderRadius: 3,
                      border: `1px solid ${isListening ? "var(--accent)" : "var(--line)"}`,
                      background: isListening ? "color-mix(in oklch, var(--accent) 15%, transparent)" : "var(--ink-1)",
                      color: isListening ? "var(--accent)" : hk ? "var(--paper)" : "var(--paper-4)",
                      fontSize: 9,
                      cursor: hotkeysEnabled ? "pointer" : "default",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {isListening ? "…" : hk || "—"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px",
          marginTop: 16,
          borderTop: "1px solid var(--line-soft)",
          gap: 8,
        }}>
          <button
            type="button"
            onClick={reset}
            title="Reset to defaults"
            style={{
              width: 32, height: 32,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--line-soft)",
              borderRadius: 6,
              color: "var(--paper-3)",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 3v5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1, height: 36,
              background: "var(--accent)",
              border: 0, borderRadius: 6,
              color: "var(--ink-0)",
              fontSize: 13, fontWeight: 600,
              cursor: "pointer",
              transition: "opacity 120ms",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.88")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={onChange}
      style={{
        width: 36, height: 20,
        borderRadius: 999,
        background: value ? "var(--accent)" : "var(--ink-2)",
        border: "1px solid " + (value ? "var(--accent)" : "var(--line)"),
        cursor: "pointer",
        padding: 0,
        position: "relative",
        transition: "background 150ms, border-color 150ms",
        flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute",
        top: 2, left: value ? "calc(100% - 18px)" : 2,
        width: 14, height: 14,
        borderRadius: 999,
        background: "var(--paper)",
        transition: "left 150ms",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      }} />
    </button>
  );
}
