"use client";
/**
 * Single source of truth for the logged-in user's wallets AND the
 * "active" selection that's shared between the shell sidebar, the
 * portfolio, and the trading panel.
 *
 * Source: Raze Terminal backend `/wallets` for the current region.
 *
 * Architecture: a Provider fetches once per region/auth change and
 * broadcasts the result through context, so that consumers like the
 * portfolio page, the trading panel, and the shell bootstrap share a
 * single HTTP request per state change instead of each mounting its own
 * fetch loop.
 *
 * Active selection rules:
 *   - Connected (PHANTOM) and Platform (PLATFORM) wallets are mutually
 *     exclusive. Activating one kind clears the other. You can trade
 *     with your connected wallet OR one/more platform wallets, never a
 *     mix (different signing paths + UX).
 *   - Multiple PLATFORM wallets can be active at once (fan-out trades).
 *   - Only one PHANTOM wallet exists per user, so "connected mode" is
 *     effectively a single-select.
 *
 * Side-effect: mirrors PLATFORM wallets into localStorage under
 * PORTFOLIO_STORAGE_KEY so the existing shell sidebar / tracker code
 * (which reads that key synchronously during render) sees a fresh list.
 * The Phantom wallet is intentionally excluded from the mirror: it is the
 * login identity shown in the TopBar, not an entry in the "my wallets"
 * list.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useApp } from "../contexts/AppContext";
import { useRegion } from "../contexts/RegionContext";
import { useChain } from "../contexts/ChainContext";
import { nativeSymbol, type ChainId } from "../lib/chains";
import { BackendClient, readSession, type BackendWallet, type WalletKind } from "../api/backend";
import { PORTFOLIO_STORAGE_KEY } from "../lib/trackerWallets";
import { BROWSER_WALLET_ID, useBrowserWallet } from "../lib/swap/browserWallet";

const WALLETS_CHANGED_EVENT = "terminal:wallets-changed";
const ACTIVE_WALLETS_STORAGE_KEY = "trade.active-wallets.v2";
const ACTIVE_WALLETS_LEGACY_KEY = "trade.active-wallets.v1";

function defaultLabel(w: { kind: WalletKind; label: string | null; pubkey: string }): string {
  if (w.label) return w.label;
  if (w.kind === "PHANTOM") return "Phantom";
  if (w.kind === "DEMO") return "Demo";
  return `Platform ${w.pubkey.slice(0, 4)}`;
}

let lastMirrorPayload = "";

function mirrorToLocalStorage(wallets: BackendWallet[]) {
  if (typeof window === "undefined") return;
  try {
    // Exclude PHANTOM (login identity, not a tradeable wallet here) and
    // DEMO (synthetic pubkey isn't an on-chain address — feeds the
    // legacy tracker/x-handle paths that subscribeSigners on the WS,
    // which would 4xx on "demo:<cuid>").
    const mapped = wallets
      .filter((w) => w.kind !== "PHANTOM" && w.kind !== "DEMO")
      .map((w) => ({
        id: w.id,
        label: defaultLabel(w),
        address: w.pubkey,
        createdAt: w.createdAt,
      }));
    const payload = JSON.stringify(mapped);
    if (payload === lastMirrorPayload) return;
    lastMirrorPayload = payload;
    window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, payload);
    // Fires a same-tab event so the shell sidebar & tracker re-read the
    // mirror. This hook itself must NOT listen — otherwise every write
    // recursively re-fetches and /wallets render-loops.
    window.dispatchEvent(new Event(WALLETS_CHANGED_EVENT));
  } catch {
    /* ignore quota / private mode */
  }
}

function activeStorageKey(chainId: ChainId): string {
  return `${ACTIVE_WALLETS_STORAGE_KEY}.${chainId}`;
}

function parseIdList(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string" && v.length > 0));
  } catch {
    return new Set();
  }
}

function readActiveSet(chainId: ChainId): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const keyed = localStorage.getItem(activeStorageKey(chainId));
    if (keyed) return parseIdList(keyed);
    // One-time migration from the global v1 key (Solana-era installs).
    if (chainId === "sol") {
      const legacy = parseIdList(localStorage.getItem(ACTIVE_WALLETS_LEGACY_KEY));
      if (legacy.size > 0) {
        localStorage.setItem(activeStorageKey(chainId), JSON.stringify([...legacy]));
        localStorage.removeItem(ACTIVE_WALLETS_LEGACY_KEY);
        return legacy;
      }
    }
    return new Set();
  } catch {
    return new Set();
  }
}

function writeActiveSet(chainId: ChainId, ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(activeStorageKey(chainId), JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

function isActiveStorageKey(key: string | null): boolean {
  if (!key) return false;
  return key === ACTIVE_WALLETS_LEGACY_KEY || key.startsWith(`${ACTIVE_WALLETS_STORAGE_KEY}.`);
}

export interface UserWallet extends BackendWallet {
  displayLabel: string;
  isConnected: boolean; // true for the PHANTOM primary wallet
}

function decorate(w: BackendWallet): UserWallet {
  return {
    ...w,
    displayLabel: defaultLabel(w),
    isConnected: w.kind === "PHANTOM",
  };
}

export interface WalletBalance {
  /** Native SOL balance in SOL units (not lamports). */
  sol: number;
  /** mint → token amount in display units (already divided by decimals). */
  tokens: Record<string, number>;
  /** True while the initial REST seed is in flight. */
  loading: boolean;
  /** Last time a live snapshot or trade patch touched this wallet (ms). */
  updatedAt: number;
}

type BalanceApiEntry =
  | { ok: true; balances?: { sol?: unknown; tokens?: unknown } }
  | { ok: false; error?: unknown }
  | undefined;

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeFetchedTokens(tokens: unknown): Record<string, number> | null {
  if (!Array.isArray(tokens)) return null;
  const out: Record<string, number> = {};
  for (const item of tokens) {
    if (!item || typeof item !== "object") continue;
    const t = item as { mint?: unknown; amount?: unknown };
    const mint = typeof t.mint === "string" ? t.mint : "";
    const amount = finiteNumber(t.amount);
    if (!mint || amount == null || amount <= 0) continue;
    out[mint] = amount;
  }
  return out;
}

function tokensEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

function keepKnownBalance(cur?: WalletBalance): WalletBalance {
  return {
    sol: finiteNumber(cur?.sol) ?? 0,
    tokens: cur?.tokens ?? {},
    loading: false,
    updatedAt: cur?.updatedAt ?? 0,
  };
}

/** Outcome of a bulk create/import: what landed, what failed, and whether the
 *  per-user wallet cap cut the run short. */
export interface BulkWalletResult {
  created: BackendWallet[];
  /** Per-item failures that weren't the wallet cap (duplicate, invalid key…). */
  errors: Array<{ item: string; reason: string }>;
  /** True when the server's wallet_limit_reached stopped the run early. */
  limitReached: boolean;
}

interface Value {
  wallets: UserWallet[];
  loading: boolean;
  error: string | null;
  /** Effective per-user wallet cap from the backend. 0 = unlimited. */
  walletLimit: number;
  /** Total wallets counted against the cap (spans every chain). */
  walletCount: number;
  /** Wallets that can still be added. Infinity when the cap is unlimited. */
  walletsRemaining: number;
  refresh: () => Promise<void>;
  createPlatform: (label?: string) => Promise<BackendWallet>;
  importPlatform: (secret: string, label?: string) => Promise<BackendWallet>;
  /** Create `count` platform wallets in one run; refreshes once at the end. */
  createPlatformBulk: (
    count: number,
    opts?: { labelPrefix?: string; onProgress?: (done: number, total: number) => void },
  ) => Promise<BulkWalletResult>;
  /** Import many base58 secrets in one run; refreshes once at the end. */
  importPlatformBulk: (
    entries: Array<{ secret: string; label?: string }>,
    opts?: { onProgress?: (done: number, total: number) => void },
  ) => Promise<BulkWalletResult>;
  createDemo: (args?: { label?: string; initialSol?: number; initialUsdc?: number }) => Promise<BackendWallet>;
  resetDemo: (id: string) => Promise<BackendWallet>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, label: string) => Promise<void>;

  // Active selection — shared across sidebar / portfolio / trading panel.
  activeIds: Set<string>;
  activeWallets: UserWallet[];
  isActive: (id: string) => boolean;
  toggleActive: (id: string) => void;
  setActive: (ids: string[]) => void;
  clearActive: () => void;

  // Live balances — snapshot on subscribe, patches on wallet trades.
  // Keyed by backend wallet id.
  balances: Record<string, WalletBalance>;
  /** Manual on-chain/RPC refresh (sidebar button). Updates shared balances. */
  refreshBalances: (walletId?: string) => Promise<Record<string, WalletBalance>>;
}

const Ctx = createContext<Value | null>(null);

export function UserWalletsProvider({ children }: { children: React.ReactNode }) {
  const { authed, pushToast, guestPhantomPubkey } = useApp();
  const { region } = useRegion();
  const { chainId } = useChain();

  const [storedWallets, setWallets] = useState<UserWallet[]>([]);
  // The connected browser wallet (Phantom, Solflare, … via the Wallet
  // Standard) joins the list as the "connected" wallet, on Solana only.
  const browser = useBrowserWallet().connected;
  const wallets = useMemo<UserWallet[]>(() => {
    if (!browser || chainId !== "sol") return storedWallets;
    return [
      ...storedWallets.filter((w) => w.id !== BROWSER_WALLET_ID && w.id !== "guest"),
      {
        id: BROWSER_WALLET_ID,
        kind: "PHANTOM",
        chainId: "sol",
        pubkey: browser.address,
        label: browser.wallet.name,
        displayLabel: browser.wallet.name,
        isConnected: true,
        createdAt: "",
        lastUsedAt: null,
      },
    ];
  }, [storedWallets, browser, chainId]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Effective wallet cap + total usage from the backend. limit 0 = unlimited.
  const [limitInfo, setLimitInfo] = useState<{ limit: number; used: number }>({ limit: 0, used: 0 });
  // Lazy-read so the first client render already has the saved selection.
  // A separate mount effect used to hydrate *after* a persist effect that
  // wrote `[]`, which wiped localStorage on every full page load.
  const [activeIds, setActiveIdsState] = useState<Set<string>>(() => readActiveSet(chainId));

  // Race guard: increment on every refresh; discard responses from stale
  // runs so region/auth switches don't overwrite fresh state with older.
  const currentKey = useRef(0);

  const client = useMemo(() => {
    const session = readSession();
    return new BackendClient(region.baseUrl, session?.token);
  }, [region.baseUrl, authed]);

  // Reload persisted selection when the user switches chain (not on the
  // initial mount — lazy init already read storage for the first chain).
  const chainHydratedRef = useRef(false);
  useEffect(() => {
    if (!chainHydratedRef.current) {
      chainHydratedRef.current = true;
      return;
    }
    setActiveIdsState(readActiveSet(chainId));
  }, [chainId]);

  // Persist after the wallet roster has loaded at least once so we never
  // snapshot an empty selection that was cleared mid-fetch.
  const persistReadyRef = useRef(false);
  useEffect(() => {
    if (!loading) persistReadyRef.current = true;
  }, [loading]);

  useEffect(() => {
    if (!persistReadyRef.current) return;
    writeActiveSet(chainId, activeIds);
  }, [chainId, activeIds]);

  const refresh = useCallback(async () => {
    if (!authed) {
      // For unauthenticated guests with Phantom connected, expose a synthetic
      // wallet so trading panels and position views can route trades through
      // the public-prepare / public-submit endpoints.
      if (guestPhantomPubkey) {
        setWallets([{
          id: "guest",
          kind: "PHANTOM",
          pubkey: guestPhantomPubkey,
          label: null,
          displayLabel: "Phantom",
          isConnected: true,
          createdAt: "",
          lastUsedAt: null,
        }]);
      } else {
        setWallets([]);
        mirrorToLocalStorage([]);
      }
      setLimitInfo({ limit: 0, used: 0 });
      return;
    }
    const key = ++currentKey.current;
    setLoading(true);
    try {
      const res = await client.listWallets(chainId);
      if (currentKey.current !== key) return;
      setWallets(res.wallets.map(decorate));
      setLimitInfo({ limit: res.limit ?? 0, used: res.used ?? res.wallets.length });
      // The localStorage mirror feeds the Solana tracker / x-handle paths,
      // which subscribe Solana signers.
      mirrorToLocalStorage(res.wallets);
      setError(null);
    } catch (e) {
      if (currentKey.current !== key) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (currentKey.current === key) setLoading(false);
    }
  }, [authed, client, guestPhantomPubkey, chainId]);

  useEffect(() => {
    void refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === PORTFOLIO_STORAGE_KEY) void refresh();
      if (isActiveStorageKey(e.key)) setActiveIdsState(readActiveSet(chainId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  // Reconcile persisted selection with the loaded wallet roster.
  // Critical: do NOT prune while `loading` — on refresh wallets starts as
  // `[]` and the old prune logic wiped every saved id before /wallets returned.
  useEffect(() => {
    if (loading) return;

    const live = new Set(wallets.map((w) => w.id));
    const stored = readActiveSet(chainId);

    setActiveIdsState((prev) => {
      const fromPrev = [...prev].filter((id) => live.has(id));
      if (fromPrev.length > 0) {
        const next = new Set(fromPrev);
        if (next.size === prev.size && fromPrev.every((id) => prev.has(id))) return prev;
        return next;
      }
      // Selection was cleared during the loading gap — restore from storage.
      const fromStored = [...stored].filter((id) => live.has(id));
      if (fromStored.length > 0) return new Set(fromStored);
      return prev;
    });
  }, [wallets, loading, chainId]);

  // ── Live balances ────────────────────────────────────────────────────
  //
  // Backend is the source of truth. We subscribe to the `wallets.balances`
  // topic: an initial snapshot on subscribe, then patch frames when our
  // wallets trade (platform via the signers feed, demo via fill invalidation).

  const [balances, setBalances] = useState<Record<string, WalletBalance>>({});

  // Keyed by region+wallet-set; bumping this re-subscribes when the user's
  // wallet roster changes (add/import/delete) so the backend sees the new
  // set of pubkeys.
  const walletIdsKey = useMemo(
    () => wallets.map((w) => w.id).sort().join(","),
    [wallets],
  );

  useEffect(() => {
    if (!authed) {
      setBalances({});
      return;
    }
    if (wallets.length === 0) {
      setBalances({});
      return;
    }

    // Seed loading flags so the UI doesn't flash "0.00" before the
    // snapshot frame arrives.
    setBalances((prev) => {
      const next: Record<string, WalletBalance> = {};
      for (const w of wallets) {
        const cur = prev[w.id];
        next[w.id] = {
          sol: cur?.sol ?? 0,
          tokens: cur?.tokens ?? {},
          loading: (cur?.updatedAt ?? 0) === 0,
          updatedAt: cur?.updatedAt ?? 0,
        };
      }
      return next;
    });

    let cancelled = false;
    const pull = async () => {
      if (cancelled) return;
      try {
        const res = await client.walletBalances();
        if (cancelled) return;
        setBalances((prev) => {
          const next: Record<string, WalletBalance> = { ...prev };
          const touchedAt = Date.now();
          for (const [id, raw] of Object.entries(res.balances)) {
            const entry = raw as BalanceApiEntry;
            if (!entry || !entry.ok) continue;
            const sol = finiteNumber(entry.balances?.sol) ?? 0;
            const tokenMap = normalizeFetchedTokens(entry.balances?.tokens) ?? {};
            next[id] = { sol, tokens: tokenMap, loading: false, updatedAt: touchedAt };
          }
          return next;
        });
      } catch { /* keep last */ }
    };
    void pull();
    const timer = setInterval(() => { void pull(); }, 12_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // walletIdsKey covers wallet roster changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, walletIdsKey, client]);

  const refreshBalances = useCallback(
    async (walletId?: string): Promise<Record<string, WalletBalance>> => {
      if (!authed) return {};
      try {
        const res = await client.walletBalances(walletId ? [walletId] : undefined);
        let nextSnapshot: Record<string, WalletBalance> = {};
        setBalances((prev) => {
          const next = { ...prev };
          const touchedAt = Date.now();
          for (const [id, raw] of Object.entries(res.balances)) {
            const entry = raw as BalanceApiEntry;
            if (!entry || !entry.ok) {
              next[id] = keepKnownBalance(prev[id]);
              continue;
            }
            const sol = finiteNumber(entry.balances?.sol);
            const tokenMap = normalizeFetchedTokens(entry.balances?.tokens);
            const cur = prev[id];
            next[id] = {
              sol: sol ?? finiteNumber(cur?.sol) ?? 0,
              tokens: tokenMap ?? cur?.tokens ?? {},
              loading: false,
              updatedAt: touchedAt,
            };
          }
          nextSnapshot = next;
          return next;
        });
        return nextSnapshot;
      } catch {
        return {};
      }
    },
    [authed, client],
  );

  // Enforce mode exclusivity: PHANTOM, PLATFORM, and DEMO are mutually
  // exclusive groups. Toggling on a wallet of one group clears any active
  // wallets in the other groups (you can't mix paper and real, or phantom
  // and platform signing paths in a single trade).
  const toggleActive = useCallback(
    (id: string) => {
      setActiveIdsState((prev) => {
        const target = wallets.find((w) => w.id === id);
        if (!target) return prev;
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          return next;
        }
        for (const existingId of [...next]) {
          const existing = wallets.find((w) => w.id === existingId);
          if (!existing) {
            next.delete(existingId);
            continue;
          }
          if (existing.kind !== target.kind) next.delete(existingId);
        }
        next.add(id);
        return next;
      });
    },
    [wallets],
  );

  const setActive = useCallback(
    (ids: string[]) => {
      setActiveIdsState((prev) => {
        // Mixed-kind input: keep only the first kind encountered.
        const byId = new Map(wallets.map((w) => [w.id, w] as const));
        let anchorKind: WalletKind | null = null;
        const next = new Set<string>();
        for (const id of ids) {
          const w = byId.get(id);
          if (!w) continue;
          if (anchorKind === null) anchorKind = w.kind;
          if (w.kind === anchorKind) next.add(id);
        }
        if (next.size === prev.size && [...next].every((id) => prev.has(id))) {
          return prev;
        }
        return next;
      });
    },
    [wallets],
  );

  const clearActive = useCallback(() => {
    setActiveIdsState((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const isActive = useCallback((id: string) => activeIds.has(id), [activeIds]);

  const activeWallets = useMemo(
    () => wallets.filter((w) => activeIds.has(w.id)),
    [wallets, activeIds],
  );

  const createPlatform = useCallback(
    async (label?: string) => {
      const created = await client.createPlatformWallet(label, chainId);
      await refresh();
      pushToast({
        title: "WALLET CREATED",
        body: `${created.pubkey.slice(0, 4)}…${created.pubkey.slice(-4)}`,
        tone: "buy",
      });
      return created;
    },
    [client, refresh, pushToast, chainId],
  );

  const importPlatform = useCallback(
    async (secret: string, label?: string) => {
      const created = await client.importPlatformWallet(secret, label, chainId);
      await refresh();
      pushToast({
        title: "WALLET IMPORTED",
        body: `${created.pubkey.slice(0, 4)}…${created.pubkey.slice(-4)}`,
        tone: "buy",
      });
      return created;
    },
    [client, refresh, pushToast, chainId],
  );

  // Both bulk helpers loop the single-op client call WITHOUT the per-item
  // refresh() that createPlatform/importPlatform run, then refresh once at the
  // end — a bulk of N would otherwise fire N /wallets round-trips. The server
  // enforces the cap per call, so a wallet_limit_reached mid-run stops the loop
  // cleanly and is reported (not thrown) so the caller can summarize.
  const isLimitError = (e: unknown): boolean =>
    (e as { code?: string })?.code === "wallet_limit_reached" ||
    (e instanceof Error && e.message.includes("wallet_limit_reached"));

  const createPlatformBulk = useCallback(
    async (
      count: number,
      opts?: { labelPrefix?: string; onProgress?: (done: number, total: number) => void },
    ): Promise<BulkWalletResult> => {
      const total = Math.max(0, Math.floor(count));
      const prefix = opts?.labelPrefix?.trim();
      const created: BackendWallet[] = [];
      const errors: Array<{ item: string; reason: string }> = [];
      let limitReached = false;
      for (let i = 0; i < total; i++) {
        // One wallet keeps the label verbatim; a batch numbers them "Label N".
        const label = prefix ? (total === 1 ? prefix : `${prefix} ${i + 1}`) : undefined;
        try {
          created.push(await client.createPlatformWallet(label, chainId));
        } catch (e) {
          if (isLimitError(e)) { limitReached = true; break; }
          errors.push({ item: `#${i + 1}`, reason: e instanceof Error ? e.message : String(e) });
        }
        opts?.onProgress?.(i + 1, total);
      }
      await refresh();
      if (created.length > 0) {
        pushToast({
          title: created.length === 1 ? "WALLET CREATED" : "WALLETS CREATED",
          body: `${created.length} platform wallet${created.length === 1 ? "" : "s"}`,
          tone: "buy",
        });
      }
      return { created, errors, limitReached };
    },
    [client, refresh, pushToast, chainId],
  );

  const importPlatformBulk = useCallback(
    async (
      entries: Array<{ secret: string; label?: string }>,
      opts?: { onProgress?: (done: number, total: number) => void },
    ): Promise<BulkWalletResult> => {
      const created: BackendWallet[] = [];
      const errors: Array<{ item: string; reason: string }> = [];
      let limitReached = false;
      for (let i = 0; i < entries.length; i++) {
        const { secret, label } = entries[i];
        const tag = `${secret.slice(0, 6)}…`;
        try {
          created.push(await client.importPlatformWallet(secret, label?.trim() || undefined, chainId));
        } catch (e) {
          if (isLimitError(e)) { limitReached = true; break; }
          const code = (e as { code?: string })?.code;
          const reason =
            code === "wallet_exists" ? "already imported"
            : code === "invalid_secret" ? "invalid key"
            : e instanceof Error ? e.message : String(e);
          errors.push({ item: tag, reason });
        }
        opts?.onProgress?.(i + 1, entries.length);
      }
      await refresh();
      if (created.length > 0) {
        pushToast({
          title: created.length === 1 ? "WALLET IMPORTED" : "WALLETS IMPORTED",
          body: `${created.length} platform wallet${created.length === 1 ? "" : "s"}`,
          tone: "buy",
        });
      }
      return { created, errors, limitReached };
    },
    [client, refresh, pushToast, chainId],
  );

  const createDemo = useCallback(
    async (args?: { label?: string; initialSol?: number; initialUsdc?: number }) => {
      const created = await client.createDemoWallet({ ...args, chainId });
      await refresh();
      pushToast({
        title: "DEMO WALLET CREATED",
        body: `${(created.solBalance ?? 0).toFixed(0)} ${nativeSymbol(chainId)} · $${(created.usdcBalance ?? 0).toLocaleString()} USDC`,
        tone: "buy",
      });
      return created;
    },
    [client, refresh, pushToast, chainId],
  );

  const resetDemo = useCallback(
    async (id: string) => {
      const updated = await client.resetDemoWallet(id);
      await refresh();
      pushToast({
        title: "DEMO WALLET RESET",
        body: `Restored to ${(updated.solBalance ?? 0).toFixed(0)} SOL · $${(updated.usdcBalance ?? 0).toLocaleString()} USDC`,
        tone: "default",
      });
      return updated;
    },
    [client, refresh, pushToast],
  );

  const remove = useCallback(
    async (id: string) => {
      await client.deleteWallet(id);
      await refresh();
    },
    [client, refresh],
  );

  const rename = useCallback(
    async (id: string, label: string) => {
      await client.renameWallet(id, label);
      await refresh();
    },
    [client, refresh],
  );

  const walletsRemaining = limitInfo.limit > 0
    ? Math.max(0, limitInfo.limit - limitInfo.used)
    : Infinity;

  const value = useMemo<Value>(
    () => ({
      wallets, loading, error,
      walletLimit: limitInfo.limit, walletCount: limitInfo.used, walletsRemaining,
      refresh,
      createPlatform, importPlatform, createPlatformBulk, importPlatformBulk,
      createDemo, resetDemo, remove, rename,
      activeIds, activeWallets, isActive, toggleActive, setActive, clearActive,
      balances, refreshBalances,
    }),
    [
      wallets, loading, error, limitInfo, walletsRemaining, refresh,
      createPlatform, importPlatform, createPlatformBulk, importPlatformBulk,
      createDemo, resetDemo, remove, rename,
      activeIds, activeWallets, isActive, toggleActive, setActive, clearActive,
      balances, refreshBalances,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUserWallets(): Value {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useUserWallets must be used inside UserWalletsProvider");
  }
  return v;
}
