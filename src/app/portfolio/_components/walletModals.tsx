"use client";
/**
 * The portfolio's wallet dialogs. Anything that hands out a key, moves funds
 * or throws a key away asks for the password again, the way a hardware wallet
 * asks for a confirmation on the device.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Btn, Icon, Modal } from "../../../components/atoms";
import { Field, ModalNote, ModalShell, TextInput } from "./atoms";
import { useApp } from "../../../contexts/AppContext";
import { explorerTxUrl } from "../../../lib/chains";
import { shortAddr } from "../../../lib/format";
import { confirmSignature } from "../../../lib/swap/client";
import { ApiError, vault, type ExportedKey, type ImportResult, type RuntimeConfig, type VaultWallet, type WalletFamily } from "../../../lib/vault/client";
import { SecurityPanel } from "../../../components/vault/SecurityPanel";
import { importItems, solToLamports, splitKeys } from "../../../lib/vault/keyText";

const FAMILY_LABEL: Record<WalletFamily, string> = { sol: "Solana", evm: "EVM" };

function message(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "bad_password") return "Wrong password.";
    if (e.code === "rpc") {
      // The RPC's simulation, said plainly.
      if (/AccountNotFound|no record of a prior credit/i.test(e.message)) return "This wallet has no SOL yet.";
      if (/InsufficientFunds|insufficient (funds|lamports)|"Custom":1\}/i.test(e.message)) return "Not enough SOL for this amount and the network fee.";
      if (/BlockhashNotFound|block height exceeded/i.test(e.message)) return "The transaction expired before it landed: try again.";
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

function PasswordField({ value, onChange, autoFocus = true, label = "Password" }: {
  value: string; onChange: (v: string) => void; autoFocus?: boolean; label?: string;
}) {
  return (
    <Field label={label}>
      <input
        type="password"
        value={value}
        autoFocus={autoFocus}
        autoComplete="current-password"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--ink-0)", border: "1px solid var(--line-soft)", color: "var(--paper)",
          padding: "9px 12px", borderRadius: 8, fontSize: 13, width: "100%", outline: "none",
        }}
      />
    </Field>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <div role="alert" style={{ fontSize: 12, color: "var(--sell)", lineHeight: 1.45 }}>{children}</div>;
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" style={{ display: "inline-flex", padding: 3, gap: 3, borderRadius: 8, background: "var(--ink-0)", border: "1px solid var(--line-soft)" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)} style={{
            padding: "6px 14px", borderRadius: 6, border: 0, cursor: "pointer", fontSize: 12, fontWeight: 600,
            background: on ? "var(--ink-2)" : "transparent", color: on ? "var(--paper)" : "var(--paper-3)",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

/* ── new wallet ─────────────────────────────────────────────────────────── */

export function NewWalletModal({ open, family: initialFamily, onClose, onCreated }: {
  open: boolean;
  family: WalletFamily;
  onClose: () => void;
  onCreated: (wallets: VaultWallet[]) => void;
}) {
  const { pushToast } = useApp();
  const [family, setFamily] = useState<WalletFamily>(initialFamily);
  const [label, setLabel] = useState("");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setFamily(initialFamily); setLabel(""); setCount(1); setError(null); setBusy(false); }
  }, [open, initialFamily]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await vault.generate(family, label.trim() || undefined, count);
      pushToast({
        title: created.length === 1 ? "WALLET CREATED" : "WALLETS CREATED",
        body: created.length === 1 ? shortAddr(created[0].address, 6) : `${created.length} ${FAMILY_LABEL[family]} wallets`,
        tone: "buy",
      });
      onCreated(created);
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={460}>
      <ModalShell
        title="New wallet"
        onClose={onClose}
        footer={<>
          <Btn tone="ghost" onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Creating…" : count > 1 ? `Create ${count} wallets` : "Create wallet"}
          </Btn>
        </>}
      >
        <Field label="Network">
          <Segmented value={family} onChange={setFamily} options={[{ value: "sol", label: "Solana" }, { value: "evm", label: "EVM" }]} />
        </Field>
        {family === "evm" && (
          <ModalNote>One EVM key works on Ethereum, BNB Chain, Base and Robinhood with the same address.</ModalNote>
        )}
        <Field label="Label" hint="Optional. With several wallets they are numbered: Label 1, Label 2…">
          <TextInput value={label} onChange={setLabel} placeholder={family === "sol" ? "Main, Sniper…" : "Main EVM"} autoFocus />
        </Field>
        <Field label="How many">
          <input type="number" min={1} max={20} value={count}
            onChange={(e) => setCount(Math.min(20, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
            style={{ background: "var(--ink-0)", border: "1px solid var(--line-soft)", color: "var(--paper)", padding: "9px 12px", borderRadius: 8, fontSize: 13, width: 100 }} />
        </Field>
        <ModalNote>
          The key is generated on this Trade UI&apos;s server and stored encrypted in the vault.
          Export it afterwards to keep a backup: without one, a forgotten password loses the wallet.
        </ModalNote>
        {error && <ErrorText>{error}</ErrorText>}
      </ModalShell>
    </Modal>
  );
}

/* ── import ─────────────────────────────────────────────────────────────── */

export function ImportModal({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: (r: ImportResult) => void;
}) {
  const { pushToast } = useApp();
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) { setText(""); setLabel(""); setResult(null); setError(null); setBusy(false); }
  }, [open]);

  const keys = useMemo(() => splitKeys(text), [text]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 256 * 1024) { setError("That file is too large to be a key file."); return; }
    setText(await f.text());
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    if (keys.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await vault.import(importItems(keys, label));
      setText("");
      if (r.created.length > 0) {
        pushToast({
          title: r.created.length === 1 ? "WALLET IMPORTED" : "WALLETS IMPORTED",
          body: r.created.length === 1 ? shortAddr(r.created[0].address, 6) : `${r.created.length} wallets`,
          tone: "buy",
        });
      }
      onImported(r);
      if (r.errors.length === 0) onClose();
      else setResult(r);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={520}>
      <ModalShell
        title="Import private keys"
        onClose={onClose}
        footer={<>
          <Btn tone="ghost" onClick={onClose}>{result ? "Close" : "Cancel"}</Btn>
          <Btn tone="primary" disabled={busy || keys.length === 0} onClick={() => void submit()}>
            {busy ? "Importing…" : keys.length > 1 ? `Import ${keys.length} keys` : "Import"}
          </Btn>
        </>}
      >
        <Field
          label="Private keys"
          hint={<>
            Solana: base58 (Phantom, Solflare, Backpack export) or a keypair file like <code className="mono">id.json</code>.
            EVM: the 64-character hex key. One per line for several.
          </>}
        >
          <TextInput value={text} onChange={setText} multiline rows={5} mono autoFocus
            placeholder={"5Kd3…base58…\n[12,34,…] keypair file\n0x4c08…evm hex"} />
        </Field>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: keys.length ? "var(--paper-2)" : "var(--paper-4)" }}>
            {keys.length === 0 ? "Nothing to import yet" : `${keys.length} key${keys.length === 1 ? "" : "s"} found`}
          </span>
          <label style={{ fontSize: 12, color: "var(--accent)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            {Icon.plus(11)} Load a file
            <input ref={fileRef} type="file" accept=".json,.txt,.csv,application/json,text/plain"
              onChange={(e) => void onFile(e.target.files?.[0])} style={{ display: "none" }} />
          </label>
        </div>
        <Field label="Label" hint="Optional.">
          <TextInput value={label} onChange={setLabel} placeholder="Imported" />
        </Field>
        <ModalNote>
          Seed phrases are not supported: export the account&apos;s private key from your wallet.
        </ModalNote>
        {result && result.errors.length > 0 && (
          <div style={{
            border: "1px solid color-mix(in oklch, var(--sell) 45%, transparent)", borderRadius: 8,
            padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6,
            background: "color-mix(in oklch, var(--sell) 7%, transparent)",
          }}>
            <span style={{ fontSize: 12, color: "var(--paper)" }}>
              {result.created.length} imported, {result.errors.length} not:
            </span>
            {result.errors.slice(0, 8).map((e) => (
              <span key={e.index} style={{ fontSize: 11.5, color: "var(--paper-3)" }}>
                #{e.index + 1} · {e.code === "duplicate" ? "already in the vault" : e.message}
              </span>
            ))}
            {result.errors.length > 8 && <span style={{ fontSize: 11.5, color: "var(--paper-4)" }}>… and {result.errors.length - 8} more</span>}
          </div>
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </ModalShell>
    </Modal>
  );
}

/* ── export ─────────────────────────────────────────────────────────────── */

function KeyBox({ label, value, revealed, onCopy }: {
  label: string; value: string; revealed: boolean; onCopy: () => void;
}) {
  return (
    <Field label={label}>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <div className="mono" style={{
          flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 8,
          background: "var(--ink-0)", border: "1px solid var(--line-soft)",
          fontSize: 11.5, lineHeight: 1.5, color: "var(--paper)", wordBreak: "break-all",
          maxHeight: 120, overflow: "auto",
          filter: revealed ? "none" : "blur(6px)", userSelect: revealed ? "text" : "none",
          transition: "filter 160ms",
        }}>{value}</div>
        <Btn tone="ghost" size="sm" onClick={onCopy} disabled={!revealed} style={{ height: "auto" }}>{Icon.copy(12)} Copy</Btn>
      </div>
    </Field>
  );
}

export function ExportModal({ wallet, onClose }: { wallet: VaultWallet | null; onClose: () => void }) {
  const { pushToast } = useApp();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<ExportedKey | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setPassword(""); setError(null); setKey(null); setRevealed(false); setBusy(false);
  }, [wallet]);

  // A shown key does not stay on screen.
  useEffect(() => {
    if (!key) return;
    const t = window.setTimeout(onClose, 120_000);
    return () => window.clearTimeout(t);
  }, [key, onClose]);

  async function unlockKey() {
    if (!wallet || !password) return;
    setBusy(true);
    setError(null);
    try {
      setKey(await vault.exportKey(wallet.id, password));
      setPassword("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      pushToast({ title: "KEY COPIED", body: "Paste it where it belongs, then copy something else over it.", tone: "default" });
    } catch {
      pushToast({ title: "COPY FAILED", body: "Select the text and copy it by hand.", tone: "sell" });
    }
  }

  function download(k: Extract<ExportedKey, { family: "sol" }>) {
    const blob = new Blob([k.json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${k.address}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1_000);
  }

  return (
    <Modal open={!!wallet} onClose={onClose} width={520}>
      {wallet && (
        <ModalShell
          title={`Export key · ${wallet.label || shortAddr(wallet.address, 4)}`}
          onClose={onClose}
          footer={key ? <Btn tone="ghost" onClick={onClose}>Done</Btn> : <>
            <Btn tone="ghost" onClick={onClose}>Cancel</Btn>
            <Btn tone="primary" disabled={busy || !password} onClick={() => void unlockKey()}>{busy ? "Checking…" : "Show key"}</Btn>
          </>}
        >
          <div style={{
            display: "flex", gap: 10, padding: "10px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5,
            background: "color-mix(in oklch, var(--sell) 9%, transparent)",
            border: "1px solid color-mix(in oklch, var(--sell) 40%, transparent)", color: "var(--paper-2)",
          }}>
            <span style={{ color: "var(--sell)", display: "inline-flex", marginTop: 2 }}>{Icon.key(13)}</span>
            <span>Whoever has this key controls the wallet. Never paste it into a website, a chat or a support form.</span>
          </div>
          {!key ? (
            <form onSubmit={(e) => { e.preventDefault(); void unlockKey(); }}>
              <PasswordField value={password} onChange={setPassword} label="Your password, to show the key" />
            </form>
          ) : (
            <>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--paper-3)", wordBreak: "break-all" }}>{key.address}</span>
              {key.family === "sol" ? (
                <>
                  <KeyBox label="Private key (base58) · Phantom, Solflare, Backpack" value={key.base58} revealed={revealed} onCopy={() => void copy(key.base58)} />
                  <KeyBox label="Keypair file (JSON) · solana-keygen, id.json" value={key.json} revealed={revealed} onCopy={() => void copy(key.json)} />
                </>
              ) : (
                <KeyBox label="Private key (hex) · MetaMask, Rabby" value={key.hex} revealed={revealed} onCopy={() => void copy(key.hex)} />
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn tone={revealed ? "ghost" : "primary"} size="sm" onClick={() => setRevealed((v) => !v)}>
                  {revealed ? Icon.eyeOff(12) : Icon.eye(12)} {revealed ? "Hide" : "Reveal"}
                </Btn>
                {key.family === "sol" && (
                  <Btn tone="ghost" size="sm" onClick={() => download(key)}>Download keypair file</Btn>
                )}
              </div>
              <ModalNote>This window closes by itself in two minutes.</ModalNote>
            </>
          )}
          {error && <ErrorText>{error}</ErrorText>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── send SOL ───────────────────────────────────────────────────────────── */

export function SendModal({ wallet, balanceSol, onClose, onSent }: {
  wallet: VaultWallet | null;
  /** current SOL balance, when known */
  balanceSol: number | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const { pushToast } = useApp();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "sending" | "confirming">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTo(""); setAmount(""); setMax(false); setPassword(""); setError(null); setBusy(null);
  }, [wallet]);

  const lamports = max ? null : solToLamports(amount);
  const validTo = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to.trim());
  const ready = validTo && (max || lamports !== null) && password.length > 0 && !busy;

  async function submit() {
    if (!wallet || !ready) return;
    setBusy("sending");
    setError(null);
    try {
      const r = await vault.send(wallet.id, to.trim(), max ? "max" : lamports!.toString(), password);
      setPassword("");
      setBusy("confirming");
      await confirmSignature(r.signature, 60_000);
      const sol = Number(BigInt(r.lamports)) / 1e9;
      pushToast({
        title: "SOL SENT",
        body: <a href={explorerTxUrl(r.signature, "sol")} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
          {sol.toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL → {shortAddr(to.trim(), 4)} ↗
        </a>,
        tone: "buy",
        duration: 8000,
      });
      onSent();
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={!!wallet} onClose={busy ? undefined : onClose} width={480}>
      {wallet && (
        <ModalShell
          title={`Send SOL · ${wallet.label || shortAddr(wallet.address, 4)}`}
          onClose={onClose}
          footer={<>
            <Btn tone="ghost" onClick={onClose} disabled={!!busy}>Cancel</Btn>
            <Btn tone="primary" disabled={!ready} onClick={() => void submit()}>
              {busy === "sending" ? "Signing and sending…" : busy === "confirming" ? "Confirming…" : "Send"}
            </Btn>
          </>}
        >
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="To" error={to && !validTo ? "Not a Solana address" : undefined}>
              <TextInput value={to} onChange={setTo} mono autoFocus placeholder="Recipient address" />
            </Field>
            <Field
              label="Amount (SOL)"
              hint={balanceSol != null ? `Balance ${balanceSol.toLocaleString("en-US", { maximumFractionDigits: 6 })} SOL` : undefined}
              error={!max && amount && lamports === null ? "Enter an amount, up to 9 decimals" : undefined}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  inputMode="decimal"
                  value={max ? "everything" : amount}
                  disabled={max}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  style={{
                    flex: 1, minWidth: 0, background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                    color: "var(--paper)", padding: "9px 12px", borderRadius: 8, fontSize: 13, fontFamily: "var(--font-mono)",
                  }}
                />
                <Btn tone={max ? "primary" : "ghost"} size="sm" onClick={() => setMax((v) => !v)} style={{ height: "auto" }}>Max</Btn>
              </div>
            </Field>
            {max && <ModalNote>Sends the whole balance minus the network fee (about 0.0000052 SOL).</ModalNote>}
            <PasswordField value={password} onChange={setPassword} autoFocus={false} label="Your password, to sign" />
          </form>
          <ModalNote>
            Signed on this Trade UI&apos;s server with the wallet&apos;s key, checked by the RPC before it is sent.
            Token transfers are not here yet: swap them to SOL first, or export the key.
          </ModalNote>
          {error && <ErrorText>{error}</ErrorText>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── rename ─────────────────────────────────────────────────────────────── */

export function RenameModal({ wallet, onClose }: { wallet: VaultWallet | null; onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLabel(wallet?.label ?? ""); setError(null); setBusy(false);
  }, [wallet]);

  async function submit() {
    if (!wallet) return;
    setBusy(true);
    try {
      await vault.rename(wallet.id, label);
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!wallet} onClose={onClose} width={420}>
      {wallet && (
        <ModalShell
          title="Rename wallet"
          onClose={onClose}
          footer={<>
            <Btn tone="ghost" onClick={onClose}>Cancel</Btn>
            <Btn tone="primary" disabled={busy} onClick={() => void submit()}>Save</Btn>
          </>}
        >
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <Field label="Label" hint={shortAddr(wallet.address, 8)}>
              <TextInput value={label} onChange={setLabel} autoFocus placeholder="Main" />
            </Field>
          </form>
          {error && <ErrorText>{error}</ErrorText>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── delete ─────────────────────────────────────────────────────────────── */

export function DeleteModal({ wallet, onClose }: { wallet: VaultWallet | null; onClose: () => void }) {
  const { pushToast } = useApp();
  const [password, setPassword] = useState("");
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassword(""); setBackedUp(false); setError(null); setBusy(false);
  }, [wallet]);

  const ready = !busy && password.length > 0 && backedUp;

  async function submit() {
    if (!wallet || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await vault.remove(wallet.id, password);
      pushToast({ title: "WALLET REMOVED", body: wallet.label || shortAddr(wallet.address, 6), tone: "default" });
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!wallet} onClose={onClose} width={460}>
      {wallet && (
        <ModalShell
          title="Delete wallet and its key"
          onClose={onClose}
          footer={<>
            <Btn tone="ghost" onClick={onClose}>Cancel</Btn>
            <Btn tone="sell" disabled={!ready} onClick={() => void submit()}>{busy ? "Deleting…" : "Delete for good"}</Btn>
          </>}
        >
          <span className="mono" style={{ fontSize: 11.5, color: "var(--paper-3)", wordBreak: "break-all" }}>{wallet.address}</span>
          <ModalNote>
            The key leaves the vault for good. Funds on this address stay on chain, but without an exported
            copy of the key nobody can move them again.
          </ModalNote>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, color: "var(--paper-2)", lineHeight: 1.5, cursor: "pointer" }}>
            <input type="checkbox" checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} style={{ marginTop: 3, accentColor: "var(--sell)" }} />
            <span>I exported this key, or the wallet is empty.</span>
          </label>
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <PasswordField value={password} onChange={setPassword} autoFocus={false} label="Your password, to delete" />
          </form>
          {error && <ErrorText>{error}</ErrorText>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── vault & security ───────────────────────────────────────────────────── */

export function SecurityModal({ open, config, onConfig, onClose }: {
  open: boolean;
  config: RuntimeConfig | null;
  onConfig: (c: RuntimeConfig) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} width={560}>
      <ModalShell title="Vault & security" onClose={onClose}>
        <SecurityPanel config={config} onConfig={onConfig} />
        <ModalNote>
          Backups: keep the recovery key offline and a copy of the vault file. Exported keys work
          anywhere, even without Trade UI.
        </ModalNote>
      </ModalShell>
    </Modal>
  );
}
