"use client";
import React, { memo, useEffect, useRef } from "react";
import styles from "./styles.module.css";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { useApp } from "../../contexts/AppContext";
import { formatAge, registerAge, unregisterAge } from "../../lib/ageRegistry";
import { fmtUsd, tokenVolumeUsd } from "../../lib/format";
import { Icon, MayhemCountdown, TokenAvatarFrame, TokenIdentity, TokenSocialLinks, Tooltip, ChainIcon } from "../atoms";
import { getActiveChain } from "../../lib/chains";
import type { TokenEvent } from "../../types";

const DEX_COLORS: Record<string, string> = {
  pumpfun:  "#22C55E",
  mayhem:   "#A413E5",
  meteora:  "#EF4444",
  raydium:  "#22CCCC",
  default:  "#22C55E",
};

function dexColor(dex: string) {
  return DEX_COLORS[dex?.toLowerCase()] ?? DEX_COLORS.default;
}

function fmtMcap(v?: number) {
  if (!v) return "–";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function fmtPct(v?: number) {
  if (v == null) return null;
  return `${v.toFixed(1)}%`;
}

function fmtDevBuy(v?: number) {
  if (v == null) return null;
  return v.toFixed(2);
}

function fmtPrice(v?: number) {
  if (v == null) return null;
  if (v < 0.000001) return `$${v.toExponential(2)}`;
  if (v < 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

interface CardProps {
  token: TokenEvent;
  isActive: boolean;
  onCardClick: (mint: string) => void;
  isMigration?: boolean;
  solPrice?: number;
}

// Inner memoized card — isActive is a prop so the comparator catches it
const TokenCardInner = memo(
  function TokenCardInner({ token, isActive, onCardClick, isMigration, solPrice }: CardProps) {
    const { openWalletModal } = useApp();
    const color = dexColor(token.dex);
    const dateStr = isMigration ? token.migrated_at : token.created_at;
    const tsMs = dateStr ? new Date(dateStr).getTime() : NaN;
    const volumeUsd = tokenVolumeUsd(token, solPrice);
    const priceSol = token.lastPrice ?? token.creatorBuyPrice;

    const timeRef = useRef<HTMLSpanElement>(null);
    useEffect(() => {
      const el = timeRef.current;
      if (!el || isNaN(tsMs)) return;
      el.textContent = formatAge(tsMs);
      registerAge(el, tsMs);
      return () => unregisterAge(el);
    }, [tsMs]);

    return (
      <div
        className={`${styles.card} ${token.isNew ? "new-token-card" : ""} ${isActive ? styles.active : ""}`}
        style={{ borderLeft: `2px solid ${isActive ? color : color + "33"}` }}
        onClick={() => onCardClick(token.mint_address)}
      >
        <div className={styles.left}>
          <TokenAvatarFrame
            mint={token.mint_address}
            symbol={token.symbol}
            image={token.image}
            chain={token.chain}
            dex={token.dex}
            migrated={Boolean(token.migrated_at) || Boolean(isMigration)}
            size={36}
            borderWidth={1.5}
            badgeSize={14}
            badgeInset={-3}
            marketCap={token.marketCap}
            initialMarketCap={token.initialMarketCap}
            priceSol={priceSol}
            solPrice={solPrice}
          />
          <div className={styles.meta}>
            <div className={styles.nameRow}>
              <TokenIdentity
                mint={token.mint_address}
                symbol={token.symbol}
                name={token.name}
                image={token.image}
                platform={token.dex}
                compact
                symbolFirst
                size="xs"
                showCopy={false}
                showHide={false}
                copyMintOnNameClick
                chartToken={token}
                chartSolPrice={solPrice}
              />
            </div>
            <div className={styles.dexRow}>
              <span ref={timeRef} className={styles.time}>{isNaN(tsMs) ? "" : formatAge(tsMs)}</span>
              <span className={styles.dex} style={{ color }}>{token.dex}</span>
              <TokenSocialLinks
                twitter={token.twitter}
                telegram={token.telegram}
                website={token.website}
                mint={token.mint_address}
                launchpad={token.dex}
                showLaunchpad
                iconSize={12}
                gap={5}
                stopPropagation
              />
              {token.dex?.toLowerCase().includes("mayhem") && (
                <MayhemCountdown createdAt={token.created_at} />
              )}
              {token.hasCashback && (
                <Tooltip content="Cashback enabled — bonding-curve creator fee sharing">
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 0.3,
                      color: "#FACC15",
                      border: "1px solid #FACC1555",
                      background: "#FACC1514",
                      borderRadius: 3,
                      padding: "0 4px",
                      lineHeight: "14px",
                      textTransform: "uppercase",
                    }}
                  >
                    cashback
                  </span>
                </Tooltip>
              )}
              {token.quoteKind === "USDC" && (
                <Tooltip content="USDC-quoted pair — traded against USDC, not SOL">
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 0.3,
                      color: "#2775CA",
                      border: "1px solid #2775CA55",
                      background: "#2775CA14",
                      borderRadius: 3,
                      padding: "0 4px",
                      lineHeight: "14px",
                      textTransform: "uppercase",
                    }}
                  >
                    USDC
                  </span>
                </Tooltip>
              )}
            </div>
          </div>
        </div>

        <div className={styles.right}>
          <div className={styles.mcap}>{fmtMcap(token.marketCap)}</div>
          {volumeUsd != null && volumeUsd > 0 && (
            <Tooltip content="24h volume">
              <div className={styles.volume}>
                <span className={styles.volumeLabel}>VOL</span>
                <span>{fmtUsd(volumeUsd)}</span>
              </div>
            </Tooltip>
          )}
          {(token.bundlePercentage != null || token.sniperPercentage != null) && (
            <div className={styles.metrics}>
              {token.bundlePercentage != null && (
                <Tooltip content="Bundle %">
                  <span className={styles.metric}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 0 }}>{Icon.bundle(11)}</span>
                    <span>{fmtPct(token.bundlePercentage)}</span>
                  </span>
                </Tooltip>
              )}
              {token.sniperPercentage != null && (
                <Tooltip content="Sniper %">
                  <span className={styles.metric}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 0 }}>{Icon.sniper(11)}</span>
                    <span>{fmtPct(token.sniperPercentage)}</span>
                  </span>
                </Tooltip>
              )}
            </div>
          )}
          {(token.creatorBuySol != null || token.creatorDeploys != null || token.creatorMigrations != null) && (() => {
            const ratio = `${token.creatorMigrations ?? 0}/${token.creatorDeploys ?? 1}`;
            const pill = (
              <span className={styles.devPill}>
                {token.creatorBuySol != null && (
                  <span className={styles.devPillSegment}>
                    <span className={styles.devPillIcon}><ChainIcon id={getActiveChain()} size={11} /></span>
                    <span>{fmtDevBuy(token.creatorBuySol)}</span>
                    {token.creatorBuyPrice != null && (
                      <span className={styles.devPrice}>@{fmtPrice(token.creatorBuyPrice)}</span>
                    )}
                  </span>
                )}
                <span className={styles.devPillSegment}>
                  <span className={`${styles.devPillIcon} ${styles.crownIcon}`}>{Icon.crown(11)}</span>
                  <span>{ratio}</span>
                </span>
              </span>
            );
            if (token.signer) {
              return (
                <Tooltip content={`Open dev wallet ${token.signer}`} mono>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openWalletModal(token.signer!);
                    }}
                    className={styles.devPillButton}
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
        </div>
      </div>
    );
  },
  (a, b) =>
    a.token.mint_address === b.token.mint_address &&
    a.token.marketCap    === b.token.marketCap    &&
    a.token.totalSolVolume === b.token.totalSolVolume &&
    a.token.volume24h    === b.token.volume24h    &&
    a.token.isNew        === b.token.isNew         &&
    a.token.image        === b.token.image         &&
    a.token.twitter      === b.token.twitter       &&
    a.token.telegram     === b.token.telegram      &&
    a.token.website      === b.token.website       &&
    a.solPrice           === b.solPrice            &&
    a.isActive           === b.isActive
);

// Public wrapper — reads context and derives isActive before passing to inner memo
interface Props {
  token: TokenEvent;
  /** Override click. If omitted, the global selected token is set. */
  onClick?: (mint: string) => void;
  isMigration?: boolean;
  solPrice?: number;
}

export function TokenCard({ token, onClick, isMigration, solPrice }: Props) {
  const ctx = useSelectedToken();
  const isActive = ctx?.selectedMint === token.mint_address;

  function handleClick(mint: string) {
    onClick ? onClick(mint) : ctx?.setSelectedMint(mint);
  }

  return (
    <TokenCardInner
      token={token}
      isActive={isActive}
      onCardClick={handleClick}
      isMigration={isMigration}
      solPrice={solPrice}
    />
  );
}
