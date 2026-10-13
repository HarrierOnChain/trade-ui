/**
 * Launch, server side: deploy a token and bundle the first buys from vault
 * wallets, on the Raze router's launch routes (router.raze.bot/launch).
 *
 *   build:   the browser's form, checked and narrowed here → router
 *            `POST /launch/{chain}` with the vault wallets' addresses and the
 *            configured RPC → unsigned transactions (Solana: the create, then
 *            one buy per wallet; Robinhood Chain: the deployer's EIP-1559
 *            transactions).
 *   sign:    every empty signature slot must belong to a wallet of this
 *            launch (the mint's and Bags' slots come signed): the vault signs
 *            those and nothing else. A transaction paid by a wallet outside
 *            the launch is refused.
 *   send:    over the configured RPC only. `safe`: the create, its
 *            confirmation, then the buys with preflight. `fast`: the buys go
 *            right behind the create, without preflight, to land in the same
 *            block or the next (a buy that lands first fails and costs its fee).
 *   confirm: signature statuses (Solana) or receipts (EVM).
 *
 * A launch runs as a job the browser polls (`GET /api/launch/jobs/:id`): the
 * build alone can take a minute. Locking stops a job before its next send.
 */
import crypto from "node:crypto";
import net from "node:net";
import { getTransactionDecoder, getTransactionEncoder } from "@solana/kit";
import { fromBase58, isEvmAddress, isSolanaAddress, solanaSign, toBase58 } from "./keys.mjs";
import { EVM_CHAINS, evmAddressOfKey } from "./evm.mjs";

export const MAX_WALLETS = 50;
const BUILD_TIMEOUT_MS = 95_000;
const CONFIRM_TIMEOUT_MS = 75_000;
const JOB_TTL_MS = 30 * 60_000;
const MAX_RUNNING = 2;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** A launch transaction asks for far less; above it, refuse. */
const EVM_GAS_CEILING = 10_000_000n;
const WEI = 10n ** 18n;

/** Chains with a launch builder on the router, and the wallet family each takes. */
export const LAUNCH_CHAINS = { sol: "sol", robinhood: "evm" };

const SOL_PLATFORMS = new Set(["pump", "raydium", "usd1", "meteora"]);
const BONK_TYPES = new Set(["standard", "bonkers", "balanced", "stonkfun", "stonkfun-reward"]);
const FEE_PROVIDERS = new Set(["twitter", "tiktok", "kick", "github", "instagram", "onlyfans", "solana"]);

export class LaunchError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const bad = (message) => new LaunchError("bad_request", message, 400);

// ── the browser's form → the router's body ─────────────────────────────

function text(v, what, { max, required = false } = {}) {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : null;
  if (s === null) throw bad(`${what} must be text`);
  if (required && !s) throw bad(`${what} is required`);
  if (s.length > max) throw bad(`${what}: at most ${max} characters`);
  return s;
}

function int(v, what, min, max, fallback) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${what} must be a whole number from ${min} to ${max}`);
  return n;
}

function amount(v, what) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw bad(`${what} is not an amount`);
  return n;
}

/** An `http(s)` or `ipfs` URL, or empty. */
function link(v, what) {
  const s = text(v, what, { max: 500 });
  if (!s) return "";
  if (/^ipfs:\/\//i.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return s;
  } catch {
    /* refused below */
  }
  throw bad(`${what} must be an http(s) or ipfs URL`);
}

/** The token's metadata, the same on every launchpad. */
function tokenOf(t) {
  const o = t && typeof t === "object" ? t : {};
  const token = {
    name: text(o.name, "Name", { max: 32, required: true }),
    symbol: text(o.symbol, "Ticker", { max: 10, required: true }).replace(/^\$/, ""),
    description: text(o.description, "Description", { max: 1000 }),
    image: link(o.image, "Image"),
    twitter: link(o.twitter, "X link"),
    telegram: link(o.telegram, "Telegram link"),
    website: link(o.website, "Website"),
  };
  const uri = link(o.metadataUri, "Metadata URI");
  if (uri) token.metadataUri = uri;
  if (!token.image && !uri) throw bad("An image URL is required");
  for (const k of Object.keys(token)) if (token[k] === "") delete token[k];
  return token;
}

/**
 * Narrow the browser's launch form to the router's body. Fields the router
 * would act on but this UI does not offer (product fees, display creators,
 * Jito tips) never pass.
 *
 * @param {any} form
 * @param {string[]} addresses the launch's wallets, creator first
 */
export function launchBody(form, addresses) {
  const chain = form.chain;
  const amounts = (Array.isArray(form.amounts) ? form.amounts : []).map((a, i) => amount(a, `Amount ${i + 1}`));
  if (amounts.length !== addresses.length) throw bad("One amount per wallet");
  const token = tokenOf(form.token);
  const slippageBps = int(form.slippageBps, "Slippage", 0, 10_000, undefined);

  if (chain === "robinhood") {
    if (token.description == null) throw bad("pons needs a description");
    if (!token.image) throw bad("pons needs an image URL");
    const pairToken = text(form.pairToken, "Pair token", { max: 42 }) || "eth";
    if (!/^(eth|native|[A-Za-z]{2,6}|0x[0-9a-fA-F]{40})$/.test(pairToken)) throw bad("Pair token: eth, a pons pair symbol or a 0x address");
    const creatorTaxBps = int(form.creatorTaxBps, "Creator tax", 0, 1000, 0);
    const body = {
      platform: "pons",
      wallets: addresses,
      token,
      pairToken,
      devBuyEth: amounts[0],
      creatorTaxBps,
      buybackEnabled: form.buybackEnabled === true,
    };
    if (slippageBps != null) body.slippageBps = Math.min(slippageBps, 9000);
    return body;
  }

  const platform = String(form.platform || "pump");
  if (!SOL_PLATFORMS.has(platform)) throw bad("Unknown launchpad");
  const body = { platform, wallets: addresses, amounts, token, encoding: "base64" };
  if (slippageBps != null) body.slippageBps = slippageBps;
  const cuPrice = int(form.computeUnitPrice, "Priority price", 0, 50_000_000, undefined);
  if (cuPrice != null) body.computeUnitPrice = cuPrice;
  const mintKey = text(form.mintKey, "Mint key", { max: 100 });
  if (mintKey) {
    const raw = fromBase58(mintKey);
    if (!raw || raw.length !== 64) throw bad("The mint key is the mint's 64-byte secret key, base58");
    raw.fill(0);
    if (platform === "meteora") throw bad("Bags reserves its own mint: leave the mint key empty");
    body.mintKey = mintKey;
  }

  if (platform === "pump") {
    const quote = String(form.quoteMint || "SOL");
    if (quote !== "SOL" && quote !== USDC_MINT) throw bad("Pump.fun quote: SOL or USDC");
    body.quoteMint = quote;
    if (form.mayhem === true) body.mayhem = true;
    if (form.holderReward === true) body.holderReward = true;
  } else if (platform === "raydium") {
    const bonkType = String(form.bonkType || "standard");
    if (!BONK_TYPES.has(bonkType)) throw bad("Unknown LaunchLab mode");
    body.bonkType = bonkType;
    if (bonkType === "stonkfun-reward") body.rewardTaxBps = int(form.rewardTaxBps, "Reward tax", 100, 300, 100);
  } else if (platform === "meteora") {
    if (amounts.slice(1).some((a) => a <= 0)) throw bad("On Bags every wallet after the creator must buy");
    const claimers = Array.isArray(form.feeClaimers) ? form.feeClaimers : [];
    if (claimers.length > 14) throw bad("At most 14 fee claimers");
    let total = 0;
    body.feeClaimers = claimers.map((c, i) => {
      const provider = String(c?.provider || "");
      if (!FEE_PROVIDERS.has(provider)) throw bad(`Fee claimer ${i + 1}: unknown provider`);
      const username = text(c?.username, `Fee claimer ${i + 1}`, { max: 64, required: true });
      const bps = int(c?.bps, `Fee claimer ${i + 1} share`, 1, 10_000, undefined);
      if (bps == null) throw bad(`Fee claimer ${i + 1}: a share is required`);
      total += bps;
      return { provider, username, bps };
    });
    if (total > 10_000) throw bad("Fee claimers share more than 100%");
    if (!body.feeClaimers.length) delete body.feeClaimers;
  }
  return body;
}

// ── signing ─────────────────────────────────────────────────────────────

/**
 * Sign the empty slots of one router-built Solana transaction with the
 * launch's own keys. Every empty slot must be one of `keys`, and the fee
 * payer (the first signer) must be one too.
 *
 * @param {string} b64
 * @param {Map<string, Uint8Array>} keys address → 64-byte secret, the launch's wallets
 * @returns {{ signed: string, signature: string, payer: string, version: number | "legacy" }}
 */
export function signLaunchTx(b64, keys) {
  let tx;
  try {
    tx = getTransactionDecoder().decode(Buffer.from(b64, "base64"));
  } catch {
    throw new LaunchError("bad_build", "The router answered an unreadable transaction");
  }
  const signers = Object.keys(tx.signatures);
  const payer = signers[0];
  if (!payer || !keys.has(payer)) throw new LaunchError("bad_build", "The router built a transaction paid by a wallet outside this launch");
  const signatures = { ...tx.signatures };
  for (const address of signers) {
    if (signatures[address] != null) continue;
    const secret = keys.get(address);
    if (!secret) throw new LaunchError("bad_build", `The router built a transaction that needs ${address.slice(0, 6)}…, which is not in this launch`);
    if (toBase58(secret.subarray(32)) !== address) throw new LaunchError("bad_key", "A stored key does not match its wallet", 500);
    signatures[address] = solanaSign(secret, Uint8Array.from(tx.messageBytes));
  }
  const signed = getTransactionEncoder().encode({ ...tx, signatures });
  const first = tx.messageBytes[0];
  const version = first & 0x80 ? first & 0x7f : "legacy";
  return { signed: Buffer.from(signed).toString("base64"), signature: toBase58(signatures[payer]), payer, version };
}

/**
 * The router's Robinhood Chain transactions, checked before signing: the
 * deployer's, on chain 4663, to the launch's factory or router (an approval:
 * of the pair token), within a gas ceiling, paying at most the dev buy plus
 * the launch fee.
 */
export function checkedEvmLaunch(data, { deployer, devBuy }) {
  const refuse = (why) => new LaunchError("bad_build", `The launch router built something this Trade UI does not sign (${why})`);
  const txs = Array.isArray(data?.unsignedTxs) ? data.unsignedTxs : [];
  if (!txs.length || txs.length > 3) throw refuse("no transactions");
  const targets = new Set([data.router, data.factory].filter(isEvmAddress).map((a) => a.toLowerCase()));
  const pair = isEvmAddress(data.pairToken) ? data.pairToken.toLowerCase() : null;
  const fee = /^0x[0-9a-fA-F]{1,64}$/.test(String(data.launchFee ?? "")) ? BigInt(data.launchFee) : WEI / 100n;
  const devWei = BigInt(Math.round(devBuy * 1e9)) * 10n ** 9n;
  const chainId = EVM_CHAINS.robinhood.chainId;
  const hex = (v, what) => {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{0,64}$/.test(v)) throw refuse(what);
    return BigInt(v === "0x" ? "0x0" : v);
  };
  return txs.map((tx, i) => {
    if (!tx || typeof tx !== "object") throw refuse("malformed");
    if (String(tx.from).toLowerCase() !== deployer.toLowerCase()) throw refuse("from another wallet");
    if (Number(tx.chainId) !== chainId) throw refuse("another chain");
    if (!isEvmAddress(tx.to) || typeof tx.data !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(tx.data)) throw refuse("malformed");
    const to = tx.to.toLowerCase();
    const approve = tx.stage === "approve";
    if (approve ? to !== pair : !targets.has(to)) throw refuse(`transaction ${i + 1} to an unexpected contract`);
    const value = hex(tx.value ?? "0x0", "value");
    if (value > devWei + fee) throw refuse("a value above the dev buy and the launch fee");
    const gas = hex(tx.gas, "gas");
    if (gas <= 0n || gas > EVM_GAS_CEILING) throw refuse("gas");
    return {
      stage: String(tx.stage || "launch"),
      to,
      data: tx.data.toLowerCase(),
      value,
      gas,
      maxFeePerGas: hex(tx.maxFeePerGas, "fees"),
      maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas, "fees"),
    };
  });
}

/** What a refused build says, from the launch envelope or the key gate. */
export function describeLaunchError(status, j) {
  if (status === 401 || status === 403) return "The router refused the API key: check RAZE_API_KEY";
  if (status === 429) return "Too many launches for this API key: at most 10 a minute";
  if (status === 504) return "The launch build took more than 90 s: try again";
  if (status === 501) return "This launchpad has no builder on the router yet";
  const e = j?.error;
  const msg = typeof e === "object" && e ? e.message : typeof e === "string" ? (j.reason || e) : "";
  return msg ? `Launch refused: ${msg}` : `Launch failed (HTTP ${status})`;
}

/** Whether Raze's server could reach `url`: not a loopback or private address. */
export function publicRpc(url) {
  let h;
  try {
    h = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".internal")) return false;
  if (net.isIPv4(h)) {
    const [a, b] = h.split(".").map(Number);
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  if (net.isIPv6(h)) return !(h === "::1" || /^f[cd]/i.test(h) || /^fe80/i.test(h));
  return true;
}

// ── the network ────────────────────────────────────────────────────────

/**
 * @param {{ routerBase: string, apiKey: string, launchRpcUrl: string, evmRpc: Record<string, { http: string }> }} config
 * @param {{ solana: ReturnType<typeof import("./solana.mjs").createSolana>,
 *           evm: ReturnType<typeof import("./evm.mjs").createEvm>,
 *           fetch?: typeof fetch, pollMs?: number }} deps
 */
export function createLaunch(config, deps) {
  const doFetch = deps.fetch ?? fetch;
  const { solana, evm } = deps;
  const pollMs = deps.pollMs ?? 700;
  /** @type {Map<string, any>} */
  const jobs = new Map();

  async function router(path, body) {
    const headers = { accept: "application/json" };
    if (body) headers["content-type"] = "application/json";
    if (config.apiKey) headers["x-api-key"] = config.apiKey;
    let r;
    try {
      r = await doFetch(`${config.routerBase}/launch${path}`, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        // A redirect would carry the key and the body elsewhere.
        redirect: "error",
        signal: AbortSignal.timeout(body ? BUILD_TIMEOUT_MS : 15_000),
      });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      throw new LaunchError(timedOut ? "upstream_timeout" : "router", timedOut ? "The launch build timed out: try again" : "The launch router is unreachable", timedOut ? 504 : 502);
    }
    let j = null;
    try {
      j = JSON.parse(await r.text());
    } catch {
      /* below */
    }
    if (r.status !== 200 || !j || j.ok === false) {
      throw new LaunchError(j?.error?.code || "launch_failed", describeLaunchError(r.status, j), r.status === 400 ? 400 : 502);
    }
    return j.data;
  }

  /** Statuses of `sigs` until each is confirmed or failed, or the timeout. */
  async function confirmAll(sigs, onUpdate, stillUnlocked) {
    const open = new Set(sigs);
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (open.size && Date.now() < deadline && stillUnlocked()) {
      const list = [...open];
      try {
        const r = await solana.rpc("getSignatureStatuses", [list, { searchTransactionHistory: false }]);
        (r?.value ?? []).forEach((v, i) => {
          if (!v) return;
          if (v.err) {
            onUpdate(list[i], "failed", `Failed on-chain (${JSON.stringify(v.err)})`);
            open.delete(list[i]);
          } else if (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized") {
            onUpdate(list[i], "confirmed");
            open.delete(list[i]);
          }
        });
      } catch {
        /* a slow read: the next one decides */
      }
      if (open.size) await new Promise((res) => setTimeout(res, pollMs));
    }
    for (const s of open) onUpdate(s, "unknown", "Not confirmed yet: check the explorer");
  }

  async function sendSol(b64, { skipPreflight = false } = {}) {
    const sig = await solana.rpc("sendTransaction", [
      b64,
      { encoding: "base64", skipPreflight, preflightCommitment: "confirmed", maxRetries: 5 },
    ]);
    if (typeof sig !== "string") throw new LaunchError("rpc", "The RPC did not return a signature");
    return sig;
  }

  /** Sign and land a Bags provisioning stage (the fee-share config). */
  async function landStage(job, txs, keys, stillUnlocked) {
    const signed = txs.map((t) => signLaunchTx(t, keys));
    for (const s of signed) {
      if (!stillUnlocked()) throw new LaunchError("locked", "Locked: the launch stopped", 401);
      await sendSol(s.signed);
    }
    let failed = null;
    await confirmAll(signed.map((s) => s.signature), (_sig, status, error) => {
      if (status !== "confirmed") failed = error || status;
    }, stillUnlocked);
    if (failed) throw new LaunchError("launch_failed", `The Bags fee-share config did not land: ${failed}`);
    job.log.push(`Bags config landed (${signed.length} transaction${signed.length > 1 ? "s" : ""})`);
  }

  async function runSolana(job, wallets, body, mode, stillUnlocked) {
    const keys = new Map(wallets.map((w) => [w.address, w.secret]));
    job.stage = "build";
    let data = await router("/sol", body);
    if (body.platform === "meteora" && Array.isArray(data?.stages) && !(data.transactions?.length)) {
      job.stage = "provision";
      job.mint = data.mint ?? null;
      const stageTxs = data.stages.flatMap((s) => (Array.isArray(s?.transactions) ? s.transactions : []));
      await landStage(job, stageTxs.map(toB64), keys, stillUnlocked);
      job.stage = "build";
      data = await router("/sol", {
        ...body,
        feeShareConfigKey: data.config,
        mintPubkey: data.mint,
        token: { ...body.token, metadataUri: data.metadataUri },
      });
    }
    const txs = Array.isArray(data?.transactions) ? data.transactions : [];
    if (!txs.length) throw new LaunchError("bad_build", "The router answered no transactions");
    if (txs.length > MAX_WALLETS + 2) throw new LaunchError("bad_build", "The router answered too many transactions");
    job.mint = typeof data.mint === "string" && isSolanaAddress(data.mint) ? data.mint : null;
    job.pool = typeof data.pool === "string" ? data.pool : null;

    job.stage = "sign";
    if (!stillUnlocked()) throw new LaunchError("locked", "Locked: the launch stopped", 401);
    const legs = Array.isArray(data.legs) ? data.legs : [];
    const signed = txs.map((t, i) => {
      const s = signLaunchTx(toB64(t), keys);
      if (legs[i]?.wallet && legs[i].wallet !== s.payer) throw new LaunchError("bad_build", "The router's legs do not match its transactions");
      return s;
    });
    // The mint signs the create: it must be in it.
    if (job.mint && !signersOf(toB64(txs[0])).includes(job.mint)) {
      throw new LaunchError("bad_build", "The create is not signed by the mint the router named");
    }
    job.legs = signed.map((s, i) => ({
      kind: legs[i]?.kind ?? (i === 0 ? "create" : "buy"),
      wallet: s.payer,
      walletId: wallets.find((w) => w.address === s.payer)?.id ?? null,
      signature: s.signature,
      version: s.version,
      status: "signed",
      error: null,
    }));
    const set = (i, status, error = null) => {
      job.legs[i].status = status;
      job.legs[i].error = error;
    };
    const bySig = (sig, status, error) => {
      const i = job.legs.findIndex((l) => l.signature === sig);
      if (i >= 0) set(i, status, error ?? null);
    };

    job.stage = "create";
    try {
      await sendSol(signed[0].signed);
      set(0, "sent");
    } catch (e) {
      set(0, "failed", e instanceof Error ? e.message : String(e));
      for (let i = 1; i < job.legs.length; i++) set(i, "skipped", "The create was not sent");
      throw new LaunchError("launch_failed", `The create was refused: ${e instanceof Error ? e.message : e}`, 422);
    }

    if (mode === "safe") {
      await confirmAll([signed[0].signature], bySig, stillUnlocked);
      if (job.legs[0].status !== "confirmed") {
        for (let i = 1; i < job.legs.length; i++) set(i, "skipped", "The create did not confirm");
        throw new LaunchError("launch_failed", `The create did not land: ${job.legs[0].error || job.legs[0].status}`, 422);
      }
    }

    job.stage = "buys";
    for (let i = 1; i < signed.length; i++) {
      if (!stillUnlocked()) {
        for (let k = i; k < signed.length; k++) set(k, "skipped", "Locked before it was sent");
        break;
      }
      try {
        await sendSol(signed[i].signed, { skipPreflight: mode === "fast" });
        set(i, "sent");
      } catch (e) {
        set(i, "failed", e instanceof Error ? e.message : String(e));
      }
    }

    job.stage = "confirm";
    const pending = job.legs.filter((l) => l.status === "sent").map((l) => l.signature);
    await confirmAll(pending, bySig, stillUnlocked);
  }

  async function runEvm(job, wallets, body, stillUnlocked) {
    const deployer = wallets[0];
    if (evmAddressOfKey(deployer.secret) !== deployer.address.toLowerCase()) {
      throw new LaunchError("bad_key", "The stored key does not match this wallet", 500);
    }
    job.stage = "build";
    const data = await router("/robinhood", { ...body, rpcUrl: config.evmRpc.robinhood.http });
    const txs = checkedEvmLaunch(data, { deployer: deployer.address, devBuy: body.devBuyEth || 0 });
    job.mint = typeof data.mint === "string" && isEvmAddress(data.mint) ? data.mint : null;
    job.pool = typeof data.predictedCurve === "string" ? data.predictedCurve : null;
    job.stage = "sign";
    job.legs = txs.map((t) => ({ kind: t.stage, wallet: deployer.address, walletId: deployer.id, signature: null, version: 2, status: "signed", error: null }));
    job.stage = "create";
    const hashes = await evm.signAndSend("robinhood", deployer, txs.map(({ to, data: d, value, gas }) => ({ to, data: d, value, gas })), {
      maxFeePerGas: txs[0].maxFeePerGas,
      maxPriorityFeePerGas: txs[0].maxPriorityFeePerGas,
    }, { stillUnlocked, what: (i) => `transaction ${i + 1} (${txs[i].stage})` });
    hashes.forEach((h, i) => {
      job.legs[i].signature = h;
      job.legs[i].status = "sent";
    });
    job.stage = "confirm";
    for (const leg of job.legs) {
      try {
        await evm.confirm("robinhood", leg.signature, { timeoutMs: CONFIRM_TIMEOUT_MS });
        leg.status = "confirmed";
      } catch (e) {
        leg.status = "failed";
        leg.error = e instanceof Error ? e.message : String(e);
        break;
      }
    }
  }

  function prune() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, j] of jobs) if (j.done && j.updatedAt < cutoff) jobs.delete(id);
  }

  return {
    router,

    /** The router's catalog: every chain, or one chain's launchpads. */
    catalog(chain) {
      if (chain && !/^[a-z0-9]{2,20}$/i.test(chain)) throw bad("Unknown chain");
      return router(chain ? `/${chain}` : "", null);
    },

    /**
     * Start a launch. `wallets`: vault wallets with their secrets, creator
     * first; their secrets are zeroed when the job ends.
     */
    start(form, wallets, { stillUnlocked = () => true } = {}) {
      prune();
      const running = [...jobs.values()].filter((j) => !j.done).length;
      if (running >= MAX_RUNNING) throw new LaunchError("busy", "Another launch is still running", 429);
      const chain = String(form.chain || "");
      const family = LAUNCH_CHAINS[chain];
      if (!family) throw bad("No launchpad builder on this chain");
      if (!wallets.length) throw bad("Pick the creator wallet");
      if (wallets.length > MAX_WALLETS) throw bad(`At most ${MAX_WALLETS} wallets, the creator included`);
      if (wallets.some((w) => w.family !== family)) throw bad(chain === "sol" ? "Solana wallets only" : "EVM wallets only");
      const body = launchBody({ ...form, chain }, wallets.map((w) => w.address));
      const mode = form.sendMode === "fast" ? "fast" : "safe";
      if (family === "sol") {
        if (!publicRpc(config.launchRpcUrl)) {
          throw bad("The launch router reads the chain through your RPC: set LAUNCH_RPC_URL (or SOLANA_RPC_URL) to a public one");
        }
        body.rpcUrl = config.launchRpcUrl;
      }

      const id = `l_${crypto.randomBytes(8).toString("hex")}`;
      const job = {
        id, chain, platform: body.platform, mode, stage: "queued",
        mint: null, pool: null, legs: [], log: [], error: null, done: false,
        startedAt: Date.now(), updatedAt: Date.now(),
      };
      jobs.set(id, job);
      const run = family === "sol" ? runSolana(job, wallets, body, mode, stillUnlocked) : runEvm(job, wallets, body, stillUnlocked);
      run.then(
        () => {
          job.stage = job.legs.length && job.legs.every((l) => l.status === "confirmed") ? "done" : "partial";
        },
        (e) => {
          job.stage = "failed";
          job.error = e instanceof Error ? e.message : String(e);
          if (!(e instanceof LaunchError)) console.error("[trade-ui] launch failed:", e);
        },
      ).finally(() => {
        job.done = true;
        job.updatedAt = Date.now();
        for (const w of wallets) w.secret?.fill(0);
      });
      return { id };
    },

    job(id) {
      const j = jobs.get(id);
      if (!j) throw new LaunchError("not_found", "No such launch (they are forgotten when the vault locks)", 404);
      j.updatedAt = Date.now();
      return j;
    },

    /** The vault locked: forget every launch (running ones stop at their next send). */
    clear() {
      jobs.clear();
    },
  };
}

/**
 * A transaction as base64. The router answers base64 when asked, but its
 * previous Solana build ignores `encoding` and answers base58: a transaction's
 * base64 always holds one of `0 O I l + / =`, which base58 never does.
 */
export function toB64(t) {
  if (typeof t !== "string" || !t) throw new LaunchError("bad_build", "The router answered a malformed transaction");
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(t)) return t;
  const raw = fromBase58(t);
  if (!raw) throw new LaunchError("bad_build", "The router answered a malformed transaction");
  return Buffer.from(raw).toString("base64");
}

function signersOf(b64) {
  try {
    return Object.keys(getTransactionDecoder().decode(Buffer.from(b64, "base64")).signatures);
  } catch {
    return [];
  }
}
