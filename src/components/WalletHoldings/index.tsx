"use client";
import React from "react";
import { useWalletHoldings } from "../../hooks/useWalletHoldings";
import { TokenIdentity } from "../atoms";
import styles from "../HoldersTable/styles.module.css";

interface Props {
  address: string | null;
  onTokenClick?: (mint: string) => void;
}

function fmtAmount(v: number): string {
  if (!Number.isFinite(v) || v < 0) return "—";
  if (v === 0) return "0";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(6);
}

export function WalletHoldings({ address, onTokenClick }: Props) {
  const { holdings, loading, error, refresh } = useWalletHoldings(address);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>HOLDINGS</span>
        <span className={styles.count}>{holdings.length}</span>
        <button className={styles.refreshBtn} onClick={refresh} aria-label="Refresh">↻</button>
      </div>

      <div className={`${styles.tableWrap} scroll-x`}>
        {/* `table-cards` flips this to stacked label/value cards and neutralises
            the module's min-width at ≤480px (inert above). */}
        <table className={`${styles.table} table-cards`}>
          <thead>
            <tr>
              <th className={styles.rank}>#</th>
              <th>Token</th>
              <th style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {error && <tr><td data-label="" colSpan={3} className={styles.error}>{error}</td></tr>}
            {loading && Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className={styles.skRow}>
                <td data-label="" colSpan={3}><div className="skeleton" style={{ height: 10, borderRadius: 3 }} /></td>
              </tr>
            ))}
            {!loading && !error && holdings.length === 0 && (
              <tr><td data-label="" colSpan={3} className={styles.empty}>{address ? "No holdings" : "Enter a wallet address"}</td></tr>
            )}
            {holdings.map((h, i) => (
              <tr key={h.mint || i} className={styles.row}>
                <td data-label="" className={styles.rank}>{i + 1}</td>
                <td data-label="Token">
                  <TokenIdentity
                    mint={h.mint}
                    symbol={h.symbol}
                    name={h.name}
                    image={h.image}
                    showImage
                    compact
                    size="xs"
                    onOpen={onTokenClick}
                    chartToken={{ mint_address: h.mint, name: h.name ?? "", symbol: h.symbol ?? "", dex: "", created_at: "" }}
                  />
                </td>
                <td data-label="Amount" className={styles.mono} style={{ textAlign: "right" }}>
                  {fmtAmount(h.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
