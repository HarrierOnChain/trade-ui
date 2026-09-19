"use client";
import { useEffect, useState } from "react";
import { fetchSolPrice } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { CHAIN_CHANGED_EVENT } from "../lib/chains";
import { REGION_CHANGED_EVENT } from "../lib/regions";

/** Spot SOL/USD — single module-level feed shared by all hook instances. */

let cachedPrice: number | null = null;
let feedStarted = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(price: number | null) => void>();

/** Display-stable cents; avoids float noise from WS JSON. */
function normalizeSpotUsd(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 100) / 100;
}

function parsePriceInfo(msg: Record<string, unknown>): number | null {
  const info = msg.priceInfo;
  if (!info || typeof info !== "object") return null;
  const raw = (info as Record<string, unknown>).solPrice;
  const n = typeof raw === "number" ? raw : Number(raw);
  return normalizeSpotUsd(n);
}

function emitPrice(raw: number) {
  const price = normalizeSpotUsd(raw);
  if (price == null) return;
  // Ignore sub-cent churn (trade spam, float drift, REST vs WS tiny gaps).
  if (cachedPrice != null && Math.abs(price - cachedPrice) < 0.01) return;
  cachedPrice = price;
  listeners.forEach((listener) => listener(cachedPrice));
}

function refreshFromRest() {
  fetchSolPrice()
    .then((res) => emitPrice(Number(res.solPrice)))
    .catch(() => {});
}

function startSolPriceFeed() {
  if (feedStarted) return;
  feedStarted = true;

  refreshFromRest();
  pollTimer = setInterval(refreshFromRest, 60_000);

  const ws = RazeWebSocket.getInstance();
  ws.connect();
  // Low-frequency globals only — do NOT tie spot SOL to per-mint trade streams
  // (fires many times/sec on token pages and caused visible flicker).
  ws.subscribe(["deploy", "migration"]);

  const extract = (msg: Record<string, unknown>) => {
    const p = parsePriceInfo(msg);
    if (p != null) emitPrice(p);
  };

  ws.on("deploy", extract);
  ws.on("migration", extract);

  if (typeof window !== "undefined") {
    const onContextChange = () => refreshFromRest();
    window.addEventListener(REGION_CHANGED_EVENT, onContextChange);
    window.addEventListener(CHAIN_CHANGED_EVENT, onContextChange);
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
