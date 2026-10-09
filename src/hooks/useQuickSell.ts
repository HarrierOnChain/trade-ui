"use client";
import { useCallback, useState } from "react";
import { executeLocalTrade } from "../api/localTrade";
import { useApp } from "../contexts/AppContext";
import { useUserWallets } from "./useUserWallets";
import { useUserPreference } from "./useUserPreference";
import { PREF_KEYS } from "../components/TradingPanel/presets";
import { shortAddr } from "../lib/format";

const MIN_TRANSACTIONS_FEE_LAMPORTS = 100_000;

function clampSlippageBps(v: number) {
  return Math.min(10_000, Math.max(0, Math.round(v)));
}

export function useQuickSell(mint: string) {
  const { pushToast } = useApp();
  const userWallets = useUserWallets();
  const [slipBps] = useUserPreference<number>(PREF_KEYS.slippageBps, 100);
  const [transactionsFeeLamports] = useUserPreference<number>(PREF_KEYS.transactionsFee, MIN_TRANSACTIONS_FEE_LAMPORTS);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (percentage: number, walletId?: string) => {
    if (busy) return;
    if (!Number.isFinite(percentage) || percentage <= 0) {
      pushToast({ title: "ENTER AMOUNT", body: "Percentage must be greater than 0", tone: "sell" });
      return;
    }
    // The wallet asked for, else the ones selected in the top bar: the same
    // rule as the trading panel. Watch-only wallets never trade.
    const platforms = walletId
      ? userWallets.wallets.filter((w) => w.id === walletId && !w.watchOnly)
      : userWallets.activeWallets;
    if (platforms.length === 0) {
      pushToast({ title: "NO WALLET", body: "Pick the wallets that trade in the top bar, or add one in Wallets.", tone: "sell" });
      return;
    }

    const commonBase = {
      side: "sell" as const,
      mint,
      slippageBps: clampSlippageBps(slipBps),
      transactionsFeeLamports,
      percentage,
    };

    setBusy(true);
    try {
      const results = await Promise.allSettled(
        platforms.map((w) => executeLocalTrade({ ...commonBase, walletId: w.id }).then((r) => ({ w, r }))),
      );
      const ok: { w: typeof platforms[number]; r: { signature: string } }[] = [];
      const fail: { w: typeof platforms[number]; err: unknown }[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") ok.push(r.value);
        else fail.push({ w: platforms[i], err: r.reason });
      }
      if (ok.length > 0) {
        pushToast({
          title: "SELL CONFIRMED",
          body: ok.length === 1
            ? `tx ${shortAddr(ok[0].r.signature, 6)}`
            : `${ok.length}/${platforms.length} wallets`,
          tone: "sell",
        });
      }
      for (const f of fail) {
        pushToast({
          title: "WALLET FAILED",
          body: `${f.w.displayLabel}: ${f.err instanceof Error ? f.err.message : String(f.err)}`,
          tone: "sell",
        });
      }
      if (ok.length === 0) throw new Error("All wallets failed");
      void userWallets.refreshBalances();
    } catch (err) {
      pushToast({
        title: "TRADE FAILED",
        body: err instanceof Error ? err.message : String(err),
        tone: "sell",
      });
    } finally {
      setBusy(false);
    }
  }, [busy, mint, pushToast, slipBps, transactionsFeeLamports, userWallets]);

  return { run, busy };
}
