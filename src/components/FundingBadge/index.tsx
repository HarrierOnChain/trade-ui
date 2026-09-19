"use client";

import React from "react";
import type { FundingInfo } from "../../api/client";
import { useFunding } from "../../hooks/useFunding";
import { WalletLabel } from "../../hooks/useWalletLabels";
import { fmtSol } from "../../lib/format";

/**
 * Long-range age for funding events. The shared formatAge() in
 * lib/ageRegistry caps at days, but funding ages reach months/years
 * — match the screenshot format ("10mo", "1y", "14d").
 */
function fmtFundingAge(isoTs: string): string {
  const ms = Date.parse(isoTs);
  if (Number.isNaN(ms)) return "—";
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 0) return "now";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  const d = Math.floor(sec / 86400);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  const y = Math.floor(d / 365);
  return `${y}y`;
}

interface Props {
  /** Wallet whose funder we want to display. */
  address?: string | null;
  /** Pre-resolved funding info — skip the lookup hook entirely. */
  funding?: FundingInfo | null;
  /** Compact (single-line) vs default (two-line) layout. */
  compact?: boolean;
  /** Size variant. */
  size?: "xs" | "sm";
  /** Click handler on the funder address (e.g. open a wallet detail). */
  onFunderClick?: (funder: string) => void;
}

/**
 * Inline funding display. Mirrors the screenshot format:
 *   ↑ <funder>      <- top line
 *   <age> · <sol>   <- bottom line
 *
 * Returns `—` for unknown / never-funded wallets so callers can drop it
 * inline without conditional rendering at the call site.
 */
export function FundingBadge({
  address,
  funding,
  compact = false,
  size = "xs",
  onFunderClick,
}: Props) {
  const wantsLookup = funding === undefined && Boolean(address);
  const { fundings } = useFunding(wantsLookup && address ? [address] : []);
  const resolved =
    funding !== undefined
      ? funding
      : address
      ? fundings.get(address)
      : undefined;

  if (resolved === undefined) {
    // First lookup hasn't returned yet.
    return (
      <span
        className="mono"
        style={{
          color: "var(--paper-3)",
          fontSize: size === "xs" ? 10 : 11,
          opacity: 0.45,
          fontStyle: "italic",
        }}
      >
        —
      </span>
    );
  }

  // Backend has enqueued an RPC/CryptoHouse backfill for this wallet — the
  // useFunding hook is re-polling. Render a subtle "resolving" indicator so
  // the row clearly reads as "in progress" rather than terminal "—".
  if ((resolved as unknown) === "pending") {
    return (
      <span
        className="mono"
        title="Funding lookup in progress (backfilling)…"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: "var(--paper-3)",
          fontSize: size === "xs" ? 10 : 11,
          opacity: 0.7,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--paper-3)",
            animation: "fundingPulse 1.4s ease-in-out infinite",
          }}
        />
        <span style={{ fontStyle: "italic" }}>resolving</span>
        <style>{`@keyframes fundingPulse{0%,100%{opacity:0.35}50%{opacity:1}}`}</style>
      </span>
    );
  }

  // Treat an `rpc_unresolved` sentinel (or any row missing a funder) as a
  // no-funding state — the backfill resolver walked history and found
  // nothing usable, so we shouldn't render placeholder zeros.
  const fundingObj = resolved as FundingInfo | null;
  const isUnresolvedSentinel =
    fundingObj !== null &&
    (fundingObj.source === "rpc_unresolved" || !fundingObj.fundedBy);

  if (fundingObj === null || isUnresolvedSentinel) {
    return (
      <span
        className="mono"
        style={{
          color: "var(--paper-3)",
          fontSize: size === "xs" ? 10 : 11,
        }}
      >
        —
      </span>
    );
  }

  const age = fmtFundingAge(fundingObj.fundedAt);
  const sol = fmtSol(fundingObj.solAmount, fundingObj.solAmount < 1 ? 3 : 2);
  const arrow = "↑"; // inbound — funding is always inbound

  if (compact) {
    return (
      <span
        className="mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: size === "xs" ? 10 : 11,
          color: "var(--paper-2)",
          minWidth: 0,
          maxWidth: "100%",
        }}
      >
        <span style={{ color: "var(--buy)", fontWeight: 600, flexShrink: 0 }}>{arrow}</span>
        <FunderInline
          address={fundingObj.fundedBy}
          onClick={onFunderClick}
        />
        {/* Trailing age/sol overflow the row at 360px — drop them on phones so
            the arrow + funder still fit; the full data stays on tablet/desktop. */}
        <span className="hide-phone" style={{ color: "var(--paper-3)" }}>·</span>
        <span className="hide-phone" style={{ color: "var(--paper-3)" }}>{age}</span>
        <span className="hide-phone" style={{ color: "var(--paper-3)" }}>·</span>
        <span className="hide-phone">◉ {sol}</span>
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 1,
        lineHeight: 1.15,
      }}
    >
      <span
        className="mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: size === "xs" ? 11 : 12,
        }}
      >
        <span style={{ color: "var(--buy)", fontWeight: 600 }}>{arrow}</span>
        <FunderInline
          address={fundingObj.fundedBy}
          onClick={onFunderClick}
        />
      </span>
      <span
        className="mono"
        style={{
          fontSize: size === "xs" ? 9.5 : 10.5,
          color: "var(--paper-3)",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <span>{age}</span>
        <span>·</span>
        <span>◉ {sol}</span>
      </span>
    </span>
  );
}

/** Funder address display: prefers the labeled name (e.g. "Binance") over the raw key. */
function FunderInline({
  address,
  onClick,
}: {
  address: string;
  onClick?: (addr: string) => void;
}) {
  const handleClick = onClick
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        onClick(address);
      }
    : undefined;

  return (
    <span
      onClick={handleClick}
      style={{
        cursor: onClick ? "pointer" : undefined,
        color: "var(--paper-1)",
      }}
    >
      <WalletLabel address={address} chars={4} />
    </span>
  );
}
