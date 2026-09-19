"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchPerpQuote, type PerpMarket, type PerpVenue } from "../../api/client";
import { useAllPerpLivePrices } from "../../hooks/usePerpMarketPrice";
import { fmtNum } from "../../lib/format";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";

interface Props {
  market: PerpMarket | null;
  /** Live last-trade close in USD (already converted from e6 USD by parent). */
  livePrice?: number | null;
  flash?: "up" | "down" | null;
  /** Full markets list — drives the in-header dropdown selector. */
  markets?: PerpMarket[];
  /** Called when the user picks a different market from the dropdown. */
  onSelect?: (marketId: string) => void;
}

const VENUE_LABEL: Record<string, string> = {
  jup: "JUPITER",
  phoenix: "PHOENIX",
};
const VENUE_COLOR: Record<string, string> = {
  jup: "var(--buy)",
  phoenix: "var(--accent-1, var(--buy))",
};

function SolAssetSvg({ size }: { size: number }) {
  const gid = React.useId();
  const height = Math.round(size * 88 / 101);
  return (
    <svg width={size} height={height} viewBox="0 0 101 88" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M100.48 69.3817L83.8068 86.8015C83.4444 87.1799 83.0058 87.4816 82.5185 87.6878C82.0312 87.894 81.5055 88.0003 80.9743 88H1.93563C1.55849 88 1.18957 87.8926 0.874202 87.6912C0.558829 87.4897 0.31074 87.2029 0.160416 86.8659C0.0100923 86.529 -0.0359181 86.1566 0.0280382 85.7945C0.0919944 85.4324 0.263131 85.0964 0.520422 84.8278L17.2061 67.408C17.5676 67.0306 18.0047 66.7295 18.4904 66.5234C18.9762 66.3172 19.5002 66.2104 20.0301 66.2095H99.0644C99.4415 66.2095 99.8104 66.3169 100.126 66.5183C100.441 66.7198 100.689 67.0067 100.84 67.3436C100.99 67.6806 101.036 68.0529 100.972 68.415C100.908 68.7771 100.737 69.1131 100.48 69.3817ZM83.8068 34.3032C83.4444 33.9248 83.0058 33.6231 82.5185 33.4169C82.0312 33.2108 81.5055 33.1045 80.9743 33.1048H1.93563C1.55849 33.1048 1.18957 33.2121 0.874202 33.4136C0.558829 33.6151 0.31074 33.9019 0.160416 34.2388C0.0100923 34.5758 -0.0359181 34.9482 0.0280382 35.3103C0.0919944 35.6723 0.263131 36.0083 0.520422 36.277L17.2061 53.6968C17.5676 54.0742 18.0047 54.3752 18.4904 54.5814C18.9762 54.7875 19.5002 54.8944 20.0301 54.8952H99.0644C99.4415 54.8952 99.8104 54.7879 100.126 54.5864C100.441 54.3849 100.689 54.0981 100.84 53.7612C100.99 53.4242 101.036 53.0518 100.972 52.6897C100.908 52.3277 100.737 51.9917 100.48 51.723L83.8068 34.3032ZM1.93563 21.7905H80.9743C81.5055 21.7907 82.0312 21.6845 82.5185 21.4783C83.0058 21.2721 83.4444 20.9704 83.8068 20.592L100.48 3.17219C100.737 2.90357 100.908 2.56758 100.972 2.2055C101.036 1.84342 100.99 1.47103 100.84 1.13408C100.689 0.79713 100.441 0.510296 100.126 0.308823C99.8104 0.107349 99.4415 1.24074e-05 99.0644 0L20.0301 0C19.5002 0.000878397 18.9762 0.107699 18.4904 0.313848C18.0047 0.519998 17.5676 0.821087 17.2061 1.19848L0.524723 18.6183C0.267681 18.8866 0.0966198 19.2223 0.0325185 19.5839C-0.0315829 19.9456 0.0140624 20.3177 0.163856 20.6545C0.31365 20.9913 0.561081 21.2781 0.875804 21.4799C1.19053 21.6817 1.55886 21.7896 1.93563 21.7905Z" fill={`url(#${gid})`} />
      <defs>
        <linearGradient id={gid} x1="8.52558" y1="90.0973" x2="88.9933" y2="-3.01622" gradientUnits="userSpaceOnUse">
          <stop offset="0.08" stopColor="#9945FF" />
          <stop offset="0.3" stopColor="#8752F3" />
          <stop offset="0.5" stopColor="#5497D5" />
          <stop offset="0.6" stopColor="#43B4CA" />
          <stop offset="0.72" stopColor="#28E0B9" />
          <stop offset="0.97" stopColor="#19FB9B" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function BtcAssetSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: "block" }}>
      <path fill="#F7931A" fillRule="evenodd" d="M16 32C7.163 32 0 24.837 0 16S7.163 0 16 0s16 7.163 16 16-7.163 16-16 16zm7.189-17.98c.314-2.096-1.283-3.223-3.465-3.975l.708-2.84-1.728-.43-.69 2.765c-.454-.114-.92-.22-1.385-.326l.695-2.783L15.596 6l-.708 2.839c-.376-.086-.746-.17-1.104-.26l.002-.009-2.384-.595-.46 1.846s1.283.294 1.256.312c.7.175.826.638.805 1.006l-.806 3.235c.048.012.11.03.18.057l-.183-.045-1.13 4.532c-.086.212-.303.531-.793.41.018.025-1.256-.313-1.256-.313l-.858 1.978 2.25.561c.418.105.828.215 1.231.318l-.715 2.872 1.727.43.708-2.84c.472.127.93.245 1.378.357l-.706 2.828 1.728.43.715-2.866c2.948.558 5.164.333 6.097-2.333.752-2.146-.037-3.385-1.588-4.192 1.13-.26 1.98-1.003 2.207-2.538zm-3.95 5.538c-.533 2.147-4.148.986-5.32.695l.95-3.805c1.172.293 4.929.872 4.37 3.11zm.535-5.569c-.487 1.953-3.495.96-4.47.717l.86-3.45c.975.243 4.118.696 3.61 2.733z" />
    </svg>
  );
}

function EthAssetSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 226.777 226.777" aria-hidden="true" style={{ display: "block" }}>
      <path fill="#627EEA" d="M113.313,0C50.732,0,0,50.732,0,113.313s50.732,113.313,113.313,113.313s113.313-50.732,113.313-113.313 S175.894,0,113.313,0z M111.844,188.386l-44.78-63.344l44.78,26.218V188.386z M111.844,141.976l-45.083-26.408l45.083-19.748 V141.976z M111.844,92.647l-43.631,19.11l43.631-73.306V92.647z M114.75,38.429l44.244,73.6L114.75,92.647V38.429z M114.75,188.386 V151.26l44.78-26.218L114.75,188.386z M114.75,141.977V95.821l45.116,19.762L114.75,141.977z" />
    </svg>
  );
}

/// Hand-curated logo URLs for assets CoinCap doesn't cover — mostly newer
/// Solana SPL tokens and Phoenix-synthetic markets (GOLD/WTIOIL). Sourced
/// from Jupiter's token-search API and committed here so the icons render
/// from a known-good URL without an extra API call per render.
const PERP_ASSET_LOGO: Record<string, string> = {
  JTO: "https://metadata.jito.network/token/jto/image",
  MEGA: "https://arweave.net/WXyUReRYmx5G-mDd7aiun9bK0AjlGpwkNv2y_AdCeSc",
  MON: "https://imagedelivery.net/cBNDGgkrsEA-b_ixIp9SkQ/I_t8rg_V_400x400.jpg/public",
  GOLD: "https://raw.githubusercontent.com/oroweb3/gold/de58e6cdc6531d2a65fba2a3f5c708a5c0d5c777/GOLD.png",
  WTIOIL: "https://ipfs.io/ipfs/QmdHpPoFgKbf5Z4uMVWfY8SAtdvdSJyzWJJnAByLdFBtxE",
  FARTCOIN: "https://ipfs.io/ipfs/QmQr3Fz4h1etNsF7oLGMRHiCzhB5y9a7GjyodnF7zLHK1g",
  CHIP: "https://arweave.net/73OWrBSVo3VRA4rqTpmFOX08xbGnkFfR-Y9GiQH-zvw",
  SKR: "https://gateway.irys.xyz/uP1dFvCofZQT26m3SKOCttXrir3ORBR1B8wPhP6tv7M?ext=png",
  XPL: "https://ipfs.io/ipfs/bafkreiflahtfpgxij3ttdegoh5etnltubvewmpkdvdllmdvwh3wtc5ojoe",
  VVV: "https://ipfs.io/ipfs/bafkreidqqwwmbd5qycfx756bz4vaiovxco3zs4ggo6vn2z2jth4kn2flau",
  MET: "https://assets.meteora.ag/met-token.svg",
  PUMP: "https://ipfs.io/ipfs/bafkreibyb3hcn7gglvdqpmklfev3fut3eqv3kje54l3to3xzxxbgpt5wjm",
  TON: "https://cdn.ondo.finance/tokens/logos/ton_160x160.png",
  "2Z": "https://i.ibb.co/CpkQG6C1/img.jpg",
};

function PerpAssetIcon({ asset, size = 34 }: { asset: string; size?: number }) {
  const symbol = asset.toUpperCase();
  if (symbol === "SOL") return <SolAssetSvg size={size} />;
  if (symbol === "BTC") return <BtcAssetSvg size={size} />;
  if (symbol === "ETH") return <EthAssetSvg size={size} />;
  // Try the curated map first (Phoenix-only / new tokens), then CoinCap's
  // icon CDN (covers majors — SUI, BNB, DOGE, XRP, NEAR, TAO, LIT, HYPE,
  // ZEC, AAVE, JUP, …). On any load error fall through to text initial.
  return <PerpAssetRemoteIcon symbol={symbol} size={size} />;
}

function PerpAssetRemoteIcon({ symbol, size }: { symbol: string; size: number }) {
  // Build the source chain: curated override → CoinCap → text initial.
  // `step` indexes into this list; we advance on each onError until one
  // succeeds (or we exhaust the list and render the text fallback).
  const candidates = React.useMemo(() => {
    const list: string[] = [];
    const override = PERP_ASSET_LOGO[symbol];
    if (override) list.push(override);
    list.push(`https://assets.coincap.io/assets/icons/${symbol.toLowerCase()}@2x.png`);
    return list;
  }, [symbol]);
  const [step, setStep] = React.useState(0);
  React.useEffect(() => { setStep(0); }, [symbol]);
  if (step >= candidates.length) {
    return (
      <span className="mono" style={{ fontSize: Math.max(9, Math.round(size * 0.36)), fontWeight: 800, color: "var(--paper)" }}>
        {symbol.slice(0, 4)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={candidates[step]}
      alt={symbol}
      width={size}
      height={size}
      onError={() => setStep((s) => s + 1)}
      style={{ width: size, height: size, borderRadius: "50%", display: "block" }}
    />
  );
}

function fmtUsd(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "–";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}k`;
  return `$${n.toFixed(dp)}`;
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "–";
  if (n >= 10_000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (n >= 100) return `$${n.toFixed(2)}`;
  if (n >= 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(6)}`;
}

/** Avatar showing asset icon with text fallback. */
function PerpAvatar({ asset }: { asset: string }) {
  const symbol = asset.toUpperCase();
  return (
    <div style={{ width: 52, height: 52, flexShrink: 0 }}>
      <div style={{
        width: 52, height: 52,
        display: "grid", placeItems: "center",
      }}>
        <PerpAssetIcon asset={symbol} size={symbol === "SOL" ? 36 : 38} />
      </div>
    </div>
  );
}

export function PerpHeader({ market, livePrice, flash, markets, onSelect }: Props) {
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  // Reference price: prefer parent-supplied live close (driven by WS), else
  // pull a one-shot quote so the header has *something* on first paint.
  const [quotePrice, setQuotePrice] = useState<number | null>(null);
  useEffect(() => {
    if (!market) return;
    let cancelled = false;
    fetchPerpQuote({
      market_id: market.market_id,
      side: "long",
      collateral_usdc_e6: 1_000_000,
      leverage_bps: 10_000,
      slippage_bps: 50,
    })
      .then((r) => {
        if (cancelled) return;
        if (r.success && r.data) setQuotePrice(r.data.entry_price / 1_000_000);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [market?.market_id]);

  if (!market) {
    return (
      <div style={{
        padding: "12px 16px",
        background: "var(--ink-1)",
        borderBottom: "1px solid var(--line-soft)",
        color: "var(--paper-3)",
        fontSize: 13,
      }}>
        Select a market
      </div>
    );
  }

  const price = livePrice ?? quotePrice ?? null;
  const venueLabel = VENUE_LABEL[market.venue] ?? market.venue.toUpperCase();
  const venueColor = VENUE_COLOR[market.venue] ?? "var(--paper-3)";
  const symbolText = `${market.asset}-PERP`;
  const selectorEnabled = !!(markets && markets.length > 0 && onSelect);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px 12px",
      background: "var(--ink-1)",
      borderBottom: "1px solid var(--line-soft)",
      overflow: "visible",
    }}>
      <MarketSelector
        market={market}
        markets={markets ?? []}
        onSelect={onSelect}
        enabled={selectorEnabled}
      >
        <PerpAvatar asset={market.asset} />
        <div style={{
          display: "flex", flexDirection: "column", gap: 4,
          flex: isMobile ? "1 1 auto" : "0 1 240px",
          width: isMobile ? "auto" : 240,
          minWidth: isMobile ? 0 : 180,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 16, fontWeight: 700, color: "var(--paper)",
              fontFamily: "var(--font-mono)", letterSpacing: 0.3,
            }}>
              {symbolText}
            </span>
            {selectorEnabled && (
              <ChevronDown size={12} color="var(--paper-3)" />
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{
              fontSize: 10, color: venueColor,
              textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600,
            }}>
              {venueLabel}
            </span>
            <span className="mono" style={{
              fontSize: 9, color: "var(--paper-4)", letterSpacing: 0.5,
            }}>
              PERPETUAL · USD
            </span>
          </div>
        </div>
      </MarketSelector>

      {/* Stats strip eats the header's middle on desktop; on phones it
          crushes the symbol + price, so hide it entirely ≤480px. */}
      {!isPhone && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <PerpStatsStrip market={market} />
        </div>
      )}

      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        flexShrink: 0,
        paddingLeft: isPhone ? 0 : 12,
        marginLeft: isPhone ? "auto" : undefined,
        borderLeft: isPhone ? "none" : "1px solid var(--line-soft)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span
            key={price ?? 0}
            className="mono"
            style={{
              fontSize: isPhone ? 18 : 22, fontWeight: 500, letterSpacing: 0,
              color:
                flash === "up" ? "var(--buy)" :
                flash === "down" ? "var(--sell)" :
                "var(--paper)",
              animation: flash ? "flashPrice 700ms ease-out" : undefined,
            }}
          >
            {price != null ? fmtPrice(price) : "–"}
          </span>
          <span className="eyebrow" style={{ color: "var(--paper-3)" }}>MARK PRICE</span>
        </div>
      </div>
    </div>
  );
}

function PerpStatsStrip({ market }: { market: PerpMarket }) {
  const items: Array<{ label: string; val: string; accent?: string }> = [
    { label: "VOL 24H", val: fmtUsd(market.volume_24h_usd ?? 0, 0), accent: "var(--info)" },
    { label: "TRADES 24H", val: fmtNum(market.trades_24h ?? 0), accent: "var(--paper-3)" },
    { label: "VENUE", val: VENUE_LABEL[market.venue] ?? market.venue, accent: "var(--paper-4)" },
    { label: "ASSET", val: market.asset, accent: "var(--paper-4)" },
    { label: "QUOTE", val: "USDC", accent: "var(--paper-4)" },
    { label: "TYPE", val: "PERP", accent: "var(--paper-4)" },
    { label: "FUND MECH", val: "BORROW", accent: "var(--paper-4)" },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "nowrap", alignSelf: "stretch", width: "100%", minWidth: 0, overflow: "hidden" }}>
      {items.map((s) => (
        <div
          key={s.label}
          style={{
            padding: "6px 8px",
            borderLeft: "1px solid var(--line-soft)",
            display: "flex", flexDirection: "column", justifyContent: "center", gap: 3,
            flex: "1 1 0", minWidth: 0,
          }}
        >
          <span className="mono" style={{
            fontSize: 8, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
            color: s.accent ?? "var(--paper-4)",
          }}>{s.label}</span>
          <span className="mono" style={{
            fontSize: 12, fontWeight: 600,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            color: "var(--paper)",
          }}>{s.val}</span>
        </div>
      ))}
    </div>
  );
}

function ChevronDown({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.5 L6 8 L9.5 4.5" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── market selector dropdown ────────────────────────────────────────────

function MarketSelector({
  market,
  markets,
  onSelect,
  enabled,
  children,
}: {
  market: PerpMarket;
  markets: PerpMarket[];
  onSelect?: (marketId: string) => void;
  enabled: boolean;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [venueFilter, setVenueFilter] = useState<PerpVenue | "all">("all");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Auto-focus the search field when opening.
    inputRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Reset search when closed so reopening starts clean.
  useEffect(() => { if (!open) setSearch(""); }, [open]);

  // Live last-trade price per market, streamed off `perp_fill`. Only active
  // while the dropdown is open so we don't hold every market's subscription
  // on the wire when it's closed.
  const marketIds = useMemo(() => markets.map((m) => m.market_id), [markets]);
  const livePrices = useAllPerpLivePrices(marketIds, open);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return markets.filter((m) => {
      if (venueFilter !== "all" && m.venue !== venueFilter) return false;
      if (!q) return true;
      return m.asset.toLowerCase().includes(q) || m.market_id.toLowerCase().includes(q);
    });
  }, [markets, search, venueFilter]);

  const wrapperStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 12,
    background: "transparent", border: "none", padding: 0,
    cursor: enabled ? "pointer" : "default",
    color: "inherit", textAlign: "left",
    position: "relative",
  };

  if (!enabled) {
    return (
      <div style={wrapperStyle}>
        {children}
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={wrapperStyle}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {children}
      </button>

      {open && (
        <div
          role="dialog"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)", left: 0,
            width: isMobile ? "min(90vw, 520px)" : 520,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: isMobile ? "70vh" : 460,
            background: "var(--ink-1)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
            zIndex: 50,
            display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{
            padding: 8,
            borderBottom: "1px solid var(--line-soft)",
            background: "var(--ink-2)",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px",
              background: "var(--ink-1)",
              border: "1px solid var(--line-soft)",
              borderRadius: 6,
            }}>
              <SearchIcon size={12} color="var(--paper-3)" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search markets..."
                style={{
                  flex: 1,
                  background: "transparent", border: "none", outline: "none",
                  color: "var(--paper)", fontSize: 12,
                  fontFamily: "var(--font-mono)",
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {(["all", "jup", "phoenix"] as const).map((v) => {
                  const active = venueFilter === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setVenueFilter(v)}
                      style={{
                        padding: "3px 8px", fontSize: 9,
                        color: active ? "var(--paper)" : "var(--paper-3)",
                        background: active ? "var(--ink-3)" : "transparent",
                        border: "1px solid var(--line-soft)",
                        borderRadius: 3,
                        textTransform: "uppercase", letterSpacing: 0.5,
                        cursor: "pointer",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {v === "all" ? "ALL" : v}
                    </button>
                  );
                })}
              </div>
              <span className="mono" style={{ fontSize: 9, color: "var(--paper-4)", letterSpacing: 0.5 }}>
                {filtered.length} MARKETS
              </span>
            </div>
          </div>

          <div style={{
            display: "grid",
            // ≤480px: collapse to market + price (the 84+96+78+92=350px of
            // fixed columns crush the market cell to near-0 on a 360px sheet).
            gridTemplateColumns: isPhone ? "1fr auto" : "1fr 84px 96px 78px 92px",
            padding: "6px 12px",
            background: "var(--ink-2)",
            borderBottom: "1px solid var(--line-soft)",
            color: "var(--paper-3)", fontSize: 9,
            textTransform: "uppercase", letterSpacing: 1,
            fontFamily: "var(--font-mono)",
          }}>
            <span>Market</span>
            {!isPhone && <span style={{ textAlign: "right" }}>Venue</span>}
            <span style={{ textAlign: "right" }}>Price</span>
            {!isPhone && <span style={{ textAlign: "right" }}>Trades 24h</span>}
            {!isPhone && <span style={{ textAlign: "right" }}>Vol 24h</span>}
          </div>

          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {filtered.length === 0 ? (
              <div style={{
                padding: "24px 12px", textAlign: "center",
                color: "var(--paper-3)", fontSize: 11,
              }}>
                No markets match.
              </div>
            ) : filtered.map((m) => {
              const active = m.market_id === market.market_id;
              const vColor = VENUE_COLOR[m.venue] ?? "var(--paper-3)";
              const assetSymbol = m.asset.toUpperCase();
              const live = livePrices[m.market_id];
              const px = live?.price;
              const pxColor =
                live?.flash === "up" ? "var(--buy)" :
                live?.flash === "down" ? "var(--sell)" :
                "var(--paper)";
              return (
                <button
                  key={m.market_id}
                  onClick={() => {
                    onSelect?.(m.market_id);
                    setOpen(false);
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isPhone ? "1fr auto" : "1fr 84px 96px 78px 92px",
                    alignItems: "center",
                    width: "100%",
                    padding: "8px 12px",
                    background: active ? "var(--ink-2)" : "transparent",
                    border: "none",
                    borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                    borderBottom: "1px solid var(--line-soft)",
                    color: "var(--paper)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "var(--font-mono)",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "var(--ink-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span style={{
                    display: "flex", alignItems: "center", gap: 9,
                    fontSize: 12, fontWeight: 600,
                    color: "var(--paper)",
                  }}>
                    <span style={{
                      width: 24, height: 24,
                      display: "grid", placeItems: "center",
                      flexShrink: 0,
                    }}>
                      <PerpAssetIcon asset={assetSymbol} size={assetSymbol === "SOL" ? 17 : 18} />
                    </span>
                    <span>{m.asset}-PERP</span>
                  </span>
                  {!isPhone && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                      color: vColor, textAlign: "right",
                      textTransform: "uppercase",
                    }}>
                      {VENUE_LABEL[m.venue] ?? m.venue}
                    </span>
                  )}
                  <span
                    key={px != null ? `${m.market_id}:${px}` : m.market_id}
                    style={{
                      fontSize: 11, fontWeight: 600, textAlign: "right",
                      color: pxColor,
                      animation: live?.flash ? "flashPrice 700ms ease-out" : undefined,
                    }}
                  >
                    {px != null && px > 0 ? fmtPrice(px) : "–"}
                  </span>
                  {!isPhone && (
                    <span style={{
                      fontSize: 11, color: "var(--paper-2)", textAlign: "right",
                    }}>
                      {fmtNum(m.trades_24h ?? 0)}
                    </span>
                  )}
                  {!isPhone && (
                    <span style={{
                      fontSize: 11, color: "var(--paper-2)", textAlign: "right",
                    }}>
                      {fmtUsd(m.volume_24h_usd ?? 0, 0)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="5" cy="5" r="3.25" stroke={color} strokeWidth="1.25" fill="none" />
      <path d="M7.6 7.6 L10 10" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}
