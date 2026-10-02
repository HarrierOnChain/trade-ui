// Synthetic launch-preview builder shared by the Create-Token wizard's live
// preview panel. Given the planned buyer wallets (in order), it walks the
// pump.fun constant-product bonding curve and produces a `PreviewSnapshot`
// (trades + holders + tokenInfo + livePrice) that the chart/tables hooks read
// via the previewData registry — so the chart reacts as buyers are edited.
//
// Buyer-only (no market-making draft previews) to stay simple; the wizard's
// chart is a planning aid, not a full simulation.
import type { Trade, Holder, TokenEvent } from "../types";
import type { LivePrice } from "../hooks/useLiveTradePrices";
import type { PreviewSnapshot } from "./previewData";

export const BC_VIRT_SOL = 30;
export const BC_VIRT_TOKENS = 1_073_000_000;
export const PREVIEW_SUPPLY = 1_000_000_000;

export interface PreviewBuyer { address: string; amount: string }

export interface BuildDeploySnapshotArgs {
  mint: string;
  name: string;
  symbol: string;
  image: string | null;
  dex: string;
  buyers: PreviewBuyer[];
  /** Fixed epoch captured once at mount so preview timestamps never re-anchor. */
  epochMs: number;
  sendMode: "bundle" | "stagger";
  /** Average per-buy delay (ms) for stagger-mode spacing. */
  staggerStepMs: number;
}

const BUNDLE_TX_CAP = 5;
const BUNDLE_STEP_MS = 2_000;

/** Per-buyer derived tokens + execution price, walking the curve in order. */
export function deriveBuyerRows(buyers: PreviewBuyer[]): Array<{ tokens: number; priceSol: number }> {
  let cumQuote = 0;
  let prevTokens = 0;
  return buyers.map((w) => {
    const sol = parseFloat(w.amount) || 0;
    if (sol <= 0) return { tokens: 0, priceSol: 0 };
    cumQuote += sol;
    const tokensAtCum = (BC_VIRT_TOKENS * cumQuote) / (BC_VIRT_SOL + cumQuote);
    const tokens = Math.max(0, tokensAtCum - prevTokens);
    prevTokens = tokensAtCum;
    return { tokens, priceSol: tokens > 0 ? sol / tokens : 0 };
  });
}

export function buildDeploySnapshot(args: BuildDeploySnapshotArgs): PreviewSnapshot {
  const { mint, name, symbol, image, dex, buyers, epochMs, sendMode, staggerStepMs } = args;
  const totalSol = buyers.reduce((acc, w) => acc + (parseFloat(w.amount) || 0), 0);

  let cumQuote = 0;
  let prevTokens = 0;
  const trades: Trade[] = [];
  const holderAmounts: Array<{ address: string; tokens: number; solSpent: number }> = [];

  for (const w of buyers) {
    const sol = parseFloat(w.amount) || 0;
    if (sol <= 0) continue;
    cumQuote += sol;
    const tokensAtCum = (BC_VIRT_TOKENS * cumQuote) / (BC_VIRT_SOL + cumQuote);
    const tokens = Math.max(0, tokensAtCum - prevTokens);
    prevTokens = tokensAtCum;
    const price = tokens > 0 ? sol / tokens : 0;
    trades.push({
      signature: `preview-${mint}-${trades.length}`,
      tokenMint: mint,
      signer: w.address,
      transactionType: "buy",
      tokensAmount: tokens,
      avgPrice: price,
      solAmount: sol,
      timestamp: 0, // stamped below
      isBundle: false, isSniper: false,
    });
    holderAmounts.push({ address: w.address, tokens, solSpent: sol });
  }

  // Stamp timestamps on the fixed epoch. Bundle: groups of 5 land same-slot,
  // next bundle ~2s later. Stagger: each buy spaced by the configured delay.
  for (let i = 0; i < trades.length; i++) {
    trades[i]!.timestamp = sendMode === "stagger"
      ? epochMs + i * Math.max(1_000, staggerStepMs)
      : epochMs + Math.floor(i / BUNDLE_TX_CAP) * BUNDLE_STEP_MS;
  }

  const lastTrade = trades[trades.length - 1];
  const liveSolPrice = lastTrade?.avgPrice ?? 0;
  const totalVolume = trades.reduce((acc, t) => acc + (t.solAmount ?? 0), 0);

  const holders: Holder[] = holderAmounts
    .sort((a, b) => b.tokens - a.tokens)
    .map((h, i) => ({
      address: h.address,
      amount: h.tokens,
      percentage: (h.tokens / BC_VIRT_TOKENS) * 100,
      rank: i + 1,
      bought: h.tokens, sold: 0,
      buySol: h.solSpent, sellSol: 0,
      trades: 1, buyCount: 1, sellCount: 0,
      firstTrade: new Date(epochMs).toISOString(),
      lastTrade: new Date(epochMs).toISOString(),
      isLiquidityPool: false,
    }));

  const tokenInfo: TokenEvent = {
    mint_address: mint,
    name: name || "Untitled token",
    symbol: symbol || "TKR",
    dex,
    image: image || null,
    twitter: null, telegram: null, website: null,
    lastPrice: liveSolPrice,
    marketCap: 0,
    creatorBuyPrice: liveSolPrice,
    creatorBuySol: totalSol,
    creatorBuyTokens: prevTokens,
    signer: buyers[0]?.address ?? "",
    holders: holders.length,
    tradeCount: trades.length,
    totalSolVolume: totalVolume,
    buyCount: trades.length, sellCount: 0,
    uniqueTraders: holders.length,
    created_at: new Date(epochMs).toISOString(),
  };

  const livePrice: LivePrice | null = liveSolPrice > 0
    ? {
        price: liveSolPrice,
        prices: trades.map((t) => t.avgPrice ?? 0),
        ts: epochMs,
        volumeSol: totalVolume, feesSol: 0,
        tradeCount: trades.length,
        uniqueTraders: holders.length,
        bundleAdd: 0, sniperAdd: 0,
      }
    : null;

  return { tokenInfo, trades, holders, livePrice, supply: PREVIEW_SUPPLY };
}
