/**
 * Signing a router transaction, two ways.
 *
 * The router builds v1 transactions (SIMD-0385). @solana/web3.js 1.x cannot
 * parse those; @solana/kit can, and in v1 the message comes first and the
 * signature slots after it, so a signed transaction is the same bytes with the
 * fee payer's 64 bytes filled in.
 *
 *   - Local wallets (a key kept by Trade UI): signed here with ed25519, sent
 *     through `/api/solana/rpc`.
 *   - Browser wallets (Phantom, Solflare, Backpack, … via the Wallet Standard):
 *     raw bytes handed to the wallet's own `solana:signAndSendTransaction`.
 *     A wallet that declares version 1 gets the router's transaction untouched;
 *     any other gets the same instructions re-assembled as v0 by the server
 *     (`v0.ts`), quoted with `reserveKeys` so the route fits 1,232 bytes.
 *
 * Pure apart from the wallet call: the tests import it directly.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";
import type { SwapBuild } from "./quote";

export const b64decode = (s: string): Uint8Array => Uint8Array.from(getBase64Encoder().encode(s));
export const b64encode = (b: Uint8Array): string => getBase64Decoder().decode(b);
export const b58encode = (b: Uint8Array): string => getBase58Decoder().decode(b);

/**
 * Sign the router's unsigned transaction (v1, or the v0 form) with a local
 * 64-byte secret key (seed ‖ public key, the Solana keypair layout). Refuses a
 * transaction that is not for this key or that needs another signer.
 */
export function signLocal(b64: string, secretKey: Uint8Array): { signed: string; signature: string } {
  if (secretKey.length !== 64) throw new Error("bad secret key");
  const seed = secretKey.subarray(0, 32);
  const pub = ed25519.getPublicKey(seed);
  const stored = secretKey.subarray(32);
  if (!pub.every((b, i) => b === stored[i])) throw new Error("secret key does not match its public key");
  const owner = b58encode(pub);
  const tx = getTransactionDecoder().decode(b64decode(b64));
  const signers = Object.keys(tx.signatures);
  if (signers.length !== 1 || signers[0] !== owner) {
    throw new Error("the router built this transaction for another wallet");
  }
  const sig = ed25519.sign(Uint8Array.from(tx.messageBytes), seed);
  const signed = getTransactionEncoder().encode({
    ...tx,
    signatures: { ...tx.signatures, [owner]: sig } as typeof tx.signatures,
  });
  return { signed: b64encode(Uint8Array.from(signed)), signature: b58encode(sig) };
}

// ── Wallet Standard ──────────────────────────────────────────────────────

type Version = string | number;

export interface StdAccount {
  address: string;
  chains?: readonly string[];
}

interface StdFeature {
  supportedTransactionVersions?: readonly Version[];
}

interface SignAndSendFeature extends StdFeature {
  signAndSendTransaction(
    ...inputs: { account: StdAccount; chain: string; transaction: Uint8Array; options?: object }[]
  ): Promise<readonly { signature: Uint8Array }[]>;
}

interface SignFeature extends StdFeature {
  signTransaction(
    ...inputs: { account: StdAccount; chain?: string; transaction: Uint8Array }[]
  ): Promise<readonly { signedTransaction: Uint8Array }[]>;
}

export interface StdWallet {
  name: string;
  icon?: string;
  accounts: readonly StdAccount[];
  chains?: readonly string[];
  features: Record<string, unknown>;
}

export const SIGN_AND_SEND = "solana:signAndSendTransaction";
export const SIGN = "solana:signTransaction";
const CHAIN = "solana:mainnet";

/** Transaction versions the feature we will call accepts. */
export function walletVersions(w: Pick<StdWallet, "features">): readonly Version[] {
  const f = (w.features[SIGN_AND_SEND] ?? w.features[SIGN]) as StdFeature | undefined;
  return f?.supportedTransactionVersions ?? ["legacy"];
}

/**
 * `reserveKeys` for a wallet that can only sign v0. A v0 transaction without
 * lookup tables is capped at 1,232 bytes and each key costs 32 of them, so the
 * route has to stay small; the router counts keys, not bytes. With 39 reserved
 * the router serves routes of at most 25 keys, the v0 adds the ComputeBudget
 * program (26), and that measured at most 1,183 bytes on 2026-10-04 (an
 * unconstrained direct route had 37 keys: 1,601 bytes). The server still
 * checks the size of every v0 it builds.
 */
export const V0_RESERVE_KEYS = 39;

/** The `reserveKeys` to quote with for this wallet: none when it signs v1. */
export function quoteReserveKeys(versions: readonly Version[]): number | undefined {
  return versions.includes(1) ? undefined : V0_RESERVE_KEYS;
}

export type TxChoice = { version: 1 | 0; b64: string } | { error: string };

/** Pick the form of the build this wallet can sign. */
export function chooseTransaction(
  versions: readonly Version[],
  build: Pick<SwapBuild, "transaction" | "transactionV0" | "v0Unavailable">,
): TxChoice {
  if (versions.includes(1)) return { version: 1, b64: build.transaction };
  if (versions.includes(0)) {
    if (build.transactionV0) return { version: 0, b64: build.transactionV0 };
    return {
      error:
        "This route only fits a v1 transaction, which your wallet cannot sign yet" +
        (build.v0Unavailable ? ` (${build.v0Unavailable})` : "") +
        ". Try a smaller amount or fewer venues.",
    };
  }
  return { error: "Your wallet cannot sign versioned transactions." };
}

/**
 * Sign `b64` with a browser wallet. With `signAndSendTransaction` the wallet
 * broadcasts through its own RPC and the result is the signature; a sign-only
 * wallet hands back the signed bytes for `/api/solana/rpc` to send.
 */
export async function signWithWallet(
  w: StdWallet,
  owner: string,
  b64: string,
): Promise<{ sent: true; signature: string } | { sent: false; signed: string }> {
  const account = w.accounts.find((a) => a.address === owner);
  if (!account) throw new Error("Wallet account not found: reconnect the wallet");
  const transaction = b64decode(b64);
  const sas = w.features[SIGN_AND_SEND] as SignAndSendFeature | undefined;
  if (sas) {
    const [out] = await sas.signAndSendTransaction({
      account,
      chain: CHAIN,
      transaction,
      options: { preflightCommitment: "confirmed", maxRetries: 3 },
    });
    return { sent: true, signature: b58encode(out.signature) };
  }
  const st = w.features[SIGN] as SignFeature | undefined;
  if (st) {
    const [out] = await st.signTransaction({ account, chain: CHAIN, transaction });
    return { sent: false, signed: b64encode(out.signedTransaction) };
  }
  throw new Error("This wallet cannot sign Solana transactions");
}
