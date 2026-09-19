"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTradesBySignerMint } from "../api/client";
import { RazeWebSocket } from "../api/websocket";
import { useBackend } from "../api/backend";
import { demoMintHoldingSnapshot, demoMintTradeTotals } from "../lib/demoMintStats";
import { onDemoChanged } from "../lib/demoEvents";
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

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const DEMO_REFRESH_MS = 6_000;

/** Per-mint PnL on the trading panel.
 *
 * Platform wallets: trade history via fetchTradesBySignerMint + live WS
 * (all platform wallets in the account — not scoped to the active selection,
 * matching the original b33-style total).
 *
 * Demo wallets: bought/sold/holdings from demoSummary for the selected demo
 * wallet ids only (synthetic pubkeys can't use the on-chain trades API).
 */
export function useTokenPnl(mint: string, demoWalletIds: string[] = []): TokenPnlData {
  const backend = useBackend();
  const userWallets = useUserWallets();
  const { info } = useTokenInfo(mint);
  const liveMintsArg = useMemo(() => (mint ? [mint] : []), [mint]);
  const livePriceMap = useLiveTradePrices(liveMintsArg);

  const platformWallets = useMemo(
    () => userWallets.wallets.filter((w) => !w.isConnected && w.kind !== "DEMO"),
    [userWallets.wallets],
  );
  const pubkeys = useMemo(() => platformWallets.map((w) => w.pubkey), [platformWallets]);
  const pubkeysKey = pubkeys.join(",");

  const demoWalletIdsKey = useMemo(
    () => [...demoWalletIds].sort().join(","),
    [demoWalletIds],
  );

  const [platformBought, setPlatformBought] = useState(0);
  const [platformSold, setPlatformSold] = useState(0);
  const [platformLoading, setPlatformLoading] = useState(false);

  const [demoBought, setDemoBought] = useState(0);
  const [demoSold, setDemoSold] = useState(0);
  const [demoTokensHeld, setDemoTokensHeld] = useState(0);
  const [demoEntryPriceSol, setDemoEntryPriceSol] = useState(0);
  const [demoLoading, setDemoLoading] = useState(false);

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
              if (!t.signature || seenRef.current.has(t.signature)) continue;
              seenRef.current.add(t.signature);
              if (t.transactionType === "buy") aggBought += t.solAmount;
              else if (t.transactionType === "sell") aggSold += t.solAmount;
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

    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribeSigners(pubkeys);

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
      if (sig && seenRef.current.has(sig)) return;
      if (sig) seenRef.current.add(sig);

      const solAmount = Number(inner.solAmount ?? inner.sol_amount ?? 0);
      if (!Number.isFinite(solAmount) || solAmount <= 0) return;

      const type = String(
        inner.transactionType ?? inner.transaction_type ?? inner.type ?? "buy",
      ).toLowerCase();

      if (type === "sell") setPlatformSold((v) => v + solAmount);
      else setPlatformBought((v) => v + solAmount);
    }

    const unsub1 = ws.on("trade", handleMsg);
    const unsub2 = ws.on("transaction", handleMsg);

    return () => {
      unsub1();
      unsub2();
      ws.unsubscribeSigners(pubkeys);
    };
  }, [mint, pubkeysKey, pubkeys]);

  // ── Demo: demoSummary for selected demo wallets ─────────────────────
  useEffect(() => {
    if (!mint || demoWalletIds.length === 0) {
      setDemoBought(0);
      setDemoSold(0);
      setDemoTokensHeld(0);
      setDemoEntryPriceSol(0);
      setDemoLoading(false);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      setDemoLoading(true);
      try {
        const summaries = await Promise.all(
          demoWalletIds.map((id) => backend.demoSummary(id)),
        );
        if (cancelled) return;
        let aggBought = 0;
        let aggSold = 0;
        let aggTokens = 0;
        let costSol = 0;
        for (const summary of summaries) {
          const totals = demoMintTradeTotals(summary, mint);
          aggBought += totals.bought;
          aggSold += totals.sold;
          const snap = demoMintHoldingSnapshot(summary, mint);
          aggTokens += snap.tokens;
          if (snap.tokens > 0 && snap.entryPriceSol > 0) {
            costSol += snap.tokens * snap.entryPriceSol;
          }
        }
        setDemoBought(aggBought);
        setDemoSold(aggSold);
        setDemoTokensHeld(aggTokens);
        setDemoEntryPriceSol(aggTokens > 0 ? costSol / aggTokens : 0);
      } catch {
        /* next poll / demo-changed event retries */
      } finally {
        if (!cancelled) setDemoLoading(false);
      }
    };

    void refresh();
    const offEvent = onDemoChanged(() => {
      if (!cancelled) void refresh();
    });
    const iv = setInterval(refresh, DEMO_REFRESH_MS);
    return () => {
      cancelled = true;
      offEvent();
      clearInterval(iv);
    };
  }, [mint, demoWalletIdsKey, demoWalletIds, backend]);

  const livePrice = livePriceMap.get(mint)?.price ?? 0;
  const lastPrice = livePrice > 0 ? livePrice : (info?.lastPrice ?? 0);

  const platformHolding = useMemo(() => {
    const tokenBalance = platformWallets.reduce(
      (sum, w) => sum + (userWallets.balances[w.id]?.tokens[mint] ?? 0),
      0,
    );
    return tokenBalance * lastPrice;
  }, [platformWallets, userWallets.balances, mint, lastPrice]);

  const demoHolding = useMemo(() => {
    if (demoWalletIds.length === 0) return 0;
    let tokenBalance = demoTokensHeld;
    for (const id of demoWalletIds) {
      tokenBalance = Math.max(
        tokenBalance,
        userWallets.balances[id]?.tokens[mint] ?? 0,
      );
    }
    const markPrice =
      lastPrice > 0 ? lastPrice : demoEntryPriceSol > 0 ? demoEntryPriceSol : 0;
    return tokenBalance * markPrice;
  }, [demoWalletIds, userWallets.balances, mint, lastPrice, demoTokensHeld, demoEntryPriceSol]);

  const bought = platformBought + demoBought;
  const sold = platformSold + demoSold;
  const holding = platformHolding + demoHolding;
  const pnl = sold - bought + holding;
  const loading = platformLoading || demoLoading;

  return { bought, sold, holding, pnl, loading };
}
