"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTradesBySignerMint } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { tradeKey } from "../lib/trades";
import { useTokenInfo } from "./useTokenInfo";
import { useLiveTradePrices } from "./useLiveTradePrices";
import { useUserWallets } from "./useUserWallets";

export interface TokenPnlData {
  bought: number;
  sold: number;
  holding: number; // current token holdings valued in SOL
  pnl: number;     // (sold - bought) + holding
  loading: boolean;
}

const PAGE_SIZE = 200; // the API's page cap
const MAX_PAGES = 10;

/** Per-mint PnL on the trading panel: trade history via
 * fetchTradesBySignerMint + live WS, for every wallet of the vault on this
 * chain (not scoped to the active selection). */
export function useTokenPnl(mint: string): TokenPnlData {
  const userWallets = useUserWallets();
  const { info } = useTokenInfo(mint);
  const liveMintsArg = useMemo(() => (mint ? [mint] : []), [mint]);
  const livePriceMap = useLiveTradePrices(liveMintsArg);

  const platformWallets = userWallets.wallets;
  const pubkeys = useMemo(() => platformWallets.map((w) => w.pubkey), [platformWallets]);
  const pubkeysKey = pubkeys.join(",");

  const [platformBought, setPlatformBought] = useState(0);
  const [platformSold, setPlatformSold] = useState(0);
  const [platformLoading, setPlatformLoading] = useState(false);

  // (signature, wallet): two of the user's wallets co-signing one transaction
  // are two fills, both counted.
  const seenRef = useRef(new Set<string>());

  // ── Platform: paginated history ─────────────────────────────────────
  useEffect(() => {
    if (!mint || pubkeys.length === 0) {
      setPlatformBought(0);
      setPlatformSold(0);
      setPlatformLoading(false);
      return;
    }

    let cancelled = false;
    seenRef.current = new Set();
    setPlatformLoading(true);

    let aggBought = 0;
    let aggSold = 0;

    Promise.all(
      pubkeys.map(async (pubkey) => {
        let cursor: string | null = null;
        for (let page = 0; page < MAX_PAGES; page++) {
          try {
            const res = await fetchTradesBySignerMint(pubkey, mint, PAGE_SIZE, cursor, "desc");
            for (const t of res?.data ?? []) {
              if (!t.signature) continue;
              const key = tradeKey(t);
              if (seenRef.current.has(key)) continue;
              seenRef.current.add(key);
              const sol = t.solAmount ?? 0;
              if (t.transactionType === "buy") aggBought += sol;
              else if (t.transactionType === "sell") aggSold += sol;
            }
            if (!res?.hasMore || !res?.nextCursor) break;
            cursor = res.nextCursor;
          } catch {
            break;
          }
        }
      }),
    )
      .then(() => {
        if (cancelled) return;
        setPlatformBought(aggBought);
        setPlatformSold(aggSold);
      })
      .finally(() => {
        if (!cancelled) setPlatformLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mint, pubkeysKey, pubkeys]);

  // ── Platform: live WS increments ────────────────────────────────────
  useEffect(() => {
    if (!mint || pubkeys.length === 0) return;

    // The mint's own trades channel (held by useLiveTradePrices above) already
    // carries every swap of these wallets on this token: no per-wallet feed.
    const ws = RazeWebSocket.getInstance();
    ws.connect();

    const pubkeySet = new Set(pubkeys);

    function handleMsg(msg: Record<string, unknown>) {
      const inner = (
        (msg.transaction && typeof msg.transaction === "object" ? msg.transaction : null) ??
        (msg.data && typeof msg.data === "object" ? msg.data : null) ??
        msg
      ) as Record<string, unknown>;

      const tokenMint = String(inner.tokenMint ?? inner.token_mint ?? inner.mint ?? msg.tokenMint ?? "");
      if (tokenMint !== mint) return;

      const signer = String(inner.signer ?? msg.signer ?? "");
      if (!pubkeySet.has(signer)) return;

      const sig = String(inner.signature ?? msg.signature ?? "");
      if (sig) {
        const key = tradeKey({ signature: sig, signer, timestamp: 0 });
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
      }

      const solAmount = Number(inner.solAmount ?? inner.sol_amount ?? 0);
      if (!Number.isFinite(solAmount) || solAmount <= 0) return;

      const type = String(
        inner.transactionType ?? inner.transaction_type ?? inner.type ?? "buy",
      ).toLowerCase();

      if (type === "sell") setPlatformSold((v) => v + solAmount);
      else setPlatformBought((v) => v + solAmount);
    }

    const unsub1 = ws.on("trade", handleMsg);

    return () => {
      unsub1();
    };
  }, [mint, pubkeysKey, pubkeys]);

  const livePrice = livePriceMap.get(mint)?.price ?? 0;
  const lastPrice = livePrice > 0 ? livePrice : (info?.lastPrice ?? 0);

  const platformHolding = useMemo(() => {
    const tokenBalance = platformWallets.reduce(
      (sum, w) => sum + (userWallets.balances[w.id]?.tokens[mint] ?? 0),
      0,
    );
    return tokenBalance * lastPrice;
  }, [platformWallets, userWallets.balances, mint, lastPrice]);

  const pnl = platformSold - platformBought + platformHolding;
  return { bought: platformBought, sold: platformSold, holding: platformHolding, pnl, loading: platformLoading };
}
