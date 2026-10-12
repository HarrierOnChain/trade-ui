"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Icon, Tooltip } from "../atoms";
import { useApp } from "../../contexts/AppContext";
import { useUserPreference } from "../../hooks/useUserPreference";
import { useUserWallets } from "../../hooks/useUserWallets";
import { PREF_KEYS } from "../TradingPanel/presets";
import { quoteMints, defaultQuoteMint } from "../../lib/quoteMints";
import { shortAddr } from "../../lib/format";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { useClientNav } from "./ClientPages";
import { ConnectionPanel, SecurityPanel } from "../vault/SecurityPanel";
import { auth, type RuntimeConfig } from "../../lib/vault/client";

type SectionId =
  | "general"
  | "trading"
  | "connection"
  | "wallets"
  | "security"
  | "shortcuts";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
}

const SECTIONS: SectionDef[] = [
  { id: "general",       label: "General",       icon: Icon.gear(13) },
  { id: "trading",       label: "Trading",       icon: Icon.bolt(13) },
  { id: "connection",    label: "Connection",    icon: Icon.solana(13) },
  { id: "wallets",       label: "Wallets",       icon: Icon.wallet(13) },
  { id: "security",      label: "Security",      icon: Icon.lock(13) },
  { id: "shortcuts",     label: "Shortcuts",     icon: Icon.search(13) },
];

export function SettingsModal() {
  const { settingsOpen, closeSettings } = useApp();
  const [section, setSection] = useState<SectionId>("general");
  const isMobile = useIsMobile();
  const [config, setConfig] = useState<RuntimeConfig | null>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;
    auth.config().then((c) => { if (!cancelled) setConfig(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [settingsOpen]);

  return (
    <Modal open={settingsOpen} onClose={closeSettings} width={860} align="center" mobileVariant={isMobile ? "sheet" : "center"}>
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "200px 1fr",
        height: isMobile ? "auto" : "min(640px, 84vh)",
      }}>
        <Sidebar active={section} onChange={setSection} onClose={closeSettings} />
        <div style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--ink-1)",
        }}>
          <Header label={SECTIONS.find((s) => s.id === section)?.label ?? ""} onClose={closeSettings} />
          <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
            {section === "general"       && <GeneralPanel />}
            {section === "trading"       && <TradingPanel />}
            {section === "connection"    && <ConnectionPanel config={config} />}
            {section === "wallets"       && <WalletsPanel onManage={closeSettings} />}
            {section === "security"      && <SecurityPanel config={config} onConfig={setConfig} />}
            {section === "shortcuts"     && <ShortcutsPanel />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ───────── Sidebar ───────── */

function Sidebar({
  active,
  onChange,
  onClose,
}: {
  active: SectionId;
  onChange: (id: SectionId) => void;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  return (
    <div
      className={isMobile ? "scroll-x-hide" : undefined}
      style={{
        borderRight: isMobile ? "none" : "1px solid var(--line-soft)",
        borderBottom: isMobile ? "1px solid var(--line-soft)" : "none",
        background: "var(--ink-0)",
        display: "flex",
        flexDirection: isMobile ? "row" : "column",
        flexWrap: isMobile ? "nowrap" : undefined,
        overflowX: isMobile ? "auto" : undefined,
        alignItems: isMobile ? "center" : undefined,
        padding: "14px 10px",
        gap: 2,
      }}
    >
      <div style={{
        display: isMobile ? "none" : "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 6px 12px",
      }}>
        <span className="mono" style={{
          fontSize: 11, letterSpacing: "0.14em",
          textTransform: "uppercase", color: "var(--paper)",
          fontWeight: 600,
        }}>
          Settings
        </span>
        <Tooltip content="Close">
          <button
            onClick={onClose}
            aria-label="Close settings"
            style={{
              width: 22, height: 22,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: 0,
              color: "var(--paper-3)", cursor: "pointer",
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-3)"; }}
          >
            {Icon.close(11)}
          </button>
        </Tooltip>
      </div>
      {SECTIONS.map((s) => {
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px",
              background: isActive ? "var(--ink-2)" : "transparent",
              border: 0,
              color: isActive ? "var(--paper)" : "var(--paper-3)",
              fontSize: 12,
              borderRadius: 4,
              cursor: "pointer",
              textAlign: "left",
              transition: "background 120ms, color 120ms",
              flexShrink: isMobile ? 0 : undefined,
              whiteSpace: isMobile ? "nowrap" : undefined,
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = "var(--ink-2)";
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.background = "transparent";
            }}
          >
            <span style={{ display: "inline-flex", color: isActive ? "var(--paper)" : "var(--paper-3)" }}>
              {s.icon}
            </span>
            <span>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Header({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div style={{
      padding: "14px 20px",
      borderBottom: "1px solid var(--line-soft)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "var(--ink-1)",
    }}>
      <span style={{ fontSize: 14, color: "var(--paper)", fontWeight: 600 }}>
        {label}
      </span>
      <Tooltip content="Close">
        <button
          onClick={onClose}
          aria-label="Close settings"
          style={{
            padding: 6,
            color: "var(--paper-3)",
            background: "transparent",
            border: "1px solid var(--line-soft)",
            borderRadius: 6,
            cursor: "pointer",
            display: "inline-flex",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--paper)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--paper-3)"; }}
        >
          {Icon.close(11)}
        </button>
      </Tooltip>
    </div>
  );
}

/* ───────── Row primitives ───────── */

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const isPhone = useIsPhone();
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isPhone ? "1fr" : "1fr auto",
      alignItems: isPhone ? "stretch" : "center",
      gap: isPhone ? 8 : 16,
      padding: "12px 0",
      borderBottom: "1px solid var(--line-soft)",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: "var(--paper)" }}>{label}</span>
        {hint && (
          <span style={{ fontSize: 11, color: "var(--paper-4)" }}>{hint}</span>
        )}
      </div>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: isPhone ? "wrap" : undefined,
        justifyContent: isPhone ? "flex-start" : undefined,
      }}>
        {children}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  borderRadius: 6,
  padding: "6px 10px",
  color: "var(--paper)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  cursor: "pointer",
  outline: "none",
  minWidth: 120,
};

const inputStyle: React.CSSProperties = {
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  borderRadius: 6,
  padding: "6px 10px",
  color: "var(--paper)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  width: 100,
  textAlign: "right",
  outline: "none",
};

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 36, height: 20,
        borderRadius: 999,
        background: on ? "var(--accent, var(--amber))" : "var(--ink-2)",
        border: "1px solid var(--line-soft)",
        position: "relative",
        cursor: "pointer",
        transition: "background 150ms",
        padding: 0,
      }}
    >
      <span style={{
        position: "absolute",
        top: 1, left: on ? 17 : 1,
        width: 16, height: 16,
        borderRadius: "50%",
        background: "var(--paper)",
        transition: "left 150ms",
      }} />
    </button>
  );
}

/* ───────── General ───────── */

const STARTUP_ROUTE_KEY = "spool.startup.route";
const DEFAULT_STARTUP_ROUTE = "last";

const STARTUP_OPTIONS: { value: string; label: string }[] = [
  { value: "last",        label: "Last visited" },
  { value: "/monitor",    label: "Monitor" },
  { value: "/portfolio",  label: "Portfolio" },
  { value: "/swap",       label: "Swap" },
];

function GeneralPanel() {
  const { sidebarOpen, toggleSidebar } = useApp();
  const [autoOpenTrading, setAutoOpenTrading] = useUserPreference<boolean>(
    PREF_KEYS.floatingOpen, false,
  );
  const [startup, setStartupState] = useState<string>(DEFAULT_STARTUP_ROUTE);
  useEffect(() => {
    try {
      const v = localStorage.getItem(STARTUP_ROUTE_KEY);
      if (v) setStartupState(v);
    } catch { /* ignore */ }
  }, []);
  const setStartup = (v: string) => {
    setStartupState(v);
    try { localStorage.setItem(STARTUP_ROUTE_KEY, v); } catch { /* ignore */ }
  };

  return (
    <Section>
      <Row
        label="Sidebar"
        hint="Show or hide the left sidebar."
      >
        <Toggle on={sidebarOpen} onChange={() => toggleSidebar()} />
      </Row>
      <Row
        label="Floating trade panel"
        hint="Open the floating trading panel by default."
      >
        <Toggle on={autoOpenTrading} onChange={setAutoOpenTrading} />
      </Row>
      <Row
        label="Default landing page"
        hint={
          startup === "last"
            ? "Spool restores your last meaningful page on next visit."
            : "Spool always opens this page on next visit."
        }
      >
        <select
          value={startup}
          onChange={(e) => setStartup(e.target.value)}
          style={selectStyle}
        >
          {STARTUP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Row>
    </Section>
  );
}

/* ───────── Trading ───────── */

function TradingPanel() {
  const [slipBps, setSlipBps] = useUserPreference<number>(PREF_KEYS.slippageBps, 100);
  const [feeLamports, setFeeLamports] = useUserPreference<number>(
    PREF_KEYS.transactionsFee, 100_000,
  );
  const [quote, setQuote] = useUserPreference<string>(
    PREF_KEYS.buyInputMint, defaultQuoteMint().label,
  );
  const [, setSellQuote] = useUserPreference<string>(
    PREF_KEYS.sellOutputMint, defaultQuoteMint().label,
  );

  const slipPct = (slipBps / 100).toString();
  const feeSol = (feeLamports / 1e9).toFixed(4);

  return (
    <Section>
      <Row
        label="Default quote currency"
        hint="The asset used to size buys and the asset received on sells."
      >
        <select
          value={quote}
          onChange={(e) => { setQuote(e.target.value); setSellQuote(e.target.value); }}
          style={selectStyle}
        >
          {quoteMints().map((q) => (
            <option key={q.label} value={q.label}>{q.label}</option>
          ))}
        </select>
      </Row>
      <Row
        label="Default slippage"
        hint="Maximum price drift accepted on every order. Stored in basis points."
      >
        <input
          type="text"
          inputMode="decimal"
          value={slipPct}
          onChange={(e) => {
            const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
            if (isFinite(v) && v >= 0) setSlipBps(Math.min(10_000, Math.max(0, Math.round(v * 100))));
          }}
          style={inputStyle}
        />
        <span className="mono" style={{ fontSize: 11, color: "var(--paper-3)" }}>%</span>
      </Row>
      <Row
        label="Priority fee"
        hint="Tip paid to land the transaction. Higher means faster inclusion."
      >
        <input
          type="text"
          inputMode="decimal"
          value={feeSol}
          onChange={(e) => {
            const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
            if (isFinite(v) && v >= 0) setFeeLamports(Math.floor(v * 1e9));
          }}
          onBlur={() => {
            if (feeLamports < 100_000) setFeeLamports(100_000);
          }}
          style={inputStyle}
        />
        <span className="mono" style={{ fontSize: 11, color: "var(--paper-3)" }}>SOL</span>
      </Row>
    </Section>
  );
}

/* ───────── Wallets ───────── */

function WalletsPanel({ onManage }: { onManage: () => void }) {
  const userWallets = useUserWallets();
  const { navigate } = useClientNav();
  const wallets = userWallets.wallets;

  return (
    <Section>
      <Row label="Wallets on this chain" hint="Keys live in the encrypted vault on this Trade UI's server, never in the browser.">
        <button
          type="button"
          onClick={() => { onManage(); navigate("/portfolio"); }}
          style={{ ...selectStyle, minWidth: 0, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          {Icon.key(11)} Manage wallets
        </button>
      </Row>
      {userWallets.loading && wallets.length === 0 ? (
        <span style={{ fontSize: 12, color: "var(--paper-3)", paddingTop: 12 }}>Loading wallets…</span>
      ) : wallets.length === 0 ? (
        <span style={{ fontSize: 12, color: "var(--paper-3)", paddingTop: 12 }}>No wallets yet.</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 12 }}>
          {wallets.map((w) => {
            const bal = userWallets.balances[w.id];
            return (
              <div
                key={w.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  background: "var(--ink-0)",
                  border: "1px solid var(--line-soft)",
                  borderRadius: 6,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{
                    fontSize: 12, color: "var(--paper)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {w.displayLabel}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)" }}>
                    {shortAddr(w.pubkey, 8)}
                  </span>
                </div>
                <span className="mono" style={{
                  fontSize: 11, color: "var(--paper)", minWidth: 70, textAlign: "right",
                }}>
                  {bal?.loading ? "…" : (bal?.sol ?? 0).toFixed(3)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ───────── Shortcuts ───────── */

function ShortcutsPanel() {
  const items = useMemo(() => [
    { keys: ["⌘", "K"],    label: "Open search" },
    { keys: ["/"],          label: "Open search" },
    { keys: ["Esc"],        label: "Close any modal or overlay" },
    { keys: ["G", "M"],    label: "Go to Monitor" },
    { keys: ["G", "P"],    label: "Go to Portfolio" },
    { keys: ["G", "W"],    label: "Go to Wallets" },
    { keys: ["G", "S"],    label: "Go to Swap" },
    { keys: ["⌘", "+"],    label: "Zoom in" },
    { keys: ["⌘", "−"],    label: "Zoom out" },
    { keys: ["⌘", "0"],    label: "Reset zoom" },
  ], []);
  return (
    <Section>
      <span className="eyebrow" style={{ display: "block", paddingBottom: 8 }}>
        Keyboard shortcuts
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((it, i) => (
          <div
            key={i}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 12px",
              background: "var(--ink-0)",
              border: "1px solid var(--line-soft)",
              borderRadius: 6,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--paper-2)" }}>{it.label}</span>
            <span style={{ display: "inline-flex", gap: 4 }}>
              {it.keys.map((k, j) => (
                <span key={j} className="kbd">{k}</span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ───────── Section wrapper ───────── */

function Section({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>;
}
