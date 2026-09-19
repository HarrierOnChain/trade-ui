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
  CHAIN_AVAILABILITY_EVENT,
  CHAIN_CHANGED_EVENT,
  CHAIN_LIST,
  CHAINS,
  type Chain,
  type ChainId,
  getActiveChain,
  isChainEnabled,
  isChainId,
  readStoredChain,
  setActiveChain,
  writeStoredChain,
} from "../lib/chains";

export interface SetChainOpts {
  /** Default true. Token-URL / deploy wizard pass false so wizard state survives. */
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
    if (stored && isChainEnabled(stored) && stored !== chainId) {
      setActiveChain(stored);
      setChainIdState(stored);
    } else {
      setActiveChain(chainId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the module-level mirror (read by the data fetchers) in sync on
  // every subsequent change.
  useEffect(() => {
    setActiveChain(chainId);
  }, [chainId]);

  // Admin chain availability arrives with the system config (AuthGate →
  // applyChainAvailability). Re-render so the switcher drops disabled chains,
  // and adopt the clamp if the active chain was just disabled.
  const [availabilityTick, setAvailabilityTick] = useState(0);
  useEffect(() => {
    const onAvailability = () => {
      setAvailabilityTick((t) => t + 1);
      setChainIdState(getActiveChain());
    };
    const onChanged = (e: Event) => {
      const id = (e as CustomEvent<{ chainId?: string }>).detail?.chainId;
      if (typeof id === "string" && isChainId(id) && isChainEnabled(id)) {
        setChainIdState(id);
      } else {
        setChainIdState(getActiveChain());
      }
    };
    window.addEventListener(CHAIN_AVAILABILITY_EVENT, onAvailability);
    window.addEventListener(CHAIN_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(CHAIN_AVAILABILITY_EVENT, onAvailability);
      window.removeEventListener(CHAIN_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setChain = useCallback((id: ChainId, opts?: SetChainOpts) => {
    if (id === chainId) return;
    if (!isChainEnabled(id)) return;
    setActiveChain(id);
    writeStoredChain(id);
    // A chain switch changes EVERY data surface (deploys, trending, holders,
    // top traders, token info, OHLC, live prices, chain health, …). Many of
    // those hooks key only off `mint`/mount — not the chain — so an in-place
    // state update left them showing the previous chain's data. Reload so the
    // whole tree re-initialises against the now-persisted chain: the only way
    // to guarantee nothing stays stale. Static chunks are cached, so this is a
    // re-parse, not a re-download. Token URLs and the deploy wizard skip the
    // reload so they can keep local state.
    if (opts?.reload !== false && typeof window !== "undefined") {
      window.location.reload();
      return;
    }
    startTransition(() => setChainIdState(id));
  }, [chainId]);

  const value = useMemo<Value>(
    () => ({
      chain: CHAINS[chainId],
      chainId,
      setChain,
      chains: CHAIN_LIST.filter((c) => isChainEnabled(c.id)),
    }),
    // availabilityTick invalidates the filtered list when the admin config lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainId, setChain, availabilityTick],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChain() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChain must be used inside ChainProvider");
  return v;
}
