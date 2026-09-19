// Funding + risk estimation for the Create-Token wizard's Launch Settings step.
//
// Everything here is derived from OUR real deploy mechanics (explicit buyer
// wallets + amounts riding the pump.fun constant-product bonding curve) — no
// invented Proxima "front/back/holder" architecture. Numbers are honest
// estimates from the same curve constants the preview chart uses, so the panel
// always agrees with the candles.
import {
  BC_VIRT_SOL,
  BC_VIRT_TOKENS,
  PREVIEW_SUPPLY,
  deriveBuyerRows,
  type PreviewBuyer,
} from "./deployPreview";

/** SOL collected on the pump.fun curve at migration (curve completion). */
export const PUMP_MIGRATION_QUOTE_SOL = 85;
/** pump.fun trade fee, one side (buy OR sell). Round-trip ≈ 2×. */
const PUMP_FEE_RATE = 0.01;
/** Rent for mint + metadata + bonding-curve accounts, paid once by the dev. */
const CREATE_RENT_SOL = 0.02;
/** Per-buyer overhead: ATA rent + a base-fee/priority buffer. */
const PER_WALLET_OVERHEAD_SOL = 0.002;

export interface FundingInput {
  /** Buyer amounts as typed, in the selected quote (SOL or USDC). */
  buyers: PreviewBuyer[];
  quoteIsSol: boolean;
  /** SOL/USD spot; 0 when unknown (USD figures then null). */
  solPriceUsd: number;
  /** USD value of one quote unit (≈ solPriceUsd for SOL, ≈ 1 for USDC). */
  quotePriceUsd: number;
  /** Jito tip in SOL, applied once per bundle. */
  jitoTipSol: number;
  /** User platform fixed fee in SOL (flat tip to fee wallet on create tx). */
  platformFeeSol?: number;
}

export interface FundingEstimate {
  buyerCount: number;
  /** Total committed, in the chosen quote (what the user typed). */
  supplyCostQuote: number;
  /** Committed capital expressed in SOL (the funding line). */
  supplyCostSol: number;
  extraFundingSol: number;
  totalFundingSol: number;
  /** Unrecoverable capital if you dump on the curve before migration. */
  maxLossNoMigrationSol: number;
  /** Unrecoverable capital if the token migrates and you exit on the AMM. */
  maxLossMigrationSol: number;
  /** Projected market cap right after your bundle lands (USD). */
  estMarketCapUsd: number | null;
  /** Market cap at curve completion / migration (USD). */
  migrationMarketCapUsd: number | null;
}

/** Marginal token price (SOL) on the curve after `cumQuoteSol` has been spent. */
function marginalPriceSol(cumQuoteSol: number): number {
  const denom = BC_VIRT_SOL + cumQuoteSol;
  // price = dSOL/dTokens = (VIRT_SOL + q)^2 / (VIRT_SOL * VIRT_TOKENS)
  return (denom * denom) / (BC_VIRT_SOL * BC_VIRT_TOKENS);
}

export function estimateFunding(input: FundingInput): FundingEstimate {
  const { buyers, quoteIsSol, solPriceUsd, quotePriceUsd, jitoTipSol } = input;
  const platformFeeSol = input.platformFeeSol && input.platformFeeSol > 0 ? input.platformFeeSol : 0;

  const supplyCostQuote = buyers.reduce((a, b) => a + (parseFloat(b.amount) || 0), 0);
  // Convert committed capital to SOL for the funding math. USDC → SOL via spot.
  const supplyCostSol = quoteIsSol
    ? supplyCostQuote
    : solPriceUsd > 0
    ? (supplyCostQuote * quotePriceUsd) / solPriceUsd
    : 0;

  const buyerCount = buyers.filter((b) => (parseFloat(b.amount) || 0) > 0).length;
  const extraFundingSol =
    (jitoTipSol > 0 ? jitoTipSol : 0) +
    platformFeeSol +
    CREATE_RENT_SOL +
    PER_WALLET_OVERHEAD_SOL * Math.max(0, buyerCount);
  const totalFundingSol = supplyCostSol + extraFundingSol;

  // No migration: you can sell your supply straight back on the curve, so the
  // only capital you can't recover is round-trip fees + the fixed overhead.
  const maxLossNoMigrationSol = supplyCostSol * PUMP_FEE_RATE * 2 + extraFundingSol;
  // Migration: committed SOL seeds the AMM pool; exiting into the fresh pool
  // costs a full extra fee leg on top, so the worst-case exposure is larger.
  const maxLossMigrationSol = supplyCostSol * PUMP_FEE_RATE * 3 + extraFundingSol;

  // Projected mcap after the bundle: walk the curve with SOL-equivalent buys.
  const solBuyers: PreviewBuyer[] = quoteIsSol
    ? buyers
    : buyers.map((b) => ({
        address: b.address,
        amount: String(
          solPriceUsd > 0 ? ((parseFloat(b.amount) || 0) * quotePriceUsd) / solPriceUsd : 0,
        ),
      }));
  const rows = deriveBuyerRows(solBuyers);
  const lastPriceSol = [...rows].reverse().find((r) => r.priceSol > 0)?.priceSol ?? 0;
  const estMarketCapUsd =
    solPriceUsd > 0 && lastPriceSol > 0 ? lastPriceSol * PREVIEW_SUPPLY * solPriceUsd : null;

  const migrationPriceSol = marginalPriceSol(PUMP_MIGRATION_QUOTE_SOL);
  const migrationMarketCapUsd =
    solPriceUsd > 0 ? migrationPriceSol * PREVIEW_SUPPLY * solPriceUsd : null;

  return {
    buyerCount,
    supplyCostQuote,
    supplyCostSol,
    extraFundingSol,
    totalFundingSol,
    maxLossNoMigrationSol,
    maxLossMigrationSol,
    estMarketCapUsd,
    migrationMarketCapUsd,
  };
}
