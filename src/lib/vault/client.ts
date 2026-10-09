"use client";
/**
 * The browser's side of the lock and the wallet vault (server/api.mjs).
 *
 * Every write carries `x-trade-ui: 1`, which the server requires so a page on
 * another site cannot make this browser act. A `locked` answer from any of
 * these calls means the vault locked under us (idle, another tab, a restart):
 * `LOCKED_EVENT` fires and the lock screen takes over.
 *
 * Keys never come here, with one exception the user asks for with their
 * password: exporting a key. The recovery key comes here once, to be shown:
 * when the vault is made and when a new one is made.
 */
import { withBasePath } from "../basePath";

export type WalletFamily = "sol" | "evm";

export interface VaultWallet {
  id: string;
  family: WalletFamily;
  address: string;
  label: string | null;
  /** an address followed without its key: cannot sign */
  watchOnly: boolean;
  createdAt: string;
}

export interface AuthStatus {
  initialized: boolean;
  unlocked: boolean;
  /** the vault has a recovery key: "forgot your password" can work */
  recovery: boolean;
  apiKeyConfigured: boolean;
  retryAfterMs: number;
  autoLockMinutes: number | null;
  desktop: boolean;
  version: string;
}

export interface RuntimeConfig {
  apiBase: string;
  routerBase: string;
  rpcHost: string;
  apiKeyConfigured: boolean;
  vaultFile: string;
  recoveryKeySet: boolean;
  autoLockChoices: number[];
  autoLockMinutes: number;
  desktop: boolean;
  version: string;
}

export interface ImportItem {
  secret?: string;
  address?: string;
  label?: string;
}

export interface ImportResult {
  created: VaultWallet[];
  errors: Array<{ index: number; code: string; message: string }>;
}

export type ExportedKey =
  | { id: string; family: "sol"; address: string; base58: string; json: string }
  | { id: string; family: "evm"; address: string; hex: string };

export const LOCKED_EVENT = "trade-ui:locked";
export const WALLETS_EVENT = "trade-ui:vault-wallets";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterMs: number;
  constructor(status: number, code: string, message: string, retryAfterMs = 0) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function announceLocked(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCKED_EVENT));
}

async function request<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") {
    headers["x-trade-ui"] = "1";
    headers["content-type"] = "application/json";
  }
  let r: Response;
  try {
    r = await fetch(withBasePath(path), {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "offline", "Trade UI's server is not reachable");
  }
  let j: unknown = null;
  try {
    j = await r.json();
  } catch {
    /* handled below */
  }
  if (!r.ok) {
    const e = (j as { error?: { code?: string; message?: string; retryAfterMs?: number } } | null)?.error;
    const code = e?.code || `http_${r.status}`;
    if (r.status === 401 && code === "locked") announceLocked();
    throw new ApiError(r.status, code, e?.message || `HTTP ${r.status}`, e?.retryAfterMs ?? 0);
  }
  return j as T;
}

// ── the lock ────────────────────────────────────────────────────────────

export const auth = {
  status: () => request<AuthStatus>("GET", "/api/auth/status"),
  setup: (password: string, setupToken: string) =>
    request<{ ok: true; recoveryKey: string }>("POST", "/api/auth/setup", { password, setupToken }),
  unlock: (password: string) =>
    request<{ ok: true; autoLockMinutes: number }>("POST", "/api/auth/unlock", { password }),
  /** Forgotten password: the recovery key opens the vault under `password`. */
  recover: (recoveryKey: string, password: string) =>
    request<{ ok: true; autoLockMinutes: number }>("POST", "/api/auth/recover", { recoveryKey, password }),
  /** A new recovery key (the old one stops working), shown once. */
  newRecoveryKey: (password: string) =>
    request<{ recoveryKey: string }>("POST", "/api/auth/recovery-key", { password }),
  lock: () => request<{ ok: true }>("POST", "/api/auth/lock"),
  activity: () => request<{ ok: true; autoLockMinutes: number }>("POST", "/api/auth/activity"),
  changePassword: (current: string, next: string) =>
    request<{ ok: true }>("POST", "/api/auth/password", { current, next }),
  setAutoLock: (autoLockMinutes: number) =>
    request<{ ok: true; autoLockMinutes: number }>("POST", "/api/auth/settings", { autoLockMinutes }),
  config: () => request<RuntimeConfig>("GET", "/api/config"),
};

// ── the wallets ─────────────────────────────────────────────────────────

let cache: VaultWallet[] = [];

function remember(list: VaultWallet[]): VaultWallet[] {
  cache = list;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WALLETS_EVENT));
  return list;
}

/** The last list the server returned: for code outside React (a trade
 *  resolving its wallet's address). */
export function cachedWallets(): VaultWallet[] {
  return cache;
}

export const vault = {
  async list(): Promise<VaultWallet[]> {
    const r = await request<{ wallets: VaultWallet[] }>("GET", "/api/wallets");
    return remember(r.wallets);
  },
  async generate(family: WalletFamily, label?: string, count = 1): Promise<VaultWallet[]> {
    const r = await request<{ wallets: VaultWallet[] }>("POST", "/api/wallets/generate", { family, label, count });
    await vault.list();
    return r.wallets;
  },
  async import(items: ImportItem[]): Promise<ImportResult> {
    const r = await request<ImportResult>("POST", "/api/wallets/import", { items });
    await vault.list();
    return r;
  },
  async rename(id: string, label: string): Promise<VaultWallet> {
    const r = await request<{ wallet: VaultWallet }>("PATCH", `/api/wallets/${id}`, { label });
    await vault.list();
    return r.wallet;
  },
  async remove(id: string, password?: string): Promise<void> {
    await request("POST", `/api/wallets/${id}/delete`, { password });
    await vault.list();
  },
  exportKey: (id: string, password: string) => request<ExportedKey>("POST", `/api/wallets/${id}/export`, { password }),
  /** Build the server's kept quote on the router, sign it there, send it. */
  swap: (id: string, quoteToken: string, priorityFeeLamports?: number) =>
    request<{ signature: string; lastValidBlockHeight: number | null }>("POST", `/api/wallets/${id}/swap`, {
      quoteToken,
      priorityFeeLamports,
    }),
  /** Send SOL: `lamports` as a decimal string, or "max". */
  send: (id: string, to: string, lamports: string | "max", password: string) =>
    request<{ signature: string; lamports: string }>("POST", `/api/wallets/${id}/send`, {
      to,
      ...(lamports === "max" ? { amount: "max" } : { lamports }),
      password,
    }),
};
