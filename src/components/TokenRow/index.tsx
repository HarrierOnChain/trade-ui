"use client";
import React, { memo, useEffect, useRef, useState } from "react";
import { TokenAvatarFrame, Sparkline, Change, TokenSocialLinks, Icon, SolAmount, QuoteAmount, Tooltip, MayhemCountdown, ChainIcon } from "../atoms";
import { useCloneToken } from "../../hooks/useCloneToken";
import { fmtMcap, fmtNum, fmtPrice, fmtSol, fmtUsd, shortAddr, tokenVolumeUsd } from "../../lib/format";
import { formatAge, registerAge, unregisterAge } from "../../lib/ageRegistry";
import { useLastSeen } from "../../contexts/LastSeenContext";
import { useApp } from "../../contexts/AppContext";
import { useHiddenTokens } from "../../lib/hiddenTokens";
import { fetchPublicMetadata } from "../../api/metadata";
import { streamSettledDelay } from "../../lib/wire/events";
import { useQuickBuy } from "../../hooks/useQuickBuy";
import { useQuickBuyAmount } from "../../hooks/useQuickBuyAmount";
import { useBuyQuoteMint } from "../../hooks/useBuyQuoteMint";
import { useRowImage } from "../../hooks/useRowImage";
import { useHiddenDevs } from "../../lib/hiddenDevs";
import { useCardStyle } from "../../contexts/CardStyleContext";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { getActiveChain, isChainId } from "../../lib/chains";
import type { TokenEvent } from "../../types";
import type { LivePrice } from "../../hooks/useLiveTradePrices";
import type { TokenXSignal } from "../../lib/xTrending";

export type TokenRowVariant = "deploy" | "migration" | "trending";

interface Props {
  t: TokenEvent;
  variant?: TokenRowVariant;
  live?: LivePrice;
  solPrice?: number;
  /** On-chain total supply. Rows omit it and keep the pump.fun 1e9 default;
   *  when passed, mcap = price × supply × nativeUSD uses it. */
  supply?: number;
  active?: boolean;
  showMigrated?: boolean;
  rank?: number;
  /** Monitor row index — staggers metadata fetches after stream subs. */
  rowIndex?: number;
  xSignal?: TokenXSignal;
  /** Per-column quick-buy scope — routes the hover ⚡ overlay to this column's
   *  own amount (see useQuickBuyAmount). Undefined = legacy global amount. */
  quickBuyScope?: string;
  onClick?: (mint: string) => void;
  onXSignalClick?: (token: TokenEvent) => void;
}

export const TokenRow = memo(function TokenRow({
  t,
  variant = "trending",
  live,
  solPrice,
  supply,
  active,
  showMigrated,
  rank,
  rowIndex = 0,
  xSignal,
  quickBuyScope,
  onClick,
  onXSignalClick,
}: Props) {
  const { openWalletModal } = useApp();
  const { showSparkline } = useCardStyle();
  const isPhone = useIsPhone();
  // On phones the row is in a single full-width column: drop the rank gutter
  // and the sparkline cell, and let the metric track shrink so the avatar +
  // identity keep room. Desktop is byte-identical.
  const showRank = rank != null && !isPhone;
  const sparklineCol = showSparkline && !isPhone;
  const fmtSolChip = (v: number, d = 2) => fmtSol(v, d);
  const rowImage = useRowImage(t.mint_address, t.image, rowIndex);
  const devBuyValue = t.creatorBuySol != null ? fmtSolChip(t.creatorBuySol) : null;
  // Always show the migrations/deploys ratio. Default deploys to 1 when
  // missing — this token's existence implies at least one deploy.
  const creatorRatio = `${t.creatorMigrations ?? 0}/${t.creatorDeploys ?? 1}`;
  const rowTs = new Date(
    (showMigrated ? t.migrated_at : undefined) ?? t.created_at ?? 0
  ).getTime();
  const hasSocials = Boolean(t.twitter || t.telegram || t.website);
  const hasXSignal = Boolean(xSignal && (xSignal.mentionCount24h > 0 || xSignal.kolCount24h > 0));
  // The creator ratio is always populated, so the dev row always renders
  // when this branch is reached. Keep the flag for symmetry with sibling
  // row guards.
  const hasDevRow = Boolean(devBuyValue) || Boolean(creatorRatio);

  // Bundle/sniper — merge REST baseline with the live WS delta and clamp to [0,100],
  // matching solana-frame's monitor behavior.
  const liveBundleAdd = live?.bundleAdd ?? 0;
  const liveSniperAdd = live?.sniperAdd ?? 0;
  const livePriceSol = live?.price ?? t.lastPrice ?? t.creatorBuyPrice;
  const bundle = Math.max(
    0,
    Math.min(100, Number(t.bundlePercentage ?? 0) + liveBundleAdd)
  );
  const sniper = Math.max(
    0,
    Math.min(100, Number(t.sniperPercentage ?? 0) + liveSniperAdd)
  );
  const change = t.priceChange;

  const { lastSeen } = useLastSeen();
  const seenAt = lastSeen[t.mint_address];

  const [hovered, setHovered] = useState(false);

  // Activity tiles — merge the 24h REST baseline with live WS deltas so the
  // numbers tick up as new trades stream in.
  const liveVolumeSol  = live?.volumeSol ?? 0;
  const liveFeesSol    = live?.feesSol ?? 0;
  const liveTradeCount = live?.tradeCount ?? 0;
  const liveTraders    = live?.uniqueTraders ?? 0;

  const effectiveVolumeUsd = tokenVolumeUsd(t, solPrice, liveVolumeSol);
  const effectiveFees    = (t.feesTotal      ?? 0) + liveFeesSol;
  const effectiveTrades  = (t.tradeCount     ?? 0) + liveTradeCount;
  // Holders: take max of known holder count vs live unique-signer count (live
  // signers may already be in the REST total; summing would double-count).
  const effectiveHolders = Math.max(
    t.holders ?? 0,
    t.uniqueTraders ?? 0,
    liveTraders,
  );

  const metricTiles: Array<{ label: string; value: string; live?: boolean; accent?: string; tone?: "warn" | "green" }> = [];
  if (effectiveVolumeUsd != null && effectiveVolumeUsd > 0) {
    metricTiles.push({
      label: "V",
      value: fmtUsd(effectiveVolumeUsd),
      live: liveVolumeSol > 0,
      accent: "var(--info)",
    });
  }
  if (effectiveFees > 0) {
    metricTiles.push({
      label: "F",
      value: fmtSolChip(effectiveFees, effectiveFees >= 1 ? 2 : 3),
      live: liveFeesSol > 0,
      accent: "var(--paper-4)",
    });
  }
  if (effectiveTrades > 0) {
    metricTiles.push({
      label: "TX",
      value: fmtNum(effectiveTrades),
      live: liveTradeCount > 0,
      accent: "var(--paper-3)",
    });
  }
  if (effectiveHolders > 0) {
    metricTiles.push({
      label: "H",
      value: fmtNum(effectiveHolders),
      live: liveTraders > 0 && liveTraders > (t.holders ?? 0) && liveTraders > (t.uniqueTraders ?? 0),
      accent: "var(--accent)",
    });
  }
  if (t.bundlePercentage != null || liveBundleAdd !== 0) {
    metricTiles.push({
      label: "B",
      value: `${bundle.toFixed(0)}%`,
      live: liveBundleAdd !== 0,
      accent: "var(--sell)",
      tone: bundle > 10 ? "warn" : undefined,
    });
  }
  if (t.sniperPercentage != null || liveSniperAdd !== 0) {
    metricTiles.push({
      label: "S",
      value: `${sniper.toFixed(0)}%`,
      live: liveSniperAdd !== 0,
      accent: "var(--warn)",
      tone: sniper > 8 ? "warn" : undefined,
    });
  }

  const priceDerivation = usePriceDerivation({ t, variant, live, solPrice, supply, change });
  const isMayhem = t.dex?.toLowerCase().includes("mayhem");
  const hasMeta = hasDevRow || hasSocials || hasXSignal || Boolean(t.hasCashback);
  const hasTimeRow =
    (Number.isFinite(rowTs) && rowTs > 0) || isMayhem;

  return (
    <div
      onClick={() => onClick?.(t.mint_address)}
      className={(t as TokenEvent & { isNew?: boolean }).isNew ? "new-in" : undefined}
      style={{
        position: "relative",
        display: "grid",
        // Metric track is a fixed 150px on desktop; on phones it becomes a
        // fluid minmax(80,150) so it can give space back to identity.
        gridTemplateColumns:
          showRank
            ? `22px auto minmax(0,1fr) 150px${sparklineCol ? " 68px" : ""}`
            : isPhone
              ? `auto minmax(0,1fr) minmax(80px,150px)`
              : `auto minmax(0,1fr) 150px${sparklineCol ? " 68px" : ""}`,
        alignItems: "stretch",
        gap: 12,
        padding: "7px 14px 8px 14px",
        borderBottom: "1px solid var(--line-soft)",
        borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        background: active ? "var(--accent-w)" : "transparent",
        cursor: "pointer",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--ink-2)";
        setHovered(true);
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
        setHovered(false);
      }}
    >
      {seenAt && (
        <span style={{ position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)", lineHeight: 1, pointerEvents: "none" }}>
          <SeenBadge tsMs={seenAt} />
        </span>
      )}
      {showRank && rank != null && (
        <div
          className="mono"
          style={{
            fontSize: 10, fontWeight: 600,
            color: rank <= 3 ? "var(--accent)" : "var(--paper-4)",
            letterSpacing: "0.08em",
            textAlign: "center",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {String(rank).padStart(2, "0")}
        </div>
      )}

      {/* ── Column 1 — avatar + identity + meta strip ────────────────── */}
      <div style={{
        position: "relative", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        alignSelf: "center",
      }}>
        <TokenAvatarFrame
          mint={t.mint_address}
          symbol={t.symbol}
          image={rowImage}
          chain={t.chain}
          dex={t.dex}
          migrated={t.migrated_at != null || t.graduated === true}
          size={54}
          borderWidth={1.5}
          badgeSize={18}
          badgeInset={-4}
          marketCap={t.marketCap}
          initialMarketCap={t.initialMarketCap}
          priceSol={livePriceSol}
          solPrice={solPrice}
          progressPercent={t.graduationPercent}
        />
        <AvatarHideOverlay token={t} rowImage={rowImage} />
      </div>

      <div style={{ minWidth: 0, width: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, paddingLeft: 6 }}>
        <TokenRowIdentity token={t} rowIndex={rowIndex} />

        {hasMeta && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            color: "var(--paper-4)", fontSize: 10,
          }}>
            {hasDevRow && (() => {
              const pill = (
                <DevCreatorPill devBuyValue={devBuyValue} creatorRatio={creatorRatio} />
              );
              if (t.signer) {
                return (
                  <Tooltip content={`Open dev wallet ${t.signer}`} mono>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openWalletModal(t.signer!);
                      }}
                      style={{ textDecoration: "none", background: "transparent", border: 0, padding: 0, cursor: "pointer" }}
                    >
                      {pill}
                    </button>
                  </Tooltip>
                );
              }
              return (
                <Tooltip content="Dev buy · creator migrations / deploys">
                  {pill}
                </Tooltip>
              );
            })()}
            {(hasSocials || t.mint_address || t.hasCashback) && (
              <TokenSocialLinks
                twitter={t.twitter}
                telegram={t.telegram}
                website={t.website}
                mint={t.mint_address}
                launchpad={t.dex}
                showLaunchpad
                showXSearch
                cashbackSlot={t.hasCashback ? (
                  <Tooltip content="Cashback enabled — bonding-curve creator fee sharing">
                    <span
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: "inline-flex", alignItems: "center",
                        color: "#FACC15", cursor: "default", lineHeight: 0,
                      }}
                    >{Icon.refund(12)}</span>
                  </Tooltip>
                ) : undefined}
                iconSize={12}
                gap={5}
                stopPropagation
              />
            )}
            {hasXSignal && xSignal && (
              <XSignalChip
                signal={xSignal}
                onClick={(e) => {
                  e.stopPropagation();
                  onXSignalClick?.(t);
                }}
              />
            )}
          </div>
        )}

        {hasTimeRow && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            minHeight: 14,
          }}>
            {Number.isFinite(rowTs) && rowTs > 0 && (
              <span onClick={(e) => e.stopPropagation()}>
                <RowAgeBadge tsMs={rowTs} />
              </span>
            )}
            {isMayhem && (
              <span onClick={(e) => e.stopPropagation()}>
                <MayhemCountdown createdAt={t.created_at} />
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Column 2 — mcap + change, then activity / risk tiles ─────── */}
      <RightMetrics
        priceDerivation={priceDerivation}
        activityTiles={metricTiles.filter(m => ["V","TX","H"].includes(m.label))}
        riskTiles={metricTiles.filter(m => ["F","B","S"].includes(m.label))}
      />

      {/* ── Column 3 — sparkline (dropped on phone; no grid track for it) ─ */}
      {sparklineCol && <ChartCell t={t} live={live} change={change} />}

      {hovered && <QuickBuyOverlay mint={t.mint_address} scope={quickBuyScope} />}
    </div>
  );
});

function XSignalChip({
  signal,
  onClick,
}: {
  signal: TokenXSignal;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const count = signal.mentionCount24h;
  const value = String(count);
  const tone = signal.hot || signal.kolCount24h > 1;

  return (
    <Tooltip
      placement="bottom"
      maxWidth={300}
      mono
      content={
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div>
            X · 15m {signal.mentionCount15m} · 1h {signal.mentionCount1h} · 24h {signal.mentionCount24h}
          </div>
          {signal.kolCount24h > 0 && <div>KOL hits · {signal.kolCount24h}</div>}
          {signal.officialUsername && <div>Official · @{signal.officialUsername}</div>}
          {signal.topTweet && (
            <div style={{ color: "var(--paper-2)" }}>
              @{signal.topTweet.username}: {signal.topTweet.text.slice(0, 120)}
            </div>
          )}
        </div>
      }
    >
      <button
        type="button"
        onClick={onClick}
        className="mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          padding: "2px 6px",
          borderRadius: 4,
          background: tone
            ? "color-mix(in oklch, var(--accent) 18%, var(--ink-2) 82%)"
            : "var(--ink-2)",
          color: tone ? "var(--accent)" : "var(--paper-3)",
          fontSize: 10,
          lineHeight: 1,
        }}
      >
        <span style={{ display: "inline-flex", lineHeight: 0 }}>{Icon.x(9)}</span>
        <span>{value}</span>
        {signal.kolCount24h > 0 && <span style={{ color: "var(--paper-4)" }}>K{signal.kolCount24h}</span>}
      </button>
    </Tooltip>
  );
}

function isProbablyShortenedSymbol(symbol?: string | null, name?: string | null) {
  const s = symbol?.trim() ?? "";
  const n = name?.trim() ?? "";
  return Boolean(n) && (s.length <= 1 || /\.{2,}$/.test(s) || s.endsWith("…"));
}

function TokenRowIdentity({ token, rowIndex = 0 }: { token: TokenEvent; rowIndex?: number }) {
  const [copied, setCopied] = useState(false);
  const [meta, setMeta] = useState<{ symbol?: string; name?: string } | null>(null);
  const mint = token.mint_address;
  const needsMeta = isProbablyShortenedSymbol(token.symbol, token.name) || !token.symbol?.trim();

  useEffect(() => {
    if (!mint || !needsMeta) {
      setMeta(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    timer = setTimeout(() => {
      fetchPublicMetadata(mint)
        .then((next) => {
          if (cancelled) return;
          setMeta({ symbol: next.symbol?.trim(), name: next.name?.trim() });
        })
        .catch(() => {
          if (!cancelled) setMeta(null);
        });
    }, streamSettledDelay() + rowIndex * 120);

    return () => {
      cancelled = true;
      if (timer != null) clearTimeout(timer);
    };
  }, [mint, needsMeta, rowIndex]);

  const symbol = (needsMeta && meta?.symbol ? meta.symbol : token.symbol?.trim()) ||
    token.name?.trim() ||
    shortAddr(mint, 4);
  const name = token.name?.trim() || meta?.name?.trim() || "";

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!mint) return;
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1100);
    } catch {
      /* clipboard is best-effort */
    }
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "baseline",
      gap: 5,
      width: "100%",
      minWidth: 0,
    }}>
      <Tooltip content={copied ? "Copied" : `Copy mint · ${mint}`} mono>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied mint" : "Copy mint"}
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 5,
            minWidth: 0,
            maxWidth: "100%",
            padding: 0,
            textAlign: "left",
            cursor: mint ? "pointer" : "default",
          }}
        >
          <span
            style={{
              flex: "0 0 auto",
              whiteSpace: "nowrap",
              overflow: "visible",
              color: "var(--paper)",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {symbol}
          </span>
          {token.chain && isChainId(token.chain) && token.chain !== getActiveChain() && (
            <span style={{ display: "inline-flex", alignSelf: "center", opacity: 0.85 }} title={token.chain}>
              <ChainIcon id={token.chain} size={12} />
            </span>
          )}
          {token.quoteKind === "USDC" && (
            <Tooltip content="USDC-quoted pair">
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                aria-label="USDC-quoted"
                style={{ flex: "0 0 auto", alignSelf: "center", display: "block" }}
              >
                <circle cx="8" cy="8" r="8" fill="#2775CA" />
                <text
                  x="8"
                  y="11.7"
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  fill="#FFFFFF"
                >
                  $
                </text>
              </svg>
            </Tooltip>
          )}
          {name && (
            <span
              className="mono ellipsis"
              style={{
                minWidth: 0,
                flex: "1 1 auto",
                color: "var(--paper-3)",
                fontSize: 11,
              }}
            >
              {name}
            </span>
          )}
          {copied && (
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              color: "var(--accent)",
              flex: "0 0 auto",
            }}>
              {Icon.check(12)}
            </span>
          )}
        </button>
      </Tooltip>
    </div>
  );
}

// ── "last seen" badge — auto-updating relative time via ageRegistry ─────────

function RowAgeBadge({ tsMs }: { tsMs: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = formatAge(tsMs);
    registerAge(el, tsMs);
    return () => unregisterAge(el);
  }, [tsMs]);
  return (
    <Tooltip content={new Date(tsMs).toLocaleString()}>
    <span
      className="mono"
      style={{
        fontSize: 9,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--paper-3)",
      }}
    >
      <span ref={ref}>{formatAge(tsMs)}</span>
    </span>
    </Tooltip>
  );
}

function SeenBadge({ tsMs }: { tsMs: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = formatAge(tsMs);
    registerAge(el, tsMs);
    return () => unregisterAge(el);
  }, [tsMs]);
  return (
    <Tooltip content={`Last opened ${new Date(tsMs).toLocaleString()}`}>
    <span
      style={{
        fontSize: 8, fontFamily: "var(--font-mono)",
        letterSpacing: "0.08em", textTransform: "uppercase",
        color: "var(--accent)",
        lineHeight: 1.2,
      }}
    >
      LAST SEEN <span ref={ref}>{formatAge(tsMs)}</span>
    </span>
    </Tooltip>
  );
}

// ── small stat chip used on rows 2 + 3 ──────────────────────────────────────

function Chip({
  label,
  value,
  tone,
  accent,
  bare = false,
}: {
  label: string;
  value: string;
  tone?: "warn" | "green";
  /** Label color override — gives each stat type its own hue. */
  accent?: string;
  /** Drop the pill background and bump sizing — used in the right metric column. */
  bare?: boolean;
}) {
  const labelColor =
    tone === "warn"  ? "var(--warn)"  :
    tone === "green" ? "var(--accent)" :
    accent           ? accent         :
                       "var(--paper-4)";
  const valueColor =
    tone === "warn"  ? "var(--warn)"  :
    tone === "green" ? "var(--accent)" :
                       "var(--paper)";
  // Icon size tracks the value text size in both modes so the glyph and
  // number share an optical baseline weight.
  const metricIconSize = bare ? 11 : 10;
  const labelNode =
    label === "V"   ? Icon.volume(metricIconSize)
    : label === "TX"  ? Icon.trades(metricIconSize)
    : label === "H"   ? Icon.holders(metricIconSize)
    : label === "F"   ? Icon.fees(metricIconSize)
    : label === "B"   ? Icon.bundle(metricIconSize)
    : label === "S"   ? Icon.sniper(metricIconSize)
    : label === "DEV" ? Icon.dev(metricIconSize)
    // Dev-buy native amount: chain mark so the eye picks
    // up "this is a native-asset number" without reading the label.
    : label === "DEV_BUY" ? <ChainIcon id={getActiveChain()} size={metricIconSize} />
    // Creator deploys/migrations ratio: a crown reads as "creator" / "OG"
    // and visually distinguishes it from the buy amount sitting next to it.
    : label === "CRT" ? Icon.crown(metricIconSize)
    : label;
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex", alignItems: "center",
        gap: 3,
        padding: bare ? 0 : "2px 6px",
        borderRadius: bare ? 0 : 4,
        background: bare
          ? "transparent"
          : "color-mix(in oklch, var(--buy) 14%, var(--ink-2) 86%)",
        fontSize: bare ? 11 : 10,
        lineHeight: 1,
      }}
    >
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: bare ? 11 : 12,
        lineHeight: 0,
        fontSize: bare ? 11 : 9,
        letterSpacing: "0.06em",
        color: labelColor, fontWeight: 600,
      }}>{labelNode}</span>
      <span style={{ color: valueColor, fontWeight: bare ? 600 : 500 }}>{value}</span>
    </span>
  );
}

// Combined dev-buy + creator-ratio pill rendered on row 2. Single bordered
// box so the two metrics read as one cohesive datum (replaces the previous
// "1.48 · 0/23" string and the briefly-lived two-chip layout).
function DevCreatorPill({
  devBuyValue,
  creatorRatio,
}: {
  devBuyValue: string | null;
  creatorRatio: string;
}) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 10,
        lineHeight: 1,
      }}
    >
      {devBuyValue && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 0 }}>
            <ChainIcon id={getActiveChain()} size={10} />
          </span>
          <span style={{ color: "var(--paper-2)", fontWeight: 500 }}>{devBuyValue}</span>
        </span>
      )}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          lineHeight: 0, color: "var(--warn, #FFD166)",
        }}>
          {Icon.crown(10)}
        </span>
        <span style={{ color: "var(--paper-2)", fontWeight: 500 }}>{creatorRatio}</span>
      </span>
    </span>
  );
}

// ── middle column — mcap/change + activity / risk tiles ────────────────────

function RightMetrics({
  priceDerivation,
  activityTiles,
  riskTiles,
}: {
  priceDerivation: ReturnType<typeof usePriceDerivation>;
  activityTiles: Array<{ label: string; value: string; live?: boolean; accent?: string; tone?: "warn" | "green" }>;
  riskTiles: Array<{ label: string; value: string; live?: boolean; accent?: string; tone?: "warn" | "green" }>;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center",
      gap: 4,
      minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          key={priceDerivation.flashKey}
          className="mono"
          style={{
            fontSize: 13, fontWeight: 600,
            color: priceDerivation.flashColor ?? priceDerivation.directionColor,
            animation: priceDerivation.flashColor ? "flashPrice 700ms ease-out" : undefined,
            whiteSpace: "nowrap",
          }}
        >
          {priceDerivation.primary}
        </span>
        <Change v={priceDerivation.effectiveChange} />
      </div>

      {activityTiles.length > 0 && (
        <div style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
          {activityTiles.map((m) => (
            <Chip key={m.label} label={m.label} value={m.value} accent={m.accent} tone={m.tone} bare />
          ))}
        </div>
      )}

      {riskTiles.length > 0 && (
        <div style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
          {riskTiles.map((m) => (
            <Chip key={m.label} label={m.label} value={m.value} accent={m.accent} tone={m.tone} bare />
          ))}
        </div>
      )}
    </div>
  );
}

// ── primary price/mcap derivation (used inline in the left content column) ──

function usePriceDerivation({
  t,
  variant,
  live,
  solPrice,
  supply,
  change,
}: {
  t: TokenEvent;
  variant: TokenRowVariant;
  live?: LivePrice;
  solPrice?: number;
  supply?: number;
  change: number | undefined;
}) {
  const [flashKey, setFlashKey] = useState(0);
  const lastTs = useRef<number>(0);
  useEffect(() => {
    if (live && live.ts !== lastTs.current) {
      lastTs.current = live.ts;
      setFlashKey((k) => k + 1);
    }
  }, [live]);

  const deployFallback = variant === "deploy" ? t.creatorBuyPrice : undefined;
  const priceSol = live?.price ?? t.lastPrice ?? deployFallback ?? 0;
  const priceUsd = priceSol && solPrice ? priceSol * solPrice : undefined;
  const displayPrice: React.ReactNode =
    priceUsd != null && priceUsd > 0 ? fmtPrice(priceUsd) :
    priceSol > 0 ? <SolAmount iconSize={10}>{fmtSol(priceSol, 6)}</SolAmount> :
    null;

  // Solana keeps the pump.fun 1e9 default when no explicit supply is supplied.
  const effSupply = supply != null && supply > 0 ? supply : 1_000_000_000;
  const computedMcap =
    priceSol > 0 && solPrice && effSupply > 0 ? priceSol * effSupply * solPrice : undefined;
  const mcap = (t.marketCap && t.marketCap > 0 ? t.marketCap : undefined) ?? computedMcap ?? t.initialMarketCap;

  let primary: React.ReactNode;
  if (mcap != null && mcap > 0) {
    primary = fmtMcap(mcap);
  } else if (displayPrice) {
    primary = displayPrice;
  } else if (variant === "deploy" && t.firstHourVolume != null && t.firstHourVolume > 0) {
    primary = <SolAmount>{fmtSol(t.firstHourVolume)}</SolAmount>;
  } else {
    primary = "—";
  }

  const flashColor =
    live?.flash === "up" ? "var(--buy)" :
    live?.flash === "down" ? "var(--sell)" :
    undefined;

  let livePoints: number[] | undefined;
  if (live && live.prices.length >= 2) {
    livePoints =
      variant === "deploy" && deployFallback != null
        ? [deployFallback, ...live.prices]
        : live.prices;
  } else if (live && live.prices.length === 1 && variant === "deploy" && deployFallback != null) {
    livePoints = [deployFallback, live.prices[0]];
  }
  const bufferDelta =
    livePoints && livePoints.length >= 2
      ? livePoints[0] > 0
        ? ((livePoints[livePoints.length - 1] - livePoints[0]) / livePoints[0]) * 100
        : 0
      : null;
  const effectiveChange: number = change ?? bufferDelta ?? 0;
  const directionColor =
    effectiveChange > 0 ? "var(--buy)" :
    effectiveChange < 0 ? "var(--sell)" :
    "var(--paper-2)";

  return { primary, effectiveChange, flashColor, directionColor, flashKey };
}

// ── chart cell (far-right, standalone) ──────────────────────────────────────

function ChartCell({
  t,
  live,
  change,
}: {
  t: TokenEvent;
  live?: LivePrice;
  change: number | undefined;
}) {
  const { showSparkline } = useCardStyle();
  if (!showSparkline) return null;
  // Build sparkline buffer — prepend creator buy price for deploys as an initial seed
  const deployFallback = t.creatorBuyPrice;
  let livePoints: number[] | undefined;
  if (live && live.prices.length >= 2) {
    livePoints =
      deployFallback != null ? [deployFallback, ...live.prices] : live.prices;
  } else if (live && live.prices.length === 1 && deployFallback != null) {
    livePoints = [deployFallback, live.prices[0]];
  }

  const bufferDelta =
    livePoints && livePoints.length >= 2 && livePoints[0] > 0
      ? ((livePoints[livePoints.length - 1] - livePoints[0]) / livePoints[0]) * 100
      : null;
  const effectiveChange = change ?? bufferDelta ?? 0;

  const color =
    effectiveChange > 0 ? "var(--buy)" :
    effectiveChange < 0 ? "var(--sell)" :
    undefined;

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "flex-end", alignSelf: "center",
      minWidth: 64, flexShrink: 0,
    }}>
      <Sparkline points={livePoints} color={color} width={64} height={30} />
    </div>
  );
}

function AvatarHideOverlay({ token, rowImage }: { token: TokenEvent; rowImage?: string | null }) {
  const { hide: hideToken } = useHiddenTokens();
  const { hide: hideDev } = useHiddenDevs();
  const cloneToken = useCloneToken();
  const [hovered, setHovered] = useState(false);

  const onHideToken = (e: React.MouseEvent) => {
    e.stopPropagation();
    hideToken(token.mint_address, { symbol: token.symbol, name: token.name });
  };
  const onHideDev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token.signer) return;
    hideDev(token.signer, {
      lastTokenSymbol: token.symbol,
      lastTokenName: token.name,
      lastTokenMint: token.mint_address,
    });
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 4,
        borderRadius: Math.round(54 * 0.22),
        background: hovered ? "color-mix(in oklch, var(--ink-0) 78%, transparent)" : "transparent",
        backdropFilter: hovered ? "blur(2px)" : undefined,
        opacity: hovered ? 1 : 0,
        transition: "opacity 120ms, background 120ms",
        cursor: "default",
      }}
    >
      <Tooltip content="Clone — relaunch this token">
        <button
          type="button"
          aria-label="Clone token"
          onClick={(e) => {
            e.stopPropagation();
            cloneToken({
              name: token.name, symbol: token.symbol, image: rowImage || token.image,
              twitter: token.twitter, telegram: token.telegram, website: token.website,
            });
          }}
          style={{ ...hideBtnStyle, color: "#2f9bff" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in oklch, #2f9bff 18%, transparent)"; e.currentTarget.style.borderColor = "#2f9bff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--ink-1)"; e.currentTarget.style.borderColor = "var(--line-soft)"; }}
        >
          {Icon.dna(12)}
        </button>
      </Tooltip>
      {token.signer && (
        <Tooltip content="Hide dev from lists">
          <button
            type="button"
            onClick={onHideDev}
            aria-label="Hide dev from lists"
            style={hideBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--sell-w)"; e.currentTarget.style.color = "var(--sell)"; e.currentTarget.style.borderColor = "var(--sell)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--ink-1)"; e.currentTarget.style.color = "var(--paper-2)"; e.currentTarget.style.borderColor = "var(--line-soft)"; }}
          >
            {Icon.wallet(12)}
          </button>
        </Tooltip>
      )}
      <Tooltip content="Hide token from lists">
        <button
          type="button"
          onClick={onHideToken}
          aria-label="Hide token from lists"
          style={hideBtnStyle}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--sell-w)"; e.currentTarget.style.color = "var(--sell)"; e.currentTarget.style.borderColor = "var(--sell)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--ink-1)"; e.currentTarget.style.color = "var(--paper-2)"; e.currentTarget.style.borderColor = "var(--line-soft)"; }}
        >
          {Icon.eyeOff(12)}
        </button>
      </Tooltip>
    </div>
  );
}

const hideBtnStyle: React.CSSProperties = {
  width: 22, height: 22,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  background: "var(--ink-1)",
  border: "1px solid var(--line-soft)",
  borderRadius: 4,
  color: "var(--paper-2)",
  cursor: "pointer",
  padding: 0,
  transition: "background 120ms, color 120ms, border-color 120ms",
};

function QuickBuyOverlay({ mint, scope }: { mint: string; scope?: string }) {
  const { run, busy } = useQuickBuy(mint);
  const [amount] = useQuickBuyAmount(scope);
  const [quote] = useBuyQuoteMint();
  // Amount 0 = quick-buy disabled: don't surface the hover ⚡ overlay.
  if (!(amount > 0)) return null;
  return (
    <button
      type="button"
      disabled={busy}
      className="quick-buy-overlay"
      onClick={(e) => {
        e.stopPropagation();
        void run(amount);
      }}
    >
      <span className="quick-buy-overlay__icon" style={{ display: "inline-flex", lineHeight: 0 }}>
        {Icon.bolt(12)}
      </span>
      <QuoteAmount label={quote.label} iconSize={10}>{amount}</QuoteAmount>
    </button>
  );
}
