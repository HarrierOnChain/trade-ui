"use client";
/**
 * Portfolio modals — create / import / demo / send / burn / rename /
 * confirm.
 *
 * All modals render inside the shared `<Modal />` shell from
 * components/atoms. Inputs and shells use the portfolio design system
 * (see ./atoms.tsx).
 *
 * Transfer + burn wire to `BackendClient.transferSol / transferToken /
 * burnToken / closeEmptyAccounts`. Until the backend handlers land, the
 * call rejects with the server's "method not registered" error and we
 * surface a friendly "soon" message — same code path as a real failure.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../../../components/atoms";
import { Btn } from "../../../components/atoms";
import { useChain } from "../../../contexts/ChainContext";
import { explorerTxUrl, explorerName, nativeSymbol } from "../../../lib/chains";
import {
  Field, FieldGrid, ModalNote, ModalShell, NumberInput, TextInput, WalletKindChip,
  shortAddr,
} from "./atoms";
import type { UserWallet, BulkWalletResult } from "../../../hooks/useUserWallets";
import { parseWalletImport } from "../../../lib/walletImport";
import type { TokenHolding } from "../../../types";
import type { useBackend } from "../../../api/backend";

type BackendClient = ReturnType<typeof useBackend>;

/* ── Validators ──────────────────────────────────────────────────────── */

function looksLikeSolanaAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  // Map known wire error codes to human copy. Several handlers attach an
  // internal detail to the WireError (e.g. wallet_exists → the existing
  // wallet id, like "cmpo3kvg80001o92t0hqhkcbu"), which surfaces here as the
  // Error message — meaningless to a user. Prefer the code-based copy.
  const code = (e as { code?: string } | null)?.code;
  switch (code) {
    case "wallet_exists":
      return "That wallet is already imported on your account.";
    case "invalid_secret":
      return "That doesn't look like a valid private key. Paste the base58 secret for a Solana keypair (64-byte).";
    case "missing_secret":
      return "Paste a base58 private key.";
    case "wallet_limit_reached":
      return `Wallet limit reached${raw && raw !== code ? ` (max ${raw})` : ""}. Remove an existing wallet first.`;
  }
  if (
    lower.includes("not registered") ||
    lower.includes("method not found") ||
    lower.includes("no handler") ||
    lower.includes("unknown method")
  ) {
    return "Transfer + burn ops are rolling out region-by-region. Not enabled in this region yet — try again shortly or use the trading panel.";
  }
  return raw;
}

/* ── Create platform wallet ──────────────────────────────────────────── */

export function CreateWalletModal({
  open, onClose, onSubmit, remaining, limit, used,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    label: string,
    count: number,
    onProgress: (done: number, total: number) => void,
  ) => Promise<BulkWalletResult>;
  /** Wallets the user can still add. Infinity when the cap is unlimited. */
  remaining: number;
  /** Effective per-user cap; 0 = unlimited. */
  limit: number;
  /** Total wallets already counted against the cap. */
  used: number;
}) {
  const capped = Number.isFinite(remaining);
  // No hard cap → offer a sane batch ceiling so the field can't run away.
  const maxCount = Math.max(1, capped ? remaining : 50);
  const atLimit = capped && remaining <= 0;

  const [label, setLabel] = useState("");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BulkWalletResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setLabel(""); setCount(1); setBusy(false); setProgress(null); setResult(null); setErr(null); }
  }, [open]);

  const desired = Math.min(Math.max(1, Math.floor(count) || 1), maxCount);

  async function submit() {
    setBusy(true); setErr(null); setResult(null);
    setProgress({ done: 0, total: desired });
    try {
      const res = await onSubmit(label.trim(), desired, (done, total) => setProgress({ done, total }));
      if (res.errors.length === 0 && !res.limitReached) { onClose(); return; }
      setResult(res); // partial — keep open to show the summary
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  const cta = desired > 1 ? `Create ${desired} wallets` : "Create wallet";

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} width={460}>
      <ModalShell
        title={desired > 1 ? "Create platform wallets" : "Create platform wallet"}
        onClose={onClose}
        footer={
          result ? (
            <Btn size="sm" tone="primary" onClick={onClose}>Done</Btn>
          ) : (
            <>
              <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
              <Btn size="sm" tone="primary" onClick={submit} disabled={busy || atLimit}>
                {busy ? (progress ? `Creating ${progress.done}/${progress.total}…` : "Creating…") : cta}
              </Btn>
            </>
          )
        }
      >
        <ModalNote>
          {desired > 1
            ? "Generates fresh keypairs on the backend. Each private key is AES-256-GCM encrypted at rest and used by the server to sign trades — you'll never see them."
            : "Generates a fresh keypair on the backend. The private key is AES-256-GCM encrypted at rest and used by the server to sign trades — you'll never see it, and it won't leave the backend."}
        </ModalNote>

        {result ? (
          <BulkSummary result={result} verb="created" />
        ) : (
          <>
            <FieldGrid cols={2}>
              <Field label="How many" hint={desired > 1 ? "Batch — numbered Label 1, Label 2, …" : "One wallet."}>
                <NumberInput value={count} onChange={setCount} min={1} max={maxCount} step={1} suffix="wallets" />
              </Field>
              <Field label={desired > 1 ? "Label prefix" : "Label"} hint="Optional — shown across the terminal.">
                <TextInput value={label} onChange={setLabel} placeholder="e.g. Trading bot" autoFocus />
              </Field>
            </FieldGrid>
            <WalletCapNote limit={limit} used={used} remaining={remaining} />
          </>
        )}
        {err && <ErrorBanner>{err}</ErrorBanner>}
      </ModalShell>
    </Modal>
  );
}

/* ── Shared bulk UI (cap note + result summary) ──────────────────────── */

function WalletCapNote({ limit, used, remaining }: { limit: number; used: number; remaining: number }) {
  if (!(limit > 0)) return null;
  const none = remaining <= 0;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
      padding: "8px 11px", borderRadius: 8,
      background: none ? "var(--sell-w, rgba(255,80,80,0.08))" : "var(--ink-0)",
      border: `1px solid ${none ? "var(--sell)" : "var(--line-soft)"}`,
      fontSize: 11, fontFamily: "var(--font-mono)",
    }}>
      <span style={{ color: "var(--paper-3)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        Wallet limit
      </span>
      <span style={{ color: none ? "var(--sell)" : "var(--paper)", fontVariantNumeric: "tabular-nums" }}>
        {used} / {limit} used{none ? " · limit reached" : ` · ${remaining} left`}
      </span>
    </div>
  );
}

function BulkSummary({ result, verb }: { result: BulkWalletResult; verb: "created" | "imported" }) {
  const dup = result.errors.filter((e) => e.reason === "already imported").length;
  const invalid = result.errors.filter((e) => e.reason === "invalid key").length;
  const other = result.errors.length - dup - invalid;
  const rows: Array<{ label: string; n: number; tone: string }> = [
    { label: verb === "created" ? "Created" : "Imported", n: result.created.length, tone: "var(--buy)" },
  ];
  if (dup > 0) rows.push({ label: "Already imported", n: dup, tone: "var(--paper-3)" });
  if (invalid > 0) rows.push({ label: "Invalid key", n: invalid, tone: "var(--sell)" });
  if (other > 0) rows.push({ label: "Failed", n: other, tone: "var(--sell)" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 11px", borderRadius: 8,
          background: "var(--ink-0)", border: "1px solid var(--line-soft)",
          fontSize: 12,
        }}>
          <span style={{ color: "var(--paper-2)" }}>{r.label}</span>
          <span className="mono" style={{ color: r.tone, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{r.n}</span>
        </div>
      ))}
      {result.limitReached && (
        <span style={{ fontSize: 11, color: "var(--sell)", lineHeight: 1.5 }}>
          Wallet limit reached — the rest were skipped. Remove an existing wallet to add more.
        </span>
      )}
    </div>
  );
}

/* ── Import platform wallet ──────────────────────────────────────────── */

export function ImportWalletModal({
  open, onClose, onSubmit, remaining, limit, used,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    entries: Array<{ secret: string; label?: string }>,
    onProgress: (done: number, total: number) => void,
  ) => Promise<BulkWalletResult>;
  remaining: number;
  limit: number;
  used: number;
}) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BulkWalletResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) { setText(""); setLabel(""); setBusy(false); setProgress(null); setResult(null); setErr(null); }
  }, [open]);

  // Live-parse whatever's in the box so the CTA + counts reflect it. A JSON
  // byte-array file is normalized into base58 lines when loaded (see onFile),
  // so the textarea is always the single source of truth.
  const parsed = useMemo(() => parseWalletImport(text), [text]);
  const found = parsed.secrets.length;
  const multi = found > 1;
  const capped = Number.isFinite(remaining);
  const overCap = capped && found > remaining;

  function onFile(file: File) {
    setErr(null);
    void file.text().then((raw) => {
      const res = parseWalletImport(raw, file.name);
      if (res.secrets.length === 0) {
        setErr(res.skipped.length > 0 ? "No base58 keys found — that file has none we can read." : "That file is empty.");
        return;
      }
      // Append parsed base58 secrets as lines; dedupe happens at parse time on
      // submit, so a quick merge with the existing box is fine.
      setText((prev) => {
        const base = prev.trim();
        return (base ? base + "\n" : "") + res.secrets.join("\n");
      });
    }).catch(() => setErr("Couldn't read that file."));
  }

  async function submit() {
    if (found === 0) { setErr("Paste base58 private keys or load a file."); return; }
    const prefix = label.trim();
    const entries = parsed.secrets.map((secret, i) => ({
      secret,
      label: prefix ? (multi ? `${prefix} ${i + 1}` : prefix) : undefined,
    }));
    setBusy(true); setErr(null); setResult(null);
    setProgress({ done: 0, total: entries.length });
    try {
      const res = await onSubmit(entries, (done, total) => setProgress({ done, total }));
      // A run with zero backend errors AND nothing skipped at parse time closes
      // straight away; otherwise show the breakdown.
      if (res.errors.length === 0 && !res.limitReached && parsed.skipped.length === 0) { onClose(); return; }
      setResult(res);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  const cta = multi ? `Import ${found} wallets` : "Import wallet";

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} width={500}>
      <ModalShell
        title={multi ? "Import platform wallets" : "Import platform wallet"}
        onClose={onClose}
        footer={
          result ? (
            <Btn size="sm" tone="primary" onClick={onClose}>Done</Btn>
          ) : (
            <>
              <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
              <Btn size="sm" tone="primary" onClick={submit} disabled={busy || found === 0}>
                {busy ? (progress ? `Importing ${progress.done}/${progress.total}…` : "Importing…") : cta}
              </Btn>
            </>
          )
        }
      >
        <ModalNote>
          Paste one or more base58 private keys (one per line), or load a file —
          plain text, CSV, or a Solana JSON keypair. Each key is AES-256-GCM
          encrypted on the backend before it&apos;s stored; it never leaves the
          server unencrypted. Seed phrases aren&apos;t supported.
        </ModalNote>

        {result ? (
          <BulkSummary result={result} verb="imported" />
        ) : (
          <>
            <Field
              label="Private keys"
              hint={
                found > 0
                  ? `${found} key${found === 1 ? "" : "s"} detected${parsed.skipped.length ? ` · ${parsed.skipped.length} line${parsed.skipped.length === 1 ? "" : "s"} ignored` : ""}`
                  : "One base58 secret per line, or load a file below."
              }
            >
              <TextInput
                value={text}
                onChange={(v) => { setText(v); setErr(null); }}
                placeholder={"5Jd7zd… (87–88 chars)\n4Kf9ab…\n…"}
                mono multiline rows={5} autoFocus
              />
            </Field>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.csv,.json,.key,text/plain,application/json"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
              />
              <Btn size="sm" tone="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                ↑ Load from file
              </Btn>
              {text.trim() && (
                <Btn size="sm" tone="ghost" onClick={() => setText("")} disabled={busy}>Clear</Btn>
              )}
            </div>

            <Field label={multi ? "Label prefix" : "Label"} hint="Optional — defaults to Platform <addr-prefix>.">
              <TextInput value={label} onChange={setLabel} placeholder="e.g. Hot wallet" />
            </Field>

            {overCap && (
              <span style={{ fontSize: 11, color: "var(--sell)", lineHeight: 1.5 }}>
                {found} keys but only {remaining} slot{remaining === 1 ? "" : "s"} left — the rest will be skipped at the limit.
              </span>
            )}
            <WalletCapNote limit={limit} used={used} remaining={remaining} />
          </>
        )}
        {err && <ErrorBanner>{err}</ErrorBanner>}
      </ModalShell>
    </Modal>
  );
}

/* ── Create demo wallet ──────────────────────────────────────────────── */

export function CreateDemoWalletModal({
  open, onClose, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (args: { label?: string; initialSol: number; initialUsdc: number }) => Promise<void>;
}) {
  const { chainId } = useChain();
  const nat = nativeSymbol(chainId);
  const PRESETS: Array<{ key: string; label: string; sol: number; usdc: number; sub: string }> = [
    { key: "starter",  label: "Starter",  sol: 10,    usdc: 1_500,   sub: `10 ${nat} · $1.5k USDC` },
    { key: "standard", label: "Standard", sol: 100,   usdc: 15_000,  sub: `100 ${nat} · $15k USDC` },
    { key: "whale",    label: "Whale",    sol: 1_000, usdc: 150_000, sub: `1k ${nat} · $150k USDC` },
  ];
  const [presetIdx, setPresetIdx] = useState(1);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setPresetIdx(1); setLabel(""); setBusy(false); setErr(null); }
  }, [open]);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const p = PRESETS[presetIdx];
      await onSubmit({ label: label.trim() || undefined, initialSol: p.sol, initialUsdc: p.usdc });
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} width={480}>
      <ModalShell
        title="Create demo wallet"
        onClose={onClose}
        footer={
          <>
            <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
            <Btn size="sm" tone="primary" onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create demo"}
            </Btn>
          </>
        }
      >
        <ModalNote>
          Paper-trading wallet. Live prices, simulated fills. No on-chain
          transactions, no fees. Useful for testing strategies before risking
          real funds.
        </ModalNote>
        <Field label="Starting balance">
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr" }}>
            {PRESETS.map((p, i) => {
              const on = i === presetIdx;
              return (
                <button
                  key={p.key}
                  onClick={() => setPresetIdx(i)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
                    padding: "10px 12px", borderRadius: 8,
                    background: on ? "var(--gold-w)" : "var(--ink-0)",
                    border: `1px solid ${on ? "var(--gold)" : "var(--line-soft)"}`,
                    color: "var(--paper)", cursor: "pointer", textAlign: "left",
                    transition: "background 120ms, border-color 120ms",
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: on ? "var(--gold)" : "var(--paper)" }}>
                    {p.label}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--paper-3)", letterSpacing: "0.02em" }}>
                    {p.sub}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Label" hint="Optional.">
          <TextInput value={label} onChange={setLabel} placeholder="e.g. Paper trader" />
        </Field>
        {err && <ErrorBanner>{err}</ErrorBanner>}
      </ModalShell>
    </Modal>
  );
}

/* ── Rename wallet ───────────────────────────────────────────────────── */

export function RenameWalletModal({
  wallet, onClose, onSubmit,
}: {
  wallet: UserWallet | null;
  onClose: () => void;
  onSubmit: (label: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(wallet?.displayLabel ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (wallet) { setLabel(wallet.displayLabel); setBusy(false); setErr(null); }
  }, [wallet]);

  async function submit() {
    const trimmed = label.trim();
    if (!trimmed) { setErr("Label can't be empty."); return; }
    setBusy(true); setErr(null);
    try { await onSubmit(trimmed); }
    catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!wallet} onClose={busy ? () => {} : onClose} width={420}>
      {wallet && (
        <ModalShell
          title="Rename wallet"
          onClose={onClose}
          footer={
            <>
              <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
              <Btn size="sm" tone="primary" onClick={submit} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Btn>
            </>
          }
        >
          <ModalNote>
            <span className="mono" style={{ fontSize: 11 }}>{shortAddr(wallet.pubkey, 6)}</span>
          </ModalNote>
          <Field label="Label">
            <TextInput value={label} onChange={setLabel} autoFocus />
          </Field>
          {err && <ErrorBanner>{err}</ErrorBanner>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Send (transfer SOL or token) ───────────────────────────────────── */

type SendKind = "native" | "token";

export function SendModal({
  wallet, holdings, allWallets, onClose, client, nativeBal,
}: {
  wallet: UserWallet | null;
  holdings: TokenHolding[];
  allWallets: UserWallet[];
  onClose: () => void;
  client: BackendClient;
  nativeBal: number;
}) {
  const { chainId } = useChain();
  const nat = nativeSymbol(chainId);
  const tokenChoices = useMemo(
    () => holdings.filter((h) => !h.isNative && h.amount > 0),
    [holdings],
  );

  const [kind, setKind] = useState<SendKind>("native");
  const [mint, setMint] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [to, setTo] = useState("");
  const [picker, setPicker] = useState<"address" | "myWallet">("address");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet) {
      setKind("native"); setMint(null); setAmount(0);
      setTo(""); setPicker("address"); setBusy(false);
      setErr(null); setSuccess(null);
    }
  }, [wallet]);

  const selectedToken = mint ? tokenChoices.find((h) => h.mint === mint) : null;
  const maxAmount = kind === "native" ? nativeBal : (selectedToken?.amount ?? 0);

  function pctBtn(label: string, pct: number) {
    return (
      <button
        key={label}
        onClick={() => setAmount(Math.max(0, maxAmount * pct))}
        style={{
          padding: "4px 10px", fontSize: 11,
          background: "var(--ink-0)", color: "var(--paper-2)",
          border: "1px solid var(--line-soft)", borderRadius: 6,
          cursor: "pointer", fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
        }}
      >{label}</button>
    );
  }

  async function submit() {
    if (!wallet) return;
    if (kind === "token" && !mint) { setErr("Pick a token."); return; }
    if (!looksLikeSolanaAddress(to)) { setErr("Destination doesn't look like a Solana address."); return; }
    if (amount <= 0) { setErr("Amount must be > 0."); return; }
    if (amount > maxAmount) { setErr(`Amount exceeds balance (${maxAmount}).`); return; }

    setBusy(true); setErr(null); setSuccess(null);
    try {
      if (kind === "native") {
        const lamports = Math.floor(amount * 1_000_000_000);
        const res = await client.transferSol({
          fromWalletId: wallet.id, toAddress: to.trim(), lamports,
        });
        setSuccess(res.signature);
      } else if (selectedToken) {
        const res = await client.transferToken({
          fromWalletId: wallet.id,
          toAddress: to.trim(),
          mint: selectedToken.mint,
          amount,
          decimals: selectedToken.decimals,
        });
        setSuccess(res.signature);
      }
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  const otherWallets = allWallets.filter(
    (w) => w.id !== wallet?.id && w.kind !== "DEMO" && !w.isConnected,
  );

  return (
    <Modal open={!!wallet} onClose={busy ? () => {} : onClose} width={520}>
      {wallet && (
        <ModalShell
          title="Send"
          onClose={onClose}
          footer={
            <>
              <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
              <Btn size="sm" tone="primary" onClick={submit} disabled={busy || !to.trim() || amount <= 0}>
                {busy ? "Sending…" : success ? "Sent" : "Send"}
              </Btn>
            </>
          }
        >
          <ModalNote>
            From <strong>{wallet.displayLabel}</strong> &nbsp;·&nbsp;
            <span className="mono" style={{ fontSize: 11 }}>{shortAddr(wallet.pubkey, 6)}</span>
            &nbsp;<WalletKindChip kind={wallet.kind} size="xs" />
          </ModalNote>

          <Field label="Asset">
            <div style={{ display: "flex", gap: 8 }}>
              <PickPill on={kind === "native"} onClick={() => { setKind("native"); setMint(null); setAmount(0); }}>
                {nat} (native)
              </PickPill>
              <PickPill
                on={kind === "token"}
                onClick={() => { setKind("token"); setAmount(0); }}
                disabled={tokenChoices.length === 0}
              >
                Token {tokenChoices.length > 0 && <span style={{ opacity: 0.55, marginLeft: 4 }}>({tokenChoices.length})</span>}
              </PickPill>
            </div>
          </Field>

          {kind === "token" && (
            <Field label="Token">
              <select
                value={mint ?? ""}
                onChange={(e) => { setMint(e.target.value || null); setAmount(0); }}
                style={{
                  background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                  color: "var(--paper)", padding: "9px 12px", borderRadius: 8,
                  fontSize: 13, fontFamily: "var(--font-ui)", width: "100%", outline: "none",
                }}
              >
                <option value="">Select a token…</option>
                {tokenChoices.map((h) => (
                  <option key={h.mint} value={h.mint}>
                    {h.symbol ?? shortAddr(h.mint, 4)} · {h.amount.toLocaleString()}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <FieldGrid cols={2}>
            <Field
              label="Amount"
              hint={`Balance: ${maxAmount.toLocaleString(undefined, { maximumFractionDigits: 9 })} ${kind === "native" ? nat : selectedToken?.symbol ?? ""}`}
            >
              <NumberInput
                value={amount}
                onChange={setAmount}
                min={0}
                max={maxAmount}
                step={kind === "native" ? 0.01 : 1}
                suffix={kind === "native" ? nat : (selectedToken?.symbol ?? "")}
              />
            </Field>
            <Field label="Quick">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {pctBtn("25%", 0.25)}
                {pctBtn("50%", 0.50)}
                {pctBtn("75%", 0.75)}
                {pctBtn("MAX", 1.00)}
              </div>
            </Field>
          </FieldGrid>

          <Field label="Destination">
            <div style={{ display: "flex", gap: 8 }}>
              <PickPill on={picker === "address"} onClick={() => { setPicker("address"); setTo(""); }}>
                Paste address
              </PickPill>
              <PickPill
                on={picker === "myWallet"}
                onClick={() => { setPicker("myWallet"); setTo(""); }}
                disabled={otherWallets.length === 0}
              >
                My wallets {otherWallets.length > 0 && <span style={{ opacity: 0.55, marginLeft: 4 }}>({otherWallets.length})</span>}
              </PickPill>
            </div>
          </Field>

          {picker === "address" ? (
            <Field label="Address">
              <TextInput value={to} onChange={(v) => { setTo(v); setErr(null); }} mono placeholder="9WzD…aBcd" />
            </Field>
          ) : (
            <Field label="Pick a wallet">
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                {otherWallets.map((w) => {
                  const on = to === w.pubkey;
                  return (
                    <button
                      key={w.id}
                      onClick={() => setTo(w.pubkey)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "9px 12px", borderRadius: 8,
                        background: on ? "var(--accent-w)" : "var(--ink-0)",
                        border: `1px solid ${on ? "var(--accent)" : "var(--line-soft)"}`,
                        color: "var(--paper)", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{w.displayLabel}</span>
                        <WalletKindChip kind={w.kind} size="xs" />
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)" }}>
                        {shortAddr(w.pubkey, 6)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {err && <ErrorBanner>{err}</ErrorBanner>}
          {success && (
            <div style={{
              padding: "10px 12px", borderRadius: 8,
              background: "var(--buy-w)",
              border: "1px solid color-mix(in oklch, var(--buy) 40%, transparent)",
              color: "var(--buy)", fontSize: 12, lineHeight: 1.45,
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              <strong>Sent.</strong>
              <span className="mono" style={{ fontSize: 10, color: "var(--paper-2)" }}>
                sig {shortAddr(success, 8, 8)}
              </span>
              <a
                href={explorerTxUrl(success)} target="_blank" rel="noreferrer"
                style={{ fontSize: 11, color: "var(--accent)" }}
              >View on {explorerName()} ↗</a>
            </div>
          )}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Receive (show address + QR placeholder) ─────────────────────────── */

export function ReceiveModal({
  wallet, nativeBal, onClose,
}: {
  wallet: UserWallet | null;
  /** Live native balance of this wallet (stream-fed cache). */
  nativeBal: number;
  onClose: () => void;
}) {
  const { chainId } = useChain();
  const nat = nativeSymbol(chainId);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!wallet) setCopied(false); }, [wallet]);

  async function copy() {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.pubkey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  }

  return (
    <Modal open={!!wallet} onClose={onClose} width={420}>
      {wallet && (
        <ModalShell
          title="Receive"
          onClose={onClose}
          footer={
            <Btn size="sm" tone="primary" onClick={copy}>
              {copied ? "Copied ✓" : "Copy address"}
            </Btn>
          }
        >
          <ModalNote>
            Send tokens or native {nat} to <strong>{wallet.displayLabel}</strong>.
            Transfers reflect once the network confirms (typically &lt; 1 second).
          </ModalNote>

          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 8, padding: "9px 12px", borderRadius: 8,
            background: "var(--ink-0)", border: "1px solid var(--line-soft)",
          }}>
            <span className="eyebrow" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.08em" }}>
              Current balance
            </span>
            <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--paper)", fontVariantNumeric: "tabular-nums" }}>
              {nativeBal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              <span style={{ fontSize: 10, color: "var(--paper-4)", marginLeft: 4 }}>{nat}</span>
            </span>
          </div>

          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
            padding: "20px 16px", borderRadius: 12,
            background: "var(--ink-0)", border: "1px solid var(--line-soft)",
          }}>
            <QrPlaceholder text={wallet.pubkey} />
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 11.5,
              color: "var(--paper)", letterSpacing: "0.01em",
              padding: "8px 12px", borderRadius: 6,
              background: "var(--ink-1)", border: "1px solid var(--line-soft)",
              wordBreak: "break-all", textAlign: "center", maxWidth: "100%",
            }}>{wallet.pubkey}</div>
          </div>
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Burn token / close dust accounts ────────────────────────────────── */

export function BurnModal({
  wallet, holdings, onClose, client,
}: {
  wallet: UserWallet | null;
  holdings: TokenHolding[];
  onClose: () => void;
  client: BackendClient;
}) {
  const burnables = useMemo(
    () => holdings.filter((h) => !h.isNative && h.amount > 0),
    [holdings],
  );
  const dustCount = useMemo(
    () => burnables.filter((h) => (h.usdValue ?? 0) < 0.5).length,
    [burnables],
  );

  const [mode, setMode] = useState<"single" | "dust">("dust");
  const [mint, setMint] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [closeAccount, setCloseAccount] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (!wallet) {
      setMode("dust"); setMint(null); setAmount(0); setCloseAccount(true);
      setBusy(false); setErr(null); setSuccess(null); setConfirm("");
    }
  }, [wallet]);

  const selectedToken = mint ? burnables.find((h) => h.mint === mint) : null;

  async function submit() {
    if (!wallet) return;
    if (confirm.toLowerCase() !== "burn") { setErr('Type "burn" to confirm.'); return; }
    setBusy(true); setErr(null); setSuccess(null);
    try {
      if (mode === "single" && selectedToken) {
        if (amount <= 0 || amount > selectedToken.amount) {
          setErr("Amount must be > 0 and within the balance.");
          setBusy(false); return;
        }
        const res = await client.burnToken({
          fromWalletId: wallet.id,
          mint: selectedToken.mint,
          amount,
          decimals: selectedToken.decimals,
          closeAccount,
        });
        setSuccess(`Burned ${amount} ${selectedToken.symbol ?? shortAddr(selectedToken.mint)} — sig ${shortAddr(res.signature, 6, 6)}`);
      } else if (mode === "dust") {
        const res = await client.closeEmptyAccounts({ walletId: wallet.id });
        const recovered = (res.recoveredLamports / 1_000_000_000).toFixed(4);
        setSuccess(`Closed ${res.closed} account${res.closed === 1 ? "" : "s"} · recovered ≈ ${recovered} SOL rent.`);
      }
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!wallet} onClose={busy ? () => {} : onClose} width={520}>
      {wallet && (
        <ModalShell
          title="Burn / clean dust"
          onClose={onClose}
          footer={
            <>
              <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
              <Btn size="sm" tone="sell" onClick={submit} disabled={busy || confirm.toLowerCase() !== "burn"}>
                {busy ? "Burning…" : mode === "dust" ? "Close empty accounts" : "Burn tokens"}
              </Btn>
            </>
          }
        >
          <ModalNote>
            <strong>Burn is irreversible.</strong> Tokens sent to the burn
            address are destroyed; closing an empty account recovers its
            ≈ 0.002 {nativeSymbol("sol")} rent deposit back to the wallet.
          </ModalNote>

          <Field label="Operation">
            <div style={{ display: "flex", gap: 8 }}>
              <PickPill on={mode === "dust"} onClick={() => setMode("dust")}>
                Sweep dust accounts {dustCount > 0 && <span style={{ opacity: 0.55, marginLeft: 4 }}>({dustCount})</span>}
              </PickPill>
              <PickPill
                on={mode === "single"}
                onClick={() => setMode("single")}
                disabled={burnables.length === 0}
              >
                Burn specific token
              </PickPill>
            </div>
          </Field>

          {mode === "single" && (
            <>
              <Field label="Token">
                <select
                  value={mint ?? ""}
                  onChange={(e) => { setMint(e.target.value || null); setAmount(0); }}
                  style={{
                    background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                    color: "var(--paper)", padding: "9px 12px", borderRadius: 8,
                    fontSize: 13, fontFamily: "var(--font-ui)", width: "100%", outline: "none",
                  }}
                >
                  <option value="">Select a token…</option>
                  {burnables.map((h) => (
                    <option key={h.mint} value={h.mint}>
                      {h.symbol ?? shortAddr(h.mint, 4)} · {h.amount.toLocaleString()}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedToken && (
                <FieldGrid cols={2}>
                  <Field label="Amount" hint={`Balance: ${selectedToken.amount.toLocaleString()}`}>
                    <NumberInput
                      value={amount}
                      onChange={setAmount}
                      min={0}
                      max={selectedToken.amount}
                      suffix={selectedToken.symbol ?? ""}
                    />
                  </Field>
                  <Field label="Close empty ATA after burn" hint="Recovers rent (~0.002 SOL).">
                    <button
                      onClick={() => setCloseAccount((v) => !v)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "9px 12px", borderRadius: 8,
                        background: closeAccount ? "color-mix(in oklch, var(--accent) 8%, var(--ink-0))" : "var(--ink-0)",
                        border: `1px solid ${closeAccount ? "color-mix(in oklch, var(--accent) 35%, var(--line-soft))" : "var(--line-soft)"}`,
                        color: "var(--paper)", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <span style={{
                        position: "relative", width: 30, height: 18, borderRadius: 999,
                        background: closeAccount ? "var(--accent)" : "var(--ink-3)",
                        transition: "background 140ms",
                      }}>
                        <span style={{
                          position: "absolute", top: 2, left: closeAccount ? 14 : 2,
                          width: 14, height: 14, borderRadius: 999,
                          background: "var(--paper)",
                          transition: "left 140ms cubic-bezier(0.4, 1, 0.6, 1)",
                          boxShadow: "0 1px 2px oklch(0 0 0 / 0.4)",
                        }} />
                      </span>
                      <span style={{ fontSize: 12 }}>{closeAccount ? "Yes — recover rent" : "No — leave ATA open"}</span>
                    </button>
                  </Field>
                </FieldGrid>
              )}
            </>
          )}

          {mode === "dust" && (
            <div style={{
              padding: "12px 14px", borderRadius: 8,
              background: "var(--ink-0)", border: "1px solid var(--line-soft)",
              fontSize: 12, color: "var(--paper-2)", lineHeight: 1.5,
            }}>
              <strong>{dustCount}</strong> empty / near-empty token accounts (&lt; $0.50 value)
              are eligible for cleanup. Closing them recovers the rent deposit
              (≈ 0.002 SOL each).
            </div>
          )}

          <Field label='Type "burn" to confirm'>
            <TextInput value={confirm} onChange={(v) => { setConfirm(v); setErr(null); }} placeholder="burn" />
          </Field>

          {err && <ErrorBanner>{err}</ErrorBanner>}
          {success && (
            <div style={{
              padding: "10px 12px", borderRadius: 8,
              background: "var(--buy-w)",
              border: "1px solid color-mix(in oklch, var(--buy) 40%, transparent)",
              color: "var(--buy)", fontSize: 12, lineHeight: 1.45,
            }}>{success}</div>
          )}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Delete wallet ───────────────────────────────────────────────────── */

export function DeleteWalletModal({
  wallet, onClose, onSubmit,
}: {
  wallet: UserWallet | null;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  useEffect(() => { if (!wallet) { setBusy(false); setErr(null); setConfirm(""); } }, [wallet]);

  async function submit() {
    if (confirm.toLowerCase() !== "delete") { setErr('Type "delete" to confirm.'); return; }
    setBusy(true); setErr(null);
    try { await onSubmit(); }
    catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!wallet} onClose={busy ? () => {} : onClose} width={440}>
      {wallet && (
        <ModalShell
          title="Delete wallet"
          onClose={onClose}
          footer={
            <>
              <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
              <Btn size="sm" tone="sell" onClick={submit} disabled={busy || confirm.toLowerCase() !== "delete"}>
                {busy ? "Deleting…" : "Delete wallet"}
              </Btn>
            </>
          }
        >
          <ModalNote>
            Removes <strong>{wallet.displayLabel}</strong>
            {" "}({shortAddr(wallet.pubkey, 6)}) from this account. The on-chain wallet
            and its assets are <strong>not</strong> destroyed — any remaining
            tokens stay on-chain at the same address. You won&apos;t be able to
            sign trades from this wallet through the terminal afterwards.
          </ModalNote>
          <Field label='Type "delete" to confirm'>
            <TextInput value={confirm} onChange={(v) => { setConfirm(v); setErr(null); }} placeholder="delete" />
          </Field>
          {err && <ErrorBanner>{err}</ErrorBanner>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Reset demo wallet ───────────────────────────────────────────────── */

export function ResetDemoModal({
  wallet, onClose, onSubmit,
}: {
  wallet: UserWallet | null;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!wallet) { setBusy(false); setErr(null); } }, [wallet]);

  async function submit() {
    setBusy(true); setErr(null);
    try { await onSubmit(); }
    catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!wallet} onClose={busy ? () => {} : onClose} width={420}>
      {wallet && (
        <ModalShell
          title="Reset demo wallet?"
          onClose={onClose}
          footer={
            <>
              <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
              <Btn size="sm" tone="primary" onClick={submit} disabled={busy}>
                {busy ? "Resetting…" : "Reset balance"}
              </Btn>
            </>
          }
        >
          <ModalNote>
            Restores <strong>{wallet.displayLabel}</strong> to its starting balance and
            clears all open positions, history, and orders. This cannot be undone.
          </ModalNote>
          {err && <ErrorBanner>{err}</ErrorBanner>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Fund (SplitNOW SOL on-ramp) ─────────────────────────────────────── */

/**
 * Fund SOL into one or more PLATFORM wallets via SplitNOW's multi-wallet
 * exchange. Three steps:
 *   1. Quote (read rates).
 *   2. Order (server returns a deposit address + amount).
 *   3. Status poll (every 5s until settled or expired).
 *
 * The user sends SOL to the deposit address using any external wallet —
 * Phantom on the same browser, a hardware wallet, an exchange withdrawal.
 * SplitNOW routes via the rate's exchanger (binance/bybit/…) and credits
 * the destination wallets per the bips split.
 *
 * Default split: 100% to the anchor wallet. The user can add their other
 * PLATFORM wallets as additional legs (each leg ≥1 bip; sum = 10000).
 */
export function FundModal({
  wallet, allWallets, onClose, client,
}: {
  wallet: UserWallet | null;
  allWallets: UserWallet[];
  onClose: () => void;
  client: BackendClient;
}) {
  type Leg = { walletId: string; bips: number };
  type Step = "compose" | "review" | "deposit";

  // Eligible add-on wallets — every other PLATFORM wallet the user owns.
  const otherPlatformWallets = useMemo(
    () => allWallets.filter(
      (w) => w.id !== wallet?.id && w.kind === "PLATFORM" && !w.isConnected,
    ),
    [allWallets, wallet],
  );

  const [step, setStep] = useState<Step>("compose");
  const [fromAmount, setFromAmount] = useState<number>(0);
  const [legs, setLegs] = useState<Leg[]>([]);
  /** Sender = walletId of a PLATFORM wallet (backend auto-pays) or the
   *  literal "manual" (backend skips auto-pay, returns deposit address). */
  const [senderId, setSenderId] = useState<string>("");
  const isManual = senderId === "manual";
  const [quote, setQuote] = useState<{
    quoteId: string;
    rates: Array<{ exchangeId: string; exchangeRate: number }>;
  } | null>(null);
  const [order, setOrder] = useState<{
    orderId: string;
    depositAddress: string;
    depositAmount: number;
    exchangerId: string;
    autoPaid?: boolean;
    signature?: string;
    autoPayError?: string;
  } | null>(null);
  const [status, setStatus] = useState<{
    orderStatus: string;
    orderStatusText: string;
    orderStatusShort: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset state when the modal closes (wallet becomes null).
  useEffect(() => {
    if (!wallet) {
      setStep("compose"); setFromAmount(0); setLegs([]); setSenderId("");
      setQuote(null); setOrder(null); setStatus(null);
      setBusy(false); setErr(null); setCopied(false);
    } else {
      // Default split: 100% to the anchor wallet.
      setLegs([{ walletId: wallet.id, bips: 10_000 }]);
      // Default sender: the first other PLATFORM wallet so the backend
      // handles the deposit transfer automatically. Falls back to "" (the
      // manual / external deposit path) only when no other PLATFORM
      // wallet exists.
      setSenderId(otherPlatformWallets[0]?.id ?? "");
    }
  // otherPlatformWallets is derived from allWallets — including it here
  // would re-pick on every render. Keying off `wallet` is the actual
  // "modal just opened" signal we want.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  // Poll status every 5s while in deposit step + order exists + not settled.
  useEffect(() => {
    if (step !== "deposit" || !order) return;
    const settled = status?.orderStatus &&
      ["completed", "expired", "cancelled", "failed"].includes(status.orderStatus.toLowerCase());
    if (settled) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await client.fundStatus({ orderId: order.orderId });
        if (!cancelled) setStatus(s);
      } catch { /* ignore transient */ }
    };
    tick();
    const id = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [step, order, status?.orderStatus, client]);

  const totalBips = legs.reduce((s, l) => s + (l.bips || 0), 0);
  const bipsOk = totalBips === 10_000;
  const amountOk = fromAmount > 0;
  // Either a wallet id is selected (auto-pay) OR the user explicitly chose
  // "manual" — both are valid sender shapes.
  const senderOk = !!senderId;

  function setLegBips(idx: number, bips: number) {
    setLegs((prev) => prev.map((l, i) => i === idx ? { ...l, bips: Math.max(0, Math.round(bips)) } : l));
  }
  function addLeg(walletId: string) {
    setLegs((prev) => prev.find((l) => l.walletId === walletId) ? prev : [...prev, { walletId, bips: 0 }]);
  }
  function removeLeg(walletId: string) {
    if (wallet && walletId === wallet.id) return; // anchor is permanent
    setLegs((prev) => prev.filter((l) => l.walletId !== walletId));
  }
  function evenSplit() {
    if (legs.length === 0) return;
    const each = Math.floor(10_000 / legs.length);
    const remainder = 10_000 - (each * legs.length);
    setLegs(legs.map((l, i) => ({ ...l, bips: each + (i === 0 ? remainder : 0) })));
  }

  function walletLabel(walletId: string): string {
    const w = allWallets.find((x) => x.id === walletId);
    return w ? w.displayLabel : walletId;
  }
  function walletPubkey(walletId: string): string {
    const w = allWallets.find((x) => x.id === walletId);
    return w?.pubkey ?? "";
  }

  async function getQuote() {
    setBusy(true); setErr(null);
    try {
      const q = await client.fundQuote({
        fromAmountSol: fromAmount,
        distributions: legs,
      });
      setQuote(q);
      setStep("review");
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function placeOrder() {
    if (!quote) return;
    setBusy(true); setErr(null);
    try {
      const o = await client.fundOrder({
        quoteId: quote.quoteId,
        fromAmountSol: fromAmount,
        distributions: legs,
        fromWalletId: isManual ? undefined : (senderId || undefined),
        manual: isManual,
      });
      setOrder(o);
      setStep("deposit");
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function copyAddress() {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.depositAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  const bestRate = quote?.rates?.[0];

  const footer = step === "compose" ? (
    <>
      <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
      <Btn size="sm" tone="primary" onClick={getQuote} disabled={busy || !amountOk || !bipsOk || !senderOk}>
        {busy ? "Quoting…" : "Get quote →"}
      </Btn>
    </>
  ) : step === "review" ? (
    <>
      <Btn size="sm" tone="ghost" onClick={() => setStep("compose")} disabled={busy}>Back</Btn>
      <Btn size="sm" tone="primary" onClick={placeOrder} disabled={busy}>
        {busy
          ? (isManual ? "Creating order…" : "Paying…")
          : (isManual ? "Get deposit address" : "Confirm + pay from wallet")}
      </Btn>
    </>
  ) : (
    <Btn size="sm" tone="primary" onClick={onClose}>Done</Btn>
  );

  return (
    <Modal open={!!wallet} onClose={busy ? () => {} : onClose} width={620}>
      {wallet && (
        <ModalShell
          title={
            step === "compose" ? "Fund wallet" :
            step === "review" ? "Review funding" :
            "Send SOL to deposit address"
          }
          onClose={onClose}
          footer={footer}
        >
          <ModalNote>
            Powered by <strong>SplitNOW</strong> — pay SOL once to a one-off
            deposit address, the exchanger fans it out to every selected
            wallet by basis points. Funds typically settle in 1-3 minutes.
          </ModalNote>

          {step === "compose" && (
            <>
              <Field
                label="From"
                hint={isManual
                  ? "You'll get a SplitNOW deposit address. Send SOL from any external wallet (Phantom, hardware, exchange)."
                  : "Backend signs + relays the deposit transfer from this wallet — no manual step."}
              >
                <select
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  style={{
                    background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                    color: "var(--paper)", padding: "9px 12px", borderRadius: 8,
                    fontSize: 13, fontFamily: "var(--font-ui)", width: "100%", outline: "none",
                  }}
                >
                  {otherPlatformWallets.length > 0 && (
                    <optgroup label="Auto-pay from a platform wallet">
                      {otherPlatformWallets.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.displayLabel} · {shortAddr(w.pubkey, 5)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="External">
                    <option value="manual">Send manually to deposit address</option>
                  </optgroup>
                </select>
              </Field>

              <Field label="Amount to fund" hint="Total SOL to deposit. Funds split per the bips table below.">
                <NumberInput value={fromAmount} onChange={setFromAmount} min={0} step={0.01} suffix="SOL" />
              </Field>

              <Field
                label="Split"
                hint={`${legs.length} leg${legs.length === 1 ? "" : "s"} · total ${totalBips}/10000 bips`}
              >
                <div style={{
                  display: "flex", flexDirection: "column", gap: 4,
                  maxHeight: 240, overflowY: "auto",
                  border: "1px solid var(--line-soft)", borderRadius: 8, padding: 4,
                }}>
                  {legs.map((leg, i) => {
                    const isAnchor = leg.walletId === wallet.id;
                    return (
                      <div key={leg.walletId} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 10px", borderRadius: 6,
                        background: isAnchor ? "var(--accent-w)" : "transparent",
                        border: `1px solid ${isAnchor ? "var(--accent)" : "transparent"}`,
                      }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                          {walletLabel(leg.walletId)}
                          <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", marginLeft: 6 }}>
                            {shortAddr(walletPubkey(leg.walletId), 5)}
                          </span>
                        </span>
                        <span style={{ width: 110 }}>
                          <NumberInput
                            value={leg.bips}
                            onChange={(v) => setLegBips(i, v)}
                            min={0}
                            max={10_000}
                            step={100}
                            suffix="bips"
                          />
                        </span>
                        <span style={{ fontSize: 11, color: "var(--paper-3)", width: 44, textAlign: "right" }}>
                          {leg.bips != null ? (leg.bips / 100).toFixed(2) + "%" : "—"}
                        </span>
                        {!isAnchor && (
                          <button
                            onClick={() => removeLeg(leg.walletId)}
                            style={{
                              background: "transparent", border: "1px solid var(--line-soft)",
                              borderRadius: 4, color: "var(--paper-3)",
                              cursor: "pointer", padding: "2px 8px", fontSize: 11,
                            }}
                          >×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Field>

              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <Btn size="xs" tone="ghost" onClick={evenSplit}>Even split</Btn>
                {otherPlatformWallets.length > 0 && (
                  <select
                    onChange={(e) => { if (e.target.value) { addLeg(e.target.value); e.target.value = ""; } }}
                    style={{
                      background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                      color: "var(--paper)", padding: "6px 10px", borderRadius: 8,
                      fontSize: 12, fontFamily: "var(--font-ui)", outline: "none",
                    }}
                    defaultValue=""
                  >
                    <option value="">+ Add a destination wallet…</option>
                    {otherPlatformWallets
                      .filter((w) => !legs.find((l) => l.walletId === w.id))
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.displayLabel} · {shortAddr(w.pubkey, 5)}
                        </option>
                      ))}
                  </select>
                )}
                {!bipsOk && (
                  <span style={{ fontSize: 11, color: "var(--sell)" }}>
                    Split must sum to 10000 bips (100%).
                  </span>
                )}
              </div>
            </>
          )}

          {step === "review" && quote && (
            <>
              <div style={{
                padding: "10px 12px", borderRadius: 8,
                background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                fontSize: 12.5, lineHeight: 1.55,
                display: "flex", flexDirection: "column", gap: 4,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--paper-3)" }}>From</span>
                  <strong>{isManual ? "External (manual)" : (senderId ? walletLabel(senderId) : "—")}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--paper-3)" }}>Send</span>
                  <strong>{fromAmount} SOL</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--paper-3)" }}>Receive (est.)</span>
                  <strong style={{ color: "var(--accent)" }}>
                    {bestRate ? (fromAmount * bestRate.exchangeRate).toFixed(6) : "—"} SOL
                  </strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--paper-3)" }}>Route via</span>
                  <span className="mono">{bestRate?.exchangeId ?? "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--paper-3)" }}>Rate</span>
                  <span className="mono" style={{ fontSize: 11 }}>
                    1 SOL → {bestRate ? bestRate.exchangeRate.toFixed(6) : "—"} SOL
                  </span>
                </div>
              </div>
              <Field label="Recipients" hint={`${legs.length} wallet${legs.length === 1 ? "" : "s"} · sum 100%`}>
                <div style={{
                  border: "1px solid var(--line-soft)", borderRadius: 8, padding: 8,
                  display: "flex", flexDirection: "column", gap: 4,
                  maxHeight: 220, overflowY: "auto",
                }}>
                  {legs.map((l) => (
                    <div key={l.walletId} style={{
                      display: "flex", justifyContent: "space-between",
                      padding: "4px 4px", fontSize: 13,
                    }}>
                      <span>
                        {walletLabel(l.walletId)}
                        <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", marginLeft: 6 }}>
                          {shortAddr(walletPubkey(l.walletId), 5)}
                        </span>
                      </span>
                      <strong style={{ color: "var(--accent)" }}>
                        {(l.bips / 100).toFixed(2)}%
                      </strong>
                    </div>
                  ))}
                </div>
              </Field>
            </>
          )}

          {step === "deposit" && order && (
            <>
              {order.autoPaid && order.signature ? (
                // ── Auto-pay success: deposit tx already submitted ────────
                <div style={{
                  padding: "12px 14px", borderRadius: 8,
                  background: "var(--buy-w)",
                  border: "1px solid color-mix(in oklch, var(--buy) 40%, transparent)",
                  color: "var(--paper)", fontSize: 12.5, lineHeight: 1.55,
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <strong style={{ color: "var(--buy)" }}>
                    Paid {order.depositAmount} SOL from {walletLabel(senderId)}.
                  </strong>
                  <span style={{ color: "var(--paper-3)" }}>
                    SplitNOW is now routing the exchange. The destination wallets
                    receive funds in 1-3 minutes.
                  </span>
                  <a
                    href={explorerTxUrl(order.signature)}
                    target="_blank" rel="noreferrer"
                    className="mono" style={{ fontSize: 10, color: "var(--accent)" }}
                  >
                    sig {shortAddr(order.signature, 8, 8)} ↗
                  </a>
                </div>
              ) : (
                // ── Manual deposit: show address (default flow) ──────────
                <div style={{
                  padding: "12px 14px", borderRadius: 8,
                  background: "var(--accent-w)",
                  border: "1px solid color-mix(in oklch, var(--accent) 40%, transparent)",
                  color: "var(--paper)", fontSize: 12.5, lineHeight: 1.55,
                  display: "flex", flexDirection: "column", gap: 8,
                }}>
                  {order.autoPayError && (
                    <div style={{
                      padding: "8px 10px", borderRadius: 6,
                      background: "var(--sell-w)",
                      border: "1px solid color-mix(in oklch, var(--sell) 40%, transparent)",
                      color: "var(--sell)", fontSize: 11.5,
                    }}>
                      <strong>Auto-pay failed:</strong> {order.autoPayError}
                      <br />Fall back to paying the deposit address manually.
                    </div>
                  )}
                  <span style={{ color: "var(--paper-3)" }}>Send exactly</span>
                  <strong style={{ fontSize: 18, color: "var(--accent)" }}>
                    {order.depositAmount} SOL
                  </strong>
                  <span style={{ color: "var(--paper-3)" }}>to this address (Solana mainnet):</span>
                  <div style={{
                    padding: "8px 10px", borderRadius: 6,
                    background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                    fontFamily: "var(--font-mono)", fontSize: 11, wordBreak: "break-all",
                    userSelect: "all",
                  }}>{order.depositAddress}</div>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <Btn size="xs" tone={copied ? "primary" : "ghost"} onClick={copyAddress}>
                      {copied ? "Copied ✓" : "Copy address"}
                    </Btn>
                  </div>
                </div>
              )}

              <ModalNote>
                Order ID <span className="mono" style={{ fontSize: 10 }}>{shortAddr(order.orderId, 8, 8)}</span>
                {" "}· via <strong>{order.exchangerId}</strong>. After the deposit is detected, SplitNOW
                runs the exchange and credits each destination wallet.
              </ModalNote>

              <div style={{
                padding: "10px 12px", borderRadius: 8,
                background: "var(--ink-0)", border: "1px solid var(--line-soft)",
                fontSize: 12.5, lineHeight: 1.55,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ color: "var(--paper-3)" }}>Status</span>
                <strong style={{
                  color: status?.orderStatus?.toLowerCase() === "completed" ? "var(--buy)" :
                         status?.orderStatus?.toLowerCase().match(/expired|cancelled|failed/) ? "var(--sell)" :
                         "var(--accent)",
                }}>
                  {status?.orderStatusText ?? status?.orderStatus ?? "Waiting for deposit…"}
                </strong>
              </div>
            </>
          )}

          {err && <ErrorBanner>{err}</ErrorBanner>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Distribute SOL (one→many, multi-pool privacy) ───────────────────── */

/**
 * Distribute native SOL from a source wallet to many recipients. Each
 * recipient gets its own tx fanned across 1–5 pool PDAs on the privacy
 * pool program; the backend signs every required slot (sender + each
 * recipient) since both ends are the user's PLATFORM wallets.
 *
 * Recipients are restricted to PLATFORM wallets the user owns — anything
 * else can't be signed for, and the backend rejects it.
 */
export function ConsolidateModal({
  wallet, allWallets, balancesByAddr, onClose, client,
}: {
  wallet: UserWallet | null;
  allWallets: UserWallet[];
  /** Live SOL balance per pubkey, used to estimate sweep totals. */
  balancesByAddr: Record<string, number>;
  onClose: () => void;
  client: BackendClient;
}) {
  const eligibleSources = useMemo(
    () => allWallets.filter(
      (w) => w.id !== wallet?.id && w.kind === "PLATFORM" && !w.isConnected,
    ),
    [allWallets, wallet],
  );

  const [step, setStep] = useState<0 | 1>(0);
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [pct, setPct] = useState<number>(100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);

  useEffect(() => {
    if (!wallet) {
      setStep(0); setSources(new Set()); setPct(100);
      setBusy(false); setErr(null); setDone(null);
    }
  }, [wallet]);

  function toggleSource(id: string) {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (sources.size === eligibleSources.length) setSources(new Set());
    else setSources(new Set(eligibleSources.map((w) => w.id)));
  }

  const sourceList = useMemo(
    () => eligibleSources.filter((w) => sources.has(w.id)),
    [eligibleSources, sources],
  );

  const estimatedSweep = useMemo(() => {
    return sourceList.reduce((s, w) => s + (balancesByAddr[w.pubkey] ?? 0) * pct / 100, 0);
  }, [sourceList, balancesByAddr, pct]);

  async function submit() {
    if (!wallet) return;
    if (sourceList.length === 0) { setErr("Pick at least one source."); return; }
    if (pct <= 0 || pct > 100) { setErr("Percentage must be 1-100."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await client.consolidateSol({
        sourceWalletIds: sourceList.map((w) => w.id),
        toWalletId: wallet.id,
        percentage: pct,
      });
      setDone(res.signatures);
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!wallet} onClose={busy ? () => {} : onClose} width={580}>
      {wallet && (
        <ModalShell
          title={step === 0 ? "Consolidate SOL" : "Review consolidation"}
          onClose={onClose}
          footer={
            done ? (
              <Btn size="sm" tone="primary" onClick={onClose}>Done</Btn>
            ) : step === 0 ? (
              <>
                <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
                <Btn
                  size="sm" tone="primary"
                  onClick={() => setStep(1)}
                  disabled={sourceList.length === 0 || pct <= 0 || pct > 100}
                >Review →</Btn>
              </>
            ) : (
              <>
                <Btn size="sm" tone="ghost" onClick={() => setStep(0)} disabled={busy}>Back</Btn>
                <Btn size="sm" tone="primary" onClick={submit} disabled={busy}>
                  {busy ? "Consolidating…" : "Consolidate"}
                </Btn>
              </>
            )
          }
        >
          <ModalNote>
            Sweep into <strong>{wallet.displayLabel}</strong> &nbsp;·&nbsp;
            <span className="mono" style={{ fontSize: 11 }}>{shortAddr(wallet.pubkey, 6)}</span>
            <br />
            Pulls a percentage of each source wallet&apos;s SOL balance in one or
            more batched txs (≤8 transfers per tx). The destination wallet
            pays gas as the fee payer.
          </ModalNote>

          {step === 0 && (
            <>
              <Field
                label="Source wallets"
                hint={`${sourceList.length} of ${eligibleSources.length} selected`}
              >
                {eligibleSources.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--paper-4)", padding: "8px 0" }}>
                    No other platform wallets to sweep from.
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: 6, display: "flex", justifyContent: "flex-end" }}>
                      <button
                        onClick={selectAll}
                        style={{
                          fontSize: 11, padding: "3px 10px",
                          background: "var(--ink-0)", color: "var(--paper-2)",
                          border: "1px solid var(--line-soft)", borderRadius: 6,
                          cursor: "pointer", fontFamily: "var(--font-mono)",
                          letterSpacing: "0.04em",
                        }}
                      >{sources.size === eligibleSources.length ? "DESELECT ALL" : "SELECT ALL"}</button>
                    </div>
                    <div style={{
                      display: "flex", flexDirection: "column", gap: 4,
                      maxHeight: 220, overflowY: "auto",
                      border: "1px solid var(--line-soft)", borderRadius: 8, padding: 4,
                    }}>
                      {eligibleSources.map((w) => {
                        const on = sources.has(w.id);
                        const bal = balancesByAddr[w.pubkey] ?? 0;
                        return (
                          <div
                            key={w.id}
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "8px 10px", borderRadius: 6,
                              background: on ? "var(--accent-w)" : "transparent",
                              border: `1px solid ${on ? "var(--accent)" : "transparent"}`,
                              cursor: "pointer",
                            }}
                            onClick={() => toggleSource(w.id)}
                          >
                            <div style={{
                              width: 14, height: 14, borderRadius: 3,
                              background: on ? "var(--accent)" : "var(--ink-0)",
                              border: `1px solid ${on ? "var(--accent)" : "var(--line-soft)"}`,
                            }} />
                            <span style={{ flex: 1, fontSize: 13 }}>{w.displayLabel}</span>
                            <WalletKindChip kind={w.kind} size="xs" />
                            <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)" }}>
                              {bal.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </Field>

              <Field label="Sweep %" hint={`Estimated total: ${estimatedSweep.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL`}>
                <NumberInput value={pct} onChange={(v) => setPct(Math.max(1, Math.min(100, v)))} min={1} max={100} step={1} suffix="%" />
              </Field>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[25, 50, 75, 100].map((p) => (
                  <PickPill key={p} on={pct === p} onClick={() => setPct(p)}>{p}%</PickPill>
                ))}
              </div>
            </>
          )}

          {step === 1 && !done && (
            <>
              <ModalNote>
                Sweep <strong>{pct}%</strong> of {sourceList.length} wallet
                {sourceList.length === 1 ? "" : "s"} → <strong>{wallet.displayLabel}</strong>.
                Estimated total{" "}
                <strong>{estimatedSweep.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL</strong>.
              </ModalNote>
              <div style={{
                maxHeight: 260, overflowY: "auto",
                border: "1px solid var(--line-soft)", borderRadius: 8, padding: 8,
              }}>
                {sourceList.map((w) => {
                  const bal = balancesByAddr[w.pubkey] ?? 0;
                  return (
                    <div key={w.id} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "6px 4px", borderBottom: "1px solid var(--line-soft)",
                      fontSize: 13,
                    }}>
                      <span>{w.displayLabel} <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", marginLeft: 6 }}>{shortAddr(w.pubkey, 5)}</span></span>
                      <strong style={{ color: "var(--accent)" }}>
                        − {(bal * pct / 100).toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL
                      </strong>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {done && (
            <div style={{
              padding: "10px 12px", borderRadius: 8,
              background: "var(--buy-w)",
              border: "1px solid color-mix(in oklch, var(--buy) 40%, transparent)",
              color: "var(--buy)", fontSize: 12, lineHeight: 1.5,
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <strong>Consolidated.</strong>
              <span style={{ fontSize: 11, color: "var(--paper-2)" }}>
                {done.length} tx submitted
              </span>
              {done.slice(0, 3).map((sig) => (
                <a key={sig} href={explorerTxUrl(sig)} target="_blank" rel="noreferrer"
                  className="mono" style={{ fontSize: 10, color: "var(--accent)" }}>
                  {shortAddr(sig, 8, 8)} ↗
                </a>
              ))}
            </div>
          )}

          {err && <ErrorBanner>{err}</ErrorBanner>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Export private key (PLATFORM wallets) ───────────────────────────── */

/**
 * Reveals the bs58 (Solana) secret for a PLATFORM wallet.
 * Two-gate UX: an explicit "I understand" checkbox unlocks the reveal
 * button; the key is fetched and rendered only after a deliberate second
 * click. Copy-to-clipboard via the browser API; the key is never logged.
 *
 * Rejects PHANTOM (no key on file) and DEMO (no on-chain key) wallets.
 */
export function ExportKeyModal({
  wallet, onClose, client,
}: {
  wallet: UserWallet | null;
  onClose: () => void;
  client: BackendClient;
}) {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!wallet) {
      setAck(false); setBusy(false); setErr(null); setSecret(null); setCopied(false);
    }
  }, [wallet]);

  async function reveal() {
    if (!wallet || !ack) return;
    setBusy(true); setErr(null);
    try {
      const res = await client.exportWalletSecret(wallet.id);
      setSecret(res.secret);
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  const blocked = !!wallet && wallet.kind !== "PLATFORM";

  return (
    <Modal open={!!wallet} onClose={busy ? () => {} : onClose} width={520}>
      {wallet && (
        <ModalShell
          title="Export private key"
          onClose={onClose}
          footer={
            secret ? (
              <Btn size="sm" tone="primary" onClick={onClose}>Close</Btn>
            ) : blocked ? (
              <Btn size="sm" tone="ghost" onClick={onClose}>Close</Btn>
            ) : (
              <>
                <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
                <Btn size="sm" tone="sell" onClick={reveal} disabled={!ack || busy}>
                  {busy ? "Decrypting…" : "Reveal key"}
                </Btn>
              </>
            )
          }
        >
          <ModalNote>
            Wallet <strong>{wallet.displayLabel}</strong> &nbsp;·&nbsp;
            <span className="mono" style={{ fontSize: 11 }}>{shortAddr(wallet.pubkey, 6)}</span>
            &nbsp;<WalletKindChip kind={wallet.kind} size="xs" />
          </ModalNote>

          {blocked ? (
            <ErrorBanner>
              This wallet kind has no exportable secret. <strong>PHANTOM</strong> wallets
              live in your browser extension — open Phantom directly to view the key.
              <strong> DEMO</strong> wallets are paper-only.
            </ErrorBanner>
          ) : !secret ? (
            <>
              <div style={{
                padding: "12px 14px", borderRadius: 8,
                background: "var(--sell-w)",
                border: "1px solid color-mix(in oklch, var(--sell) 40%, transparent)",
                color: "var(--sell)",
                fontSize: 12.5, lineHeight: 1.55,
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                <strong style={{ fontSize: 13 }}>Anyone with this key controls the wallet.</strong>
                <span style={{ color: "var(--paper-2)" }}>
                  · Never paste it into a website, Discord, or screen-share.<br />
                  · Raze support will never ask for it.<br />
                  · Save it offline (password manager / hardware-encrypted file).<br />
                  · Treat your clipboard as compromised after copying — clear it.
                </span>
              </div>
              <label style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                fontSize: 12.5, color: "var(--paper)",
                cursor: "pointer", marginTop: 4,
              }}>
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => { setAck(e.target.checked); setErr(null); }}
                  style={{ marginTop: 2 }}
                />
                <span>
                  I understand the key gives full custody of this wallet and I am
                  responsible for keeping it secret.
                </span>
              </label>
            </>
          ) : (
            <>
              <Field label="Private key" hint="Base58 (Solana). Copy and store offline.">
                <div style={{
                  padding: "10px 12px", borderRadius: 8,
                  background: "var(--ink-0)",
                  border: "1px solid var(--line-soft)",
                  color: "var(--paper)",
                  fontFamily: "var(--font-mono)", fontSize: 11.5,
                  lineHeight: 1.5, wordBreak: "break-all", userSelect: "all",
                  maxHeight: 120, overflowY: "auto",
                }}>{secret}</div>
              </Field>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Btn size="sm" tone={copied ? "primary" : "ghost"} onClick={copy}>
                  {copied ? "Copied ✓" : "Copy to clipboard"}
                </Btn>
              </div>
              <ModalNote>
                The key is loaded only into this modal's React state — closing
                the modal drops it. Reopening fetches a fresh decrypt.
              </ModalNote>
            </>
          )}

          {err && <ErrorBanner>{err}</ErrorBanner>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Claim fees (Pump.fun / Meteora) ─────────────────────────────────── */

/**
 * Claim creator / LP fees the wallet has accrued. Pump.fun is one-click
 * (creator pubkey = wallet). Meteora needs the pool address + fee type
 * (creator vs claimer) + amount caps; this surface mirrors history's
 * `/utils/sol/fees/claim` parameters 1:1.
 */
export function ClaimFeesModal({
  wallet, onClose, client,
}: {
  wallet: UserWallet | null;
  onClose: () => void;
  client: BackendClient;
}) {
  const [platform, setPlatform] = useState<"pumpfun" | "meteora">("pumpfun");
  // Meteora-only fields
  const [feeType, setFeeType] = useState<"creator" | "claimer">("creator");
  const [pool, setPool] = useState("");
  const [maxBase, setMaxBase] = useState<number>(0);
  const [maxQuote, setMaxQuote] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);

  useEffect(() => {
    if (!wallet) {
      setPlatform("pumpfun"); setFeeType("creator");
      setPool(""); setMaxBase(0); setMaxQuote(0);
      setBusy(false); setErr(null); setDone(null);
    }
  }, [wallet]);

  const canSubmit = platform === "pumpfun"
    ? true
    : looksLikeSolanaAddress(pool);

  async function submit() {
    if (!wallet) return;
    setBusy(true); setErr(null);
    try {
      const args = platform === "pumpfun"
        ? { walletId: wallet.id, platform: "pumpfun" as const }
        : {
          walletId: wallet.id,
          platform: "meteora" as const,
          feeType,
          pool: pool.trim(),
          maxBaseAmount: maxBase > 0 ? maxBase : undefined,
          maxQuoteAmount: maxQuote > 0 ? maxQuote : undefined,
        };
      const res = await client.claimFees(args);
      setDone(res.signatures);
    } catch (e) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={!!wallet} onClose={busy ? () => {} : onClose} width={520}>
      {wallet && (
        <ModalShell
          title="Claim fees"
          onClose={onClose}
          footer={
            done ? (
              <Btn size="sm" tone="primary" onClick={onClose}>Done</Btn>
            ) : (
              <>
                <Btn size="sm" tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
                <Btn size="sm" tone="primary" onClick={submit} disabled={busy || !canSubmit}>
                  {busy ? "Claiming…" : "Claim"}
                </Btn>
              </>
            )
          }
        >
          <ModalNote>
            Wallet <strong>{wallet.displayLabel}</strong> &nbsp;·&nbsp;
            <span className="mono" style={{ fontSize: 11 }}>{shortAddr(wallet.pubkey, 6)}</span>
            <br />
            Pump.fun routes creator-fee shares to whichever wallet created the
            token. Meteora claims liquidity fees from a DLMM/DBC pool you
            own as creator or fee-claimer.
          </ModalNote>

          <Field label="Platform">
            <div style={{ display: "flex", gap: 8 }}>
              <PickPill on={platform === "pumpfun"} onClick={() => setPlatform("pumpfun")}>
                Pump.fun
              </PickPill>
              <PickPill on={platform === "meteora"} onClick={() => setPlatform("meteora")}>
                Meteora
              </PickPill>
            </div>
          </Field>

          {platform === "meteora" && (
            <>
              <Field label="Fee role">
                <div style={{ display: "flex", gap: 8 }}>
                  <PickPill on={feeType === "creator"} onClick={() => setFeeType("creator")}>
                    Creator
                  </PickPill>
                  <PickPill on={feeType === "claimer"} onClick={() => setFeeType("claimer")}>
                    Fee claimer
                  </PickPill>
                </div>
              </Field>
              <Field label="Pool address" hint="The Meteora DLMM / DBC pool you claim from.">
                <TextInput value={pool} onChange={(v) => { setPool(v); setErr(null); }} mono placeholder="Pool…" />
              </Field>
              <FieldGrid cols={2}>
                <Field label="Max base" hint="Optional cap. 0 = unlimited.">
                  <NumberInput value={maxBase} onChange={setMaxBase} min={0} step={0.01} />
                </Field>
                <Field label="Max quote" hint="Optional cap. 0 = unlimited.">
                  <NumberInput value={maxQuote} onChange={setMaxQuote} min={0} step={0.01} />
                </Field>
              </FieldGrid>
            </>
          )}

          {done && (
            <div style={{
              padding: "10px 12px", borderRadius: 8,
              background: "var(--buy-w)",
              border: "1px solid color-mix(in oklch, var(--buy) 40%, transparent)",
              color: "var(--buy)", fontSize: 12, lineHeight: 1.5,
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <strong>Claimed.</strong>
              {done.map((sig) => (
                <a key={sig} href={explorerTxUrl(sig)} target="_blank" rel="noreferrer"
                  className="mono" style={{ fontSize: 10, color: "var(--accent)" }}>
                  {shortAddr(sig, 8, 8)} ↗
                </a>
              ))}
            </div>
          )}

          {err && <ErrorBanner>{err}</ErrorBanner>}
        </ModalShell>
      )}
    </Modal>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function PickPill({
  on, onClick, children, disabled,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); if (!disabled) onClick(); }}
      disabled={disabled}
      style={{
        background: on ? "var(--accent)" : "transparent",
        color: on ? "var(--ink-0)" : "var(--paper-2)",
        border: `1px solid ${on ? "var(--accent)" : "var(--line-soft)"}`,
        borderRadius: 8,
        padding: "7px 14px",
        fontFamily: "var(--font-ui)",
        fontSize: 12, fontWeight: 500,
        letterSpacing: "-0.005em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background 120ms, color 120ms, border-color 120ms",
        display: "inline-flex", alignItems: "center", gap: 4,
      }}
    >{children}</button>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: "var(--sell-w)",
      border: "1px solid color-mix(in oklch, var(--sell) 40%, transparent)",
      color: "var(--sell)", fontSize: 12, lineHeight: 1.45,
    }}>{children}</div>
  );
}

/** Tiny pseudo-QR (deterministic checkerboard from address bytes). Replaces a
 *  real QR encoder until one is bundled — readable as a visual identity, not
 *  a scannable barcode. Real QR can drop in here without changing callers. */
function QrPlaceholder({ text, size = 132 }: { text: string; size?: number }) {
  // Hash the address into a 21×21 boolean grid via a simple xorshift seed.
  const grid = useMemo(() => {
    const n = 21;
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    const out: boolean[] = [];
    for (let i = 0; i < n * n; i++) {
      // xorshift32
      h ^= h << 13; h >>>= 0;
      h ^= h >> 17; h >>>= 0;
      h ^= h << 5;  h >>>= 0;
      out.push((h & 1) === 0);
    }
    // Carve fake finder patterns in three corners
    const corners: Array<[number, number]> = [[0, 0], [0, n - 7], [n - 7, 0]];
    for (const [cy, cx] of corners) {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const onEdge = y === 0 || y === 6 || x === 0 || x === 6;
        const onInner = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        out[(cy + y) * n + (cx + x)] = onEdge || onInner;
      }
    }
    return out;
  }, [text]);
  const n = 21;
  const cell = size / n;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} style={{
      background: "var(--paper)",
      borderRadius: 6,
      padding: 2,
    }}>
      {grid.map((on, i) => {
        if (!on) return null;
        const x = i % n;
        const y = Math.floor(i / n);
        return <rect key={i} x={x} y={y} width={1} height={1} fill="var(--ink-0)" />;
      })}
      {/* center brand mark */}
      <rect x={n / 2 - 1.5} y={n / 2 - 1.5} width={3} height={3} fill="var(--paper)" />
      <circle cx={n / 2} cy={n / 2} r={1} fill="var(--accent)" />
      <style>{`svg { padding: 0; }`}</style>
      {/* Suppress unused var warning */}
      <desc>{cell}</desc>
    </svg>
  );
}
