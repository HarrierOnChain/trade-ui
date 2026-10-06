"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Icon, Tooltip } from "../atoms";
import { useApp } from "../../contexts/AppContext";
import { useRegion } from "../../contexts/RegionContext";
import { useUserPreference } from "../../hooks/useUserPreference";
import { useUserWallets } from "../../hooks/useUserWallets";
import { PREF_KEYS } from "../TradingPanel/presets";
import { quoteMints, defaultQuoteMint } from "../../lib/quoteMints";
import { BackendClient, useSession, writeSession } from "../../api/backend";
import { usePrivy, useDelegatedActions } from "@privy-io/react-auth";
import { privyAvailable } from "./PrivyRoot";
import { shortAddr } from "../../lib/format";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { fluidColsFit } from "../../lib/responsive";

type SectionId =
  | "general"
  | "trading"
  | "network"
  | "wallets"
  | "account"
  | "shortcuts";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
}

const SECTIONS: SectionDef[] = [
  { id: "general",       label: "General",       icon: Icon.gear(13) },
  { id: "trading",       label: "Trading",       icon: Icon.bolt(13) },
  { id: "network",       label: "Network",       icon: Icon.solana(13) },
  { id: "wallets",       label: "Wallets",       icon: Icon.wallet(13) },
  { id: "account",       label: "Account",       icon: Icon.xProfile(13) },
  { id: "shortcuts",     label: "Shortcuts",     icon: Icon.search(13) },
];

export function SettingsModal() {
  const { settingsOpen, closeSettings } = useApp();
  const [section, setSection] = useState<SectionId>("general");
  const isMobile = useIsMobile();

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
            {section === "network"       && <NetworkPanel />}
            {section === "wallets"       && <WalletsPanel />}
            {section === "account"       && <AccountPanel onAfterDisconnect={closeSettings} />}
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
  { value: "/deploy",     label: "Deploy" },
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

function zoomBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 28, height: 28,
    background: "var(--ink-0)",
    border: "1px solid var(--line-soft)",
    borderRadius: 6,
    color: disabled ? "var(--paper-4)" : "var(--paper)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 13,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  };
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

/* ───────── Network / region ───────── */

function NetworkPanel() {
  const {
    region, regions, setRegion,
    checking, latencies, refreshRegionPings,
  } = useRegion();
  const isMobile = useIsMobile();
  const [apiBase, setApiBase] = useState("https://api.raze.bot");
  const [apiKey, setApiKey] = useState("");
  const [apiMsg, setApiMsg] = useState<string | null>(null);
  const [apiBusy, setApiBusy] = useState(false);

  useEffect(() => {
    void import("../../api/settings").then(({ readApiSettings }) => {
      const s = readApiSettings();
      setApiBase(s.apiBase);
      setApiKey(s.apiKey);
    });
  }, []);

  async function saveApi() {
    setApiBusy(true);
    setApiMsg(null);
    try {
      const { writeApiSettings } = await import("../../api/settings");
      await writeApiSettings({ apiBase, apiKey });
      const res = await fetch("/api/raze/chains", {
        headers: { "x-trade-ui-key": apiKey.trim(), accept: "application/json" },
      });
      if (res.status === 401) throw new Error("Key rejected");
      setApiMsg("Saved");
    } catch (e) {
      setApiMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setApiBusy(false);
    }
  }

  const regional = regions.filter((r) => r.id !== "local");

  return (
    <Section>
      <Row label="API base" hint="The market-data API's host root. Default is https://api.raze.bot.">
        <input
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          style={{ ...selectStyle, minWidth: 220 }}
        />
      </Row>
      <Row label="API key" hint="Sent as x-api-key through the local /api/raze proxy. Stored on this machine.">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="x-api-key"
          style={{ ...selectStyle, minWidth: 220 }}
        />
      </Row>
      <Row label="" hint={apiMsg ?? ""}>
        <button
          type="button"
          onClick={() => { void saveApi(); }}
          disabled={apiBusy || !apiKey.trim()}
          style={{ ...selectStyle, minWidth: 0, padding: "6px 12px" }}
        >
          {apiBusy ? "Saving…" : "Save key"}
        </button>
      </Row>
      <Row
        label="Region selection"
        hint="The fastest gateway is auto-selected on load. Pick one below to override."
      >
        <button
          onClick={refreshRegionPings}
          disabled={checking}
          style={{
            ...selectStyle,
            minWidth: 0, padding: "6px 10px",
            color: checking ? "var(--paper-4)" : "var(--paper)",
          }}
        >
          {checking ? "Pinging…" : "Refresh"}
        </button>
      </Row>
      <div style={{ paddingTop: 8 }}>
        <span className="eyebrow" style={{ display: "block", paddingBottom: 6 }}>
          Available regions
        </span>
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? fluidColsFit(140) : "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 8,
        }}>
          {regional.map((r) => {
            const lat = latencies[r.id];
            const active = region.id === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setRegion(r.id)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start",
                  gap: 4, padding: "10px 12px",
                  background: active ? "var(--ink-2)" : "var(--ink-0)",
                  border: "1px solid " + (active ? "var(--paper-3)" : "var(--line-soft)"),
                  borderRadius: 6, cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14 }}>{r.flag}</span>
                  <span style={{
                    fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
                    color: active ? "var(--paper)" : "var(--paper-2)", fontWeight: 600,
                  }}>
                    {r.label}
                  </span>
                </span>
                <span className="mono" style={{
                  fontSize: 10,
                  color: lat?.status === "ok"
                    ? "var(--accent)"
                    : lat?.status === "error"
                      ? "var(--sell)"
                      : "var(--paper-4)",
                }}>
                  {lat?.status === "ok" ? `${lat.ms} ms`
                    : lat?.status === "checking" ? "checking…"
                    : lat?.status === "error" ? "unreachable"
                    : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/* ───────── Wallets ───────── */

function WalletsPanel() {
  const userWallets = useUserWallets();
  const wallets = userWallets.wallets;

  if (userWallets.loading && wallets.length === 0) {
    return (
      <Section>
        <span style={{ fontSize: 12, color: "var(--paper-3)" }}>Loading wallets…</span>
      </Section>
    );
  }

  if (wallets.length === 0) {
    return (
      <Section>
        <span style={{ fontSize: 12, color: "var(--paper-3)" }}>
          No wallets yet. Add one from the sidebar.
        </span>
      </Section>
    );
  }

  return (
    <Section>
      <span className="eyebrow" style={{ display: "block", paddingBottom: 8 }}>
        {wallets.length} wallet{wallets.length === 1 ? "" : "s"} on this account
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                fontSize: 11, color: "var(--paper-2)",
                padding: "2px 6px",
                background: "var(--ink-2)", borderRadius: 4,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>
                {w.kind}
              </span>
              <span className="mono" style={{
                fontSize: 11, color: "var(--paper)", minWidth: 70, textAlign: "right",
              }}>
                {bal?.loading ? "…" : `${(bal?.sol ?? 0).toFixed(3)} SOL`}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ───────── Account ───────── */

function AccountPanel({ onAfterDisconnect }: { onAfterDisconnect: () => void }) {
  const session = useSession();
  const { region } = useRegion();
  const { setAuthed, pushToast } = useApp();
  const [me, setMe] = useState<{ email: string | null; role: string; createdAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const c = new BackendClient(region.baseUrl, session.token);
    c.me().then((r) => {
      if (cancelled) return;
      setMe({ email: r.email, role: r.role, createdAt: r.createdAt });
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [session, region.baseUrl]);

  const copy = async () => {
    if (!session?.pubkey) return;
    try {
      await navigator.clipboard.writeText(session.pubkey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };

  async function disconnect() {
    if (session?.token) {
      const c = new BackendClient(region.baseUrl, session.token);
      void c.logout().catch(() => {});
    }
    writeSession(null);
    setAuthed(false);
    pushToast({ title: "DISCONNECTED", body: "Session ended", tone: "default" });
    onAfterDisconnect();
  }

  if (!session) {
    return (
      <Section>
        <span style={{ fontSize: 12, color: "var(--paper-3)" }}>
          You are browsing as a guest. Connect a wallet from the top right to manage account settings.
        </span>
      </Section>
    );
  }

  return (
    <Section>
      <Row
        label="Wallet"
        hint="The Phantom pubkey signing for this session."
      >
        <Tooltip content={session.pubkey} mono>
          <button
            onClick={copy}
            className="mono"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 10px",
              background: "var(--ink-0)",
              border: "1px solid var(--line-soft)",
              borderRadius: 6,
              color: "var(--paper)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {copied ? Icon.check(11) : Icon.copy(11)}
            <span>{shortAddr(session.pubkey, 8)}</span>
          </button>
        </Tooltip>
      </Row>
      <Row label="Email" hint="Linked email, used for password sign-in.">
        <span className="mono" style={{ fontSize: 11, color: me?.email ? "var(--paper)" : "var(--paper-4)" }}>
          {me?.email ?? "Not linked"}
        </span>
      </Row>
      <Row label="Role" hint="Your access level on this region.">
        <span className="mono" style={{
          fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "3px 8px", borderRadius: 4,
          background: "var(--ink-2)", color: "var(--paper-2)",
          border: "1px solid var(--line-soft)",
        }}>
          {me?.role ?? "—"}
        </span>
      </Row>
      <Row label="Session expires">
        <span className="mono" style={{ fontSize: 11, color: "var(--paper-3)" }}>
          {new Date(session.expiresAt).toLocaleString()}
        </span>
      </Row>
      {privyAvailable() && <PrivyDelegateRow />}
      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 16 }}>
        <button
          onClick={disconnect}
          style={{
            padding: "8px 14px",
            background: "transparent",
            border: "1px solid var(--sell)",
            color: "var(--sell)",
            borderRadius: 6,
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--sell)"; e.currentTarget.style.color = "var(--ink-0)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--sell)"; }}
        >
          Disconnect
        </button>
      </div>
    </Section>
  );
}

/* ───────── Privy automated-trading delegation ───────── */
//
// Only meaningful for users signed in via Privy (usePrivy().authenticated with
// an embedded Solana wallet). For everyone else this renders nothing. Lets the
// user grant our server permission to sign trades on their embedded wallet
// (limit orders, ladders) without the browser present — then re-syncs
// the backend's `signerProvisioned` gate via auth.privyRefresh.

function PrivyDelegateRow() {
  const { ready, authenticated, user } = usePrivy();
  const { delegateWallet } = useDelegatedActions();
  const { region } = useRegion();
  const session = useSession();
  const { pushToast } = useApp();
  const [busy, setBusy] = useState(false);
  const [delegated, setDelegated] = useState<boolean | null>(null);

  // Find the embedded Solana wallet on the Privy user.
  const solWallet = useMemo(() => {
    if (!user) return null;
    for (const acct of user.linkedAccounts ?? []) {
      if (
        acct.type === "wallet" &&
        acct.chainType === "solana" &&
        (acct.walletClientType === "privy" || acct.walletClientType === "privy-v2")
      ) {
        return acct;
      }
    }
    return null;
  }, [user]);

  useEffect(() => {
    if (solWallet) setDelegated(Boolean(solWallet.delegated));
  }, [solWallet]);

  // Not a Privy session, or no embedded Solana wallet yet → nothing to show.
  if (!ready || !authenticated || !solWallet) return null;

  async function enable() {
    if (busy || !solWallet) return;
    setBusy(true);
    try {
      await delegateWallet({ address: solWallet.address, chainType: "solana" });
      // Privy is the source of truth; re-sync the backend gate.
      if (session?.token) {
        await new BackendClient(region.baseUrl, session.token).privyRefresh().catch(() => {});
      }
      setDelegated(true);
      pushToast({ title: "AUTOMATED TRADING ON", body: "Server can now sign for your Privy wallet", tone: "buy" });
    } catch (err) {
      pushToast({ title: "DELEGATION FAILED", body: err instanceof Error ? err.message : String(err), tone: "sell" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row
      label="Automated trading"
      hint="Delegate signing to the server so limit orders & ladders can fire while you're away."
    >
      {delegated ? (
        <span className="mono" style={{
          fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
          padding: "3px 8px", borderRadius: 4,
          background: "color-mix(in oklch, var(--buy) 16%, var(--ink-1))",
          color: "var(--buy)", border: "1px solid var(--buy)",
        }}>
          Enabled
        </span>
      ) : (
        <button
          onClick={enable}
          disabled={busy}
          className="mono"
          style={{
            padding: "6px 12px", fontSize: 11,
            background: "var(--amber)", color: "var(--ink-0)",
            border: "none", borderRadius: 6,
            cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1,
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}
        >
          {busy ? "Enabling…" : "Enable"}
        </button>
      )}
    </Row>
  );
}

/* ───────── Shortcuts ───────── */

function ShortcutsPanel() {
  const items = useMemo(() => [
    { keys: ["⌘", "K"],    label: "Open search" },
    { keys: ["Esc"],        label: "Close any modal or overlay" },
    { keys: ["⌘", "B"],    label: "Toggle sidebar" },
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
