"use client";

import React, { useEffect, useRef, useState } from "react";
import { useLiveAlerts, type LiveFeedItem } from "../../contexts/LiveAlertsContext";
import { shortAddr, fmtUsd, fmtSol } from "../../lib/format";
import { Icon, Tooltip } from "../atoms";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { viewportMaxWidth } from "../../lib/popover";

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function KindDot({ kind }: { kind: LiveFeedItem["kind"] }) {
  const colors: Record<LiveFeedItem["kind"], string> = {
    trade: "var(--accent)",
    deploy: "var(--amber)",
    perp: "var(--blue, #4a9eff)",
    tweet: "var(--info, #1d9bf0)",
  };
  return (
    <span style={{
      display: "inline-block",
      width: 6, height: 6,
      borderRadius: 999,
      background: colors[kind],
      flexShrink: 0,
      marginTop: 1,
    }} />
  );
}

// Tweets have no wallet to mute — the whole lane is toggled from the
// Notifications modal instead, so they return null here.
function muteTarget(item: LiveFeedItem): { id: string; label: string } | null {
  if (item.kind === "tweet") return null;
  return { id: item.data.walletId, label: item.data.walletLabel };
}

function FeedRow({ item }: { item: LiveFeedItem }) {
  const { toggleMuteWallet } = useLiveAlerts();
  const [hovered, setHovered] = useState(false);
  const target = muteTarget(item);

  function handleMute(e: React.MouseEvent) {
    e.stopPropagation();
    if (target) toggleMuteWallet(target.id);
  }

  const openTweet = item.kind === "tweet"
    ? () => window.open(`https://x.com/${item.data.username}/status/${item.data.tweetId}`, "_blank", "noopener")
    : undefined;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={openTweet}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 12px",
        borderBottom: "1px solid var(--line-soft)",
        background: hovered ? "var(--ink-2)" : "transparent",
        transition: "background 80ms",
        cursor: openTweet ? "pointer" : "default",
      }}
    >
      <KindDot kind={item.kind} />

      {item.kind === "trade" && (() => {
        const a = item.data;
        const isBuy = a.side === "buy";
        return (
          <>
            <span style={{ color: isBuy ? "var(--buy, var(--accent))" : "var(--sell, #f87171)", fontWeight: 600, fontSize: 10, letterSpacing: "0.04em", flexShrink: 0 }}>
              {isBuy ? "BUY" : "SELL"}
            </span>
            <span style={{ color: "var(--paper-2)", fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {a.walletLabel} · {shortAddr(a.tokenMint, 4)}
              {a.usdValue ? <span style={{ color: "var(--paper-3)" }}> {fmtUsd(a.usdValue)}</span>
                : a.solAmount ? <span style={{ color: "var(--paper-3)" }}> {fmtSol(a.solAmount)} SOL</span>
                : null}
            </span>
          </>
        );
      })()}

      {item.kind === "deploy" && (() => {
        const d = item.data;
        return (
          <>
            <span style={{ color: "var(--amber)", fontWeight: 600, fontSize: 10, letterSpacing: "0.04em", flexShrink: 0 }}>
              DEPLOY
            </span>
            <span style={{ color: "var(--paper-2)", fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.walletLabel} · {d.symbol || d.name || shortAddr(d.mint_address, 4)}
            </span>
          </>
        );
      })()}

      {item.kind === "tweet" && (() => {
        const t = item.data;
        return (
          <>
            <span style={{ color: "var(--info, #1d9bf0)", fontWeight: 600, fontSize: 10, letterSpacing: "0.04em", flexShrink: 0 }}>
              𝕏 TWEET
            </span>
            <span style={{ color: "var(--paper-2)", fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              @{t.username}
              <span style={{ color: "var(--paper-3)" }}> {t.text}</span>
            </span>
          </>
        );
      })()}

      {item.kind === "perp" && (() => {
        const p = item.data;
        const isLong = p.side === "long";
        return (
          <>
            <span style={{ color: isLong ? "var(--buy, var(--accent))" : "var(--sell, #f87171)", fontWeight: 600, fontSize: 10, letterSpacing: "0.04em", flexShrink: 0 }}>
              {isLong ? "LONG" : "SHORT"}
            </span>
            <span style={{ color: "var(--paper-2)", fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.walletLabel} · {p.marketId}
              <span style={{ color: "var(--paper-3)" }}> {fmtUsd(p.sizeUsd)}</span>
            </span>
          </>
        );
      })()}

      <span style={{ color: "var(--paper-3)", fontSize: 10, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
        {timeAgo(item.ts)}
      </span>
      {target && (
        <Tooltip content={`Mute ${target.label}`} placement="left">
          <button
            onClick={handleMute}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: hovered ? "var(--paper-3)" : "transparent",
              display: "flex", alignItems: "center",
              padding: 2, flexShrink: 0,
              transition: "color 100ms",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sell, #f87171)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = hovered ? "var(--paper-3)" : "transparent")}
          >
            {Icon.eyeOff(11)}
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export function LiveAlertsPanel() {
  const { feedItems, unreadCount, panelOpen, setPanelOpen, wallets, mutedWalletIds, toggleMuteWallet } = useLiveAlerts();
  const ref = useRef<HTMLDivElement | null>(null);
  const isPhone = useIsPhone();

  useEffect(() => {
    if (!panelOpen) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPanelOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [panelOpen, setPanelOpen]);

  if (!panelOpen) return null;

  const shown = feedItems.slice(0, 40);

  // Muted chips for the footer — only sources that are in the watchlist
  const mutedWalletChips = wallets.filter((w) => mutedWalletIds.has(w.id));
  const hasMuted = mutedWalletChips.length > 0;

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        width: isPhone ? viewportMaxWidth() : 340,
        maxWidth: viewportMaxWidth(),
        maxHeight: isPhone ? "70dvh" : 520,
        background: "var(--ink-1)",
        border: "1px solid var(--line-soft)",
        borderRadius: 6,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid var(--line-soft)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {Icon.bell(12)}
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--paper)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Live Alerts
          </span>
          {unreadCount > 0 && (
            <span style={{
              background: "var(--accent)", color: "var(--ink-0)",
              fontSize: 9, fontWeight: 700,
              padding: "1px 5px", borderRadius: 999,
              letterSpacing: "0.04em",
            }}>
              {unreadCount} new
            </span>
          )}
        </div>
        <button
          onClick={() => setPanelOpen(false)}
          style={{ color: "var(--paper-3)", background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" }}
        >
          {Icon.close(12)}
        </button>
      </div>

      {/* Feed */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {shown.length === 0 ? (
          <div style={{
            padding: "32px 16px",
            textAlign: "center",
            color: "var(--paper-3)",
            fontSize: 12,
          }}>
            {wallets.length === 0
              ? "Add wallets or X handles on the Tracker page to receive live alerts"
              : "No live alerts yet — watching " + wallets.length + " wallet" + (wallets.length !== 1 ? "s" : "")}
          </div>
        ) : (
          shown.map((item, i) => <FeedRow key={i} item={item} />)
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "6px 12px",
        borderTop: "1px solid var(--line-soft)",
        flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 5,
      }}>
        {/* Muted chips — click to unmute */}
        {hasMuted && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {mutedWalletChips.map((w) => (
              <Tooltip key={w.id} content="Unmute" placement="top">
                <button
                  onClick={() => toggleMuteWallet(w.id)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 3,
                    padding: "2px 7px",
                    background: "transparent",
                    border: "1px solid var(--line-soft)",
                    borderRadius: 999,
                    color: "var(--paper-3)", fontSize: 10, cursor: "pointer",
                    transition: "border-color 100ms, color 100ms",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--paper)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line-soft)"; e.currentTarget.style.color = "var(--paper-3)"; }}
                >
                  {Icon.eyeOff(9)}
                  {w.label}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        {feedItems.length > 40 && (
          <div style={{ fontSize: 11, color: "var(--paper-3)", textAlign: "center" }}>
            +{feedItems.length - 40} more
          </div>
        )}
      </div>
    </div>
  );
}
