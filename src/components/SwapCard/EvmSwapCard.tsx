"use client";
/**
 * Any-pair swap on an EVM chain (Ethereum, BNB Chain, Base, Robinhood) on the
 * Raze EVM router: the chain's native coin, its quote tokens or any token by
 * address, a live quote with its minimum and venue, slippage, and the swap
 * from an EVM wallet of the vault. The server builds, checks and signs the
 * approvals and the swap and waits for the receipt (server/evm.mjs).
 *
 * Exact-in only, like the router: you set what you pay.
 */
import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../../contexts/AppContext";
import { useUserWallets } from "../../hooks/useUserWallets";
import { CHAINS, explorerTxUrl, type ChainId } from "../../lib/chains";
import { shortAddr } from "../../lib/format";
import { quoteMints } from "../../lib/quoteMints";
import { toRaw, toUi } from "../../lib/swap/quote";
import { useDocumentHidden } from "../../lib/swap/useSwapQuote";
import { evmMintId, evmRouteLabel, evmRoutes, vault } from "../../lib/vault/client";
import { useEvmDecimals, useEvmQuote } from "../../lib/evm/useEvmQuote";

const SLIPPAGE_PRESETS = [10, 50, 100]; // bps
/** A preview quote older than this is not traded: a fresh one is asked. */
const MAX_QUOTE_AGE_MS = 10_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CUSTOM = "custom";

type Stage = "quote" | "sign" | "confirm";
const STAGE_LABEL: Record<Stage, string> = {
  quote: "Quoting…",
  sign: "Building, signing, sending…",
  confirm: "Confirming…",
};

function fmt(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  return n.toLocaleString("en-US", { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 4 : 8 });
}

function rawToText(raw: bigint, decimals: number): string {
  if (raw <= 0n) return "";
  const s = raw.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

const box: React.CSSProperties = {
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  borderRadius: 10,
  padding: "12px 14px",
};

const chip: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--ink-2)",
  border: "1px solid var(--line-soft)",
  borderRadius: 6,
  color: "var(--paper-2)",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  cursor: "pointer",
};

const micro: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: 0.9,
  textTransform: "uppercase",
  color: "var(--paper-4)",
};

const field: React.CSSProperties = {
  flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none",
  color: "var(--paper)", fontFamily: "var(--font-mono)",
};

function DRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}>
      <span style={{ color: "var(--paper-3)" }}>{label}</span>
      <span style={{ flex: 1, borderBottom: "1px dotted var(--line-soft)", transform: "translateY(3px)" }} />
      <span style={{ color: "var(--paper)", fontFamily: "var(--font-mono)" }}>{children}</span>
    </div>
  );
}

/** A side of the swap: one of the chain's known quote assets, or a token by address. */
function TokenSelect({ chain, choice, address, onChoice, onAddress }: {
  chain: ChainId;
  choice: string;
  address: string;
  onChoice: (v: string) => void;
  onAddress: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      <select
        value={choice}
        onChange={(e) => onChoice(e.target.value)}
        aria-label="Token"
        style={{ ...chip, padding: "6px 8px", fontSize: 12, color: "var(--paper)" }}
      >
        {quoteMints(chain).map((m) => (
          <option key={m.label} value={m.label}>{m.label}</option>
        ))}
        <option value={CUSTOM}>Token address…</option>
      </select>
      {choice === CUSTOM && (
        <input
          value={address}
          onChange={(e) => onAddress(e.target.value.trim())}
          placeholder="0x…"
          aria-label="Token address"
          spellCheck={false}
          style={{
            ...chip, width: 150, fontSize: 11, cursor: "text",
            color: address && !ADDRESS.test(address) ? "var(--sell)" : "var(--paper)",
          }}
        />
      )}
    </div>
  );
}

/** The token a side names: `native`, a lowercase address, or null. */
function tokenOf(chain: ChainId, choice: string, address: string): string | null {
  if (choice === CUSTOM) return ADDRESS.test(address) ? address.toLowerCase() : null;
  const m = quoteMints(chain).find((q) => q.label === choice);
  return m ? (m.mint ? m.mint.toLowerCase() : "native") : null;
}

function labelOf(choice: string, address: string): string {
  return choice === CUSTOM ? (ADDRESS.test(address) ? shortAddr(address, 4) : "token") : choice;
}

export function EvmSwapCard({ chain }: { chain: ChainId }) {
  const { pushToast } = useApp();
  const userWallets = useUserWallets();
  const tabHidden = useDocumentHidden();
  const known = quoteMints(chain);

  const [fromChoice, setFromChoice] = useState(known[0].label);
  const [fromAddr, setFromAddr] = useState("");
  const [toChoice, setToChoice] = useState(known[1]?.label ?? CUSTOM);
  const [toAddr, setToAddr] = useState("");
  const [amountText, setAmountText] = useState("");
  const [debounced, setDebounced] = useState(amountText);
  const [slippageBps, setSlippageBps] = useState(50);
  const [signerId, setSignerId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [held, setHeld] = useState<{ key: string; raw: bigint } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(amountText), 300);
    return () => clearTimeout(t);
  }, [amountText]);

  const signers = useMemo(() => userWallets.wallets.filter((w) => !w.watchOnly), [userWallets.wallets]);
  const defaultId = userWallets.activeWallets[0]?.id ?? signers[0]?.id ?? null;
  const chosen = signers.find((w) => w.id === (signerId ?? defaultId)) ?? signers.find((w) => w.id === defaultId) ?? null;

  const tokenIn = tokenOf(chain, fromChoice, fromAddr);
  const tokenOut = tokenOf(chain, toChoice, toAddr);
  const inLabel = labelOf(fromChoice, fromAddr);
  const outLabel = labelOf(toChoice, toAddr);
  const inDec = useEvmDecimals(chain, tokenIn);
  const outDec = useEvmDecimals(chain, tokenOut);
  const amountRaw = useMemo(() => (inDec === null ? null : toRaw(debounced, inDec)), [debounced, inDec]);
  const same = tokenIn !== null && tokenIn === tokenOut;

  const q = useEvmQuote({
    chain,
    tokenIn: same ? null : tokenIn,
    tokenOut: same ? null : tokenOut,
    amountIn: amountRaw,
    slippageBps,
    paused: tabHidden || stage !== null,
  });

  const balanceKey = `${chosen?.pubkey ?? ""}|${tokenIn ?? ""}`;
  useEffect(() => {
    if (!chosen || !tokenIn) return;
    let cancelled = false;
    evmRoutes.balance(chain, chosen.pubkey, tokenIn)
      .then((b) => { if (!cancelled && b.raw != null) setHeld({ key: balanceKey, raw: BigInt(b.raw) }); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceKey, tick, chain]);
  const balance = held?.key === balanceKey ? held.raw : null;

  const quote = q.quote;
  // The quote on screen is for what is typed now (not the previous amount or pair).
  const quoteMatches = !!quote && amountRaw !== null && quote.inAmount === amountRaw.toString()
    && evmMintId(quote.inputMint) === tokenIn && evmMintId(quote.outputMint) === tokenOut;
  const uiIn = amountRaw !== null && inDec !== null ? toUi(amountRaw, inDec) : 0;
  const uiOut = quoteMatches && outDec !== null ? toUi(BigInt(quote!.outAmount), outDec) : 0;
  const minOut = quoteMatches && outDec !== null ? toUi(BigInt(quote!.otherAmountThreshold), outDec) : 0;
  const insufficient = balance !== null && amountRaw !== null && amountRaw > balance;
  const canSwap = !!chosen && !!tokenIn && !!tokenOut && !same && amountRaw !== null && stage === null && !insufficient && !q.noRoute;

  async function doSwap() {
    if (!chosen || !tokenIn || !tokenOut || amountRaw === null) return;
    const what = `${fmt(uiIn)} ${inLabel} → ${outLabel}`;
    try {
      let quoteToken = quoteMatches && Date.now() - q.updatedAt < MAX_QUOTE_AGE_MS ? quote!.quoteToken : null;
      if (!quoteToken) {
        setStage("quote");
        quoteToken = (await evmRoutes.quote({ chain, inputMint: tokenIn, outputMint: tokenOut, amount: amountRaw.toString(), slippageBps })).quoteToken;
      }
      setStage("sign");
      const { signature } = await vault.swap(chosen.id, quoteToken);
      setStage("confirm");
      await evmRoutes.confirm(chain, signature);
      pushToast({
        title: "SWAP CONFIRMED",
        body: <a href={explorerTxUrl(signature, chain)} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{what} ↗</a>,
        tone: "buy",
        duration: 8000,
      });
      setTick((t) => t + 1);
      void userWallets.refreshBalances();
    } catch (e) {
      pushToast({ title: "SWAP FAILED", body: e instanceof Error ? e.message : String(e), tone: "sell", duration: 8000 });
    } finally {
      setStage(null);
    }
  }

  const ctaText = stage
    ? STAGE_LABEL[stage]
    : !chosen
      ? "Add an EVM wallet to swap"
      : !tokenIn || !tokenOut
        ? "Pick both tokens"
        : same
          ? "Pick two different tokens"
          : q.noRoute
            ? "No route on the EVM router"
            : insufficient
              ? `Not enough ${inLabel}`
              : amountRaw === null
                ? "Enter an amount"
                : `Swap ${inLabel} → ${outLabel}`;

  return (
    <div style={{ width: "100%", maxWidth: 460, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--paper)" }}>Swap on {CHAINS[chain].name}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--paper-3)" }}>
          <span style={{
            width: 6, height: 6, borderRadius: 999,
            background: q.status === "live" ? "var(--buy)" : q.status === "error" ? "var(--sell)" : "var(--paper-4)",
          }} />
          {q.status === "live" ? "Live" : q.status === "error" ? "Retrying" : q.status === "connecting" ? "Quoting" : "Idle"}
        </span>
      </div>

      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={micro}>You pay</span>
          {balance !== null && inDec !== null && (
            <span style={{ fontSize: 11, color: "var(--paper-3)", fontFamily: "var(--font-mono)" }}>
              {fmt(toUi(balance, inDec))} {inLabel}
              {tokenIn !== "native" && (
                <button type="button" onClick={() => { const t = rawToText(balance, inDec); setAmountText(t); setDebounced(t); }}
                  style={{ ...chip, marginLeft: 6, padding: "1px 6px", fontSize: 10 }}>Max</button>
              )}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            placeholder="0"
            aria-label="Amount to pay"
            style={{ ...field, fontSize: 26, color: insufficient ? "var(--sell)" : "var(--paper)" }}
          />
          <TokenSelect chain={chain} choice={fromChoice} address={fromAddr} onChoice={setFromChoice} onAddress={setFromAddr} />
        </div>
      </div>

      <div style={box}>
        <div style={{ marginBottom: 6 }}><span style={micro}>You receive</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ ...field, fontSize: 26, color: uiOut > 0 ? "var(--paper)" : "var(--paper-4)" }}>
            {uiOut > 0 ? fmt(uiOut) : q.status === "connecting" ? "…" : "0"}
          </span>
          <TokenSelect chain={chain} choice={toChoice} address={toAddr} onChoice={setToChoice} onAddress={setToAddr} />
        </div>
      </div>

      <div style={{ ...box, padding: "8px 14px" }}>
        <DRow label="Minimum received">{quoteMatches && outDec !== null ? `${fmt(minOut)} ${outLabel}` : "—"}</DRow>
        <DRow label="Route">
          {quote && quoteMatches ? evmRouteLabel(quote) : "—"}
        </DRow>
        <DRow label="Slippage">
          <span style={{ display: "inline-flex", gap: 4 }}>
            {SLIPPAGE_PRESETS.map((b) => (
              <button key={b} type="button" onClick={() => setSlippageBps(b)}
                style={{ ...chip, padding: "1px 6px", color: slippageBps === b ? "var(--paper)" : "var(--paper-3)", borderColor: slippageBps === b ? "var(--line)" : "var(--line-soft)" }}>
                {b / 100}%
              </button>
            ))}
          </span>
        </DRow>
        <DRow label="Wallet">
          {signers.length > 1 ? (
            <select value={chosen?.id ?? ""} onChange={(e) => setSignerId(e.target.value)} aria-label="Wallet"
              style={{ ...chip, padding: "1px 6px" }}>
              {signers.map((w) => <option key={w.id} value={w.id}>{w.displayLabel}</option>)}
            </select>
          ) : (chosen ? chosen.displayLabel : "none")}
        </DRow>
        {q.status === "error" && q.error && (
          <div style={{ fontSize: 11, color: "var(--sell)", paddingTop: 4 }}>{q.error}</div>
        )}
      </div>

      <button
        type="button"
        onClick={doSwap}
        disabled={!canSwap}
        style={{
          width: "100%", padding: "14px 16px", fontSize: 15, fontWeight: 700,
          color: "var(--ink-0)", background: canSwap ? "var(--buy)" : "var(--ink-3, #2a2a2a)",
          border: 0, borderRadius: 999, cursor: canSwap ? "pointer" : "not-allowed",
        }}
      >
        {ctaText}
      </button>
      <div style={{ fontSize: 10.5, color: "var(--paper-4)", textAlign: "center", lineHeight: 1.5 }}>
        A token you pay with is approved for the exact amount before the swap, in its own transaction.
      </div>
    </div>
  );
}
