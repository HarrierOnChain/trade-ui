"use client";
/**
 * LockGate — nothing of the app mounts until this browser is unlocked.
 *
 * Like a hardware wallet: the first run asks for a password (and the setup
 * code the server printed, so nobody else can claim a fresh install), then
 * shows the recovery key once; every later visit asks for the password again,
 * and a forgotten one is replaced with the recovery key. The password unlocks
 * the encrypted vault on the server and gives this browser a session. When
 * the vault locks — by hand, after the idle delay, from another tab, on a
 * restart — the page reloads to this screen: nothing stays in memory behind it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../atoms";
import { ApiError, LOCKED_EVENT, announceLocked, auth, type AuthStatus } from "../../lib/vault/client";
import { RecoveryKeyView } from "../vault/RecoveryKey";

/** Fired with the new delay (minutes) when the auto-lock setting changes. */
export const AUTO_LOCK_EVENT = "trade-ui:auto-lock";

type Phase =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "setup"; status: AuthStatus }
  | { kind: "recovery-key"; recoveryKey: string }
  | { kind: "locked"; status: AuthStatus }
  | { kind: "recover"; status: AuthStatus }
  | { kind: "unlocked"; status: AuthStatus };

export function LockGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const status = await auth.status();
      if (!status.initialized) setPhase({ kind: "setup", status });
      else if (!status.unlocked) setPhase({ kind: "locked", status });
      else setPhase({ kind: "unlocked", status });
    } catch {
      setPhase({ kind: "offline" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase.kind === "unlocked") {
    return (
      <>
        <LockWatch initialMinutes={phase.status.autoLockMinutes ?? 0} />
        {!phase.status.apiKeyConfigured && <MissingKeyNote desktop={phase.status.desktop} />}
        {children}
      </>
    );
  }

  // Drop `?setup=` from the address bar once it has been used.
  const dropSetupCode = () => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("setup")) {
        u.searchParams.delete("setup");
        window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
      }
    } catch { /* ignore */ }
  };
  const unlocked = async () => {
    dropSetupCode();
    await load();
  };

  return (
    <LockFrame>
      {phase.kind === "loading" && <Spinner />}
      {phase.kind === "offline" && <Offline onRetry={load} />}
      {phase.kind === "setup" && (
        <SetupCard status={phase.status} onCreated={(recoveryKey) => {
          dropSetupCode();
          setPhase({ kind: "recovery-key", recoveryKey });
        }} />
      )}
      {phase.kind === "recovery-key" && (
        <Card eyebrow="Recovery key" title="Write it down">
          <Display
            icon={Icon.key(16)}
            line="Shown once"
            sub="If you forget your password, this key sets a new one and your wallets stay. Lost both? The wallets are gone."
          />
          <RecoveryKeyView recoveryKey={phase.recoveryKey} onConfirmed={() => void unlocked()} confirmLabel="Open Trade UI" />
        </Card>
      )}
      {phase.kind === "locked" && (
        <UnlockCard status={phase.status} onDone={unlocked} onForgot={() => setPhase({ kind: "recover", status: phase.status })} />
      )}
      {phase.kind === "recover" && <RecoverCard status={phase.status} onDone={unlocked} onBack={() => void load()} />}
    </LockFrame>
  );
}

/* ── while unlocked ───────────────────────────────────────────────────── */

function isOurApi(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, window.location.href);
    return u.origin === window.location.origin && u.pathname.includes("/api/");
  } catch {
    return false;
  }
}

/**
 * Notices when the vault locks and takes the page back to the lock screen;
 * tells the server the user is here (input, at most twice a minute) so the
 * idle lock counts real activity, not background data.
 */
function LockWatch({ initialMinutes }: { initialMinutes: number }) {
  const minutes = useRef(initialMinutes);

  useEffect(() => {
    let reloading = false;
    const toLockScreen = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    // Any `locked` answer from this server, whoever made the call.
    type Wrapped = typeof fetch & { __tradeUiLockWatch?: true };
    const original = window.fetch as Wrapped;
    if (!original.__tradeUiLockWatch) {
      const wrapped: Wrapped = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const res = await original(input, init);
          if (res.status === 401 && isOurApi(input)) {
            res.clone().json()
              .then((j: { error?: { code?: string } }) => { if (j?.error?.code === "locked") announceLocked(); })
              .catch(() => {});
          }
          return res;
        },
        { __tradeUiLockWatch: true as const },
      );
      window.fetch = wrapped;
    }

    let lastInput = Date.now();
    let lastPing = Date.now();
    const onInput = () => {
      lastInput = Date.now();
      if (lastInput - lastPing < 30_000) return;
      lastPing = lastInput;
      void auth.activity().catch(() => {});
    };
    const inputs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const ev of inputs) window.addEventListener(ev, onInput, { capture: true, passive: true });

    const check = () => {
      if (document.visibilityState !== "visible") return;
      void auth.status().then((s) => { if (!s.unlocked) toLockScreen(); }).catch(() => {});
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener(LOCKED_EVENT, toLockScreen);

    // The server locks on its own after the idle delay; look once it has passed.
    const idle = window.setInterval(() => {
      const m = minutes.current;
      if (m > 0 && Date.now() - lastInput > m * 60_000 + 5_000) check();
    }, 15_000);

    const onAutoLock = (e: Event) => {
      const m = (e as CustomEvent<number>).detail;
      if (typeof m === "number") minutes.current = m;
    };
    window.addEventListener(AUTO_LOCK_EVENT, onAutoLock);

    // For the desktop app's menu.
    (window as unknown as { __tradeUiLock?: () => void }).__tradeUiLock = () => {
      void auth.lock().catch(() => {}).finally(toLockScreen);
    };

    // An older Trade UI kept the API key in this browser; it lives on the server now.
    try { window.localStorage.removeItem("trade-ui.api.v1"); } catch { /* ignore */ }

    return () => {
      for (const ev of inputs) window.removeEventListener(ev, onInput, { capture: true });
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener(LOCKED_EVENT, toLockScreen);
      window.removeEventListener(AUTO_LOCK_EVENT, onAutoLock);
      window.clearInterval(idle);
    };
  }, []);

  return null;
}

/** Lock now, everywhere, and show the lock screen. */
export async function lockNow(): Promise<void> {
  try {
    await auth.lock();
  } finally {
    window.location.reload();
  }
}

function MissingKeyNote({ desktop }: { desktop: boolean }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div role="status" style={{
      position: "fixed", left: "50%", bottom: 40, transform: "translateX(-50%)", zIndex: 1000,
      display: "flex", alignItems: "center", gap: 12, maxWidth: "min(640px, calc(100vw - 32px))",
      padding: "10px 12px 10px 14px", borderRadius: 10,
      background: "color-mix(in oklch, var(--sell) 14%, var(--ink-1))",
      border: "1px solid color-mix(in oklch, var(--sell) 55%, transparent)",
      color: "var(--paper)", fontSize: 12, lineHeight: 1.45,
      boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
    }}>
      <span style={{ color: "var(--sell)", flexShrink: 0, display: "inline-flex" }}>{Icon.key(15)}</span>
      <span>
        No Raze API key on this server, so market data and swaps are refused.{" "}
        {desktop
          ? "Open Trade UI → Settings… → Raze API key."
          : <>Set <code className="mono">RAZE_API_KEY</code> in <code className="mono">.env</code> and restart.</>}
      </span>
      <button type="button" onClick={() => setOpen(false)} aria-label="Dismiss" style={{
        background: "transparent", border: 0, color: "var(--paper-3)", cursor: "pointer",
        display: "inline-flex", padding: 4, flexShrink: 0,
      }}>{Icon.close(12)}</button>
    </div>
  );
}

/* ── the lock screen ──────────────────────────────────────────────────── */

function LockFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50, overflow: "auto",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "32px 16px",
      background: "var(--ink-0)", color: "var(--paper)",
      backgroundImage:
        "radial-gradient(ellipse 70% 55% at 50% 35%, color-mix(in oklch, var(--accent) 7%, transparent), transparent 70%), "
        + "linear-gradient(to right, color-mix(in oklch, var(--paper) 3.5%, transparent) 1px, transparent 1px), "
        + "linear-gradient(to bottom, color-mix(in oklch, var(--paper) 3.5%, transparent) 1px, transparent 1px)",
      backgroundSize: "auto, 40px 40px, 40px 40px",
      backgroundPosition: "center, center, center",
    }}>
      <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 14 }}>
        <InsecureWarning />
        {children}
      </div>
    </div>
  );
}

/** Plain HTTP to anything but this machine: the password would travel readable. */
function InsecureWarning() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const h = window.location.hostname;
    const local = h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
    setShow(window.location.protocol === "http:" && !local);
  }, []);
  if (!show) return null;
  return (
    <div role="alert" style={{
      padding: "10px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.5,
      background: "color-mix(in oklch, var(--sell) 12%, var(--ink-1))",
      border: "1px solid color-mix(in oklch, var(--sell) 60%, transparent)",
    }}>
      <strong style={{ color: "var(--sell)" }}>Not encrypted.</strong>{" "}
      This page is served over plain HTTP, so your password would cross the network readable.
      Put Trade UI behind HTTPS before you unlock it from another machine.
    </div>
  );
}

function Card({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--ink-1)", border: "1px solid var(--line-soft)", borderRadius: 16,
      padding: 24, display: "flex", flexDirection: "column", gap: 18,
      boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src="/logo/raze.svg" alt="" width={34} height={34} draggable={false} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="eyebrow" style={{ color: "var(--accent)" }}>{eyebrow}</span>
          <span className="ser" style={{ fontSize: 24, fontStyle: "italic", lineHeight: 1.1, letterSpacing: "-0.02em" }}>{title}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

/** The device "screen": what state the vault is in. */
function Display({ icon, line, sub, tone = "default" }: {
  icon: React.ReactNode; line: string; sub?: React.ReactNode; tone?: "default" | "warn";
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 14px", borderRadius: 10,
      background: "var(--ink-0)",
      border: `1px solid ${tone === "warn" ? "color-mix(in oklch, var(--sell) 50%, transparent)" : "var(--line-soft)"}`,
      boxShadow: "inset 0 1px 0 color-mix(in oklch, var(--paper) 4%, transparent)",
    }}>
      <span style={{
        width: 34, height: 34, borderRadius: 8, flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: tone === "warn" ? "var(--sell)" : "var(--accent)",
        background: tone === "warn"
          ? "color-mix(in oklch, var(--sell) 12%, transparent)"
          : "color-mix(in oklch, var(--accent) 12%, transparent)",
      }}>{icon}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--paper)" }}>{line}</span>
        {sub && <span style={{ fontSize: 11.5, color: "var(--paper-3)", lineHeight: 1.4 }}>{sub}</span>}
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, label, autoFocus, autoComplete, disabled, invalid }: {
  value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean;
  autoComplete: "current-password" | "new-password"; disabled?: boolean; invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useMemo(() => `pw-${label.replace(/\W+/g, "-").toLowerCase()}`, [label]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={id} className="eyebrow" style={{ color: "var(--paper-3)" }}>{label}</label>
      <div style={{
        display: "flex", alignItems: "center",
        background: "var(--ink-0)", borderRadius: 10,
        border: `1px solid ${invalid ? "var(--sell)" : "var(--line)"}`,
      }}>
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          spellCheck={false}
          disabled={disabled}
          style={{
            flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none",
            color: "var(--paper)", padding: "12px 14px", fontSize: 15, letterSpacing: visible ? 0 : "0.12em",
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          style={{
            background: "transparent", border: 0, color: "var(--paper-3)", cursor: "pointer",
            padding: "0 12px", alignSelf: "stretch", display: "inline-flex", alignItems: "center",
          }}
        >{visible ? Icon.eyeOff(15) : Icon.eye(15)}</button>
      </div>
    </div>
  );
}

function PrimaryButton({ children, disabled, busy }: { children: React.ReactNode; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled || busy}
      style={{
        height: 44, borderRadius: 10, border: 0,
        background: disabled ? "var(--ink-2)" : "var(--accent)",
        color: disabled ? "var(--paper-4)" : "var(--ink-0)", opacity: busy ? 0.75 : 1,
        fontWeight: 650, fontSize: 14, letterSpacing: "-0.005em",
        cursor: disabled ? "not-allowed" : busy ? "wait" : "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}
    >{children}</button>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return <div role="alert" style={{ fontSize: 12.5, color: "var(--sell)", lineHeight: 1.45 }}>{children}</div>;
}

function useCountdown(initialMs: number): [number, (ms: number) => void] {
  const [until, setUntil] = useState(() => Date.now() + initialMs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= now) return;
    const t = window.setTimeout(() => setNow(Date.now()), 250);
    return () => window.clearTimeout(t);
  }, [until, now]);
  const left = Math.max(0, until - now);
  return [left, (ms: number) => { setUntil(Date.now() + ms); setNow(Date.now()); }];
}

function UnlockCard({ status, onDone, onForgot }: { status: AuthStatus; onDone: () => void; onForgot: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitMs, setWait] = useCountdown(status.retryAfterMs);
  const waiting = waitMs > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy || waiting) return;
    setBusy(true);
    setError(null);
    try {
      await auth.unlock(password);
      setPassword("");
      onDone();
    } catch (err) {
      const ae = err instanceof ApiError ? err : null;
      if (ae && (ae.code === "bad_password" || ae.code === "too_many_attempts")) {
        setError(ae.code === "bad_password" ? "Wrong password." : "Too many wrong passwords.");
        if (ae.retryAfterMs > 0) setWait(ae.retryAfterMs);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card eyebrow="Vault locked" title="Trade UI">
      <Display
        icon={Icon.lock(16)}
        line={waiting ? `Wait ${Math.ceil(waitMs / 1000)} s` : "Enter password"}
        sub={waiting
          ? "Several wrong passwords in a row: each new attempt waits longer."
          : "Your wallets are encrypted. Nothing is readable until you unlock."}
        tone={waiting ? "warn" : "default"}
      />
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PasswordInput label="Password" value={password} onChange={setPassword} autoFocus
          autoComplete="current-password" disabled={busy} invalid={!!error} />
        {error && <ErrorLine>{error}</ErrorLine>}
        <PrimaryButton disabled={!password || waiting} busy={busy}>
          {busy ? "Unlocking…" : <>{Icon.unlock(14)} Unlock</>}
        </PrimaryButton>
      </form>
      {status.recovery ? (
        <button type="button" onClick={onForgot} style={linkBtn}>Forgot your password? Use your recovery key</button>
      ) : (
        <p style={{ fontSize: 11.5, color: "var(--paper-4)", lineHeight: 1.55 }}>
          Forgot it? This vault has no recovery key, so only its password opens it. To start over, delete
          {" "}<code className="mono">vault.json</code> from the data folder and import the keys you exported.
        </p>
      )}
      {!status.apiKeyConfigured && <KeyMissingLine desktop={status.desktop} />}
    </Card>
  );
}

const linkBtn: React.CSSProperties = {
  alignSelf: "center", background: "transparent", border: 0, padding: 2,
  color: "var(--paper-3)", fontSize: 12, cursor: "pointer", textDecoration: "underline",
  textUnderlineOffset: 3,
};

function RecoverCard({ status, onDone, onBack }: { status: AuthStatus; onDone: () => void; onBack: () => void }) {
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitMs, setWait] = useCountdown(status.retryAfterMs);
  const waiting = waitMs > 0;
  const keyChars = key.replace(/[\s-]+/g, "").length;
  const ready = keyChars === 36 && newPasswordOk(password, confirm) && !waiting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.recover(key, password);
      onDone();
    } catch (err) {
      const ae = err instanceof ApiError ? err : null;
      if (ae?.code === "wrong_recovery_key") setError("That is not this vault's recovery key.");
      else if (ae?.code === "too_many_attempts") setError("Too many wrong attempts.");
      else setError(err instanceof Error ? err.message : String(err));
      if (ae && ae.retryAfterMs > 0) setWait(ae.retryAfterMs);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card eyebrow="Forgot your password" title="Recover the vault">
      <Display
        icon={Icon.key(16)}
        line={waiting ? `Wait ${Math.ceil(waitMs / 1000)} s` : "Recovery key"}
        sub={waiting
          ? "Several wrong attempts in a row: each new attempt waits longer."
          : "The key you wrote down when the vault was made. It sets a new password; your wallets stay as they are."}
        tone={waiting ? "warn" : "default"}
      />
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label htmlFor="recovery-key" className="eyebrow" style={{ color: "var(--paper-3)" }}>Recovery key</label>
          <textarea
            id="recovery-key"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            rows={2}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            className="mono"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            disabled={busy}
            style={{
              background: "var(--ink-0)", border: "1px solid var(--line)", borderRadius: 10, resize: "none",
              color: "var(--paper)", padding: "11px 14px", fontSize: 14, letterSpacing: "0.08em", outline: "none", lineHeight: 1.5,
            }}
          />
          <span style={{ fontSize: 11.5, color: "var(--paper-4)" }}>
            9 groups of 4. Dashes and spaces are optional; O and 0 are the same.
          </span>
        </div>
        <NewPasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm}
          disabled={busy} label="New password" />
        {error && <ErrorLine>{error}</ErrorLine>}
        <PrimaryButton disabled={!ready} busy={busy}>
          {busy ? "Opening the vault…" : <>{Icon.unlock(14)} Set the new password</>}
        </PrimaryButton>
      </form>
      <p style={{ fontSize: 11.5, color: "var(--paper-4)", lineHeight: 1.55 }}>
        Every other open Trade UI goes back to the lock screen and needs the new password.
        The recovery key keeps working.
      </p>
      <button type="button" onClick={onBack} style={linkBtn}>Back to the password</button>
    </Card>
  );
}

/** A rough strength meter: length first, then variety. Not a guarantee. */
function strength(p: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!p) return { score: 0, label: "" };
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  const len = [...p].length;
  let score = len >= 20 ? 4 : len >= 14 ? 3 : len >= 10 ? 2 : len >= 8 ? 1 : 0;
  if (len >= 8 && classes >= 3 && score < 4) score += 1;
  if (/^(.)\1+$/.test(p) || /^(?:password|12345678|qwertyui)/i.test(p)) score = 0;
  const s = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  return { score: s, label: ["Too weak", "Weak", "Fair", "Good", "Strong"][s] };
}

function newPasswordOk(password: string, confirm: string): boolean {
  return [...password].length >= 8 && password === confirm && strength(password).score > 0;
}

/** A new password, its strength, and the same again. */
function NewPasswordFields({ password, setPassword, confirm, setConfirm, disabled, autoFocus, label = "Password" }: {
  password: string; setPassword: (v: string) => void;
  confirm: string; setConfirm: (v: string) => void;
  disabled?: boolean; autoFocus?: boolean; label?: string;
}) {
  const st = strength(password);
  const long = [...password].length >= 8;
  const same = password === confirm;
  const meterColor = ["var(--sell)", "var(--sell)", "#e0b341", "var(--buy)", "var(--accent)"][st.score];
  return (
    <>
      <PasswordInput label={label} value={password} onChange={setPassword} autoFocus={autoFocus} autoComplete="new-password" disabled={disabled} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: -6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }} aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} style={{
              height: 4, borderRadius: 2,
              background: st.score >= i ? meterColor : "var(--line-soft)",
              transition: "background 160ms",
            }} />
          ))}
        </div>
        <span style={{ fontSize: 11.5, color: password ? meterColor : "var(--paper-4)" }}>
          {password ? `${st.label}${long ? "" : " · at least 8 characters"}` : "At least 8 characters. A long phrase is best."}
        </span>
      </div>
      <PasswordInput label="Repeat it" value={confirm} onChange={setConfirm} autoComplete="new-password"
        disabled={disabled} invalid={confirm.length > 0 && !same} />
      {confirm.length > 0 && !same && <ErrorLine>The two passwords differ.</ErrorLine>}
    </>
  );
}

function SetupCard({ status, onCreated }: { status: AuthStatus; onCreated: (recoveryKey: string) => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [codeFromLink, setCodeFromLink] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("setup");
    if (fromUrl) {
      setCode(fromUrl);
      setCodeFromLink(true);
    }
  }, []);

  const ready = newPasswordOk(password, confirm) && understood && code.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { recoveryKey } = await auth.setup(password, code.trim());
      onCreated(recoveryKey);
    } catch (err) {
      const ae = err instanceof ApiError ? err : null;
      if (ae?.code === "bad_setup_token") setCodeFromLink(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card eyebrow="First run" title="Choose a password">
      <Display
        icon={Icon.shield(16)}
        line="New vault"
        sub="This password encrypts every wallet you add, on this machine or server."
      />
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <NewPasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm}
          disabled={busy} autoFocus />

        {codeFromLink ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--paper-3)" }}>
            <span style={{ color: "var(--buy)", display: "inline-flex" }}>{Icon.check(13)}</span>
            {status.desktop ? "Setup code provided by the desktop app" : "Setup code taken from the link"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label htmlFor="setup-code" className="eyebrow" style={{ color: "var(--paper-3)" }}>Setup code</label>
            <input
              id="setup-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="mono"
              placeholder="from the server's log"
              style={{
                background: "var(--ink-0)", border: "1px solid var(--line)", borderRadius: 10,
                color: "var(--paper)", padding: "11px 14px", fontSize: 13, outline: "none",
              }}
            />
            <span style={{ fontSize: 11.5, color: "var(--paper-4)", lineHeight: 1.45 }}>
              Printed where Trade UI was started (<code className="mono">npm start</code>, the service log).
              It proves you run this server before anyone else claims it.
            </span>
          </div>
        )}

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, color: "var(--paper-2)", lineHeight: 1.5, cursor: "pointer" }}>
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)}
            style={{ marginTop: 3, accentColor: "var(--accent)" }} />
          <span>
            I understand that a forgotten password can only be replaced with the recovery key shown next:
            without both, the wallets in this vault are lost unless I exported their keys.
          </span>
        </label>

        {error && <ErrorLine>{error}</ErrorLine>}
        <PrimaryButton disabled={!ready} busy={busy}>
          {busy ? "Creating the vault…" : <>{Icon.lock(14)} Create the vault</>}
        </PrimaryButton>
      </form>
      {!status.apiKeyConfigured && <KeyMissingLine desktop={status.desktop} />}
    </Card>
  );
}

function KeyMissingLine({ desktop }: { desktop: boolean }) {
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, lineHeight: 1.5, color: "var(--paper-3)",
      paddingTop: 12, borderTop: "1px solid var(--line-soft)",
    }}>
      <span style={{ color: "var(--sell)", display: "inline-flex", marginTop: 2 }}>{Icon.key(13)}</span>
      <span>
        The server has no Raze API key yet: market data and swaps will be refused.{" "}
        {desktop ? "Set it from the app menu." : <>Put <code className="mono">RAZE_API_KEY</code> in <code className="mono">.env</code> and restart.</>}
      </span>
    </div>
  );
}

function Offline({ onRetry }: { onRetry: () => void }) {
  return (
    <Card eyebrow="No connection" title="Trade UI">
      <Display icon={Icon.refresh(16)} line="Server unreachable" sub="The Trade UI server did not answer. Is it running?" tone="warn" />
      <button type="button" onClick={onRetry} style={{
        height: 40, borderRadius: 10, border: "1px solid var(--line)", background: "transparent",
        color: "var(--paper)", cursor: "pointer", fontSize: 13,
      }}>Try again</button>
    </Card>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 40 }} aria-label="Loading">
      <svg width="22" height="22" viewBox="0 0 24 24" style={{ animation: "lockgate-spin 0.8s linear infinite" }}>
        <circle cx="12" cy="12" r="10" fill="none" stroke="var(--line)" strokeWidth="2" />
        <path d="M12 2 A10 10 0 0 1 22 12" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <style>{"@keyframes lockgate-spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
