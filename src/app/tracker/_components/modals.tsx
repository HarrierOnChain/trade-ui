"use client";
/**
 * Tracker modals — track wallet + edit notes.
 *
 * The AddXHandleModal for X handles is already provided by
 * components/XTrackerColumn/AddXHandleModal and reused unchanged.
 */

import React, { useEffect, useState } from "react";
import { Modal } from "../../../components/atoms";
import { Btn } from "../../../components/atoms";
import {
  Field, ModalNote, ModalShell, TextInput, shortAddr,
} from "../../portfolio/_components/atoms";
import { isSolAddress } from "../../../lib/trackerWallets";
import type { TrackedWallet } from "../../../hooks/useTrackerStream";

/* ── Track wallet ────────────────────────────────────────────────────── */

export function TrackWalletModal({
  open, onClose, onSubmit, existing,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (args: { address: string; label: string; note: string }) => void;
  existing: TrackedWallet[];
}) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setAddress(""); setLabel(""); setNote(""); setErr(null); }
  }, [open]);

  function submit() {
    const addr = address.trim();
    if (!isSolAddress(addr)) {
      setErr("That doesn't look like a Solana address.");
      return;
    }
    if (existing.some((w) => w.address === addr)) {
      setErr(`Already tracking ${shortAddr(addr, 6)}.`);
      return;
    }
    onSubmit({ address: addr, label: label.trim(), note: note.trim() });
  }

  return (
    <Modal open={open} onClose={onClose} width={480}>
      <ModalShell
        title="Track a wallet"
        onClose={onClose}
        footer={
          <>
            <Btn size="sm" tone="ghost"   onClick={onClose}>Cancel</Btn>
            <Btn size="sm" tone="primary" onClick={submit} disabled={!address.trim()}>Track wallet</Btn>
          </>
        }
      >
        <ModalNote>
          Subscribes to the wallet&apos;s trades over the Raze WebSocket. Every
          buy and sell streams into your alert feed in real time. To track your
          own wallets, manage them from Portfolio instead.
        </ModalNote>
        <Field
          label="Solana address"
          error={err && err.toLowerCase().includes("address") ? err : undefined}
        >
          <TextInput
            value={address}
            onChange={(v) => { setAddress(v); setErr(null); }}
            placeholder="Paste a wallet address"
            mono autoFocus
          />
        </Field>
        <Field label="Label" hint="Shown in the alert feed and the wallet list.">
          <TextInput value={label} onChange={setLabel} placeholder="e.g. Whale 01 · Sniper alpha" />
        </Field>
        <Field label="Note (optional)" hint="Private — only you see it.">
          <TextInput value={note} onChange={setNote} placeholder="What's this wallet known for?" multiline rows={3} />
        </Field>
        {err && !err.toLowerCase().includes("address") && (
          <div style={{
            padding: "10px 12px", borderRadius: 8,
            background: "var(--sell-w)",
            border: "1px solid color-mix(in oklch, var(--sell) 40%, transparent)",
            color: "var(--sell)", fontSize: 12, lineHeight: 1.45,
          }}>{err}</div>
        )}
      </ModalShell>
    </Modal>
  );
}

/* ── Edit note ───────────────────────────────────────────────────────── */

export function EditNoteModal({
  wallet, currentNote, onClose, onSubmit,
}: {
  wallet: TrackedWallet | null;
  currentNote: string;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState(currentNote);

  useEffect(() => { setNote(currentNote); }, [wallet, currentNote]);

  return (
    <Modal open={!!wallet} onClose={onClose} width={440}>
      {wallet && (
        <ModalShell
          title="Edit note"
          onClose={onClose}
          footer={
            <>
              <Btn size="sm" tone="ghost" onClick={onClose}>Cancel</Btn>
              <Btn size="sm" tone="primary" onClick={() => onSubmit(note)}>Save</Btn>
            </>
          }
        >
          <ModalNote>
            Private annotation on <strong>{wallet.label}</strong>{" "}
            <span className="mono" style={{ fontSize: 11 }}>({shortAddr(wallet.address, 6)})</span>.
            Notes stay in this browser.
          </ModalNote>
          <Field label="Note">
            <TextInput
              value={note} onChange={setNote}
              placeholder="What's this wallet known for?"
              multiline rows={4} autoFocus
            />
          </Field>
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Confirm remove ──────────────────────────────────────────────────── */

export function RemoveWalletModal({
  wallet, onClose, onSubmit,
}: {
  wallet: TrackedWallet | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal open={!!wallet} onClose={onClose} width={420}>
      {wallet && (
        <ModalShell
          title="Stop tracking this wallet?"
          onClose={onClose}
          footer={
            <>
              <Btn size="sm" tone="ghost" onClick={onClose}>Cancel</Btn>
              <Btn size="sm" tone="sell" onClick={onSubmit}>Stop tracking</Btn>
            </>
          }
        >
          <ModalNote>
            Removes <strong>{wallet.label}</strong>{" "}
            <span className="mono" style={{ fontSize: 11 }}>({shortAddr(wallet.address, 6)})</span>{" "}
            from your watchlist and unsubscribes from its trade stream.
            Your note and preferences for this wallet are dropped.
          </ModalNote>
        </ModalShell>
      )}
    </Modal>
  );
}
