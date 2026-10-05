"use client";
/**
 * Any-pair Solana swap on the Raze router (what swap.raze.bot was): a live
 * quote, the route and its split, the DEX filter, slippage, and the swap
 * itself from the connected browser wallet or a local wallet.
 *
 * The quote on screen is the one that is built: the floor shown is the floor
 * the program enforces, and a quote older than 10 s is never built.
 */
import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { TokenIcon } from "../atoms";
import { useApp } from "../../contexts/AppContext";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useUserWallets } from "../../hooks/useUserWallets";
import { localSolanaSigners } from "../../api/localWallets";
import { solanaSigner } from "../../api/localTrade";
import { explorerTxUrl } from "../../lib/chains";
import { shortAddr } from "../../lib/format";
import { BROWSER_WALLET_ID, useBrowserWallet } from "../../lib/swap/browserWallet";
import { FALLBACK_VENUES, fetchVenues, tokenBalanceRaw } from "../../lib/swap/client";
import {
  executeSwap,
  needsV0,
  signerReserveKeys,
  swapErrorText,
  type SwapSigner,
  type SwapStage,
} from "../../lib/swap/execute";
import { legLabel, SOL_MINT, toRaw, toUi, USDC_MINT, viaLabel, type VenueInfo } from "../../lib/swap/quote";
import {
  QUOTE_POLL_MS,
  useDocumentHidden,
  useMintDecimals,
  useSwapQuote,
  type QuoteStatus,
} from "../../lib/swap/useSwapQuote";
import { BrowserWalletSection } from "../TradingPanel/BrowserWalletSection";
import { TokenPicker } from "./TokenPicker";
import { STABLES, tokenFor, type SwapToken } from "./tokens";

const SLIPPAGE_PRESETS = [10, 50, 100]; // bps
/** A quote older than this is not built: wait for the next one. */
const MAX_QUOTE_AGE_MS = 10_000;
/** Left in the wallet by "Max" on SOL: fees and a new token account's rent. */
const SOL_RESERVE_LAMPORTS = 10_000_000n;

const STATUS_LABEL: Record<QuoteStatus, string> = {
  connecting: "Quoting",
  live: "Live",
  idle: "Idle",
  error: "Retrying",
};

const STAGE_LABEL: Record<SwapStage, string> = {
  quote: "Quoting…",
  build: "Building transaction…",
  sign: "Signing…",
  send: "Sending…",
  confirm: "Confirming…",
};

function fmt(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const frac = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { maximumFractionDigits: frac });
}

function fmtUsd(n: number | null): string {
  if (n == null || !isFinite(n)) return "";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 2 : 4 })}`;
}

/** Raw units → the exact decimal text for the amount field. */
function rawToText(raw: bigint, decimals: number): string {
  if (raw <= 0n) return "";
  const s = raw.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

function venueHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function impactColor(bps: number): string {
  if (bps >= 500) return "var(--sell)";
  if (bps >= 100) return "var(--amber, #F2C86B)";
  return "var(--paper-2)";
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

function DRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}>
      <span style={{ color: "var(--paper-3)" }}>{label}</span>
      <span style={{ flex: 1, borderBottom: "1px dotted var(--line-soft)", transform: "translateY(3px)" }} />
      <span style={{ color: "var(--paper)", fontFamily: "var(--font-mono)" }}>{children}</span>
    </div>
  );
}

function TokenButton({ token, onClick }: { token: SwapToken; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0,
        padding: "6px 10px 6px 6px",
        background: "var(--ink-2)", border: "1px solid var(--line-soft)", borderRadius: 999,
        color: "var(--paper)", fontSize: 13, fontWeight: 600, cursor: "pointer",
      }}
    >
      <TokenIcon token={{ mint_address: token.mint, symbol: token.symbol, image: token.image ?? undefined, chain: "sol" }} size={22} />
      {token.symbol}
      <span aria-hidden style={{ color: "var(--paper-4)", fontSize: 10 }}>▾</span>
    </button>
  );
}

export function SwapCard() {
  const { pushToast } = useApp();
  const solPrice = useSolPrice();
  const userWallets = useUserWallets();
  const browser = useBrowserWallet();
  const tabHidden = useDocumentHidden();

  const [inputMint, setInputMint] = useState(SOL_MINT);
  const [outputMint, setOutputMint] = useState(USDC_MINT);
  const [amountText, setAmountText] = useState("0.1");
  const [debounced, setDebounced] = useState(amountText);
  const [slippageBps, setSlippageBps] = useState(50);
  const [slipCustom, setSlipCustom] = useState("");
  const [invertRate, setInvertRate] = useState(false);
  const [venues, setVenues] = useState<VenueInfo[]>(FALLBACK_VENUES);
  const [disabledDex, setDisabledDex] = useState<Set<string>>(new Set());
  const [dexOpen, setDexOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);
  const [signerId, setSignerId] = useState<string | null>(null);
  const [stage, setStage] = useState<SwapStage | null>(null);
  const [balance, setBalance] = useState<{ key: string; raw: bigint } | null>(null);
  const [balanceTick, setBalanceTick] = useState(0);
  // Local wallets with a key, read after mount (localStorage).
  const [locals, setLocals] = useState<Array<{ id: string; pubkey: string; label: string | null }>>([]);

  useEffect(() => {
    setLocals(localSolanaSigners());
  }, [userWallets.wallets]);

  useEffect(() => {
    fetchVenues().then(setVenues).catch(() => { /* keep the fallback list */ });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(amountText), 300);
    return () => clearTimeout(t);
  }, [amountText]);

  // ── who pays ──────────────────────────────────────────────────────────
  const options = useMemo(() => [
    ...(browser.connected
      ? [{ id: BROWSER_WALLET_ID, label: browser.connected.wallet.name, pubkey: browser.connected.address }]
      : []),
    ...locals.map((w) => ({ id: w.id, label: w.label || `Wallet ${shortAddr(w.pubkey, 4)}`, pubkey: w.pubkey })),
  ], [browser.connected, locals]);
  const defaultId = useMemo(() => {
    const activeLocal = userWallets.activeWallets.find((w) => locals.some((l) => l.id === w.id));
    if (activeLocal) return activeLocal.id;
    if (browser.connected) return BROWSER_WALLET_ID;
    return locals[0]?.id ?? null;
  }, [userWallets.activeWallets, locals, browser.connected]);
  const chosenId = signerId && options.some((o) => o.id === signerId) ? signerId : defaultId;
  const chosen = options.find((o) => o.id === chosenId) ?? null;
  const signer: SwapSigner | null = useMemo(() => {
    if (!chosenId) return null;
    try {
      return solanaSigner(chosenId);
    } catch {
      return null;
    }
    // browser.connected: the browser signer follows the connected account
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenId, browser.connected]);

  // ── the quote ─────────────────────────────────────────────────────────
  const inDec = useMintDecimals(inputMint);
  const outDec = useMintDecimals(outputMint);
  const amountRaw = useMemo(() => (inDec === null ? null : toRaw(debounced, inDec)), [debounced, inDec]);
  const excludeDexes = useMemo(
    () => venues.filter((v) => disabledDex.has(v.dex)).map((v) => v.dex),
    [venues, disabledDex],
  );
  const reserveKeys = signer ? signerReserveKeys(signer) : undefined;
  const q = useSwapQuote({
    inputMint,
    outputMint,
    amount: amountRaw,
    slippageBps,
    excludeDexes,
    reserveKeys,
    paused: tabHidden || stage !== null,
  });

  // One read of what the paying wallet holds, again after each swap.
  const balanceKey = `${chosen?.pubkey ?? ""}|${inputMint}`;
  useEffect(() => {
    if (!chosen) return;
    let cancelled = false;
    tokenBalanceRaw(chosen.pubkey, inputMint)
      .then((raw) => { if (!cancelled) setBalance({ key: balanceKey, raw }); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceKey, balanceTick]);
  const held = balance?.key === balanceKey ? balance.raw : null;

  const quote = q.quote;
  const inTok = tokenFor(inputMint);
  const outTok = tokenFor(outputMint);
  const uiIn = amountRaw !== null && inDec !== null ? toUi(amountRaw, inDec) : 0;
  const uiOut = quote && outDec !== null ? toUi(quote.outAmount, outDec) : 0;
  const rate = uiIn > 0 && uiOut > 0 ? uiOut / uiIn : 0;
  const minReceived = quote && outDec !== null ? toUi(quote.threshold, outDec) : 0;
  const impactBps = quote?.priceImpactBps ?? 0;
  const legs = quote?.legs ?? [];
  const bestLegOut = legs.reduce((m, l) => (l.outAmount > m ? l.outAmount : m), 0n);
  const quoting = q.status === "connecting" && !quote && !q.noRoute;
  const noRouteText = q.noRouteText ?? "No route";

  // Fiat: stables at $1, SOL at the live price, a searched token at its row's
  // price; a leg without a price borrows the other leg's value (same trade).
  const usdOf = (mint: string, ui: number): number | null => {
    if (ui <= 0) return null;
    if (STABLES.has(mint)) return ui;
    if (mint === SOL_MINT) return solPrice ? ui * solPrice : null;
    const p = tokenFor(mint).priceSol;
    return p && solPrice ? ui * p * solPrice : null;
  };
  const inUsd = usdOf(inputMint, uiIn) ?? usdOf(outputMint, uiOut);
  const outUsd = usdOf(outputMint, uiOut) ?? usdOf(inputMint, uiIn);

  const quoteMatches =
    !!quote && quote.inputMint === inputMint && quote.outputMint === outputMint &&
    amountRaw !== null && quote.inAmount === amountRaw;
  const insufficient = held !== null && amountRaw !== null && amountRaw > held;
  const canSwap = !!signer && quoteMatches && !q.noRoute && uiOut > 0 && stage === null && !insufficient;

  const flip = () => {
    // What you were receiving becomes what you pay.
    const flipped = uiOut > 0 && outDec !== null && quote ? rawToText(quote.outAmount, outDec) : null;
    setInputMint(outputMint);
    setOutputMint(inputMint);
    if (flipped) {
      setAmountText(flipped);
      setDebounced(flipped);
    }
  };

  const setMax = () => {
    if (held === null || inDec === null) return;
    const raw = inputMint === SOL_MINT ? (held > SOL_RESERVE_LAMPORTS ? held - SOL_RESERVE_LAMPORTS : 0n) : held;
    const text = rawToText(raw, inDec);
    setAmountText(text);
    setDebounced(text);
  };

  const toggleDex = (dex: string) => {
    setDisabledDex((prev) => {
      const next = new Set(prev);
      if (next.has(dex)) next.delete(dex);
      else {
        if (venues.length - next.size <= 1) return prev; // keep one venue on
        next.add(dex);
      }
      return next;
    });
  };

  const onSlipCustom = (txt: string) => {
    const clean = txt.replace(/[^0-9.]/g, "");
    setSlipCustom(clean);
    const pct = Number(clean);
    if (isFinite(pct) && pct > 0) setSlippageBps(Math.min(5000, Math.max(1, Math.round(pct * 100))));
  };

  async function doSwap() {
    if (!signer || !quote || amountRaw === null) return;
    if (Date.now() - q.updatedAt > MAX_QUOTE_AGE_MS) {
      pushToast({ title: "STALE QUOTE", body: "Wait for a fresh quote, then swap.", tone: "sell" });
      return;
    }
    const what = `${fmt(uiIn)} ${inTok.symbol} → ${fmt(uiOut)} ${outTok.symbol}`;
    try {
      const res = await executeSwap(
        signer,
        { inputMint, outputMint, amount: amountRaw, swapMode: "ExactIn", slippageBps, excludeDexes },
        { quote: quote.raw, onStage: setStage },
      );
      pushToast({
        title: "SWAP CONFIRMED",
        body: <a href={explorerTxUrl(res.signature)} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{what} ↗</a>,
        tone: "buy",
        duration: 8000,
      });
      setBalanceTick((t) => t + 1);
      void userWallets.refreshBalances();
    } catch (e) {
      pushToast({ title: "SWAP FAILED", body: swapErrorText(e), tone: "sell", duration: 8000 });
    } finally {
      setStage(null);
    }
  }

  const ctaText = stage
    ? stage === "sign" && signer?.kind === "browser" ? "Approve in your wallet…" : STAGE_LABEL[stage]
    : !signer
      ? "Connect a wallet to swap"
      : q.noRoute
        ? noRouteText
        : insufficient
          ? `Not enough ${inTok.symbol}`
          : uiOut > 0
            ? `Swap ${inTok.symbol} → ${outTok.symbol}`
            : q.status === "error"
              ? "Router unreachable"
              : "Enter an amount";

  return (
    <div style={{ width: "100%", maxWidth: 460, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--paper)" }}>Swap</span>
        <span
          title={`Router quotes every ${QUOTE_POLL_MS} ms`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--paper-3)",
          }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: 999,
            background: q.status === "live" ? "var(--buy)" : q.status === "error" ? "var(--sell)" : "var(--paper-4)",
          }} />
          {STATUS_LABEL[q.status]}
          {q.slot > 0 && <span style={{ color: "var(--paper-4)" }}>{q.slot.toLocaleString("en-US")}</span>}
        </span>
      </div>

      {/* pay */}
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={micro}>You pay</span>
          {held !== null && inDec !== null && (
            <span style={{ fontSize: 11, color: "var(--paper-3)", fontFamily: "var(--font-mono)" }}>
              {fmt(toUi(held, inDec))} {inTok.symbol}
              <button type="button" onClick={setMax} style={{ ...chip, marginLeft: 6, padding: "1px 6px", fontSize: 10 }}>Max</button>
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
            style={{
              flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none",
              color: insufficient ? "var(--sell)" : "var(--paper)", fontSize: 26, fontFamily: "var(--font-mono)",
            }}
          />
          <TokenButton token={inTok} onClick={() => setPickerFor("in")} />
        </div>
        <div style={{ fontSize: 11, color: "var(--paper-4)", minHeight: 14, marginTop: 4 }}>
          {inDec === null ? "reading decimals…" : fmtUsd(inUsd)}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", margin: "-14px 0", zIndex: 1 }}>
        <button
          type="button"
          onClick={flip}
          aria-label="Flip direction"
          style={{
            width: 34, height: 34, borderRadius: 10,
            background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--paper-2)",
            cursor: "pointer", fontSize: 15,
          }}
        >⇅</button>
      </div>

      {/* receive */}
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={micro}>You receive</span>
          {quote && (
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: impactColor(impactBps) }}>
              {(impactBps / 100).toFixed(2)}% impact
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            flex: 1, minWidth: 0, fontSize: 26, fontFamily: "var(--font-mono)",
            color: q.noRoute ? "var(--paper-4)" : "var(--paper)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {quoting ? "…" : q.noRoute ? noRouteText : uiOut > 0 ? fmt(uiOut) : "—"}
          </div>
          <TokenButton token={outTok} onClick={() => setPickerFor("out")} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--paper-4)", minHeight: 14, marginTop: 4 }}>
          <span>{fmtUsd(outUsd)}</span>
          {quote && <span style={{ fontFamily: "var(--font-mono)" }}>via {viaLabel(quote)}</span>}
        </div>
      </div>

      {/* rate + slippage */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11.5 }}>
        {rate > 0 ? (
          <button type="button" onClick={() => setInvertRate(!invertRate)} title="Invert" style={{ ...chip, background: "transparent", border: 0, padding: 0, color: "var(--paper-2)" }}>
            1 {invertRate ? outTok.symbol : inTok.symbol} ≈ <b>{fmt(invertRate ? 1 / rate : rate)}</b> {invertRate ? inTok.symbol : outTok.symbol} ⇄
          </button>
        ) : (
          <span style={{ color: "var(--paper-4)" }}>
            {q.noRoute ? `${noRouteText} for this pair` : q.status === "error" && !quote ? (q.error ?? "Router unreachable, retrying…") : quoting ? "Fetching best price…" : "Enter an amount"}
          </span>
        )}
        <span style={{ display: "inline-flex", gap: 4 }}>
          {SLIPPAGE_PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setSlippageBps(s); setSlipCustom(""); }}
              style={{ ...chip, ...(s === slippageBps && !slipCustom ? { color: "var(--ink-0)", background: "var(--accent)", borderColor: "var(--accent)" } : {}) }}
            >
              {s / 100}%
            </button>
          ))}
          <button type="button" onClick={() => setDetailsOpen((v) => !v)} style={{ ...chip, ...(detailsOpen ? { borderColor: "var(--accent)" } : {}) }} aria-label="Details">⚙</button>
        </span>
      </div>

      {detailsOpen && (
        <div style={{ ...box, padding: "8px 14px" }}>
          <DRow label="Rate">{rate > 0 ? `1 ${inTok.symbol} = ${fmt(rate)} ${outTok.symbol}` : "—"}</DRow>
          <DRow label="Price impact"><span style={{ color: impactColor(impactBps) }}>{quote ? `${(impactBps / 100).toFixed(2)}%` : "—"}</span></DRow>
          <DRow label="Min. received">{minReceived > 0 ? `${fmt(minReceived)} ${outTok.symbol}` : "—"}</DRow>
          <DRow label="Max slippage">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input
                inputMode="decimal"
                value={slipCustom}
                placeholder={String(slippageBps / 100)}
                onChange={(e) => onSlipCustom(e.target.value)}
                aria-label="Custom slippage %"
                style={{ width: 52, padding: "2px 6px", background: "var(--ink-2)", border: "1px solid var(--line-soft)", borderRadius: 4, color: "var(--paper)", fontFamily: "var(--font-mono)", fontSize: 11 }}
              />
              %
            </span>
          </DRow>
          <DRow label="Route">{quote ? viaLabel(quote) : "—"}</DRow>
          {signer && <DRow label="Transaction">{needsV0(signer) ? "v0 · compact routes (wallet has no v1 yet)" : "v1"}</DRow>}
          <DRow label="Priority fee">router estimate, max 0.0005 SOL</DRow>
          <DRow label="Transport">{q.status === "live" ? `Router REST · every ${QUOTE_POLL_MS} ms` : "—"}</DRow>
        </div>
      )}

      {/* who pays */}
      {options.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
          <span style={micro}>Pay from</span>
          <select
            value={chosenId ?? ""}
            onChange={(e) => setSignerId(e.target.value)}
            style={{ flex: 1, minWidth: 0, padding: "5px 8px", background: "var(--ink-2)", border: "1px solid var(--line-soft)", borderRadius: 6, color: "var(--paper)", fontSize: 12 }}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label} · {shortAddr(o.pubkey, 4)}</option>
            ))}
          </select>
        </div>
      )}

      <button
        type="button"
        disabled={!canSwap}
        onClick={() => void doSwap()}
        style={{
          width: "100%", padding: "14px 16px", borderRadius: 999, border: 0,
          fontSize: 15, fontWeight: 700,
          background: canSwap || stage ? "var(--buy)" : "var(--ink-2)",
          color: canSwap || stage ? "var(--ink-0)" : "var(--paper-3)",
          cursor: canSwap ? "pointer" : "not-allowed",
          opacity: stage ? 0.7 : 1,
        }}
      >
        {ctaText}
      </button>

      {!signer && (
        <div style={{ ...box, padding: 0, overflow: "hidden" }}>
          <BrowserWalletSection />
          <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--paper-3)" }}>
            Or add a local wallet (Portfolio → Wallets): it signs here, without a wallet prompt.
          </div>
        </div>
      )}

      {/* route + DEX filter */}
      <div style={{ ...box, padding: "10px 14px" }}>
        {legs.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={micro}>Route</span>
              <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--paper-4)" }}>
                {q.seq > 0 && `#${q.seq}`}{quote && ` · ${(quote.timeTaken * 1000).toFixed(1)} ms`}
              </span>
            </div>
            {legs.map((leg, i) => {
              const out = outDec !== null ? toUi(leg.outAmount, outDec) : 0;
              const rel = bestLegOut > 0n ? Math.max(6, Number((leg.outAmount * 10_000n) / bestLegOut) / 100) : 100;
              const label = legLabel(leg);
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4, padding: "4px 0", fontSize: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--paper)" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: `oklch(0.74 0.15 ${venueHue(label)})` }} />
                    {label}
                    {legs.length > 1 && <span style={{ color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{(leg.bps / 100).toFixed(0)}%</span>}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--paper-2)" }}>{fmt(out)}</span>
                  <span style={{ gridColumn: "1 / -1", height: 3, background: "var(--ink-2)", borderRadius: 2 }}>
                    <span style={{ display: "block", height: 3, width: `${rel}%`, background: `oklch(0.74 0.15 ${venueHue(label)})`, borderRadius: 2 }} />
                  </span>
                </div>
              );
            })}
          </>
        )}
        <button
          type="button"
          onClick={() => setDexOpen((v) => !v)}
          style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: "transparent", border: 0, padding: legs.length ? "8px 0 0" : 0, cursor: "pointer" }}
        >
          <span style={micro}>DEX routing</span>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--paper-3)" }}>
            <b style={{ color: "var(--paper)" }}>{venues.length - disabledDex.size}</b>/{venues.length} {dexOpen ? "▴" : "▾"}
          </span>
        </button>
        {dexOpen && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, paddingTop: 8 }}>
            {venues.map((v) => {
              const on = !disabledDex.has(v.dex);
              return (
                <button
                  key={v.dex}
                  type="button"
                  onClick={() => toggleDex(v.dex)}
                  title={v.verdict === "red" ? "Held out by the router's price checks right now" : on ? "Click to exclude from routing" : "Click to include"}
                  style={{ ...chip, fontFamily: "inherit", ...(on ? { color: "var(--paper)", borderColor: "var(--line)" } : { opacity: 0.45, textDecoration: "line-through" }) }}
                >
                  {v.dex}
                </button>
              );
            })}
            {disabledDex.size > 0 && (
              <button type="button" onClick={() => setDisabledDex(new Set())} style={{ ...chip, color: "var(--accent)" }}>Enable all</button>
            )}
          </div>
        )}
      </div>

      {q.error && q.status !== "error" && <div style={{ fontSize: 11.5, color: "var(--sell)" }}>{q.error}</div>}

      <TokenPicker
        open={pickerFor !== null}
        exclude={pickerFor === "in" ? outputMint : inputMint}
        onPick={(t) => {
          if (pickerFor === "in") setInputMint(t.mint);
          else setOutputMint(t.mint);
          setPickerFor(null);
        }}
        onClose={() => setPickerFor(null)}
      />
    </div>
  );
}
