"use client";

import React, { useState } from "react";
import { useApp } from "../../../contexts/AppContext";
import { WalletLabel } from "../../../hooks/useWalletLabels";
import { FundingBadge } from "../../../components/FundingBadge";
import { useFunding } from "../../../hooks/useFunding";
import { Icon, SolSymbol, Tooltip } from "../../../components/atoms";
import { fmtNum, fmtUsd } from "../../../lib/format";
import { kolImageUrl } from "../../../lib/kolImage";
import type { ChainLeaderboardEntry } from "../../../hooks/useChainLeaderboard";
import type { KolLeaderboardEntry } from "../../../api/backend";
import styles from "./leaderboard.module.css";

const FUNDING_PREFETCH = 30;

export type LeaderboardRow = {
  rank: number;
  signer: string;
  pnlSol: number;
  pnlUsd: number;
  trades: number;
  kolName?: string;
  kolImagePath?: string | null;
};

interface Props {
  entries: LeaderboardRow[];
  loading: boolean;
  error: string | null;
  kolMode?: boolean;
  emptyLabel?: string;
}

export function chainToRows(entries: ChainLeaderboardEntry[]): LeaderboardRow[] {
  return entries.map((e) => ({
    rank: e.rank,
    signer: e.signer,
    pnlSol: e.pnlSol,
    pnlUsd: e.pnlUsd,
    trades: e.trades,
  }));
}

export function kolToRows(entries: KolLeaderboardEntry[]): LeaderboardRow[] {
  return entries.map((e) => ({
    rank: e.rank,
    signer: e.address,
    pnlSol: e.pnlSol,
    pnlUsd: e.pnlUsd,
    trades: e.trades,
    kolName: e.name,
    kolImagePath: e.imagePath,
  }));
}

export function LeaderboardTable({ entries, loading, error, kolMode, emptyLabel }: Props) {
  const fundingAddrs = entries.slice(0, FUNDING_PREFETCH).map((e) => e.signer);
  useFunding(fundingAddrs);

  return (
    <div className={styles.container}>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} table-cards`}>
          <colgroup>
            <col className={styles.cRank} />
            <col className={styles.cWallet} />
            <col className={styles.cFunding} />
            <col className={styles.cPnl} />
            <col className={styles.cTrades} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.thLeft}>#</th>
              <th className={styles.thLeft}>{kolMode ? "KOL" : "Wallet"}</th>
              <th className={styles.thLeft}>Funding</th>
              <th className={styles.thRight}>R. PnL</th>
              <th className={styles.thRight}>Trades</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={5} className={styles.error}>{error}</td>
              </tr>
            )}
            {loading && Array.from({ length: 12 }).map((_, i) => (
              <tr key={i} className={styles.skRow}>
                {Array.from({ length: 5 }).map((__, j) => (
                  <td key={j}>
                    <div className="skeleton" style={{ height: 12, borderRadius: 3 }} />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && entries.length === 0 && !error && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  <span className={styles.emptyIcon}>{Icon.chart(20)}</span>
                  {emptyLabel ?? "No traders in this window"}
                </td>
              </tr>
            )}
            {!loading && entries.map((e) => (
              <LeaderRow key={e.signer} entry={e} kolMode={kolMode} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeaderRow({ entry, kolMode }: { entry: LeaderboardRow; kolMode?: boolean }) {
  const { openWalletModal } = useApp();
  const [copied, setCopied] = useState(false);
  const img = kolMode ? kolImageUrl(entry.kolImagePath) : null;

  const rankClass =
    entry.rank === 1 ? styles.rankTop :
    entry.rank <= 3 ? styles.rankHigh :
    "";

  function copyAddress() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(entry.signer).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const pnlPositive = entry.pnlSol > 0;
  const pnlClass = pnlPositive ? styles.profit : entry.pnlSol < 0 ? styles.loss : styles.mono;

  return (
    <tr className={styles.row}>
      <td data-label="#" className={`${styles.rank} ${rankClass}`}>#{entry.rank}</td>

      <td data-label="Wallet" className={styles.tdLeft}>
        <div className={styles.walletRow}>
          {kolMode && (
            img ? (
              <img src={img} alt="" className={styles.kolAvatar} width={26} height={26} />
            ) : (
              <span className={styles.kolAvatarPlaceholder} />
            )
          )}
          <div className={styles.stackLeft}>
            {kolMode && entry.kolName && (
              <span className={styles.kolName}>{entry.kolName}</span>
            )}
            <Tooltip content={`Open wallet ${entry.signer}`} mono>
              <button
                type="button"
                className={`${styles.addrText} ${styles.addrBtn}`}
                onClick={() => openWalletModal(entry.signer)}
              >
                {kolMode
                  ? <span className={styles.mono}>{entry.signer.slice(0, 4)}…{entry.signer.slice(-4)}</span>
                  : <WalletLabel address={entry.signer} chars={4} />
                }
              </button>
            </Tooltip>
          </div>
          <span className={`${styles.rowActions} row-actions-hover`}>
            {kolMode && (
              <span className={styles.verifiedBadge} title="Verified KOL">✓</span>
            )}
            <Tooltip content={copied ? "Copied" : "Copy address"}>
              <button type="button" className={styles.iconBtn} onClick={copyAddress}>
                {copied ? Icon.check(11) : Icon.copy(11)}
              </button>
            </Tooltip>
            <Tooltip content="Open wallet details">
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => openWalletModal(entry.signer)}
              >
                {Icon.ext(10)}
              </button>
            </Tooltip>
          </span>
        </div>
      </td>

      <td data-label="Funding" className={styles.tdLeft}>
        <FundingBadge address={entry.signer} size="xs" />
      </td>

      <td data-label="R. PnL" className={`${styles.tdRight} ${pnlClass}`}>
        <div className={styles.stack}>
          <span className={styles.primary}>
            <span className={styles.sol}><SolSymbol size={10} /></span>
            {pnlPositive ? "+" : entry.pnlSol < 0 ? "−" : ""}
            {Math.abs(entry.pnlSol).toFixed(3)}
          </span>
          {entry.pnlUsd !== 0 && (
            <span className={styles.sub}>{fmtUsd(Math.abs(entry.pnlUsd))}</span>
          )}
        </div>
      </td>

      <td data-label="Trades" className={`${styles.tdRight} ${styles.mono}`}>
        {fmtNum(entry.trades)}
      </td>
    </tr>
  );
}
