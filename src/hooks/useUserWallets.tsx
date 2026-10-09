"use client";
/**
 * The wallets of this Trade UI and the "active" selection shared by the top
 * bar, the sidebar, the portfolio and the trading panels.
 *
 * Source: the vault on this Trade UI's server (src/lib/vault/client.ts). The
 * provider re-reads whenever the vault's list changes (WALLETS_EVENT, fired by
 * every create / import / rename / delete), so the wallet page and the
 * panels never disagree. A Solana wallet shows on Solana, an EVM wallet on
 * every EVM chain.
 *
 * Active selection: the wallets the next trade signs with, kept per chain in
 * localStorage. Several can be active at once (one trade each, all at once).
 * Only wallets with a key can be active: watch-only wallets never trade.
 *
 * Side-effect: mirrors the wallets into localStorage under
 * PORTFOLIO_STORAGE_KEY for the code that reads it synchronously
 * during render.
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
import { useChain } from "../contexts/ChainContext";
import type { ChainId } from "../lib/chains";
import { fetchBalances, familyOf, toChainWallet, type ChainWallet } from "../api/vaultWallets";
import { PORTFOLIO_STORAGE_KEY } from "../lib/userWalletsMirror";
import { WALLETS_EVENT, cachedWallets, vault, type VaultWallet } from "../lib/vault/client";

const WALLETS_CHANGED_EVENT = "terminal:wallets-changed";
const ACTIVE_WALLETS_STORAGE_KEY = "trade.active-wallets.v2";

function defaultLabel(w: { label: string | null; pubkey: string; kind: ChainWallet["kind"] }): string {
  if (w.label) return w.label;
  return `${w.kind === "WATCH" ? "Watch" : "Wallet"} ${w.pubkey.slice(0, 4)}`;
}

let lastMirrorPayload = "";

function mirrorToLocalStorage(wallets: ChainWallet[]) {
  if (typeof window === "undefined") return;
  try {
    const mapped = wallets.map((w) => ({
      id: w.id,
      label: defaultLabel(w),
      address: w.pubkey,
      createdAt: w.createdAt,
    }));
    const payload = JSON.stringify(mapped);
    if (payload === lastMirrorPayload) return;
    lastMirrorPayload = payload;
    window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, payload);
    // Same-tab signal for the sidebar to re-read the mirror.
    window.dispatchEvent(new Event(WALLETS_CHANGED_EVENT));
  } catch {
    /* ignore quota / private mode */
  }
}

function activeStorageKey(chainId: ChainId): string {
  return `${ACTIVE_WALLETS_STORAGE_KEY}.${chainId}`;
}

function readActiveSet(chainId: ChainId): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(activeStorageKey(chainId)) || "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string" && v.length > 0));
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

export interface UserWallet extends ChainWallet {
  displayLabel: string;
  /** an address without its key: shows balances, never trades */
  watchOnly: boolean;
}

function decorate(w: VaultWallet, chain: ChainId): UserWallet {
  const b = toChainWallet(w, chain);
  return { ...b, displayLabel: defaultLabel(b), watchOnly: w.watchOnly };
}

export interface WalletBalance {
  /** Native balance in whole coins (SOL / ETH / BNB). */
  sol: number;
  /** mint → token amount in display units (already divided by decimals). */
  tokens: Record<string, number>;
  /** True while the first read is in flight. */
  loading: boolean;
  /** Last time a read touched this wallet (ms). */
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

function keepKnownBalance(cur?: WalletBalance): WalletBalance {
  return {
    sol: finiteNumber(cur?.sol) ?? 0,
    tokens: cur?.tokens ?? {},
    loading: false,
    updatedAt: cur?.updatedAt ?? 0,
  };
}

interface Value {
  /** This chain's wallets: Solana on Solana, EVM on the EVM chains. */
  wallets: UserWallet[];
  loading: boolean;
  error: string | null;
  /** Re-read the vault's list. */
  refresh: () => Promise<void>;

  // Active selection — shared across sidebar / portfolio / trading panel.
  activeIds: Set<string>;
  activeWallets: UserWallet[];
  isActive: (id: string) => boolean;
  toggleActive: (id: string) => void;
  setActive: (ids: string[]) => void;
  clearActive: () => void;

  // Balances, keyed by wallet id.
  balances: Record<string, WalletBalance>;
  /** Read again now (after a trade, from the sidebar's refresh). */
  refreshBalances: (walletId?: string) => Promise<Record<string, WalletBalance>>;
}

const Ctx = createContext<Value | null>(null);

export function UserWalletsProvider({ children }: { children: React.ReactNode }) {
  const { chainId } = useChain();

  const [all, setAll] = useState<VaultWallet[]>(() => cachedWallets());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Lazy-read so the first render already has the saved selection.
  const [activeIds, setActiveIdsState] = useState<Set<string>>(() => readActiveSet(chainId));

  const wallets = useMemo(
    () => all.filter((w) => w.family === familyOf(chainId)).map((w) => decorate(w, chainId)),
    [all, chainId],
  );

  const refresh = useCallback(async () => {
    try {
      await vault.list(); // fires WALLETS_EVENT, which updates `all`
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const sync = () => setAll(cachedWallets());
    window.addEventListener(WALLETS_EVENT, sync);
    void refresh();
    return () => window.removeEventListener(WALLETS_EVENT, sync);
  }, [refresh]);

  useEffect(() => {
    if (!loading) mirrorToLocalStorage(wallets);
  }, [wallets, loading]);

  // Reload the persisted selection when the user switches chain (not on the
  // first mount: the lazy init already read it).
  const chainHydratedRef = useRef(false);
  useEffect(() => {
    if (!chainHydratedRef.current) {
      chainHydratedRef.current = true;
      return;
    }
    setActiveIdsState(readActiveSet(chainId));
  }, [chainId]);

  // Persist only once the list has loaded, so an empty first render never
  // overwrites the saved selection.
  useEffect(() => {
    if (loading) return;
    writeActiveSet(chainId, activeIds);
  }, [chainId, activeIds, loading]);

  // Drop selected ids that no longer exist or cannot sign.
  useEffect(() => {
    if (loading) return;
    const tradeable = new Set(wallets.filter((w) => !w.watchOnly).map((w) => w.id));
    setActiveIdsState((prev) => {
      const kept = [...prev].filter((id) => tradeable.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [wallets, loading]);

  // ── balances ─────────────────────────────────────────────────────────

  const [balances, setBalances] = useState<Record<string, WalletBalance>>({});
  const walletIdsKey = useMemo(() => wallets.map((w) => w.id).sort().join(","), [wallets]);

  useEffect(() => {
    if (wallets.length === 0) {
      setBalances({});
      return;
    }
    // Loading flags first, so the UI does not flash "0.00".
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
        const res = await fetchBalances();
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
      } catch { /* keep the last */ }
    };
    void pull();
    const timer = setInterval(() => { void pull(); }, 12_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // walletIdsKey covers roster changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletIdsKey, chainId]);

  const refreshBalances = useCallback(
    async (walletId?: string): Promise<Record<string, WalletBalance>> => {
      try {
        const res = await fetchBalances(walletId ? [walletId] : undefined);
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
    [],
  );

  // ── selection ────────────────────────────────────────────────────────

  // Read from the vault's cache, not React state: a wallet created a moment
  // ago can be selected before this provider re-renders with it.
  const tradeableIds = useCallback(
    () => new Set(cachedWallets().filter((w) => w.family === familyOf(chainId) && !w.watchOnly).map((w) => w.id)),
    [chainId],
  );

  const toggleActive = useCallback(
    (id: string) => {
      setActiveIdsState((prev) => {
        if (!tradeableIds().has(id)) return prev;
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [tradeableIds],
  );

  const setActive = useCallback(
    (ids: string[]) => {
      setActiveIdsState((prev) => {
        const tradeable = tradeableIds();
        const next = new Set(ids.filter((id) => tradeable.has(id)));
        if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
        return next;
      });
    },
    [tradeableIds],
  );

  const clearActive = useCallback(() => {
    setActiveIdsState((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const isActive = useCallback((id: string) => activeIds.has(id), [activeIds]);

  const activeWallets = useMemo(
    () => wallets.filter((w) => activeIds.has(w.id)),
    [wallets, activeIds],
  );

  const value = useMemo<Value>(
    () => ({
      wallets, loading, error, refresh,
      activeIds, activeWallets, isActive, toggleActive, setActive, clearActive,
      balances, refreshBalances,
    }),
    [
      wallets, loading, error, refresh,
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
