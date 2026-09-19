"use client";
import { useCallback, useState } from "react";
import { BackendClient, useSession } from "../api/backend";
import { useApp } from "../contexts/AppContext";
import { useRegion } from "../contexts/RegionContext";
import { useUserWallets } from "./useUserWallets";
import { useUserPreference } from "./useUserPreference";
import { useBuyQuoteMint } from "./useBuyQuoteMint";
import { PREF_KEYS } from "../components/TradingPanel/presets";
import { shortAddr } from "../lib/format";
import { notifyDemoChanged } from "../lib/demoEvents";

const MIN_TRANSACTIONS_FEE_LAMPORTS = 100_000;

function clampSlippageBps(v: number) {
  return Math.min(10_000, Math.max(0, Math.round(v)));
}

export function useQuickBuy(mint: string) {
  const { authed, pushToast } = useApp();
  const { region } = useRegion();
  const session = useSession();
  const userWallets = useUserWallets();
  const [quote] = useBuyQuoteMint();
  const [slipBps] = useUserPreference<number>(PREF_KEYS.slippageBps, 100);
  const [transactionsFeeLamports] = useUserPreference<number>(PREF_KEYS.transactionsFee, MIN_TRANSACTIONS_FEE_LAMPORTS);
  const [busy, setBusy] = useState(false);

  // `amount` is interpreted in the selected quote asset's units (SOL, USDC,
  // USD1, …) — matching the trading panel's buy field — not always SOL.
  const run = useCallback(async (amount: number, walletId?: string) => {
    if (busy) return;
    if (!Number.isFinite(amount) || amount <= 0) {
      pushToast({ title: "ENTER AMOUNT", body: "Amount must be greater than 0" });
      return;
    }
    if (!authed || !session) {
      pushToast({ title: "SESSION EXPIRED", body: "Reload to sign in again.", tone: "sell" });
      return;
    }

    const platforms = walletId
      ? userWallets.wallets.filter((w) => w.id === walletId && !w.isConnected)
      : userWallets.wallets.filter((w) => userWallets.activeIds.has(w.id) && !w.isConnected);
    if (platforms.length === 0) {
      pushToast({ title: "NO WALLET", body: "Pick a wallet to trade with.", tone: "sell" });
      return;
    }

    const client = new BackendClient(region.baseUrl, session.token);
    // Non-SOL quote: convert the UI amount to raw token units and route through
    // inputMint/inputAmountRaw instead of solAmount (same wire shape the
    // trading panel uses for a quote-token buy).
    const useTokenInput = quote.mint !== null;
    const commonBase = {
      side: "buy" as const,
      mint,
      slippageBps: clampSlippageBps(slipBps),
      transactionsFeeLamports,
      ...(useTokenInput
        ? {
            inputMint: quote.mint!,
            inputAmountRaw: Math.max(1, Math.floor(amount * 10 ** quote.decimals)),
          }
        : { solAmount: amount }),
    };

    setBusy(true);
    try {
      const results = await Promise.allSettled(
        platforms.map((w) => client.execute({ ...commonBase, walletId: w.id }).then((r) => ({ w, r }))),
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
          title: "BUY SENT",
          body: ok.length === 1
            ? `${shortAddr(ok[0].r.signature, 6)} · via ${region.flag}`
            : `${ok.length}/${platforms.length} wallets · ${region.flag}`,
          tone: "buy",
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
      notifyDemoChanged();
    } catch (err) {
      pushToast({
        title: "TRADE FAILED",
        body: err instanceof Error ? err.message : String(err),
        tone: "sell",
      });
    } finally {
      setBusy(false);
    }
  }, [authed, busy, mint, pushToast, quote, region.baseUrl, region.flag, session, slipBps, transactionsFeeLamports, userWallets]);

  return { run, busy };
}
