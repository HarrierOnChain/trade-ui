"use client";

/**
 * DeployWizard — the "Create a new launch" flow rendered as the /deploy PAGE
 * (inside the shell: topbar, sidebar, footer). NOT a modal — the Deploy nav CTA
 * and the Clone (DNA) action navigate to /deploy, which mounts this.
 *
 * A 3-step launch wizard (pump.fun/Axiom create-flow):
 *   1 · Chain & Launchpad — a centered "Create a new launch" card: blockchain,
 *       launchpad (real project logos), launchpad-specific options, and
 *       Configure Token / Clone / Import entry points.
 *   2 · Token Details     — metadata, image, socials.
 *   3 · Launch Settings   — execution mode, allocation, buyer wallets, and a
 *       live preview (synthetic bonding-curve chart + funding/risk estimation).
 *
 * Wired to OUR real deploy mechanics (`trade.deployLaunch`: explicit buyer
 * wallets + amounts, bundle-vs-stagger, jito tip, slippage, pump.fun features)
 * — no invented Proxima wallet architecture. Launches directly then routes to
 * the live token.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keypair } from "@solana/web3.js";

import { Icon, PlatformLogo, ChainIcon } from "../atoms";
import { TVChart } from "../TVChart";
import { useApp } from "../../contexts/AppContext";
import { useChain } from "../../contexts/ChainContext";
import { useUserWallets } from "../../hooks/useUserWallets";
import { useBackend, type CharitySummary } from "../../api/backend";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useClientNav } from "./ClientPages";
import { tokenHref } from "../../lib/tokenHref";
import { getWire } from "../../lib/wire/singleton";
import { getBackendBase } from "../../api/config";
import { seedPublicMetadata, fetchPublicMetadata } from "../../api/metadata";
import { recordDeployedToken } from "../../lib/deployedTokens";
import { shortAddr, fmtMcap, fmtNum } from "../../lib/format";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { type ChainId } from "../../lib/chains";
import { consumeCloneSeed, peekCloneSeed, clearCloneSeed, CLONE_SEED_EVENT } from "../../lib/deployDraft";
import { registerPreviewToken, clearPreviewToken } from "../../lib/previewData";
import { buildDeploySnapshot, deriveBuyerRows, PREVIEW_SUPPLY } from "../../lib/deployPreview";
import { estimateFunding, type FundingEstimate } from "../../lib/deployFunding";
import { useUserPreference } from "../../hooks/useUserPreference";
import { PREF_KEYS } from "../TradingPanel/presets";
import { MarketMakingDraftConfig, applyMarketMakingDrafts, type MmDraft } from "../../app/automation/_components/automode";
import { AutoCleanDraftConfig, applyAutoCleanDrafts, type CleanDraft } from "../../app/automation/_components/autoClean";

// ── Types / constants ────────────────────────────────────────────────────
type Platform = "pumpfun" | "raydium" | "meteora";
type Quote = "SOL" | "USDC";
type SendMode = "bundle" | "stagger";
type RaydiumBrand = "standard" | "bonkers" | "stonk";

interface PickedCharity { id: string; name: string; logo: string | null; city: string | null; state: string | null }
interface ExtraLaunch {
  bonkType: RaydiumBrand; configAddress: string; initLiqSol: string; initTokenPct: string;
  agentEnabled: boolean; agentBuybackPct: number; shareEnabled: boolean;
  recipients: Array<{ address: string; pct: string }>;
  charityEnabled: boolean; charities: PickedCharity[]; charityPct: number;
}
const DEFAULT_EXTRA: ExtraLaunch = {
  bonkType: "standard", configAddress: "", initLiqSol: "1", initTokenPct: "50",
  agentEnabled: false, agentBuybackPct: 50, shareEnabled: false, recipients: [],
  charityEnabled: false, charities: [], charityPct: 100,
};
const MAX_RECIPIENTS = 9;
interface TokenMetadata { name: string; symbol: string; description: string; imageUrl: string; twitter: string; telegram: string; website: string }
interface WalletAlloc { id: string; address: string; label: string; amount: string; source: Quote }
interface LaunchSuccess { success: true; bundleId: string; mint: string | null; txCount: number; region: string }

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_WALLET_AMOUNT: Record<Quote, string> = { SOL: "0.05", USDC: "10" };
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME_ALLOW = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];

// `logo` feeds PlatformLogo → real project SVG (public/platforms/*.svg).
// Raydium covers letsbonk + stonkfun (brand picker below). Meteora is Bags
// only for now. `match` marks the card active; `pick` sets the backend platform.
type LaunchpadKey = "pumpfun" | "raydium" | "meteora";
const LAUNCHPAD_OPTIONS: Array<{ key: LaunchpadKey; name: string; logo: string; tint: string; match: (p: Platform) => boolean; pick: Platform }> = [
  { key: "pumpfun", name: "Pump.fun", logo: "pumpfun", tint: "var(--buy)", match: (p) => p === "pumpfun", pick: "pumpfun" },
  { key: "raydium", name: "Raydium", logo: "raydium", tint: "#8c7cff", match: (p) => p === "raydium", pick: "raydium" },
  { key: "meteora", name: "Meteora", logo: "meteora", tint: "var(--info)", match: (p) => p === "meteora", pick: "meteora" },
];
const PLATFORM_LABEL: Record<Platform, string> = {
  pumpfun: "Pump.fun", raydium: "Raydium", meteora: "Meteora",
};
const PLATFORM_LOGO: Record<Platform, string> = {
  pumpfun: "pumpfun", raydium: "raydium", meteora: "meteora",
};
const TIP_PRESETS: Array<{ label: string; v: string }> = [
  { label: "Fast", v: "0.001" }, { label: "Turbo", v: "0.005" }, { label: "Max", v: "0.01" },
];
const STEPS = [
  { label: "Chain & Launchpad", short: "Launchpad" },
  { label: "Token Details", short: "Token" },
  { label: "Launch Settings", short: "Launch" },
];
const EVM_PADS: Record<ChainId, Array<{ name: string; logo: string; soon?: boolean }>> = {
  sol: [],
  eth: [
    { name: "Uniswap v2", logo: "uniswap", soon: true },
    { name: "Uniswap v4", logo: "uniswap", soon: true },
  ],
  bsc: [
    { name: "Four.meme", logo: "fourmeme", soon: true },
    { name: "Flap", logo: "flap", soon: true },
    { name: "Printr", logo: "printr", soon: true },
  ],
  base: [
    { name: "Bankr", logo: "bankr", soon: true },
    { name: "Clanker", logo: "clanker", soon: true },
  ],
  robinhood: [
    { name: "pons.family", logo: "pons" },
    { name: "hood.fun", logo: "hoodfun", soon: true },
    { name: "flap.sh", logo: "flap", soon: true },
  ],
};
const CHAIN_PAD_NOTE: Record<ChainId, string> = {
  sol: "3 launchpads",
  eth: "browse",
  bsc: "browse",
  base: "browse",
  robinhood: "pons.family",
};

/**
 * The deploy wizard, rendered full-page inside the shell by /deploy.
 */
export function DeployWizard() {
  const { wallets, activeWallets } = useUserWallets();
  const { chainId, chain, setChain } = useChain();
  const backend = useBackend();
  const { pushToast } = useApp();
  const { navigate } = useClientNav();
  const isPhone = useIsPhone();
  const solPrice = useSolPrice();

  // Consume a pending clone seed on a fresh mount (must run before `step` so it
  // can open straight on Token Details with the cloned metadata visible).
  const clonedOnMount = useRef(false);
  const [tokenData, setTokenData] = useState<TokenMetadata>(() => {
    const seed = consumeCloneSeed();
    clonedOnMount.current = !!seed;
    return seed ? { ...seed } : { name: "", symbol: "", description: "", imageUrl: "", twitter: "", telegram: "", website: "" };
  });
  const [step, setStep] = useState(() => (clonedOnMount.current ? 1 : 0));
  const [platform, setPlatform] = useState<Platform>("pumpfun");
  const [quote, setQuote] = useState<Quote>("SOL");
  const [pumpType, setPumpType] = useState(false);
  const [holderReward, setHolderReward] = useState(false);
  const [jitoTipSol, setJitoTipSol] = useState("0.001");
  const [slippageBps, setSlippageBps] = useState("9900");
  // Same preference as TradingPanel — flat SOL tip to the admin fee wallet.
  const [fixedFeeLamports, setFixedFeeLamports] = useUserPreference<number>(PREF_KEYS.fixedFee, 0);
  const [sendMode, setSendMode] = useState<SendMode>("bundle");
  const [staggerMinSec, setStaggerMinSec] = useState("5");
  const [staggerMaxSec, setStaggerMaxSec] = useState("15");
  const [extra, setExtra] = useState<ExtraLaunch>(DEFAULT_EXTRA);
  const [selectedWallets, setSelectedWallets] = useState<WalletAlloc[]>([]);
  const [mmDrafts, setMmDrafts] = useState<MmDraft[]>([]);
  const [cleanDrafts, setCleanDrafts] = useState<CleanDraft[]>([]);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const patchExtra = (p: Partial<ExtraLaunch>) => setExtra((e) => ({ ...e, ...p }));

  // Fixed placeholder mint + epoch — the synthetic preview registers under this
  // mint so the TVChart datafeed reads it; the epoch keeps candle times frozen.
  const [placeholderMint] = useState(() => Keypair.generate().publicKey.toBase58());
  const [previewEpoch] = useState(() => Date.now());

  // Clone into an ALREADY-MOUNTED wizard (navigate didn't remount it because the
  // /deploy route was already live). Applies the seed + jumps to Token Details.
  // Clears via microtask so the nav's synchronous reset-guard still sees it.
  useEffect(() => {
    const onClone = () => {
      const seed = peekCloneSeed();
      if (!seed) return;
      setTokenData({ ...seed });
      setStep(1);
      queueMicrotask(clearCloneSeed);
    };
    window.addEventListener(CLONE_SEED_EVENT, onClone);
    return () => window.removeEventListener(CLONE_SEED_EVENT, onClone);
  }, []);

  const tradeable = useMemo(() => wallets.filter((w) => w.kind === "PLATFORM"), [wallets]);

  // Seed buyers from the globally-active platform wallets on first open.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || tradeable.length === 0) return;
    seeded.current = true;
    const byId = new Set(tradeable.map((w) => w.id));
    const active = activeWallets.filter((w) => w.kind === "PLATFORM" && byId.has(w.id));
    if (active.length > 0) {
      setSelectedWallets(active.map((w) => ({ id: w.id, address: w.pubkey, label: w.displayLabel, amount: DEFAULT_WALLET_AMOUNT[quote], source: quote })));
    }
  }, [tradeable, activeWallets, quote]);

  const uploadImage = useCallback(async (file: File) => {
    setImageError(null);
    if (!IMAGE_MIME_ALLOW.includes(file.type)) { setImageError("Unsupported image type"); return; }
    if (file.size > IMAGE_MAX_BYTES) { setImageError("Image too large (max 8 MB)"); return; }
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file, file.name);
      const base = getBackendBase().replace(/\/$/, "");
      const resp = await fetch(`${base}/img/upload`, { method: "POST", body: fd });
      const json = (await resp.json().catch(() => null)) as
        | { success: true; path: string; ipfsUrl?: string; cid?: string }
        | { success: false; error?: string }
        | null;
      if (!resp.ok || !json || !json.success) { setImageError((json && !json.success && json.error) || `Upload failed (${resp.status})`); return; }
      // Prefer pump.fun→Pinata IPFS URL so launch skips history kubo.
      setTokenData((cur) => ({ ...cur, imageUrl: json.ipfsUrl || `${base}${json.path}` }));
    } catch (err) { setImageError(err instanceof Error ? err.message : String(err)); }
    finally { setImageUploading(false); }
  }, []);

  // Prefill the form from an existing token's on-chain metadata (Clone / Import).
  const startFromMint = useCallback(async (raw: string): Promise<string | null> => {
    const mint = raw.trim().split(/[/?]/).filter(Boolean).pop() ?? "";
    if (mint.length < 32) return "Enter a valid token mint";
    try {
      const meta = await fetchPublicMetadata(mint);
      if (!meta || (!meta.name && !meta.symbol && !meta.image)) return "No metadata found for that mint";
      setTokenData((c) => ({
        ...c,
        name: meta.name || c.name, symbol: (meta.symbol || c.symbol).slice(0, 10),
        imageUrl: meta.image || c.imageUrl,
        twitter: meta.twitter || c.twitter, telegram: meta.telegram || c.telegram, website: meta.website || c.website,
      }));
      setStep(1);
      return null;
    } catch (err) { return err instanceof Error ? err.message : "Fetch failed"; }
  }, []);

  const toggleBuyer = useCallback((w: { id: string; pubkey: string; displayLabel: string }) => {
    setSelectedWallets((cur) => {
      if (cur.some((c) => c.id === w.id)) return cur.filter((c) => c.id !== w.id);
      return [...cur, { id: w.id, address: w.pubkey, label: w.displayLabel, amount: DEFAULT_WALLET_AMOUNT[quote], source: quote }];
    });
  }, [quote]);
  const setBuyerAmount = useCallback((id: string, amount: string) => {
    const cleaned = amount.replace(/[^0-9.]/g, "");
    setSelectedWallets((cur) => cur.map((c) => (c.id === id ? { ...c, amount: cleaned } : c)));
  }, []);

  const totalSol = selectedWallets.reduce((a, w) => a + (parseFloat(w.amount) || 0), 0);
  const recipPctSum = extra.recipients.reduce((s, r) => s + (parseInt(r.pct, 10) || 0), 0);
  const charityPctVal = extra.charityEnabled ? Math.max(0, Math.min(100, Math.round(extra.charityPct))) : 0;
  const recipOk = !extra.shareEnabled || (extra.recipients.length >= 1 && extra.recipients.length <= MAX_RECIPIENTS && extra.recipients.every((r) => r.address.trim().length > 0 && (parseInt(r.pct, 10) || 0) >= 1) && recipPctSum >= 1);
  const charityOk = !extra.charityEnabled || (extra.charities.length >= 1 && charityPctVal >= 1);
  const allocPct = (extra.shareEnabled ? recipPctSum : 0) + charityPctVal;
  const sharesValid = recipOk && charityOk && allocPct <= 100;
  const youKeepPct = 100 - (extra.shareEnabled ? recipPctSum : 0) - charityPctVal;

  const metaValid = !!tokenData.name && !!tokenData.symbol && !!tokenData.imageUrl;
  const walletsValid = selectedWallets.length >= 1 && selectedWallets.every((w) => parseFloat(w.amount) > 0);
  const canLaunch = chainId === "sol" && metaValid && walletsValid && sharesValid && !submitting;
  const stepValid = step === 0 ? sharesValid : step === 1 ? metaValid : (walletsValid && sharesValid);

  const enabledFeatures = platform === "pumpfun"
    ? [pumpType && "Mayhem", holderReward && "Holder rewards", extra.agentEnabled && "Agent", extra.shareEnabled && "Rewards", extra.charityEnabled && "Charity"].filter(Boolean) as string[]
    : [];

  const funding = useMemo<FundingEstimate>(() => estimateFunding({
    buyers: selectedWallets.map((w) => ({ address: w.address, amount: w.amount })),
    quoteIsSol: quote === "SOL",
    solPriceUsd: solPrice ?? 0,
    quotePriceUsd: quote === "SOL" ? (solPrice ?? 0) : 1,
    jitoTipSol: parseFloat(jitoTipSol) || 0,
    platformFeeSol: (fixedFeeLamports || 0) / 1e9,
  }), [selectedWallets, quote, solPrice, jitoTipSol, fixedFeeLamports]);

  // ── Live synthetic preview registration (feeds the TVChart datafeed) ──
  useEffect(() => {
    registerPreviewToken(placeholderMint, buildDeploySnapshot({
      mint: placeholderMint,
      name: tokenData.name, symbol: tokenData.symbol, image: tokenData.imageUrl || null,
      dex: platform === "pumpfun" ? "pumpfun" : platform,
      buyers: selectedWallets.map((w) => ({ address: w.address, amount: w.amount })),
      epochMs: previewEpoch,
      sendMode: quote === "SOL" ? sendMode : "bundle",
      staggerStepMs: ((parseFloat(staggerMinSec) || 5) + (parseFloat(staggerMaxSec) || 15)) / 2 * 1000,
    }));
    seedPublicMetadata(placeholderMint, {
      name: tokenData.name || undefined, symbol: tokenData.symbol || undefined, image: tokenData.imageUrl || undefined,
    });
  }, [placeholderMint, tokenData, platform, selectedWallets, sendMode, staggerMinSec, staggerMaxSec, quote, previewEpoch]);
  useEffect(() => () => clearPreviewToken(placeholderMint), [placeholderMint]);

  // ── Launch ────────────────────────────────────────────────────────────
  const onDeploy = useCallback(async () => {
    if (!canLaunch) return;
    setSubmitting(true);
    try {
      const params = {
        platform,
        quoteMint: quote === "USDC" ? USDC_MINT : "SOL",
        wallets: selectedWallets.map((w) => ({ walletId: w.id, amount: parseFloat(w.amount) || 0 })),
        token: {
          name: tokenData.name, symbol: tokenData.symbol,
          description: tokenData.description || undefined, imageUrl: tokenData.imageUrl,
          twitter: tokenData.twitter || undefined, telegram: tokenData.telegram || undefined, website: tokenData.website || undefined,
        },
        pumpType: pumpType || undefined,
        holderReward: holderReward || undefined,
        ...(platform === "raydium" ? { bonkType: extra.bonkType } : {}),
        ...(platform === "pumpfun" && extra.agentEnabled ? { tokenizedAgent: { buybackBps: Math.round((extra.agentBuybackPct || 0) * 100) } } : {}),
        ...(platform === "pumpfun" ? (() => {
          const recip = (extra.shareEnabled ? extra.recipients : []).map((r) => ({ address: r.address.trim(), pct: parseInt(r.pct, 10) || 0 })).filter((r) => r.address.length > 0 && r.pct > 0);
          const recipPct = recip.reduce((a, r) => a + r.pct, 0);
          const charPct = extra.charityEnabled && extra.charities.length > 0 ? Math.max(0, Math.min(100, Math.round(extra.charityPct))) : 0;
          if (recip.length === 0 && charPct === 0) return {};
          const out: Record<string, unknown> = {};
          const youKeepBps = (100 - recipPct - charPct) * 100;
          const creatorAddr = selectedWallets[0]?.address;
          const shareholders = [
            ...(youKeepBps > 0 && creatorAddr ? [{ address: creatorAddr, shareBps: youKeepBps }] : []),
            ...recip.map((r) => ({ address: r.address, shareBps: r.pct * 100 })),
          ];
          if (shareholders.length > 0) out.feeShare = { shareholders };
          if (charPct > 0) {
            const n = extra.charities.length;
            out.feeCharity = { shareBps: charPct * 100, beneficiaries: extra.charities.map((c, i) => ({ charityId: c.id, weight: Math.floor(100 / n) + (i < 100 % n ? 1 : 0) })) };
          }
          return out;
        })() : {}),
        slippageBps: parseInt(slippageBps, 10) || 9900,
        jitoTipAmountSol: parseFloat(jitoTipSol) || 0.001,
        ...(fixedFeeLamports > 0 ? { fixedFeeLamports } : {}),
        ...(sendMode === "stagger" && quote === "SOL" ? { stagger: { delayMinSec: parseFloat(staggerMinSec) || 5, delayMaxSec: parseFloat(staggerMaxSec) || 15 } } : {}),
      };
      const resp = await getWire(getBackendBase()).call<LaunchSuccess>("trade.deployLaunch", params);
      if (resp.mint) {
        seedPublicMetadata(resp.mint, {
          name: tokenData.name || undefined, symbol: tokenData.symbol || undefined, image: tokenData.imageUrl || undefined,
          twitter: tokenData.twitter || undefined, telegram: tokenData.telegram || undefined, website: tokenData.website || undefined,
        });
        recordDeployedToken({
          mint_address: resp.mint, name: tokenData.name || "Untitled token", symbol: tokenData.symbol || "TKR",
          dex: platform === "pumpfun" ? "pumpfun" : platform, image: tokenData.imageUrl || null,
          twitter: tokenData.twitter || null, telegram: tokenData.telegram || null, website: tokenData.website || null,
          marketCap: 0, created_at: new Date().toISOString(),
        });
        pushToast({ title: "LIVE", body: `${tokenData.symbol.trim() || "Token"} · ${shortAddr(resp.mint, 6)}`, tone: "buy" });
        if (mmDrafts.length > 0) void applyMarketMakingDrafts(backend, resp.mint, tokenData.symbol.trim() || undefined, mmDrafts).then(({ armed }) => { if (armed > 0) pushToast({ title: "MARKET MAKING ARMED", body: `${armed} session${armed === 1 ? "" : "s"}`, tone: "buy" }); }).catch(() => {});
        if (cleanDrafts.length > 0) void applyAutoCleanDrafts(backend, resp.mint, tokenData.symbol.trim() || undefined, cleanDrafts).then((n) => { if (n > 0) pushToast({ title: "AUTO CLEAN ARMED", body: `${n} queued (paused)`, tone: "buy" }); }).catch(() => {});
        navigate(tokenHref(resp.mint));
      } else {
        pushToast({ title: "BUNDLE SENT", body: `${resp.txCount} tx · ${shortAddr(resp.bundleId, 6)}`, tone: "buy" });
      }
    } catch (err) {
      pushToast({ title: "DEPLOY FAILED", body: err instanceof Error ? err.message : String(err), tone: "sell" });
    } finally { setSubmitting(false); }
  }, [canLaunch, platform, quote, selectedWallets, tokenData, pumpType, holderReward, slippageBps, jitoTipSol, fixedFeeLamports, sendMode, staggerMinSec, staggerMaxSec, extra, mmDrafts, cleanDrafts, backend, pushToast, navigate]);

  const goNext = () => { if (step < 2 && stepValid) setStep(step + 1); };
  const headerPad = chainId === "sol"
    ? { name: PLATFORM_LABEL[platform], logo: PLATFORM_LOGO[platform] }
    : (EVM_PADS[chainId]?.find((p) => !p.soon) ?? EVM_PADS[chainId]?.[0] ?? null);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--ink-0)" }}>
      {/* Slim header: breadcrumb + centered stepper tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 18px", height: 46, borderBottom: "1px solid var(--line-soft)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flexShrink: 0 }}>
          <span style={{ display: "inline-flex", color: "var(--paper-3)" }}><ChainIcon id={chainId} size={14} /></span>
          <span style={{ fontSize: 12, color: "var(--paper-3)" }}>{chain.name}</span>
          {headerPad && (
            <>
              <span style={{ fontSize: 12, color: "var(--paper-4)" }}>›</span>
              <PlatformLogo platform={headerPad.logo} size={13} />
              <span style={{ fontSize: 12, color: "var(--paper-2)" }}>{headerPad.name}</span>
            </>
          )}
        </div>
        {!isPhone && <TabStepper step={step} setStep={setStep} metaValid={metaValid} />}
        <span style={{ marginLeft: "auto", flexShrink: 0, width: isPhone ? 0 : 120 }} />
      </div>
      {isPhone && <div style={{ padding: "8px 12px 0", overflowX: "auto" }}><TabStepper step={step} setStep={setStep} metaValid={metaValid} /></div>}

      {/* Step body */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {step === 0 && (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isPhone ? 14 : "26px 24px" }}>
            <StepCard icon={Icon.pill(150)}>
              <StepLaunchpad
                platform={platform} setPlatform={setPlatform}
                pumpType={pumpType} setPumpType={setPumpType}
                holderReward={holderReward} setHolderReward={setHolderReward}
                extra={extra} patchExtra={patchExtra}
                youKeepPct={youKeepPct} recipPctSum={recipPctSum} isPhone={isPhone}
                chainId={chainId} setChain={setChain}
              />
              <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
                <button type="button" onClick={goNext} disabled={!sharesValid}
                  style={{ padding: "11px 30px", borderRadius: 10, border: 0, background: sharesValid ? "var(--accent)" : "var(--ink-2)", color: sharesValid ? "var(--ink-0)" : "var(--paper-4)", fontSize: 13.5, fontWeight: 700, cursor: sharesValid ? "pointer" : "not-allowed" }}>
                  Configure Token →
                </button>
              </div>
              <CloneImportRow startFromMint={startFromMint} isPhone={isPhone} />
            </StepCard>
          </div>
        )}
        {step === 1 && (
          <>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isPhone ? 16 : "26px 24px" }}>
              <StepCard icon={Icon.palette(140)} maxWidth={720}>
                <SectionHeading title="Token details" desc="How your token appears on explorers, wallets and launchpads." />
                <div style={{ marginTop: 16 }}>
                  <StepToken tokenData={tokenData} setTokenData={setTokenData} uploadImage={uploadImage} imageUploading={imageUploading} imageError={imageError} onClearImage={() => setTokenData((c) => ({ ...c, imageUrl: "" }))} isPhone={isPhone} />
                </div>
              </StepCard>
            </div>
            <FooterBar step={step} onBack={() => setStep(0)} primary={{ label: "Continue →", onClick: goNext, disabled: !metaValid, tone: "accent" }} />
          </>
        )}
        {step === 2 && (
          <>
            <div style={{ flex: 1, minHeight: 0, display: "flex", padding: isPhone ? 0 : "14px 18px" }}>
              <StepCard wide icon={Icon.rocketSharp(150)}>
                <div style={{ flex: 1, minHeight: 0, display: isPhone ? "block" : "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 430px)", overflow: isPhone ? "auto" : "hidden" }}>
                  <div style={{ minHeight: 0, overflowY: isPhone ? "visible" : "auto", padding: isPhone ? 16 : 20, display: "flex", flexDirection: "column", gap: 18, borderRight: isPhone ? "none" : "1px solid var(--line-soft)" }}>
                    <LaunchSettings
                      platform={platform} quote={quote} setQuote={setQuote}
                      sendMode={sendMode} setSendMode={setSendMode}
                      staggerMinSec={staggerMinSec} setStaggerMinSec={setStaggerMinSec}
                      staggerMaxSec={staggerMaxSec} setStaggerMaxSec={setStaggerMaxSec}
                      jitoTipSol={jitoTipSol} setJitoTipSol={setJitoTipSol}
                      slippageBps={slippageBps} setSlippageBps={setSlippageBps}
                      fixedFeeLamports={fixedFeeLamports} setFixedFeeLamports={setFixedFeeLamports}
                      backend={backend} tradeable={tradeable} selectedWallets={selectedWallets}
                      mmDrafts={mmDrafts} setMmDrafts={setMmDrafts} cleanDrafts={cleanDrafts} setCleanDrafts={setCleanDrafts}
                    />
                    <BuyersPicker
                      tradeable={tradeable} selectedWallets={selectedWallets} toggleBuyer={toggleBuyer} setBuyerAmount={setBuyerAmount}
                      quote={quote} solPrice={solPrice ?? 0}
                    />
                  </div>
                  <PreviewPanel
                    mint={placeholderMint} solPrice={solPrice ?? 0}
                    tokenData={tokenData} platform={platform} quote={quote} sendMode={sendMode}
                    selectedWallets={selectedWallets} totalSol={totalSol} enabledFeatures={enabledFeatures}
                    funding={funding} isPhone={isPhone}
                  />
                </div>
              </StepCard>
            </div>
            <FooterBar step={step} onBack={() => setStep(1)} primary={{ label: submitting ? "Launching…" : `Launch ${tokenData.symbol.trim() || "TOKEN"}`, onClick: onDeploy, disabled: !canLaunch, tone: "buy" }} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Chrome ──────────────────────────────────────────────────────────────────
function TabStepper({ step, setStep, metaValid }: { step: number; setStep: (s: number) => void; metaValid: boolean }) {
  const canGoTo = (i: number) => i <= step || i === 1 || (i === 2 && metaValid);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, margin: "0 auto" }}>
      {STEPS.map((s, i) => {
        const active = i === step;
        const done = i < step;
        const reachable = canGoTo(i);
        return (
          <React.Fragment key={s.label}>
            {i > 0 && <span style={{ width: 18, height: 1, background: done ? "var(--accent)" : "var(--line-soft)" }} />}
            <button type="button" onClick={() => reachable && setStep(i)} disabled={!reachable}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 8, border: 0, background: active ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "transparent", cursor: reachable ? "pointer" : "default" }}>
              <span style={{ width: 17, height: 17, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, fontWeight: 700, fontFamily: "var(--font-mono)", background: active || done ? "var(--accent)" : "var(--ink-2)", color: active || done ? "var(--ink-0)" : "var(--paper-4)" }}>{done ? "✓" : i + 1}</span>
              <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, letterSpacing: "0.04em", textTransform: "uppercase", color: active ? "var(--paper)" : done ? "var(--paper-2)" : "var(--paper-4)" }}>{s.label}</span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function FooterBar({ step, onBack, primary }: { step: number; onBack: () => void; primary: { label: string; onClick: () => void; disabled?: boolean; tone: "accent" | "buy" } }) {
  const bg = primary.disabled ? "var(--ink-2)" : primary.tone === "buy" ? "var(--buy)" : "var(--accent)";
  const fg = primary.disabled ? "var(--paper-4)" : "var(--ink-0)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: "1px solid var(--line-soft)", flexShrink: 0, background: "var(--ink-1)" }}>
      <button type="button" onClick={onBack} style={{ padding: "10px 16px", borderRadius: 9, border: "1px solid var(--line-soft)", background: "transparent", color: "var(--paper-2)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Back</button>
      <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--paper-4)" }}>Step {step + 1} of 3 · {STEPS[step]!.label}</span>
      <button type="button" onClick={primary.onClick} disabled={primary.disabled}
        style={{ padding: "10px 26px", borderRadius: 9, border: 0, background: bg, color: fg, fontSize: 13, fontWeight: 700, cursor: primary.disabled ? "not-allowed" : "pointer", boxShadow: !primary.disabled && primary.tone === "buy" ? "0 6px 18px -8px var(--buy)" : "none" }}>
        {primary.label}
      </button>
    </div>
  );
}

// Clone — start a launch from an existing token's metadata.
function CloneImportRow({ startFromMint }: { startFromMint: (m: string) => Promise<string | null>; isPhone: boolean }) {
  const [open, setOpen] = useState(false);
  const [mint, setMint] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    const e = await startFromMint(mint);
    setBusy(false);
    if (e) setErr(e);
  };
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 14px" }}>
        <span style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--paper-4)", letterSpacing: "0.14em" }}>OR</span>
        <span style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
      </div>
      <div style={{ maxWidth: 320, margin: "0 auto" }}>
        <button type="button" onClick={() => { setOpen(!open); setErr(null); }} style={{ ...secondaryBtn(open), width: "100%" }}>{Icon.dna(14)}<span>Clone a Token</span></button>
      </div>
      {open && (
        <div style={{ maxWidth: 460, margin: "12px auto 0", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={mint} onChange={(e) => setMint(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !busy) void submit(); }} placeholder="Token mint to clone…" style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12 }} autoFocus />
            <button type="button" onClick={() => void submit()} disabled={busy || mint.trim().length < 32} style={{ flexShrink: 0, padding: "0 16px", borderRadius: 8, border: 0, background: busy || mint.trim().length < 32 ? "var(--ink-2)" : "var(--accent)", color: busy || mint.trim().length < 32 ? "var(--paper-4)" : "var(--ink-0)", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>{busy ? "…" : "Load"}</button>
          </div>
          <p style={{ ...hint, margin: 0, color: err ? "var(--sell)" : "var(--paper-4)" }}>{err || "Pulls name, symbol, image and socials — you pick the launchpad & options."}</p>
        </div>
      )}
    </div>
  );
}
function secondaryBtn(active: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 14px", borderRadius: 10, cursor: "pointer",
    border: `1px solid ${active ? "var(--accent)" : "var(--line-soft)"}`, background: active ? "var(--ink-2)" : "var(--ink-0)", color: "var(--paper-2)", fontSize: 12.5, fontWeight: 600 };
}

function SectionHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--paper)" }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--paper-4)", marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

// Shared "grey box" that frames every wizard step with a faint decorative icon
// in the top-right corner (like the step-1 pill), for a consistent look.
// `wide` fills the page height (step 3's 2-col); otherwise it's a centered card.
function StepCard({ icon, wide, maxWidth = 860, children }: { icon: React.ReactNode; wide?: boolean; maxWidth?: number; children: React.ReactNode }) {
  return (
    <div style={{
      position: "relative", background: "var(--ink-1)", border: "1px solid var(--line-soft)", borderRadius: 16, overflow: "hidden",
      ...(wide ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } : { maxWidth, margin: "0 auto", padding: 28 }),
    }}>
      <span aria-hidden style={{ position: "absolute", top: -18, right: -8, opacity: 0.05, color: "var(--paper)", pointerEvents: "none", zIndex: 3 }}>{icon}</span>
      {children}
    </div>
  );
}

// ── Launch settings (left column, step 3) ───────────────────────────────────
function LaunchSettings(props: {
  platform: Platform; quote: Quote; setQuote: (q: Quote) => void;
  sendMode: SendMode; setSendMode: (m: SendMode) => void; staggerMinSec: string; setStaggerMinSec: (v: string) => void; staggerMaxSec: string; setStaggerMaxSec: (v: string) => void;
  jitoTipSol: string; setJitoTipSol: (v: string) => void; slippageBps: string; setSlippageBps: (v: string) => void;
  fixedFeeLamports: number; setFixedFeeLamports: (v: number) => void;
  backend: ReturnType<typeof useBackend>; tradeable: ReturnType<typeof useUserWallets>["wallets"]; selectedWallets: WalletAlloc[];
  mmDrafts: MmDraft[]; setMmDrafts: React.Dispatch<React.SetStateAction<MmDraft[]>>; cleanDrafts: CleanDraft[]; setCleanDrafts: React.Dispatch<React.SetStateAction<CleanDraft[]>>;
}) {
  const { platform, quote, setQuote, sendMode, setSendMode, staggerMinSec, setStaggerMinSec, staggerMaxSec, setStaggerMaxSec, jitoTipSol, setJitoTipSol, slippageBps, setSlippageBps, fixedFeeLamports, setFixedFeeLamports, backend, tradeable, selectedWallets, mmDrafts, setMmDrafts, cleanDrafts, setCleanDrafts } = props;
  const slipPct = ((parseInt(slippageBps, 10) || 0) / 100).toFixed(1);
  const fixedFeeSol = ((fixedFeeLamports || 0) / 1e9).toFixed(4);
  // Tokens each buy-wallet WILL hold post-launch (bonding-curve walk in buyer
  // order) — lets Auto-clean show the planned deploy buyers as "holders" before
  // the mint exists, instead of reporting zero supply for everyone.
  const previewSupply = useMemo(() => {
    const rows = deriveBuyerRows(selectedWallets.map((w) => ({ address: w.address, amount: w.amount })));
    const map: Record<string, number> = {};
    selectedWallets.forEach((w, i) => { map[w.id] = rows[i]?.tokens ?? 0; });
    return map;
  }, [selectedWallets]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {platform === "pumpfun" && (
        <Field label="QUOTE">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <Seg label="SOL" active={quote === "SOL"} onClick={() => setQuote("SOL")} />
            <Seg label="USDC" active={quote === "USDC"} onClick={() => setQuote("USDC")} />
          </div>
        </Field>
      )}
      <Field label="EXECUTION MODE">
        <ModeCard title="Bundle" active={sendMode === "bundle"} onClick={() => setSendMode("bundle")}
          desc="Atomic Jito bundle — every buyer lands in the same block (5 tx/slot). Snipers can't wedge between your wallets." />
        <ModeCard title="Stagger" active={sendMode === "stagger"} onClick={() => quote === "SOL" && setSendMode("stagger")} disabled={quote !== "SOL"}
          desc={quote === "SOL" ? "Create + dev buy first, then each wallet buys with a randomized delay — looks organic, less bundle-clustered." : "Needs a SOL quote."} />
        {sendMode === "stagger" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 10, color: "var(--paper-3)", letterSpacing: "0.06em" }}>DELAY</span>
            <NumField label="min s" value={staggerMinSec} onChange={setStaggerMinSec} inline />
            <NumField label="max s" value={staggerMaxSec} onChange={setStaggerMaxSec} inline />
          </div>
        )}
      </Field>
      <Field label="PRIORITY (JITO TIP)">
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {TIP_PRESETS.map((t) => <Seg key={t.v} label={<span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>{t.label} · {Icon.solana(9)}{t.v}</span>} active={jitoTipSol === t.v} onClick={() => setJitoTipSol(t.v)} small />)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <NumField label="JITO TIP (SOL)" value={jitoTipSol} onChange={setJitoTipSol} />
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "var(--paper-4)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>SLIPPAGE %</span>
            <input value={slipPct} onChange={(e) => { const v = parseFloat(e.target.value.replace(/[^0-9.]/g, "")); if (isFinite(v) && v >= 0) setSlippageBps(String(Math.min(10000, Math.round(v * 100)))); }} style={{ ...inputStyle, fontFamily: "var(--font-mono)", textAlign: "right" }} />
          </label>
        </div>
      </Field>
      <Field label="PLATFORM FEE">
        <p style={{ ...hint, margin: "0 0 8px" }}>Flat SOL tip to the platform fee wallet (same setting as the trading panel). Admin % fee applies automatically when configured.</p>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 9, color: "var(--paper-4)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>FEE (SOL)</span>
          <input
            value={fixedFeeSol}
            onChange={(e) => {
              const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
              if (!isFinite(v) || v < 0) { setFixedFeeLamports(0); return; }
              setFixedFeeLamports(Math.min(Math.round(v * 1e9), 10_000_000_000));
            }}
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", textAlign: "right" }}
          />
        </label>
      </Field>
      <Field label="POST-LAUNCH AUTOMATION (OPTIONAL)">
        <p style={{ ...hint, margin: "0 0 4px" }}>Queued now, armed on your token the instant it launches.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <AutoCleanDraftConfig embedded client={backend} wallets={tradeable} value={cleanDrafts} onChange={setCleanDrafts} previewSupply={previewSupply} />
          <MarketMakingDraftConfig embedded client={backend} wallets={tradeable} value={mmDrafts} onChange={setMmDrafts} />
        </div>
      </Field>
    </div>
  );
}

function ModeCard({ title, desc, active, onClick, disabled }: { title: string; desc: string; active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 12px", borderRadius: 10, textAlign: "left", width: "100%", marginBottom: 6, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
      border: `1px solid ${active ? "var(--accent)" : "var(--line-soft)"}`, background: active ? "var(--ink-2)" : "var(--ink-0)" }}>
      <span style={{ width: 15, height: 15, borderRadius: 999, marginTop: 1, flexShrink: 0, border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`, background: active ? "var(--accent)" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{active && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ink-0)" }} />}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)", display: "block" }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--paper-4)", lineHeight: 1.45, display: "block", marginTop: 2 }}>{desc}</span>
      </span>
    </button>
  );
}

// ── Buyers picker (left column, step 3) ─────────────────────────────────────
function BuyersPicker({ tradeable, selectedWallets, toggleBuyer, setBuyerAmount, quote, solPrice }: {
  tradeable: ReturnType<typeof useUserWallets>["wallets"]; selectedWallets: WalletAlloc[];
  toggleBuyer: (w: { id: string; pubkey: string; displayLabel: string }) => void; setBuyerAmount: (id: string, a: string) => void;
  quote: Quote; solPrice: number;
}) {
  const selIds = useMemo(() => new Set(selectedWallets.map((w) => w.id)), [selectedWallets]);
  const derived = useMemo(() => deriveBuyerRows(selectedWallets.map((w) => ({ address: w.address, amount: w.amount }))), [selectedWallets]);
  return (
    <Field label={`BUYERS · ${selectedWallets.length} selected`}>
      <p style={{ ...hint, margin: "0 0 6px" }}>The first selected wallet is the <strong style={{ color: "var(--paper-2)" }}>dev</strong> (creates the token). Others buy in the same bundle.</p>
      {tradeable.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "var(--paper-4)", border: "1px dashed var(--line-soft)", borderRadius: 10 }}>No platform wallets. Create one in the Wallets tab to bundle buyers into the launch.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tradeable.map((w) => {
            const on = selIds.has(w.id);
            const idx = selectedWallets.findIndex((s) => s.id === w.id);
            const alloc = selectedWallets.find((s) => s.id === w.id);
            const d = idx >= 0 ? derived[idx] : undefined;
            const mcUsd = d && solPrice > 0 && d.priceSol > 0 ? d.priceSol * solPrice * PREVIEW_SUPPLY : null;
            return (
              <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 9, border: `1px solid ${on ? "var(--accent)" : "var(--line-soft)"}`, background: on ? "var(--ink-2)" : "var(--ink-1)" }}>
                <button type="button" onClick={() => toggleBuyer(w)} style={{ width: 16, height: 16, borderRadius: 4, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent)" : "transparent", cursor: "pointer", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--ink-0)", fontSize: 10 }}>{on ? "✓" : ""}</button>
                <span style={{ fontSize: 12, color: "var(--paper)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.displayLabel}{on && idx === 0 && <span style={{ marginLeft: 6, fontSize: 9, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>DEV</span>}</span>
                {on && d && d.tokens > 0 && (
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--paper-4)", whiteSpace: "nowrap" }}>{fmtNum(d.tokens)} · {fmtMcap(mcUsd)}</span>
                )}
                {on && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 6, padding: "3px 8px" }}>
                    <input value={alloc?.amount ?? ""} onChange={(e) => setBuyerAmount(w.id, e.target.value)} inputMode="decimal" style={{ width: 48, background: "transparent", border: 0, outline: "none", color: "var(--paper)", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right" }} />
                    <span style={{ fontSize: 10, color: "var(--paper-4)" }}>{quote}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Field>
  );
}

// ── Preview panel (right column, step 3) — chart + funding/risk ──────────────
function PreviewPanel(props: {
  mint: string; solPrice: number;
  tokenData: TokenMetadata; platform: Platform; quote: Quote; sendMode: SendMode;
  selectedWallets: WalletAlloc[]; totalSol: number; enabledFeatures: string[];
  funding: FundingEstimate; isPhone: boolean;
}) {
  const { mint, solPrice, tokenData, platform, quote, sendMode, selectedWallets, totalSol, enabledFeatures, funding } = props;
  const [chartCurrency, setChartCurrency] = useState<"usd" | "sol">("usd");
  const [chartDisplay, setChartDisplay] = useState<"mcap" | "price">("mcap");

  return (
    <div style={{ minHeight: 0, display: "flex", flexDirection: "column", background: "var(--ink-0)", overflow: "hidden" }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderBottom: "1px solid var(--line-soft)", background: "var(--ink-1)" }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", flexShrink: 0 }} />
        <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono)", letterSpacing: "0.09em", color: "var(--paper-3)" }}>LAUNCH PREVIEW · SIMULATED BONDING CURVE</span>
      </div>
      {/* TVChart's root (styles.chart) is `flex:1`, so its parent MUST be a
          flex COLUMN with a definite height — otherwise flex:1 is ignored and
          the widget collapses into the top of the box (the "squished" bug).
          Mirrors how TokenLayout wraps it. */}
      <div style={{ flexShrink: 0, height: 340, display: "flex", flexDirection: "column", borderBottom: "1px solid var(--line-soft)" }}>
        <TVChart mint={mint} currency={chartCurrency} display={chartDisplay} onCurrencyChange={setChartCurrency} onDisplayChange={setChartDisplay} marks={[]} solPrice={solPrice} supply={PREVIEW_SUPPLY} minimal />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, overflow: "hidden", background: "var(--ink-2)", border: "1px solid var(--line-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {tokenData.imageUrl ? <img src={tokenData.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{(tokenData.symbol || "TKR").slice(0, 3)}</span>}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--paper)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tokenData.name || "Untitled token"}</div>
            <div style={{ fontSize: 11, color: "var(--paper-3)", fontFamily: "var(--font-mono)" }}>{tokenData.symbol || "TKR"}</div>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 7, background: "var(--ink-2)", border: "1px solid var(--line-soft)" }}>
            <PlatformLogo platform={PLATFORM_LOGO[platform]} size={13} />
            <span style={{ fontSize: 11, color: "var(--paper-2)" }}>{PLATFORM_LABEL[platform]}</span>
          </span>
        </div>

        <KvCard>
          <KvRow k="Est. Market Cap" v={<><span style={{ color: "var(--paper)" }}>{funding.estMarketCapUsd != null ? fmtMcap(funding.estMarketCapUsd) : "—"}</span><span style={{ color: "var(--paper-4)" }}> / {funding.migrationMarketCapUsd != null ? fmtMcap(funding.migrationMarketCapUsd) : "—"}</span></>} hint="after your buys / at migration" />
        </KvCard>

        <KvCard>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--paper)" }}>Funding Estimation</span>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--paper)" }}><Amt v={funding.totalFundingSol.toFixed(3)} /></span>
          </div>
          <div style={{ height: 1, background: "var(--line-soft)", margin: "0 0 8px" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <KvRow k="Supply Cost" v={<Amt v={funding.supplyCostSol.toFixed(3)} />} muted />
            <KvRow k="Extra Funding" v={<Amt v={funding.extraFundingSol.toFixed(3)} />} muted />
            <KvRow k={<span style={{ color: "var(--sell)" }}>Maximum Loss</span>} v={<span style={{ color: "var(--sell)" }}><Amt v={`${funding.maxLossNoMigrationSol.toFixed(3)} / ${funding.maxLossMigrationSol.toFixed(3)}`} /></span>} hint="no migration / migration" />
          </div>
        </KvCard>

        <KvCard>
          <SumRow k="Quote" v={quote} />
          <SumRow k="Execution" v={sendMode === "bundle" ? "Bundle" : "Stagger"} />
          <SumRow k="Buyers" v={String(selectedWallets.length)} />
          <SumRow k="Total committed" v={<Amt v={totalSol.toFixed(3)} q={quote === "USDC" ? "usdc" : "sol"} />} />
          {enabledFeatures.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              {enabledFeatures.map((f) => <span key={f} style={{ fontSize: 9.5, fontFamily: "var(--font-mono)", color: "var(--accent)", background: "color-mix(in oklch, var(--accent) 12%, transparent)", border: "1px solid color-mix(in oklch, var(--accent) 34%, transparent)", borderRadius: 999, padding: "2px 8px" }}>{f}</span>)}
            </div>
          )}
        </KvCard>
        <p style={{ ...hint, margin: 0 }}>Estimates from the pump.fun bonding curve — actual fills depend on order and on-chain state at launch.</p>
      </div>
    </div>
  );
}

function KvCard({ children }: { children: React.ReactNode }) {
  return <div style={{ border: "1px solid var(--line-soft)", borderRadius: 11, background: "var(--ink-1)", padding: 12 }}>{children}</div>;
}
function KvRow({ k, v, hint: h, muted }: { k: React.ReactNode; v: React.ReactNode; hint?: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 12 }}>
      <span style={{ color: muted ? "var(--paper-4)" : "var(--paper-3)" }}>{k}{h && <span style={{ fontSize: 9.5, color: "var(--paper-4)", fontFamily: "var(--font-mono)", marginLeft: 6 }}>{h}</span>}</span>
      <span style={{ color: "var(--paper)", fontFamily: "var(--font-mono)", textAlign: "right", whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
}

// ── Step 1 body: Launchpad ─────────────────────────────────────────────────
function StepLaunchpad({ platform, setPlatform, pumpType, setPumpType, holderReward, setHolderReward, extra, patchExtra, youKeepPct, recipPctSum, isPhone, chainId, setChain }: {
  platform: Platform; setPlatform: (p: Platform) => void; pumpType: boolean; setPumpType: (v: boolean) => void;
  holderReward: boolean; setHolderReward: (v: boolean) => void; extra: ExtraLaunch; patchExtra: (p: Partial<ExtraLaunch>) => void;
  youKeepPct: number; recipPctSum: number; isPhone: boolean;
  chainId: ChainId; setChain: (id: ChainId, opts?: { reload?: boolean }) => void;
}) {
  const { chains } = useChain();
  const onSol = chainId === "sol";
  const evmPads = EVM_PADS[chainId] ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionHeading title="Create a new launch" desc="Choose where your token is launched and how it's deployed. You can adjust these later." />
      <Field label="BLOCKCHAIN">
        <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr 1fr" : "repeat(5, 1fr)", gap: 8 }}>
          {chains.map((c) => {
            const active = c.id === chainId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  if (c.id === chainId) return;
                  setChain(c.id, { reload: false });
                  if (c.id === "sol") setPlatform("pumpfun");
                }}
                style={{
                  position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, textAlign: "left", cursor: "pointer",
                  border: `1px solid ${active ? "var(--accent)" : "var(--line-soft)"}`,
                  background: active ? "color-mix(in oklch, var(--accent) 10%, transparent)" : "var(--ink-0)",
                }}
              >
                <span style={{ display: "inline-flex", color: active ? "var(--accent)" : "var(--paper-4)" }}><ChainIcon id={c.id} size={15} /></span>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <span style={{ fontSize: 10, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{CHAIN_PAD_NOTE[c.id]}</span>
                </div>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="LAUNCHPAD">
        {onSol ? (
          <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr 1fr" : "repeat(3, 1fr)", gap: 8 }}>
            {LAUNCHPAD_OPTIONS.map((lp) => {
              const active = lp.match(platform);
              return (
                <button key={lp.key} type="button" onClick={() => setPlatform(lp.pick)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 13px", borderRadius: 12, textAlign: "left", cursor: "pointer",
                  border: `1px solid ${active ? lp.tint : "var(--line-soft)"}`, background: active ? "var(--ink-2)" : "var(--ink-0)", boxShadow: active ? `0 0 0 3px color-mix(in oklch, ${lp.tint} 14%, transparent)` : "none", transition: "all 120ms" }}>
                  <span style={{ display: "inline-flex", width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", background: `color-mix(in oklch, ${lp.tint} 16%, transparent)`, flexShrink: 0 }}><PlatformLogo platform={lp.logo} size={17} /></span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: active ? "var(--paper)" : "var(--paper-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lp.name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr 1fr" : "repeat(3, 1fr)", gap: 8 }}>
            {evmPads.map((lp) => (
              <div key={lp.name} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "12px 13px", borderRadius: 12,
                border: `1px solid ${lp.soon ? "var(--line-soft)" : "var(--accent)"}`, background: lp.soon ? "var(--ink-0)" : "var(--ink-2)", opacity: lp.soon ? 0.6 : 1 }}>
                <span style={{ display: "inline-flex", width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", background: "var(--ink-2)", flexShrink: 0 }}><PlatformLogo platform={lp.logo} size={17} /></span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--paper-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lp.name}</span>
                {lp.soon && <span style={{ position: "absolute", top: 8, right: 8, fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--paper-4)", border: "1px solid var(--line-soft)", borderRadius: 4, padding: "1px 4px" }}>SOON</span>}
              </div>
            ))}
            {evmPads.length === 0 && (
              <p style={{ ...hint, margin: 0 }}>No launchpads catalogued on this chain yet.</p>
            )}
            <p style={{ ...hint, gridColumn: "1 / -1", margin: "4px 0 0" }}>
              Token deploy from this UI is live on Solana. {chainId === "robinhood" ? "pons unsigned txs are built by the API; signing from the wizard is not wired yet." : "This chain is live for monitor, search, and charts."}
            </p>
          </div>
        )}
      </Field>

      {onSol && platform === "pumpfun" && (
        <Field label="PUMP.FUN FEATURES">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <FeatureRow title="Mayhem mode" desc="Pump.fun AI bot that trades your coin for its first 24h to boost volume and attract attention." enabled={pumpType} onToggle={setPumpType} />
            <FeatureRow title="Holder rewards" desc="The creator fee on every trade is paid out to holders by pump.fun instead of a creator wallet. Permanent — there is nothing for the creator to claim." enabled={holderReward} onToggle={(v) => { setHolderReward(v); if (v) patchExtra({ shareEnabled: false, charityEnabled: false }); }} />
            <FeatureRow title="Tokenized Agent" desc="Your coin earns agent revenue that auto-buys back & burns supply." enabled={extra.agentEnabled} onToggle={(v) => patchExtra({ agentEnabled: v })}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "var(--paper-2)" }}>Buyback &amp; burn</span>
                <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{extra.agentBuybackPct}%</span>
              </div>
              <Slider value={extra.agentBuybackPct} onChange={(v) => patchExtra({ agentBuybackPct: v })} />
            </FeatureRow>
            <FeatureRow title="Creator Rewards" desc={holderReward ? "Not available on a holder-rewards coin — the creator fee already goes to holders." : "Share the trading fees your coin earns with other wallets."} enabled={extra.shareEnabled} onToggle={(v) => { if (holderReward) return; patchExtra({ shareEnabled: v }); }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 9px", borderRadius: 8, background: "var(--ink-0)", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--paper-2)" }}>You keep</span>
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)", color: youKeepPct < 0 ? "var(--sell)" : "var(--accent)" }}>{Math.max(0, youKeepPct)}%</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {extra.recipients.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input value={r.address} onChange={(e) => patchExtra({ recipients: extra.recipients.map((x, j) => (j === i ? { ...x, address: e.target.value.trim() } : x)) })} placeholder="recipient wallet" style={{ ...inputStyle, flex: 1, minWidth: 0, fontFamily: "var(--font-mono)" }} />
                    <div style={{ display: "flex", alignItems: "center", background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 6 }}>
                      <input value={r.pct} onChange={(e) => { const c = e.target.value.replace(/[^0-9]/g, "").slice(0, 3); patchExtra({ recipients: extra.recipients.map((x, j) => (j === i ? { ...x, pct: c === "" ? "" : String(Math.min(100, parseInt(c, 10) || 0)) } : x)) }); }} placeholder="0" inputMode="numeric" style={{ width: 34, padding: "7px 2px 7px 8px", background: "transparent", border: 0, color: "var(--paper)", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right", outline: "none" }} />
                      <span style={{ fontSize: 11, color: "var(--paper-4)", padding: "0 7px 0 1px" }}>%</span>
                    </div>
                    <button type="button" onClick={() => patchExtra({ recipients: extra.recipients.filter((_, j) => j !== i) })} style={miniBtn}>✕</button>
                  </div>
                ))}
              </div>
              {extra.recipients.length < MAX_RECIPIENTS && (
                <button type="button" onClick={() => patchExtra({ recipients: [...extra.recipients, { address: "", pct: "" }] })} style={{ ...miniBtn, width: "100%", padding: "7px 0", marginTop: 6 }}>+ Add recipient</button>
              )}
              <p style={{ ...hint, color: youKeepPct < 0 ? "var(--sell)" : "var(--paper-4)" }}>
                {extra.recipients.length === 0 ? "Add a wallet to send it a share of your creator fees." : youKeepPct < 0 ? `Recipients total ${recipPctSum}% — over 100%.` : `Recipients get ${recipPctSum}%; you keep ${youKeepPct}%.`}
              </p>
            </FeatureRow>
            <FeatureRow title="Donate to charity" desc={holderReward ? "Not available on a holder-rewards coin — the creator fee already goes to holders." : "Give a share of your creator fees to a verified non-profit."} enabled={extra.charityEnabled} onToggle={(v) => { if (holderReward) return; patchExtra({ charityEnabled: v }); }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--paper-2)" }}>You donate</span>
                <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{extra.charityPct}%</span>
              </div>
              <Slider value={extra.charityPct} onChange={(v) => patchExtra({ charityPct: v })} />
              <div style={{ marginTop: 10 }}><CharityPicker selected={extra.charities} onChange={(next) => patchExtra({ charities: next })} /></div>
            </FeatureRow>
          </div>
        </Field>
      )}

      {onSol && platform === "raydium" && (
        <Field label="BRAND">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <Seg label="Bonk" active={extra.bonkType === "standard"} onClick={() => patchExtra({ bonkType: "standard" })} />
            <Seg label="Bonkers" active={extra.bonkType === "bonkers"} onClick={() => patchExtra({ bonkType: "bonkers" })} />
            <Seg label="Stonk" active={extra.bonkType === "stonk"} onClick={() => patchExtra({ bonkType: "stonk" })} />
          </div>
          <p style={hint}>{extra.bonkType === "bonkers" ? "LetsBonk Bonkers — 0.05% creator fee." : extra.bonkType === "stonk" ? "StonkFun — Token-2022 LaunchLab coin." : "LetsBonk standard — 0% creator fee."}</p>
        </Field>
      )}
      {onSol && platform === "meteora" && (
        <p style={hint}>Meteora DBC via Bags. Other Meteora venues aren't wired yet.</p>
      )}
    </div>
  );
}

// ── Step 2 body: Token details ─────────────────────────────────────────────
function StepToken({ tokenData, setTokenData, uploadImage, imageUploading, imageError, onClearImage, isPhone }: {
  tokenData: TokenMetadata; setTokenData: React.Dispatch<React.SetStateAction<TokenMetadata>>;
  uploadImage: (f: File) => void; imageUploading: boolean; imageError: string | null; onClearImage: () => void; isPhone: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upd = (k: keyof TokenMetadata) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setTokenData((c) => ({ ...c, [k]: e.target.value }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "0 0 auto", position: "relative" }}>
          <input ref={inputRef} type="file" accept={IMAGE_MIME_ALLOW.join(",")} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }} style={{ display: "none" }} />
          <button type="button" onClick={() => inputRef.current?.click()} style={{ width: 96, height: 96, borderRadius: 14, overflow: "hidden", background: "var(--ink-0)", border: `1px dashed ${imageError ? "var(--sell)" : tokenData.imageUrl ? "var(--line)" : "var(--line-soft)"}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--paper-4)", padding: 0 }}>
            {tokenData.imageUrl ? <img src={tokenData.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}><span style={{ fontSize: 22 }}>{imageUploading ? "…" : "+"}</span><span style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>IMAGE*</span></span>}
          </button>
          {tokenData.imageUrl && <button type="button" onClick={onClearImage} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 999, background: "var(--ink-2)", border: "1px solid var(--line)", color: "var(--paper-2)", fontSize: 12, cursor: "pointer" }}>×</button>}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <Labeled label="Name *"><input value={tokenData.name} onChange={upd("name")} placeholder="My token" style={inputStyle} /></Labeled>
          <Labeled label="Symbol *"><input value={tokenData.symbol} onChange={(e) => setTokenData((c) => ({ ...c, symbol: e.target.value.slice(0, 10) }))} placeholder="TKR" style={{ ...inputStyle, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }} /></Labeled>
        </div>
      </div>
      {imageError && <span style={{ fontSize: 10, color: "var(--sell)", fontFamily: "var(--font-mono)" }}>{imageError}</span>}
      <Labeled label="Description"><textarea value={tokenData.description} onChange={upd("description")} placeholder="A few words about your token…" rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 60, lineHeight: 1.5 }} /></Labeled>
      <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "repeat(3, 1fr)", gap: 8 }}>
        <SocialInput icon={Icon.x(13)} value={tokenData.twitter} onChange={upd("twitter")} placeholder="x.com/…" />
        <SocialInput icon={Icon.telegram(14)} value={tokenData.telegram} onChange={upd("telegram")} placeholder="t.me/…" />
        <SocialInput icon={Icon.website(14)} value={tokenData.website} onChange={upd("website")} placeholder="website…" />
      </div>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = { width: "100%", display: "block", padding: "9px 11px", background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 8, fontSize: 13, color: "var(--paper)", outline: "none", fontFamily: "var(--font-ui)", boxSizing: "border-box" };
const miniBtn: React.CSSProperties = { flex: "0 0 auto", padding: "5px 8px", background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 6, color: "var(--paper-3)", fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer" };
const hint: React.CSSProperties = { fontSize: 10.5, color: "var(--paper-4)", lineHeight: 1.5, margin: "6px 0 0", padding: 0 };

// Plain div, NOT <label>: Field wraps groups with MULTIPLE buttons/inputs
// (buyer rows, mode cards, segmented controls) — a <label> auto-forwards any
// click on its non-interactive area (row padding, hint text) to the FIRST
// labelable descendant (button/input are both labelable per HTML5), silently
// re-toggling e.g. wallet #1 no matter which row you actually clicked. Use
// `Labeled` instead for genuine single-input fields (Name/Symbol/Description).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--paper-4)", letterSpacing: "0.1em" }}>{label}</span>{children}</div>;
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={{ fontSize: 11, color: "var(--paper-3)" }}>{label}</span>{children}</label>;
}
// Amount + its currency mark (Solana or USDC svg) — replaces the ◎ glyph.
function Amt({ v, q = "sol" }: { v: React.ReactNode; q?: "sol" | "usdc" }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "var(--font-mono)" }}>{v}{q === "usdc" ? Icon.usdc(11) : Icon.solana(11)}</span>;
}
function SumRow({ k, v }: { k: string; v: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "1px 0" }}><span style={{ color: "var(--paper-4)" }}>{k}</span><span style={{ color: "var(--paper)", fontFamily: "var(--font-mono)" }}>{v}</span></div>;
}
function Seg({ label, active, onClick, disabled, small }: { label: React.ReactNode; active: boolean; onClick: () => void; disabled?: boolean; small?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} style={{ flex: 1, padding: small ? "6px 8px" : "9px 10px", borderRadius: 8, background: active ? "var(--accent)" : "var(--ink-0)", color: active ? "var(--ink-0)" : disabled ? "var(--paper-4)" : "var(--paper)", border: `1px solid ${active ? "var(--accent)" : "var(--line-soft)"}`, fontSize: small ? 10.5 : 12, fontWeight: active ? 700 : 500, fontFamily: "var(--font-mono)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>{label}</button>;
}
function NumField({ label, value, onChange, inline }: { label: string; value: string; onChange: (v: string) => void; inline?: boolean }) {
  const input = <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" style={{ ...inputStyle, fontFamily: "var(--font-mono)", textAlign: "right", ...(inline ? { width: 56, padding: "5px 7px", fontSize: 12 } : {}) }} />;
  if (inline) return <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{input}<span style={{ fontSize: 9, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{label}</span></span>;
  return <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={{ fontSize: 9, color: "var(--paper-4)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>{label}</span>{input}</label>;
}
function SocialInput({ icon, value, onChange, placeholder }: { icon: React.ReactNode; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 8 }}><span style={{ display: "inline-flex", color: "var(--paper-4)", flexShrink: 0 }}>{icon}</span><input value={value} onChange={onChange} placeholder={placeholder} style={{ flex: 1, minWidth: 0, padding: "9px 0", background: "transparent", border: 0, outline: "none", color: "var(--paper)", fontSize: 12, fontFamily: "var(--font-mono)" }} /></div>;
}
function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input type="range" min={0} max={100} step={1} value={value} onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)} style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer", display: "block" }} />;
}
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} style={{ flex: "0 0 auto", width: 40, height: 23, borderRadius: 999, background: value ? "var(--accent)" : "var(--line)", border: 0, position: "relative", cursor: "pointer", transition: "background 140ms" }}><span style={{ position: "absolute", top: 2, left: value ? 19 : 2, width: 19, height: 19, borderRadius: 999, background: "#fff", transition: "left 140ms", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }} /></button>;
}
function FeatureRow({ title, desc, enabled, onToggle, children }: { title: string; desc: string; enabled: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${enabled ? "var(--accent)" : "var(--line-soft)"}`, background: enabled ? "var(--ink-2)" : "var(--ink-0)", borderRadius: 10, padding: 12, transition: "border-color 140ms, background 140ms" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onToggle(!enabled)}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)" }}>{title}</div>
          <div style={{ fontSize: 11, color: "var(--paper-4)", marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
        </div>
        <Toggle value={enabled} onChange={onToggle} />
      </div>
      {enabled && children && <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-soft)" }}>{children}</div>}
    </div>
  );
}

// Compact charity picker (pump.fun 501c3 registry search).
function CharityPicker({ selected, onChange }: { selected: PickedCharity[]; onChange: (n: PickedCharity[]) => void }) {
  const backend = useBackend();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<CharitySummary[]>([]);
  const [open, setOpen] = useState(false);
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try { const { charities } = await backend.charitySearch(q, 12); if (alive) { setResults(charities); setOpen(true); } } catch { /* ignore */ }
    }, 280);
    return () => { alive = false; clearTimeout(t); };
  }, [term, backend]);
  const place = (c: { city: string | null; state: string | null }) => [c.city, c.state].filter(Boolean).join(", ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {selected.length > 0 && selected.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: "var(--ink-0)", border: "1px solid var(--line-soft)" }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, overflow: "hidden", background: "var(--ink-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--paper-3)", flexShrink: 0 }}>{c.logo ? <img src={c.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (c.name[0] || "?")}</span>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11.5, color: "var(--paper)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>{place(c) && <div style={{ fontSize: 9.5, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{place(c)}</div>}</div>
          <button type="button" onClick={() => onChange(selected.filter((s) => s.id !== c.id))} style={miniBtn}>✕</button>
        </div>
      ))}
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 9px", background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 6 }}>
          <span style={{ display: "inline-flex", color: "var(--paper-4)", flexShrink: 0 }}>{Icon.search(12)}</span>
          <input value={term} onChange={(e) => setTerm(e.target.value)} onFocus={() => results.length > 0 && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Search charities…" style={{ flex: 1, minWidth: 0, padding: "7px 0", background: "transparent", border: 0, outline: "none", color: "var(--paper)", fontSize: 11.5 }} />
        </div>
        {open && results.length > 0 && (
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, maxHeight: 220, overflowY: "auto", background: "var(--ink-1)", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "0 14px 30px -16px rgba(0,0,0,0.85)" }}>
            {results.map((c) => {
              const picked = selectedIds.has(c.id);
              return (
                <button key={c.id} type="button" onMouseDown={(e) => { e.preventDefault(); if (!picked) { onChange([...selected, { id: c.id, name: c.name, logo: c.logo, city: c.city, state: c.state }]); setTerm(""); setResults([]); setOpen(false); } }} disabled={picked}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", textAlign: "left", background: "transparent", border: 0, borderBottom: "1px solid var(--line-soft)", cursor: picked ? "default" : "pointer", opacity: picked ? 0.5 : 1 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, overflow: "hidden", background: "var(--ink-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--paper-3)", flexShrink: 0 }}>{c.logo ? <img src={c.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (c.name[0] || "?")}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11.5, color: "var(--paper)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>{place(c) && <div style={{ fontSize: 9.5, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>{place(c)}</div>}</div>
                  <span style={{ fontSize: 13, color: picked ? "var(--accent)" : "var(--paper-3)" }}>{picked ? "✓" : "+"}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
