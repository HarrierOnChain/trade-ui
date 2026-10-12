"use client";
import { useEffect, useRef, useState } from "react";
import { RazeWebSocket } from "../api/websocket";
import { despikeSeries } from "../lib/candleDespike";

export interface LivePrice {
  /** Latest avg price in SOL per token. */
  price: number;
  /** Rolling window of recent prices (oldest → newest) for sparkline. */
  prices: number[];
  /** Epoch ms of last update. */
  ts: number;
  /** Direction of last change vs previous update; drives flash highlight. */
  flash?: "up" | "down";
}

const BUFFER_SIZE = 60;
const FLUSH_MS = 120;

function applySeed(
  mint: string,
  prices: number[],
  setMap: React.Dispatch<React.SetStateAction<Map<string, LivePrice>>>,
  isCurrent: () => boolean = () => true,
) {
  setMap((prev) => {
    if (!isCurrent()) return prev;
    const existing = prev.get(mint);
    if (existing && existing.prices.length >= prices.length) return prev;
    const next = new Map(prev);
    next.set(mint, {
      ...(existing ?? {}),
      price: prices[prices.length - 1],
      prices,
      ts: Date.now(),
      flash: existing?.flash,
    });
    return next;
  });
}

interface Pending {
  price: number;
  ts: number;
}

/**
 * Subscribe to the Raze WS trade stream for a dynamic set of mints.
 * Returns a Map<mint, LivePrice>: the last traded price, its flash and a
 * rolling sparkline buffer. Volume, trades, holders and the bundler and
 * sniper shares are the API's (board updates, token snapshots), never
 * counted here from the trades a client happened to see.
 *
 * @param initialPrices Optional map of mint → SOL price from the REST token
 *   list. Applied instantly as a single-point seed so tables show a price on
 *   first render without waiting for OHLC or WS. The OHLC seed overwrites it
 *   once it resolves (OHLC has ≥2 prices; this seed has exactly 1).
 */
export function useLiveTradePrices(
  mints: string[],
  initialPrices?: Record<string, number>,
): Map<string, LivePrice> {
  const [map, setMap] = useState<Map<string, LivePrice>>(() => new Map());

  const key = mints.length === 0
    ? ""
    : Array.from(new Set(mints.filter(Boolean))).sort().join(",");
  const subsRef = useRef<Set<string>>(new Set());
  const wantedRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Map<string, Pending>>(new Map());
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // RAW rolling buffer per mint. `LivePrice.prices` publishes the DESPIKED view
  // of it (see the flush below); the raw series is kept here so a point can be
  // re-judged when its successor arrives instead of being destroyed on sight.
  const rawBufRef = useRef<Map<string, number[]>>(new Map());
  const initialPricesRef = useRef(initialPrices);
  initialPricesRef.current = initialPrices;

  useEffect(() => {
    const ws = RazeWebSocket.getInstance();
    ws.connect();

    // websocket.ts dispatches the mapped Trade (avgPrice: native per token).
    const unsub = ws.on("trade", (msg) => {
      const mint = String(msg.tokenMint ?? "");
      if (!mint || !wantedRef.current.has(mint)) return;
      const price = toNum(msg.avgPrice);
      if (!isFinite(price) || price <= 0) return;
      pendingRef.current.set(mint, { price, ts: Date.now() });

      if (flushRef.current !== null) return;
      flushRef.current = setTimeout(() => {
        flushRef.current = null;
        if (pendingRef.current.size === 0) return;

        setMap((prev) => {
          const next = new Map(prev);
          pendingRef.current.forEach((p, m) => {
            const cur = next.get(m);
            // Append to the RAW buffer, publish the despiked view of it. Same
            // corroboration rule as the chart (lib/candleDespike) — otherwise a
            // single uncorroborated print stays in this 60-slot buffer for the
            // next 60 ticks, and because a sparkline rescales its y-range from
            // the buffer's min/max the row's whole price history collapses to a
            // flat line with one needle. `price` itself stays LIVE: it is the
            // last traded price, exactly like the chart's close, and it comes
            // back on its own with the next print.
            const raw = [...(rawBufRef.current.get(m) ?? cur?.prices ?? []), p.price]
              .slice(-BUFFER_SIZE);
            rawBufRef.current.set(m, raw);
            const newBuf = despikeSeries(raw);
            const prevPrice = cur?.price;
            const flash =
              prevPrice == null
                ? undefined
                : p.price > prevPrice
                ? "up"
                : p.price < prevPrice
                ? "down"
                : cur?.flash;

            next.set(m, { price: p.price, prices: newBuf, ts: p.ts, flash });
          });
          pendingRef.current.clear();
          return next;
        });
      }, FLUSH_MS);
    });

    // The trades channel's snapshot (recent trades, newest first) seeds the
    // sparkline and the price before the first live print.
    const unsubSnapshot = ws.on("trade_snapshot", (msg) => {
      const mint = String(msg.tokenMint ?? "");
      if (!mint || !wantedRef.current.has(mint) || !Array.isArray(msg.trades)) return;
      const prices = (msg.trades as Array<{ avgPrice?: number }>)
        .map((t) => toNum(t.avgPrice))
        .filter((p) => isFinite(p) && p > 0)
        .reverse()
        .slice(-BUFFER_SIZE);
      if (!prices.length) return;
      setMap((prev) => {
        if (!wantedRef.current.has(mint)) return prev;
        const cur = prev.get(mint);
        if (cur && cur.prices.length >= prices.length) return prev;
        rawBufRef.current.set(mint, prices);
        const next = new Map(prev);
        next.set(mint, {
          ...(cur ?? {}),
          price: prices[prices.length - 1]!,
          prices: despikeSeries(prices),
          ts: Date.now(),
          flash: cur?.flash,
        });
        return next;
      });
    });

    return () => {
      unsub();
      unsubSnapshot();
      if (flushRef.current != null) {
        clearTimeout(flushRef.current);
        flushRef.current = null;
      }
    };
  }, []);

  const seededRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ws = RazeWebSocket.getInstance();
    const wanted = new Set(mints.filter((m) => m));
    wantedRef.current = wanted;

    wanted.forEach((m) => {
      if (!subsRef.current.has(m)) {
        ws.subscribeToken(m);
        subsRef.current.add(m);
      }
      if (!seededRef.current.has(m)) {
        seededRef.current.add(m);
        const ip = initialPricesRef.current?.[m];
        if (ip != null && isFinite(ip) && ip > 0) {
          applySeed(m, [ip], setMap, () => wantedRef.current.has(m));
        }
      }
    });
    pendingRef.current.forEach((_pending, mint) => {
      if (!wanted.has(mint)) pendingRef.current.delete(mint);
    });
    subsRef.current.forEach((m) => {
      if (!wanted.has(m)) {
        ws.unsubscribeToken(m);
        subsRef.current.delete(m);
        seededRef.current.delete(m);
        rawBufRef.current.delete(m);
      }
    });
    setMap((prev) => {
      let dirty = false;
      const next = new Map<string, LivePrice>();
      prev.forEach((value, mint) => {
        if (wanted.has(mint)) next.set(mint, value);
        else dirty = true;
      });
      return dirty ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    return () => {
      const ws = RazeWebSocket.getInstance();
      subsRef.current.forEach((m) => ws.unsubscribeToken(m));
      subsRef.current.clear();
      seededRef.current.clear();
      wantedRef.current.clear();
      pendingRef.current.clear();
      rawBufRef.current.clear();
    };
  }, []);

  return map;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  return 0;
}
