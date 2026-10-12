"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useHolders } from "../../hooks/useHolders";
import { useTokenInfo } from "../../hooks/useTokenInfo";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { useApp } from "../../contexts/AppContext";
import { fmtNum, fmtUsd } from "../../lib/format";
import { Icon, SolSymbol, Tooltip } from "../atoms";
import { WalletLabel } from "../../hooks/useWalletLabels";
import type { Holder } from "../../types";
import styles from "./styles.module.css";

const CHUNK = 30;

/** What a holder that is not a person is (the API's `Holder.kind`). */
const KIND_TAG: Partial<Record<NonNullable<Holder["kind"]>, string>> = {
  pool: "LP",
  curve: "Curve",
  burn: "Burn",
  program: "Program",
  exchange: "Exchange",
};
const COL_COUNT = 6;

interface Props {
  mint?: string | null;
  solPrice?: number;
  bundleSigners?: Set<string>;
  sniperSigners?: Set<string>;
  onAddressClick?: (address: string) => void;
}

export function HoldersTable({
  mint: mintProp,
  solPrice = 0,
  bundleSigners,
  sniperSigners,
  onAddressClick,
}: Props) {
  const { selectedMint } = useSelectedToken();
  const mint = mintProp ?? selectedMint;
  const { holders, currentPriceSol, loading, error } = useHolders(mint);
  const { info } = useTokenInfo(mint);
  const mcap      = info?.marketCap ?? 0;
  const lastPrice = currentPriceSol > 0 ? currentPriceSol : (info?.lastPrice ?? 0);

  const [visible, setVisible] = useState(CHUNK);
  useEffect(() => { setVisible(CHUNK); }, [mint]);

  const sliced = useMemo(() => holders.slice(0, visible), [holders, visible]);
  const hasMore = visible < holders.length;

  const { sentinelRef, rootRef } = useInfiniteScroll<HTMLTableRowElement, HTMLDivElement>(
    () => setVisible((v) => Math.min(v + CHUNK, holders.length)),
    hasMore && !loading
  );

  return (
    <div className={styles.container}>
      <div className={styles.tableWrap} ref={rootRef}>
        <table className={`${styles.table} table-cards`}>
          <colgroup>
            <col className={styles.cRank} />
            <col className={styles.cWallet} />
            <col className={styles.cNum} />
            <col className={styles.cNum} />
            <col className={styles.cPnl} />
            <col className={styles.cHeld} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.thLeft}>#</th>
              <th className={styles.thLeft}>Wallet</th>
              <th className={styles.thRight}>Bought</th>
              <th className={styles.thRight}>Sold</th>
              <th className={styles.thRight}>U. PnL</th>
              <th className={styles.thRight}>Held</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr><td colSpan={COL_COUNT} className={styles.error}>{error}</td></tr>
            )}
            {loading && Array.from({ length: 12 }).map((_, i) => (
              <tr key={i} className={styles.skRow}>
                {Array.from({ length: COL_COUNT }).map((__, j) => (
                  <td key={j}><div className="skeleton" style={{ height: 12, borderRadius: 3 }} /></td>
                ))}
              </tr>
            ))}
            {!loading && holders.length === 0 && !error && (
              <tr>
                <td colSpan={COL_COUNT} className={styles.empty}>
                  <span className={styles.emptyIcon}>{Icon.chart(20)}</span>
                  {mint ? "No holder data yet" : "Select a token"}
                </td>
              </tr>
            )}
            {sliced.map((h) => (
              <HolderRow
                key={h.address}
                holder={h}
                mcap={mcap}
                lastPrice={lastPrice}
                solPrice={solPrice}
                isBundle={bundleSigners?.has(h.address) ?? false}
                isSniper={sniperSigners?.has(h.address) ?? false}
                onAddressClick={onAddressClick}
              />
            ))}
            {hasMore && (
              <tr ref={sentinelRef}>
                <td colSpan={COL_COUNT} className={styles.sentinel} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const HolderRow = React.memo(function HolderRow({
  holder,
  mcap,
  lastPrice,
  solPrice,
  isBundle,
  isSniper,
  onAddressClick,
}: {
  holder: Holder;
  mcap: number;
  lastPrice: number;
  solPrice: number;
  isBundle: boolean;
  isSniper: boolean;
  onAddressClick?: (a: string) => void;
}) {
  const { openWalletModal } = useApp();
  const [copied, setCopied] = useState(false);

  function copyAddress() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(holder.address).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const pct = holder.percentage ?? 0;
  const barColor =
    pct > 10 ? "var(--sell)" : pct > 5 ? "var(--warn)" : "var(--accent)";

  const buySol    = holder.buySol    ?? 0;
  const sellSol   = holder.sellSol   ?? 0;
  const buyCount  = holder.buyCount  ?? 0;
  const sellCount = holder.sellCount ?? 0;

  const currentValueUsd =
    lastPrice > 0 && solPrice > 0
      ? holder.amount * lastPrice * solPrice
      : mcap > 0
      ? (mcap * pct) / 100
      : holder.valueUsd ?? 0;
  // The API's unrealized PnL for the holding (no per-holder cost basis here).
  const pnlUsd   = holder.unrealizedPnlUsd ?? 0;
  const pnlKnown = holder.unrealizedPnlUsd != null;

  const isProfit = pnlUsd >= 0;

  const rankClass =
    holder.rank === 1 ? styles.rankTop :
    holder.rank <= 3  ? styles.rankHigh :
    "";

  return (
    <tr className={styles.row}>
      <td data-label="#" className={`${styles.rank} ${rankClass}`}>#{holder.rank}</td>

      <td data-label="Wallet" className={styles.tdLeft}>
        <div className={styles.walletRow}>
          <Tooltip content={`Open wallet ${holder.address}`} mono>
            <button
              type="button"
              className={`${styles.addrText} ${styles.addrBtn}`}
              onClick={() => openWalletModal(holder.address)}
            >
              <WalletLabel address={holder.address} chars={4} />
            </button>
          </Tooltip>
          <span className={styles.walletFlags}>
            {holder.kind && KIND_TAG[holder.kind] && (
              <span className={styles.lpTag}>{KIND_TAG[holder.kind]}</span>
            )}
            {isBundle && (
              <Tooltip content="Bundle trader">
                <span className={styles.flag}>{Icon.bundle(11)}</span>
              </Tooltip>
            )}
            {isSniper && (
              <Tooltip content="Sniper trader">
                <span className={`${styles.flag} ${styles.flagSniper}`}>{Icon.sniper(11)}</span>
              </Tooltip>
            )}
          </span>
          <span className={`${styles.rowActions} row-actions-hover`}>
            {onAddressClick && (
              <Tooltip content="Filter trades by this wallet">
                <button className={styles.iconBtn} onClick={() => onAddressClick(holder.address)}>
                  {Icon.filter(11)}
                </button>
              </Tooltip>
            )}
            <Tooltip content={copied ? "Copied" : "Copy address"}>
              <button className={styles.iconBtn} onClick={copyAddress}>
                {copied ? Icon.check(11) : Icon.copy(11)}
              </button>
            </Tooltip>
            <Tooltip content="Open wallet details">
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => openWalletModal(holder.address)}
              >
                {Icon.ext(10)}
              </button>
            </Tooltip>
          </span>
        </div>
      </td>

      <td data-label="Bought" className={styles.tdRight}>
        <div className={styles.stack}>
          <span className={styles.primary}>
            {buySol > 0 ? (
              <><span className={styles.sol}><SolSymbol size={10} /></span>{buySol.toFixed(2)}</>
            ) : (
              <span className={styles.dim}>–</span>
            )}
          </span>
          {buyCount > 0 && (
            <span className={styles.sub}>
              <span className={styles.buyCount}>{buyCount}</span> buys
            </span>
          )}
        </div>
      </td>

      <td data-label="Sold" className={styles.tdRight}>
        <div className={styles.stack}>
          <span className={styles.primary}>
            {sellSol > 0 ? (
              <><span className={styles.sol}><SolSymbol size={10} /></span>{sellSol.toFixed(2)}</>
            ) : (
              <span className={styles.dim}>–</span>
            )}
          </span>
          {sellCount > 0 && (
            <span className={styles.sub}>
              <span className={styles.sellCount}>{sellCount}</span> sells
            </span>
          )}
        </div>
      </td>

      <td data-label="U. PnL" className={`${styles.tdRight} ${pnlKnown ? (isProfit ? styles.profit : styles.loss) : styles.mono}`}>
        {pnlKnown ? `${isProfit ? "+" : "−"}${fmtUsd(Math.abs(pnlUsd))}` : <span className={styles.dim}>–</span>}
      </td>

      <td data-label="Held" className={styles.tdRight}>
        <div className={styles.stack}>
          <span className={styles.primary}>
            {currentValueUsd > 0 ? fmtUsd(currentValueUsd) : fmtNum(holder.amount)}
          </span>
          <div className={styles.pctWrap}>
            <div className={styles.pctBarBg}>
              <div
                className={styles.pctBar}
                style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
              />
            </div>
            <span className={styles.pctLabel} style={{ color: barColor }}>
              {pct.toFixed(2)}%
            </span>
          </div>
        </div>
      </td>
    </tr>
  );
});
