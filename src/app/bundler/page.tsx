"use client";

/**
 * /bundler — deploy a token on a launchpad and bundle the first buys from
 * vault wallets, on the Raze router's launch routes (server/launch.mjs).
 *
 * Solana: Pump.fun, Raydium LaunchLab (LetsBonk and its modes, USD1) and
 * Meteora DBC through Bags; the creator buys inside the create, then one buy
 * per bundle wallet. Robinhood Chain: pons.family, the deployer's dev buy (the
 * other wallets are only exempted from the snipe tax). Builds come from Raze,
 * keys stay in the vault, sends go through this server's RPC.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useChain } from "../../contexts/ChainContext";
import { useApp } from "../../contexts/AppContext";
import { useUserWallets, type UserWallet } from "../../hooks/useUserWallets";
import { Btn, Icon, Modal, ModalHeader } from "../../components/atoms";
import { useClientNav } from "../../components/shell/ClientPages";
import { CHAINS, explorerAccountUrl, explorerTxUrl, type ChainId } from "../../lib/chains";
import { shortAddr } from "../../lib/format";
import { tokenHref } from "../../lib/tokenHref";
import {
  ApiError,
  auth,
  launchApi,
  vault,
  type LaunchChain,
  type LaunchForm,
  type LaunchJob,
  type LaunchLegStatus,
} from "../../lib/vault/client";

const MAX_WALLETS = 50;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Rough network cost per Solana wallet beyond its buy (fees, token account rent). */
const SOL_OVERHEAD = 0.005;
/** The creator also pays the create (mint, curve and metadata rent). */
const SOL_CREATE_OVERHEAD = 0.03;
const DRAFT_KEY = "bundler.draft.v1";
const NO_UPLOAD_NOTE =
  "Uploading works when Trade UI runs on a public address (TRADE_UI_PUBLIC_URL): Raze's server downloads "
  + "the image from Trade UI, and it cannot reach this computer. Paste a public image URL below instead.";

type SolPlatform = "pump" | "raydium" | "usd1" | "meteora";

const SOL_PLATFORMS: Array<{ id: SolPlatform; label: string; note: string }> = [
  { id: "pump", label: "Pump.fun", note: "Bonding curve, SOL or USDC" },
  { id: "raydium", label: "LetsBonk", note: "Raydium LaunchLab, SOL" },
  { id: "usd1", label: "USD1", note: "Raydium LaunchLab, USD1" },
  { id: "meteora", label: "Bags", note: "Meteora DBC, two steps" },
];

const BONK_TYPES = [
  { id: "standard", label: "LetsBonk" },
  { id: "bonkers", label: "Bonkers" },
  { id: "balanced", label: "Balanced" },
  { id: "stonkfun", label: "StonkFun" },
  { id: "stonkfun-reward", label: "StonkFun reward" },
];

const PRIORITY = [
  { id: "default", label: "Default", value: undefined },
  { id: "fast", label: "Fast", value: 200_000 },
  { id: "turbo", label: "Turbo", value: 1_000_000 },
] as const;

const FEE_PROVIDERS = ["twitter", "tiktok", "kick", "github", "instagram", "solana"];

// ── styles (the swap card's) ────────────────────────────────────────────

const box: React.CSSProperties = {
  background: "var(--ink-0)",
  border: "1px solid var(--line-soft)",
  borderRadius: 10,
  padding: "14px 16px",
};

const chip: React.CSSProperties = {
  padding: "4px 9px",
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

const input: React.CSSProperties = {
  background: "var(--ink-1, var(--ink-0))",
  border: "1px solid var(--line-soft)",
  color: "var(--paper)",
  padding: "8px 10px",
  borderRadius: 7,
  fontSize: 12.5,
  width: "100%",
  minWidth: 0,
  outline: "none",
};

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section style={box}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <span style={micro}>{title}</span>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Label({ text, hint, children }: { text: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: "var(--paper-3)" }}>
        {text}
        {hint && <span style={{ color: "var(--paper-4)" }}> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: ReadonlyArray<{ id: T; label: string; disabled?: boolean; title?: string }>; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.id)}
          style={{
            ...chip,
            opacity: o.disabled ? 0.4 : 1,
            cursor: o.disabled ? "not-allowed" : "pointer",
            color: value === o.id ? "var(--ink-0)" : "var(--paper-2)",
            background: value === o.id ? "var(--accent)" : "var(--ink-2)",
            borderColor: value === o.id ? "var(--accent)" : "var(--line-soft)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--paper-2)", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

// ── amounts ─────────────────────────────────────────────────────────────

function parseAmount(t: string): number | null {
  if (!t.trim()) return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fmtAmt(n: number, d = 4): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

interface Row {
  on: boolean;
  amount: string;
}

interface Draft {
  platform: SolPlatform;
  name: string;
  symbol: string;
  description: string;
  image: string;
  twitter: string;
  telegram: string;
  website: string;
  devBuy: string;
  slippagePct: string;
  priority: (typeof PRIORITY)[number]["id"];
  sendMode: "safe" | "fast";
  quoteUsdc: boolean;
  mayhem: boolean;
  holderReward: boolean;
  bonkType: string;
  pairToken: string;
  creatorTaxPct: string;
}

const EMPTY_DRAFT: Draft = {
  platform: "pump",
  name: "",
  symbol: "",
  description: "",
  image: "",
  twitter: "",
  telegram: "",
  website: "",
  devBuy: "0.5",
  slippagePct: "",
  priority: "fast",
  sendMode: "safe",
  quoteUsdc: false,
  mayhem: false,
  holderReward: false,
  bonkType: "standard",
  pairToken: "eth",
  creatorTaxPct: "0",
};

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    /* ignore */
  }
  return EMPTY_DRAFT;
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "bad_password") return "Wrong password.";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

// ── the page ────────────────────────────────────────────────────────────

export default function BundlerPage() {
  usePageTitle("Bundler");
  const { chainId, setChain } = useChain();
  const { wallets, balances, refresh, refreshBalances } = useUserWallets();
  const { pushToast } = useApp();

  const [catalog, setCatalog] = useState<LaunchChain[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    launchApi.catalog().then(
      (c) => { if (live) setCatalog(c); },
      (e) => { if (live) setCatalogError(errorText(e)); },
    );
    return () => { live = false; };
  }, []);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const loaded = useRef(false);
  useEffect(() => {
    setDraft(loadDraft());
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const [creatorId, setCreatorId] = useState<string>("");
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [mintKey, setMintKey] = useState("");
  const [metadataUri, setMetadataUri] = useState("");
  const [claimers, setClaimers] = useState<Array<{ provider: string; username: string; pct: string }>>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  /** Whether an image from disk can be uploaded (null until the server says). */
  const [uploads, setUploads] = useState<boolean | null>(null);
  /** Under the logo: why there is no upload, or why one failed. */
  const [imageNote, setImageNote] = useState<string | null>(null);
  const imageUrlRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let live = true;
    auth.config().then(
      (c) => { if (live) setUploads(Boolean(c.launchUploads)); },
      () => { if (live) setUploads(false); },
    );
    return () => { live = false; };
  }, []);
  const [bulkAmount, setBulkAmount] = useState("0.2");
  const [genCount, setGenCount] = useState("5");
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<LaunchJob | null>(null);

  const isEvm = chainId === "robinhood";
  const launchChain = catalog?.find((c) => c.slug === chainId) ?? null;
  const hasBuilder = chainId === "sol" || chainId === "robinhood";
  const platform: string = isEvm ? "pons" : draft.platform;

  // The creator: the first wallet unless one was picked.
  useEffect(() => {
    if (!wallets.length) return;
    if (!wallets.some((w) => w.id === creatorId)) setCreatorId(wallets[0].id);
  }, [wallets, creatorId]);

  const creator = wallets.find((w) => w.id === creatorId) ?? null;
  const bundle = wallets.filter((w) => w.id !== creatorId);
  const picked = bundle.filter((w) => rows[w.id]?.on);

  const quoteLabel = isEvm
    ? (draft.pairToken.toLowerCase() === "eth" ? "ETH" : draft.pairToken.toUpperCase())
    : draft.platform === "usd1" ? "USD1" : draft.platform === "pump" && draft.quoteUsdc ? "USDC" : "SOL";
  const nativeQuote = quoteLabel === "SOL" || quoteLabel === "ETH";

  const devBuy = parseAmount(draft.devBuy);
  const amountOf = (w: UserWallet) => (isEvm ? 0 : parseAmount(rows[w.id]?.amount ?? ""));
  const badAmount = devBuy === null || picked.some((w) => amountOf(w) === null);
  const total = (devBuy ?? 0) + picked.reduce((s, w) => s + (amountOf(w) ?? 0), 0);

  /** A wallet whose native balance looks short of its buy and fees. */
  const short = (w: UserWallet, buy: number, isCreator: boolean): boolean => {
    const b = balances[w.id];
    if (!b || b.loading || !nativeQuote) return false;
    const need = buy + (isEvm ? 0.0007 : SOL_OVERHEAD + (isCreator ? SOL_CREATE_OVERHEAD : 0));
    return b.sol < need;
  };

  const tooMany = picked.length + 1 > MAX_WALLETS;
  const bagsZero = !isEvm && draft.platform === "meteora" && picked.some((w) => !(amountOf(w)! > 0));
  const missing: string[] = [];
  if (!creator) missing.push("a creator wallet");
  if (!draft.name.trim()) missing.push("a name");
  if (!draft.symbol.trim()) missing.push("a ticker");
  if (!draft.image.trim() && !metadataUri.trim()) missing.push("an image URL");
  if (isEvm && !draft.description.trim()) missing.push("a description");
  const canLaunch = hasBuilder && !missing.length && !badAmount && !tooMany && !bagsZero && !(job && !job.done);

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { on: r[id]?.on ?? false, amount: r[id]?.amount ?? bulkAmount, ...patch } }));
  const selectAll = (on: boolean) =>
    setRows((r) => {
      const next = { ...r };
      bundle.slice(0, MAX_WALLETS - 1).forEach((w) => { next[w.id] = { on, amount: r[w.id]?.amount ?? bulkAmount }; });
      if (!on) bundle.forEach((w) => { next[w.id] = { on: false, amount: r[w.id]?.amount ?? bulkAmount }; });
      return next;
    });
  const applyAll = () =>
    setRows((r) => {
      const next = { ...r };
      for (const w of picked) next[w.id] = { on: true, amount: bulkAmount };
      return next;
    });
  /** ±15% around each amount, so the buys do not look identical. */
  const jitter = () =>
    setRows((r) => {
      const next = { ...r };
      for (const w of picked) {
        const base = parseAmount(r[w.id]?.amount ?? bulkAmount) || parseAmount(bulkAmount) || 0;
        const v = base * (0.85 + Math.random() * 0.3);
        next[w.id] = { on: true, amount: String(Math.max(0, Number(v.toFixed(4)))) };
      }
      return next;
    });

  async function generate() {
    const n = Math.max(1, Math.min(MAX_WALLETS - 1, Math.floor(Number(genCount) || 0)));
    setGenerating(true);
    try {
      const made = await vault.generate(isEvm ? "evm" : "sol", "Bundle", n);
      await refresh();
      setRows((r) => {
        const next = { ...r };
        for (const w of made) next[w.id] = { on: true, amount: bulkAmount };
        return next;
      });
      pushToast({ title: "WALLETS CREATED", body: `${made.length} new ${isEvm ? "EVM" : "Solana"} wallet${made.length === 1 ? "" : "s"}: fund them before launching.`, tone: "success" });
    } catch (e) {
      pushToast({ title: "COULD NOT CREATE WALLETS", body: errorText(e), tone: "error" });
    } finally {
      setGenerating(false);
    }
  }

  function form(): LaunchForm {
    const ids = [creator!.id, ...picked.map((w) => w.id)];
    const amounts = [devBuy ?? 0, ...picked.map((w) => amountOf(w) ?? 0)];
    const slip = draft.slippagePct.trim() ? Math.round(Number(draft.slippagePct) * 100) : undefined;
    const token: LaunchForm["token"] = {
      name: draft.name.trim(),
      symbol: draft.symbol.trim(),
      description: draft.description.trim() || undefined,
      image: draft.image.trim() || undefined,
      twitter: draft.twitter.trim() || undefined,
      telegram: draft.telegram.trim() || undefined,
      website: draft.website.trim() || undefined,
      metadataUri: metadataUri.trim() || undefined,
    };
    const f: LaunchForm = {
      chain: chainId,
      platform,
      walletIds: ids,
      amounts,
      token,
      slippageBps: slip != null && Number.isFinite(slip) ? slip : undefined,
      sendMode: draft.sendMode,
    };
    if (isEvm) {
      f.pairToken = draft.pairToken.trim() || "eth";
      f.creatorTaxBps = Math.round((Number(draft.creatorTaxPct) || 0) * 100);
      return f;
    }
    f.computeUnitPrice = PRIORITY.find((p) => p.id === draft.priority)?.value;
    if (mintKey.trim()) f.mintKey = mintKey.trim();
    if (draft.platform === "pump") {
      f.quoteMint = draft.quoteUsdc ? USDC_MINT : "SOL";
      f.mayhem = draft.mayhem;
      f.holderReward = draft.holderReward;
    } else if (draft.platform === "raydium") {
      f.bonkType = draft.bonkType;
    } else if (draft.platform === "meteora") {
      f.feeClaimers = claimers
        .filter((c) => c.username.trim())
        .map((c) => ({ provider: c.provider, username: c.username.trim(), bps: Math.round((Number(c.pct) || 0) * 100) }));
    }
    return f;
  }

  // Follow the job until it is done.
  useEffect(() => {
    if (!jobId) return;
    const ctrl = new AbortController();
    let stop = false;
    (async () => {
      while (!stop) {
        try {
          const j = await launchApi.job(jobId, ctrl.signal);
          setJob(j);
          if (j.done) {
            void refreshBalances();
            if (j.stage === "done") pushToast({ title: "TOKEN LAUNCHED", body: j.mint ? shortAddr(j.mint, 6) : "Confirmed", tone: "success", duration: 8000 });
            else if (j.stage === "failed") pushToast({ title: "LAUNCH FAILED", body: j.error ?? "", tone: "error", duration: 8000 });
            return;
          }
        } catch (e) {
          if (ctrl.signal.aborted) return;
          setJob((cur) => cur && { ...cur, done: true, stage: "failed", error: errorText(e) });
          return;
        }
        await new Promise((r) => setTimeout(r, 900));
      }
    })();
    return () => { stop = true; ctrl.abort(); };
  }, [jobId, pushToast, refreshBalances]);

  // ── unsupported chain ──
  if (!hasBuilder) {
    return (
      <Page>
        <Header chainId={chainId} />
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--paper-2)", lineHeight: 1.5 }}>
            Raze&apos;s launch router has no builder on {CHAINS[chainId].name} yet
            {launchChain?.unwired?.length ? ` (catalogued: ${launchChain.unwired.join(", ")})` : ""}.
            Launches run on Solana and Robinhood Chain.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn tone="primary" onClick={() => setChain("sol")}>Switch to Solana</Btn>
            <Btn onClick={() => setChain("robinhood")}>Switch to Robinhood Chain</Btn>
          </div>
        </div>
      </Page>
    );
  }

  const solPlatforms = SOL_PLATFORMS.map((p) => {
    const live = !launchChain || launchChain.platforms.length === 0
      || launchChain.platforms.some((x) => x.toLowerCase() === p.id || (p.id === "meteora" && x.toLowerCase() === "bags") || (p.id === "raydium" && /bonk|launchlab|raydium/i.test(x)));
    return { id: p.id, label: p.label, title: p.note, disabled: !live && p.id !== "usd1" };
  });

  return (
    <Page>
      <Header chainId={chainId} />
      {catalogError && (
        <div style={{ ...box, borderColor: "var(--sell)", fontSize: 12, color: "var(--sell)" }}>
          The launch router did not answer: {catalogError}
        </div>
      )}

      <div className="bundler-grid">
        {/* ── left: the token ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <Section title="Launchpad">
            {isEvm ? (
              <div style={{ fontSize: 12.5, color: "var(--paper-2)" }}>pons.family V2 on Robinhood Chain</div>
            ) : (
              <>
                <Seg value={draft.platform} options={solPlatforms} onChange={(v) => set("platform", v)} />
                <div style={{ fontSize: 11, color: "var(--paper-4)", marginTop: 8 }}>
                  {SOL_PLATFORMS.find((p) => p.id === draft.platform)?.note}
                </div>
              </>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              {!isEvm && draft.platform === "pump" && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                  <Check checked={draft.quoteUsdc} onChange={(v) => set("quoteUsdc", v)}>Quoted in USDC</Check>
                  <Check checked={draft.mayhem} onChange={(v) => set("mayhem", v)}>Mayhem Mode</Check>
                  <Check checked={draft.holderReward} onChange={(v) => set("holderReward", v)}>Creator fees to holders</Check>
                </div>
              )}
              {!isEvm && draft.platform === "raydium" && (
                <Label text="Mode">
                  <Seg value={draft.bonkType} options={BONK_TYPES} onChange={(v) => set("bonkType", v)} />
                </Label>
              )}
              {!isEvm && draft.platform === "meteora" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--paper-3)" }}>
                    Fee claimers · share the coin&apos;s trading fees; you keep the rest
                  </span>
                  {claimers.map((c, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr 70px 28px", gap: 6 }}>
                      <select value={c.provider} style={input}
                        onChange={(e) => setClaimers((l) => l.map((x, k) => (k === i ? { ...x, provider: e.target.value } : x)))}>
                        {FEE_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <input value={c.username} placeholder="handle" style={input}
                        onChange={(e) => setClaimers((l) => l.map((x, k) => (k === i ? { ...x, username: e.target.value } : x)))} />
                      <input value={c.pct} placeholder="%" inputMode="decimal" style={input}
                        onChange={(e) => setClaimers((l) => l.map((x, k) => (k === i ? { ...x, pct: e.target.value } : x)))} />
                      <button type="button" style={chip} aria-label="Remove" onClick={() => setClaimers((l) => l.filter((_, k) => k !== i))}>×</button>
                    </div>
                  ))}
                  {claimers.length < 14 && (
                    <button type="button" style={{ ...chip, alignSelf: "flex-start" }}
                      onClick={() => setClaimers((l) => [...l, { provider: "twitter", username: "", pct: "10" }])}>+ Fee claimer</button>
                  )}
                  <span style={{ fontSize: 10.5, color: "var(--paper-4)", lineHeight: 1.5 }}>
                    Bags reserves a …BAGS mint (irreversible) and its fee-share config lands first; then the launch. Every bundle wallet must buy.
                  </span>
                </div>
              )}
              {isEvm && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Label text="Pair" hint="eth, USDG, a stock ticker…">
                    <input value={draft.pairToken} onChange={(e) => set("pairToken", e.target.value)} style={input} />
                  </Label>
                  <Label text="Creator tax" hint="% up to 10">
                    <input value={draft.creatorTaxPct} inputMode="decimal" onChange={(e) => set("creatorTaxPct", e.target.value.replace(/[^0-9.]/g, ""))} style={input} />
                  </Label>
                </div>
              )}
            </div>
          </Section>

          <Section title="Token">
            <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 12 }}>
              <LogoPicker
                image={draft.image}
                canUpload={uploads === true}
                onUploaded={(url) => { setImageNote(null); set("image", url); }}
                onError={setImageNote}
                onUnavailable={() => {
                  setImageNote(NO_UPLOAD_NOTE);
                  imageUrlRef.current?.focus();
                }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10, alignContent: "start" }}>
                <Label text="Name">
                  <input value={draft.name} maxLength={32} onChange={(e) => set("name", e.target.value)} style={input} placeholder="My Token" />
                </Label>
                <Label text="Ticker">
                  <input value={draft.symbol} maxLength={10} onChange={(e) => set("symbol", e.target.value.replace(/\s/g, ""))} style={{ ...input, ...mono }} placeholder="TICKER" />
                </Label>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {imageNote && (
                <div role="alert" style={{ fontSize: 11.5, color: uploads === false ? "var(--paper-3)" : "var(--sell)", lineHeight: 1.5 }}>
                  {imageNote}
                </div>
              )}
              <Label
                text="Image URL"
                hint={uploads
                  ? "click the logo to upload, or a public http(s) / ipfs URL; Raze puts it on IPFS"
                  : "a public http(s) or ipfs URL; Raze downloads it and puts it on IPFS"}
              >
                <input
                  ref={imageUrlRef}
                  value={draft.image}
                  onChange={(e) => { setImageNote(null); set("image", e.target.value); }}
                  style={input}
                  placeholder="https://…/logo.png"
                />
              </Label>
              <Label text="Description" hint={isEvm ? "required on pons" : "optional"}>
                <textarea value={draft.description} rows={3} maxLength={1000} onChange={(e) => set("description", e.target.value)}
                  style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
              </Label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                <Label text="X"><input value={draft.twitter} onChange={(e) => set("twitter", e.target.value)} style={input} placeholder="https://x.com/…" /></Label>
                <Label text="Telegram"><input value={draft.telegram} onChange={(e) => set("telegram", e.target.value)} style={input} placeholder="https://t.me/…" /></Label>
                <Label text="Website"><input value={draft.website} onChange={(e) => set("website", e.target.value)} style={input} placeholder="https://…" /></Label>
              </div>
            </div>
          </Section>

          <Section
            title="Execution"
            extra={<button type="button" style={{ ...chip, padding: "2px 8px" }} onClick={() => setShowAdvanced((v) => !v)}>{showAdvanced ? "Hide advanced" : "Advanced"}</button>}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {!isEvm && (
                <Label text="Send">
                  <Seg
                    value={draft.sendMode}
                    options={[
                      { id: "safe", label: "Safe: create, confirm, then buys" },
                      { id: "fast", label: "Same block: buys right behind the create" },
                    ]}
                    onChange={(v) => set("sendMode", v)}
                  />
                  <span style={{ fontSize: 10.5, color: "var(--paper-4)", lineHeight: 1.5 }}>
                    {draft.sendMode === "safe"
                      ? "Each buy is simulated before it is sent: nothing is spent on a buy that would fail. Buys land a block or two after the create."
                      : "Buys go out without simulation right after the create, through your RPC. A buy that reaches the leader before the create fails and costs its fee."}
                  </span>
                </Label>
              )}
              <div style={{ display: "grid", gridTemplateColumns: isEvm ? "1fr" : "1fr 1fr", gap: 10 }}>
                <Label text="Slippage" hint={isEvm ? "% (default 15)" : "% (default 99)"}>
                  <input value={draft.slippagePct} inputMode="decimal" placeholder={isEvm ? "15" : "99"}
                    onChange={(e) => set("slippagePct", e.target.value.replace(/[^0-9.]/g, ""))} style={{ ...input, ...mono }} />
                </Label>
                {!isEvm && (
                  <Label text="Priority">
                    <Seg value={draft.priority} options={PRIORITY.map((p) => ({ id: p.id, label: p.label }))} onChange={(v) => set("priority", v)} />
                  </Label>
                )}
              </div>
              {showAdvanced && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <Label text="Metadata URI" hint="skips Raze's IPFS upload">
                    <input value={metadataUri} onChange={(e) => setMetadataUri(e.target.value)} style={input} placeholder="https://… or ipfs://…" />
                  </Label>
                  {!isEvm && draft.platform !== "meteora" && (
                    <Label text="Mint key" hint="a vanity mint's 64-byte secret, base58; empty: a fresh mint">
                      <input value={mintKey} onChange={(e) => setMintKey(e.target.value.trim())} type="password" autoComplete="off" spellCheck={false} style={{ ...input, ...mono }} />
                    </Label>
                  )}
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* ── right: the wallets ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <Section title={isEvm ? "Deployer" : "Creator (dev buy)"}>
            {wallets.length === 0 ? (
              <EmptyWallets isEvm={isEvm} onGenerate={() => { setGenCount("1"); void generate(); }} busy={generating} />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 130px", gap: 10, alignItems: "end" }}>
                <Label text="Wallet">
                  <select value={creatorId} onChange={(e) => setCreatorId(e.target.value)} style={input}>
                    {wallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.displayLabel} · {shortAddr(w.pubkey, 4)} · {fmtAmt(balances[w.id]?.sol ?? 0, 3)} {CHAINS[chainId].label === "SOL" ? "SOL" : "ETH"}
                      </option>
                    ))}
                  </select>
                </Label>
                <Label text={`Buy (${quoteLabel})`}>
                  <input value={draft.devBuy} inputMode="decimal" onChange={(e) => set("devBuy", e.target.value.replace(/[^0-9.]/g, ""))}
                    style={{ ...input, ...mono, color: creator && short(creator, devBuy ?? 0, true) ? "var(--sell)" : "var(--paper)" }} />
                </Label>
              </div>
            )}
            {creator && short(creator, devBuy ?? 0, true) && (
              <div style={{ fontSize: 11, color: "var(--sell)", marginTop: 8 }}>
                This wallet looks short of {quoteLabel} for its buy and the create&apos;s rent and fees.
              </div>
            )}
          </Section>

          <Section
            title={isEvm ? `Snipe-tax exempt (${picked.length})` : `Bundle wallets (${picked.length}/${MAX_WALLETS - 1})`}
            extra={
              <span style={{ display: "inline-flex", gap: 6 }}>
                <button type="button" style={{ ...chip, padding: "2px 8px" }} onClick={() => selectAll(true)}>All</button>
                <button type="button" style={{ ...chip, padding: "2px 8px" }} onClick={() => selectAll(false)}>None</button>
              </span>
            }
          >
            {isEvm && (
              <div style={{ fontSize: 11, color: "var(--paper-4)", marginBottom: 8, lineHeight: 1.5 }}>
                pons builds the deployer&apos;s launch only: these wallets do not buy in the launch, they are exempt from the snipe tax when they buy after it.
              </div>
            )}
            {!isEvm && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <input value={bulkAmount} inputMode="decimal" onChange={(e) => setBulkAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  style={{ ...input, ...mono, width: 80 }} aria-label="Amount for each wallet" />
                <span style={{ fontSize: 11, color: "var(--paper-3)" }}>{quoteLabel}</span>
                <button type="button" style={chip} onClick={applyAll}>Set all</button>
                <button type="button" style={chip} onClick={jitter} title="±15% around each amount">Randomize</button>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", maxHeight: 360, overflowY: "auto", margin: "0 -6px" }}>
              {bundle.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--paper-4)", padding: "6px" }}>No other {isEvm ? "EVM" : "Solana"} wallet in the vault yet.</div>
              )}
              {bundle.map((w) => {
                const row = rows[w.id];
                const on = row?.on ?? false;
                const amt = amountOf(w);
                const low = on && short(w, amt ?? 0, false);
                return (
                  <div key={w.id} style={{
                    display: "grid", gridTemplateColumns: isEvm ? "22px minmax(0,1fr) 90px" : "22px minmax(0,1fr) 90px 90px",
                    gap: 8, alignItems: "center", padding: "5px 6px", borderRadius: 6,
                    background: on ? "var(--ink-2)" : "transparent",
                  }}>
                    <input type="checkbox" checked={on} aria-label={`Use ${w.displayLabel}`}
                      onChange={(e) => setRow(w.id, { on: e.target.checked })} />
                    <span style={{ fontSize: 12, color: "var(--paper-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {w.displayLabel} <span style={{ ...mono, color: "var(--paper-4)" }}>{shortAddr(w.pubkey, 4)}</span>
                    </span>
                    <span style={{ ...mono, fontSize: 11, textAlign: "right", color: low ? "var(--sell)" : "var(--paper-3)" }}>
                      {balances[w.id]?.loading ? "…" : fmtAmt(balances[w.id]?.sol ?? 0, 3)}
                    </span>
                    {!isEvm && (
                      <input value={row?.amount ?? bulkAmount} disabled={!on} inputMode="decimal"
                        onChange={(e) => setRow(w.id, { amount: e.target.value.replace(/[^0-9.]/g, "") })}
                        style={{ ...input, ...mono, padding: "5px 8px", fontSize: 12, opacity: on ? 1 : 0.4, color: amt === null ? "var(--sell)" : "var(--paper)" }} />
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-soft)" }}>
              <span style={{ fontSize: 11, color: "var(--paper-3)" }}>New wallets</span>
              <input value={genCount} inputMode="numeric" onChange={(e) => setGenCount(e.target.value.replace(/[^0-9]/g, ""))}
                style={{ ...input, ...mono, width: 56 }} aria-label="How many wallets" />
              <button type="button" style={chip} disabled={generating} onClick={() => void generate()}>{generating ? "Creating…" : "Create"}</button>
              <span style={{ fontSize: 10.5, color: "var(--paper-4)" }}>then fund them from Portfolio</span>
            </div>
          </Section>

          <Section title="Summary">
            <SRow label="Wallets">{1 + (isEvm ? 0 : picked.length)} buying{isEvm && picked.length ? ` · ${picked.length} exempt` : ""}</SRow>
            <SRow label="Total buys">{badAmount ? "—" : `${fmtAmt(total)} ${quoteLabel}`}</SRow>
            {!isEvm && nativeQuote && (
              <SRow label="Plus network costs">≈ {fmtAmt(SOL_CREATE_OVERHEAD + SOL_OVERHEAD * (1 + picked.length), 3)} SOL</SRow>
            )}
            <SRow label="Transactions">{isEvm ? "1–2 (approve, launch)" : `${1 + picked.filter((w) => (amountOf(w) ?? 0) > 0).length}`}</SRow>
            {tooMany && <Warn>At most {MAX_WALLETS} wallets, the creator included.</Warn>}
            {bagsZero && <Warn>On Bags every bundle wallet must buy more than 0.</Warn>}
            {missing.length > 0 && <div style={{ fontSize: 11, color: "var(--paper-4)", marginTop: 6 }}>Needs {missing.join(", ")}.</div>}
            <button
              type="button"
              disabled={!canLaunch}
              onClick={() => setConfirming(true)}
              style={{
                width: "100%", marginTop: 12, padding: "13px 16px", fontSize: 14.5, fontWeight: 700,
                color: "var(--ink-0)", background: canLaunch ? "var(--buy)" : "var(--ink-3, #2a2a2a)",
                border: 0, borderRadius: 999, cursor: canLaunch ? "pointer" : "not-allowed",
              }}
            >
              {job && !job.done ? "Launching…" : `Launch ${draft.symbol.trim() ? `$${draft.symbol.trim().replace(/^\$/, "")}` : "token"}`}
            </button>
            <div style={{ fontSize: 10.5, color: "var(--paper-4)", textAlign: "center", lineHeight: 1.5, marginTop: 8 }}>
              Raze builds the transactions; your vault signs them here; your RPC sends them.
            </div>
          </Section>

          {job && <Progress job={job} chainId={chainId} wallets={wallets} />}
        </div>
      </div>

      <ConfirmModal
        open={confirming}
        summary={`${1 + (isEvm ? 0 : picked.length)} wallet${picked.length || isEvm ? "s" : ""} · ${fmtAmt(total)} ${quoteLabel}`}
        onClose={() => setConfirming(false)}
        onConfirm={async (password) => {
          const { id } = await launchApi.start(form(), password);
          setJob(null);
          setJobId(id);
          setConfirming(false);
        }}
      />
    </Page>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────

function Page({ children }: { children: ReactNode }) {
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px 16px 48px" }}>
      <style>{`
        .bundler-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
        @media (max-width: 900px) { .bundler-grid { grid-template-columns: minmax(0, 1fr); } }
        .bundler-logo:hover .bundler-logo-hint, .bundler-logo:focus-visible .bundler-logo-hint { opacity: 1 !important; }
      `}</style>
      <div style={{ width: "100%", maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function Header({ chainId }: { chainId: ChainId }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--paper)" }}>Bundler</div>
        <div style={{ fontSize: 12, color: "var(--paper-3)", marginTop: 2 }}>
          Deploy a token on {CHAINS[chainId].name} and bundle the first buys from your vault wallets.
        </div>
      </div>
    </div>
  );
}

const LOGO_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const LOGO_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The token's logo: click (or drop a file) to upload it. The server keeps the
 * file and gives back the public URL the launch router downloads it from; the
 * URL field fills itself. A local preview shows while it uploads. Without a
 * public address (`canUpload` false) it only previews the URL, and a click
 * says why and goes to the URL field.
 */
function LogoPicker({ image, canUpload, onUploaded, onError, onUnavailable }: {
  image: string;
  canUpload: boolean;
  onUploaded: (url: string) => void;
  onError: (message: string) => void;
  onUnavailable: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function take(file: File | undefined) {
    if (!file || busy) return;
    if (!canUpload) return onUnavailable();
    if (!LOGO_TYPES.includes(file.type)) return onError("PNG, JPEG, GIF or WebP only.");
    if (file.size > LOGO_MAX_BYTES) return onError("Images up to 4 MB.");
    const local = URL.createObjectURL(file);
    setPreview(local);
    setBusy(true);
    try {
      const { url } = await launchApi.uploadImage(file);
      onUploaded(url);
    } catch (e) {
      setPreview(null);
      onError(errorText(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const remote = image.trim();
  const shown = preview ?? (/^https?:\/\//i.test(remote) ? remote : null);
  return (
    <button
      type="button"
      onClick={() => (canUpload ? fileRef.current?.click() : onUnavailable())}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files?.[0]); }}
      title={canUpload ? "Upload the token's image (PNG, JPEG, GIF or WebP, up to 4 MB)" : "The token's image: paste its URL below"}
      aria-label={canUpload ? "Upload the token's image" : "Token image preview"}
      className="bundler-logo"
      style={{
        position: "relative", width: 72, height: 72, padding: 0, borderRadius: 10, overflow: "hidden",
        background: "var(--ink-2)", cursor: busy ? "progress" : "pointer",
        border: `1px ${shown ? "solid" : "dashed"} ${over ? "var(--accent)" : "var(--line)"}`,
        display: "grid", placeItems: "center", color: "var(--paper-4)",
      }}
    >
      {shown
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={shown} alt="" width={72} height={72} style={{ objectFit: "cover", width: "100%", height: "100%", opacity: busy ? 0.5 : 1 }} referrerPolicy="no-referrer" />
        : (
          <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontSize: 9.5, letterSpacing: 0.4 }}>
            {canUpload ? Icon.plus(14) : Icon.rocket(14)}
            {canUpload ? "UPLOAD" : "LOGO"}
          </span>
        )}
      {shown && canUpload && (
        <span className="bundler-logo-hint" style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          background: "color-mix(in oklch, var(--ink-0) 60%, transparent)", color: "var(--paper)",
          fontSize: 9.5, letterSpacing: 0.4, opacity: busy ? 1 : 0, transition: "opacity 120ms",
        }}>
          {busy ? "UPLOADING…" : "CHANGE"}
        </span>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={LOGO_TYPES.join(",")}
        hidden
        onChange={(e) => void take(e.target.files?.[0])}
      />
    </button>
  );
}

function SRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}>
      <span style={{ color: "var(--paper-3)" }}>{label}</span>
      <span style={{ flex: 1, borderBottom: "1px dotted var(--line-soft)", transform: "translateY(3px)" }} />
      <span style={{ color: "var(--paper)", ...mono }}>{children}</span>
    </div>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return <div role="alert" style={{ fontSize: 11.5, color: "var(--sell)", marginTop: 6 }}>{children}</div>;
}

function EmptyWallets({ isEvm, onGenerate, busy }: { isEvm: boolean; onGenerate: () => void; busy: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <span style={{ fontSize: 12, color: "var(--paper-3)" }}>No {isEvm ? "EVM" : "Solana"} wallet in the vault.</span>
      <Btn tone="primary" size="sm" disabled={busy} onClick={onGenerate}>{busy ? "Creating…" : "Create one"}</Btn>
    </div>
  );
}

const STAGES: Array<{ id: LaunchJob["stage"]; label: string }> = [
  { id: "build", label: "Build" },
  { id: "sign", label: "Sign" },
  { id: "create", label: "Create" },
  { id: "buys", label: "Buys" },
  { id: "confirm", label: "Confirm" },
];

const STATUS_COLOR: Record<LaunchLegStatus, string> = {
  signed: "var(--paper-3)",
  sent: "var(--accent)",
  confirmed: "var(--buy)",
  failed: "var(--sell)",
  skipped: "var(--paper-4)",
  unknown: "var(--paper-3)",
};

function Progress({ job, chainId, wallets }: { job: LaunchJob; chainId: ChainId; wallets: UserWallet[] }) {
  const { navigate } = useClientNav();
  const at = job.stage === "provision" ? 0 : STAGES.findIndex((s) => s.id === job.stage);
  const finished = job.done;
  const label = (id: string | null, address: string) =>
    wallets.find((w) => w.id === id)?.displayLabel ?? shortAddr(address, 4);
  const confirmed = job.legs.filter((l) => l.status === "confirmed").length;

  return (
    <Section
      title={finished ? (job.stage === "done" ? "Launched" : job.stage === "partial" ? "Launched, with failures" : "Launch failed") : "Launching"}
      extra={<span style={{ ...mono, fontSize: 11, color: "var(--paper-3)" }}>{confirmed}/{job.legs.length || "—"} confirmed</span>}
    >
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {STAGES.map((s, i) => {
          const done = finished ? job.stage !== "failed" || i < at : i < at;
          const now = !finished && i === at;
          return (
            <div key={s.id} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ height: 3, borderRadius: 2, background: done ? "var(--buy)" : now ? "var(--accent)" : "var(--line-soft)" }} />
              <span style={{ fontSize: 10, color: now ? "var(--paper)" : "var(--paper-4)" }}>
                {s.label}{now && job.stage === "provision" ? " (Bags config)" : ""}
              </span>
            </div>
          );
        })}
      </div>

      {job.mint && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "var(--paper-3)" }}>Mint</span>
          <a href={explorerAccountUrl(job.mint, chainId)} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 12, color: "var(--paper)" }}>
            {shortAddr(job.mint, 6)}
          </a>
          <button type="button" style={{ ...chip, padding: "2px 8px" }} onClick={() => void navigator.clipboard?.writeText(job.mint!)}>Copy</button>
          {finished && job.stage !== "failed" && (
            <Btn tone="primary" size="xs" onClick={() => navigate(tokenHref(job.mint!, chainId))}>Open token page</Btn>
          )}
        </div>
      )}

      {job.error && <Warn>{job.error}</Warn>}

      {job.legs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6, maxHeight: 320, overflowY: "auto" }}>
          {job.legs.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "24px 70px minmax(0,1fr) 84px", gap: 8, alignItems: "center", fontSize: 11.5, padding: "3px 0" }}>
              <span style={{ ...mono, color: "var(--paper-4)" }}>{i + 1}</span>
              <span style={{ color: "var(--paper-2)" }}>{l.kind}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--paper-3)" }} title={l.error ?? undefined}>
                {label(l.walletId, l.wallet)}
                {l.signature && (
                  <> · <a href={explorerTxUrl(l.signature, chainId)} target="_blank" rel="noreferrer" style={{ ...mono, color: "var(--paper-3)" }}>{shortAddr(l.signature, 4)}</a></>
                )}
                {l.error && <span style={{ color: "var(--sell)" }}> · {l.error}</span>}
              </span>
              <span style={{ ...mono, textAlign: "right", color: STATUS_COLOR[l.status] }}>{l.status}</span>
            </div>
          ))}
        </div>
      )}
      {job.log.map((m, i) => <div key={i} style={{ fontSize: 11, color: "var(--paper-4)", marginTop: 4 }}>{m}</div>)}
    </Section>
  );
}

function ConfirmModal({ open, summary, onClose, onConfirm }: {
  open: boolean; summary: string; onClose: () => void; onConfirm: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setPassword("");
      setError(null);
      setBusy(false);
    }
  }, [open]);
  const go = useCallback(async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }, [password, busy, onConfirm]);

  return (
    <Modal open={open} onClose={onClose} width={420}>
      <ModalHeader title="Launch the token" icon={Icon.rocket(14)} onClose={onClose} />
      <form
        onSubmit={(e) => { e.preventDefault(); void go(); }}
        style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ fontSize: 12.5, color: "var(--paper-2)", lineHeight: 1.5 }}>
          {summary}. The vault signs the create and every buy; they cannot be called back once sent.
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, color: "var(--paper-3)" }}>Your password, to sign</span>
          <input type="password" value={password} autoFocus autoComplete="current-password" spellCheck={false}
            onChange={(e) => setPassword(e.target.value)} style={input} />
        </label>
        {error && <Warn>{error}</Warn>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Btn type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" tone="buy" disabled={!password || busy}>{busy ? "Starting…" : "Launch"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
