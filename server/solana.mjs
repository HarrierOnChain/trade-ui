/**
 * Solana, server side: the swap a vault wallet signs, and SOL transfers.
 *
 * The server never signs a transaction it did not just receive from the
 * configured router (or build itself, for a transfer), and only for the
 * wallet the router built it for. There is no endpoint that signs bytes the
 * browser sends.
 *
 *   swap:     the router's quote, kept by the server (server/quotes.mjs) →
 *             router `POST /swap-instructions` for this wallet → check the
 *             signer → sign → `sendTransaction` with preflight → signature.
 *             The browser then confirms on `/api/solana/ws`.
 *   transfer: a legacy System transfer with a small priority fee, built here.
 */
import { getTransactionDecoder, getTransactionEncoder } from "@solana/kit";
import { fromBase58, isSolanaAddress, solanaSign, toBase58 } from "./keys.mjs";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Priority fee a trader may set by hand, in lamports (0.1 SOL). */
export const PRIORITY_FEE_MAX_LAMPORTS = 100_000_000;

export class SolanaError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * The body for the router's `POST /swap-instructions`: this wallet and the
 * router's own quote (kept by the server: the browser only names it), built
 * as quoted — the floor the UI showed is the floor the program enforces. The
 * priority fee is the trader's total when given, else the router's estimate
 * capped at `priorityMaxLamports`. Nothing else goes: fee accounts, tips and
 * recipients never reach the router from here.
 */
export function swapRequestBody(owner, quote, { priorityFeeLamports, priorityMaxLamports }) {
  if (!isSolanaAddress(owner)) throw new SolanaError("bad_request", "Not a Solana wallet", 400);
  const q = quote;
  const bad = () => new SolanaError("bad_request", "Malformed quote", 400);
  if (!q || typeof q !== "object" || Array.isArray(q)) throw bad();
  for (const k of ["inputMint", "outputMint"]) {
    if (typeof q[k] !== "string" || !MINT_RE.test(q[k])) throw bad();
  }
  for (const k of ["inAmount", "outAmount", "otherAmountThreshold"]) {
    if (typeof q[k] !== "string" || !/^[0-9]{1,20}$/.test(q[k])) throw bad();
  }
  if (!Array.isArray(q.routePlan) || q.routePlan.length < 1 || q.routePlan.length > 16) throw bad();
  let prioritizationFeeLamports = { priorityLevelWithMaxLamports: { maxLamports: priorityMaxLamports } };
  const fee = priorityFeeLamports;
  if (fee != null) {
    if (typeof fee !== "number" || !Number.isInteger(fee) || fee < 0 || fee > PRIORITY_FEE_MAX_LAMPORTS) {
      throw new SolanaError("bad_request", "Priority fee out of range", 400);
    }
    prioritizationFeeLamports = fee;
  }
  return {
    userPublicKey: owner,
    quoteResponse: q,
    serialize: true,
    wrapAndUnwrapSol: true,
    prioritizationFeeLamports,
  };
}

/** What a failed build says, from the router's status and body. */
export function describeBuildError(status, j) {
  const body = j && typeof j === "object" ? j : {};
  const nested = body.error && typeof body.error === "object" ? body.error.message : body.error;
  const why = body.reason || (Array.isArray(body.reasons) ? body.reasons.join("; ") : "") || nested || `HTTP ${status}`;
  if (status === 401 || status === 403) return "The router refused the API key: check RAZE_API_KEY";
  if (status === 429) return "Too many requests for this API key: wait a moment";
  if (status === 409) return `The route changed since the quote (${why}): try again`;
  if (status === 503) return `Router not ready (${why}): try again in a moment`;
  if (body.reason === "dark_trader") return "SolFi V2 would charge this wallet extra: exclude it and retry";
  return `Could not build the swap: ${why}`;
}

/**
 * Sign the router's unsigned transaction (v1, SIMD-0385) for `owner`. Refuses
 * a transaction that needs any other signer.
 *
 * @param {string} b64 the unsigned transaction
 * @param {string} owner the wallet's address
 * @param {Uint8Array} secret its 64-byte secret key
 */
export function signFor(b64, owner, secret) {
  let tx;
  try {
    tx = getTransactionDecoder().decode(Buffer.from(b64, "base64"));
  } catch {
    throw new SolanaError("bad_build", "The router answered an unreadable transaction");
  }
  const signers = Object.keys(tx.signatures);
  if (signers.length !== 1 || signers[0] !== owner) {
    throw new SolanaError("bad_build", "The router built this transaction for another wallet");
  }
  if (toBase58(secret.subarray(32)) !== owner) {
    throw new SolanaError("bad_key", "The stored key does not match this wallet", 500);
  }
  const signature = solanaSign(secret, Uint8Array.from(tx.messageBytes));
  const signed = getTransactionEncoder().encode({
    ...tx,
    signatures: { ...tx.signatures, [owner]: signature },
  });
  return { signed: Buffer.from(signed).toString("base64"), signature: toBase58(signature) };
}

// ── legacy transfer ────────────────────────────────────────────────────

const SYSTEM_PROGRAM = new Uint8Array(32);
const COMPUTE_BUDGET_PROGRAM = fromBase58("ComputeBudget111111111111111111111111111111");
/** A transfer uses ~450 CU with the two budget instructions. */
const TRANSFER_CU_LIMIT = 1_000;
const TRANSFER_CU_PRICE_MICROLAMPORTS = 200_000n;
/** Base fee (one signature) plus the priority fee of a transfer. */
export const TRANSFER_FEE_LAMPORTS = 5_000n
  + (BigInt(TRANSFER_CU_LIMIT) * TRANSFER_CU_PRICE_MICROLAMPORTS + 999_999n) / 1_000_000n;

function shortvec(n) {
  const out = [];
  let v = n;
  for (;;) {
    let byte = v & 0x7f;
    v >>= 7;
    if (v === 0) {
      out.push(byte);
      return out;
    }
    byte |= 0x80;
    out.push(byte);
  }
}

function u32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return [...b];
}

function u64le(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return [...b];
}

/**
 * The legacy message of a SOL transfer: set CU limit, set CU price, transfer.
 * @param {{ from: string, to: string, lamports: bigint, blockhash: string }} t
 */
export function transferMessage({ from, to, lamports, blockhash }) {
  const fromKey = fromBase58(from);
  const toKey = fromBase58(to);
  const hash = fromBase58(blockhash);
  if (!fromKey || fromKey.length !== 32 || !toKey || toKey.length !== 32) {
    throw new SolanaError("bad_request", "Bad address", 400);
  }
  if (!hash || hash.length !== 32) throw new SolanaError("rpc", "The RPC answered a malformed blockhash");
  const keys = [fromKey, toKey, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM];
  const ix = (programIndex, accounts, data) => [
    programIndex, ...shortvec(accounts.length), ...accounts, ...shortvec(data.length), ...data,
  ];
  const bytes = [
    1, 0, 2, // one signer (the payer), no read-only signers, two read-only programs
    ...shortvec(keys.length), ...keys.flatMap((k) => [...k]),
    ...hash,
    ...shortvec(3),
    ...ix(3, [], [2, ...u32le(TRANSFER_CU_LIMIT)]),
    ...ix(3, [], [3, ...u64le(TRANSFER_CU_PRICE_MICROLAMPORTS)]),
    ...ix(2, [0, 1], [...u32le(2), ...u64le(lamports)]),
  ];
  return Uint8Array.from(bytes);
}

/** A signed legacy transaction around `message`, base64. */
export function signedLegacy(message, secret) {
  const sig = solanaSign(secret, message);
  return {
    b64: Buffer.from(Uint8Array.from([...shortvec(1), ...sig, ...message])).toString("base64"),
    signature: toBase58(sig),
  };
}

// ── the network ────────────────────────────────────────────────────────

/**
 * @param {{ routerBase: string, apiKey: string, rpcUrl: string, priorityMaxLamports: number }} config
 * @param {{ fetch?: typeof fetch }} [deps]
 */
export function createSolana(config, deps = {}) {
  const doFetch = deps.fetch ?? fetch;

  async function rpc(method, params, timeout = 20_000) {
    let r;
    try {
      r = await doFetch(config.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new SolanaError("rpc", "The Solana RPC is unreachable");
    }
    let j;
    try {
      j = await r.json();
    } catch {
      throw new SolanaError("rpc", `The Solana RPC answered ${r.status}`);
    }
    if (j && j.error) {
      // A refused send carries the simulation's error in `data.err`
      // ("AccountNotFound", {"InstructionError":[3,{"Custom":…}]}): keep it, so
      // the browser can say what went wrong.
      const err = j.error.data?.err;
      const detail = err == null ? "" : ` (${typeof err === "string" ? err : JSON.stringify(err)})`;
      throw new SolanaError("rpc", `${j.error.message || "RPC error"}${detail}`, 422);
    }
    return j?.result;
  }

  /** Send a signed transaction with preflight: a swap that would fail is
   *  refused by the simulation instead of paying a fee on chain. */
  async function send(b64) {
    const sig = await rpc("sendTransaction", [
      b64,
      { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 },
    ]);
    if (typeof sig !== "string") throw new SolanaError("rpc", "The RPC did not return a signature");
    return sig;
  }

  return {
    rpc,
    send,

    /** Build `quote` (the router's own) for `owner` on the router. */
    async build(owner, quote, priorityFeeLamports) {
      const body = swapRequestBody(owner, quote, { priorityFeeLamports, priorityMaxLamports: config.priorityMaxLamports });
      const headers = { "content-type": "application/json" };
      if (config.apiKey) headers["x-api-key"] = config.apiKey;
      let r;
      try {
        r = await doFetch(`${config.routerBase}/swap-instructions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          // A redirect would carry the key and the body elsewhere.
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new SolanaError("router", "The router is unreachable");
      }
      const text = await r.text();
      let j = null;
      try {
        j = JSON.parse(text);
      } catch {
        /* handled below */
      }
      if (r.status !== 200) {
        throw new SolanaError("router", describeBuildError(r.status, j), r.status === 409 ? 409 : 502);
      }
      if (!j || typeof j.swapTransaction !== "string") {
        throw new SolanaError("router", "The router answered without a transaction");
      }
      return j;
    },

    /**
     * Build → sign → send for one vault wallet. `stillUnlocked` is asked right
     * before signing: the build can take seconds, and a vault locked meanwhile
     * signs nothing.
     */
    async swap(wallet, { quote, priorityFeeLamports }, { stillUnlocked = () => true } = {}) {
      const build = await this.build(wallet.address, quote, priorityFeeLamports);
      if (!stillUnlocked()) throw new SolanaError("locked", "Locked: enter your password", 401);
      const { signed, signature } = signFor(build.swapTransaction, wallet.address, wallet.secret);
      const sent = await send(signed);
      return {
        signature: sent || signature,
        lastValidBlockHeight: build.lastValidBlockHeight ?? null,
        inAmount: build.inAmount ?? null,
        outAmount: build.outAmount ?? null,
      };
    },

    async balance(address) {
      const r = await rpc("getBalance", [address, { commitment: "confirmed" }]);
      const v = r?.value;
      if (!Number.isInteger(v)) throw new SolanaError("rpc", "The RPC answered a malformed balance");
      return BigInt(v);
    },

    /**
     * Send SOL from a vault wallet. `amount` is lamports as a decimal string,
     * or "max": everything minus the fee.
     */
    async transfer(wallet, to, amount, { stillUnlocked = () => true } = {}) {
      if (!isSolanaAddress(to)) throw new SolanaError("bad_request", "Not a Solana address", 400);
      if (to === wallet.address) throw new SolanaError("bad_request", "That is this wallet's own address", 400);
      let lamports;
      if (amount === "max") {
        lamports = (await this.balance(wallet.address)) - TRANSFER_FEE_LAMPORTS;
        if (lamports <= 0n) throw new SolanaError("bad_request", "Not enough SOL to cover the fee", 400);
      } else {
        if (typeof amount !== "string" || !/^[1-9][0-9]{0,19}$/.test(amount)) {
          throw new SolanaError("bad_request", "Enter an amount", 400);
        }
        lamports = BigInt(amount);
        if (lamports > (1n << 64n) - 1n) throw new SolanaError("bad_request", "Amount too large", 400);
      }
      const latest = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
      const blockhash = latest?.value?.blockhash;
      if (typeof blockhash !== "string") throw new SolanaError("rpc", "The RPC answered no blockhash");
      const message = transferMessage({ from: wallet.address, to, lamports, blockhash });
      if (!stillUnlocked()) throw new SolanaError("locked", "Locked: enter your password", 401);
      const { b64, signature } = signedLegacy(message, wallet.secret);
      const sent = await send(b64);
      return { signature: sent || signature, lamports: lamports.toString() };
    },
  };
}
