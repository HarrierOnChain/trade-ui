"use client";
// Modal for adding an X handle. The handle can either be standalone (a
// pure follow that lives under UserXTrack) or attached to one of the
// user's existing wallets — the wallet selector defaults to "no wallet"
// and lists each Platform/Phantom wallet by label.

import React, { useState } from "react";
import { Modal, Btn, Icon, ModalHeader, ModalFooter } from "../atoms";
import { useXTracker } from "../../hooks/useXTracker";
import { useUserWallets } from "../../hooks/useUserWallets";

const NO_WALLET = "";

export function AddXHandleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { add } = useXTracker();
  const { wallets } = useUserWallets();
  const [username, setUsername] = useState("");
  const [walletId, setWalletId] = useState<string>(NO_WALLET);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setUsername("");
    setWalletId(NO_WALLET);
    setError(null);
    setBusy(false);
  };

  const submit = async () => {
    const cleaned = username.replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(cleaned)) {
      setError("Enter a valid X username (letters, digits, underscores, max 15).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await add(cleaned, walletId === NO_WALLET ? undefined : walletId);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} width={420}>
      <ModalHeader title="Track an X handle" icon={Icon.x(15)} onClose={() => { reset(); onClose(); }} />
      <div style={{ padding: "16px 20px", background: "var(--ink-1)" }}>
        <label style={{ display: "block", fontSize: 11, color: "var(--paper-3)", marginBottom: 4 }}>
          X username
        </label>
        <div style={{
          display: "flex", alignItems: "center",
          border: "1px solid var(--line-soft)",
          borderRadius: 6, padding: "0 10px",
          marginBottom: 14,
          background: "var(--ink-0)",
        }}>
          <span style={{ color: "var(--paper-4)", marginRight: 4 }}>@</span>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="elonmusk"
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) submit(); }}
            style={{
              flex: 1, padding: "9px 0",
              background: "transparent", border: "none", outline: "none",
              color: "var(--paper)", fontSize: 13,
            }}
          />
        </div>

        <label style={{ display: "block", fontSize: 11, color: "var(--paper-3)", marginBottom: 4 }}>
          Associate with wallet (optional)
        </label>
        <select
          value={walletId}
          onChange={(e) => setWalletId(e.target.value)}
          style={{
            width: "100%", padding: "9px 10px",
            background: "var(--ink-0)", color: "var(--paper)",
            border: "1px solid var(--line-soft)", borderRadius: 6,
            fontSize: 13, marginBottom: 14, outline: "none",
          }}
        >
          <option value={NO_WALLET}>— No wallet (just track) —</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.displayLabel} · {w.pubkey.slice(0, 4)}…{w.pubkey.slice(-4)}
            </option>
          ))}
        </select>

        <div style={{ fontSize: 10, color: "var(--paper-4)", marginBottom: 14, lineHeight: 1.4 }}>
          With a wallet: the handle stays attached so you can see "this dev's
          twitter" alongside the wallet's trades. Without: pure follow.
        </div>

        {error && (
          <div style={{
            fontSize: 11, color: "var(--sell)",
            background: "var(--sell-w)", padding: "6px 10px",
            borderRadius: 4,
          }}>{error}</div>
        )}
      </div>
      <ModalFooter>
        <Btn size="sm" onClick={() => { reset(); onClose(); }}>Cancel</Btn>
        <Btn size="sm" tone="primary" onClick={submit} disabled={busy || !username.trim()}>
          {busy ? "Adding…" : "Track"}
        </Btn>
      </ModalFooter>
    </Modal>
  );
}
