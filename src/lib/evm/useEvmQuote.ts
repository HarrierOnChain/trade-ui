"use client";
import { useEffect, useState } from "react";
import { ApiError, evmRoutes, type EvmQuote } from "../vault/client";
import { evmDecimals } from "./trade";
import type { ChainId } from "../chains";
import type { EvmToken } from "./plan";

export interface EvmQuoteState {
  status: "idle" | "connecting" | "live" | "error";
  quote: EvmQuote | null;
  /** the router found no route for the pair */
  noRoute: boolean;
  error: string | null;
  /** ms timestamp of the last quote applied */
  updatedAt: number;
}

const IDLE: EvmQuoteState = { status: "idle", quote: null, noRoute: false, error: null, updatedAt: 0 };

/** The router has no push stream for quotes, so REST is the transport, as on
 *  Solana (useSwapQuote): a fresh quote every `pollMs` while the panel is in
 *  use, never two in flight, the first one at once on any change. */
export function useEvmQuote(params: {
  chain: ChainId;
  tokenIn: EvmToken | null;
  tokenOut: EvmToken | null;
  amountIn: bigint | null;
  slippageBps: number;
  paused?: boolean;
  pollMs?: number;
}): EvmQuoteState {
  const [state, setState] = useState<EvmQuoteState>(IDLE);
  const { chain, tokenIn, tokenOut, amountIn, slippageBps, paused } = params;
  const pollMs = params.pollMs ?? 2_000;

  useEffect(() => {
    if (!tokenIn || !tokenOut || !amountIn || amountIn <= 0n) {
      setState(IDLE);
      return;
    }
    setState((s) => ({ ...s, status: s.quote ? s.status : "connecting", noRoute: false }));
    if (paused) return;
    let cancelled = false;
    let inFlight: AbortController | null = null;
    const pollOnce = async () => {
      if (cancelled || inFlight) return;
      const ctl = new AbortController();
      inFlight = ctl;
      const timeout = setTimeout(() => ctl.abort(), 10_000);
      try {
        const quote = await evmRoutes.quote(
          { chain, inputMint: tokenIn, outputMint: tokenOut, amount: amountIn.toString(), slippageBps: Math.min(5000, slippageBps) },
          ctl.signal,
        );
        if (!cancelled) setState({ status: "live", quote, noRoute: false, error: null, updatedAt: Date.now() });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "no_route") {
          setState({ status: "live", quote: null, noRoute: true, error: null, updatedAt: Date.now() });
        } else {
          const aborted = (e as Error)?.name === "AbortError";
          // Keep the last quote on screen: the transport failed, not the pair.
          setState((s) => ({ ...s, status: "error", error: aborted ? "Router timed out, retrying…" : (e as Error).message }));
        }
      } finally {
        clearTimeout(timeout);
        if (inFlight === ctl) inFlight = null;
      }
    };
    void pollOnce();
    const timer = setInterval(pollOnce, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
      inFlight?.abort();
    };
  }, [chain, tokenIn, tokenOut, amountIn, slippageBps, paused, pollMs]);

  return state;
}

/** A token's decimals on an EVM chain (null until read, or for no token). */
export function useEvmDecimals(chain: ChainId, token: EvmToken | null): number | null {
  const [d, setD] = useState<{ key: string; decimals: number } | null>(null);
  const key = token ? `${chain}:${token}` : "";
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    evmDecimals(chain, token)
      .then((decimals) => { if (!cancelled) setD({ key: `${chain}:${token}`, decimals }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [chain, token]);
  return token && d?.key === key ? d.decimals : null;
}
