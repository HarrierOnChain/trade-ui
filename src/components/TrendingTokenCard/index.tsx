"use client";
import React, { memo, useEffect, useRef, useState } from "react";
import {
  TokenAvatarFrame,
  Sparkline,
  Change,
  TokenSocialLinks,
  Icon,
  SolAmount,
  Tooltip,
  MayhemCountdown,
  ChainIcon,
} from "../atoms";
import {
  fmtMcap,
  fmtNum,
  fmtPrice,
  fmtSol,
  fmtUsd,
  shortAddr,
  tokenVolumeUsd,
} from "../../lib/format";
import { formatAge, registerAge, unregisterAge } from "../../lib/ageRegistry";
import { useLastSeen } from "../../contexts/LastSeenContext";
import { useApp } from "../../contexts/AppContext";
import { useHiddenTokens } from "../../lib/hiddenTokens";
import { fetchPublicMetadata } from "../../api/metadata";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { getActiveChain } from "../../lib/chains";
import type { TokenEvent } from "../../types";
import type { LivePrice } from "../../hooks/useLiveTradePrices";
import type { TokenXSignal } from "../../lib/xTrending";

interface Props {
  t: TokenEvent;
  live?: LivePrice;
  solPrice?: number;
  rank?: number;
  xSignal?: TokenXSignal;
  onClick?: (mint: string) => void;
  onXSignalClick?: (token: TokenEvent) => void;
}

export const TrendingTokenCard = memo(function TrendingTokenCard({
  t,
  live,
  solPrice,
  rank,
  xSignal,
  onClick,
  onXSignalClick,
}: Props) {
  const { openWalletModal } = useApp();
  const { lastSeen } = useLastSeen();
  const seenAt = lastSeen[t.mint_address];
  const isPhone = useIsPhone();

  const devBuyValue = t.creatorBuySol != null ? fmtSol(t.creatorBuySol, 2) : null;
  const creatorRatio = `${t.creatorMigrations ?? 0}/${t.creatorDeploys ?? 1}`;
  const hasSocials = Boolean(t.twitter || t.telegram || t.website);
  const hasXSignal = Boolean(
    xSignal && (xSignal.mentionCount24h > 0 || xSignal.kolCount24h > 0),
  );
  const hasDevRow = Boolean(devBuyValue) || Boolean(creatorRatio);
  const ageTs = new Date(t.created_at ?? 0).getTime();

  const liveBundleAdd = live?.bundleAdd ?? 0;
  const liveSniperAdd = live?.sniperAdd ?? 0;
  const livePriceSol = live?.price ?? t.lastPrice ?? t.creatorBuyPrice;
  const bundle = clamp(Number(t.bundlePercentage ?? 0) + liveBundleAdd);
  const sniper = clamp(Number(t.sniperPercentage ?? 0) + liveSniperAdd);

  const liveVolumeSol = live?.volumeSol ?? 0;
  const liveFeesSol = live?.feesSol ?? 0;
  const liveTradeCount = live?.tradeCount ?? 0;
  const liveTraders = live?.uniqueTraders ?? 0;

  const effectiveVolumeUsd = tokenVolumeUsd(t, solPrice, liveVolumeSol);
  const effectiveFees = (t.feesTotal ?? 0) + liveFeesSol;
  const effectiveTrades = (t.tradeCount ?? 0) + liveTradeCount;
  const effectiveHolders = Math.max(
    t.holders ?? 0,
    t.uniqueTraders ?? 0,
    liveTraders,
  );

  const change = t.priceChange;
  const computedMcap =
    livePriceSol && solPrice ? livePriceSol * 1_000_000_000 * solPrice : undefined;
  const mcap = t.marketCap ?? computedMcap ?? t.initialMarketCap;
  const priceUsd = livePriceSol && solPrice ? livePriceSol * solPrice : undefined;

  let livePoints: number[] | undefined;
  const deployFallback = t.creatorBuyPrice;
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

  const directionColor =
    effectiveChange > 0
      ? "var(--buy)"
      : effectiveChange < 0
        ? "var(--sell)"
        : "var(--paper-2)";
  const sparkColor =
    effectiveChange > 0
      ? "var(--buy)"
      : effectiveChange < 0
        ? "var(--sell)"
        : undefined;

  const [flashKey, setFlashKey] = useState(0);
  const lastTs = useRef<number>(0);
  useEffect(() => {
    if (live && live.ts !== lastTs.current) {
      lastTs.current = live.ts;
      setFlashKey((k) => k + 1);
    }
  }, [live]);
  const flashColor =
    live?.flash === "up"
      ? "var(--buy)"
      : live?.flash === "down"
        ? "var(--sell)"
        : undefined;

  const open = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    onClick?.(t.mint_address);
  };

  return (
    <article
      onClick={open}
      className={(t as TokenEvent & { isNew?: boolean }).isNew ? "new-in" : undefined}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "auto auto minmax(0,1fr) auto",
        // Tighten the fixed gutters on phones so the flexible content column
        // keeps width; desktop layout is unchanged.
        gap: isPhone ? 10 : 14,
        padding: isPhone ? 12 : 14,
        background: "var(--ink-1)",
        border: "1px solid var(--line-soft)",
        borderRadius: 10,
        boxShadow: "0 1px 0 rgba(0,0,0,0.25), 0 6px 18px rgba(0,0,0,0.18)",
        cursor: "pointer",
        transition:
          "border-color 140ms, transform 140ms, box-shadow 140ms, background 140ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--line)";
        e.currentTarget.style.background = "var(--ink-2)";
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow =
          "0 1px 0 rgba(0,0,0,0.3), 0 10px 24px rgba(0,0,0,0.28)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--line-soft)";
        e.currentTarget.style.background = "var(--ink-1)";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow =
          "0 1px 0 rgba(0,0,0,0.25), 0 6px 18px rgba(0,0,0,0.18)";
      }}
    >
      {/* Rank pill */}
      {rank != null && (
        <div
          className="mono"
          style={{
            alignSelf: "center",
            width: 30,
            height: 30,
            borderRadius: 8,
            background:
              rank <= 3
                ? "color-mix(in oklch, var(--accent) 18%, var(--ink-2) 82%)"
                : "var(--ink-0)",
            border: `1px solid ${rank <= 3 ? "color-mix(in oklch, var(--accent) 40%, var(--line) 60%)" : "var(--line-soft)"}`,
            color: rank <= 3 ? "var(--accent)" : "var(--paper-3)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {String(rank).padStart(2, "0")}
        </div>
      )}

      {/* Avatar */}
      <div
        style={{
          alignSelf: "center",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <TokenAvatarFrame
          mint={t.mint_address}
          symbol={t.symbol}
          image={t.image}
          chain={t.chain}
          dex={t.dex}
          migrated={t.migrated_at != null || t.graduated === true}
          size={isPhone ? 44 : 56}
          borderWidth={1.5}
          badgeSize={18}
          badgeInset={-4}
          marketCap={t.marketCap}
          initialMarketCap={t.initialMarketCap}
          priceSol={livePriceSol}
          solPrice={solPrice}
          progressPercent={t.graduationPercent}
        />
      </div>

      {/* Content */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
        {/* Identity row */}
        <CardIdentity
          token={t}
          onOpen={onClick}
          ageBadgeTsMs={Number.isFinite(ageTs) ? ageTs : null}
          seenAt={seenAt}
        />

        {/* Chips row */}
        {(hasDevRow ||
          hasSocials ||
          hasXSignal ||
          t.dex?.toLowerCase().includes("mayhem")) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {hasDevRow && (() => {
              const pill = (
                <DevCreatorPill
                  devBuyValue={devBuyValue}
                  creatorRatio={creatorRatio}
                />
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
                      style={{
                        background: "transparent",
                        border: 0,
                        padding: 0,
                        cursor: "pointer",
                      }}
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
            {(hasSocials || t.mint_address) && (
              <TokenSocialLinks
                twitter={t.twitter}
                telegram={t.telegram}
                website={t.website}
                mint={t.mint_address}
                launchpad={t.dex}
                showLaunchpad
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
            {xSignal && xSignal.caMentionCount24h > 0 && (
              <CAChip
                count={xSignal.caMentionCount24h}
                onClick={(e) => {
                  e.stopPropagation();
                  onXSignalClick?.(t);
                }}
              />
            )}
            {t.dex?.toLowerCase().includes("mayhem") && (
              <MayhemCountdown createdAt={t.created_at} />
            )}
          </div>
        )}

        {/* Stats row, divider above */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            paddingTop: 7,
            borderTop: "1px solid var(--line-soft)",
          }}
        >
          {effectiveVolumeUsd != null && effectiveVolumeUsd > 0 && (
            <Stat
              icon={Icon.volume(11)}
              label="VOL"
              value={fmtUsd(effectiveVolumeUsd)}
              accent="var(--info)"
              live={liveVolumeSol > 0}
            />
          )}
          {effectiveTrades > 0 && (
            <Stat
              icon={Icon.trades(11)}
              label="TX"
              value={fmtNum(effectiveTrades)}
              accent="var(--paper-3)"
              live={liveTradeCount > 0}
            />
          )}
          {effectiveHolders > 0 && (
            <Stat
              icon={Icon.holders(11)}
              label="HLD"
              value={fmtNum(effectiveHolders)}
              accent="var(--accent)"
              live={
                liveTraders > 0 &&
                liveTraders > (t.holders ?? 0) &&
                liveTraders > (t.uniqueTraders ?? 0)
              }
            />
          )}
          {effectiveFees > 0 && (
            <Stat
              icon={Icon.fees(11)}
              label="FEE"
              value={
                <SolAmount iconSize={10}>
                  {fmtSol(effectiveFees, effectiveFees >= 1 ? 2 : 3)}
                </SolAmount>
              }
              accent="var(--paper-4)"
              live={liveFeesSol > 0}
            />
          )}
          {(t.bundlePercentage != null || liveBundleAdd !== 0) && (
            <Stat
              icon={Icon.bundle(11)}
              label="BND"
              value={`${bundle.toFixed(0)}%`}
              accent="var(--sell)"
              tone={bundle > 10 ? "warn" : undefined}
              live={liveBundleAdd !== 0}
            />
          )}
          {(t.sniperPercentage != null || liveSniperAdd !== 0) && (
            <Stat
              icon={Icon.sniper(11)}
              label="SNP"
              value={`${sniper.toFixed(0)}%`}
              accent="var(--warn)"
              tone={sniper > 8 ? "warn" : undefined}
              live={liveSniperAdd !== 0}
            />
          )}
        </div>
      </div>

      {/* Right column — price/mcap, change, sparkline */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 6,
          minWidth: isPhone ? 90 : 110,
          flexShrink: 0,
        }}
      >
        <span
          key={flashKey}
          className="mono"
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: flashColor ?? directionColor,
            animation: flashColor ? "flashPrice 700ms ease-out" : undefined,
            letterSpacing: "0.01em",
          }}
        >
          {mcap != null && mcap > 0
            ? fmtMcap(mcap)
            : priceUsd && priceUsd > 0
              ? fmtPrice(priceUsd)
              : livePriceSol && livePriceSol > 0
                ? <SolAmount iconSize={11}>{fmtSol(livePriceSol, 6)}</SolAmount>
                : "—"}
        </span>
        <Change v={effectiveChange} />
        <div style={{ marginTop: 2 }}>
          <Sparkline points={livePoints} color={sparkColor} width={104} height={32} />
        </div>
      </div>
    </article>
  );
});

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}

function CardIdentity({
  token,
  onOpen,
  ageBadgeTsMs,
  seenAt,
}: {
  token: TokenEvent;
  onOpen?: (mint: string) => void;
  ageBadgeTsMs: number | null;
  seenAt?: number;
}) {
  const { pushToast } = useApp();
  const { isHidden, hide, unhide } = useHiddenTokens();
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
    fetchPublicMetadata(mint)
      .then((next) => {
        if (cancelled) return;
        setMeta({ symbol: next.symbol?.trim(), name: next.name?.trim() });
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mint, needsMeta]);

  const symbol =
    (needsMeta && meta?.symbol ? meta.symbol : token.symbol?.trim()) ||
    token.name?.trim() ||
    shortAddr(mint, 4);
  const name = token.name?.trim() || meta?.name?.trim() || "";
  const hidden = isHidden(mint);

  const openTok = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mint) onOpen?.(mint);
  };

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

  const toggleHidden = (e: React.MouseEvent) => {
    e.stopPropagation();
    const label = symbol || name || shortAddr(mint, 6);
    if (hidden) {
      unhide(mint);
      pushToast({ title: "TOKEN UNHIDDEN", body: label, tone: "default" });
    } else {
      hide(mint, { symbol, name });
      pushToast({ title: "TOKEN HIDDEN", body: label, tone: "default" });
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
      }}
    >
      <Tooltip content={`${symbol}${name ? ` ${name}` : ""} · ${mint}`} mono>
        <button
          type="button"
          onClick={openTok}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            minWidth: 0,
            padding: 0,
            textAlign: "left",
            cursor: mint ? "pointer" : "default",
            background: "transparent",
            border: 0,
          }}
        >
          <span
            style={{
              flex: "0 0 auto",
              whiteSpace: "nowrap",
              color: "var(--paper)",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.01em",
            }}
          >
            {symbol}
          </span>
          {name && (
            <span
              className="mono ellipsis"
              style={{
                minWidth: 0,
                color: "var(--paper-3)",
                fontSize: 11,
                maxWidth: 180,
              }}
            >
              {name}
            </span>
          )}
        </button>
      </Tooltip>

      <span
        style={{
          marginLeft: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {seenAt && <SeenBadge tsMs={seenAt} />}
        {ageBadgeTsMs != null && <RowAgeBadge tsMs={ageBadgeTsMs} />}
        <Tooltip content={copied ? "Copied" : "Copy mint"}>
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied mint" : "Copy mint"}
            style={iconButtonStyle(copied ? "var(--accent)" : "var(--paper-4)")}
          >
            {copied ? Icon.check(12) : Icon.copy(12)}
          </button>
        </Tooltip>
        <Tooltip content={hidden ? "Unhide token" : "Hide token from lists"}>
          <button
            type="button"
            onClick={toggleHidden}
            aria-label={hidden ? "Unhide token" : "Hide token"}
            style={iconButtonStyle(hidden ? "var(--sell)" : "var(--paper-4)")}
          >
            {hidden ? Icon.eye(12) : Icon.eyeOff(12)}
          </button>
        </Tooltip>
      </span>
    </div>
  );
}

function isProbablyShortenedSymbol(symbol?: string | null, name?: string | null) {
  const s = symbol?.trim() ?? "";
  const n = name?.trim() ?? "";
  return Boolean(n) && (s.length <= 1 || /\.{2,}$/.test(s) || s.endsWith("…"));
}

function iconButtonStyle(color: string): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    color,
    background: "transparent",
    border: "1px solid var(--line-soft)",
    flexShrink: 0,
    cursor: "pointer",
  };
}

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
          padding: "2px 6px",
          borderRadius: 999,
          border: "1px solid var(--line-soft)",
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
        className="mono"
        style={{
          padding: "2px 6px",
          borderRadius: 999,
          background: "var(--accent-w)",
          border: "1px solid color-mix(in oklch, var(--accent) 35%, var(--line) 65%)",
          color: "var(--accent)",
          fontSize: 9,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        SEEN <span ref={ref}>{formatAge(tsMs)}</span>
      </span>
    </Tooltip>
  );
}

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
        padding: "3px 8px",
        borderRadius: 999,
        background: "color-mix(in oklch, var(--buy) 14%, var(--ink-0) 86%)",
        border: "1px solid var(--line-soft)",
        fontSize: 10,
        lineHeight: 1,
      }}
    >
      {devBuyValue && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span style={{ display: "inline-flex", lineHeight: 0 }}><ChainIcon id={getActiveChain()} size={11} /></span>
          <span style={{ color: "var(--paper)", fontWeight: 600 }}>{devBuyValue}</span>
        </span>
      )}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        <span
          style={{
            display: "inline-flex",
            lineHeight: 0,
            color: "var(--warn, #FFD166)",
          }}
        >
          {Icon.crown(11)}
        </span>
        <span style={{ color: "var(--paper)", fontWeight: 600 }}>{creatorRatio}</span>
      </span>
    </span>
  );
}

function XSignalChip({
  signal,
  onClick,
}: {
  signal: TokenXSignal;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
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
          <div>CA mentions 24h · {signal.caMentionCount24h}</div>
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
          gap: 4,
          padding: "3px 8px",
          borderRadius: 999,
          background: tone
            ? "color-mix(in oklch, var(--accent) 18%, var(--ink-0) 82%)"
            : "var(--ink-0)",
          border: `1px solid ${tone ? "color-mix(in oklch, var(--accent) 40%, var(--line) 60%)" : "var(--line-soft)"}`,
          color: tone ? "var(--accent)" : "var(--paper-3)",
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        <span style={{ display: "inline-flex", lineHeight: 0 }}>{Icon.x(10)}</span>
        <span>{signal.mentionCount24h}</span>
        {signal.kolCount24h > 0 && (
          <span style={{ color: tone ? "var(--accent)" : "var(--paper-4)" }}>
            · K{signal.kolCount24h}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

function CAChip({
  count,
  onClick,
}: {
  count: number;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Tooltip
      placement="bottom"
      mono
      content={`${count} tweet${count === 1 ? "" : "s"} pasted the contract address in the last 24h`}
    >
      <button
        type="button"
        onClick={onClick}
        className="mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          borderRadius: 999,
          background: "color-mix(in oklch, var(--info) 16%, var(--ink-0) 84%)",
          border: "1px solid color-mix(in oklch, var(--info) 38%, var(--line) 62%)",
          color: "var(--info)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.04em",
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 9, letterSpacing: "0.08em" }}>CA</span>
        <span style={{ color: "var(--paper)" }}>{count}</span>
      </button>
    </Tooltip>
  );
}

function Stat({
  icon,
  label,
  value,
  accent,
  tone,
  live,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent?: string;
  tone?: "warn";
  live?: boolean;
}) {
  const labelColor = tone === "warn" ? "var(--warn)" : accent ?? "var(--paper-4)";
  const valueColor = tone === "warn" ? "var(--warn)" : "var(--paper)";
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        lineHeight: 1,
        position: "relative",
      }}
    >
      <span style={{ display: "inline-flex", color: labelColor, lineHeight: 0 }}>{icon}</span>
      <span
        style={{
          color: "var(--paper-4)",
          fontSize: 9,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span style={{ color: valueColor, fontWeight: 600 }}>{value}</span>
      {live && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--accent)",
            boxShadow: "0 0 6px var(--accent)",
          }}
        />
      )}
    </span>
  );
}
