"use client";
/**
 * The recovery key, shown once: when the vault is made, and when a new one is
 * made from Security. Like a hardware wallet's recovery sheet: written down,
 * then one group typed back to show it was.
 *
 * Works outside the app's providers (the lock screen shows it before the app
 * mounts), so it reports copies itself rather than through toasts.
 */
import React, { useMemo, useState } from "react";
import { Icon } from "../atoms";

/** As the server reads it: any case, no separators, O for 0, I or L for 1. */
function normalizeGroup(text: string): string {
  return text.toUpperCase().replace(/[\s-]+/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

const smallBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  padding: "7px 12px", borderRadius: 8,
  background: "transparent", border: "1px solid var(--line)",
  color: "var(--paper)", fontSize: 12, cursor: "pointer",
};

export function RecoveryKeyView({ recoveryKey, onConfirmed, confirmLabel = "Continue", busy = false }: {
  recoveryKey: string;
  onConfirmed: () => void;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const groups = useMemo(() => recoveryKey.split("-"), [recoveryKey]);
  // One group to type back, picked at random so it has to be read from the copy.
  const ask = useMemo(() => Math.floor(Math.random() * groups.length), [groups.length]);
  const [typed, setTyped] = useState("");
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const matches = normalizeGroup(typed) === groups[ask];
  const ready = saved && matches && !busy;

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setNote("Copied. Paste it somewhere offline, then copy something else over it.");
    } catch {
      setNote("Copy is not available here: write it down from the screen.");
    }
  }

  function download() {
    const text = [
      "Trade UI recovery key",
      "",
      recoveryKey,
      "",
      "If you forget your Trade UI password: on the lock screen choose",
      "\"Forgot your password?\" and enter this key to set a new one.",
      "Your wallets stay as they are.",
      "",
      "Keep it offline. Together with access to your Trade UI, it opens your wallets.",
      `Made ${new Date().toISOString().slice(0, 10)} for ${window.location.host}.`,
      "",
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = "trade-ui-recovery-key.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1_000);
    setNote("Saved as trade-ui-recovery-key.txt. Move it somewhere offline: a USB key, a printout.");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        aria-label="Recovery key"
        style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6,
          padding: 10, borderRadius: 10, background: "var(--ink-0)", border: "1px solid var(--line-soft)",
        }}
      >
        {groups.map((g, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "baseline", gap: 6, padding: "8px 8px",
            borderRadius: 7, background: "var(--ink-1)", border: "1px solid var(--line-soft)",
          }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", minWidth: 10 }}>{i + 1}</span>
            <span className="mono" style={{ fontSize: 15, letterSpacing: "0.12em", color: "var(--paper)" }}>{g}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => void copy()} style={smallBtn}>{Icon.copy(12)} Copy</button>
        <button type="button" onClick={download} style={smallBtn}>{Icon.key(12)} Save as a file</button>
      </div>
      {note && <span style={{ fontSize: 11.5, color: "var(--paper-3)", lineHeight: 1.45, marginTop: -6 }}>{note}</span>}

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, color: "var(--paper-2)", lineHeight: 1.5, cursor: "pointer" }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)}
          style={{ marginTop: 3, accentColor: "var(--accent)" }} />
        <span>
          I wrote it down or saved it offline. It is shown only now; with it, a forgotten password can be
          replaced. Anyone holding it and reaching this Trade UI can do the same.
        </span>
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="recovery-confirm" className="eyebrow" style={{ color: "var(--paper-3)" }}>
          To check, type group {ask + 1}
        </label>
        <input
          id="recovery-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          maxLength={8}
          spellCheck={false}
          autoComplete="off"
          className="mono"
          placeholder="XXXX"
          style={{
            background: "var(--ink-0)", borderRadius: 10, outline: "none",
            border: `1px solid ${typed.length >= 4 && !matches ? "var(--sell)" : matches ? "var(--buy)" : "var(--line)"}`,
            color: "var(--paper)", padding: "10px 14px", fontSize: 15, letterSpacing: "0.12em", width: 140,
          }}
        />
      </div>

      <button
        type="button"
        disabled={!ready}
        onClick={onConfirmed}
        style={{
          height: 44, borderRadius: 10, border: 0,
          background: ready ? "var(--accent)" : "var(--ink-2)",
          color: ready ? "var(--ink-0)" : "var(--paper-4)",
          fontWeight: 650, fontSize: 14, cursor: ready ? "pointer" : "not-allowed",
        }}
      >{confirmLabel}</button>
    </div>
  );
}
