"use client";
/**
 * The lock's settings: when it locks by itself, the password, the recovery
 * key, lock now. Shown from the Portfolio page and in Settings → Security.
 */
import React, { useEffect, useState } from "react";
import { Icon } from "../atoms";
import { useApp } from "../../contexts/AppContext";
import { AUTO_LOCK_EVENT, lockNow } from "../shell/LockGate";
import { ApiError, auth, type RuntimeConfig } from "../../lib/vault/client";
import { RecoveryKeyView } from "./RecoveryKey";

export function autoLockLabel(m: number): string {
  if (m === 0) return "Never";
  if (m < 60) return `After ${m} minutes idle`;
  return `After ${m / 60} hour${m === 60 ? "" : "s"} idle`;
}

const field: React.CSSProperties = {
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--paper)",
  fontSize: 12.5,
  outline: "none",
  minWidth: 0,
};

function Line({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between",
      gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line-soft)",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 200, flex: "1 1 240px" }}>
        <span style={{ fontSize: 12.5, color: "var(--paper)" }}>{label}</span>
        {hint && <span style={{ fontSize: 11.5, color: "var(--paper-4)", lineHeight: 1.45 }}>{hint}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

export function SecurityPanel({ config, onConfig }: {
  config: RuntimeConfig | null;
  onConfig?: (c: RuntimeConfig) => void;
}) {
  const { pushToast } = useApp();
  const [minutes, setMinutes] = useState<number | null>(config?.autoLockMinutes ?? null);
  const [saving, setSaving] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [rkOpen, setRkOpen] = useState(false);
  // A new key on screen: the old one is already retired, so no closing it unsaved.
  const [rkShown, setRkShown] = useState(false);
  const noRecovery = config?.recoveryKeySet === false;

  useEffect(() => {
    if (config) setMinutes(config.autoLockMinutes);
  }, [config]);

  async function changeAutoLock(m: number) {
    const before = minutes;
    setMinutes(m);
    setSaving(true);
    try {
      await auth.setAutoLock(m);
      window.dispatchEvent(new CustomEvent(AUTO_LOCK_EVENT, { detail: m }));
      if (config) onConfig?.({ ...config, autoLockMinutes: m });
      pushToast({ title: "AUTO-LOCK", body: autoLockLabel(m), tone: "buy" });
    } catch (e) {
      setMinutes(before);
      pushToast({ title: "NOT SAVED", body: e instanceof Error ? e.message : String(e), tone: "sell" });
    } finally {
      setSaving(false);
    }
  }

  const choices = config?.autoLockChoices ?? [0, 5, 15, 30, 60, 240];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Line label="Lock automatically" hint="With no click or key press for this long, Trade UI locks itself, on every device.">
        <select
          value={minutes ?? ""}
          disabled={minutes === null || saving}
          onChange={(e) => void changeAutoLock(Number(e.target.value))}
          style={{ ...field, cursor: "pointer" }}
        >
          {choices.map((m) => <option key={m} value={m}>{autoLockLabel(m)}</option>)}
        </select>
      </Line>
      <Line label="Password" hint="A new password for the vault; the recovery key keeps working. Other devices are signed out.">
        <button type="button" onClick={() => setPwOpen((v) => !v)} style={ghostBtn}>
          {Icon.key(12)} {pwOpen ? "Cancel" : "Change password"}
        </button>
      </Line>
      {pwOpen && <ChangePassword onDone={() => setPwOpen(false)} />}
      <Line
        label="Recovery key"
        hint={noRecovery
          ? <span style={{ color: "var(--warn)" }}>None yet: if you forget the password, these wallets are lost. Make one and write it down.</span>
          : "Replaces a forgotten password (lock screen → Forgot your password?). A new one retires the old one."}
      >
        {!rkShown && (
          <button type="button" onClick={() => setRkOpen((v) => !v)} style={noRecovery && !rkOpen
            ? { ...ghostBtn, borderColor: "color-mix(in oklch, var(--warn) 60%, transparent)", color: "var(--warn)" }
            : ghostBtn}>
            {Icon.shield(12)} {rkOpen ? "Cancel" : noRecovery ? "Make a recovery key" : "New recovery key"}
          </button>
        )}
      </Line>
      {rkOpen && (
        <NewRecoveryKey
          replacing={!noRecovery}
          onShown={() => {
            setRkShown(true);
            if (config) onConfig?.({ ...config, recoveryKeySet: true });
          }}
          onDone={() => { setRkOpen(false); setRkShown(false); }}
        />
      )}
      <Line label="Lock now" hint="Forgets the key: every open Trade UI goes back to the lock screen.">
        <button type="button" onClick={() => void lockNow()} style={{ ...ghostBtn, borderColor: "color-mix(in oklch, var(--sell) 60%, transparent)", color: "var(--sell)" }}>
          {Icon.lock(12)} Lock
        </button>
      </Line>
      {config && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 0", borderBottom: "1px solid var(--line-soft)", minWidth: 0 }}>
          <span style={{ fontSize: 12.5, color: "var(--paper)" }}>Vault file</span>
          <span style={{ fontSize: 11.5, color: "var(--paper-4)", lineHeight: 1.45 }}>
            Encrypted (AES-256-GCM): it opens with your password or your recovery key, and is useless
            without one of them. Back it up.
          </span>
          <code className="mono" style={{
            fontSize: 11, color: "var(--paper-2)", background: "var(--ink-0)", border: "1px solid var(--line-soft)",
            borderRadius: 6, padding: "6px 8px", wordBreak: "break-all", lineHeight: 1.45,
          }}>{config.vaultFile}</code>
        </div>
      )}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "7px 12px", borderRadius: 8,
  background: "transparent", border: "1px solid var(--line)",
  color: "var(--paper)", fontSize: 12, cursor: "pointer",
};

function ChangePassword({ onDone }: { onDone: () => void }) {
  const { pushToast } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = current.length > 0 && [...next].length >= 8 && next === again;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.changePassword(current, next);
      pushToast({ title: "PASSWORD CHANGED", body: "The vault now opens with the new password. Your recovery key still works.", tone: "buy" });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "bad_password" ? "The current password is wrong." : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{
      display: "grid", gap: 10, padding: "12px 0 14px", borderBottom: "1px solid var(--line-soft)",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "end",
    }}>
      <PwField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
      <PwField label="New password" value={next} onChange={setNext} autoComplete="new-password" />
      <PwField label="Repeat the new one" value={again} onChange={setAgain} autoComplete="new-password" />
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="submit" disabled={!ok || busy} style={{
          ...ghostBtn, background: ok ? "var(--accent)" : "var(--ink-2)", color: ok ? "var(--ink-0)" : "var(--paper-3)",
          border: 0, fontWeight: 600, cursor: ok && !busy ? "pointer" : "not-allowed",
        }}>{busy ? "Re-encrypting…" : "Change password"}</button>
        {next && [...next].length < 8 && <span style={{ fontSize: 11.5, color: "var(--paper-4)" }}>At least 8 characters.</span>}
        {again && next !== again && <span style={{ fontSize: 11.5, color: "var(--sell)" }}>The new passwords differ.</span>}
        {error && <span style={{ fontSize: 11.5, color: "var(--sell)" }}>{error}</span>}
      </div>
    </form>
  );
}

function NewRecoveryKey({ replacing, onShown, onDone }: {
  replacing: boolean; onShown: () => void; onDone: () => void;
}) {
  const { pushToast } = useApp();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await auth.newRecoveryKey(password);
      setPassword("");
      setKey(r.recoveryKey);
      onShown();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "bad_password" ? "Wrong password." : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (key) {
    return (
      <div style={{ padding: "12px 0 14px", borderBottom: "1px solid var(--line-soft)" }}>
        <RecoveryKeyView recoveryKey={key} confirmLabel="Done" onConfirmed={() => {
          pushToast({
            title: "RECOVERY KEY SAVED",
            body: replacing ? "The previous recovery key no longer works." : "A forgotten password can now be replaced.",
            tone: "buy",
          });
          onDone();
        }} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{
      display: "grid", gap: 10, padding: "12px 0 14px", borderBottom: "1px solid var(--line-soft)",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "end",
    }}>
      <PwField label="Your password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="submit" disabled={!password || busy} style={{
          ...ghostBtn, background: password ? "var(--accent)" : "var(--ink-2)", color: password ? "var(--ink-0)" : "var(--paper-3)",
          border: 0, fontWeight: 600, cursor: password && !busy ? "pointer" : "not-allowed",
        }}>{busy ? "Making it…" : "Show a new recovery key"}</button>
        {replacing && <span style={{ fontSize: 11.5, color: "var(--paper-4)" }}>The current recovery key stops working.</span>}
        {error && <span style={{ fontSize: 11.5, color: "var(--sell)" }}>{error}</span>}
      </div>
    </form>
  );
}

function PwField({ label, value, onChange, autoComplete, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password"; autoFocus?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="eyebrow" style={{ color: "var(--paper-3)" }}>{label}</span>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete} autoFocus={autoFocus} spellCheck={false} style={field} />
    </label>
  );
}

/** Where this Trade UI's data comes from, read-only: the key stays on the server. */
export function ConnectionPanel({ config }: { config: RuntimeConfig | null }) {
  if (!config) return <span style={{ fontSize: 12, color: "var(--paper-3)" }}>Loading…</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Line label="Market-data API" hint="RAZE_API_BASE on the server.">
        <code className="mono" style={{ fontSize: 11.5, color: "var(--paper-2)" }}>{config.apiBase}</code>
      </Line>
      <Line label="Raze API key" hint={config.desktop
        ? "Kept in the desktop app's configuration. Change it from the app menu: Trade UI → Settings…"
        : "RAZE_API_KEY in the server's environment or .env. The browser never sees it."}>
        <span className="mono" style={{ fontSize: 11.5, color: config.apiKeyConfigured ? "var(--buy)" : "var(--sell)" }}>
          {config.apiKeyConfigured ? "configured" : "missing"}
        </span>
      </Line>
      <Line label="Swap router" hint="RAZE_ROUTER_BASE: quotes and builds Solana swaps.">
        <code className="mono" style={{ fontSize: 11.5, color: "var(--paper-2)" }}>{config.routerBase}</code>
      </Line>
      <Line label="Solana RPC" hint="SOLANA_RPC_URL: sends and confirms. Only its host is shown here.">
        <code className="mono" style={{ fontSize: 11.5, color: "var(--paper-2)" }}>{config.rpcHost || "—"}</code>
      </Line>
      <Line label="Version">
        <code className="mono" style={{ fontSize: 11.5, color: "var(--paper-3)" }}>{config.version}</code>
      </Line>
    </div>
  );
}
