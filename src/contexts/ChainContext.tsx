"use client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  startTransition,
} from "react";
import {
  CHAIN_CHANGED_EVENT,
  CHAIN_LIST,
  CHAINS,
  type Chain,
  type ChainId,
  getActiveChain,
  isChainId,
  readStoredChain,
  setActiveChain,
  writeStoredChain,
} from "../lib/chains";

export interface SetChainOpts {
  /** Default true. A token URL passes false so the page keeps its state. */
  reload?: boolean;
}

interface Value {
  chain: Chain;
  chainId: ChainId;
  setChain: (id: ChainId, opts?: SetChainOpts) => void;
  chains: Chain[];
}

const Ctx = createContext<Value | null>(null);

// SSR-stable default. The actual stored chain is loaded post-mount in the
// effect below, then the data fetchers see the swap via setActiveChain.
// Starting with anything else here causes React #418 (hydration mismatch)
// because SSR can't read localStorage and the client's first render would
// otherwise diverge.
const SSR_DEFAULT_CHAIN: ChainId = "sol";

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const [chainId, setChainIdState] = useState<ChainId>(SSR_DEFAULT_CHAIN);

  // Post-mount: load the persisted chain (if any) and reconcile.
  useEffect(() => {
    const stored = readStoredChain();
    if (stored && stored !== chainId) {
      setActiveChain(stored);
      setChainIdState(stored);
    } else {
      setActiveChain(chainId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the module-level mirror (read by the data fetchers) in sync on
  // every subsequent change. Not while the state still lags the stored chain:
  // on mount `chainId` is the SSR default, and writing it back would undo the
  // stored chain the effect above just set — the next render's fetches and
  // subscriptions would then go to Solana while the context says another chain.
  useEffect(() => {
    const stored = readStoredChain();
    if (stored && stored !== chainId) return;
    setActiveChain(chainId);
  }, [chainId]);

  // Another surface switched the module-level chain: follow it.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const id = (e as CustomEvent<{ chainId?: string }>).detail?.chainId;
      setChainIdState(typeof id === "string" && isChainId(id) ? id : getActiveChain());
    };
    window.addEventListener(CHAIN_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHAIN_CHANGED_EVENT, onChanged);
  }, []);

  const setChain = useCallback((id: ChainId, opts?: SetChainOpts) => {
    if (id === chainId) return;
    setActiveChain(id);
    writeStoredChain(id);
    // A chain switch changes EVERY data surface (deploys, trending, holders,
    // top traders, token info, OHLC, live prices, chain health, …). Many of
    // those hooks key only off `mint`/mount — not the chain — so an in-place
    // state update left them showing the previous chain's data. Reload so the
    // whole tree re-initialises against the now-persisted chain: the only way
    // to guarantee nothing stays stale. Static chunks are cached, so this is a
    // re-parse, not a re-download. Token URLs skip the reload so they can keep
    // local state.
    if (opts?.reload !== false && typeof window !== "undefined") {
      window.location.reload();
      return;
    }
    startTransition(() => setChainIdState(id));
  }, [chainId]);

  const value = useMemo<Value>(
    () => ({ chain: CHAINS[chainId], chainId, setChain, chains: CHAIN_LIST }),
    [chainId, setChain],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChain() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChain must be used inside ChainProvider");
  return v;
}
