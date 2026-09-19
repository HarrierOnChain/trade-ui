import type { DemoWalletSummary } from "../api/backend";

export interface DemoMintTradeTotals {
  bought: number;
  sold: number;
  tokens: number;
}

/** Aggregate bought/sold SOL and remaining token balance for one mint on a demo wallet. */
export function demoMintTradeTotals(
  summary: DemoWalletSummary,
  mint: string,
): DemoMintTradeTotals {
  const holdingRow = summary.holdings.find((h) => h.mint === mint);
  const fallbackEntry = holdingRow?.entryPriceSol ?? 0;
  const fallbackTotal = holdingRow?.tokens ?? 0;

  let bought = 0;
  let sold = 0;
  for (const t of summary.trades) {
    if (t.mint !== mint) continue;
    const fillPrice = t.priceSolPerToken ?? fallbackEntry;
    if (t.side === "buy") {
      bought += t.amountSol ?? 0;
      continue;
    }
    let solAmount = t.amountSol ?? 0;
    if (solAmount <= 0) {
      let tokensAmount = t.tokensAmount ?? 0;
      if (tokensAmount <= 0) {
        const pct = (t.sellPct ?? 0) / 100;
        tokensAmount = fallbackTotal * pct;
      }
      solAmount = tokensAmount * fillPrice;
    }
    sold += solAmount;
  }

  return {
    bought,
    sold,
    tokens: holdingRow?.tokens ?? 0,
  };
}

/** Open token count and cost-basis price for mark-to-market on demo holdings. */
export function demoMintHoldingSnapshot(
  summary: DemoWalletSummary,
  mint: string,
): { tokens: number; entryPriceSol: number } {
  const row = summary.holdings.find((h) => h.mint === mint);
  return {
    tokens: row?.tokens ?? 0,
    entryPriceSol: row?.entryPriceSol ?? 0,
  };
}
