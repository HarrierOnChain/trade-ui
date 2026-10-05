/**
 * The router builds v1 transactions only (SIMD-0385: compute budget in the
 * message header, up to 4,096 bytes and 64 keys). Browser wallets speak the
 * Wallet Standard, whose transaction versions are still `'legacy' | 0`, so a
 * wallet that does not declare v1 gets the SAME instructions re-assembled here
 * as a v0 transaction:
 *
 *   - the instructions of the build, in the documented order (setup, every
 *     swap instruction, cleanup, other), byte for byte;
 *   - the v1 header turned back into ComputeBudget instructions (limit, price,
 *     loaded-accounts size, heap), placed first;
 *   - the router's own blockhash (read from the v1 transaction), the same fee
 *     payer, no lookup tables.
 *
 * A v0 transaction is capped at 1,232 bytes; a route that does not fit gets no
 * v0 form and the reason says so. Simulated on mainnet on 2026-10-04 (swap-ui):
 * same result and logs as the v1 bytes, +450 CU for the three budget
 * instructions. Server-side only (`/api/swap/build`).
 */
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
} from "@solana/kit";

export const V0_MAX_BYTES = 1232;
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
/** Each ComputeBudget instruction is a builtin that costs 150 CU out of the
 *  limit it sets; the router sized the limit for its own instructions only. */
const CB_IX_CU = 150;

/** An instruction as the router's `/swap-instructions` writes it. */
export interface IxJson {
  programId: string;
  accounts?: { pubkey: string; isSigner?: boolean; isWritable?: boolean }[];
  /** base64 */
  data?: string;
}

/** The part of a router build this module reads. */
export interface RouterBuild {
  swapTransaction: string;
  setupInstructions?: IxJson[];
  swapInstruction?: IxJson | null;
  swapInstructions?: IxJson[];
  cleanupInstruction?: IxJson | null;
  otherInstructions?: IxJson[];
  transactionConfig?: {
    priorityFeeLamports?: number | null;
    computeUnitLimit?: number | null;
    loadedAccountsDataSizeLimit?: number | null;
    heapSize?: number | null;
  } | null;
  computeUnits?: number;
  loadedAccountsDataSize?: number;
  lastValidBlockHeight?: number | null;
  costs?: { priorityFeeMicroLamportsPerCu?: string } | null;
}

function u32(n: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return [...b];
}
function u64(n: bigint): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return [...b];
}
const cbIx = (tag: number, payload: number[]): Instruction => ({
  programAddress: address(COMPUTE_BUDGET),
  data: Uint8Array.from([tag, ...payload]),
});

function roleOf(meta: { isSigner?: boolean; isWritable?: boolean }): AccountRole {
  if (meta.isSigner) return meta.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  return meta.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
}

function toKitIx(ix: IxJson): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: (ix.accounts || []).map((a) => ({ address: address(a.pubkey), role: roleOf(a) })),
    data: Uint8Array.from(Buffer.from(ix.data || "", "base64")),
  };
}

/** Fee payer and blockhash of the router's serialized v1 transaction. */
export function readV1(b64: string): { version: unknown; feePayer: string | null; blockhash: string } {
  const tx = getTransactionDecoder().decode(Buffer.from(b64, "base64"));
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  return {
    version: msg.version,
    feePayer: msg.staticAccounts?.[0] ?? null,
    blockhash: msg.lifetimeToken,
  };
}

/** The build's instructions in execution order (the order the router's docs
 *  give for assembling the transaction yourself). */
export function buildInstructions(build: RouterBuild): IxJson[] {
  const swaps = build.swapInstructions?.length
    ? build.swapInstructions
    : build.swapInstruction
      ? [build.swapInstruction]
      : [];
  return [
    ...(build.setupInstructions || []),
    ...swaps,
    ...(build.cleanupInstruction ? [build.cleanupInstruction] : []),
    ...(build.otherInstructions || []),
  ];
}

/** Distinct account keys the build's instructions name (programs included):
 *  what the router counts against 64, and what sizes a v0 transaction. */
export function buildKeyCount(build: RouterBuild): number {
  const keys = new Set<string>();
  for (const ix of buildInstructions(build)) {
    keys.add(ix.programId);
    for (const a of ix.accounts || []) keys.add(a.pubkey);
  }
  return keys.size;
}

/** The v1 header as ComputeBudget instructions. */
export function computeBudgetIxs(build: RouterBuild): Instruction[] {
  const cfg = build.transactionConfig || {};
  const out: Instruction[] = [];
  if (cfg.heapSize) out.push(cbIx(1, u32(cfg.heapSize)));
  const n = 2 + (cfg.heapSize ? 1 : 0) + (cfg.priorityFeeLamports ? 1 : 0);
  const limit = Number(cfg.computeUnitLimit || build.computeUnits || 0);
  if (!limit) throw new Error("build has no compute-unit limit");
  out.push(cbIx(2, u32(limit + n * CB_IX_CU)));
  const fee = Number(cfg.priorityFeeLamports || 0);
  if (fee > 0) {
    // Price per CU: the router's own figure when it gives one, else the total
    // spread over the limit it declared.
    const per = build.costs?.priorityFeeMicroLamportsPerCu;
    const micro = per && /^\d+$/.test(per) ? BigInt(per) : (BigInt(fee) * 1_000_000n) / BigInt(limit);
    out.push(cbIx(3, u64(micro)));
  }
  const loaded = Number(cfg.loadedAccountsDataSizeLimit || build.loadedAccountsDataSize || 0);
  if (!loaded) throw new Error("build has no loaded-accounts limit");
  out.push(cbIx(4, u32(loaded)));
  return out;
}

export type V0Result =
  | { transaction: string; reason?: undefined; bytes: number }
  | { transaction: null; reason: string; bytes?: number };

/**
 * Re-assemble a router build as an unsigned v0 transaction for `wallet`.
 * Throws only when the build is not for `wallet` (never hand a user a
 * transaction someone else pays for).
 */
export function assembleV0(build: RouterBuild, wallet: string): V0Result {
  const v1 = readV1(build.swapTransaction);
  if (v1.feePayer !== wallet) throw new Error("the router built for another fee payer");
  let ixs: Instruction[];
  try {
    ixs = [...computeBudgetIxs(build), ...buildInstructions(build).map(toKitIx)];
  } catch (e) {
    return { transaction: null, reason: e instanceof Error ? e.message : String(e) };
  }
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(wallet), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: v1.blockhash as Blockhash,
          lastValidBlockHeight: BigInt(build.lastValidBlockHeight || 0),
        },
        m,
      ),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const bytes = getTransactionEncoder().encode(compileTransaction(message));
  if (bytes.length > V0_MAX_BYTES) {
    return {
      transaction: null,
      reason: `route needs ${bytes.length} bytes as v0 (max ${V0_MAX_BYTES})`,
      bytes: bytes.length,
    };
  }
  return { transaction: Buffer.from(bytes).toString("base64"), bytes: bytes.length };
}
