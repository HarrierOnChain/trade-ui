"use client";
/* ─────────────────────────────────────────────────────────────
   Deployed-token registry
   Tokens the user launched via /deploy, recorded locally on a
   successful launch so the ticker bar's "Deployed" source can
   show them. Mirrors watchlist.ts storage semantics: one
   localStorage key, cross-tab `storage` sync, in-process
   subscriber set.
   ───────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CHAIN_CHANGED_EVENT, getActiveChain, coerceChainId, type ChainId } from "./chains";
import type { TokenEvent } from "../types";

export const DEPLOYED_STORAGE_KEY = "trade.myDeploys.v1";

function coerceChain(v: unknown): ChainId {
  return coerceChainId(v);
}

export interface DeployedEntry {
  mint: string;
  addedAt: string;
  chainId: ChainId;
  snapshot: TokenEvent;
}

type DeployMap = Record<string, DeployedEntry>;

function isTokenEvent(v: unknown): v is TokenEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.mint_address === "string" && e.mint_address.length > 0;
}

function readStorage(): DeployMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DEPLOYED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DeployMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!k || typeof v !== "object" || !v) continue;
      const e = v as Record<string, unknown>;
      if (!isTokenEvent(e.snapshot)) continue;
      out[k] = {
        mint: typeof e.mint === "string" ? e.mint : (e.snapshot as TokenEvent).mint_address,
        addedAt: typeof e.addedAt === "string" ? e.addedAt : new Date(0).toISOString(),
        chainId: coerceChain(e.chainId),
        snapshot: e.snapshot as TokenEvent,
      };
    }
    return out;
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();
function writeStorage(map: DeployMap) {
  try { window.localStorage.setItem(DEPLOYED_STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

/** Record a freshly-launched token. Safe to call with a partial snapshot. */
export function recordDeployedToken(snapshot: TokenEvent, chainId?: ChainId) {
  if (typeof window === "undefined") return;
  if (!isTokenEvent(snapshot)) return;
  const map = readStorage();
  const mint = snapshot.mint_address;
  if (map[mint]) return; // keep original launch timestamp
  map[mint] = {
    mint,
    addedAt: new Date().toISOString(),
    chainId: chainId ?? getActiveChain(),
    snapshot,
  };
  writeStorage(map);
}

export function useDeployedTokens(): DeployedEntry[] {
  const [map, setMap] = useState<DeployMap>({});
  const [chain, setChain] = useState<ChainId>("sol");
  useEffect(() => {
    setMap(readStorage());
    setChain(getActiveChain());
    const onStorage = (e: StorageEvent) => { if (e.key === DEPLOYED_STORAGE_KEY) setMap(readStorage()); };
    const onLocal = () => setMap(readStorage());
    const onChain = () => setChain(getActiveChain());
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHAIN_CHANGED_EVENT, onChain);
    listeners.add(onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHAIN_CHANGED_EVENT, onChain);
      listeners.delete(onLocal);
    };
  }, []);
  return useMemo(
    () => Object.values(map).filter((e) => e.chainId === chain).sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)),
    [map, chain],
  );
}
