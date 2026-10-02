"use client";
import React from "react";
import { useWalletTrades } from "../../hooks/useWalletTrades";
import { TokenIdentity } from "../atoms";
import { tradeIdentityKey, tradeNative } from "../../lib/trades";
import type { Trade } from "../../types";
import styles from "../TradesTable/styles.module.css";

interface Props {
  address: string | null;
  solPrice?: number;
  limit?: number;
  onTokenClick?: (mint: string) => void;
}

function toMs(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!isNaN(n) && n > 0) return n > 1e15 ? n / 1000 : n > 1e12 ? n : n * 1000;
  return new Date(raw as string).getTime();
}

function fmtAge(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtTokens(v?: number) {
  if (!v) return "–";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

// Unknown volume is "–", never "0".
function fmtSol(t: Trade): string {
  const sol = tradeNative(t);
  return sol != null ? sol.toFixed(3) : "–";
}

function fmtUsd(t: Trade, solPrice: number): string {
  const sol = tradeNative(t);
  const usd = sol != null ? sol * solPrice : typeof t.usdValue === "number" ? t.usdValue : null;
  return usd != null && Number.isFinite(usd) ? `$${usd.toFixed(2)}` : "–";
}

export function WalletTrades({ address, solPrice = 0, limit = 50, onTokenClick }: Props) {
  const { trades, loading, error } = useWalletTrades(address, limit);

  return (
    <div className={styles.container}>
      <div className={`${styles.tableWrap} scroll-x`}>
        {/* `table-cards` flips this to stacked label/value cards and neutralises
            the module's min-width at ≤480px (inert above). */}
        <table className={`${styles.table} table-cards`}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Token</th>
              <th>SOL</th>
              <th>Tokens</th>
              {solPrice > 0 && <th>USD</th>}
            </tr>
          </thead>
          <tbody>
            {error && <tr><td data-label="" colSpan={6} className={styles.error}>{error}</td></tr>}
            {loading && Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className={styles.skRow}>
                {Array.from({ length: 6 }).map((__, j) => (
                  <td data-label="" key={j}><div className="skeleton" style={{ height: 10, borderRadius: 3 }} /></td>
                ))}
              </tr>
            ))}
            {!loading && !error && trades.length === 0 && (
              <tr><td data-label="" colSpan={6} className={styles.empty}>{address ? "No trades" : "Enter a wallet address"}</td></tr>
            )}
            {trades.map((t, i) => {
              const isBuy = t.transactionType === "buy";
              const mint = t.tokenMint;
              return (
                <tr
                  key={`${tradeIdentityKey(t)}:${i}`}
                  className={`${styles.tradeRow} ${isBuy ? styles.buy : styles.sell}`}
                >
                  <td data-label="Time" className={styles.time}>{fmtAge(toMs(t.timestamp))}</td>
                  <td data-label="Type" className={styles.typeCell}>
                    <span className={`${styles.badge} ${isBuy ? styles.buyBadge : styles.sellBadge}`}>
                      {isBuy ? "BUY" : "SELL"}
                    </span>
                  </td>
                  <td data-label="Token">
                    <TokenIdentity
                      mint={mint}
                      showImage
                      compact
                      size="xs"
                      onOpen={onTokenClick}
                      chartToken={{ mint_address: mint, name: "", symbol: "", dex: "", created_at: "" }}
                    />
                  </td>
                  <td data-label="SOL" className={styles.mono}>{fmtSol(t)}</td>
                  <td data-label="Tokens" className={styles.mono}>{fmtTokens(t.tokensAmount)}</td>
                  {solPrice > 0 && (
                    <td data-label="USD" className={styles.mono}>{fmtUsd(t, solPrice)}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
