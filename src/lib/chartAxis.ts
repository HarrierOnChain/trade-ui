/** Convert a SOL-per-token trade price to the chart y-axis scale. */
export function solPriceToChartAxis(
  avgPriceSol: number,
  opts: {
    currency: "usd" | "sol";
    display: "mcap" | "price";
    solPrice: number;
    supply: number;
  },
): number | undefined {
  if (!Number.isFinite(avgPriceSol) || avgPriceSol <= 0) return undefined;
  const { currency, display, solPrice, supply } = opts;
  const sup = supply > 0 ? supply : 1;
  if (currency === "usd" && display === "mcap") {
    return solPrice > 0 ? avgPriceSol * solPrice * sup : undefined;
  }
  if (currency === "usd" && display === "price") {
    return solPrice > 0 ? avgPriceSol * solPrice : undefined;
  }
  if (currency === "sol" && display === "mcap") {
    return avgPriceSol * sup;
  }
  return avgPriceSol;
}
