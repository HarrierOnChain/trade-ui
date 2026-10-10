"use client";
import { useEffect, useState } from "react";
import { fetchNativePrices, nativeUsdSync, onNativePrices } from "../api/native";
import { RazeWebSocket } from "../api/websocket";
import { CHAIN_CHANGED_EVENT } from "../lib/chains";

/**
 * Spot price of the active chain's native coin (SOL / ETH / BNB) in USD —
 * one module-level feed shared by every hook instance.
 *
 * Live: the WebSocket's `prices` channel pushes each change into the native
 * store (`api/native`), which notifies here. REST `/prices` only primes it
 * once; nothing polls.
 */

let cachedPrice: number | null = null;
let feedStarted = false;
const listeners = new Set<(price: number | null) => void>();

/** SOL / ETH / BNB together. Base and Robinhood price in ETH. */
export type NativeSpots = { sol: number | null; eth: number | null; bnb: number | null };

const EMPTY_SPOTS: NativeSpots = { sol: null, eth: null, bnb: null };
let cachedSpots: NativeSpots = EMPTY_SPOTS;
const spotListeners = new Set<(spots: NativeSpots) => void>();

/** Display-stable cents; avoids float noise from WS JSON. */
function normalizeSpotUsd(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 100) / 100;
}

function emitPrice(raw: number, force = false) {
  const price = normalizeSpotUsd(raw);
  if (price == null) return;
  // Ignore sub-cent churn.
  if (!force && cachedPrice != null && Math.abs(price - cachedPrice) < 0.01) return;
  cachedPrice = price;
  listeners.forEach((listener) => listener(cachedPrice));
}

function readSpots(): NativeSpots {
  return {
    sol: normalizeSpotUsd(nativeUsdSync("sol")),
    eth: normalizeSpotUsd(nativeUsdSync("eth")),
    bnb: normalizeSpotUsd(nativeUsdSync("bsc")),
  };
}

function sameSpots(a: NativeSpots, b: NativeSpots): boolean {
  return a.sol === b.sol && a.eth === b.eth && a.bnb === b.bnb;
}

function emitSpots() {
  const next = readSpots();
  if (sameSpots(next, cachedSpots)) return;
  cachedSpots = next;
  spotListeners.forEach((listener) => listener(cachedSpots));
}

function startSolPriceFeed() {
  if (feedStarted) return;
  feedStarted = true;

  onNativePrices(() => {
    emitPrice(nativeUsdSync());
    emitSpots();
  });
  void fetchNativePrices().then(() => {
    emitPrice(nativeUsdSync());
    emitSpots();
  }).catch(() => {});

  // Holds the `prices` channel (RazeWebSocket.connect subscribes it).
  RazeWebSocket.getInstance().connect();

  if (typeof window !== "undefined") {
    // A chain switch changes which coin this is.
    window.addEventListener(CHAIN_CHANGED_EVENT, () => emitPrice(nativeUsdSync(), true));
  }
}

export function useSolPrice() {
  const [price, setPrice] = useState<number | null>(cachedPrice);

  useEffect(() => {
    startSolPriceFeed();
    const listener = (next: number | null) => setPrice(next);
    listeners.add(listener);
    if (cachedPrice != null) setPrice(cachedPrice);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return price;
}

/** SOL, ETH and BNB in USD, from the same feed as `useSolPrice`. */
export function useNativeSpots(): NativeSpots {
  const [spots, setSpots] = useState<NativeSpots>(cachedSpots);

  useEffect(() => {
    startSolPriceFeed();
    const listener = (next: NativeSpots) => setSpots(next);
    spotListeners.add(listener);
    if (!sameSpots(cachedSpots, EMPTY_SPOTS)) setSpots(cachedSpots);
    return () => {
      spotListeners.delete(listener);
    };
  }, []);

  return spots;
}
