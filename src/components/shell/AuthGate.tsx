"use client";
/**
 * AuthGate — controls access to the terminal.
 *
 * Behaviour depends on system config fetched from GET /config:
 *
 *   publicViewEnabled=false (default)
 *     → unauthenticated visitors see the AuthPage sign-in screen.
 *
 *   publicViewEnabled=true
 *     → unauthenticated visitors go straight to the terminal.
 *       A slim "guest bar" at the top offers a sign-in button.
 *
 * AuthPage method visibility:
 *   phantomAuthEnabled=true   → show Phantom wallet button
 *   passwordAuthEnabled=true  → show email/password form
 *
 * Phantom auth flow (unchanged):
 *   1. phantom.connect → pubkey
 *   2. POST /auth/nonce   →  { nonce, message }
 *   3. phantom.signMessage(message) → base58 signature
 *   4. POST /auth/verify  →  bearer token
 *   5. writeSession + setAuthed(true)
 *
 * Password auth flow:
 *   Register: POST /auth/register { email, password }
 *   Login:    POST /auth/password-login { email, password }
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useApp } from "../../contexts/AppContext";
import { useRegion } from "../../contexts/RegionContext";
import { getBackendBase } from "../../api/config";
import { BackendClient, writeSession, type SystemConfig } from "../../api/backend";
import { applyChainAvailability } from "../../lib/chains";
import { privyAvailable } from "./PrivyRoot";
import { Tooltip } from "../atoms";
import { peekReferralCode, clearReferralCode } from "../../lib/referral";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
}

function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const anyWin = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  const p = anyWin.phantom?.solana ?? anyWin.solana;
  return p && p.isPhantom ? p : null;
}

const B58_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const b58: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < b58.length; j++) {
      carry += b58[j] << 8;
      b58[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      b58.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let i = 0; i < zeros; i++) out += "1";
  for (let i = b58.length - 1; i >= 0; i--) out += B58_ALPHA[b58[i]];
  return out;
}

/* ── Top-level gate ────────────────────────────────────────────────── */

const SELFHOSTED_CONFIG: SystemConfig = {
  phantomAuthEnabled: false,
  passwordAuthEnabled: false,
  publicViewEnabled: true,
  phantomTradingEnabled: false,
  privyAuthEnabled: false,
  privyTradingEnabled: false,
  maintenanceMode: false,
  maxWalletsPerUser: 0,
  maxRulesPerUser: 0,
  regionSelectionEnabled: false,
  disabledTerminalRegions: [],
  disabledChains: [],
  feeBps: 0,
  feeWallet: "",
  sponsorWalletPubkey: "",
  rewardsEnabled: false,
  rewardsPayoutWalletPubkey: "",
};

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { setAuthed, setSysConfig } = useApp();
  const [ready, setReady] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);

  useEffect(() => {
    setSysConfig(SELFHOSTED_CONFIG);
    setAuthed(true);
    applyChainAvailability([]);
    try {
      writeSession({
        token: "local",
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        pubkey: "local",
      });
    } catch { /* ignore */ }
    let cancelled = false;
    void (async () => {
      let localKey = false;
      try {
        const { readApiSettings, writeApiSettings } = await import("../../api/settings");
        const local = readApiSettings();
        localKey = Boolean(local.apiKey);
        // Sync the cookie in the background. Awaiting this on boot deadlocks
        // with the RSC stream on /token/* (especially through Cursor's port
        // proxy) and leaves the boot splash up forever.
        if (local.apiKey) void writeApiSettings(local);
        const r = await fetch("/api/session", { signal: AbortSignal.timeout(5_000) });
        const j = await r.json() as { configured?: boolean };
        if (cancelled) return;
        setNeedsKey(!j.configured && !local.apiKey);
      } catch {
        if (!cancelled) setNeedsKey(!localKey);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [setAuthed, setSysConfig]);

  if (!ready) return <LoadingScreen region="API" />;
  if (needsKey) {
    return <ApiKeySetup onDone={() => setNeedsKey(false)} />;
  }
  return <>{children}</>;
}

function ApiKeySetup({ onDone }: { onDone: () => void }) {
  const [apiBase, setApiBase] = useState("https://api.raze.bot");
  const [apiKey, setApiKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const { writeApiSettings } = await import("../../api/settings");
      await writeApiSettings({ apiBase, apiKey });
      const res = await fetch("/api/raze/chains", {
        headers: { "x-trade-ui-key": apiKey.trim(), accept: "application/json" },
      });
      if (res.status === 401) throw new Error("Key rejected");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--ink-0)", color: "var(--paper)", padding: 24,
    }}>
      <form
        onSubmit={(e) => { e.preventDefault(); void save(); }}
        style={{
          width: 420, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 12,
          border: "1px solid var(--line)", borderRadius: 12, padding: 24, background: "var(--ink-1)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 650 }}>Trade UI</div>
        <div style={{ fontSize: 13, color: "var(--paper-3)", lineHeight: 1.45 }}>
          Self-hosted terminal. Paste a Raze API key from raze.bot/pricing. The key stays on this machine and is proxied to api.raze.bot.
        </div>
        <label style={{ fontSize: 11, color: "var(--paper-4)" }}>API base</label>
        <input value={apiBase} onChange={(e) => setApiBase(e.target.value)}
          style={{ background: "var(--ink-0)", color: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }} />
        <label style={{ fontSize: 11, color: "var(--paper-4)" }}>API key</label>
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" autoFocus
          placeholder="x-api-key"
          style={{ background: "var(--ink-0)", color: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }} />
        {err && <div style={{ color: "var(--red)", fontSize: 12 }}>{err}</div>}
        <button type="submit" disabled={busy || !apiKey.trim()}
          style={{
            marginTop: 8, padding: "10px 14px", borderRadius: 8, border: "none",
            background: "var(--amber)", color: "#111", fontWeight: 700, cursor: "pointer",
          }}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}

/* ── Loading screen ────────────────────────────────────────────────── */

const BOOT_STEPS = [
  { id: "edge",    label: "Reaching region edge",   detail: "tls · h2" },
  { id: "region",  label: "Region selected",         detail: "" },
  { id: "config",  label: "Loading terminal config", detail: "GET /config" },
  { id: "session", label: "Resuming session",        detail: "auth · cache" },
] as const;

const BOOT_LOG_LINES: { src: string; msg: string }[] = [
  { src: "net",    msg: "TLS handshake → edge.raze.sh · 38ms" },
  { src: "edge",   msg: "session token validated · h2 stream open" },
  { src: "config", msg: "GET /config 200 · 1.4kb" },
  { src: "ws",     msg: "subscribed · slot 294,712,883" },
  { src: "dex",    msg: "raydium · meteora · orca · pump online" },
  { src: "feed",   msg: "logs subscribed · 4 venues" },
  { src: "auth",   msg: "challenge ready · nonce a9f2e1" },
];

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

function SpinnerDots() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % SPINNER_FRAMES.length), 110);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="mono" style={{
      color: "var(--amber)", display: "inline-block", width: 10, textAlign: "left",
      fontSize: 12, lineHeight: 1,
    }}>
      {SPINNER_FRAMES[i]}
    </span>
  );
}

function RazeLoadingMark({ size = 120 }: { size?: number }) {
  const c = size / 2;
  const rOuter = c - 4;
  const rMid = c - 14;
  const rInner = c - 26;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      {/* faint outer ring */}
      <circle cx={c} cy={c} r={rOuter} fill="none" stroke="var(--line-soft)" strokeWidth={1} />
      {/* outer scanning arc, slow */}
      <g style={{ transformOrigin: `${c}px ${c}px`, animation: "raze-spin-cw 7s linear infinite" }}>
        <circle
          cx={c} cy={c} r={rOuter} fill="none"
          stroke="var(--amber)" strokeWidth={1.4}
          strokeDasharray={`${size * 0.55} ${size * 3.2}`} strokeLinecap="round"
        />
      </g>
      {/* mid ring, counter-rotating */}
      <circle cx={c} cy={c} r={rMid} fill="none" stroke="var(--line)" strokeWidth={1} />
      <g style={{ transformOrigin: `${c}px ${c}px`, animation: "raze-spin-ccw 4s linear infinite" }}>
        <circle
          cx={c} cy={c} r={rMid} fill="none"
          stroke="var(--amber)" strokeWidth={1.1} opacity={0.7}
          strokeDasharray={`${size * 0.18} ${size * 1.4}`} strokeLinecap="round"
        />
      </g>
      {/* tick marks */}
      {Array.from({ length: 12 }).map((_, i) => {
        const ang = (i * Math.PI * 2) / 12;
        const r = (v: number) => Math.round(v * 100) / 100;
        const x1 = r(c + Math.cos(ang) * (rMid - 4));
        const y1 = r(c + Math.sin(ang) * (rMid - 4));
        const x2 = r(c + Math.cos(ang) * (rMid - 1));
        const y2 = r(c + Math.sin(ang) * (rMid - 1));
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="var(--paper-4)" strokeWidth={1} opacity={i % 3 === 0 ? 0.8 : 0.35} />
        );
      })}
      {/* inner ring + pulsing core */}
      <circle cx={c} cy={c} r={rInner} fill="none" stroke="var(--line)" strokeWidth={1} opacity={0.6} />
      <circle cx={c} cy={c} r={size * 0.08} fill="var(--amber)"
        style={{ animation: "raze-pulse 1.6s ease-in-out infinite", transformOrigin: `${c}px ${c}px` }} />
      <circle cx={c} cy={c} r={size * 0.16} fill="var(--amber)" opacity={0.18}
        style={{ animation: "raze-pulse-soft 1.6s ease-in-out infinite", transformOrigin: `${c}px ${c}px` }} />

      <style>{`
        @keyframes raze-spin-cw  { to { transform: rotate(360deg); } }
        @keyframes raze-spin-ccw { to { transform: rotate(-360deg); } }
        @keyframes raze-pulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.25); }
        }
        @keyframes raze-pulse-soft {
          0%, 100% { transform: scale(1);   opacity: 0.18; }
          50%      { transform: scale(1.6); opacity: 0; }
        }
      `}</style>
    </svg>
  );
}

function CornerBracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const size = 18;
  const t = pos[0] === "t" ? 18 : "auto";
  const b = pos[0] === "b" ? 18 : "auto";
  const l = pos[1] === "l" ? 18 : "auto";
  const r = pos[1] === "r" ? 18 : "auto";
  const borderTop    = pos[0] === "t" ? "1px solid var(--amber)" : "none";
  const borderBottom = pos[0] === "b" ? "1px solid var(--amber)" : "none";
  const borderLeft   = pos[1] === "l" ? "1px solid var(--amber)" : "none";
  const borderRight  = pos[1] === "r" ? "1px solid var(--amber)" : "none";
  return (
    <div style={{
      position: "fixed",
      top: t, bottom: b, left: l, right: r,
      width: size, height: size, zIndex: 1, pointerEvents: "none",
      borderTop, borderBottom, borderLeft, borderRight,
      opacity: 0.7,
    }} />
  );
}

function LoadingScreen({ region }: { region?: string }) {
  // Boot-stage progress: each stage flips to "done" on its own timer.
  // The whole screen will be unmounted as soon as /config resolves; this is just
  // the visual pacing while it's in flight.
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(1), 350),
      setTimeout(() => setStage(2), 800),
      setTimeout(() => setStage(3), 1500),
    ];
    return () => { timers.forEach(clearTimeout); };
  }, []);

  // Boot-log: lines appear one by one. After all are shown, no further changes.
  const [logIdx, setLogIdx] = useState(1);
  useEffect(() => {
    if (logIdx >= BOOT_LOG_LINES.length) return;
    const t = setTimeout(() => setLogIdx((i) => i + 1), 220 + Math.random() * 180);
    return () => clearTimeout(t);
  }, [logIdx]);

  // Live slot ticker (cosmetic) — increments every ~400ms.
  const [slot, setSlot] = useState(294_712_883);
  const [rtt, setRtt] = useState(38);
  useEffect(() => {
    const id = setInterval(() => {
      setSlot((s) => s + 1);
      setRtt(() => 32 + Math.floor(Math.random() * 14));
    }, 420);
    return () => clearInterval(id);
  }, []);

  const fmtSlot = slot.toLocaleString("en-US");

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "var(--ink-0)", color: "var(--paper)",
      overflow: "hidden",
      // subtle grid wash
      backgroundImage:
        "linear-gradient(to right, color-mix(in oklch, var(--paper) 4%, transparent) 1px, transparent 1px), " +
        "linear-gradient(to bottom, color-mix(in oklch, var(--paper) 4%, transparent) 1px, transparent 1px)",
      backgroundSize: "40px 40px, 40px 40px",
      backgroundPosition: "center center",
    }}>
      <Vignette />

      {/* CRT scanline overlay */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none",
        backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 2px, color-mix(in oklch, var(--paper) 3%, transparent) 2px, color-mix(in oklch, var(--paper) 3%, transparent) 3px)",
        mixBlendMode: "screen",
        opacity: 0.5,
      }} />

      <CornerBracket pos="tl" />
      <CornerBracket pos="tr" />
      <CornerBracket pos="bl" />
      <CornerBracket pos="br" />

      <div style={{
        position: "relative", zIndex: 2,
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 22, width: "min(560px, 92vw)",
      }}>
        {/* Brand mark + wordmark */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <RazeLoadingMark size={120} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span className="ser" style={{
              fontSize: 30, fontStyle: "italic", letterSpacing: "-0.025em",
              color: "var(--paper)", lineHeight: 1,
            }}>
              Raze Terminal
            </span>
            <span className="eyebrow" style={{
              color: "var(--amber)", letterSpacing: "0.18em",
            }}>
              Private alpha · 2026
            </span>
          </div>
        </div>

        {/* Boot checklist */}
        <div style={{
          width: "100%",
          padding: "14px 18px",
          background: "var(--ink-1)",
          border: "1px solid var(--line-soft)",
          borderRadius: "var(--r-3)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {BOOT_STEPS.map((s, i) => {
            const done = i < stage;
            const active = i === stage;
            const pending = i > stage;
            return (
              <div key={s.id} className="mono" style={{
                display: "grid",
                gridTemplateColumns: "16px 1fr auto",
                alignItems: "center", gap: 10,
                fontSize: 11.5,
                color: done ? "var(--paper-2)" : active ? "var(--paper)" : "var(--paper-4)",
                opacity: pending ? 0.45 : 1,
                transition: "color 200ms, opacity 200ms",
              }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 14, height: 14,
                }}>
                  {done ? (
                    <span style={{ color: "var(--buy)", fontSize: 12 }}>✓</span>
                  ) : active ? (
                    <SpinnerDots />
                  ) : (
                    <span style={{ color: "var(--paper-4)" }}>·</span>
                  )}
                </span>
                <span style={{ letterSpacing: "0.01em" }}>
                  {s.label}
                  {s.id === "region" && region ? ` · ${region}` : ""}
                </span>
                <span style={{
                  fontSize: 10, color: "var(--paper-4)", letterSpacing: "0.06em",
                }}>
                  {done && s.id === "edge" ? `${rtt}ms` :
                   done && s.id === "region" ? "ok" :
                   done && s.id === "config" ? "ok" :
                   active ? "…" :
                   s.detail}
                </span>
              </div>
            );
          })}
        </div>

        {/* Boot-log stream */}
        <div style={{
          width: "100%",
          padding: "10px 14px 12px",
          background: "color-mix(in oklch, var(--ink-1) 60%, transparent)",
          border: "1px solid var(--line-soft)",
          borderRadius: "var(--r-3)",
          minHeight: 116,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ display: "inline-flex", gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "oklch(0.68 0.19 25)" }} />
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "oklch(0.85 0.12 85)" }} />
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--buy)" }} />
            </span>
            <span className="eyebrow" style={{ color: "var(--paper-4)" }}>boot.log</span>
            <div style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)" }}>
              slot {fmtSlot}
            </span>
          </div>
          {BOOT_LOG_LINES.slice(0, logIdx).map((l, i) => (
            <div key={i} className="mono" style={{
              fontSize: 10.5, lineHeight: 1.7, color: "var(--paper-2)",
              display: "grid", gridTemplateColumns: "16px 56px 1fr", gap: 8,
              opacity: 1 - (logIdx - 1 - i) * 0.08,
            }}>
              <span style={{ color: "var(--amber-d)" }}>›</span>
              <span style={{ color: "var(--amber-d)" }}>[{l.src}]</span>
              <span>{l.msg}</span>
            </div>
          ))}
          {logIdx >= BOOT_LOG_LINES.length && (
            <div className="mono" style={{
              fontSize: 10.5, lineHeight: 1.7, color: "var(--paper-3)",
              display: "grid", gridTemplateColumns: "16px 56px 1fr", gap: 8,
            }}>
              <span style={{ color: "var(--amber-d)" }}>›</span>
              <span style={{ color: "var(--amber-d)" }}>[wait]</span>
              <span>
                awaiting handshake
                <span style={{
                  display: "inline-block", width: 6, height: 10, marginLeft: 4,
                  background: "var(--amber)", verticalAlign: -1,
                  animation: "raze-load-caret 900ms steps(1) infinite",
                }} />
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom telemetry strip */}
      <div className="mono" style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 2,
        display: "flex", alignItems: "center", gap: 14,
        padding: "0 18px", height: 24,
        background: "var(--ink-1)",
        borderTop: "1px solid var(--line-soft)",
        fontSize: 10, color: "var(--paper-4)", letterSpacing: "0.08em",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="dot-live" /> MAINNET · WS
        </span>
        <span>RTT {rtt}ms</span>
        <span>{region ? `REGION ${region}` : "REGION ·"}</span>
        <span>SLOT {fmtSlot}</span>
        <div style={{ flex: 1 }} />
        <span>RAZE TERMINAL v0.1.0</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          CONNECTING
          <span style={{
            color: "var(--amber)",
            animation: "raze-load-pip 1.2s ease-in-out infinite",
            animationDelay: "0s",
          }}>●</span>
          <span style={{
            color: "var(--amber)",
            animation: "raze-load-pip 1.2s ease-in-out infinite",
            animationDelay: "0.2s",
          }}>●</span>
          <span style={{
            color: "var(--amber)",
            animation: "raze-load-pip 1.2s ease-in-out infinite",
            animationDelay: "0.4s",
          }}>●</span>
        </span>
      </div>

      <style>{`
        @keyframes raze-load-caret { 0%,49%{opacity:1} 50%,100%{opacity:0} }
        @keyframes raze-load-pip   { 0%,60%,100% { opacity: 0.2 } 30% { opacity: 1 } }
      `}</style>
    </div>
  );
}

/* ── Auth page ─────────────────────────────────────────────────────── */

function AuthPage({
  sysConfig,
  onClose,
}: {
  sysConfig: SystemConfig | null;
  onClose?: () => void;
}) {
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  return (
    <div
      className={isMobile ? "app-scroll" : undefined}
      style={{
        position: onClose ? "fixed" : "relative",
        inset: onClose ? 0 : undefined,
        height: isMobile ? "100dvh" : "100vh",
        width: "100%",
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.05fr) minmax(0, 1fr)",
        gridAutoRows: isMobile ? "min-content" : undefined,
        background: "var(--ink-0)",
        color: "var(--paper)",
        overflow: isMobile ? "auto" : "hidden",
        zIndex: onClose ? 50 : 0,
      }}
    >
      <Vignette />
      {/* Marketing panel is hidden on phones so the sign-in form stays above the fold. */}
      {!isPhone && <MonitorPanel />}
      <AuthPanel sysConfig={sysConfig} onClose={onClose} />
      <FooterStrip />
    </div>
  );
}

function Vignette() {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
      background:
        "radial-gradient(ellipse 80% 60% at 30% 40%, color-mix(in oklch, var(--amber) 5%, transparent), transparent 65%)",
    }} />
  );
}

/* ── Left panel ────────────────────────────────────────────────────── */

const LOG_LINES = [
  { t: "00:00:04.112", src: "ws",      msg: "slot 294,712,883 · rtt 38ms" },
  { t: "00:00:04.204", src: "dex",     msg: "raydium.online · meteora.online" },
  { t: "00:00:04.287", src: "stream",  msg: "logs subscribed · 4 venues" },
  { t: "00:00:04.341", src: "price",   msg: "sol=142.88  wif=2.184  jup=0.761" },
  { t: "00:00:04.482", src: "trade",   msg: "buy 1.2◎ → BONK @ 0.00002314" },
  { t: "00:00:04.522", src: "session", msg: "awaiting operator" },
  { t: "00:00:04.611", src: "ws",      msg: "slot 294,712,884 · rtt 41ms" },
  { t: "00:00:04.702", src: "dex",     msg: "orca.online · pump.online" },
  { t: "00:00:04.781", src: "trade",   msg: "sell 0.4◎ ← WIF @ 2.1841" },
  { t: "00:00:04.840", src: "risk",    msg: "slippage 3% · priority turbo" },
  { t: "00:00:04.912", src: "ws",      msg: "slot 294,712,885 · rtt 36ms" },
  { t: "00:00:05.021", src: "auth",    msg: "challenge ready · nonce a9f2e1" },
];

function RazeAuthSplashMark({ size = 26 }: { size?: number }) {
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <g style={{ transformOrigin: `${c}px ${c}px`, animation: "raze-terminal-rot 6s linear infinite" }}>
        <circle cx={c} cy={c} r={c - 2} fill="none" stroke="var(--line)" strokeWidth={1} />
        <circle
          cx={c} cy={c} r={c - 2} fill="none" stroke="var(--amber)" strokeWidth={1.4}
          strokeDasharray={`${size * 0.45} ${size * 2.5}`} strokeLinecap="round"
        />
      </g>
      <circle cx={c} cy={c} r={size * 0.13} fill="var(--amber)" />
      <style>{`@keyframes raze-terminal-rot { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

function MonitorPanel() {
  const reel = useMemo(() => [...LOG_LINES, ...LOG_LINES], []);
  const isMobile = useIsMobile();
  return (
    <div style={{
      position: "relative", zIndex: 2,
      display: "flex", flexDirection: "column",
      padding: isMobile ? "40px var(--pad-x) 32px" : "60px 48px 48px",
      minHeight: 0, overflow: "hidden",
      background: "var(--ink-0)",
      borderRight: isMobile ? "none" : "1px solid var(--line-soft)",
      borderBottom: isMobile ? "1px solid var(--line-soft)" : "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <RazeAuthSplashMark size={26} />
        <span className="ser" style={{ fontSize: 20, fontStyle: "italic", letterSpacing: "-0.02em" }}>
          Raze Terminal
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="dot-live" />
          <span className="eyebrow" style={{ color: "var(--buy)" }}>Markets live</span>
        </span>
      </div>

      <div style={{ marginTop: "auto" }}>
        <div className="eyebrow" style={{ color: "var(--amber)", marginBottom: 16 }}>
          Private alpha · 2026
        </div>
        <div className="ser" style={{
          fontSize: 64, fontStyle: "italic", lineHeight: 0.98,
          letterSpacing: "-0.03em", color: "var(--paper)",
        }}>
          A terminal<br />for the <span style={{ color: "var(--amber)" }}>long</span> session.
        </div>
        <div style={{
          marginTop: 20, maxWidth: 440,
          fontSize: 14, lineHeight: 1.55, color: "var(--paper-2)",
        }}>
          Sign in to resume your watchlists, open orders, and trade history across
          every Solana venue — from a single keyboard-native surface.
        </div>
      </div>

      <div style={{
        marginTop: 36, padding: 14,
        border: "1px solid var(--line-soft)", borderRadius: "var(--r-3)",
        background: "var(--ink-1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ display: "inline-flex", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "oklch(0.68 0.19 25)" }} />
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "oklch(0.85 0.12 85)" }} />
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--buy)" }} />
          </span>
          <span className="eyebrow" style={{ color: "var(--paper-4)" }}>tail -f raze-terminal.log</span>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)" }}>LIVE · MAINNET</span>
        </div>
        <div style={{
          height: 110, overflow: "hidden", position: "relative",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)",
          maskImage: "linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)",
        }}>
          <div style={{ animation: "auth-up 16s linear infinite" }}>
            {reel.map((l, i) => (
              <div key={i} className="mono" style={{
                fontSize: 10.5, lineHeight: 1.8, color: "var(--paper-2)",
                display: "grid", gridTemplateColumns: "92px 72px 1fr", gap: 10,
                opacity: i % 2 === 0 ? 0.5 : 0.32,
              }}>
                <span style={{ color: "var(--paper-4)" }}>{l.t}</span>
                <span style={{ color: "var(--amber-d)" }}>[{l.src}]</span>
                <span>{l.msg}</span>
              </div>
            ))}
          </div>
          <style>{`@keyframes auth-up { from { transform: translateY(0); } to { transform: translateY(-50%); } }`}</style>
        </div>
      </div>
    </div>
  );
}

/* ── Right panel ───────────────────────────────────────────────────── */

type AuthMode = "choose" | "password-login" | "password-register";

function AuthPanel({
  sysConfig,
  onClose,
}: {
  sysConfig: SystemConfig | null;
  onClose?: () => void;
}) {
  const { setAuthed, pushToast } = useApp();
  const { region } = useRegion();
  const [busy, setBusy] = useState<null | "phantom" | "password">(null);
  const [mode, setMode] = useState<AuthMode>("choose");
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();

  const phantomEnabled = sysConfig?.phantomAuthEnabled ?? true;
  const passwordEnabled = sysConfig?.passwordAuthEnabled ?? false;
  // Privy needs both the admin flag AND a build-time app id (provider mounted).
  const privyEnabled = (sysConfig?.privyAuthEnabled ?? false) && privyAvailable();

  async function connectPhantom() {
    if (busy) return;
    const phantom = getPhantom();
    if (!phantom) {
      pushToast({
        title: "NO PHANTOM",
        body: "Install the Phantom extension to continue.",
        tone: "sell",
      });
      return;
    }

    setBusy("phantom");
    try {
      const conn = await phantom.connect();
      const pubkey = conn.publicKey.toBase58();
      const client = new BackendClient(region.baseUrl);
      const { nonce, message } = await client.nonce(pubkey);
      const { signature } = await phantom.signMessage(new TextEncoder().encode(message), "utf8");
      const verified = await client.verify(pubkey, nonce, bs58encode(signature), peekReferralCode());
      clearReferralCode();
      writeSession({ token: verified.token, expiresAt: verified.expiresAt, pubkey });
      setAuthed(true);
      onClose?.();
      pushToast({
        title: "CONNECTED",
        body: `${pubkey.slice(0, 4)}…${pubkey.slice(-4)} · region ${region.flag}`,
        tone: "buy",
      });
    } catch (err) {
      pushToast({
        title: "CONNECT FAILED",
        body: err instanceof Error ? err.message : String(err),
        tone: "sell",
      });
    } finally {
      setBusy(null);
    }
  }

  if (mode === "password-login" || mode === "password-register") {
    return (
      <PasswordPanel
        mode={mode}
        onBack={() => setMode("choose")}
        onSwitchMode={setMode}
        onClose={onClose}
        busy={busy === "password"}
        setBusy={(b) => setBusy(b ? "password" : null)}
      />
    );
  }

  const hasAnyMethod = phantomEnabled || passwordEnabled || privyEnabled;

  return (
    <div style={{
      position: "relative", zIndex: 2,
      display: "flex", flexDirection: "column",
      padding: isMobile ? "44px var(--pad-x) 48px" : "60px 56px 48px",
      minHeight: 0, overflow: "auto",
      background: "var(--ink-0)",
    }}>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="mono"
          style={{
            position: "absolute", top: 20, right: 20,
            fontSize: 10, color: "var(--paper-3)", background: "transparent",
            border: "1px solid var(--line-soft)", borderRadius: 3,
            padding: "4px 10px", cursor: "pointer", letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          ✕ Close
        </button>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="eyebrow">Enter · one step</span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", letterSpacing: "0.1em" }}>
          REGION {region.flag}
        </span>
      </div>

      <div style={{ marginTop: 48 }}>
        <div className="eyebrow" style={{ color: "var(--amber)", marginBottom: 12 }}>
          Sign in or sign up
        </div>
        <div className="ser" style={{
          fontSize: isPhone ? 34 : 46, fontStyle: "italic", lineHeight: 1.02,
          letterSpacing: "-0.02em", color: "var(--paper)",
        }}>
          One tap. Same<br />account, every time.
          <span style={{
            display: "inline-block", width: 7, height: 12, marginLeft: 3,
            background: "var(--amber)", verticalAlign: -1,
            animation: "auth-caret 900ms steps(1) infinite",
          }} />
          <style>{`@keyframes auth-caret { 0%,49%{opacity:1} 50%,100%{opacity:0} }`}</style>
        </div>
        <div style={{ marginTop: 14, fontSize: 13, color: "var(--paper-3)", maxWidth: 440, lineHeight: 1.5 }}>
          {phantomEnabled
            ? "No password, no seed phrase to manage. Sign in with your Phantom wallet — new operators get platform wallets on first use, returning operators resume instantly."
            : "Sign in to access your wallets, rules and trade history."}
        </div>
      </div>

      {!hasAnyMethod ? (
        <div style={{
          marginTop: 40, padding: 16,
          border: "1px solid var(--sell)", borderRadius: 4,
          background: "color-mix(in oklch, var(--sell) 8%, var(--ink-1))",
          fontSize: 12, color: "var(--sell)", fontFamily: "var(--font-mono)",
        }}>
          All authentication methods are currently disabled. Contact the operator.
        </div>
      ) : (
        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>Continue with</div>

          {privyEnabled && (
            <PrivyOption onClose={onClose} />
          )}

          <Option
            icon={<IconTelegram />}
            title="Telegram"
            sub="Coming soon · fills & alerts in-chat"
            badge="Soon"
            disabled
          />
          <Option
            icon={<IconDiscord />}
            title="Discord"
            sub="Coming soon · DM fills from the bot"
            disabled
          />

          {phantomEnabled && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 4px" }}>
                <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
                <span className="eyebrow" style={{ color: "var(--paper-4)" }}>or connect a wallet</span>
                <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
              </div>
              <Option
                icon={<IconPhantom />}
                title={busy === "phantom" ? "Awaiting Phantom signature…" : "Phantom"}
                sub="Sign a nonce with your Phantom extension"
                kbd="P"
                onClick={connectPhantom}
                loading={busy === "phantom"}
              />
            </>
          )}

          {passwordEnabled && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 4px" }}>
                <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
                <span className="eyebrow" style={{ color: "var(--paper-4)" }}>or use email</span>
                <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
              </div>
              <Option
                icon={<IconEmail />}
                title="Email + password"
                sub="Sign in or register with your email address"
                onClick={() => setMode("password-login")}
              />
            </>
          )}

          <div className="mono" style={{
            marginTop: 10, fontSize: 10, color: "var(--paper-4)",
            letterSpacing: "0.02em", lineHeight: 1.6,
          }}>
            {phantomEnabled && (
              <>
                ↪ Platform wallets (bs58) live on the backend and sign without a prompt.<br />
                ↪ Your Phantom stays in the browser and is used as the default signer.
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: "auto", paddingTop: 36 }}>
        <div style={{
          display: "flex", gap: 18, alignItems: "center",
          fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--paper-4)",
          letterSpacing: "0.08em",
          borderTop: "1px solid var(--line-soft)", paddingTop: 14,
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--buy)" }} />
            NON-CUSTODIAL
          </span>
          <span>KEYS NEVER LEAVE THE BACKEND UNENCRYPTED</span>
          <div style={{ flex: 1 }} />
          <a href="#" style={{ color: "var(--paper-3)" }}>Terms</a>
          <a href="#" style={{ color: "var(--paper-3)" }}>Privacy</a>
        </div>
      </div>
    </div>
  );
}

/* ── Email/password panel ──────────────────────────────────────────── */

function PasswordPanel({
  mode,
  onBack,
  onSwitchMode,
  onClose,
  busy,
  setBusy,
}: {
  mode: "password-login" | "password-register";
  onBack: () => void;
  onSwitchMode: (m: AuthMode) => void;
  onClose?: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const { setAuthed, pushToast } = useApp();
  const { region } = useRegion();
  const isMobile = useIsMobile();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (mode === "password-register" && password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const client = new BackendClient(region.baseUrl);
      const res =
        mode === "password-register"
          ? await client.register(email, password, peekReferralCode())
          : await client.passwordLogin(email, password);
      if (mode === "password-register") clearReferralCode();
      writeSession({ token: res.token, expiresAt: res.expiresAt, pubkey: res.user.email ?? res.user.id });
      setAuthed(true);
      onClose?.();
      pushToast({
        title: mode === "password-register" ? "REGISTERED" : "SIGNED IN",
        body: res.user.email ?? "Welcome back",
        tone: "buy",
      });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  const isRegister = mode === "password-register";

  return (
    <div style={{
      position: "relative", zIndex: 2,
      display: "flex", flexDirection: "column",
      padding: isMobile ? "44px var(--pad-x) 48px" : "60px 56px 48px",
      minHeight: 0, overflow: "auto",
      background: "var(--ink-0)",
    }}>
      <button
        type="button"
        onClick={onBack}
        className="mono"
        style={{
          alignSelf: "flex-start",
          fontSize: 10, color: "var(--paper-3)", background: "transparent",
          border: "none", cursor: "pointer", letterSpacing: "0.08em",
          textTransform: "uppercase", padding: 0, marginBottom: 32,
        }}
      >
        ← Back
      </button>

      <div className="eyebrow" style={{ color: "var(--amber)", marginBottom: 10 }}>
        {isRegister ? "Create account" : "Sign in"}
      </div>
      <div className="ser" style={{
        fontSize: 36, fontStyle: "italic", lineHeight: 1.1,
        letterSpacing: "-0.02em", marginBottom: 32,
      }}>
        {isRegister ? "New operator" : "Welcome back"}
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
        <AuthInput
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoFocus
          disabled={busy}
        />
        <AuthInput
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          disabled={busy}
        />
        {isRegister && (
          <AuthInput
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            disabled={busy}
          />
        )}
        {err && (
          <div className="mono" style={{ fontSize: 11, color: "var(--sell)", lineHeight: 1.4 }}>
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !email || !password}
          className="mono"
          style={{
            marginTop: 4,
            padding: "10px 0",
            fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
            color: "var(--ink-0)", background: "var(--amber)",
            border: "none", borderRadius: 4, cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
        </button>
      </form>

      <div style={{ marginTop: 20 }}>
        {isRegister ? (
          <button
            type="button"
            onClick={() => { setErr(""); onSwitchMode("password-login"); }}
            className="mono"
            style={{
              fontSize: 10, color: "var(--paper-3)", background: "transparent",
              border: "none", cursor: "pointer", letterSpacing: "0.05em",
              textDecoration: "underline", padding: 0,
            }}
          >
            Already have an account? Sign in instead
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setErr(""); onSwitchMode("password-register"); }}
            className="mono"
            style={{
              fontSize: 10, color: "var(--paper-3)", background: "transparent",
              border: "none", cursor: "pointer", letterSpacing: "0.05em",
              textDecoration: "underline", padding: 0,
            }}
          >
            No account yet? Register
          </button>
        )}
      </div>
    </div>
  );
}

function AuthInput({
  label, type, value, onChange, autoFocus, disabled,
}: {
  label: string;
  type: "email" | "password" | "text";
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label className="eyebrow" style={{ fontSize: 9, color: "var(--paper-4)" }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        disabled={disabled}
        className="mono"
        style={{
          padding: "9px 12px", fontSize: 13,
          background: "var(--ink-1)", color: "var(--paper)",
          border: "1px solid var(--line-soft)", borderRadius: 4,
        }}
      />
    </div>
  );
}

/* ── Privy login option ────────────────────────────────────────────── */
//
// Self-contained so the Privy hooks (usePrivy/useLogin) only run when this is
// mounted — i.e. only when the provider exists (app id set) AND the admin flag
// is on. Opens the Privy modal, then exchanges the access token for a Raze
// session via auth.privyVerify.

function PrivyOption({ onClose }: { onClose?: () => void }) {
  const { setAuthed, pushToast } = useApp();
  const { region } = useRegion();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [busy, setBusy] = useState(false);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no Privy access token");
      const client = new BackendClient(region.baseUrl);
      const res = await client.privyVerify(token, peekReferralCode());
      clearReferralCode();
      writeSession({
        token: res.token,
        expiresAt: res.expiresAt,
        pubkey: res.user.privyId ?? res.user.id,
      });
      setAuthed(true);
      onClose?.();
      pushToast({ title: "CONNECTED", body: `Privy · region ${region.flag}`, tone: "buy" });
    } catch (err) {
      pushToast({
        title: "PRIVY FAILED",
        body: err instanceof Error ? err.message : String(err),
        tone: "sell",
      });
    } finally {
      setBusy(false);
    }
  }, [getAccessToken, region.baseUrl, region.flag, setAuthed, pushToast, onClose]);

  const { login } = useLogin({ onComplete: () => { void finish(); } });

  function onClick() {
    if (busy || !ready) return;
    if (authenticated) { void finish(); return; }
    login();
  }

  return (
    <Option
      icon={<IconPrivy />}
      title={busy ? "Verifying Privy session…" : "Privy"}
      sub="Email, social, or wallet · embedded wallet"
      onClick={onClick}
      loading={busy}
    />
  );
}

function IconPrivy() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="oklch(0.62 0.20 295)" />
      <path d="M8 7h5.2a3.4 3.4 0 0 1 0 6.8H10.4V17H8V7Zm2.4 2.1v2.6h2.6a1.3 1.3 0 0 0 0-2.6h-2.6Z" fill="#fff" />
    </svg>
  );
}

/* ── Shared option button ──────────────────────────────────────────── */

function Option({
  icon, title, sub, badge, kbd, onClick, disabled, loading,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  badge?: string;
  kbd?: string;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr auto",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        background: "var(--ink-1)",
        border: "1px solid var(--line-soft)",
        borderRadius: "var(--r-3)",
        color: "var(--paper)",
        textAlign: "left",
        cursor: disabled ? "not-allowed" : loading ? "wait" : "pointer",
        opacity: disabled ? 0.55 : loading ? 0.8 : 1,
        transition: "border-color 140ms, background 140ms",
      }}
      onMouseEnter={(e) => {
        if (disabled || loading) return;
        e.currentTarget.style.borderColor = "var(--amber)";
        e.currentTarget.style.background = "var(--ink-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--line-soft)";
        e.currentTarget.style.background = "var(--ink-1)";
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: "var(--r-2)",
        background: "var(--ink-2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--line-soft)",
      }}>
        {icon}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, color: "var(--paper)", fontWeight: 500 }}>{title}</span>
          {badge && (
            <span className="mono" style={{
              fontSize: 9, color: "var(--amber)", letterSpacing: "0.1em",
              textTransform: "uppercase",
              border: "1px solid var(--amber)", borderRadius: 2,
              padding: "1px 5px", background: "var(--amber-w)",
            }}>{badge}</span>
          )}
        </div>
        <span className="mono" style={{ fontSize: 10, color: "var(--paper-3)", letterSpacing: "0.02em" }}>
          {sub}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {kbd && <span className="kbd">{kbd}</span>}
        <span style={{
          color: "var(--paper-4)", fontFamily: "var(--font-mono)", fontSize: 16,
        }}>
          ›
        </span>
      </div>
    </button>
  );
}

/* ── Footer strip ──────────────────────────────────────────────────── */

function FooterStrip() {
  const { region } = useRegion();
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      display: "flex", alignItems: "center", gap: 14,
      padding: "0 14px", height: 22,
      background: "var(--ink-1)",
      borderTop: "1px solid var(--line-soft)",
      fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--paper-4)",
      letterSpacing: "0.05em", zIndex: 3,
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span className="dot-live" /> WS · MAINNET
      </span>
      <span>RAZE.SH</span>
      <span>REGION · {region.flag}</span>
      <div style={{ flex: 1 }} />
      <span>AUTH · GATED</span>
      <span>RAZE TERMINAL v0.1.0</span>
    </div>
  );
}

/* ── SVG brand marks ───────────────────────────────────────────────── */

function IconPhantom() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="authPhantomGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9179EA" />
          <stop offset="100%" stopColor="#534BB1" />
        </linearGradient>
      </defs>
      <path
        fill="url(#authPhantomGrad)"
        d="M12 3a9 9 0 0 0-9 9v7.2c0 .55.7.8 1.05.37l1.4-1.74a.7.7 0 0 1 1.12.04l1.2 1.73a.7.7 0 0 0 1.16 0l1.2-1.73a.7.7 0 0 1 1.12-.04l1.2 1.73a.7.7 0 0 0 1.16 0l1.2-1.73a.7.7 0 0 1 1.12-.04l1.4 1.74c.35.43 1.05.18 1.05-.37V12a9 9 0 0 0-9-9Z"
      />
      <circle cx="9" cy="11" r="1.6" fill="#fff" />
      <circle cx="15" cy="11" r="1.6" fill="#fff" />
    </svg>
  );
}

function IconTelegram() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill="oklch(0.70 0.12 230)" />
      <path d="M5.5 11.2 L16 7 L14 16 L10.5 13.5 L9.5 15.5 L8.5 13 L5.5 11.2 Z" fill="var(--ink-0)" />
    </svg>
  );
}

function IconDiscord() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="2" y="4" width="18" height="14" rx="4" fill="oklch(0.60 0.17 275)" />
      <circle cx="8" cy="11" r="1.6" fill="var(--paper)" />
      <circle cx="14" cy="11" r="1.6" fill="var(--paper)" />
      <path d="M6 15 Q11 17 16 15" stroke="var(--paper)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function IconEmail() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="2" y="5" width="18" height="12" rx="3" fill="none" stroke="var(--paper-2)" strokeWidth="1.4" />
      <path d="M2 8 L11 13 L20 8" stroke="var(--paper-2)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
