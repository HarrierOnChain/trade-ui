"use client";
import { useEffect, useState } from "react";
import { rpcCall } from "../lib/swap/client";
import { fallbackRent } from "../lib/launchCosts";

/** size → lamports, as the RPC answered; asked once a session per size. */
const known = new Map<number, number>();
const asking = new Map<number, Promise<void>>();

function ask(size: number): Promise<void> {
  const had = asking.get(size);
  if (had) return had;
  const p = rpcCall<number>("getMinimumBalanceForRentExemption", [size])
    .then((v) => { if (Number.isInteger(v) && v > 0) known.set(size, v); })
    .catch(() => { /* the measured rate stands in */ })
    .finally(() => asking.delete(size));
  asking.set(size, p);
  return p;
}

/**
 * The rent of each account size in `sizes`, from the RPC
 * (getMinimumBalanceForRentExemption). Until it answers, or when it cannot,
 * the rate measured on mainnet stands in; `live` says which.
 */
export function useRent(sizes: number[]): { rent: (size: number) => number; live: boolean } {
  const key = [...sizes].sort((a, b) => a - b).join(",");
  const [, setVersion] = useState(0);
  useEffect(() => {
    const missing = key ? key.split(",").map(Number).filter((n) => !known.has(n)) : [];
    if (!missing.length) return;
    let alive = true;
    void Promise.all(missing.map(ask)).then(() => { if (alive) setVersion((v) => v + 1); });
    return () => { alive = false; };
  }, [key]);
  return {
    rent: (size) => known.get(size) ?? fallbackRent(size),
    live: sizes.length > 0 && sizes.every((s) => known.has(s)),
  };
}
