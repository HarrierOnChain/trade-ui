"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchQuote, mintDecimals } from "./client";
import { classifyQuoteError, toQuoteView, type QuoteView } from "./quote";

export type QuoteStatus = "connecting" | "live" | "idle" | "error";

export interface SwapQuoteState {
  status: QuoteStatus;
  quote: QuoteView | null;
  noRoute: boolean;
  /** why there is no route ("Only dust pools"), when the router says */
  noRouteText: string | null;
  /** quotes applied for the current parameters */
  seq: number;
  /** slot of the pool state the last quote was priced on */
  slot: number;
  /** ms timestamp of the last applied quote */
  updatedAt: number;
  error: string | null;
}

export interface SwapQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: bigint | null;
  swapMode?: "ExactIn" | "ExactOut";
  slippageBps: number;
  excludeDexes?: string[];
  /** stop refreshing (hidden tab, panel not in use) */
  paused?: boolean;
  /** refresh period, ms */
  pollMs?: number;
}

/** The router has no push stream for quotes, so REST is the transport: a fresh
 *  quote every `pollMs` while the page is visible, never two in flight, and the
 *  first one at once on any parameter change. */
export const QUOTE_POLL_MS = 800;

const IDLE: SwapQuoteState = {
  status: "idle",
  quote: null,
  noRoute: false,
  noRouteText: null,
  seq: 0,
  slot: 0,
  updatedAt: 0,
  error: null,
};

export function useSwapQuote(params: SwapQuoteParams): SwapQuoteState {
  const [state, setState] = useState<SwapQuoteState>(IDLE);
  const prevPairRef = useRef<string | null>(null);
  const pollMs = params.pollMs ?? QUOTE_POLL_MS;
  const excludeKey = (params.excludeDexes ?? []).join(",");
  const key = `${params.inputMint}|${params.outputMint}|${params.amount ?? ""}|${params.swapMode ?? "ExactIn"}|${params.slippageBps}|${excludeKey}|${pollMs}`;

  useEffect(() => {
    // A pair change invalidates the displayed quote outright: the old amounts
    // would be read in the NEW tokens' decimals. Amount/slippage/venue edits
    // keep the old number until the new one lands.
    const pairKey = `${params.inputMint}|${params.outputMint}|${params.swapMode ?? "ExactIn"}`;
    const pairChanged = prevPairRef.current !== null && prevPairRef.current !== pairKey;
    prevPairRef.current = pairKey;

    if (!params.amount || params.amount <= 0n || params.inputMint === params.outputMint || !params.inputMint || !params.outputMint) {
      setState({ ...IDLE, error: params.inputMint && params.inputMint === params.outputMint ? "same token on both sides" : null });
      return;
    }
    setState((s) =>
      pairChanged
        ? { ...IDLE, status: "connecting" }
        : { ...s, status: s.quote ? s.status : "connecting", seq: 0, noRoute: false, noRouteText: null },
    );
    if (params.paused) return;

    const req = {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      swapMode: params.swapMode,
      slippageBps: params.slippageBps,
      excludeDexes: params.excludeDexes,
    };
    let cancelled = false;
    let inFlight: AbortController | null = null;

    const pollOnce = async () => {
      if (cancelled || inFlight) return;
      const ctl = new AbortController();
      inFlight = ctl;
      const timeout = setTimeout(() => ctl.abort(), 10_000);
      try {
        const r = await fetchQuote(req, ctl.signal);
        if (cancelled) return;
        if (r.ok) {
          const view = toQuoteView(r.quote);
          setState((s) => ({
            status: "live",
            quote: view,
            noRoute: false,
            noRouteText: null,
            seq: s.seq + 1,
            slot: Math.max(s.slot, view.slot),
            updatedAt: Date.now(),
            error: null,
          }));
          return;
        }
        const f = classifyQuoteError(r.status, r.body);
        if (f.kind === "transient") {
          // The transport or the router's state failed, not the pair: keep the
          // last quote on screen instead of flashing a false "No route".
          setState((s) => ({ ...s, status: "error", error: f.message }));
        } else {
          setState((s) => ({
            ...s,
            status: "live",
            quote: null,
            noRoute: f.kind === "noroute",
            noRouteText: f.kind === "noroute" ? f.message : null,
            updatedAt: Date.now(),
            error: f.kind === "bad" ? f.message : null,
          }));
        }
      } catch (e) {
        if (!cancelled) {
          const aborted = (e as Error)?.name === "AbortError";
          setState((s) => ({ ...s, status: "error", error: aborted ? "Router timed out, retrying…" : "Router unreachable, retrying…" }));
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
    // `key` covers every request field; `paused` stops and resumes the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, params.paused]);

  return state;
}

/** A mint's decimals (null while unknown or for an empty mint). */
export function useMintDecimals(mint: string | null | undefined): number | null {
  const [d, setD] = useState<{ mint: string; decimals: number } | null>(null);
  useEffect(() => {
    if (!mint) return;
    let cancelled = false;
    mintDecimals(mint)
      .then((decimals) => { if (!cancelled) setD({ mint, decimals }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mint]);
  return mint && d?.mint === mint ? d.decimals : null;
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

export function useDocumentHidden(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.hidden, () => false);
}
