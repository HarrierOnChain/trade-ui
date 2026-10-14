/**
 * What a Solana launch costs in SOL besides the buys themselves: the rent of
 * the accounts it creates, and the transactions' base and priority fees.
 *
 * The accounts and their sizes were measured on mainnet (2026-10-14) from
 * launches of each launchpad: Pump.fun create_v2 (Token-2022 mint with its
 * metadata inside, bonding curve, the curve's token account), Raydium
 * LaunchLab (SPL mint, Metaplex metadata, pool, base and quote vaults;
 * StonkFun: a Token-2022 mint with no Metaplex account), Meteora DBC through
 * Bags (Token-2022 mint, pool, vaults). Rent itself is read from the RPC
 * (getMinimumBalanceForRentExemption): the rate has changed before.
 *
 * The compute limits are the launch router's (docs: Solana launchpads); the
 * priority price is the one the Bundler sends, or the router's default.
 * An estimate: a wallet that already holds the token account, or that traded
 * on Pump.fun before (its volume tracker exists), pays less than this.
 */

export type SolPlatform = "pump" | "raydium" | "usd1" | "meteora";

interface Account {
  label: string;
  /** Bytes. */
  size: number;
}

interface PlatformCosts {
  /** Accounts the create makes, paid by the creator. */
  create: Account[];
  /** Accounts each buyer's first buy makes (the creator's buy too). */
  buyer: Account[];
  /** Compute limits the router writes into the create and each buy. */
  createUnits: number;
  buyUnits: number;
}

/** A Pump.fun mint holds name, symbol and URI: 386 and 399 bytes measured;
 *  room for longer names. */
const PUMP_MINT = 420;

const PLATFORMS: Record<SolPlatform, PlatformCosts> = {
  pump: {
    create: [
      { label: "mint (Token-2022, with its metadata)", size: PUMP_MINT },
      { label: "bonding curve", size: 166 },
      { label: "curve's token account", size: 170 },
    ],
    buyer: [
      { label: "token account", size: 170 },
      { label: "Pump.fun volume tracker (first Pump.fun trade)", size: 137 },
    ],
    createUnits: 400_000,
    buyUnits: 600_000,
  },
  raydium: {
    create: [
      { label: "mint", size: 82 },
      { label: "Metaplex metadata", size: 607 },
      { label: "pool", size: 429 },
      { label: "base vault", size: 165 },
      { label: "quote vault", size: 165 },
    ],
    buyer: [{ label: "token account", size: 165 }],
    createUnits: 400_000,
    buyUnits: 120_000,
  },
  usd1: {
    create: [
      { label: "mint", size: 82 },
      { label: "Metaplex metadata", size: 607 },
      { label: "pool", size: 429 },
      { label: "base vault", size: 165 },
      { label: "USD1 vault", size: 165 },
    ],
    buyer: [{ label: "token account", size: 165 }],
    createUnits: 400_000,
    buyUnits: 120_000,
  },
  meteora: {
    create: [
      { label: "mint (Token-2022)", size: 420 },
      { label: "pool", size: 424 },
      { label: "base vault", size: 165 },
      { label: "quote vault", size: 165 },
    ],
    buyer: [{ label: "token account", size: 170 }],
    // Bags builds its own create; the router sizes the buys.
    createUnits: 400_000,
    buyUnits: 150_000,
  },
};

/** StonkFun is LaunchLab with a Token-2022 mint: no Metaplex account, a
 *  larger mint and base vault, Token-2022 token accounts. */
const STONKFUN: PlatformCosts = {
  create: [
    { label: "mint (Token-2022, with its metadata)", size: 501 },
    { label: "pool", size: 429 },
    { label: "base vault", size: 178 },
    { label: "quote vault", size: 165 },
  ],
  buyer: [{ label: "token account", size: 178 }],
  createUnits: 400_000,
  buyUnits: 120_000,
};

/** The router's priority price when the Bundler sends none (micro-lamports). */
export const DEFAULT_CU_PRICE = 50_000;
const BASE_FEE_PER_SIGNATURE = 5_000;
const LAMPORTS = 1_000_000_000;

export function costProfile(platform: SolPlatform, bonkType?: string): PlatformCosts {
  if (platform === "raydium" && bonkType?.startsWith("stonkfun")) return STONKFUN;
  return PLATFORMS[platform];
}

/** Every account size an estimate needs: what to ask the RPC the rent of. */
export function costSizes(platform: SolPlatform, bonkType?: string): number[] {
  const p = costProfile(platform, bonkType);
  return [...new Set([...p.create, ...p.buyer].map((a) => a.size))];
}

export interface CostLine {
  label: string;
  sol: number;
}

export interface LaunchCost {
  /** The creator's costs beyond its buy: the create's rent and fees, and its
   *  own buy's accounts when it buys. */
  creator: CostLine[];
  creatorSol: number;
  /** One bundle wallet's costs beyond its buy. */
  perBuyer: CostLine[];
  perBuyerSol: number;
  buyers: number;
  totalSol: number;
}

const priorityLamports = (units: number, price: number) => Math.ceil((units * price) / 1_000_000);

/**
 * The SOL a launch costs besides its buys. `rent` maps an account size to
 * its rent in lamports (from the RPC); `cuPrice` is the priority price sent,
 * or undefined for the router's default.
 */
export function estimateLaunchCost(opts: {
  platform: SolPlatform;
  bonkType?: string;
  rent: (size: number) => number;
  cuPrice?: number;
  creatorBuys: boolean;
  buyers: number;
}): LaunchCost {
  const p = costProfile(opts.platform, opts.bonkType);
  const price = opts.cuPrice ?? DEFAULT_CU_PRICE;
  const sol = (lamports: number) => lamports / LAMPORTS;
  const rentOf = (accounts: Account[]) => accounts.reduce((s, a) => s + opts.rent(a.size), 0);

  const creator: CostLine[] = [
    { label: `Rent: ${p.create.map((a) => a.label).join(", ")}`, sol: sol(rentOf(p.create)) },
    // The creator and the mint sign the create.
    { label: "Create fee and priority", sol: sol(2 * BASE_FEE_PER_SIGNATURE + priorityLamports(p.createUnits, price)) },
  ];
  // The creator's buy rides inside the create: its accounts, not another fee.
  if (opts.creatorBuys) creator.push({ label: `Rent of its own ${p.buyer.map((a) => a.label).join(" and ")}`, sol: sol(rentOf(p.buyer)) });

  const perBuyer: CostLine[] = [
    { label: `Rent: ${p.buyer.map((a) => a.label).join(", ")}`, sol: sol(rentOf(p.buyer)) },
    { label: "Buy fee and priority", sol: sol(BASE_FEE_PER_SIGNATURE + priorityLamports(p.buyUnits, price)) },
  ];

  const creatorSol = creator.reduce((s, l) => s + l.sol, 0);
  const perBuyerSol = perBuyer.reduce((s, l) => s + l.sol, 0);
  return {
    creator,
    creatorSol,
    perBuyer,
    perBuyerSol,
    buyers: opts.buyers,
    totalSol: creatorSol + perBuyerSol * opts.buyers,
  };
}

/**
 * Rent by size when the RPC cannot be asked: the rate measured on mainnet on
 * 2026-10-14 (650,240 lamports for an empty account, 5,080 per byte).
 */
export function fallbackRent(size: number): number {
  return 650_240 + size * 5_080;
}
