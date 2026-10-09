/**
 * EVM, server side: swaps of a vault wallet on the Raze EVM router
 * (router.raze.bot/evm), on Ethereum, BNB Chain, Base and Robinhood Chain.
 *
 * The EVM router speaks the Solana router's API (Jupiter's shape):
 *
 *   quote:   `GET /api/evm/quote` → router `GET /quote`; the answer is kept
 *            here a minute under a random token, like the Solana quotes
 *            (server/quotes.mjs), and the browser trades by naming the token.
 *   swap:    the kept quote → router `POST /swap` with it as `quoteResponse`
 *            for this wallet → every transaction checked (this wallet, this
 *            chain, the quote's token, amounts and floor, the venue's router,
 *            a simulation that passed) → `setupTransactions` and
 *            `swapTransaction` signed as EIP-1559 transactions →
 *            `eth_sendRawTransaction` in nonce order → the swap's hash.
 *   confirm: the swap's receipt, read on each new block the chain's WebSocket
 *            announces (`newHeads`); a read every 2 s only when no socket opens.
 *   balance: a wallet's native or ERC-20 balance and the token's decimals.
 *
 * The server signs only what the router just built for that wallet and that
 * passes the checks above. There is no endpoint that signs browser bytes.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { isEvmAddress } from "./keys.mjs";
import { QuoteBook } from "./quotes.mjs";

const U256_MAX = (1n << 256n) - 1n;
/** The router's own slippage ceiling (0–10000 bps, as on Solana). */
const ROUTER_MAX_SLIPPAGE_BPS = 10_000;
/** How the router writes the native coin (ETH, BNB) as a token. */
export const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
/** A gas limit no swap of the router comes near; above it, refuse. */
const GAS_CEILING = 5_000_000n;
const APPROVE = "0x095ea7b3";

/**
 * The chains of the EVM router and their default free RPCs. HTTP must read a
 * receipt by hash: publicnode's free tier refuses that on BSC and Base
 * ("Archive requests require a personal token", 2026-10-09), so those two
 * default to the chains' own public endpoints, which have no WebSocket; new
 * blocks come from publicnode's WebSocket, which pushes them on all four.
 */
export const EVM_CHAINS = {
  eth: { chainId: 1, native: "ETH", rpc: "https://ethereum-rpc.publicnode.com", ws: "wss://ethereum-rpc.publicnode.com" },
  bsc: { chainId: 56, native: "BNB", rpc: "https://bsc-dataseed.bnbchain.org", ws: "wss://bsc-rpc.publicnode.com" },
  base: { chainId: 8453, native: "ETH", rpc: "https://mainnet.base.org", ws: "wss://base-rpc.publicnode.com" },
  robinhood: { chainId: 4663, native: "ETH", rpc: "https://robinhood-rpc.publicnode.com", ws: "wss://robinhood-rpc.publicnode.com" },
};

/** Receipt reads that fail in a row before the wait gives up and says why. */
const RECEIPT_ERRORS_MAX = 3;

export class EvmError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const bad = (message) => new EvmError("bad_request", message, 400);
const lower = (s) => String(s).toLowerCase();

// ── encoding ────────────────────────────────────────────────────────────

function hexToBytes(hex) {
  const h = String(hex).replace(/^0x/, "");
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new EvmError("bad_build", "Malformed hex from the router");
  return Uint8Array.from(Buffer.from(h, "hex"));
}

const toHex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;

/** Big-endian bytes of `n`, no leading zero (0 → empty). */
function intBytes(n) {
  if (n < 0n) throw new RangeError("negative");
  if (n === 0n) return new Uint8Array(0);
  let h = n.toString(16);
  if (h.length % 2) h = `0${h}`;
  return Uint8Array.from(Buffer.from(h, "hex"));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function rlpLength(len, offset) {
  if (len < 56) return Uint8Array.of(offset + len);
  const l = intBytes(BigInt(len));
  return concat(Uint8Array.of(offset + 55 + l.length), l);
}

/** RLP of a byte string, a bigint (as its minimal bytes) or a list of those. */
export function rlp(item) {
  if (Array.isArray(item)) {
    const body = concat(...item.map(rlp));
    return concat(rlpLength(body.length, 0xc0), body);
  }
  const b = typeof item === "bigint" ? intBytes(item) : item;
  if (b.length === 1 && b[0] < 0x80) return b;
  return concat(rlpLength(b.length, 0x80), b);
}

/**
 * Sign an EIP-1559 (type 2) transaction.
 *
 * @param {{ chainId: bigint, nonce: bigint, maxPriorityFeePerGas: bigint, maxFeePerGas: bigint,
 *           gas: bigint, to: string, value: bigint, data: string }} tx
 * @param {Uint8Array} secret the 32-byte private key
 * @returns {{ raw: string, hash: string }}
 */
export function signEip1559(tx, secret) {
  const fields = [
    tx.chainId, tx.nonce, tx.maxPriorityFeePerGas, tx.maxFeePerGas, tx.gas,
    hexToBytes(tx.to), tx.value, hexToBytes(tx.data), [],
  ];
  const digest = keccak_256(concat(Uint8Array.of(2), rlp(fields)));
  const sig = secp256k1.sign(digest, secret, { prehash: false, format: "recovered" });
  const v = BigInt(sig[0]);
  const r = BigInt(toHex(sig.subarray(1, 33)));
  const s = BigInt(toHex(sig.subarray(33, 65)));
  const raw = concat(Uint8Array.of(2), rlp([...fields, v, r, s]));
  return { raw: toHex(raw), hash: toHex(keccak_256(raw)) };
}

/** The address of a 32-byte secp256k1 key, lowercase. */
export function evmAddressOfKey(secret) {
  const pub = secp256k1.getPublicKey(secret, false).subarray(1);
  return toHex(keccak_256(pub).subarray(-20));
}

// ── what goes to the router ────────────────────────────────────────────

/** `native` or a 0x address, as the router spells it (lower case). */
function token(text, what) {
  if (text === "native" || lower(text) === NATIVE) return NATIVE;
  if (isEvmAddress(text)) return lower(text);
  throw bad(`${what} is \`native\` or a 0x address`);
}

/**
 * The router's `GET /quote` query from the browser's: chain, inputMint,
 * outputMint, amount, slippage, hops; anything else is dropped. Throws a 400.
 */
export function quoteQuery(sp, { maxSlippageBps = 5000 } = {}) {
  const chain = sp.get("chain") || "";
  if (!Object.hasOwn(EVM_CHAINS, chain)) throw bad("Unknown EVM chain");
  const inputMint = token(sp.get("inputMint") || "", "inputMint");
  const outputMint = token(sp.get("outputMint") || "", "outputMint");
  if (inputMint === outputMint) throw bad("Input and output are the same token");
  const amount = sp.get("amount") || "";
  if (!/^[1-9][0-9]{0,77}$/.test(amount) || BigInt(amount) > U256_MAX) throw bad("Bad amount");
  const slip = sp.get("slippageBps") ?? "100";
  if (!/^[0-9]{1,5}$/.test(slip)) throw bad("Bad slippageBps");
  const cap = Math.min(maxSlippageBps, ROUTER_MAX_SLIPPAGE_BPS);
  if (Number(slip) > cap) {
    throw new EvmError("slippage_cap", `Slippage above ${cap / 100}% is off for EVM swaps on this Trade UI`, 400);
  }
  const q = new URLSearchParams({ chain, inputMint, outputMint, amount, slippageBps: String(Number(slip)) });
  const hops = sp.get("maxHops");
  if (hops != null && hops !== "") {
    if (!/^[1-3]$/.test(hops)) throw bad("Bad maxHops");
    q.set("maxHops", hops);
  }
  return q;
}

/**
 * What a refused build or quote says, from the router's status and body: the
 * Solana router's `{error, reason}` (or `reasons` when not ready); the key
 * gate's 401 and 429 carry the API's own body.
 */
export function describeRouterError(status, j) {
  const error = j && typeof j.error === "string" ? j.error : "";
  const reason = j && typeof j.reason === "string" ? j.reason : "";
  const reasons = Array.isArray(j?.reasons) ? j.reasons.filter((r) => typeof r === "string") : [];
  if (status === 401 || status === 403) return "The EVM router refused the API key: check RAZE_API_KEY";
  if (status === 429) return "Too many requests for this API key: wait a moment";
  if (error === "route_expired") return "That quote expired: get a new one";
  if (error === "declined") {
    switch (reason) {
      case "no_route": return "No route for this pair on the EVM router";
      case "quote_stale": return "The price moved below the quote's minimum: try again";
      case "amount_too_small":
      case "zero_amount": return "Amount too small";
      default: return `The EVM router declined (${reason || "no reason"})`;
    }
  }
  if (error === "not_ready") {
    if (reasons.some((r) => r.startsWith("overloaded"))) return "The EVM router is busy: try again in a moment";
    return `The EVM router is not ready (${reasons.join("; ") || "starting"})`;
  }
  if (error === "rpc") return `The EVM router could not read the chain (${reason || "RPC"}): try again`;
  return `EVM router: ${reason || error || `HTTP ${status}`}`;
}

/** Why a build's simulation did not pass, as something the trader can act on. */
export function describeSimulation(sim) {
  const reason = sim?.status === "requires_approval" ? "requires_approval" : sim?.reason || sim?.status || "unknown";
  switch (reason) {
    case "insufficient_balance": return "Not enough balance in this wallet for this trade";
    case "partial_fill": return "The pool cannot take the whole amount: trade less";
    case "output_below_minimum": return "Less than the minimum would arrive (a taxed token, or the price moved): raise the slippage";
    case "swap_reverted": return `The swap would fail${sim.revertReason ? ` (${sim.revertReason})` : ""}`;
    case "approval_reverted": return "The token refuses the approval";
    case "requires_approval": return "The router's node cannot simulate this swap: not sent";
    default: return `The swap could not be simulated (${reason}): not sent, try again`;
  }
}

/**
 * The build's transactions, checked before anything is signed: this wallet
 * and chain, the quote's amount and floor, approvals of the quote's input
 * token to the venue's router for at most the amount, the swap to that
 * router (or the wrapped-native contract) with the quote's value, a gas
 * limit, a simulation that passed.
 *
 * @returns {Array<{ to: string, data: string, value: bigint, gas: bigint }>}
 */
export function checkedTransactions(build, { quote, owner, chainId }) {
  const refuse = (why) => new EvmError("bad_build", `The EVM router built something this Trade UI does not sign (${why})`);
  if (!build || typeof build !== "object") throw refuse("no body");
  if (build.chainId !== chainId || build.quoteId !== quote.quoteId) throw refuse("another quote or chain");
  // The floor in the swap's calldata is the quote's: this Trade UI never moves it.
  if (build.inAmount !== quote.inAmount || build.otherAmountThreshold !== quote.otherAmountThreshold) {
    throw refuse("other amounts than the quote's");
  }
  if (build.simulation?.status !== "passed") {
    throw new EvmError("simulation", describeSimulation(build.simulation), 422);
  }
  const amountIn = BigInt(quote.inAmount);
  // The swap's `to`: the venue's router, or the wrapped token for a wrap or an unwrap.
  const target = lower(quote.router);
  if (!isEvmAddress(target)) throw refuse("no router in the quote");
  // `spender` is null when nothing needs approving (a native input, a wrap or an unwrap).
  if (build.spender != null && lower(build.spender) !== target) throw refuse("another spender");
  const nativeIn = lower(quote.inputMint) === NATIVE;
  const approvals = Array.isArray(build.setupTransactions) ? build.setupTransactions : [];
  if (nativeIn && approvals.length) throw refuse("an approval for a native input");
  if (approvals.length > 2) throw refuse("too many approvals");

  const one = (tx, what) => {
    if (!tx || typeof tx !== "object") throw refuse(`no ${what}`);
    if (lower(tx.from) !== lower(owner)) throw refuse(`${what} from another wallet`);
    if (tx.chainId !== chainId) throw refuse(`${what} on another chain`);
    if (!isEvmAddress(tx.to) || typeof tx.data !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(tx.data)) throw refuse(`${what} malformed`);
    if (typeof tx.value !== "string" || !/^[0-9]{1,78}$/.test(tx.value)) throw refuse(`${what} value`);
    if (typeof tx.gas !== "string" || !/^[1-9][0-9]{0,9}$/.test(tx.gas) || BigInt(tx.gas) > GAS_CEILING) throw refuse(`${what} gas`);
    return { to: lower(tx.to), data: lower(tx.data), value: BigInt(tx.value), gas: BigInt(tx.gas) };
  };

  const out = approvals.map((a, i) => {
    const tx = one(a, `approval ${i + 1}`);
    if (tx.to !== lower(quote.inputMint)) throw refuse("an approval of another token");
    if (tx.value !== 0n) throw refuse("an approval with value");
    // approve(address spender, uint256 amount): selector + two words.
    if (tx.data.length !== 2 + 8 + 128 || !tx.data.startsWith(APPROVE)) throw refuse("not an approve call");
    const spender = `0x${tx.data.slice(10 + 24, 10 + 64)}`;
    if (tx.data.slice(10, 10 + 24) !== "0".repeat(24) || spender !== target) throw refuse("an approval to another spender");
    if (BigInt(`0x${tx.data.slice(74)}`) > amountIn) throw refuse("an approval above the amount");
    return tx;
  });
  const swap = one(build.swapTransaction, "swap");
  if (swap.to !== target) throw refuse("a swap to another contract");
  if (swap.value !== (nativeIn ? amountIn : 0n)) throw refuse("a swap with another value");
  out.push(swap);
  return out;
}

// ── the network ────────────────────────────────────────────────────────

/**
 * @param {{ routerEvmBase: string, apiKey: string, maxSlippageBps: number,
 *           evmRpc: Record<string, { http: string, ws: string }> }} config
 * @param {{ fetch?: typeof fetch, WebSocket?: typeof WebSocket | null, book?: QuoteBook,
 *           pollMs?: number }} [deps]
 */
export function createEvm(config, deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const Socket = "WebSocket" in deps ? deps.WebSocket : globalThis.WebSocket;
  const pollMs = deps.pollMs ?? 2000;
  const book = deps.book ?? new QuoteBook();
  /** The next nonce each address is due, past what the RPC may not see yet. */
  const nextNonce = new Map();
  /** One send at a time per address: the nonces stay in order. */
  const queues = new Map();

  const rpcUrls = (chain) => {
    const r = config.evmRpc[chain];
    if (!r) throw bad("Unknown EVM chain");
    return r;
  };

  async function rpc(chain, method, params, timeout = 15_000) {
    let r;
    try {
      r = await doFetch(rpcUrls(chain).http, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new EvmError("rpc", `The ${chain} RPC is unreachable`);
    }
    let j;
    try {
      j = await r.json();
    } catch {
      throw new EvmError("rpc", `The ${chain} RPC answered ${r.status}`);
    }
    if (j?.error) throw new EvmError("rpc", `${chain} RPC: ${j.error.message || "error"}`, 422);
    return j?.result;
  }

  /** A GET with `query`, or a POST of `body`. */
  async function router(path, { query, body } = {}) {
    const headers = { accept: "application/json" };
    if (body) headers["content-type"] = "application/json";
    if (config.apiKey) headers["x-api-key"] = config.apiKey;
    let r;
    try {
      r = await doFetch(`${config.routerEvmBase}${path}${query ? `?${query}` : ""}`, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        // A redirect would carry the key and the body elsewhere.
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { status: 0, j: null };
    }
    let j = null;
    try {
      j = JSON.parse(await r.text());
    } catch {
      /* handled by the callers */
    }
    return { status: r.status, j };
  }

  function serial(address, fn) {
    const key = lower(address);
    const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    queues.set(key, tail);
    tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return run;
  }

  async function fees(chain, build) {
    const f = build.costs;
    const ok = (v) => typeof v === "string" && /^[0-9]{1,30}$/.test(v);
    if (f && ok(f.maxFeePerGas) && ok(f.maxPriorityFeePerGas)) {
      return { maxFeePerGas: BigInt(f.maxFeePerGas), maxPriorityFeePerGas: BigInt(f.maxPriorityFeePerGas) };
    }
    const [block, tip] = await Promise.all([
      rpc(chain, "eth_getBlockByNumber", ["latest", false]),
      rpc(chain, "eth_maxPriorityFeePerGas", []).catch(() => "0x0"),
    ]);
    const base = BigInt(block?.baseFeePerGas ?? "0x0");
    const prio = BigInt(tip ?? "0x0");
    return { maxFeePerGas: base * 2n + prio, maxPriorityFeePerGas: prio };
  }

  return {
    book,
    rpc,

    /** → router `GET /quote`. Resolves `{ status, body }` to send as JSON. */
    async quote(searchParams) {
      const query = quoteQuery(searchParams, { maxSlippageBps: config.maxSlippageBps });
      const chain = query.get("chain");
      const { status, j } = await router("/quote", { query });
      if (status === 0) return { status: 502, body: { error: { code: "upstream_unavailable", message: "The EVM router is unreachable" } } };
      if (status !== 200) {
        // The router's own code (`no_route`, `not_ready`, …), a sentence to show.
        const code = j?.error === "declined" ? j.reason : typeof j?.error === "string" ? j.error : "upstream";
        return { status: status === 401 || status === 403 ? 502 : status, body: { error: { code: code || "upstream", message: describeRouterError(status, j) } } };
      }
      const amount = (v) => typeof v === "string" && /^[0-9]{1,78}$/.test(v);
      if (
        !j || typeof j.quoteId !== "string" || j.chainId !== EVM_CHAINS[chain].chainId
        || !amount(j.inAmount) || !amount(j.outAmount) || !amount(j.otherAmountThreshold)
        || !isEvmAddress(j.router) || !Array.isArray(j.routePlan)
      ) {
        return { status: 502, body: { error: { code: "upstream", message: "The EVM router answered without a quote" } } };
      }
      return { status: 200, body: { ...j, quoteToken: book.put({ evm: true, chain, quote: j }) } };
    },

    /**
     * Build → check → sign → send for one vault wallet. `stillUnlocked` is
     * asked right before signing: a vault locked meanwhile signs nothing.
     */
    async swap(wallet, kept, { stillUnlocked = () => true } = {}) {
      if (!kept?.evm) throw new EvmError("quote_expired", "That quote expired: get a new one", 409);
      const { chain, quote } = kept;
      const chainId = EVM_CHAINS[chain].chainId;
      if (evmAddressOfKey(wallet.secret) !== lower(wallet.address)) {
        throw new EvmError("bad_key", "The stored key does not match this wallet", 500);
      }
      // The quote back as it came, Jupiter style: the router builds the one it holds.
      const { status, j } = await router("/swap", {
        body: { userPublicKey: wallet.address, destinationTokenAccount: wallet.address, quoteResponse: quote },
      });
      if (status === 0) throw new EvmError("router", "The EVM router is unreachable");
      if (status !== 200) throw new EvmError("router", describeRouterError(status, j), status === 409 ? 409 : 502);
      const txs = checkedTransactions(j, { quote, owner: wallet.address, chainId });
      const fee = await fees(chain, j);

      return serial(wallet.address, async () => {
        const pending = BigInt(await rpc(chain, "eth_getTransactionCount", [wallet.address, "pending"]));
        const key = `${chain}:${lower(wallet.address)}`;
        const start = pending > (nextNonce.get(key) ?? 0n) ? pending : nextNonce.get(key);
        let nonce = start;
        if (!stillUnlocked()) throw new EvmError("locked", "Locked: enter your password", 401);
        const signed = txs.map((tx) => {
          const s = signEip1559({ chainId: BigInt(chainId), nonce, ...fee, ...tx }, wallet.secret);
          nonce += 1n;
          return s;
        });
        const sent = [];
        for (const s of signed) {
          try {
            await rpc(chain, "eth_sendRawTransaction", [s.raw]);
          } catch (e) {
            if (sent.length) nextNonce.set(key, start + BigInt(sent.length));
            const msg = e instanceof Error ? e.message : String(e);
            const which = sent.length < signed.length - 1 ? "the approval" : "the swap";
            throw new EvmError("rpc", `Could not send ${which}: ${msg.replace(/^\w+ RPC: /, "")}`, 422);
          }
          sent.push(s.hash);
        }
        nextNonce.set(key, nonce);
        return {
          signature: sent[sent.length - 1],
          hash: sent[sent.length - 1],
          approvals: sent.slice(0, -1),
          chain,
          inAmount: quote.inAmount,
          outAmount: j.simulation?.outAmount ?? quote.outAmount,
          otherAmountThreshold: quote.otherAmountThreshold,
        };
      });
    },

    /**
     * Wait for `hash`'s receipt: read on every new block the chain's socket
     * announces, and once right after subscribing; a read every `pollMs`
     * only when no socket can be opened.
     */
    confirm(chain, hash, { timeoutMs = 120_000, signal } = {}) {
      if (!Object.hasOwn(EVM_CHAINS, chain)) return Promise.reject(bad("Unknown EVM chain"));
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return Promise.reject(bad("Bad transaction hash"));
      return new Promise((resolve, reject) => {
        let done = false;
        let ws = null;
        let poll = null;
        let reading = false;
        let errors = 0;
        const finish = (err, value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (poll) clearInterval(poll);
          try { ws?.close(); } catch { /* ignore */ }
          if (err) reject(err);
          else resolve(value);
        };
        const timer = setTimeout(
          () => finish(new EvmError("timeout", "Not confirmed yet: check the explorer", 504)),
          timeoutMs,
        );
        // The browser went away or the vault locked: stop watching.
        signal?.addEventListener("abort", () => finish(new EvmError("gone", "No longer waiting", 499)), { once: true });
        const check = () => {
          if (done || reading) return;
          reading = true;
          rpc(chain, "eth_getTransactionReceipt", [hash])
            .then((rc) => {
              errors = 0;
              if (!rc) return;
              const block = rc.blockNumber ? Number(BigInt(rc.blockNumber)) : null;
              if (rc.status === "0x1") finish(null, { status: "confirmed", block, gasUsed: rc.gasUsed ? BigInt(rc.gasUsed).toString() : null });
              else finish(new EvmError("reverted", "The swap failed on-chain (reverted)", 422));
            })
            .catch((e) => {
              // A slow answer: the next block decides. An RPC that refuses
              // receipt reads would leave the trader waiting for nothing.
              if (++errors >= RECEIPT_ERRORS_MAX) {
                const why = (e instanceof Error ? e.message : String(e)).replace(/^\w+ RPC: /, "");
                finish(new EvmError("rpc", `Sent, but the ${chain} RPC cannot read its receipt (${why}): check the explorer, and set EVM_RPC_URL_${chain.toUpperCase()} to an RPC that can`, 502));
              }
            })
            .finally(() => { reading = false; });
        };
        const fallback = () => {
          if (done || poll) return;
          check();
          poll = setInterval(check, pollMs);
        };
        if (!Socket) return fallback();
        try {
          ws = new Socket(rpcUrls(chain).ws);
        } catch {
          return fallback();
        }
        ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }));
        ws.onmessage = (ev) => {
          let m;
          try {
            m = JSON.parse(String(ev.data));
          } catch {
            return;
          }
          if (m.id === 1) {
            if (m.error) fallback();
            else check(); // it may have landed before the subscription
            return;
          }
          if (m.method === "eth_subscription") check();
        };
        ws.onerror = () => fallback();
        ws.onclose = () => fallback();
      });
    },

    /**
     * `owner`'s balance of `token` (`native` or a 0x address), raw, and the
     * token's decimals. Without an owner, the decimals only (`raw` null).
     */
    async balance(chain, owner, token) {
      if (!Object.hasOwn(EVM_CHAINS, chain)) throw bad("Unknown EVM chain");
      if (owner && !isEvmAddress(owner)) throw bad("Bad owner");
      if (token === "native") {
        if (!owner) return { raw: null, decimals: 18 };
        const v = await rpc(chain, "eth_getBalance", [owner, "latest"]);
        return { raw: BigInt(v ?? "0x0").toString(), decimals: 18 };
      }
      if (!isEvmAddress(token)) throw bad("Bad token");
      const word = String(owner).toLowerCase().replace(/^0x/, "").padStart(64, "0");
      const [dec, bal] = await Promise.all([
        rpc(chain, "eth_call", [{ to: token, data: "0x313ce567" }, "latest"]),
        owner ? rpc(chain, "eth_call", [{ to: token, data: `0x70a08231${word}` }, "latest"]) : null,
      ]);
      const word256 = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v);
      if (!word256(dec) || (owner && !word256(bal))) throw new EvmError("rpc", "Not a token on this chain", 422);
      const decimals = Number(BigInt(dec));
      if (!Number.isInteger(decimals) || decimals > 36) throw new EvmError("rpc", "The token reports odd decimals", 422);
      return { raw: owner ? BigInt(bal).toString() : null, decimals };
    },
  };
}
