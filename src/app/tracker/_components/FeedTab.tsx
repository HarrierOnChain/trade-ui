"use client";
/**
 * Feed tab — the unified live alert + tweet stream.
 *
 * Filters by side (all / buys / sells / X tweets only) and by individual
 * wallets (chip strip). New rows flash briefly and a "Live" pill marks
 * fresh events.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useIsPhone } from "../../../hooks/useMediaQuery";
import type { TrackedWallet, TrackerAlert } from "../../../hooks/useTrackerStream";
import type { useXTracker, useXTweetFeed } from "../../../hooks/useXTracker";
import {
  EmptyHero, PortfolioGlyph, Segmented, shortAddr,
} from "../../portfolio/_components/atoms";
import { Btn, SolAmount, TokenIdentity, Tooltip } from "../../../components/atoms";
import { TweetRow, authorAvatarFromPayload } from "../../../components/XTrackerColumn/TweetRow";
import { proxiedAvatarUrl } from "../../../api/xstream";
import { formatAge, registerAge, unregisterAge } from "../../../lib/ageRegistry";
import { fmtUsd } from "../../../lib/format";

type SideFilter = "all" | "buy" | "sell" | "x";

type FeedItem =
  | { kind: "alert"; ts: number; alert: TrackerAlert }
  | { kind: "tweet"; ts: number; tweet: ReturnType<typeof useXTweetFeed>["tweets"][number] };

export function FeedTab({
  alerts,
  tweets,
  xHandles,
  regionBaseUrl,
  wallets,
  loading,
  onTokenClick,
}: {
  alerts: TrackerAlert[];
  tweets: ReturnType<typeof useXTweetFeed>["tweets"];
  xHandles: ReturnType<typeof useXTracker>["handles"];
  regionBaseUrl: string;
  wallets: TrackedWallet[];
  loading: boolean;
  onTokenClick: (mint: string) => void;
}) {
  const isPhone = useIsPhone();
  const [side, setSide] = useState<SideFilter>("all");
  const [walletFilter, setWalletFilter] = useState<Set<string>>(new Set());

  function toggleWalletFilter(id: string) {
    setWalletFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filteredAlerts = useMemo(() => {
    let rows = alerts;
    if (side === "buy" || side === "sell") rows = rows.filter((a) => a.side === side);
    if (walletFilter.size > 0) rows = rows.filter((a) => walletFilter.has(a.walletId));
    return rows;
  }, [alerts, side, walletFilter]);

  const items = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    if (side !== "x") {
      for (const a of filteredAlerts) out.push({ kind: "alert", ts: a.timestamp, alert: a });
    }
    if (side === "all" || side === "x") {
      for (const t of tweets) {
        out.push({ kind: "tweet", ts: Date.parse(t.postedAt), tweet: t });
      }
    }
    return out.sort((a, b) => b.ts - a.ts);
  }, [filteredAlerts, tweets, side]);

  const counts = useMemo(() => ({
    all: alerts.length + tweets.length,
    buy: alerts.filter((a) => a.side === "buy").length,
    sell: alerts.filter((a) => a.side === "sell").length,
    x: tweets.length,
  }), [alerts, tweets]);

  if (loading && items.length === 0) {
    return <TableSkeleton columns={6} rows={8} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Filter strip */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{
          display: "flex",
          flexDirection: isPhone ? "column" : "row",
          alignItems: isPhone ? "stretch" : "center",
          gap: isPhone ? 8 : 10, justifyContent: "space-between", flexWrap: "wrap",
        }}>
          <Segmented
            value={side}
            onChange={setSide}
            size="sm"
            options={[
              { value: "all",  label: "All",   count: counts.all },
              { value: "buy",  label: "Buys",  count: counts.buy },
              { value: "sell", label: "Sells", count: counts.sell },
              { value: "x",    label: "Tweets",count: counts.x },
            ]}
          />
          {walletFilter.size > 0 && (
            <Btn size="xs" tone="ghost" onClick={() => setWalletFilter(new Set())}>
              Clear wallet filter ({walletFilter.size})
            </Btn>
          )}
        </div>

        {/* Per-wallet chip strip */}
        {wallets.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {wallets.map((w) => {
              const on = walletFilter.has(w.id);
              return (
                <button
                  key={w.id}
                  onClick={() => toggleWalletFilter(w.id)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 11, fontWeight: 500,
                    background: on ? "var(--accent)" : "var(--ink-1)",
                    color: on ? "var(--ink-0)" : "var(--paper-2)",
                    border: `1px solid ${on ? "var(--accent)" : "var(--line-soft)"}`,
                    borderRadius: 999, cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                    transition: "background 120ms, color 120ms, border-color 120ms",
                  }}
                >{w.label}</button>
              );
            })}
          </div>
        )}
      </div>

      {/* Feed */}
      {items.length === 0 ? (
        <EmptyHero
          title="No alerts in view."
          body={
            walletFilter.size > 0
              ? "No fills match the current wallet filter."
              : side === "x"
              ? "No tweets yet — track an X handle to see tweets here."
              : "Leaving the WebSocket open will surface trades as they land."
          }
        />
      ) : (
        <div style={{
          background: "var(--ink-1)", border: "1px solid var(--line-soft)",
          borderRadius: 12, overflow: "hidden",
        }}>
          <table className="table-cards" style={{
            width: "100%", borderCollapse: "separate", borderSpacing: 0,
            fontFamily: "var(--font-ui)",
          }}>
            <thead>
              <tr>
                {["Age", "Side", "Token", "Wallet", "SOL", "USD"].map((h, i) => (
                  <th key={h} style={{
                    position: "sticky", top: 0, zIndex: 1,
                    background: "var(--ink-1)",
                    textAlign: i >= 4 ? "right" : "left",
                    padding: "10px 14px",
                    fontSize: 9, color: "var(--paper-4)",
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    fontFamily: "var(--font-mono)", fontWeight: 500,
                    borderBottom: "1px solid var(--line-soft)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                if (item.kind === "alert") {
                  return <AlertRow key={`al:${item.alert.id}`} a={item.alert} onTokenClick={onTokenClick} />;
                }
                const handle = xHandles.find((h) => h.handle.username === item.tweet.username)?.handle;
                return (
                  <tr key={`tw:${item.tweet.username}:${item.tweet.tweetId}`}>
                    <td colSpan={6} data-label="" style={{ padding: 0 }}>
                      <TweetRow
                        username={item.tweet.username}
                        tweetId={item.tweet.tweetId}
                        text={item.tweet.text}
                        postedAt={item.tweet.postedAt}
                        verified={handle?.verified ?? false}
                        avatarUrl={proxiedAvatarUrl(
                          handle?.avatarUrl ?? authorAvatarFromPayload(item.tweet.payload) ?? null,
                          regionBaseUrl,
                        )}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Alert row ───────────────────────────────────────────────────────── */

function AlertRow({
  a, onTokenClick,
}: {
  a: TrackerAlert;
  onTokenClick: (mint: string) => void;
}) {
  const ageRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ageRef.current;
    if (!el || !a.timestamp) return;
    el.textContent = formatAge(a.timestamp);
    registerAge(el, a.timestamp);
    return () => unregisterAge(el);
  }, [a.timestamp]);

  const isBuy = a.side === "buy";
  return (
    <tr
      onClick={() => onTokenClick(a.tokenMint)}
      style={{
        cursor: "pointer",
        background: a.isNew ? "color-mix(in oklch, var(--accent) 6%, transparent)" : "transparent",
        transition: "background 100ms",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = a.isNew
          ? "color-mix(in oklch, var(--accent) 6%, transparent)"
          : "transparent";
      }}
    >
      <td data-label="Age" style={{
        padding: "11px 14px", fontSize: 11,
        color: "var(--paper-3)", fontFamily: "var(--font-mono)",
        borderBottom: "1px solid var(--line-soft)",
        whiteSpace: "nowrap",
      }}>
        <span ref={ageRef}>{formatAge(a.timestamp)}</span>
      </td>
      <td data-label="Side" style={{
        padding: "11px 14px", fontSize: 12,
        borderBottom: "1px solid var(--line-soft)",
        whiteSpace: "nowrap",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <SidePill side={isBuy ? "buy" : "sell"} />
          {a.isNew && (
            <span style={{
              fontSize: 8, padding: "1px 5px", borderRadius: 3,
              background: "var(--accent-w)", color: "var(--accent)",
              letterSpacing: "0.08em", textTransform: "uppercase",
              fontFamily: "var(--font-mono)", fontWeight: 600,
              border: "1px solid color-mix(in oklch, var(--accent) 40%, transparent)",
            }}>Live</span>
          )}
        </span>
      </td>
      <td data-label="Token" style={{
        padding: "11px 14px", fontSize: 12,
        borderBottom: "1px solid var(--line-soft)",
        whiteSpace: "nowrap",
      }}>
        <TokenIdentity mint={a.tokenMint} showImage compact size="xs" onOpen={onTokenClick} />
      </td>
      <td data-label="Wallet" style={{
        padding: "11px 14px", fontSize: 12,
        color: "var(--paper)",
        borderBottom: "1px solid var(--line-soft)",
        whiteSpace: "nowrap",
      }}>
        <Tooltip content={a.signer} mono>
          <span style={{
            padding: "3px 9px", borderRadius: 999,
            background: "var(--ink-2)",
            color: "var(--paper-2)",
            fontSize: 11, fontWeight: 500,
            border: "1px solid var(--line-soft)",
          }}>{a.walletLabel}</span>
        </Tooltip>
      </td>
      <td data-label="SOL" style={{
        padding: "11px 14px", fontSize: 12,
        color: "var(--paper)", textAlign: "right",
        fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
        borderBottom: "1px solid var(--line-soft)",
        whiteSpace: "nowrap",
      }}>
        {a.solAmount > 0 ? <SolAmount>{a.solAmount.toFixed(3)}</SolAmount> : "—"}
      </td>
      <td data-label="USD" style={{
        padding: "11px 14px", fontSize: 12,
        color: "var(--paper)", textAlign: "right",
        fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
        borderBottom: "1px solid var(--line-soft)",
        whiteSpace: "nowrap",
      }}>
        {a.usdValue && a.usdValue > 0 ? fmtUsd(a.usdValue) : "—"}
      </td>
    </tr>
  );
}

/* ── Side pill ───────────────────────────────────────────────────────── */

function SidePill({ side }: { side: "buy" | "sell" }) {
  const isBuy = side === "buy";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 4,
      background: isBuy ? "var(--buy-w)" : "var(--sell-w)",
      color: isBuy ? "var(--buy)" : "var(--sell)",
      fontSize: 10, fontWeight: 600,
      letterSpacing: "0.04em", textTransform: "uppercase",
      fontFamily: "var(--font-mono)",
      border: `1px solid color-mix(in oklch, ${isBuy ? "var(--buy)" : "var(--sell)"} 38%, transparent)`,
      lineHeight: 1.4,
    }}>{isBuy ? "Buy" : "Sell"}</span>
  );
}

/* ── Skeleton ────────────────────────────────────────────────────────── */

function TableSkeleton({ columns, rows }: { columns: number; rows: number }) {
  return (
    <div style={{
      background: "var(--ink-1)", border: "1px solid var(--line-soft)",
      borderRadius: 12, padding: 12,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{
          display: "grid", gap: 12,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}>
          {Array.from({ length: columns }).map((_, c) => (
            <span key={c} className="skeleton" style={{
              height: 14, borderRadius: 4,
              width: c === 0 ? "60%" : c === 1 ? "40%" : "70%",
            }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Suppress unused warnings (PortfolioGlyph + shortAddr are useful exports)
void PortfolioGlyph;
void shortAddr;
