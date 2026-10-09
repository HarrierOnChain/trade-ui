"use client";
/**
 * Embedded right-side trading panel — layout from solana-ui's TradingForm:
 * BUY/SELL toggle | wallet count; amount input + denomination toggle;
 * preset tabs + quick-amount grid; slip+fee row; submit. Market orders
 * only: every trade is swapped on the router at once.
 *
 * Re-skinned with Raze Terminal's design tokens (--ink/--paper/--buy/--sell)
 * and atoms (Btn / Tooltip / Pill / Icon / SolAmount). Preferences
 * (presets, slip, fee, INSTANT-TRADE position, etc.) persist in this
 * browser through useUserPreference.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useApp } from "../../contexts/AppContext";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useUserWallets } from "../../hooks/useUserWallets";
import { executeLocalTrade, type TradeBody } from "../../api/localTrade";
import { useTokenPnl } from "../../hooks/useTokenPnl";
import { Icon, Tooltip, SolAmount, QuoteAssetIcon, QuoteAmount, TokenIcon } from "../atoms";
import { fmtNum, fmtSol, fmtUsd, shortAddr } from "../../lib/format";
import { explorerAccountUrl, explorerName, getActiveChain, isEvmChain, nativeSymbol } from "../../lib/chains";
import { useUserPreference } from "../../hooks/useUserPreference";
import {
  defaultInstantPresets, PREF_KEYS, PRESET_KEYS,
  resolvePresetValue,
  type InstantPresets, type Side,
} from "./presets";
import { defaultQuoteMint, findQuoteMint } from "../../lib/quoteMints";
import { PresetButton } from "./PresetButton";
import { InstantTradePanel } from "./InstantTradePanel";
import { TokenMetricsGrid } from "./TokenMetricsGrid";
import { SOL_MINT, toRaw, toUi, viaLabel } from "../../lib/swap/quote";
import { useDocumentHidden, useMintDecimals, useSwapQuote } from "../../lib/swap/useSwapQuote";
import { useEvmDecimals, useEvmQuote } from "../../lib/evm/useEvmQuote";
import { evmRouteLabel } from "../../lib/vault/client";
import { EXACT_OUT_EVM } from "../../lib/evm/plan";
import { explorerTxUrl } from "../../lib/chains";

const MIN_TRANSACTIONS_FEE_LAMPORTS = 100_000;

function clampSlippageBps(v: number) {
  return Math.min(10_000, Math.max(0, Math.round(v)));
}

function fmtNativeBalance(amount: number, label: string): string {
  if (label === "SOL") return fmtSol(amount, amount < 10 ? 3 : 2);
  return amount.toFixed(amount < 10 ? 3 : 2);
}

interface Props {
  mint: string;
}

export function TradingPanel({ mint }: Props) {
  const { info } = useTokenInfo(mint);
  const { pushToast } = useApp();
  const userWallets = useUserWallets();
  const solPrice = useSolPrice();
  const chainId = getActiveChain();
  const nat = nativeSymbol(chainId);
  const onSol = !isEvmChain(chainId);

  // ── User-persisted prefs ───────────────────────────────────────────
  const [instantPresets, setInstantPresets] = useUserPreference<InstantPresets>(PREF_KEYS.instantPresets, defaultInstantPresets);
  const [activePreset, setActivePreset] = useUserPreference<string>(PREF_KEYS.instantActivePreset, "1");

  // One-time migration: strip any `label` fields that were briefly stored
  // when labels were part of the InstantPreset shape. Runs on first mount
  // and writes back only if stale data is found.
  useEffect(() => {
    const stale = Object.values(instantPresets) as Array<InstantPresets[string] & { label?: unknown }>;
    if (!stale.some((s) => "label" in s)) return;
    const cleaned: InstantPresets = {};
    for (const [k, slot] of Object.entries(instantPresets)) {
      const s = slot as InstantPresets[string] & { label?: unknown };
      cleaned[k] = { buyAmounts: s.buyAmounts, sellAmounts: s.sellAmounts };
    }
    setInstantPresets(cleaned);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [buyAmount, setBuyAmount] = useUserPreference<string>(PREF_KEYS.buyAmount, "");
  // Manual-amount denomination (market orders only). buy: "quote" = spend the
  // quote currency (SOL/USDC, exactIn — default) ⇄ "token" = receive an exact
  // token qty (exactOut). sell: "token" = sell an exact token qty (exactIn —
  // default) ⇄ "quote" = receive an exact quote-currency amount (exactOut).
  const [buyDenom, setBuyDenom] = useUserPreference<"quote" | "token">(PREF_KEYS.buyDenom, "quote");
  const [sellDenom, setSellDenom] = useUserPreference<"quote" | "token">(PREF_KEYS.sellDenom, "token");
  const [slipBps, setSlipBps] = useUserPreference<number>(PREF_KEYS.slippageBps, 100);
  const [transactionsFeeLamports, setTransactionsFeeLamports] = useUserPreference<number>(
    PREF_KEYS.transactionsFee,
    MIN_TRANSACTIONS_FEE_LAMPORTS,
  );
  const [floatingOpen, setFloatingOpen] = useUserPreference<boolean>(PREF_KEYS.floatingOpen, false);
  // Native (gas) asset for the active chain — labels the wallet-balance pill.
  const nativeQuote = defaultQuoteMint();
  // Quote currency the user picked in Settings → Trading (PREF_KEYS.buyInputMint
  // / sellOutputMint, kept in sync there). The panel shows + trades this quote
  // instead of hardcoding the chain's native asset.
  const [buyInputLabel] = useUserPreference<string>(PREF_KEYS.buyInputMint, nativeQuote.label);
  const [sellOutputLabel] = useUserPreference<string>(PREF_KEYS.sellOutputMint, nativeQuote.label);
  const buyInputMint = findQuoteMint(buyInputLabel);
  // Single quote currency ("Default quote currency" sizes buys AND is received on
  // sells): Settings/TopBar write buyInputMint + sellOutputMint together, but a
  // stale localStorage `sellOutputMint` (persisted before both prefs were kept in
  // sync) can lag at the SOL default while the buy quote is USDC. That desync made
  // a "USDC quote" sell send no `outputMint` → backend defaults to SOL → the user
  // received SOL instead of USDC. Follow the buy quote when the sell pref is still
  // the native default but the buy quote isn't, so buy + sell always route the
  // same picked quote.
  const sellOutputMint =
    sellOutputLabel === nativeQuote.label && buyInputLabel !== nativeQuote.label
      ? buyInputMint
      : findQuoteMint(sellOutputLabel);

  // ── Local component state ──────────────────────────────────────────
  const [side, setSide] = useState<Side>("buy");
  // Quote shown in the amount field + used for routing, per side. Both labels
  // are kept in sync by Settings, so this reflects the user's active quote.
  const activeQuote = side === "buy" ? buyInputMint : sellOutputMint;
  const [sellAmount, setSellAmount] = useState<string>("");
  const [editingPresets, setEditingPresets] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeSlot = instantPresets[activePreset] ?? defaultInstantPresets[activePreset] ?? defaultInstantPresets["1"];

  // ── Wallets that sign: the active ones (top-bar picker), each trading
  // its own amount. Only vault wallets with a key can be active.
  const effectiveWallets = userWallets.activeWallets;
  const tokenPnl = useTokenPnl(mint);
  const effectiveKind: "platform" | "none" = effectiveWallets.length === 0 ? "none" : "platform";

  const { tokens: effectiveTokens, quote: effectiveQuote } = useMemo(() => {
    let tokens = 0, quote = 0;
    const quoteMintAddr = activeQuote.mint;
    for (const w of effectiveWallets) {
      const bal = userWallets.balances[w.id];
      if (!bal) continue;
      tokens += bal.tokens[mint] ?? 0;
      // Active-quote balance: native lamports for SOL, else the quote SPL token.
      quote += quoteMintAddr == null ? bal.sol : (bal.tokens[quoteMintAddr] ?? 0);
    }
    return { tokens, quote };
  }, [effectiveWallets, userWallets.balances, mint, activeQuote.mint]);

  // ── Trade execution paths ──────────────────────────────────────────
  // Market trades run on the Raze routers (Solana, or EVM on Ethereum, BNB
  // Chain, Base and Robinhood): per wallet one quote, then the server builds,
  // signs with the vault's key and sends; then the confirmation. All wallets
  // at once (src/api/localTrade.ts).
  async function placeMarketTrade(
    thisSide: Side,
    amountInput: string,
    denom: "quote" | "token" | "percent",
  ) {
    const n = parseFloat(String(amountInput).replace("%", ""));
    if (!isFinite(n) || n <= 0) {
      pushToast({ title: "ENTER AMOUNT", body: "Amount must be greater than 0", tone: "sell" });
      return;
    }
    const targets = effectiveWallets;
    if (targets.length === 0) {
      pushToast({
        title: "NO WALLET",
        body: "Pick the wallets that trade in the top bar, or add one in Wallets.",
        tone: "sell",
      });
      return;
    }
    // Each wallet trades the amount (a percentage is of its own holding).
    const each = denom === "percent" ? Math.min(100, n) : n;
    const q = thisSide === "buy" ? buyInputMint : sellOutputMint;
    const common = { side: thisSide, mint, slippageBps: clampSlippageBps(slipBps), transactionsFeeLamports };
    let body: Omit<TradeBody, "walletId">;
    if (thisSide === "buy") {
      const pay = q.mint ? { inputMint: q.mint } : {};
      body = denom === "token"
        ? { ...common, ...pay, swapMode: "exactOut", tokensAmount: each }
        : { ...common, ...pay, solAmount: each };
    } else {
      const receive = q.mint ? { outputMint: q.mint } : {};
      body = denom === "percent"
        ? { ...common, ...receive, percentage: each }
        : denom === "quote"
          ? { ...common, ...receive, swapMode: "exactOut", solAmount: each }
          : { ...common, ...receive, tokensAmount: each };
    }

    setBusy(true);
    try {
      const results = await Promise.allSettled(targets.map((w) => executeLocalTrade({ ...body, walletId: w.id })));
      const ok: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") ok.push(r.value.signature);
        else {
          pushToast({
            title: targets.length > 1 ? "WALLET FAILED" : "TRADE FAILED",
            body: `${targets.length > 1 ? `${targets[i].displayLabel}: ` : ""}${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
            tone: "sell",
            duration: 8000,
          });
        }
      });
      if (ok.length > 0) {
        pushToast({
          title: `${thisSide === "buy" ? "BUY" : "SELL"} CONFIRMED`,
          body: ok.length === 1
            ? <a href={explorerTxUrl(ok[0])} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>tx {shortAddr(ok[0], 6)} ↗</a>
            : `${ok.length}/${targets.length} wallets`,
          tone: thisSide,
          duration: 7000,
        });
        void userWallets.refreshBalances();
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit() {
    const amount = side === "buy" ? buyAmount : sellAmount;
    void placeMarketTrade(side, amount, side === "buy" ? buyDenom : sellDenom);
  }

  function onPresetClick(value: string) {
    const resolved = resolvePresetValue(value);
    // Quick presets are one-shot actions in their native denomination (buy =
    // SOL spend, sell = % of holdings). They fire directly and do NOT overwrite
    // the manual amount box, which carries its own denomination (toggle).
    void placeMarketTrade(side, resolved, side === "buy" ? "quote" : "percent");
  }

  const symbolLabel = (info?.symbol ?? "").trim() || "TOKEN";
  // What the manual amount fetches right now, on the router, for one wallet;
  // refreshed while the page is visible and an amount is typed.
  const tabHidden = useDocumentHidden();
  const tokenDecimals = useMintDecimals(onSol && mint ? mint : null);
  const typed = side === "buy" ? buyAmount : sellAmount;
  const previewDenom = side === "buy" ? buyDenom : sellDenom;
  const previewQuoteMint = activeQuote.mint ?? SOL_MINT;
  const previewReq = useMemo(() => {
    if (!onSol || !mint) return null;
    const n = parseFloat(typed);
    if (!isFinite(n) || n <= 0) return null;
    const text = n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
    // quote denomination: buy spends it (exact-in), sell receives it (exact-out);
    // token denomination: buy receives it (exact-out), sell spends it (exact-in).
    const exactOut = (side === "buy") === (previewDenom === "token");
    const dec = previewDenom === "token" ? tokenDecimals : activeQuote.decimals;
    if (dec == null) return null;
    return {
      inputMint: side === "buy" ? previewQuoteMint : mint,
      outputMint: side === "buy" ? mint : previewQuoteMint,
      amount: toRaw(text, dec),
      swapMode: exactOut ? ("ExactOut" as const) : ("ExactIn" as const),
    };
  }, [onSol, mint, typed, side, previewDenom, previewQuoteMint, tokenDecimals, activeQuote.decimals]);
  const preview = useSwapQuote({
    inputMint: previewReq?.inputMint ?? "",
    outputMint: previewReq?.outputMint ?? "",
    amount: previewReq?.amount ?? null,
    swapMode: previewReq?.swapMode,
    slippageBps: clampSlippageBps(slipBps),
    paused: tabHidden || busy,
    pollMs: 2_000,
  });
  // EVM: the EVM router's quote for one wallet's trade. It quotes exact
  // amounts in only: buying a token amount or selling for a quote amount
  // says so instead.
  const evmToken = !onSol && /^0x[0-9a-fA-F]{40}$/.test(mint) ? mint.toLowerCase() : null;
  const evmTokenDecimals = useEvmDecimals(chainId, evmToken);
  const evmExactOut = !onSol && (side === "buy") === (previewDenom === "token");
  const evmQuoteToken = activeQuote.mint ? activeQuote.mint.toLowerCase() : "native";
  const evmReq = useMemo(() => {
    if (onSol || !evmToken || evmExactOut) return null;
    const n = parseFloat(typed);
    if (!isFinite(n) || n <= 0) return null;
    const text = n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
    if (side === "buy") return { tokenIn: evmQuoteToken, tokenOut: evmToken, amountIn: toRaw(text, activeQuote.decimals) };
    if (evmTokenDecimals == null) return null;
    return { tokenIn: evmToken, tokenOut: evmQuoteToken, amountIn: toRaw(text, evmTokenDecimals) };
  }, [onSol, evmToken, evmExactOut, typed, side, evmQuoteToken, activeQuote.decimals, evmTokenDecimals]);
  const evmPreview = useEvmQuote({
    chain: chainId,
    tokenIn: evmReq?.tokenIn ?? null,
    tokenOut: evmReq?.tokenOut ?? null,
    amountIn: evmReq?.amountIn ?? null,
    slippageBps: clampSlippageBps(slipBps),
    paused: tabHidden || busy,
  });
  const evmPreviewText = (() => {
    if (onSol) return null;
    if (evmExactOut) return parseFloat(typed) > 0 ? EXACT_OUT_EVM : null;
    if (!evmReq) return null;
    if (evmPreview.noRoute) return "No route on the EVM router";
    const q = evmPreview.quote;
    if (!q) return evmPreview.status === "error" ? evmPreview.error : "Quoting…";
    const tokDec = evmTokenDecimals;
    const tok = (raw: string) => (tokDec != null ? fmtNum(toUi(BigInt(raw), tokDec)) : "…");
    const qt = (raw: string) => toUi(BigInt(raw), activeQuote.decimals).toLocaleString("en-US", { maximumFractionDigits: 6 });
    const head = side === "buy"
      ? `${qt(q.inAmount)} ${activeQuote.label} → ${tok(q.outAmount)} ${symbolLabel}`
      : `${tok(q.inAmount)} ${symbolLabel} → ${qt(q.outAmount)} ${activeQuote.label}`;
    const min = side === "buy" ? `${tok(q.otherAmountThreshold)} ${symbolLabel}` : `${qt(q.otherAmountThreshold)} ${activeQuote.label}`;
    return `${head} · min ${min} · ${evmRouteLabel(q)}`;
  })();
  const previewText = (() => {
    if (!onSol) return evmPreviewText;
    if (!previewReq) return null;
    if (preview.noRoute) return preview.noRouteText ?? "No route";
    const pq = preview.quote;
    if (!pq) return preview.status === "error" ? preview.error : "Quoting…";
    const tokenSide = side === "buy" ? pq.outAmount : pq.inAmount;
    const quoteSide = side === "buy" ? pq.inAmount : pq.outAmount;
    const tok = tokenDecimals != null ? fmtNum(toUi(tokenSide, tokenDecimals)) : "…";
    const qt = toUi(quoteSide, activeQuote.decimals).toLocaleString("en-US", { maximumFractionDigits: 6 });
    const head = side === "buy" ? `${qt} ${activeQuote.label} → ${tok} ${symbolLabel}` : `${tok} ${symbolLabel} → ${qt} ${activeQuote.label}`;
    return `${head} · ${(pq.priceImpactBps / 100).toFixed(2)}% impact · ${viaLabel(pq)}`;
  })();

  // Keep slip percentage display close to the wire format (bps).
  const slipPct = (slipBps / 100).toFixed(slipBps < 100 ? 2 : 1);
  const feeSol = (transactionsFeeLamports / 1e9).toFixed(4);

  // ── Preset edit helpers ─────────────────────────────────────────────
  function editBuyPreset(idx: number, val: string) {
    const cur = instantPresets[activePreset] ?? { buyAmounts: [], sellAmounts: [] };
    const amounts = [...cur.buyAmounts];
    amounts[idx] = val;
    setInstantPresets({ ...instantPresets, [activePreset]: { ...cur, buyAmounts: amounts } });
  }
  function editSellPreset(idx: number, val: string) {
    const cur = instantPresets[activePreset] ?? { buyAmounts: [], sellAmounts: [] };
    const amounts = [...cur.sellAmounts];
    amounts[idx] = val;
    setInstantPresets({ ...instantPresets, [activePreset]: { ...cur, sellAmounts: amounts } });
  }

  // Active manual-amount denomination + its display label/icon (market only).
  const activeDenom = side === "buy" ? buyDenom : sellDenom;
  const devAddr = info?.signer ?? null;
  // Tokens the creator launched (the API reports launches, not graduations).
  const creatorDeploys = info?.creatorDeploys;
  const tokenAge = info?.created_at ? formatAge(info.created_at) : "—";

  // All 8 quick-amount slots (4×2 grid). Same preset data as InstantTradePanel.
  const quickAmounts = (side === "buy" ? activeSlot.buyAmounts : activeSlot.sellAmounts).slice(0, 8);

  return (
    <aside style={{
      position: "relative",
      width: "100%", flex: 1,
      display: "flex", flexDirection: "column",
      background: "var(--ink-1)",
      maxHeight: "100%",
      overflowY: "auto",
      overflowX: "hidden",
    }}>
      {/* ── 1) Buy / Sell pill toggle ───────────────────────────────── */}
      <div style={{ padding: "10px 12px 6px" }}>
        <div style={{
          position: "relative",
          display: "flex",
          background: "var(--ink-2)",
          border: "1px solid var(--line-soft)",
          borderRadius: 999,
          padding: 3,
          gap: 3,
          overflow: "hidden",
        }}>
          {/* Sliding pill highlight */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 3, bottom: 3,
              left: 3,
              width: "calc(50% - 4.5px)",
              borderRadius: 999,
              background: side === "buy" ? "var(--buy)" : "var(--sell)",
              transform: `translateX(${side === "buy" ? "0%" : "calc(100% + 3px)"})`,
              transition: "transform 240ms cubic-bezier(0.4, 0, 0.2, 1), background 200ms ease",
              willChange: "transform",
              zIndex: 0,
            }}
          />
          <button
            onClick={() => setSide("buy")}
            style={pillTabStyle(side === "buy", "buy")}
          >Buy</button>
          <button
            onClick={() => setSide("sell")}
            style={pillTabStyle(side === "sell", "sell")}
          >Sell</button>
        </div>
      </div>

      {/* ── 2) Market + wallet pill ─────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 12px",
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <UnderlineTab label="Market" active />
        </div>

        <Tooltip content={`${effectiveWallets.length} wallet${effectiveWallets.length === 1 ? "" : "s"} · balance`}>
          <span style={walletBalancePillStyle} aria-label="Active wallets">
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--paper)", fontWeight: 600 }}>{effectiveWallets.length}</span>
            <span style={{ display: "inline-flex", color: "var(--paper-3)", lineHeight: 0 }}>{Icon.wallet(11)}</span>
            {side === "buy" ? (
              // Buy: the quote you pay with (SOL / USDC / USD1).
              <QuoteAmount
                label={activeQuote.label}
                iconSize={10}
                style={{ color: "var(--paper)", fontWeight: 600 }}
              >
                {fmtNativeBalance(effectiveQuote, activeQuote.label)}
              </QuoteAmount>
            ) : (
              // Sell: the held balance of the token being traded, tagged with
              // the token's own logo instead of its ticker text.
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
                color: "var(--paper)", fontWeight: 600,
              }}>
                <span>{fmtNum(effectiveTokens)}</span>
                <TokenIcon token={{ mint_address: mint, symbol: info?.symbol, image: info?.image }} size={14} />
              </span>
            )}
          </span>
        </Tooltip>
      </div>

      {/* ── 3) AMOUNT input + active-chain quote ─────────────────────── */}
      <div style={{ padding: "10px 12px 6px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 12px",
          background: "var(--ink-0)",
          border: "1px solid var(--line-soft)",
          borderRadius: 6,
        }}>
          <span style={{
            fontSize: 11, fontFamily: "var(--font-mono)",
            color: "var(--paper-4)", letterSpacing: "0.08em",
            textTransform: "uppercase", flexShrink: 0,
          }}>AMOUNT</span>
          <input
            value={side === "buy" ? buyAmount : sellAmount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              if (side === "buy") setBuyAmount(v);
              else setSellAmount(v);
            }}
            placeholder="0.0"
            inputMode="decimal"
            disabled={!mint}
            style={{
              flex: 1, minWidth: 0,
              padding: 0,
              fontSize: 16, fontWeight: 500,
              fontFamily: "var(--font-mono)", color: "var(--paper)",
              background: "transparent",
              border: 0,
              outline: "none",
            }}
          />
          {/* Denomination toggle. Buy: pay in quote (SOL/USDC, exact-in) ⇄
              receive an exact token qty (exact-out). Sell: sell an exact token
              qty (exact-in) ⇄ receive an exact quote amount (exact-out). */}
          <button
            type="button"
            onClick={() => {
              // Switching denomination changes what the typed number means
              // (SOL vs token) — clear it so a stale value isn't re-submitted
              // under the new unit.
              if (side === "buy") {
                setBuyDenom(buyDenom === "token" ? "quote" : "token");
                setBuyAmount("");
              } else {
                setSellDenom(sellDenom === "token" ? "quote" : "token");
                setSellAmount("");
              }
            }}
            title={
              side === "buy"
                ? activeDenom === "token"
                  ? `Buying an exact ${symbolLabel} amount (exact-out). Tap to spend ${activeQuote.label}.`
                  : `Spending ${activeQuote.label} (exact-in). Tap to buy an exact ${symbolLabel} amount.`
                : activeDenom === "token"
                  ? `Selling an exact ${symbolLabel} amount (exact-in). Tap to receive an exact ${activeQuote.label} amount.`
                  : `Receiving an exact ${activeQuote.label} amount (exact-out). Tap to sell an exact ${symbolLabel} amount.`
            }
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              flexShrink: 0, padding: "4px 8px",
              background: "var(--ink-2)",
              border: "1px solid var(--line-soft)",
              borderRadius: 4,
              color: "var(--paper-2)",
              fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {activeDenom === "token" ? (
              <>
                <TokenIcon token={{ mint_address: mint, symbol: info?.symbol, image: info?.image }} size={14} />
                {symbolLabel}
              </>
            ) : (
              <>
                <QuoteAssetIcon label={activeQuote.label} size={14} />
                {activeQuote.label}
              </>
            )}
            <span aria-hidden style={{ color: "var(--paper-4)", fontSize: 9, marginLeft: 1 }}>⇅</span>
          </button>
        </div>
      </div>

      {/* ── 4) Preset slot + quick amounts ───────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: "0 12px 6px",
      }}>
        {PRESET_KEYS.map((k) => (
          <MinimalPresetTab
            key={k}
            label={k}
            isActive={k === activePreset}
            onClick={() => setActivePreset(k)}
          />
        ))}
        <Tooltip content={editingPresets ? "Done editing" : "Edit presets"}>
          <button
            onClick={() => setEditingPresets((v) => !v)}
            style={{
              ...quickEditBtnStyle,
              width: 22,
              height: 22,
              flexShrink: 0,
              ...(editingPresets
                ? {
                    borderColor: "var(--accent)",
                    color: "var(--accent)",
                    background: "var(--accent-w)",
                  }
                : {
                    background: "transparent",
                    color: "var(--paper-4)",
                  }),
            }}
            aria-label={editingPresets ? "Done editing" : "Edit presets"}
            aria-pressed={editingPresets}
          >
            <EditIcon size={10} />
          </button>
        </Tooltip>
      </div>

      {!editingPresets && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gridTemplateRows: "repeat(2, auto)",
          gap: 4,
          padding: "0 12px 6px",
        }}>
          {quickAmounts.map((v, i) => (
            <PresetButton
              key={`quick-${side}-${i}`}
              value={v}
              onExecute={(amt) => onPresetClick(amt)}
              onChange={(next) => side === "buy" ? editBuyPreset(i, next) : editSellPreset(i, next)}
              isLoading={busy}
              variant={side}
              isEditMode={false}
            />
          ))}
        </div>
      )}

      {editingPresets && (
        <div style={{ padding: "0 12px 6px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{
            fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--paper-4)",
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            Edit amounts
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
            {(side === "buy" ? activeSlot.buyAmounts : activeSlot.sellAmounts).map((v, i) => (
              <PresetButton
                key={`edit-${side}-${i}`}
                value={v}
                onExecute={() => {}}
                onChange={(next) => side === "buy" ? editBuyPreset(i, next) : editSellPreset(i, next)}
                isLoading={busy}
                variant={side}
                isEditMode={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 5) Config icons row ──────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 12px 8px",
        gap: 6,
        fontSize: 11, fontFamily: "var(--font-mono)",
        color: "var(--paper-2)",
      }}>
        <Tooltip content="Slippage tolerance">
          <span style={configChipStyle}>
            <FlameIcon size={11} />
            <input
              type="text"
              value={slipPct}
              onChange={(e) => {
                const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
                if (isFinite(v) && v >= 0) setSlipBps(clampSlippageBps(v * 100));
              }}
              style={configInputStyle}
            />
            <span style={{ color: "var(--paper-4)" }}>%</span>
          </span>
        </Tooltip>
        <span style={{ color: "var(--line)" }}>|</span>
        <Tooltip content={`Priority fee (${nat})`}>
          <span style={configChipStyle}>
            <GasIcon size={11} />
            <input
              type="text"
              value={feeSol}
              onChange={(e) => {
                const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
                if (isFinite(v) && v >= 0) setTransactionsFeeLamports(Math.floor(v * 1e9));
              }}
              onBlur={() => {
                if (transactionsFeeLamports < MIN_TRANSACTIONS_FEE_LAMPORTS) {
                  setTransactionsFeeLamports(MIN_TRANSACTIONS_FEE_LAMPORTS);
                }
              }}
              style={{ ...configInputStyle, width: 44 }}
            />
          </span>
        </Tooltip>
      </div>

      {previewText && (
        <div
          title="Live router quote for one wallet's trade"
          style={{
            padding: "0 12px 8px",
            fontSize: 10.5, fontFamily: "var(--font-mono)",
            color: (onSol ? preview.noRoute : evmPreview.noRoute || evmExactOut) ? "var(--sell)" : "var(--paper-3)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          {previewText}
        </div>
      )}

      <div style={{ padding: "0 12px 10px" }}>
        <button
          onClick={onSubmit}
          disabled={
            busy ||
            effectiveKind === "none" ||
            !(side === "buy" ? buyAmount : sellAmount)
          }
          style={{
            width: "100%",
            padding: "14px 16px",
            fontSize: 15, fontWeight: 700,
            color: side === "buy" ? "var(--ink-0)" : "#fff",
            background: side === "buy" ? "var(--buy)" : "var(--sell)",
            border: 0,
            borderRadius: 999,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.55 : 1,
            transition: "background 120ms, opacity 120ms",
            letterSpacing: "0.01em",
          }}
        >
          {busy
            ? effectiveWallets.length > 1 ? `× ${effectiveWallets.length}` : "Sending…"
            : `${side === "buy" ? "Buy" : "Sell"} ${symbolLabel}`}
        </button>
      </div>

      {/* ── 9) Stats inline (Bought / Sold / Holding / PnL) ─────────── */}
      <TokenPnlStrip pnl={tokenPnl} solPrice={solPrice ?? 0} />

      {/* ── 10) Holder stats (same live data as TokenHeader) ──────────── */}
      <TokenMetricsGrid mint={mint} />

      {/* ── 15) DA (dev address) row ───────────────────────────────── */}
      {devAddr && (
        <div style={addressRowStyle}>
          <span style={{ display: "inline-flex", color: "var(--paper-3)", lineHeight: 0 }}>{Icon.phantom(12)}</span>
          <span style={addressLabelStyle}>DA:</span>
          <span style={addressValueStyle}>{shortAddr(devAddr, 6)}</span>
          <Tooltip content={`Open on ${explorerName()}`}>
            <a
              href={explorerAccountUrl(devAddr)}
              target="_blank" rel="noopener noreferrer"
              style={iconBtnStyle}
              aria-label="Open external"
            ><ExternalIcon size={11} /></a>
          </Tooltip>
        </div>
      )}

      {/* ── 16) Dev pill (launches + age) ──────────────────────────── */}
      {devAddr && (
        <div style={{ padding: "4px 12px 14px" }}>
          <div style={devPillStyle}>
            <span style={{ display: "inline-flex", color: "var(--paper-3)", lineHeight: 0 }}>{UpArrowIcon(10)}</span>
            <span style={{ color: "var(--paper-2)" }}>{shortAddr(devAddr, 4)}</span>
            <span style={{ display: "inline-flex", color: "var(--paper-3)", lineHeight: 0 }}>{Icon.phantom(10)}</span>
            <span style={{ color: "var(--accent)" }} title="Tokens this dev launched">
              {creatorDeploys ?? "–"}
            </span>
            <span style={{ display: "inline-flex", color: "var(--paper-3)", lineHeight: 0 }}>{ClockIcon(10)}</span>
            <span style={{ color: "var(--paper-3)" }}>{tokenAge}</span>
          </div>
        </div>
      )}

      <InstantTradePanel
        isOpen={floatingOpen}
        onClose={() => setFloatingOpen(false)}
        mint={mint}
        buyQuote={buyInputMint}
        pnl={tokenPnl}
        onTrade={async (s, amt, isPercentage) => {
          const asString = String(amt);
          // Instant panel: buy amounts are SOL ("quote"); sell amounts are either
          // a % of holdings or an exact token qty, per its own isPercentage flag.
          const denom = s === "buy" ? "quote" : (isPercentage ? "percent" : "token");
          await placeMarketTrade(s, asString, denom);
        }}
      />
    </aside>
  );
}

function EditIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 14h12M3 11l8-8 2 2-8 8H3v-2Z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function FlameIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5s3 2.5 3 5.5a3 3 0 1 1-6 0c0-1 .5-1.7 1-2.2 0 1.4 1 1.7 1 1.7s-.5-1.5 1-5z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function GasIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="6" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 7l2 2v4a1 1 0 0 1-2 0V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4.5 5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ExternalIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9 2h5v5M14 2L7 9M12 9v4H3V4h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UpArrowIcon(size = 10) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 13V3M8 3l-3 3M8 3l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon(size = 10) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function UnderlineTab({
  label, active, disabled, title, onClick,
}: {
  label: string; active?: boolean; disabled?: boolean; title?: string; onClick?: () => void;
}) {
  return (
    <Tooltip content={title ?? null}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        style={{
          padding: "6px 2px",
          fontSize: 12,
          fontWeight: active ? 700 : 500,
          color: active ? "var(--paper)" : "var(--paper-3)",
          background: "transparent",
          border: 0,
          borderBottom: `2px solid ${active ? "var(--paper)" : "transparent"}`,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
        }}
      >{label}</button>
    </Tooltip>
  );
}

function MinimalPresetTab({
  label, isActive, onClick,
}: {
  label: string; isActive: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      aria-label={`Preset ${label}`}
      style={{
        flex: 1,
        minWidth: 0,
        padding: "3px 0",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        fontWeight: isActive ? 600 : 500,
        color: isActive ? "var(--paper)" : "var(--paper-4)",
        background: isActive ? "var(--ink-2)" : "transparent",
        border: `1px solid ${isActive ? "var(--line-soft)" : "transparent"}`,
        borderRadius: 4,
        cursor: "pointer",
        lineHeight: 1.2,
      }}
    >
      {label}
    </button>
  );
}

function pillTabStyle(active: boolean, side: "buy" | "sell"): React.CSSProperties {
  return {
    position: "relative",
    zIndex: 1,
    flex: 1,
    padding: "8px 0",
    fontSize: 13, fontWeight: 700,
    color: active ? (side === "buy" ? "var(--ink-0)" : "#fff") : "var(--paper-3)",
    background: "transparent",
    border: 0,
    borderRadius: 999,
    cursor: "pointer",
    transition: "color 200ms ease",
  };
}

const walletBalancePillStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "4px 10px",
  background: "var(--ink-2)",
  border: "1px solid var(--line-soft)",
  borderRadius: 999,
  cursor: "default",
};

const quickEditBtnStyle: React.CSSProperties = {
  width: 28, height: 28,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  fontSize: 10,
  color: "var(--paper-3)",
  background: "var(--ink-2)",
  border: "1px solid var(--line-soft)",
  borderRadius: 4,
  cursor: "pointer",
  padding: 0,
};

const configChipStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--paper-2)",
};

const configInputStyle: React.CSSProperties = {
  width: 32,
  padding: 0,
  fontSize: 11, fontFamily: "var(--font-mono)",
  background: "transparent",
  color: "var(--paper)",
  border: 0,
  outline: "none",
  textAlign: "right",
};

const addressRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  margin: "0 12px 6px",
  padding: "6px 10px",
  background: "var(--ink-2)",
  border: "1px solid var(--line-soft)",
  borderRadius: 6,
  fontSize: 11, fontFamily: "var(--font-mono)",
};

const addressLabelStyle: React.CSSProperties = {
  color: "var(--paper-3)",
};

const addressValueStyle: React.CSSProperties = {
  flex: 1, minWidth: 0,
  color: "var(--paper)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22,
  background: "transparent",
  border: 0,
  borderRadius: 4,
  color: "var(--paper-3)",
  cursor: "pointer",
  padding: 0,
};

const devPillStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "4px 10px",
  background: "var(--ink-2)",
  border: "1px solid var(--line-soft)",
  borderRadius: 999,
  fontSize: 11, fontFamily: "var(--font-mono)",
};

function formatAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "—";
  const diffSec = Math.max(0, (Date.now() - t) / 1000);
  if (diffSec < 60) return `${Math.floor(diffSec)}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d`;
  if (diffSec < 86400 * 365) return `${Math.floor(diffSec / (86400 * 30))}mo`;
  return `${Math.floor(diffSec / (86400 * 365))}y`;
}

function TokenPnlStrip({ pnl, solPrice }: { pnl: import("../../hooks/useTokenPnl").TokenPnlData; solPrice: number }) {
  const { bought, sold, holding, pnl: pnlValue } = pnl;
  const pnlPct = bought > 0 ? (pnlValue / bought) * 100 : 0;
  // Click the strip to flip SOL ⇄ USD (only meaningful once we have a price).
  const [usd, setUsd] = useState(false);
  const canUsd = solPrice > 0;
  const showUsd = usd && canUsd;

  const cell: React.CSSProperties = {
    flex: 1,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 3,
    padding: "6px 0",
  };
  const divider: React.CSSProperties = { borderRight: "1px solid var(--line-soft)" };
  const labelStyle: React.CSSProperties = {
    fontSize: 9, fontFamily: "var(--font-mono)",
    color: "var(--paper-4)", letterSpacing: "0.06em", textTransform: "uppercase",
  };

  // Render a value either as a SOL amount (with the ◎ glyph) or USD.
  const val = (v: number, style?: React.CSSProperties) =>
    showUsd
      ? <span style={{ ...style }}>{(v < 0 ? "-" : "") + fmtUsd(Math.abs(v * solPrice))}</span>
      : <SolAmount iconSize={9} style={style}>{fmtSol(v, 3)}</SolAmount>;

  const pnlColor = { color: pnlValue >= 0 ? "var(--buy)" : "var(--sell)" } as React.CSSProperties;
  const pnlPctSuffix = bought > 0 ? ` (${pnlValue >= 0 ? "+" : ""}${pnlPct.toFixed(0)}%)` : "";

  return (
    <div
      onClick={() => canUsd && setUsd((x) => !x)}
      title={canUsd ? (showUsd ? "Show in SOL" : "Show in USD") : undefined}
      style={{
        display: "flex",
        borderTop: "1px solid var(--line-soft)",
        borderBottom: "1px solid var(--line-soft)",
        fontSize: 11, fontFamily: "var(--font-mono)",
        background: "var(--ink-0)",
        cursor: canUsd ? "pointer" : "default",
        userSelect: "none",
      }}>
      <div style={{ ...cell, ...divider }}>
        <span style={labelStyle}>Bought</span>
        {val(bought)}
      </div>
      <div style={{ ...cell, ...divider }}>
        <span style={labelStyle}>Sold</span>
        {val(sold)}
      </div>
      <div style={{ ...cell, ...divider }}>
        <span style={labelStyle}>Holding</span>
        {val(holding)}
      </div>
      <div style={cell}>
        <span style={labelStyle}>PnL</span>
        {showUsd ? (
          <span style={pnlColor}>
            {(pnlValue >= 0 ? "+" : "-") + `$${Math.abs(pnlValue * solPrice).toFixed(1)}`}{pnlPctSuffix}
          </span>
        ) : (
          <SolAmount iconSize={9} style={pnlColor}>
            {(pnlValue >= 0 ? "+" : "") + fmtSol(pnlValue, 2)}{pnlPctSuffix}
          </SolAmount>
        )}
      </div>
    </div>
  );
}
