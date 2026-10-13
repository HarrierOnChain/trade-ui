"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClientNav } from "./ClientPages";
import { fetchWalletHoldings } from "../../api/client";
import { queueBatchEnrich } from "../../lib/batchEnrichCoordinator";

import { ChainHealthPopup } from "./ChainHealthPopup";
import { useChainSentiment } from "../../hooks/useChainSentiment";
import { useNativeSpots, useSolPrice, type NativeSpots } from "../../hooks/useSolPrice";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { useChain } from "../../contexts/ChainContext";
import { CHAIN_CHANGED_EVENT, CHAINS, type ChainId, nativeSymbol } from "../../lib/chains";
import { ChainIcon, Icon, PlatformLogo, TokenIcon, Tooltip } from "../atoms";
import { TokenChartPopup } from "../TokenRow/TokenChartPopup";
import { useApp } from "../../contexts/AppContext";
import { useTickerBar } from "../../hooks/useTickerBar";
import { useIsPhone, useIsMobile } from "../../hooks/useMediaQuery";
import { tokenHref } from "../../lib/tokenHref";
import { fmtNum, fmtUsd } from "../../lib/format";
import { PORTFOLIO_STORAGE_KEY, readUserWallets } from "../../lib/userWalletsMirror";
import type { LivePrice } from "../../hooks/useLiveTradePrices";
import type { TokenEvent, TokenHolding } from "../../types";

// Bonding-curve graduation FDV in native units (× native USD price → the
// "migration market cap" shown in the footer). Solana pump.fun = 411 SOL.
const MIGRATION_FDV_NATIVE: Record<ChainId, number> = {
  sol: 411,
  eth: 0,
  bsc: 0,
  base: 0,
  robinhood: 0,
};

export function StatusFooter() {
  const { chainId } = useChain();
  const solPrice = useSolPrice();
  const fps = useFps();
  const isPhone = useIsPhone();
  const isMobile = useIsMobile();

  // Chain-native USD price (SOL from the spot price feed).
  const chainNativeUsd = solPrice ?? 0;
  const migThreshold = MIGRATION_FDV_NATIVE[chainId] ?? 0;
  const bondingCurve =
    chainNativeUsd > 0 && migThreshold > 0 ? chainNativeUsd * migThreshold : 0;
  const fpsColor = fps == null ? "var(--paper-4)" : "var(--accent)";

  // Mobile: the dense desktop readout row is replaced by a slim status strip —
  // SOL / ETH / BNB on the left, a couple of action icons on the right. No horizontal scroll; the nav now lives in the header ☰ sheet.
  if (isMobile) {
    return (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 2,
          padding: "0 8px", height: 34,
          paddingBottom: "var(--safe-b)", boxSizing: "content-box",
          background: "var(--ink-1)",
          borderTop: "1px solid var(--line-soft)",
          fontFamily: "var(--font-mono)", flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <FooterNativePrices />
        <div style={{ flex: 1, minWidth: 0 }} />
        <FooterTickerToggle />
        <FooterNotificationsButton />
        <FooterThemeButton />
      </div>
    );
  }

  return (
    <div
      className={isPhone ? "scroll-x-hide" : undefined}
      style={{
        display: "flex", alignItems: "center",
        padding: "0 10px", height: 30,
        paddingBottom: isPhone ? "var(--safe-b)" : undefined,
        // content-box only on phone so the safe-area padding adds below the bar
        // instead of eating into its 30px height; desktop keeps inherited border-box.
        boxSizing: isPhone ? "content-box" : undefined,
        background: "var(--ink-1)",
        borderTop: "1px solid var(--line-soft)",
        fontSize: 10, fontFamily: "var(--font-mono)",
        color: "var(--paper-4)",
        flexShrink: 0, letterSpacing: "0.05em",
        // On phones the dense readout row would clip; let it scroll horizontally.
        overflowX: isPhone ? "auto" : "visible",
        overflowY: "visible",
      }}
    >
      <FooterReadout label="FPS" value={fps ?? "..."} valueColor={fpsColor} />
      <FooterDivider />
      <FooterNativePrices trailingDivider />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <HoldingsCarousel solPrice={solPrice} />
      </div>
      {/* Always rendered — it hosts the Chain Health popup on hover. The
          migration FDV is chain-aware ("—" on chains with no bonding curve). */}
      <FooterDivider />
      <FooterBondingCurve value={bondingCurve > 0 ? `$${fmtNum(bondingCurve)}` : "—"} />
      <FooterDivider />
      <FooterTickerToggle />
      <FooterNotificationsButton />
      <FooterThemeButton />
      <FooterDivider />
      <FooterIconLink label="Discord" href="https://discord.com/invite/razedotbot">
        {Icon.discord(FOOTER_ICON)}
      </FooterIconLink>
      <FooterIconLink label="X / Twitter" href="https://x.com/razedotbot">
        {Icon.x(FOOTER_ICON)}
      </FooterIconLink>
      <FooterIconLink label="Docs" href="https://docs.raze.bot/">
        {Icon.article(FOOTER_ICON)}
      </FooterIconLink>
      <FooterDivider />
      <FooterMadeWithLove />
    </div>
  );
}

// Uniform size for every footer icon.
const FOOTER_ICON = 14;

// Action icons sit brighter than the passive readouts (paper-2, not paper-4)
// so they read as tappable — mirrors Axiom's footer icon cluster.
const footerActionBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  height: "100%", padding: "0 8px",
  background: "transparent", border: 0,
  color: "var(--paper-2)", cursor: "pointer",
  transition: "color 120ms",
};

function FooterTickerToggle() {
  const { enabled, toggleEnabled } = useTickerBar();
  return (
    <Tooltip content={enabled ? "Hide watchlist ticker" : "Show watchlist ticker"} placement="top">
      <button
        type="button"
        aria-label="Toggle watchlist ticker"
        aria-pressed={enabled}
        onClick={toggleEnabled}
        style={{ ...footerActionBtnStyle, color: enabled ? "var(--accent)" : "var(--paper-2)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = enabled ? "var(--accent)" : "var(--paper)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = enabled ? "var(--accent)" : "var(--paper-2)")}
      >
        {Icon.layoutTop(FOOTER_ICON)}
      </button>
    </Tooltip>
  );
}

function FooterNotificationsButton() {
  const { openNotifications } = useApp();
  return (
    <Tooltip content="Notifications" placement="top">
      <button
        type="button"
        aria-label="Notifications settings"
        onClick={openNotifications}
        style={footerActionBtnStyle}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-2)")}
      >
        {Icon.notification(FOOTER_ICON)}
      </button>
    </Tooltip>
  );
}

function FooterThemeButton() {
  const { openThemeStudio } = useApp();
  return (
    <Tooltip content="Customize theme" placement="top">
      <button
        type="button"
        aria-label="Customize theme"
        onClick={openThemeStudio}
        style={footerActionBtnStyle}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-2)")}
      >
        {Icon.palette(FOOTER_ICON)}
      </button>
    </Tooltip>
  );
}

function FooterIconLink({ label, href, children }: { label: string; href: string; children: React.ReactNode }) {
  return (
    <Tooltip content={label} placement="top">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        style={footerActionBtnStyle}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--paper)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--paper-2)")}
      >
        {children}
      </a>
    </Tooltip>
  );
}

function FooterMadeWithLove() {
  const openRaze = () =>
    window.open("https://raze.bot", "_blank", "noopener,noreferrer");
  return (
    <span
      role="group"
      aria-label="Crafted with love by Raze"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0 6px 0 7px",
        height: "100%",
        background: "linear-gradient(180deg, color-mix(in oklch, var(--ink-2) 70%, transparent), transparent)",
        borderLeft: "1px solid color-mix(in oklch, var(--accent) 18%, var(--line-soft))",
        color: "var(--paper-4)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <span className="eyebrow" style={{ fontSize: 8, color: "var(--paper)" }}>Crafted by</span>
      <Tooltip content="Visit raze.bot" placement="top">
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 25,
            height: 25,
            marginLeft: -1,
            lineHeight: 0,
            filter: "drop-shadow(0 2px 7px color-mix(in oklch, var(--accent) 22%, transparent))",
          }}
        >
          <img
            src="/logo/raze.svg"
            alt="Visit raze.bot"
            width={25}
            height={25}
            onClick={openRaze}
            style={{ cursor: "pointer", display: "block" }}
          />
        </span>
      </Tooltip>
    </span>
  );
}

function FooterDivider() {
  return <span style={{ width: 1, height: 14, background: "var(--line-soft)", flexShrink: 0 }} />;
}

function FooterReadout({
  label,
  value,
  valueColor = "var(--paper-2)",
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      padding: "0 9px",
      height: "100%",
      whiteSpace: "nowrap",
    }}>
      <span className="eyebrow" style={{ fontSize: 8, color: "var(--paper-4)" }}>{label}</span>
      <span className="mono" style={{ color: valueColor, fontSize: 11, fontWeight: 500 }}>{value}</span>
    </span>
  );
}

const NATIVE_FOOTER: Array<{ chainId: ChainId; spot: keyof NativeSpots }> = [
  { chainId: "sol", spot: "sol" },
  { chainId: "eth", spot: "eth" },
  { chainId: "bsc", spot: "bnb" },
];

function fmtSpot(price: number): string {
  return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function FooterNativePrices({
  leadingDivider = false,
  trailingDivider = false,
}: {
  leadingDivider?: boolean;
  trailingDivider?: boolean;
}) {
  const spots = useNativeSpots();
  const shown = NATIVE_FOOTER.filter((row) => spots[row.spot] != null);
  if (shown.length === 0) return null;
  return (
    <>
      {leadingDivider && <FooterDivider />}
      {shown.map((row, i) => (
        <React.Fragment key={row.spot}>
          {i > 0 && <FooterDivider />}
          <FooterNativePrice chainId={row.chainId} price={spots[row.spot]!} />
        </React.Fragment>
      ))}
      {trailingDivider && <FooterDivider />}
    </>
  );
}

function FooterNativePrice({ chainId, price }: { chainId: ChainId; price: number }) {
  const chain = CHAINS[chainId];
  const label = nativeSymbol(chainId);
  return (
    <Tooltip content={`${chain.name} · ${label}/USD`} placement="top">
      <span style={{ ...footerPriceButtonStyle, cursor: "default" }}>
        <span style={{ display: "inline-flex", alignItems: "center", color: "var(--paper-4)" }}>
          <ChainIcon id={chainId} size={11} />
        </span>
        <span className="mono" style={{ color: "var(--buy)", fontSize: 11, fontWeight: 500 }}>
          {fmtSpot(price)}
        </span>
      </span>
    </Tooltip>
  );
}

const footerPriceButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "0 9px",
  height: "100%",
  background: "transparent",
  border: 0,
  color: "var(--paper-3)",
  fontFamily: "var(--font-mono)",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

function FooterBondingCurve({ value }: { value: string }) {
  const sentiment = useChainSentiment();
  const [showPopup, setShowPopup] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const openPopup = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setShowPopup(true);
  };

  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setShowPopup(false), 120);
  };

  return (
    <span
      onMouseEnter={openPopup}
      onMouseLeave={scheduleClose}
      onFocus={openPopup}
      onBlur={scheduleClose}
      tabIndex={0}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "0 9px",
        height: "100%",
        background: showPopup ? "var(--ink-2)" : "transparent",
        outline: "none",
        color: showPopup ? "var(--paper)" : "var(--paper-3)",
        whiteSpace: "nowrap",
        cursor: "default",
        transition: "background 120ms, color 120ms",
      }}
    >
      <PlatformStack />
      <span className="mono" style={{ color: "var(--paper-2)", fontSize: 11, fontWeight: 500 }}>
        {value}
      </span>
      {showPopup && (
        <ChainHealthPopup
          sentiment={sentiment}
          placement="above"
        />
      )}
    </span>
  );
}

// Launchpad logos shown in the footer chip. Only platforms with an icon
// asset are listed (PlatformLogo returns null otherwise).
const FOOTER_LOGOS: Partial<Record<ChainId, Array<{ platform: string; left: number; top: number; zIndex: number; opacity: number }>>> = {
  sol: [
    { platform: "meteora", left: 4, top: 8, zIndex: 1, opacity: 0.72 },
    { platform: "raydium", left: 2, top: 2, zIndex: 2, opacity: 0.88 },
    { platform: "pumpfun", left: 8, top: 4, zIndex: 3, opacity: 1 },
  ],
  eth: [
    { platform: "uniswap", left: 4, top: 4, zIndex: 1, opacity: 0.9 },
  ],
  bsc: [
    { platform: "fourmeme", left: 2, top: 3, zIndex: 2, opacity: 0.9 },
    { platform: "flap", left: 8, top: 6, zIndex: 1, opacity: 0.75 },
  ],
  base: [
    { platform: "bankr", left: 4, top: 4, zIndex: 1, opacity: 0.9 },
  ],
  robinhood: [
    { platform: "pons", left: 4, top: 4, zIndex: 1, opacity: 0.9 },
  ],
};

function PlatformStack() {
  const { chainId } = useChain();
  const logos = FOOTER_LOGOS[chainId] ?? [];
  if (logos.length === 0) return null;

  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        width: 22,
        height: 21,
        display: "inline-block",
        flexShrink: 0,
      }}
    >
      {logos.map((logo) => (
        <span
          key={logo.platform}
          style={{
            position: "absolute",
            left: logo.left,
            top: logo.top,
            zIndex: logo.zIndex,
            opacity: logo.opacity,
            filter: "drop-shadow(0 1px 0 var(--ink-0))",
          }}
        >
          <PlatformLogo platform={logo.platform} size={13} />
        </span>
      ))}
    </span>
  );
}

function useUserHoldings() {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [holdings, setHoldings] = useState<TokenHolding[]>([]);

  // Hydrate wallet addresses from localStorage after mount, and keep in sync
  // when the Portfolio page adds/removes wallets in another tab.
  useEffect(() => {
    const sync = () => setAddresses(readUserWallets().map((w) => w.address));
    sync();
    // `storage` fires for cross-tab writes; `terminal:wallets-changed` fires
    // when useUserWallets mirrors the backend wallet list in the same tab.
    const onStorage = (e: StorageEvent) => {
      if (e.key === PORTFOLIO_STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("terminal:wallets-changed", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("terminal:wallets-changed", sync);
    };
  }, []);

  const addrKey = addresses.join(",");

  useEffect(() => {
    if (!addrKey) {
      setHoldings([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const results = await Promise.allSettled(addresses.map((a) => fetchWalletHoldings(a)));
      if (cancelled) return;
      const map = new Map<string, TokenHolding>();
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const h of r.value.data ?? []) {
          if (h.isNative) continue;
          if ((h.usdValue ?? 0) <= 0 && h.amount <= 0) continue;
          const existing = map.get(h.mint);
          if (!existing) {
            map.set(h.mint, { ...h });
          } else {
            existing.amount += h.amount;
            existing.usdValue = (existing.usdValue ?? 0) + (h.usdValue ?? 0);
            existing.symbol = existing.symbol || h.symbol;
            existing.name = existing.name || h.name;
            existing.image = existing.image || h.image;
          }
        }
      }
      const sorted = [...map.values()].sort(
        (a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0),
      );
      // Each row names its token (symbol, name, image) as the API knows it.
      setHoldings(sorted);
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrKey]);

  return holdings;
}

function HoldingsCarousel({ solPrice }: { solPrice: number | null }) {
  const { navigate } = useClientNav();
  const holdings = useUserHoldings();
  const [pausedBy, setPausedBy] = useState(0);
  const pauseCarousel = useCallback(() => setPausedBy((n) => n + 1), []);
  const unpauseCarousel = useCallback(() => setPausedBy((n) => Math.max(0, n - 1)), []);

  const mintsKey = holdings.map((h) => h.mint).join(",");
  const mints = useMemo(() => holdings.map((h) => h.mint), [mintsKey]);
  const liveMap = useLiveTradePrices(mints);

  useEffect(() => {
    if (holdings.length === 0) return;
    queueBatchEnrich(
      holdings.map((h) => h.mint).slice(0, 24),
      (data) => {
        for (const [mint, row] of Object.entries(data)) {
          const vol =
            typeof row.total_sol_volume === "number"
              ? row.total_sol_volume
              : typeof row.volume_24h === "number"
              ? row.volume_24h
              : undefined;
          const meta: HoldingMeta = holdingMetaCache.get(mint) ?? {};
          if (vol != null && solPrice != null && solPrice > 0) {
            meta.volumeUsd = vol * solPrice;
          }
          if (typeof row.holders === "number") meta.holders = row.holders;
          if (row.name) meta.name = row.name;
          holdingMetaCache.set(mint, meta);
        }
      },
    );
  }, [holdings, solPrice]);

  // Measure the rendered segment vs the available track width so we can
  // duplicate enough copies that the marquee never shows an empty stretch
  // when the user only holds a few positions.
  const maskRef = useRef<HTMLDivElement | null>(null);
  const segmentRef = useRef<HTMLSpanElement | null>(null);
  const [copiesPerHalf, setCopiesPerHalf] = useState(1);

  useEffect(() => {
    if (!maskRef.current || !segmentRef.current) return;
    const measure = () => {
      const cw = maskRef.current?.clientWidth ?? 0;
      const sw = segmentRef.current?.scrollWidth ?? 0;
      if (cw <= 0 || sw <= 0) return;
      // One segment must cover the visible mask so the -50% loop is seamless.
      const needed = Math.max(1, Math.ceil(cw / sw));
      setCopiesPerHalf((prev) => (prev === needed ? prev : needed));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(maskRef.current);
    ro.observe(segmentRef.current);
    return () => ro.disconnect();
  }, [holdings.length]);

  if (holdings.length === 0) return null;

  const totalCopies = copiesPerHalf * 2;
  // Scale animation so px/sec stays roughly constant regardless of how many
  // copies we packed in.
  const baseSec = Math.max(18, holdings.length * 4);
  const durationSec = baseSec * copiesPerHalf;

  return (
    <Tooltip content={`${holdings.length} active position${holdings.length === 1 ? "" : "s"}`} placement="top">
    <div
      ref={maskRef}
      className="marquee-mask"
      style={{
        // Fill the parent slot — StatusFooter reserves all free row space
        // between the native prices and the right-side stats for this carousel.
        flex: 1,
        width: "100%",
        minWidth: 0,
        height: "100%",
        display: "flex",
        alignItems: "center",
      }}
    >
      <div className="marquee-track" style={{ animationDuration: `${durationSec}s`, animationPlayState: pausedBy > 0 ? "paused" : "running" }}>
        {Array.from({ length: totalCopies }, (_, copyIdx) => (
          <span
            key={copyIdx}
            ref={copyIdx === 0 ? segmentRef : null}
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            {holdings.map((h) => (
              <HoldingItem
                key={`${copyIdx}-${h.mint}`}
                holding={h}
                live={liveMap.get(h.mint)}
                solPrice={solPrice}
                onClick={() => navigate(tokenHref(h.mint))}
                onPopupOpen={pauseCarousel}
                onPopupClose={unpauseCarousel}
              />
            ))}
          </span>
        ))}
      </div>
    </div>
    </Tooltip>
  );
}

interface HoldingMeta {
  marketCap?: number;
  priceChange?: number;
  volumeUsd?: number;
  holders?: number;
  name?: string;
}

const holdingMetaCache = new Map<string, HoldingMeta>();
// Keyed by address, and one 0x address can be a token on several EVM chains.
if (typeof window !== "undefined") {
  window.addEventListener(CHAIN_CHANGED_EVENT, () => holdingMetaCache.clear());
}

function loadHoldingMeta(mint: string, _solPrice: number | null): Promise<HoldingMeta> {
  const cached = holdingMetaCache.get(mint);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    queueBatchEnrich([mint], (data) => {
      const row = data[mint];
      const meta: HoldingMeta = holdingMetaCache.get(mint) ?? {};
      if (row) {
        const vol =
          typeof row.total_sol_volume === "number"
            ? row.total_sol_volume
            : typeof row.volume_24h === "number"
            ? row.volume_24h
            : undefined;
        if (vol != null && _solPrice != null && _solPrice > 0) {
          meta.volumeUsd = vol * _solPrice;
        }
        if (typeof row.holders === "number") meta.holders = row.holders;
        if (row.name) meta.name = row.name;
        holdingMetaCache.set(mint, meta);
      }
      resolve(meta);
    });
  });
}

function HoldingItem({
  holding: h,
  live,
  solPrice,
  onClick,
  onPopupOpen,
  onPopupClose,
}: {
  holding: TokenHolding;
  live: LivePrice | undefined;
  solPrice: number | null;
  onClick: () => void;
  onPopupOpen?: () => void;
  onPopupClose?: () => void;
}) {
  const [meta, setMeta] = useState<HoldingMeta | undefined>(() =>
    holdingMetaCache.get(h.mint),
  );
  const [chartOpen, setChartOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const livePrice = live?.price ?? 0;
  const liveUsdPerToken =
    livePrice > 0 && solPrice && solPrice > 0 ? livePrice * solPrice : 0;
  const liveUsdValue =
    liveUsdPerToken > 0 ? liveUsdPerToken * h.amount : h.usdValue ?? 0;

  const flashColor =
    live?.flash === "up"
      ? "var(--buy)"
      : live?.flash === "down"
      ? "var(--sell)"
      : "var(--paper-4)";

  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (chartOpen) {
      onPopupOpen?.();
      return () => onPopupClose?.();
    }
  }, [chartOpen, onPopupOpen, onPopupClose]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setChartOpen(false), 120);
  }, [cancelClose]);

  const onMouseEnter = useCallback(() => {
    void loadHoldingMeta(h.mint, solPrice).then(setMeta).catch(() => {});
    cancelClose();
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => setChartOpen(true), 200);
  }, [h.mint, solPrice, cancelClose]);

  const onMouseLeave = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    scheduleClose();
  }, [scheduleClose]);

  const chartToken = useMemo<TokenEvent>(() => ({
    mint_address: h.mint,
    name: h.name ?? meta?.name ?? "",
    symbol: h.symbol ?? "",
    dex: "",
    created_at: "",
    image: h.image ?? undefined,
    marketCap: meta?.marketCap,
    priceChange: meta?.priceChange,
    volume24h: meta?.volumeUsd,
    holders: meta?.holders,
  }), [h.mint, h.name, h.symbol, h.image, meta]);

  return (
    <>
      <button
        ref={anchorRef}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "0 12px",
          height: 26,
          background: "transparent",
          border: 0,
          color: "var(--paper-3)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.05em",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <TokenIcon
          token={{ mint_address: h.mint, symbol: h.symbol, image: h.image }}
          size={12}
        />
        <span style={{ color: "var(--paper-2)" }}>
          {h.symbol || h.mint.slice(0, 4)}
        </span>
        {liveUsdValue > 0 && (
          <span style={{ color: flashColor, transition: "color 400ms" }}>
            {fmtUsd(liveUsdValue)}
          </span>
        )}
      </button>
      {chartOpen && (
        <TokenChartPopup
          anchorRef={anchorRef}
          token={chartToken}
          live={live}
          solPrice={solPrice ?? undefined}
          holdingAmount={h.amount}
          holdingUsd={liveUsdValue > 0 ? liveUsdValue : undefined}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      )}
    </>
  );
}

function useFps(sampleWindowMs = 750) {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let rafId = 0;
    let frames = 0;
    let windowStart = 0;
    let previousTs = 0;

    const tick = (ts: number) => {
      if (document.hidden) {
        frames = 0;
        windowStart = ts;
        previousTs = ts;
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (windowStart === 0) {
        windowStart = ts;
        previousTs = ts;
      }

      const frameDelta = ts - previousTs;
      previousTs = ts;

      // Ignore long stalls from tab switching / throttling so the readout
      // tracks current rendering cadence instead of one bad paused frame.
      if (frameDelta < 250) {
        frames += 1;
      }

      const elapsed = ts - windowStart;
      if (elapsed >= sampleWindowMs) {
        const next = Math.round((frames * 1000) / elapsed);
        setFps((prev) => (prev === next ? prev : next));
        frames = 0;
        windowStart = ts;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [sampleWindowMs]);

  return fps;
}
