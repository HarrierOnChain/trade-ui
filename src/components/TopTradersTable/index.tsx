"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTopTraders } from "../../hooks/useTopTraders";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useSelectedToken } from "../../contexts/SelectedTokenContext";
import { useApp } from "../../contexts/AppContext";
import { formatAge, registerAge, unregisterAge } from "../../lib/ageRegistry";
import { fmtMcap, fmtNum, fmtUsd } from "../../lib/format";
import { Icon, SolSymbol, Tooltip } from "../atoms";
import { WalletLabel } from "../../hooks/useWalletLabels";
import { FundingBadge } from "../FundingBadge";
import { useFunding } from "../../hooks/useFunding";
import type { TopTrader } from "../../types";
import styles from "./styles.module.css";

const CHUNK = 30;
const COL_COUNT = 8;

interface Props {
  mint?: string | null;
  solPrice?: number;
  supply?: number;
  onAddressClick?: (address: string) => void;
}

export function TopTradersTable({
  mint: mintProp,
  solPrice = 0,
  supply = 1_000_000_000,
  onAddressClick,
}: Props) {
  const { selectedMint } = useSelectedToken();
  const mint = mintProp ?? selectedMint;
  const { traders, loading, error } = useTopTraders(mint);

  const [visible, setVisible] = useState(CHUNK);
  useEffect(() => { setVisible(CHUNK); }, [mint]);

  const sliced = useMemo(() => traders.slice(0, visible), [traders, visible]);
  const hasMore = visible < traders.length;

  const visibleAddrs = useMemo(() => sliced.map((t) => t.trader), [sliced]);
  useFunding(visibleAddrs);

  const { sentinelRef, rootRef } = useInfiniteScroll<HTMLTableRowElement, HTMLDivElement>(
    () => setVisible((v) => Math.min(v + CHUNK, traders.length)),
    hasMore && !loading
  );

  return (
    <div className={styles.container}>
      <div className={styles.tableWrap} ref={rootRef}>
        <table className={`${styles.table} table-cards`}>
          <colgroup>
            <col className={styles.cRank} />
            <col className={styles.cWallet} />
            <col className={styles.cFunding} />
            <col className={styles.cNum} />
            <col className={styles.cNum} />
            <col className={styles.cPnl} />
            <col className={styles.cHeld} />
            <col className={styles.cAge} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.thLeft}>#</th>
              <th className={styles.thLeft}>Wallet</th>
              <th className={styles.thLeft}>Funding</th>
              <th className={styles.thRight}>Bought</th>
              <th className={styles.thRight}>Sold</th>
              <th className={styles.thRight}>R. PnL</th>
              <th className={styles.thRight}>Held</th>
              <th className={styles.thRight}>Age</th>
            </tr>
          </thead>
          <tbody>
            {error && <tr><td colSpan={COL_COUNT} className={styles.error}>{error}</td></tr>}
            {loading && Array.from({ length: 12 }).map((_, i) => (
              <tr key={i} className={styles.skRow}>
                {Array.from({ length: COL_COUNT }).map((__, j) => (
                  <td key={j}><div className="skeleton" style={{ height: 12, borderRadius: 3 }} /></td>
                ))}
              </tr>
            ))}
            {!loading && traders.length === 0 && !error && (
              <tr>
                <td colSpan={COL_COUNT} className={styles.empty}>
                  <span className={styles.emptyIcon}>{Icon.chart(20)}</span>
                  {mint ? "No trader data yet" : "Select a token"}
                </td>
              </tr>
            )}
            {sliced.map((t, i) => (
              <TraderRow
                key={t.trader}
                rank={i + 1}
                trader={t}
                solPrice={solPrice}
                supply={supply}
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

const TraderRow = React.memo(function TraderRow({
  rank,
  trader,
  solPrice,
  supply,
  onAddressClick,
}: {
  rank: number;
  trader: TopTrader;
  solPrice: number;
  supply: number;
  onAddressClick?: (a: string) => void;
}) {
  const { openWalletModal } = useApp();
  const [copied, setCopied] = useState(false);

  function copyAddress() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(trader.trader).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const buySol        = trader.buySol        ?? 0;
  const sellSol       = trader.sellSol       ?? 0;
  const boughtTokens  = trader.boughtTokens  ?? 0;
  const soldTokens    = trader.soldTokens    ?? 0;
  const pnlSol        = trader.pnlSol        ?? (sellSol - buySol);
  const hasTokenData  = boughtTokens > 0 || soldTokens > 0;
  const hasSolData    = buySol > 0 || sellSol > 0;

  const remainingTokens = Math.max(0, boughtTokens - soldTokens);
  const remainingPct    = supply > 0 && hasTokenData ? (remainingTokens / supply) * 100 : 0;
  const barColor        = remainingPct > 10 ? "var(--sell)" : remainingPct > 5 ? "var(--warn)" : "var(--accent)";

  const resolvedSupply = supply > 0 ? supply : 1_000_000_000;
  const avgBuyMcap  = trader.avgBuyPrice  > 0 && solPrice > 0 ? trader.avgBuyPrice  * resolvedSupply * solPrice : 0;
  const avgSellMcap = trader.avgSellPrice > 0 && solPrice > 0 ? trader.avgSellPrice * resolvedSupply * solPrice : 0;

  const isProfit = pnlSol >= 0;

  const entryDelay = trader.entryDelaySeconds;
  const showEntry  = entryDelay != null && entryDelay >= 0 && entryDelay <= 60;
  const entryDelayLabel = showEntry ? `${entryDelay}s` : "";

  const rankClass =
    rank === 1 ? styles.rankTop :
    rank <= 3  ? styles.rankHigh :
    "";

  return (
    <tr className={styles.row}>
      <td data-label="#" className={`${styles.rank} ${rankClass}`}>#{rank}</td>

      <td data-label="Wallet" className={styles.tdLeft}>
        <div className={styles.walletRow}>
          <Tooltip content={`Open wallet ${trader.trader}`} mono>
            <button
              type="button"
              className={`${styles.addrText} ${styles.addrBtn}`}
              onClick={() => openWalletModal(trader.trader)}
            >
              <WalletLabel address={trader.trader} chars={4} />
            </button>
          </Tooltip>
          <span className={styles.walletFlags}>
            {(trader.bundleTrades ?? 0) > 0 && (
              <Tooltip content={`${trader.bundleTrades} bundle trades`}>
                <span className={styles.flag}>{Icon.bundle(11)}</span>
              </Tooltip>
            )}
            {showEntry ? (
              <Tooltip content={`Entered ${entryDelayLabel} after deploy`}>
                <span className={`${styles.flag} ${styles.flagSniper}`}>
                  {Icon.sniper(11)}
                  {entryDelayLabel}
                </span>
              </Tooltip>
            ) : (trader.sniperTrades ?? 0) > 0 && (
              <Tooltip content={`${trader.sniperTrades} sniper trades`}>
                <span className={`${styles.flag} ${styles.flagSniper}`}>{Icon.sniper(11)}</span>
              </Tooltip>
            )}
            {(trader.proTrades ?? 0) > 0 && (
              <Tooltip content={`${trader.proTrades} pro trades`}>
                <span className={`${styles.flag} ${styles.flagPro}`}>{Icon.pro(11)}</span>
              </Tooltip>
            )}
          </span>
          <span className={`${styles.rowActions} row-actions-hover`}>
            {onAddressClick && (
              <Tooltip content="Filter trades by this wallet">
                <button className={styles.iconBtn} onClick={() => onAddressClick(trader.trader)}>
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
                onClick={() => openWalletModal(trader.trader)}
              >
                {Icon.ext(10)}
              </button>
            </Tooltip>
          </span>
        </div>
      </td>

      <td data-label="Funding" className={styles.tdLeft}>
        <div className={styles.fundingCell}>
          <FundingBadge address={trader.trader} size="xs" />
        </div>
      </td>

      <td data-label="Bought" className={styles.tdRight}>
        <div className={styles.stack}>
          <span className={styles.primary}>
            {boughtTokens > 0 && buySol > 0 ? (
              <>{fmtNum(boughtTokens)} / <span className={styles.sol}><SolSymbol size={10} /></span>{buySol.toFixed(2)}</>
            ) : boughtTokens > 0 ? (
              fmtNum(boughtTokens)
            ) : buySol > 0 ? (
              <><span className={styles.sol}><SolSymbol size={10} /></span>{buySol.toFixed(2)}</>
            ) : (
              <span className={styles.dim}>–</span>
            )}
          </span>
          {(trader.totalBuys > 0 || avgBuyMcap > 0) && (
            <span className={styles.sub}>
              {trader.totalBuys > 0 && <><span className={styles.buyCount}>{trader.totalBuys}</span> buys</>}
              {trader.totalBuys > 0 && avgBuyMcap > 0 && <> · </>}
              {avgBuyMcap > 0 && <>{fmtMcap(avgBuyMcap)}</>}
            </span>
          )}
        </div>
      </td>

      <td data-label="Sold" className={styles.tdRight}>
        <div className={styles.stack}>
          <span className={styles.primary}>
            {soldTokens > 0 && sellSol > 0 ? (
              <>{fmtNum(soldTokens)} / <span className={styles.sol}><SolSymbol size={10} /></span>{sellSol.toFixed(2)}</>
            ) : soldTokens > 0 ? (
              fmtNum(soldTokens)
            ) : sellSol > 0 ? (
              <><span className={styles.sol}><SolSymbol size={10} /></span>{sellSol.toFixed(2)}</>
            ) : (
              <span className={styles.dim}>–</span>
            )}
          </span>
          {(trader.totalSells > 0 || avgSellMcap > 0) && (
            <span className={styles.sub}>
              {trader.totalSells > 0 && <><span className={styles.sellCount}>{trader.totalSells}</span> sells</>}
              {trader.totalSells > 0 && avgSellMcap > 0 && <> · </>}
              {avgSellMcap > 0 && <>{fmtMcap(avgSellMcap)}</>}
            </span>
          )}
        </div>
      </td>

      <td data-label="R. PnL" className={`${styles.tdRight} ${hasSolData ? (isProfit ? styles.profit : styles.loss) : styles.mono}`}>
        {hasSolData
          ? <><span className={styles.sol}><SolSymbol size={10} /></span>{isProfit ? "+" : "−"}{Math.abs(pnlSol).toFixed(3)}</>
          : <span className={styles.dim}>–</span>
        }
      </td>

      <td data-label="Held" className={styles.tdRight}>
        <div className={styles.stack}>
          {!hasTokenData ? (
            <span className={styles.dim}>–</span>
          ) : remainingTokens >= 1 ? (
            <>
              <span className={styles.primary}>{fmtNum(remainingTokens)}</span>
              <div className={styles.pctWrap}>
                <div className={styles.pctBarBg}>
                  <div className={styles.pctBar} style={{ width: `${Math.min(remainingPct, 100)}%`, background: barColor }} />
                </div>
                <span className={styles.pctLabel} style={{ color: barColor }}>{remainingPct.toFixed(2)}%</span>
              </div>
            </>
          ) : (
            <span className={styles.sub}>exited</span>
          )}
        </div>
      </td>

      <td data-label="Age" className={`${styles.tdRight} ${styles.mono}`}>
        {trader.firstTrade ? <AgeInline ts={trader.firstTrade} /> : <span className={styles.dim}>–</span>}
      </td>
    </tr>
  );
});

function AgeInline({ ts, className }: { ts: string | number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const tsMs = typeof ts === "number" ? ts : new Date(ts).getTime();
  useEffect(() => {
    const el = ref.current;
    if (!el || !isFinite(tsMs)) return;
    el.textContent = formatAge(tsMs);
    registerAge(el, tsMs);
    return () => unregisterAge(el);
  }, [tsMs]);
  return (
    <span ref={ref} className={className}>
      {isFinite(tsMs) ? formatAge(tsMs) : "–"}
    </span>
  );
}
