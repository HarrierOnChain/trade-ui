"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchPublicMetadata, type MetaResult } from "../../api/metadata";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useLiveTradePrices, type LivePrice } from "../../hooks/useLiveTradePrices";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useMigration } from "../../hooks/useMigration";
import { MigrationCelebration } from "./MigrationCelebration";
import type { ReserveSidePanel } from "./CelebrationOverlay";
import { SolAmount, TokenAvatarFrame, TokenIdentity, TokenSocialLinks, Tooltip } from "../atoms";
import { MayhemCountdown } from "../atoms/MayhemCountdown";
import { fmtMcap, fmtNum, fmtPrice, fmtSol, tokenVolumeUsd } from "../../lib/format";
import { computeTokenMetrics } from "../../lib/tokenMetrics";
import { formatAge } from "../../lib/ageRegistry";
import { clampWidth } from "../../lib/responsive";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { dexscreenerSlug, getActiveChain } from "../../lib/chains";
import type { TokenEvent } from "../../types";

interface Props {
  mint: string;
  top10Pct?: number;
  /** Chain-native USD price (SOL). Falls back to the SOL price hook
   *  when omitted so callers keep working unchanged. */
  solPrice?: number;
  /** The token's supply. Not read: the market cap shown is the API's. */
  supply?: number;
  /** Keep the migration overlay off the trading side panel. */
  celebrationReserveSidePanel?: ReserveSidePanel;
}

export function TokenHeader({
  mint,
  top10Pct,
  solPrice: solPriceProp,
  celebrationReserveSidePanel,
}: Props) {
  const isMobile = useIsMobile();
  const { info } = useTokenInfo(mint);
  const solPriceHook = useSolPrice();
  // Prefer the native USD price passed by the token page; fall back to the
  // SOL price hook for any caller that omits it.
  const solPrice = solPriceProp != null && solPriceProp > 0 ? solPriceProp : solPriceHook;
  const mintList = useMemo(() => (mint ? [mint] : []), [mint]);
  const liveMap = useLiveTradePrices(mintList);
  const live = liveMap.get(mint);
  const [metaFallback, setMetaFallback] = useState<MetaResult | null>(null);

  const token = (info ?? {}) as TokenEvent;
  const isMigrated = token.graduated === true || token.migrated_at != null;
  // Live migration trigger. `isMigrated` (from REST) is the baseline,
  // so opening a page on an already-migrated token never fires the overlay;
  // a WS migration event for the active mint will fire it exactly once.
  const migrationLive = useMigration(mint, isMigrated);
  useEffect(() => {
    let cancelled = false;

    setMetaFallback(null);

    const missingIdentity = !token.symbol?.trim() || !token.name?.trim();
    const missingDecor =
      !token.image ||
      !token.twitter?.trim() ||
      !token.telegram?.trim() ||
      !token.website?.trim();

    if (!mint || (!missingIdentity && !missingDecor)) return;

    void fetchPublicMetadata(mint).then((meta) => {
      if (cancelled) return;
      if (
        !meta.name &&
        !meta.symbol &&
        !meta.image &&
        !meta.twitter &&
        !meta.telegram &&
        !meta.website
      ) {
        return;
      }
      setMetaFallback(meta);
    });

    return () => {
      cancelled = true;
    };
  }, [
    mint,
    token.image,
    token.name,
    token.symbol,
    token.telegram,
    token.twitter,
    token.website,
  ]);

  const symbolText = token.symbol?.trim() || metaFallback?.symbol?.trim() || "—";
  const nameText = token.name?.trim() || metaFallback?.name?.trim() || "";
  const displayImage = token.image || metaFallback?.image;
  const displayTwitter = token.twitter?.trim() || metaFallback?.twitter?.trim() || "";
  const displayTelegram = token.telegram?.trim() || metaFallback?.telegram?.trim() || "";
  const displayWebsite = token.website?.trim() || metaFallback?.website?.trim() || "";
  // The launchpad the API names (a graduated or never-launched token: its
  // main pool's venue).
  const platformSource = token.dex;
  const age = token.created_at ? formatAge(new Date(token.created_at).getTime()) : "–";

  // Effective real-time price/mcap: live WS price → REST lastPrice
  const priceSol = live?.price ?? token.lastPrice ?? 0;
  const effectivePrice = priceSol;
  // The API's market cap, kept live by the token channel's ticks; null when
  // the supply or the price is not known.
  const effectiveMcap = token.marketCap;

  // Tab title mirrors the live header — "COBIE ↑ $30.1K | Trade UI" — so a
  // backgrounded tab shows which token is open, its live market cap, and the
  // direction of the last price tick (↑/↓), Axiom-style.
  useEffect(() => {
    if (symbolText === "—") return;
    const arrow = live?.flash === "up" ? " ↑" : live?.flash === "down" ? " ↓" : "";
    document.title = effectiveMcap
      ? `${symbolText}${arrow} ${fmtMcap(effectiveMcap)} | Trade UI`
      : `${symbolText} | Trade UI`;
  }, [symbolText, effectiveMcap, live?.flash]);
  useEffect(() => () => { document.title = "Trade UI"; }, []);

  // DexScreener URL slug ("sol" → "solana").
  const dexscreenerChainSlug = dexscreenerSlug(getActiveChain());

  return (
    <div>
      {migrationLive.liveMigratedAt != null && (
        <MigrationCelebration
          triggerAt={migrationLive.liveMigratedAt}
          symbol={symbolText}
          name={nameText}
          image={displayImage}
          poolDex={migrationLive.poolDex}
          chainSlug={dexscreenerChainSlug}
          mint={mint}
          reserveSidePanel={celebrationReserveSidePanel}
        />
      )}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 14px 12px",
        background: "var(--ink-1)",
        borderBottom: "1px solid var(--line-soft)",
        overflow: "hidden",
      }}>
        <div style={{ position: "relative", flexShrink: 0, lineHeight: 0 }}>
          <TokenAvatarFrame
            mint={mint}
            symbol={symbolText}
            image={displayImage}
            chain={token.chain}
            dex={platformSource || token.dex}
            migrated={isMigrated}
            size={52}
            borderWidth={2}
            badgeSize={20}
            badgeInset={-5}
            progressPercent={token.graduationPercent}
          />
        </div>
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: isMobile ? `0 1 ${clampWidth(140, 40, 260)}` : "0 1 260px",
          width: isMobile ? clampWidth(140, 40, 260) : 260,
          minWidth: isMobile ? 120 : 180,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 8 }}>
            <TokenIdentity
              mint={mint}
              symbol={symbolText}
              name={nameText}
              image={displayImage}
              compact
              size="md"
              showWatch
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {age !== "–" && (
              <Tooltip content="Token age">
                <span className="mono" style={{
                  fontSize: 11, color: "var(--paper-3)", fontWeight: 600, whiteSpace: "nowrap",
                }}>{age}</span>
              </Tooltip>
            )}
            {/* Fixed Axiom order: launchpad · X · telegram · website · X-search,
                then Raze-specific extras. */}
            <TokenSocialLinks
              twitter={displayTwitter}
              telegram={displayTelegram}
              website={displayWebsite}
              mint={mint}
              launchpad={token.dex || platformSource}
              showLaunchpad
              showXSearch
              iconSize={15}
              gap={7}
            />
            {token.dex?.toLowerCase().includes("mayhem") && (
              <MayhemCountdown createdAt={token.created_at} />
            )}
            {token.quoteKind === "USDC" && (
              <Tooltip content="USDC-quoted pair — traded against USDC, not SOL">
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                  color: "#2775CA", border: "1px solid #2775CA55",
                  background: "#2775CA14", borderRadius: 3, padding: "1px 5px",
                  textTransform: "uppercase",
                }}>USDC</span>
              </Tooltip>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-end" }}>
          <StatsStrip
            token={token}
            solPrice={solPrice}
            live={live}
            top10Pct={top10Pct}
            migrated={isMigrated}
          />
        </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexShrink: 0,
          paddingLeft: 12,
          borderLeft: "1px solid var(--line-soft)",
        }}>
          {effectivePrice > 0 && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span className="mono" style={{ fontSize: 13, color: "var(--paper-2)" }}>
                {solPrice && effectivePrice * solPrice > 0
                  ? fmtPrice(effectivePrice * solPrice)
                  : <SolAmount iconSize={10}>{fmtSol(effectivePrice, 6)}</SolAmount>}
              </span>
              <span className="eyebrow" style={{ color: "var(--paper-3)" }}>PRICE</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              key={live?.ts ?? 0}
              className="mono"
              style={{
                fontSize: 22, fontWeight: 500, letterSpacing: 0,
                color:
                  live?.flash === "up" ? "var(--buy)" :
                  live?.flash === "down" ? "var(--sell)" :
                  undefined,
                animation: live?.flash ? "flashPrice 700ms ease-out" : undefined,
              }}
            >
              {effectiveMcap ? fmtMcap(effectiveMcap) : "–"}
            </span>
            <span className="eyebrow" style={{ color: "var(--paper-3)" }}>MARKET CAP</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsStrip({
  token,
  solPrice,
  live,
  top10Pct,
  migrated,
}: {
  token: TokenEvent;
  solPrice: number | null | undefined;
  live?: LivePrice;
  top10Pct?: number;
  migrated: boolean;
}) {
  // The API's 24h figures, kept current by the token channel's snapshots.
  const vol24USD = tokenVolumeUsd(token, solPrice);
  const tradeCount = token.tradeCount ?? 0;

  const { bundlePct, sniperPct, holders } = computeTokenMetrics(token, { top10Pct });

  const top10Value = top10Pct ?? 0;

  const items: StatItem[] = [
    { label: "VOL 24H",    val: `$${fmtNum(vol24USD ?? 0)}`, accent: "var(--info)" },
    { label: "TRADES",     val: fmtNum(tradeCount), accent: "var(--paper-3)" },
    { label: "HOLDERS",    val: fmtNum(holders), accent: "var(--accent)" },
    {
      label: "BUNDLE",
      val: `${bundlePct.toFixed(1)}%`,
      tone: bundlePct > 10 ? "warn" : undefined,
      accent: "var(--sell)",
    },
    {
      label: "SNIPERS",
      val: `${sniperPct.toFixed(1)}%`,
      tone: sniperPct > 8 ? "warn" : undefined,
      accent: "var(--warn)",
    },
    {
      label: "TOP 10",
      val: `${top10Value.toFixed(1)}%`,
      tone: top10Value > 50 ? "warn" : undefined,
      accent: top10Value > 30 ? "var(--warn)" : "var(--paper-4)",
    },
    {
      label: "MIGRATED",
      val: migrated ? "YES" : "NO",
      tone: migrated ? "green" : undefined,
      accent: migrated ? undefined : "var(--paper-4)",
    },
  ];

  return <StatsCarousel items={items} />;
}

type StatItem = {
  label: string;
  val: React.ReactNode;
  tone?: "warn" | "green";
  accent?: string;
};

function StatsCarousel({ items }: { items: StatItem[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollHints = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 1);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  const scrollBy = useCallback((delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  useEffect(() => {
    updateScrollHints();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollHints, { passive: true });
    const ro = new ResizeObserver(updateScrollHints);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollHints);
      ro.disconnect();
    };
  }, [updateScrollHints, items]);

  return (
    <div style={{
      position: "relative",
      display: "flex",
      alignItems: "stretch",
      minWidth: 0,
      // Size to content and hug the right edge (next to the PRICE/MCAP block),
      // shrinking + scrolling internally when the row is too narrow to fit.
      flex: "0 1 auto",
      maxWidth: "100%",
      alignSelf: "stretch",
      borderLeft: "1px solid var(--line-soft)",
    }}>
      <style>{`.token-stats-scroll::-webkit-scrollbar{display:none}`}</style>
      {canScrollLeft && (
        <StatsScrollHint side="left" onClick={() => scrollBy(-120)} />
      )}
      <div
        ref={scrollerRef}
        className="token-stats-scroll"
        style={{
          display: "flex",
          alignItems: "stretch",
          overflowX: "auto",
          overflowY: "hidden",
          minWidth: 0,
          flex: "0 1 auto",
          scrollSnapType: "x proximity",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {items.map((s, i) => (
          <div
            key={s.label}
            style={{
              display: "flex",
              alignItems: "stretch",
              flexShrink: 0,
              scrollSnapAlign: "start",
            }}
          >
            {i > 0 && (
              <div style={{ width: 1, alignSelf: "stretch", background: "var(--line-soft)", flexShrink: 0 }} />
            )}
            <div style={{
              padding: "5px 10px",
              minWidth: 72,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 2,
            }}>
              <span className="mono" style={{
                fontSize: 7, fontWeight: 700, letterSpacing: "0.08em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                lineHeight: 1,
                color:
                  s.tone === "warn"  ? "var(--warn)"  :
                  s.tone === "green" ? "var(--accent)" :
                  s.accent           ? s.accent        :
                                       "var(--paper-4)",
              }}>{s.label}</span>
              <span className="mono" style={{
                fontSize: 14, fontWeight: 600,
                whiteSpace: "nowrap",
                lineHeight: 1.05,
                letterSpacing: "-0.01em",
                color:
                  s.tone === "warn"  ? "var(--warn)"  :
                  s.tone === "green" ? "var(--accent)" :
                                       "var(--paper)",
              }}>{s.val}</span>
            </div>
          </div>
        ))}
      </div>
      {canScrollRight && (
        <StatsScrollHint side="right" onClick={() => scrollBy(120)} />
      )}
    </div>
  );
}

function StatsScrollHint({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const isLeft = side === "left";
  return (
    <button
      type="button"
      aria-label={isLeft ? "Scroll stats left" : "Scroll stats right"}
      onClick={onClick}
      style={{
        position: "absolute",
        [isLeft ? "left" : "right"]: 0,
        top: 0,
        bottom: 0,
        width: 24,
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        background: isLeft
          ? "linear-gradient(to left, transparent, var(--ink-1) 65%)"
          : "linear-gradient(to right, transparent, var(--ink-1) 65%)",
        border: 0,
        cursor: "pointer",
        color: "var(--paper-3)",
        fontSize: 15,
        lineHeight: 1,
      }}
    >
      {isLeft ? "‹" : "›"}
    </button>
  );
}
