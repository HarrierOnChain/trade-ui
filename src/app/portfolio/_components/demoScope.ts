/**
 * Demo-wallet scope aggregation.
 *
 * Demo wallets paper-trade with live prices; the backend returns each one's
 * state as a `DemoWalletSummary`. The portfolio renders demo data through the
 * exact same Holdings / Activity / Perps surfaces as real wallets, so this
 * module projects one-or-many demo summaries into the regular scope shapes
 * (TokenHolding / Trade / PerpScopePosition) and sums them.
 *
 * Keeping the (slightly fiddly) trade reconstruction here keeps page.tsx
 * about orchestration, not data-shape gymnastics.
 */

import type { DemoWalletSummary } from "../../../api/backend";
import type { PerpScopePosition } from "../../../hooks/usePortfolioPerps";
import type { Trade, TokenHolding } from "../../../types";

export interface DemoScope {
  holdings: TokenHolding[];
  trades: Trade[];
  perps: PerpScopePosition[];
  /** Combined paper SOL balance across every demo wallet. */
  solBalance: number;
  usdcBalance: number;
  /** Combined realized PnL (SOL) / trade count / volume (SOL). */
  realizedPnlSol: number;
  totalTrades: number;
  totalVolumeSol: number;
  /** Open-perp roll-up, matching the live KPI formula. */
  perpOpenCount: number;
  perpOpenNotionalUsd: number;
}

interface DemoPart {
  summary: DemoWalletSummary;
  /** Owning demo wallet's pubkey — stamped onto each synthesized row. */
  pubkey: string;
}

/* ── One summary → scope shapes ──────────────────────────────────────── */

function holdingsOf(summary: DemoWalletSummary): TokenHolding[] {
  return summary.holdings.map((h) => ({
    mint: h.mint,
    amount: h.tokens,
    decimals: 9,
    symbol: h.symbol ?? undefined,
  }));
}

function tradesOf(summary: DemoWalletSummary, pubkey: string): Trade[] {
  return summary.trades.map((t) => {
    const tsMs = Date.parse(t.createdAt);
    const holdingMatch = summary.holdings.find((h) => h.mint === t.mint);
    const fillPrice = t.priceSolPerToken ?? holdingMatch?.entryPriceSol ?? 0;
    const fallbackTotalTokens = holdingMatch?.tokens ?? 0;
    let tokensAmount = t.tokensAmount ?? 0;
    let solAmount = 0;
    if (t.side === "buy") {
      solAmount = t.amountSol ?? 0;
      if (tokensAmount <= 0) tokensAmount = fillPrice > 0 ? solAmount / fillPrice : 0;
    } else {
      if (t.amountSol != null) solAmount = t.amountSol;
      if (tokensAmount <= 0) {
        const pct = (t.sellPct ?? 0) / 100;
        tokensAmount = fallbackTotalTokens * pct;
      }
      if (solAmount <= 0) solAmount = tokensAmount * fillPrice;
    }
    return {
      signature: t.signature ?? t.id,
      tokenMint: t.mint,
      signer: pubkey,
      transactionType: t.side,
      tokensAmount,
      avgPrice: fillPrice,
      solAmount,
      timestamp: tsMs,
    };
  });
}

function perpsOf(summary: DemoWalletSummary, pubkey: string): PerpScopePosition[] {
  return summary.perpPositions
    .filter((p) => p.status === "open")
    .map((p) => ({
      market_id: p.marketId,
      venue: (p.marketId.split(":")[0] === "phoenix" ? "phoenix" : "jup") as "phoenix" | "jup",
      position_pubkey: `demo:${p.id}`,
      side: p.side,
      size: Math.abs(p.baseUnits) * p.entryPriceUsd * 1_000_000,
      entry_price: Math.round(p.entryPriceUsd * 1_000_000),
      collateral: Math.round(p.collateralUsd * 1_000_000),
      unrealized_pnl: 0,
      slot: 0,
      snapshot_ts: Date.parse(p.openedAt),
      is_open: true,
      wallet: pubkey,
    }));
}

/* ── Aggregate across all demo wallets ───────────────────────────────── */

export function aggregateDemoScopes(parts: DemoPart[]): DemoScope {
  // Holdings merge by mint (a token can sit in more than one paper wallet).
  const holdingByMint = new Map<string, TokenHolding>();
  const trades: Trade[] = [];
  const perps: PerpScopePosition[] = [];
  let solBalance = 0;
  let usdcBalance = 0;
  let realizedPnlSol = 0;
  let totalTrades = 0;
  let totalVolumeSol = 0;
  let perpOpenCount = 0;
  let perpOpenNotionalUsd = 0;

  for (const { summary, pubkey } of parts) {
    for (const h of holdingsOf(summary)) {
      const prev = holdingByMint.get(h.mint);
      if (prev) prev.amount += h.amount;
      else holdingByMint.set(h.mint, { ...h });
    }
    trades.push(...tradesOf(summary, pubkey));
    perps.push(...perpsOf(summary, pubkey));

    solBalance += summary.solBalance ?? 0;
    usdcBalance += summary.usdcBalance ?? 0;
    realizedPnlSol += summary.stats.realizedPnlSol ?? 0;
    totalTrades += summary.stats.totalTrades ?? 0;
    totalVolumeSol += summary.stats.totalVolumeSol ?? 0;

    for (const p of summary.perpPositions) {
      if (p.status !== "open") continue;
      perpOpenCount += 1;
      perpOpenNotionalUsd += p.collateralUsd * (p.leverageBps / 10_000);
    }
  }

  return {
    holdings: [...holdingByMint.values()],
    trades,
    perps,
    solBalance,
    usdcBalance,
    realizedPnlSol,
    totalTrades,
    totalVolumeSol,
    perpOpenCount,
    perpOpenNotionalUsd,
  };
}
