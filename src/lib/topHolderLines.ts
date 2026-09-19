import type { Holder } from "../types";

export interface Top10HolderAvgPrices {
  /** Volume-weighted avg buy price across top 10 holders (SOL per token). */
  avgBuySol: number | null;
  /** Volume-weighted avg sell price across top 10 holders (SOL per token). */
  avgSellSol: number | null;
}

/** Aggregate buy/sell averages for the top 10 non-LP holders by balance. */
export function computeTop10HolderAvgPrices(holders: Holder[]): Top10HolderAvgPrices {
  const top10 = holders.filter((h) => !h.isLiquidityPool).slice(0, 10);

  let buyPriceSum = 0;
  let buyWeight = 0;
  let sellPriceSum = 0;
  let sellWeight = 0;

  for (const h of top10) {
    const bought = h.bought ?? 0;
    const sold = h.sold ?? 0;
    const buySol = h.buySol ?? 0;
    const sellSol = h.sellSol ?? 0;
    if (bought > 0 && buySol > 0) {
      buyPriceSum += (buySol / bought) * buySol;
      buyWeight += buySol;
    }
    if (sold > 0 && sellSol > 0) {
      sellPriceSum += (sellSol / sold) * sellSol;
      sellWeight += sellSol;
    }
  }

  return {
    avgBuySol: buyWeight > 0 ? buyPriceSum / buyWeight : null,
    avgSellSol: sellWeight > 0 ? sellPriceSum / sellWeight : null,
  };
}
