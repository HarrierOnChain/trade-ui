"use client";
/**
 * Browser wallets (Phantom, Solflare, Backpack, …) through the Wallet Standard:
 * discovery, connect, disconnect, and the one connected account. Module-level,
 * so the trade executor (outside React) and the UI read the same state.
 *
 * Only wallets that speak Solana mainnet and can sign a transaction are
 * listed. The last wallet used reconnects silently on the next visit.
 */
import { getWallets } from "@wallet-standard/app";
import { useSyncExternalStore } from "react";
import { SIGN, SIGN_AND_SEND, type StdAccount, type StdWallet } from "./sign";

const CONNECT = "standard:connect";
const DISCONNECT = "standard:disconnect";
const EVENTS = "standard:events";
const LAST_KEY = "trade-ui.browser-wallet";

/** The synthetic id the browser wallet carries in the wallet list. */
export const BROWSER_WALLET_ID = "browser";

export interface BrowserWalletState {
  /** Solana wallets installed in this browser */
  available: StdWallet[];
  /** the connected wallet and account, if any */
  connected: { wallet: StdWallet; address: string } | null;
  connecting: boolean;
}

interface ConnectFeature {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StdAccount[] }>;
}
interface DisconnectFeature {
  disconnect(): Promise<void>;
}
interface EventsFeature {
  on(event: "change", cb: (p: { accounts?: readonly StdAccount[] }) => void): () => void;
}

let state: BrowserWalletState = { available: [], connected: null, connecting: false };
const listeners = new Set<() => void>();
let started = false;
let offChange: (() => void) | null = null;

function set(next: Partial<BrowserWalletState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function isSolanaWallet(w: StdWallet): boolean {
  const chains = w.chains ?? [];
  const solana = chains.some((c) => c === "solana:mainnet" || c.startsWith("solana:"));
  return solana && CONNECT in w.features && (SIGN_AND_SEND in w.features || SIGN in w.features);
}

function solanaAccount(accounts: readonly StdAccount[]): StdAccount | null {
  return accounts.find((a) => !a.chains || a.chains.some((c) => c.startsWith("solana:"))) ?? null;
}

function remember(name: string | null) {
  try {
    if (name) localStorage.setItem(LAST_KEY, name);
    else localStorage.removeItem(LAST_KEY);
  } catch { /* ignore */ }
}

function attach(wallet: StdWallet, address: string) {
  offChange?.();
  offChange = null;
  const events = wallet.features[EVENTS] as EventsFeature | undefined;
  if (events) {
    offChange = events.on("change", ({ accounts }) => {
      if (!accounts) return;
      const acc = solanaAccount(accounts);
      if (!acc) set({ connected: null });
      else if (state.connected?.wallet === wallet) set({ connected: { wallet, address: acc.address } });
    });
  }
  set({ connected: { wallet, address } });
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const api = getWallets();
  const refresh = () => {
    const available = (api.get() as unknown as StdWallet[]).filter(isSolanaWallet);
    set({ available });
    // Silent reconnect of the wallet used last time, once it registers.
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_KEY); } catch { /* ignore */ }
    if (last && !state.connected && !state.connecting) {
      const w = available.find((x) => x.name === last);
      if (w) void connectBrowserWallet(w.name, { silent: true }).catch(() => {});
    }
  };
  api.on("register", refresh);
  api.on("unregister", refresh);
  refresh();
}

export async function connectBrowserWallet(name: string, opts: { silent?: boolean } = {}): Promise<string> {
  start();
  const wallet = state.available.find((w) => w.name === name);
  if (!wallet) throw new Error(`${name} is not installed in this browser`);
  set({ connecting: true });
  try {
    const { accounts } = await (wallet.features[CONNECT] as ConnectFeature).connect(
      opts.silent ? { silent: true } : undefined,
    );
    const acc = solanaAccount(accounts.length ? accounts : wallet.accounts);
    if (!acc) throw new Error("The wallet shared no Solana account");
    attach(wallet, acc.address);
    remember(wallet.name);
    return acc.address;
  } finally {
    set({ connecting: false });
  }
}

export async function disconnectBrowserWallet(): Promise<void> {
  const cur = state.connected;
  offChange?.();
  offChange = null;
  set({ connected: null });
  remember(null);
  const f = cur?.wallet.features[DISCONNECT] as DisconnectFeature | undefined;
  if (f) await f.disconnect().catch(() => {});
}

export function getBrowserWallet(): BrowserWalletState["connected"] {
  return state.connected;
}

function subscribe(l: () => void): () => void {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
}

const SERVER_STATE: BrowserWalletState = { available: [], connected: null, connecting: false };

export function useBrowserWallet(): BrowserWalletState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}
