"use client";
/**
 * Embedded right-side trading panel — full layout matches solana-ui's
 * TradingForm: limit-history toggle | BUY/SELL toggle | wallet count;
 * amount label row (UNIT · WALLET/TOTAL · MARKET/LIMIT); amount input
 * + inline submit; slip+fee row + INSTANT TRADE chip; preset tabs +
 * 4-button preset grid; limit slider/custom block.
 *
 * Re-skinned with Raze Terminal's design tokens (--ink/--paper/--buy/--sell)
 * and atoms (Btn / Tooltip / Pill / Icon / SolAmount). Preferences
 * (presets, slip, fee, INSTANT-TRADE position, etc.) persist via
 * the new backend `/preferences` store through useUserPreference.
 */
import React, { useEffect, useMemo, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useApp } from "../../contexts/AppContext";
import { useRegion } from "../../contexts/RegionContext";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useUserWallets } from "../../hooks/useUserWallets";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { fetchTokenSupply } from "../../api/client";
import { notifyDemoChanged } from "../../lib/demoEvents";
import { BackendClient, useSession } from "../../api/backend";
import { AdvPanel } from "./AdvPanel";
import { useBackend } from "../../api/backend";
import { AutomodePanel } from "../../app/automation/_components/automode";
import { AutoCleanPanel } from "../../app/automation/_components/autoClean";
import { useTokenPnl } from "../../hooks/useTokenPnl";
import { Btn, Icon, Pill, Tooltip, SolAmount, QuoteAssetIcon, QuoteAmount, TokenIcon } from "../atoms";
import { fmtNum, fmtSol, fmtUsd, shortAddr } from "../../lib/format";
import { explorerAccountUrl, explorerName, getActiveChain, isEvmChain, nativeSymbol } from "../../lib/chains";
import { useLimitOrders, type LimitOrderView } from "../../hooks/useLimitOrders";
import { useUserPreference } from "../../hooks/useUserPreference";
import {
  defaultInstantPresets, PREF_KEYS, PRESET_KEYS,
  resolvePresetValue,
  type InputMode, type InstantPresets, type OrderType, type Side,
} from "./presets";
import { defaultQuoteMint, findQuoteMint } from "../../lib/quoteMints";
import { PresetButton } from "./PresetButton";
import { InstantTradePanel } from "./InstantTradePanel";
import { CalculatePNLModal } from "./CalculatePNLModal";
import { TokenMetricsGrid } from "./TokenMetricsGrid";
import { AUTO_LABEL } from "../../app/automation/_components/atoms";

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  signTransaction<T>(tx: T): Promise<T>;
}
function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  const p = w.phantom?.solana ?? w.solana;
  return p && p.isPhantom ? p : null;
}

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
  const { authed, pushToast, sysConfig, setGuestPhantomPubkey } = useApp();
  const { region } = useRegion();
  const session = useSession();
  const userWallets = useUserWallets();
  const backend = useBackend();
  const solPrice = useSolPrice();
  const chainId = getActiveChain();
  const nat = nativeSymbol(chainId);
  const onSol = !isEvmChain(chainId);
  const limitOrders = useLimitOrders(mint);

  // Live mcap = livePriceSol × solUsd × supply, falling back to the REST
  // snapshot from useTokenInfo. We need a live number for the limit-order
  // slider so the "now" baseline and the user's % deltas track the chart
  // — info.marketCap is a snapshot from page-load and drifts on hot tokens.
  const liveMintList = useMemo(() => [mint], [mint]);
  const livePriceMap = useLiveTradePrices(liveMintList);
  const livePriceSol = livePriceMap.get(mint)?.price ?? 0;
  const [supply, setSupply] = useState<number>(1_000_000_000);
  useEffect(() => {
    let cancelled = false;
    fetchTokenSupply(mint)
      .then((res) => {
        if (cancelled) return;
        const raw = Number(res.supply ?? 0);
        // Pump.fun ships at 1B and almost never burns; if raze returns a
        // suspiciously small number (or none) keep the default rather
        // than zero out mcap.
        if (raw >= 1_000_000) setSupply(raw);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mint]);
  const liveMarketCap = useMemo(() => {
    const sp = solPrice ?? 0;
    const live = livePriceSol > 0 && sp > 0 ? livePriceSol * sp * supply : 0;
    if (live > 0) return live;
    return info?.marketCap ?? 0;
  }, [livePriceSol, solPrice, supply, info?.marketCap]);

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
  const [buyMode, setBuyMode] = useUserPreference<InputMode>(PREF_KEYS.buyInputMode, "perWallet");
  const [sellMode, setSellMode] = useUserPreference<InputMode>(PREF_KEYS.sellInputMode, "perWallet");
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
  // User-set fixed platform fee (lamports) → admin fee wallet. Default 0 = none.
  const [fixedFeeLamports, setFixedFeeLamports] = useUserPreference<number>(PREF_KEYS.fixedFee, 0);
  // MEV protection: relay as a sponsor-tipped Jito bundle.
  const [mevProtection, setMevProtection] = useUserPreference<boolean>(PREF_KEYS.mevProtection, false);
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
  const [orderType, setOrderType] = useState<OrderType>("market");
  // Unified MM tab: the parent owns the action grid; the embedded live panels
  // just render their session lists + the create modal the grid triggers.
  const [mmCreate, setMmCreate] = useState<null | "autobuy" | "autosell" | "volume" | "clean">(null);
  const [mmRefresh, setMmRefresh] = useState(0);
  const [sellAmount, setSellAmount] = useState<string>("");
  const [limitPriceUsd, setLimitPriceUsd] = useState<string>("");
  const [limitSliderPct, setLimitSliderPct] = useState<number>(0);
  const [limitInputMode, setLimitInputMode] = useState<"slider" | "custom">("slider");
  const [editingPresets, setEditingPresets] = useState(false);
  const [pnlOpen, setPnlOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeSlot = instantPresets[activePreset] ?? defaultInstantPresets[activePreset] ?? defaultInstantPresets["1"];

  // ── Wallet routing — Phantom XOR Platform ─────────────────────────
  // useUserWallets injects a synthetic guest wallet when !authed + guestPhantomPubkey
  const wallets = userWallets.wallets;
  const connectedWallet = useMemo(
    () => wallets.find((w) => w.isConnected) ?? null,
    [wallets],
  );
  const activePlatformWallets = userWallets.activeWallets.filter((w) => !w.isConnected);
  const effectiveWallets =
    activePlatformWallets.length > 0
      ? activePlatformWallets
      : connectedWallet ? [connectedWallet] : [];
  const selectedDemoWalletIds = useMemo(
    () => effectiveWallets.filter((w) => w.kind === "DEMO").map((w) => w.id),
    [effectiveWallets],
  );
  const tokenPnl = useTokenPnl(mint, selectedDemoWalletIds);
  const effectiveKind: "connected" | "platform" | "none" =
    effectiveWallets.length === 0
      ? "none"
      : effectiveWallets[0].isConnected ? "connected" : "platform";
  const isPhantomTrade = effectiveKind === "connected";

  // Limit + Adv modes both run server-side and need a platform wallet.
  useEffect(() => {
    if ((orderType === "limit" || orderType === "adv") && effectiveKind === "connected") {
      setOrderType("market");
    }
  }, [orderType, effectiveKind]);

  const { sol: effectiveSol, tokens: effectiveTokens, quote: effectiveQuote, anyLoading } = useMemo(() => {
    let sol = 0, tokens = 0, quote = 0, loading = false;
    const quoteMintAddr = activeQuote.mint;
    for (const w of effectiveWallets) {
      const bal = userWallets.balances[w.id];
      if (!bal) continue;
      if (bal.loading) loading = true;
      sol += bal.sol;
      tokens += bal.tokens[mint] ?? 0;
      // Active-quote balance: native lamports for SOL, else the quote SPL token.
      quote += quoteMintAddr == null ? bal.sol : (bal.tokens[quoteMintAddr] ?? 0);
    }
    return { sol, tokens, quote, anyLoading: loading };
  }, [effectiveWallets, userWallets.balances, mint, activeQuote.mint]);

  // ── Trade execution paths ──────────────────────────────────────────
  async function placeMarketTrade(
    _thisSide: Side,
    _amountInput: string,
    _mode: InputMode,
    _denom: "quote" | "token" | "percent",
  ) {
    pushToast({
      title: "SELF-HOSTED",
      body: "The public API is market data only. Swap execution is not available in Trade UI.",
      tone: "sell",
    });
  }

  async function placeLimitOrder() {
    pushToast({
      title: "SELF-HOSTED",
      body: "The public API is market data only. Limit orders are not available in Trade UI.",
      tone: "sell",
    });
  }


  function onSubmit() {
    if (orderType === "limit") {
      void placeLimitOrder();
      return;
    }
    const amount = side === "buy" ? buyAmount : sellAmount;
    void placeMarketTrade(side, amount, side === "buy" ? buyMode : sellMode, side === "buy" ? buyDenom : sellDenom);
  }

  function onPresetClick(value: string) {
    const resolved = resolvePresetValue(value);
    // Quick presets are one-shot actions in their native denomination (buy =
    // SOL spend, sell = % of holdings). They fire directly and do NOT overwrite
    // the manual amount box, which carries its own denomination (toggle).
    void placeMarketTrade(side, resolved, side === "buy" ? buyMode : sellMode, side === "buy" ? "quote" : "percent");
  }

  // Estimated output (illustrative — uses rolling market cap). The manual
  // amount is denominated by the active toggle: "quote" ⇒ the typed value is a
  // SOL/quote amount; "token" ⇒ it's a token qty.
  const estimate = useMemo(() => {
    const num = parseFloat(side === "buy" ? buyAmount : sellAmount);
    if (!info?.marketCap || !solPrice || !isFinite(num) || num <= 0) {
      return { tokens: null as number | null, sol: null as number | null };
    }
    const supply = 1_000_000_000;
    const avgPrice = info.marketCap / (solPrice * supply); // SOL per token
    const mode = side === "buy" ? buyMode : sellMode;
    const denom = side === "buy" ? buyDenom : sellDenom;
    const total = mode === "cumulative" ? num : num * Math.max(1, effectiveWallets.length);
    if (denom === "quote") {
      // Typed value is SOL: buy spend / sell exact-out proceeds.
      return { tokens: avgPrice > 0 ? total / avgPrice : null, sol: total };
    }
    // Typed value is a token qty: buy exact-out / sell exact-in.
    return { tokens: total, sol: total * avgPrice };
  }, [side, buyAmount, sellAmount, info?.marketCap, solPrice, buyMode, sellMode, buyDenom, sellDenom, effectiveWallets.length]);

  // Keep slip percentage display close to the wire format (bps).
  const slipPct = (slipBps / 100).toFixed(slipBps < 100 ? 2 : 1);
  const feeSol = (transactionsFeeLamports / 1e9).toFixed(4);
  const fixedFeeSol = (fixedFeeLamports / 1e9).toFixed(4);

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

  const symbolLabel = (info?.symbol ?? "").trim() || "TOKEN";
  // Active manual-amount denomination + its display label/icon (market only).
  const activeDenom = side === "buy" ? buyDenom : sellDenom;
  const devAddr = info?.signer ?? null;
  // Unknown stays unknown ("–" / hidden): the API reports the creator's
  // launches but neither their graduations nor the dev's own buy.
  const creatorDeploys = info?.creatorDeploys;
  const creatorMigrations = info?.creatorMigrations;
  const creatorBuySol = info?.creatorBuySol;
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

      {/* ── 2) Market / Limit / Adv. + wallet pill ──────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 12px",
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <UnderlineTab
            label="Market"
            active={orderType === "market"}
            onClick={() => setOrderType("market")}
          />
          <UnderlineTab
            label="Limit"
            active={orderType === "limit"}
            disabled={effectiveKind === "connected"}
            title={effectiveKind === "connected"
              ? "Pick a platform wallet — limit orders sign on the backend"
              : undefined}
            onClick={() => effectiveKind !== "connected" && setOrderType("limit")}
          />
          <UnderlineTab
            label="Adv."
            active={orderType === "adv"}
            disabled={effectiveKind === "connected"}
            title={effectiveKind === "connected"
              ? "Pick a platform wallet — runs server-side"
              : `TP/SL ladder, trailing & migration sell + market-making (${AUTO_LABEL.autobuy}/${AUTO_LABEL.autosell}, ${AUTO_LABEL.volume}, ${AUTO_LABEL.clean})`}
            onClick={() => effectiveKind !== "connected" && setOrderType("adv")}
          />
        </div>

        <Tooltip content={
          effectiveKind === "connected"
            ? "Trades signed with connected Phantom"
            : `${effectiveWallets.length} wallet${effectiveWallets.length === 1 ? "" : "s"} · balance`
        }>
          <span style={walletBalancePillStyle} aria-label="Active wallets">
            {effectiveKind === "connected"
              ? <span style={{ display: "inline-flex", color: "var(--paper-2)", lineHeight: 0 }}>{Icon.phantom(12)}</span>
              : <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--paper)", fontWeight: 600 }}>{effectiveWallets.length}</span>}
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
      {orderType !== "adv" && (
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
            {orderType === "market" ? (
              // Denomination toggle. Buy: pay in quote (SOL/USDC, exact-in) ⇄
              // receive an exact token qty (exact-out). Sell: sell an exact token
              // qty (exact-in) ⇄ receive an exact quote amount (exact-out).
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
            ) : (
              <span
                title={side === "buy" ? `Pay with ${activeQuote.label}` : `Receive ${activeQuote.label}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  flexShrink: 0, padding: "4px 8px",
                  background: "var(--ink-2)",
                  border: "1px solid var(--line-soft)",
                  borderRadius: 4,
                  color: "var(--paper-2)",
                  fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
                }}
              >
                <QuoteAssetIcon label={activeQuote.label} size={14} />
                {activeQuote.label}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── 4) Preset slot + quick amounts ───────────────────────────── */}
      {orderType === "market" && (
        <>
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
        </>
      )}

      {/* ── 5) Config icons row ──────────────────────────────────────── */}
      {orderType !== "adv" && (
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
          {!isPhantomTrade && (
            <>
          <span style={{ color: "var(--line)" }}>|</span>
          <Tooltip content={`Platform fee (${nat}) — sent to the Raze fee wallet on each trade`}>
            <span style={configChipStyle}>
              <CoinIcon size={11} />
              <input
                type="text"
                value={fixedFeeSol}
                onChange={(e) => {
                  const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
                  if (isFinite(v) && v >= 0) setFixedFeeLamports(Math.floor(v * 1e9));
                  else if (e.target.value.trim() === "") setFixedFeeLamports(0);
                }}
                style={{ ...configInputStyle, width: 44 }}
              />
            </span>
          </Tooltip>
          {onSol && (
            <>
          <span style={{ color: "var(--line)" }}>|</span>
          <Tooltip content="MEV protection — relay via a Jito bundle with a sponsor tip (min 0.001 SOL)">
            <button
              type="button"
              onClick={() => setMevProtection((v) => !v)}
              style={{
                ...configChipStyle,
                cursor: "pointer",
                background: "transparent",
                border: "none",
                padding: 0,
                color: mevProtection ? "var(--buy)" : "var(--paper-2)",
              }}
            >
              <BanIcon size={11} />
              <span>{mevProtection ? "On" : "Off"}</span>
            </button>
          </Tooltip>
            </>
          )}
            </>
          )}
        </div>
      )}

      {orderType !== "adv" && (
        <div style={{ padding: "0 12px 10px" }}>
          <button
            onClick={onSubmit}
            disabled={
              busy ||
              effectiveKind === "none" ||
              (orderType === "limit"
                ? (!limitPriceUsd || effectiveKind !== "platform")
                : !(side === "buy" ? buyAmount : sellAmount))
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
            {orderType === "limit"
              ? `Set Limit ${side === "buy" ? "Buy" : "Sell"}`
              : busy
                ? effectiveKind === "connected" ? "Phantom…"
                  : effectiveWallets.length > 1 ? `× ${effectiveWallets.length}` : "Sending…"
                : `${side === "buy" ? "Buy" : "Sell"} ${symbolLabel}`}
          </button>
        </div>
      )}

      {/* Limit price controls (kept for orderType=limit) */}
      {orderType === "limit" && (
        <LimitPriceControls
          marketCap={liveMarketCap > 0 ? liveMarketCap : null}
          inputMode={limitInputMode}
          setInputMode={setLimitInputMode}
          priceUsd={limitPriceUsd}
          setPriceUsd={setLimitPriceUsd}
          sliderPct={limitSliderPct}
          setSliderPct={setLimitSliderPct}
        />
      )}

      {/* ADV — TP/SL ladder + market-making (auto-buy/sell, volume, Auto Clean) */}
      {orderType === "adv" && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <AdvPanel
            mint={mint}
            symbol={info?.symbol ?? null}
            walletIds={effectiveWallets.filter((w) => !w.isConnected).map((w) => w.id)}
            slipBps={slipBps}
            transactionsFeeLamports={transactionsFeeLamports}
          />
          <div style={{ borderTop: "1px solid var(--line-soft)", margin: "2px 12px 0" }} />
          <div style={{ padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {/* unified market-making grid (mirrors the /deploy ADV tab) */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="eyebrow" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: "0.1em" }}>MARKET MAKING</span>
              <button
                onClick={() => setMmRefresh((n) => n + 1)}
                title="Refresh sessions"
                style={{
                  width: 22, height: 22, borderRadius: 6,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", border: "1px solid var(--line-soft)",
                  color: "var(--paper-3)", cursor: "pointer", fontSize: 12, lineHeight: 1,
                }}
              >↻</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <Btn size="sm" tone="primary" style={{ width: "100%" }} onClick={() => setMmCreate("autobuy")}>{AUTO_LABEL.autobuy}</Btn>
              <Btn size="sm" tone="primary" style={{ width: "100%" }} onClick={() => setMmCreate("autosell")}>{AUTO_LABEL.autosell}</Btn>
              <Btn size="sm" style={{ width: "100%" }} onClick={() => setMmCreate("volume")}>{AUTO_LABEL.volume}</Btn>
              <Btn size="sm" tone="primary" style={{ width: "100%" }} onClick={() => setMmCreate("clean")}>{AUTO_LABEL.clean}</Btn>
            </div>
            <AutomodePanel
              embedded
              create={mmCreate === "clean" ? null : mmCreate}
              onCreateChange={(c) => setMmCreate(c)}
              refreshNonce={mmRefresh}
              client={backend}
              wallets={userWallets.wallets}
              pushToast={pushToast}
              mint={mint}
              symbol={info?.symbol ?? null}
            />
            <AutoCleanPanel
              embedded
              createOpen={mmCreate === "clean"}
              onCreateClose={() => setMmCreate(null)}
              refreshNonce={mmRefresh}
              client={backend}
              wallets={userWallets.wallets}
              pushToast={pushToast}
              mint={mint}
              symbol={info?.symbol ?? null}
            />
          </div>
        </div>
      )}

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
          <Tooltip content="Mute dev">
            <button type="button" style={iconBtnStyle} aria-label="Mute"><MuteIcon size={11} /></button>
          </Tooltip>
          <Tooltip content="Search dev">
            <button type="button" style={iconBtnStyle} aria-label="Search">{Icon.search(11)}</button>
          </Tooltip>
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

      {/* ── 16) Dev pill (deploys/migrations + dev buy + age) ──────── */}
      {devAddr && (
        <div style={{ padding: "4px 12px 14px" }}>
          <div style={devPillStyle}>
            <span style={{ display: "inline-flex", color: "var(--paper-3)", lineHeight: 0 }}>{UpArrowIcon(10)}</span>
            <span style={{ color: "var(--paper-2)" }}>{shortAddr(devAddr, 4)}</span>
            <span style={{ display: "inline-flex", color: "var(--paper-3)", lineHeight: 0 }}>{Icon.phantom(10)}</span>
            <span style={{ color: "var(--accent)" }}>
              {creatorMigrations ?? "–"}/{creatorDeploys != null ? Math.max(creatorDeploys, creatorMigrations ?? 0) : "–"}
            </span>
            {creatorBuySol != null && (
              <SolAmount iconSize={10} style={{ color: "var(--paper-2)" }}>{creatorBuySol > 0 ? fmtSol(creatorBuySol, 3) : "0"}</SolAmount>
            )}
            <span style={{ display: "inline-flex", color: "var(--paper-3)", lineHeight: 0 }}>{ClockIcon(10)}</span>
            <span style={{ color: "var(--paper-3)" }}>{tokenAge}</span>
          </div>
        </div>
      )}

      <InstantTradePanel
        isOpen={floatingOpen}
        onClose={() => setFloatingOpen(false)}
        mint={mint}
        onTrade={async (s, amt, isPercentage) => {
          const asString = String(amt);
          const mode = s === "buy" ? buyMode : (isPercentage ? "perWallet" : sellMode);
          // Instant panel: buy amounts are SOL ("quote"); sell amounts are either
          // a % of holdings or an exact token qty, per its own isPercentage flag.
          const denom = s === "buy" ? "quote" : (isPercentage ? "percent" : "token");
          await placeMarketTrade(s, asString, mode, denom);
        }}
      />
      <CalculatePNLModal
        open={pnlOpen}
        onClose={() => setPnlOpen(false)}
        mint={mint}
      />
    </aside>
  );
}

function LimitPriceControls({
  marketCap,
  inputMode, setInputMode,
  priceUsd, setPriceUsd,
  sliderPct, setSliderPct,
}: {
  marketCap: number | null;
  inputMode: "slider" | "custom";
  setInputMode: (m: "slider" | "custom") => void;
  priceUsd: string;
  setPriceUsd: (v: string) => void;
  sliderPct: number;
  setSliderPct: (v: number) => void;
}) {
  function onSlide(pct: number) {
    setSliderPct(pct);
    // The effect below also re-derives priceUsd; calling it here too gives
    // a synchronous update for the slider's drag feedback so the button
    // doesn't flicker disabled→enabled while the effect schedules.
    if (!marketCap || marketCap <= 0) return;
    const target = marketCap * (1 + pct / 100);
    setPriceUsd(target > 0 ? target.toFixed(0) : "");
  }

  // Keep priceUsd locked to (mcap × (1 + slider%)) while in slider mode.
  // Without this, opening the panel with the slider at the default 0%
  // leaves priceUsd empty (its initial state), so SET LIMIT is disabled
  // until the user drags. Re-running on every mcap update also makes the
  // slider track the live chart instead of the page-load snapshot.
  useEffect(() => {
    if (inputMode !== "slider") return;
    if (!marketCap || marketCap <= 0) return;
    const target = marketCap * (1 + sliderPct / 100);
    setPriceUsd(target > 0 ? target.toFixed(0) : "");
  }, [inputMode, sliderPct, marketCap, setPriceUsd]);
  return (
    <div style={{ padding: "4px 12px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={() => setInputMode(inputMode === "custom" ? "slider" : "custom")}
          style={{
            padding: "2px 6px",
            fontSize: 9, fontFamily: "var(--font-mono)",
            color: inputMode === "custom" ? "var(--ink-0)" : "var(--paper-3)",
            background: inputMode === "custom" ? "var(--paper)" : "transparent",
            border: `1px solid ${inputMode === "custom" ? "var(--paper)" : "var(--line-soft)"}`,
            borderRadius: 3,
            cursor: "pointer",
            letterSpacing: "0.06em",
          }}
        >CUSTOM</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--paper-4)" }}>
          now {marketCap && marketCap > 0 ? `$${fmtNum(marketCap)}` : "—"}
        </span>
      </div>

      {inputMode === "custom" ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px",
          background: "var(--ink-0)",
          border: "1px solid var(--line-soft)",
          borderRadius: 4,
        }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--paper-4)" }}>$</span>
          <input
            value={priceUsd}
            onChange={(e) => { setPriceUsd(e.target.value.replace(/[^0-9.]/g, "")); setSliderPct(0); }}
            placeholder="50000"
            inputMode="decimal"
            style={{
              flex: 1, background: "transparent", border: 0, outline: 0,
              fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--paper)",
              minWidth: 0,
            }}
          />
          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--paper-4)" }}>USD</span>
        </div>
      ) : (
        <>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--paper-4)",
          }}>
            <span>-99%</span>
            <span style={{
              color: sliderPct === 0 ? "var(--paper-3)"
                : sliderPct > 0 ? "var(--buy)" : "var(--sell)",
              fontWeight: 600,
            }}>
              {sliderPct > 0 ? "+" : ""}{sliderPct}%
              {priceUsd && (
                <span style={{ color: "var(--paper-4)", marginLeft: 4 }}>
                  (${fmtNum(parseFloat(priceUsd) || 0)})
                </span>
              )}
            </span>
            <span>+200%</span>
          </div>
          <input
            type="range"
            min={-99} max={200} step={1} value={sliderPct}
            onChange={(e) => onSlide(parseInt(e.target.value, 10))}
            style={{ width: "100%", accentColor: "var(--paper)" }}
          />
        </>
      )}
    </div>
  );
}

function LimitHistoryPanel({
  orders, loading, error, marketCap, onCancel, onClose,
}: {
  orders: LimitOrderView[];
  loading: boolean;
  error: string | null;
  marketCap: number | null;
  onCancel: (id: string) => void;
  onClose: () => void;
}) {
  // The hook already scopes to this mint when called with one — no need
  // to re-filter. Show a single status row when there's nothing to list.
  if (orders.length === 0) {
    return (
      <div style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--line-soft)",
        background: "var(--ink-0)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--paper-4)",
      }}>
        <span>
          {error
            ? `Error: ${error}`
            : loading
              ? "Loading limit orders…"
              : "No limit orders for this token."}
        </span>
        <button onClick={onClose} style={{
          background: "transparent", border: 0, color: "var(--paper-4)",
          cursor: "pointer", fontSize: 10,
        }}>close</button>
      </div>
    );
  }
  return (
    <div style={{
      maxHeight: 160, overflowY: "auto",
      borderBottom: "1px solid var(--line-soft)",
      background: "var(--ink-0)",
    }}>
      {orders.map((o) => {
        const pending = o.status === "active";
        const color = o.side === "buy" ? "var(--buy)" : "var(--sell)";
        const target = o.limitConfig.targetMcapUsd;
        const distance = marketCap && marketCap > 0
          ? `${((target / marketCap - 1) * 100).toFixed(1)}%`
          : "—";
        return (
          <div key={o.id} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 12px",
            fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--paper-2)",
            borderBottom: "1px dashed var(--line-soft)",
          }}>
            <span style={{ color, fontWeight: 600, width: 28 }}>{o.side.toUpperCase()}</span>
            <span style={{ color: "var(--paper-3)" }}>MC ${fmtNum(target)}</span>
            {pending && <span style={{ color: "var(--paper-4)" }}>{distance}</span>}
            <span style={{ color: "var(--paper-4)" }}>
              {o.side === "buy" ? `${o.amount}◎` : `${o.amount}%`}
            </span>
            <div style={{ flex: 1 }} />
            <Pill
              tone={
                o.status === "filled" ? "buy"
                  : o.status === "failed" || o.status === "cancelled" || o.status === "expired" ? "sell"
                  : "default"
              }
              size="xs"
            >{o.status}</Pill>
            {pending && (
              <Tooltip content="Cancel">
                <button
                  onClick={() => onCancel(o.id)}
                  style={{
                    background: "transparent", border: 0, padding: 2,
                    color: "var(--paper-4)", cursor: "pointer", fontSize: 11,
                  }}
                  aria-label="Cancel"
                >×</button>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
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

function CoinIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <ellipse cx="8" cy="6" rx="5" ry="2.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 6v3.5c0 1.3 2.2 2.4 5 2.4s5-1.1 5-2.4V6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function BanIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 12L12 4" stroke="currentColor" strokeWidth="1.2" />
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

function MuteIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 6v4h2L8 13V3L4.5 6h-2zM11 6l3 4M14 6l-3 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
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
