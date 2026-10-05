import { Keypair } from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { BackendWallet, WalletKind } from "./backend";
import { getActiveChain, type ChainId } from "../lib/chains";
import { evmapiGet } from "./evmapi";
import { BROWSER_WALLET_ID, getBrowserWallet } from "../lib/swap/browserWallet";

const STORAGE_KEY = "trade-ui.wallets.v1";

export type StoredWallet = BackendWallet & {
  secret?: string | null;
};

type Store = { wallets: StoredWallet[] };

function load(): Store {
  if (typeof window === "undefined") return { wallets: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { wallets: [] };
    const parsed = JSON.parse(raw) as Store;
    return { wallets: Array.isArray(parsed.wallets) ? parsed.wallets : [] };
  } catch {
    return { wallets: [] };
  }
}

function save(store: Store): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(raw: string): Uint8Array {
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function evmAddressFromPriv(priv: Uint8Array): string {
  const pub = secp256k1.getPublicKey(priv, false).slice(1);
  const hash = keccak_256(pub);
  return `0x${toHex(hash.slice(-20))}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function id(): string {
  return `w_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function publicWallet(w: StoredWallet): BackendWallet {
  const { secret: _s, ...rest } = w;
  return rest;
}

export function listLocalWallets(chainId?: string): {
  wallets: BackendWallet[];
  limit: number;
  used: number;
} {
  const chain = chainId || getActiveChain();
  const all = load().wallets;
  const wallets = all.filter((w) => (w.chainId || "sol") === chain).map(publicWallet);
  return { wallets, limit: 0, used: all.length };
}

export function createLocalWallet(label?: string, chainId?: string): BackendWallet {
  const chain = (chainId || getActiveChain()) as ChainId;
  const store = load();
  let pubkey = "";
  let secret: string | null = null;
  if (chain === "sol") {
    const kp = Keypair.generate();
    pubkey = kp.publicKey.toBase58();
    secret = bytesToB64(kp.secretKey);
  } else {
    const priv = secp256k1.utils.randomSecretKey();
    pubkey = evmAddressFromPriv(priv);
    secret = toHex(priv);
  }
  const wallet: StoredWallet = {
    id: id(),
    kind: "PLATFORM",
    chainId: chain,
    pubkey,
    label: label || null,
    createdAt: nowIso(),
    lastUsedAt: null,
    secret,
    solBalance: 0,
    usdcBalance: 0,
  };
  store.wallets.push(wallet);
  save(store);
  return publicWallet(wallet);
}

function looksEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

function looksEvmPriv(s: string): boolean {
  const t = s.trim().replace(/^0x/i, "");
  return /^[a-fA-F0-9]{64}$/.test(t);
}

export function importLocalWallet(secretOrAddress: string, label?: string, chainId?: string): BackendWallet {
  const raw = secretOrAddress.trim();
  if (!raw) throw new Error("empty_secret");
  const chain = (chainId || getActiveChain()) as ChainId;
  const store = load();
  let pubkey = "";
  let secret: string | null = null;
  let kind: WalletKind = "PLATFORM";

  if (looksEvmAddress(raw)) {
    pubkey = raw;
    secret = null;
    kind = "PLATFORM";
  } else if (looksEvmPriv(raw)) {
    const hex = raw.replace(/^0x/i, "");
    const priv = new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    pubkey = evmAddressFromPriv(priv);
    secret = hex;
  } else {
    try {
      const bytes = raw.includes(",")
        ? Uint8Array.from(JSON.parse(raw) as number[])
        : b64ToBytes(raw);
      if (bytes.length === 64 || bytes.length === 32) {
        const kp = bytes.length === 64
          ? Keypair.fromSecretKey(bytes)
          : Keypair.fromSeed(bytes);
        pubkey = kp.publicKey.toBase58();
        secret = bytesToB64(kp.secretKey);
      } else {
        pubkey = raw;
        secret = null;
      }
    } catch {
      pubkey = raw;
      secret = null;
    }
  }

  if (store.wallets.some((w) => w.pubkey === pubkey && (w.chainId || "sol") === chain)) {
    throw new Error("duplicate_wallet");
  }

  const wallet: StoredWallet = {
    id: id(),
    kind,
    chainId: chain,
    pubkey,
    label: label || null,
    createdAt: nowIso(),
    lastUsedAt: null,
    secret,
    solBalance: 0,
    usdcBalance: 0,
  };
  store.wallets.push(wallet);
  save(store);
  return publicWallet(wallet);
}

export function deleteLocalWallet(walletId: string): void {
  const store = load();
  store.wallets = store.wallets.filter((w) => w.id !== walletId);
  save(store);
}

export function renameLocalWallet(walletId: string, label: string): BackendWallet {
  const store = load();
  const w = store.wallets.find((x) => x.id === walletId);
  if (!w) throw new Error("wallet_not_found");
  w.label = label;
  save(store);
  return publicWallet(w);
}

/** Local Solana wallets that can sign (a key is stored, not watch-only). */
export function localSolanaSigners(): Array<{ id: string; pubkey: string; label: string | null }> {
  return load().wallets
    .filter((w) => (w.chainId || "sol") === "sol" && w.kind === "PLATFORM" && !!w.secret)
    .map((w) => ({ id: w.id, pubkey: w.pubkey, label: w.label }));
}

/** What a local trade signs with: the wallet's Solana keypair (64 bytes,
 *  seed ‖ public key). Throws a sentence the trader can act on. */
export function localSolanaSigner(walletId: string): { pubkey: string; secretKey: Uint8Array } {
  const w = load().wallets.find((x) => x.id === walletId);
  if (!w) throw new Error("Wallet not found");
  if (w.kind === "DEMO") throw new Error("Demo wallets do not trade on chain");
  if ((w.chainId || "sol") !== "sol") throw new Error("Not a Solana wallet");
  if (!w.secret) throw new Error("Watch-only wallet: import its key to trade with it");
  const secretKey = b64ToBytes(w.secret);
  if (secretKey.length !== 64) throw new Error("Stored key is not a Solana keypair");
  return { pubkey: w.pubkey, secretKey };
}

export function exportLocalSecret(walletId: string): { pubkey: string; chainId: string; secret: string } {
  const store = load();
  const w = store.wallets.find((x) => x.id === walletId);
  if (!w) throw new Error("wallet_not_found");
  if (!w.secret) throw new Error("watch_only_wallet");
  return { pubkey: w.pubkey, chainId: w.chainId || "sol", secret: w.secret };
}

export function createLocalDemo(args?: { label?: string; initialSol?: number; initialUsdc?: number; chainId?: string }): BackendWallet {
  const chain = (args?.chainId || getActiveChain()) as ChainId;
  const store = load();
  if (store.wallets.some((w) => w.kind === "DEMO" && (w.chainId || "sol") === chain)) {
    throw new Error("demo_exists");
  }
  const wallet: StoredWallet = {
    id: id(),
    kind: "DEMO",
    chainId: chain,
    pubkey: `demo:${id()}`,
    label: args?.label || "Demo",
    createdAt: nowIso(),
    lastUsedAt: null,
    secret: null,
    solBalance: args?.initialSol ?? 10,
    usdcBalance: args?.initialUsdc ?? 1000,
    initialSolBalance: args?.initialSol ?? 10,
    initialUsdcBalance: args?.initialUsdc ?? 1000,
  };
  store.wallets.push(wallet);
  save(store);
  return publicWallet(wallet);
}

export function resetLocalDemo(walletId: string): BackendWallet {
  const store = load();
  const w = store.wallets.find((x) => x.id === walletId);
  if (!w || w.kind !== "DEMO") throw new Error("wallet_not_found");
  w.solBalance = w.initialSolBalance ?? 10;
  w.usdcBalance = w.initialUsdcBalance ?? 1000;
  save(store);
  return publicWallet(w);
}

export async function fetchLocalBalances(walletIds?: string[]): Promise<{
  balances: Record<string, { ok: true; balances: { sol: number; tokens: Array<{ mint: string; amount: number; decimals: number }> } } | { ok: false; error: string }>;
}> {
  const store = load();
  const targets: StoredWallet[] = store.wallets.filter((w) => !walletIds?.length || walletIds.includes(w.id));
  // The connected browser wallet is in the list too (not stored here).
  const browser = getBrowserWallet();
  if (browser && getActiveChain() === "sol" && (!walletIds?.length || walletIds.includes(BROWSER_WALLET_ID))) {
    targets.push({
      id: BROWSER_WALLET_ID,
      kind: "PHANTOM",
      chainId: "sol",
      pubkey: browser.address,
      label: browser.wallet.name,
      createdAt: "",
      lastUsedAt: null,
    });
  }
  const balances: Record<string, { ok: true; balances: { sol: number; tokens: Array<{ mint: string; amount: number; decimals: number }> } } | { ok: false; error: string }> = {};
  await Promise.all(targets.map(async (w) => {
    if (w.kind === "DEMO") {
      balances[w.id] = {
        ok: true,
        balances: { sol: w.solBalance ?? 0, tokens: [] },
      };
      return;
    }
    const chain = (w.chainId || "sol") as ChainId;
    try {
      // The wallet profile carries the native balance in whole coins
      // (SOL / ETH / BNB); holdings carry amounts in whole tokens, no decimals.
      const [profile, holdings] = await Promise.all([
        evmapiGet<{ nativeBalance?: number | null }>(
          `/wallets/${chain}/${encodeURIComponent(w.pubkey)}`,
          { period: "30d" },
        ).catch(() => null),
        evmapiGet<Array<{ token?: string; amount?: number | null }>>(
          `/wallets/${chain}/${encodeURIComponent(w.pubkey)}/holdings`,
          { limit: 100 },
        ).catch(() => null),
      ]);
      const raw = profile?.data?.nativeBalance;
      const sol = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      const tokens = (Array.isArray(holdings?.data) ? holdings!.data : []).map((h) => ({
        mint: String(h.token || ""),
        amount: Number(h.amount || 0),
        decimals: 0,
      })).filter((t) => t.mint && t.amount > 0);
      balances[w.id] = { ok: true, balances: { sol, tokens } };
    } catch (e) {
      balances[w.id] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }));
  return { balances };
}

export async function dispatchWalletRpc(method: string, params: unknown): Promise<unknown> {
  const p = (params || {}) as Record<string, unknown>;
  switch (method) {
    case "wallets.list":
      return listLocalWallets(typeof p.chainId === "string" ? p.chainId : undefined);
    case "wallets.createPlatform":
      return createLocalWallet(
        typeof p.label === "string" ? p.label : undefined,
        typeof p.chainId === "string" ? p.chainId : undefined,
      );
    case "wallets.importPlatform":
      return importLocalWallet(
        String(p.secret || ""),
        typeof p.label === "string" ? p.label : undefined,
        typeof p.chainId === "string" ? p.chainId : undefined,
      );
    case "wallets.delete":
      deleteLocalWallet(String(p.id || ""));
      return;
    case "wallets.rename":
      return renameLocalWallet(String(p.id || ""), String(p.label || ""));
    case "wallets.exportSecret":
      return exportLocalSecret(String(p.id || ""));
    case "wallets.createDemo":
      return createLocalDemo({
        label: typeof p.label === "string" ? p.label : undefined,
        initialSol: typeof p.initialSol === "number" ? p.initialSol : undefined,
        initialUsdc: typeof p.initialUsdc === "number" ? p.initialUsdc : undefined,
        chainId: typeof p.chainId === "string" ? p.chainId : undefined,
      });
    case "wallets.resetDemo":
      return resetLocalDemo(String(p.id || ""));
    case "wallets.balances":
      return fetchLocalBalances(Array.isArray(p.walletIds) ? p.walletIds as string[] : undefined);
    default:
      throw new Error("not_supported_selfhosted");
  }
}
