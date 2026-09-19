"use client";
import { useEffect, useRef, useState } from "react";
import { RazeWebSocket } from "../api/websocket";
import { toArray } from "../api/normalize";
import { getPreviewData, isPreviewMint, subscribePreview } from "../lib/previewData";
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
  /** SOL volume accumulated from WS trades since subscribe. */
  volumeSol: number;
  /** SOL fees accumulated from WS trades since subscribe. */
  feesSol: number;
  /** Count of WS trades seen since subscribe. */
  tradeCount: number;
  /** Distinct signer addresses seen since subscribe. */
  uniqueTraders: number;
  /** Bundle % delta accumulated from WS trade + analysis events (clamped downstream). */
  bundleAdd: number;
  /** Sniper % delta accumulated from WS trade + analysis events. */
  sniperAdd: number;
}

const BUFFER_SIZE = 60;
const FLUSH_MS = 120;

const TOKEN_SUPPLY = 1_000_000_000; // 1B, pump.fun / standard Solana meme supply

const emptyMetrics = (): Pick<
  LivePrice,
  "volumeSol" | "feesSol" | "tradeCount" | "uniqueTraders" | "bundleAdd" | "sniperAdd"
> => ({
  volumeSol: 0,
  feesSol: 0,
  tradeCount: 0,
  uniqueTraders: 0,
  bundleAdd: 0,
  sniperAdd: 0,
});

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
      ...emptyMetrics(),
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
  volumeSolAdd: number;
  feesSolAdd: number;
  tradeCountAdd: number;
  newSigners: string[];
  bundleAddDelta: number;
  sniperAddDelta: number;
}

/** Returns the signed delta (% of supply) contributed by a single event. */
function analysisDelta(
  isFlagged: boolean,
  tokenAmount: number,
  type: string | undefined,
): number {
  if (!isFlagged || !isFinite(tokenAmount) || tokenAmount <= 0) return 0;
  const sign = String(type ?? "").toUpperCase() === "SELL" ? -1 : 1;
  return (sign * (tokenAmount / TOKEN_SUPPLY)) * 100;
}

/** Extract tokenAmount from a WS payload; supports `number` or `{uiAmount: number}`. */
function extractTokenAmount(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "uiAmount" in v) {
    const ui = (v as { uiAmount?: unknown }).uiAmount;
    if (typeof ui === "number") return ui;
  }
  return 0;
}

/**
 * Subscribe to the Raze WS trade stream for a dynamic set of mints.
 * Returns a Map<mint, LivePrice> that includes running aggregates updated on
 * every trade — volume, fees, trade count, unique traders — in addition to
 * the price + rolling sparkline buffer.
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
  // Per-mint Set of signers we've already counted — lets us dedupe across trades
  // without blowing up state with a Set each update.
  const tradersRef = useRef<Map<string, Set<string>>>(new Map());
  const initialPricesRef = useRef(initialPrices);
  initialPricesRef.current = initialPrices;

  // Preview-mode short-circuit: any mint registered in the preview registry
  // gets its livePrice injected statically into the returned map; the live
  // WS path below skips them (their on-chain tokenMint doesn't exist).
  useEffect(() => {
    if (mints.length === 0) return;
    const previewMints = mints.filter((m) => m && isPreviewMint(m));
    if (previewMints.length === 0) return;

    const sync = () => {
      setMap((prev) => {
        let next = prev;
        let mutated = false;
        for (const m of previewMints) {
          const snap = getPreviewData(m);
          if (!snap || !snap.livePrice) continue;
          if (next.get(m) === snap.livePrice) continue;
          if (!mutated) {
            next = new Map(prev);
            mutated = true;
          }
          next.set(m, snap.livePrice);
        }
        return mutated ? next : prev;
      });
    };
    sync();
    const unsubs = previewMints.map((m) => subscribePreview(m, sync));
    return () => {
      for (const u of unsubs) u();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ws = RazeWebSocket.getInstance();
    ws.connect();

    const unsub = ws.on("trade", (msg) => {
      const raw = msg as Record<string, unknown>;
      const inner = (
        typeof raw.transaction === "object" && raw.transaction !== null
          ? (raw.transaction as Record<string, unknown>)
          : typeof raw.data === "object" && raw.data !== null
          ? (raw.data as Record<string, unknown>)
          : raw
      ) as Record<string, unknown>;

      const mint = String(
        inner.tokenMint ?? inner.token_mint ?? inner.mint ?? raw.tokenMint ?? ""
      );
      if (!mint) return;
      if (!wantedRef.current.has(mint)) return;

      const price = toNum(inner.avgPrice ?? inner.avg_price);
      if (!isFinite(price) || price <= 0) return;

      // Per-trade deltas for the running aggregates
      const solAmount = Math.max(0, toNum(inner.solAmount ?? inner.sol_amount));
      const fee = Math.max(0, toNum(inner.fee ?? inner.feeSol ?? inner.fee_sol));
      const signer = String(inner.signer ?? inner.wallet ?? "");

      // Bundle/sniper delta: trade events can flag themselves as bundle / sniper
      // transactions. Buys push the % up, sells push it down. Same formula as
      // solana-frame: sign × (tokenAmount / supply) × 100.
      const isBundle = Boolean(inner.isBundle ?? inner.is_bundle);
      const isSniper = Boolean(inner.isSniper ?? inner.is_sniper);
      const tokenAmount = extractTokenAmount(
        inner.tokenAmount ?? inner.token_amount ?? inner.tokensAmount
      );
      const tradeType = String(inner.type ?? inner.transactionType ?? "BUY");
      const bundleAddDelta = analysisDelta(isBundle, tokenAmount, tradeType);
      const sniperAddDelta = analysisDelta(isSniper, tokenAmount, tradeType);

      // Track new unique signer
      let newSigner: string | null = null;
      if (signer) {
        let set = tradersRef.current.get(mint);
        if (!set) {
          set = new Set();
          tradersRef.current.set(mint, set);
        }
        if (!set.has(signer)) {
          set.add(signer);
          newSigner = signer;
        }
      }

      const existing = pendingRef.current.get(mint);
      pendingRef.current.set(mint, {
        price,
        ts: Date.now(),
        volumeSolAdd: (existing?.volumeSolAdd ?? 0) + (isFinite(solAmount) ? solAmount : 0),
        feesSolAdd: (existing?.feesSolAdd ?? 0) + (isFinite(fee) ? fee : 0),
        tradeCountAdd: (existing?.tradeCountAdd ?? 0) + 1,
        newSigners: newSigner
          ? [...(existing?.newSigners ?? []), newSigner]
          : existing?.newSigners ?? [],
        bundleAddDelta: (existing?.bundleAddDelta ?? 0) + bundleAddDelta,
        sniperAddDelta: (existing?.sniperAddDelta ?? 0) + sniperAddDelta,
      });

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

            next.set(m, {
              price: p.price,
              prices: newBuf,
              ts: p.ts,
              flash,
              volumeSol: (cur?.volumeSol ?? 0) + p.volumeSolAdd,
              feesSol: (cur?.feesSol ?? 0) + p.feesSolAdd,
              tradeCount: (cur?.tradeCount ?? 0) + p.tradeCountAdd,
              uniqueTraders: (cur?.uniqueTraders ?? 0) + p.newSigners.length,
              bundleAdd: (cur?.bundleAdd ?? 0) + p.bundleAddDelta,
              sniperAdd: (cur?.sniperAdd ?? 0) + p.sniperAddDelta,
            });
          });
          pendingRef.current.clear();
          return next;
        });
      }, FLUSH_MS);
    });

    // Parallel subscriber for the dedicated "analysis" event — same bundle/sniper
    // semantics as trades but arrives separately on the Raze WS.
    const unsubAnalysis = ws.on("analysis", (msg) => {
      const raw = msg as Record<string, unknown>;
      const data = (
        typeof raw.data === "object" && raw.data !== null
          ? (raw.data as Record<string, unknown>)
          : raw
      ) as Record<string, unknown>;

      const mint = String(data.mint ?? data.tokenMint ?? raw.tokenMint ?? "");
      if (!mint) return;
      if (!wantedRef.current.has(mint)) return;

      const isBundle = Boolean(data.isBundle ?? data.is_bundle);
      const isSniper = Boolean(data.isSniper ?? data.is_sniper);
      if (!isBundle && !isSniper) return;

      const tokenAmount = extractTokenAmount(data.tokenAmount ?? data.token_amount);
      const type = String(data.type ?? "BUY");
      const bundleAddDelta = analysisDelta(isBundle, tokenAmount, type);
      const sniperAddDelta = analysisDelta(isSniper, tokenAmount, type);
      if (bundleAddDelta === 0 && sniperAddDelta === 0) return;

      const existing = pendingRef.current.get(mint);
      pendingRef.current.set(mint, {
        // Analysis events don't carry price/sol info — preserve existing pending values.
        price: existing?.price ?? 0,
        ts: existing?.ts ?? Date.now(),
        volumeSolAdd: existing?.volumeSolAdd ?? 0,
        feesSolAdd: existing?.feesSolAdd ?? 0,
        tradeCountAdd: existing?.tradeCountAdd ?? 0,
        newSigners: existing?.newSigners ?? [],
        bundleAddDelta: (existing?.bundleAddDelta ?? 0) + bundleAddDelta,
        sniperAddDelta: (existing?.sniperAddDelta ?? 0) + sniperAddDelta,
      });

      if (flushRef.current !== null) return;
      flushRef.current = setTimeout(() => {
        flushRef.current = null;
        if (pendingRef.current.size === 0) return;
        setMap((prev) => {
          const next = new Map(prev);
          pendingRef.current.forEach((p, m) => {
            const cur = next.get(m);
            if (!cur && p.price <= 0) {
              // No existing entry and this is an analysis-only event — stash deltas
              // under an empty LivePrice so they aren't lost before the first trade.
              next.set(m, {
                ...emptyMetrics(),
                price: 0,
                prices: [],
                ts: p.ts,
                bundleAdd: p.bundleAddDelta,
                sniperAdd: p.sniperAddDelta,
              });
              return;
            }
            // Same raw-buffer + despiked-view treatment as the trade flush.
            let newBuf = cur?.prices ?? [];
            if (p.price > 0) {
              const raw = [...(rawBufRef.current.get(m) ?? cur?.prices ?? []), p.price]
                .slice(-BUFFER_SIZE);
              rawBufRef.current.set(m, raw);
              newBuf = despikeSeries(raw);
            }
            next.set(m, {
              price: p.price > 0 ? p.price : cur?.price ?? 0,
              prices: newBuf,
              ts: p.ts,
              flash: cur?.flash,
              volumeSol: (cur?.volumeSol ?? 0) + p.volumeSolAdd,
              feesSol: (cur?.feesSol ?? 0) + p.feesSolAdd,
              tradeCount: (cur?.tradeCount ?? 0) + p.tradeCountAdd,
              uniqueTraders: (cur?.uniqueTraders ?? 0) + p.newSigners.length,
              bundleAdd: (cur?.bundleAdd ?? 0) + p.bundleAddDelta,
              sniperAdd: (cur?.sniperAdd ?? 0) + p.sniperAddDelta,
            });
          });
          pendingRef.current.clear();
          return next;
        });
      }, FLUSH_MS);
    });

    return () => {
      unsub();
      unsubAnalysis();
      if (flushRef.current != null) {
        clearTimeout(flushRef.current);
        flushRef.current = null;
      }
    };
  }, []);

  const seededRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ws = RazeWebSocket.getInstance();
    // Preview mints are served from the registry above; exclude them from
    // the WS / OHLC seed path so we don't subscribe to a tokenMint that
    // doesn't exist on-chain.
    const wanted = new Set(mints.filter((m) => m && !isPreviewMint(m)));
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
        tradersRef.current.delete(m);
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
      tradersRef.current.clear();
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
