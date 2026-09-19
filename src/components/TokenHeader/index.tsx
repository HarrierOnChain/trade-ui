"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchPublicMetadata, type MetaResult } from "../../api/metadata";
import { useApp } from "../../contexts/AppContext";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useTokenQuote } from "../../hooks/useTokenQuote";
import { useLiveTradePrices, type LivePrice } from "../../hooks/useLiveTradePrices";
import { useSolPrice } from "../../hooks/useSolPrice";
import { useDexPaid } from "../../hooks/useDexPaid";
import { useTokenViews } from "../../hooks/useTokenViews";
import { useCreatorMigrations } from "../../hooks/useCreatorMigrations";
import { useMigration } from "../../hooks/useMigration";
import { DexPaidCelebration } from "./DexPaidCelebration";
import { MigrationCelebration } from "./MigrationCelebration";
import type { ReserveSidePanel } from "./CelebrationOverlay";
import { Icon, Pill, SolAmount, SolSymbol, TokenAvatarFrame, TokenIdentity, TokenSocialLinks, Tooltip } from "../atoms";
import { MayhemCountdown } from "../atoms/MayhemCountdown";
import { dexColor, dexLabel, fmtMcap, fmtNum, fmtPrice, fmtSol, mergeDexLabel, tokenVolumeUsd } from "../../lib/format";
import { computeTokenMetrics } from "../../lib/tokenMetrics";
import { formatAge } from "../../lib/ageRegistry";
import { clampWidth } from "../../lib/responsive";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { dexscreenerSlug, getActiveChain } from "../../lib/chains";
import type { TokenEvent } from "../../types";

interface Props {
  mint: string;
  top10Pct?: number;
  /** Chain-native USD price (SOL). Falls back to the SOL price hook
   *  when omitted so callers keep working unchanged. */
  solPrice?: number;
  /** On-chain total supply for the active chain. Falls back to the pump.fun
   *  1e9 default when omitted/unloaded. */
  supply?: number;
  /** Keep migration / DEX-paid overlays off the trading side panel. */
  celebrationReserveSidePanel?: ReserveSidePanel;
  /** "Clone token" DNA action. On by default; the /deploy preview turns it off
   *  (cloning the placeholder token you're creating makes no sense). */
  showClone?: boolean;
}

export function TokenHeader({
  mint,
  top10Pct,
  solPrice: solPriceProp,
  supply: supplyProp,
  celebrationReserveSidePanel,
  showClone = true,
}: Props) {
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  const { info } = useTokenInfo(mint);
  const quote = useTokenQuote(mint);
  const solPriceHook = useSolPrice();
  // Prefer the native USD price passed by the token page; fall back to the
  // SOL price hook for any caller that omits it.
  const solPrice = solPriceProp != null && solPriceProp > 0 ? solPriceProp : solPriceHook;
  const effectiveSupply = supplyProp != null && supplyProp > 0 ? supplyProp : 1_000_000_000;
  const mintList = useMemo(() => (mint ? [mint] : []), [mint]);
  const liveMap = useLiveTradePrices(mintList);
  const live = liveMap.get(mint);
  const [metaFallback, setMetaFallback] = useState<MetaResult | null>(null);
  // `liveFlipAt` stamps only on a WS-delivered transition into paid, so
  // opening a page on an already-paid token never triggers the overlay.
  const { dexPaid, dexscreenerUrl, liveFlipAt } = useDexPaid(mint);
  // Live "views": Raze streaming listeners subscribed to this mint. Null until
  // the first signal arrives.
  const views = useTokenViews(mint);

  const token = (info ?? {}) as TokenEvent;
  const quotePlatform = quote?.platform?.trim() || "";
  const isPumpswap = quotePlatform.toLowerCase() === "pumpswap";
  const isMigrated = isPumpswap || token.migrated_at != null;
  // Live migration trigger. `isMigrated` (from REST + quote) is the baseline,
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
  // The quote platform (pumpfun/pumpswap) is the trade venue, not the launchpad.
  // `mergeDexLabel` keeps a pump-family launchpad (Mayhem) from being relabeled
  // to it — even on a pumpswap (migrated) quote; migration is still surfaced via
  // `isMigrated`. Any non-launchpad history dex still upgrades to the quote venue.
  const platformSource = mergeDexLabel(token.dex, quotePlatform);
  const dexText = (platformSource ? dexLabel(platformSource) : "").toUpperCase();
  const age = token.created_at ? formatAge(new Date(token.created_at).getTime()) : "–";

  // Effective real-time price/mcap: live WS price → REST lastPrice → dev buy price
  const priceSol = live?.price ?? token.lastPrice ?? token.creatorBuyPrice ?? 0;
  const effectivePrice = priceSol;
  // Treat a 0/undefined server marketCap as absent and derive from
  // price × supply × native USD instead.
  const serverMcap = token.marketCap && token.marketCap > 0 ? token.marketCap : undefined;
  const effectiveMcap =
    serverMcap ??
    (priceSol > 0 && solPrice ? priceSol * effectiveSupply * solPrice : undefined) ??
    (token.initialMarketCap && token.initialMarketCap > 0 ? token.initialMarketCap : undefined);

  // Tab title mirrors the live header — "COBIE ↑ $30.1K | Raze Terminal" — so a
  // backgrounded tab shows which token is open, its live market cap, and the
  // direction of the last price tick (↑/↓), Axiom-style.
  useEffect(() => {
    if (symbolText === "—") return;
    const arrow = live?.flash === "up" ? " ↑" : live?.flash === "down" ? " ↓" : "";
    document.title = effectiveMcap
      ? `${symbolText}${arrow} ${fmtMcap(effectiveMcap)} | Raze Terminal`
      : `${symbolText} | Raze Terminal`;
  }, [symbolText, effectiveMcap, live?.flash]);
  useEffect(() => () => { document.title = "Raze Terminal"; }, []);

  // DexScreener URL slug ("sol" → "solana").
  const dexscreenerChainSlug = dexscreenerSlug(getActiveChain());

  return (
    <div>
      {liveFlipAt != null && (
        <DexPaidCelebration
          triggerAt={liveFlipAt}
          symbol={symbolText}
          name={nameText}
          image={displayImage}
          dexscreenerUrl={dexscreenerUrl}
          reserveSidePanel={celebrationReserveSidePanel}
        />
      )}
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
            marketCap={effectiveMcap}
            initialMarketCap={token.initialMarketCap}
            priceSol={priceSol}
            solPrice={solPrice}
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
              showClone={showClone}
            />
            {(token as { hot?: boolean }).hot && !isPhone && (
              <Pill tone="green" size="xs">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <SolSymbol size={10} />
                  HOT
                </span>
              </Pill>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {age !== "–" && (
              <Tooltip content="Token age">
                <span className="mono" style={{
                  fontSize: 11, color: "var(--paper-3)", fontWeight: 600, whiteSpace: "nowrap",
                }}>{age}</span>
              </Tooltip>
            )}
            {/* Fixed Axiom order: launchpad · cashback · X · telegram · website ·
                X-search (cashback slotted right after the launchpad inside
                TokenSocialLinks), then token views, then Raze-specific extras. */}
            <TokenSocialLinks
              twitter={displayTwitter}
              telegram={displayTelegram}
              website={displayWebsite}
              mint={mint}
              launchpad={token.dex || platformSource}
              showLaunchpad
              showXSearch
              cashbackSlot={token.hasCashback ? (
                <Tooltip content="Cashback enabled — bonding-curve creator fee sharing">
                  <span style={{
                    display: "inline-flex", alignItems: "center",
                    color: "#FACC15", cursor: "default", lineHeight: 0,
                  }}>{Icon.refund(15)}</span>
                </Tooltip>
              ) : undefined}
              iconSize={15}
              gap={7}
            />
            {views?.total != null && (
              <span
                title="Live viewers on Raze"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 3,
                  color: "var(--info)", cursor: "default",
                  fontSize: 11, fontWeight: 600, lineHeight: 1,
                }}
              >
                {Icon.eyeLine(13)}
                {fmtNum(views.total)}
              </span>
            )}
            {token.signer && (token.creatorMigrations ?? 0) > 0 && (
              <Tooltip
                interactive
                placement="bottom"
                content={<DevMigrationsPopup signer={token.signer} count={token.creatorMigrations ?? 0} />}
              >
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 3,
                  color: "#FACC15", cursor: "default",
                  fontSize: 11, fontWeight: 700, lineHeight: 1,
                }}>
                  {Icon.vipCrown2(13)}
                  {token.creatorMigrations}
                </span>
              </Tooltip>
            )}
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
            age={age}
            solPrice={solPrice}
            supply={effectiveSupply}
            live={live}
            top10Pct={top10Pct}
            migrated={isMigrated}
            dexPaid={dexPaid}
            showDexscreener
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

// ATH mcap is computed server-side as peak SOL price × 1e9 supply × solPrice —
// exact for standard SOL-quoted 1e9-supply tokens (pump.fun/pumpswap, the bulk
// of migrations). Non-standard quote decimals (some MeteoraDBC/USDC pairs) skew
// the stored price scale and inflate the figure, so we only surface a value in a
// plausible range and fall back to "—" otherwise rather than show a bogus mcap.
function athMcapOk(v?: number): boolean {
  return typeof v === "number" && v > 0 && v < 1_000_000_000;
}

/** Hover list for the dev-migration crown — the creator's migrated tokens and
 *  the peak (ATH) market cap each reached. Fetches lazily on open. */
function DevMigrationsPopup({ signer, count }: { signer: string; count: number }) {
  const { data, loading } = useCreatorMigrations(signer, true);
  const rows = data ?? [];
  return (
    <div style={{ minWidth: 210, maxWidth: 300 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 5, marginBottom: 6,
        color: "#FACC15", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase",
      }}>
        {Icon.vipCrown2(12)}
        {count} dev migration{count === 1 ? "" : "s"}
      </div>
      {loading && rows.length === 0 ? (
        <div style={{ color: "var(--paper-4)", fontSize: 11 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "var(--paper-4)", fontSize: 11 }}>No migration history</div>
      ) : (
        <div style={{
          display: "grid", gridTemplateColumns: "1fr auto",
          columnGap: 14, rowGap: 5, maxHeight: 240, overflowY: "auto",
        }}>
          <span style={{ color: "var(--paper-4)", fontSize: 9 }}>TOKEN</span>
          <span style={{ color: "var(--paper-4)", fontSize: 9, textAlign: "right" }}>ATH MCAP</span>
          {rows.map((m) => (
            <React.Fragment key={m.mint}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--paper-2)", fontWeight: 600 }}>{m.symbol || "—"}</span>
                {m.migratedAt && (
                  <span style={{ color: "var(--paper-4)", marginLeft: 6 }}>
                    {formatAge(new Date(m.migratedAt).getTime())}
                  </span>
                )}
              </span>
              <span style={{
                textAlign: "right", fontWeight: 600,
                color: athMcapOk(m.athMcap) ? "var(--accent)" : "var(--paper-4)",
              }}>
                {athMcapOk(m.athMcap) ? fmtMcap(m.athMcap!) : "—"}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function StatsStrip({
  token,
  age,
  solPrice,
  supply,
  live,
  top10Pct,
  migrated,
  dexPaid,
  showDexscreener,
}: {
  token: TokenEvent;
  age: string;
  solPrice: number | null | undefined;
  supply: number;
  live?: LivePrice;
  top10Pct?: number;
  migrated: boolean;
  dexPaid?: boolean | undefined;
  showDexscreener: boolean;
}) {
  const { openWalletModal } = useApp();
  const fmtDevBuy = (v: number) => fmtSol(v);
  const vol24USD = tokenVolumeUsd(token, solPrice, live?.volumeSol ?? 0);

  const feesSol =
    (token.feesTotal ?? 0) + (live?.feesSol ?? 0);
  const tradeCount =
    (token.tradeCount ?? 0) + (live?.tradeCount ?? 0);

  const { bundlePct, sniperPct, holders } = computeTokenMetrics(token, live, { top10Pct });

  // Fall back to dev-buy-derived market cap (creatorBuyPrice × 1B supply × solPrice)
  // when the server hasn't surfaced initialMarketCap yet.
  const initialMc =
    token.initialMarketCap ??
    (token.creatorBuyPrice && solPrice
      ? token.creatorBuyPrice * supply * solPrice
      : undefined);
  const top10Value = top10Pct ?? 0;
  const devBuySol = token.creatorBuySol ?? 0;
  const initialMcValue = initialMc && initialMc > 0 ? initialMc : 1;

  const items: Array<{ label: string; val: React.ReactNode; tone?: "warn" | "green"; accent?: string }> = [
    { label: "VOL 24H",    val: `$${fmtNum(vol24USD ?? 0)}`, accent: "var(--info)" },
    { label: "FEES",       val: <SolAmount>{fmtSol(feesSol)}</SolAmount>, accent: "var(--paper-4)" },
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
      label: "D BUY",
      val: token.signer
          ? (
              <Tooltip content={`Open dev wallet ${token.signer}`} mono>
                <button
                  type="button"
                  onClick={() => openWalletModal(token.signer!)}
                  style={{
                    color: "inherit",
                    textDecoration: "underline dotted",
                    textUnderlineOffset: 3,
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    font: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <SolAmount>{fmtDevBuy(devBuySol)}</SolAmount>
                </button>
              </Tooltip>
            )
          : <SolAmount>{fmtDevBuy(devBuySol)}</SolAmount>,
      tone: "green",
    },
    { label: "INIT MC",  val: fmtMcap(initialMcValue) },
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
