/**
 * The wallets of this Trade UI, as the terminal's components see them: read
 * from the vault on this Trade UI's server (src/lib/vault/client.ts), which
 * keeps the keys. A Solana wallet shows on Solana; an EVM wallet shows on
 * every EVM chain (one key, one address). Watch-only wallets carry no key:
 * they show balances and never trade.
 */
import { getActiveChain, type ChainId } from "../lib/chains";
import { evmapiGet } from "./evmapi";
import { cachedWallets, type VaultWallet, type WalletFamily } from "../lib/vault/client";

/** PLATFORM: a key in the vault, can trade. WATCH: an address only. */
export type WalletKind = "PLATFORM" | "WATCH";

/** A vault wallet as shown on one chain. */
export interface ChainWallet {
  id: string;
  kind: WalletKind;
  /** Chain this wallet is shown on. */
  chainId: ChainId;
  pubkey: string;
  label: string | null;
  createdAt: string;
}

export function familyOf(chain: string): WalletFamily {
  return chain === "sol" ? "sol" : "evm";
}

export function toChainWallet(w: VaultWallet, chain: ChainId): ChainWallet {
  return {
    id: w.id,
    kind: w.watchOnly ? "WATCH" : "PLATFORM",
    chainId: chain,
    pubkey: w.address,
    label: w.label,
    createdAt: w.createdAt,
  };
}

/** The EVM wallet a trade signs with (one key, every EVM chain). Throws a
 *  sentence the trader can act on. */
export function evmWallet(walletId: string): { id: string; address: string } {
  const w = cachedWallets().find((x) => x.id === walletId);
  if (!w) throw new Error("Wallet not found: reload the wallet list");
  if (w.family !== "evm") throw new Error("Not an EVM wallet");
  if (w.watchOnly) throw new Error("Watch-only wallet: import its key to trade with it");
  return { id: w.id, address: w.address };
}

/** Solana wallets that can sign, from the last list the server returned. */
export function solanaSigners(): Array<{ id: string; pubkey: string; label: string | null }> {
  return cachedWallets()
    .filter((w) => w.family === "sol" && !w.watchOnly)
    .map((w) => ({ id: w.id, pubkey: w.address, label: w.label }));
}

/** The Solana wallet a trade signs with. Throws a sentence the trader can act on. */
export function solanaWallet(walletId: string): { id: string; address: string } {
  const w = cachedWallets().find((x) => x.id === walletId);
  if (!w) throw new Error("Wallet not found: reload the wallet list");
  if (w.family !== "sol") throw new Error("Not a Solana wallet");
  if (w.watchOnly) throw new Error("Watch-only wallet: import its key to trade with it");
  return { id: w.id, address: w.address };
}

type BalanceEntry =
  | { ok: true; balances: { sol: number; tokens: Array<{ mint: string; amount: number; decimals: number }> } }
  | { ok: false; error: string };

/**
 * Native balance and holdings per wallet, from the market-data API's wallet
 * routes (through the same-origin proxy). Amounts in whole coins and tokens.
 */
export async function fetchBalances(walletIds?: string[]): Promise<{ balances: Record<string, BalanceEntry> }> {
  const chain = getActiveChain() as ChainId;
  const targets = cachedWallets().filter(
    (w) => w.family === familyOf(chain) && (!walletIds?.length || walletIds.includes(w.id)),
  );
  const balances: Record<string, BalanceEntry> = {};
  await Promise.all(targets.map(async (w) => {
    try {
      const [profile, holdings] = await Promise.all([
        evmapiGet<{ nativeBalance?: number | null }>(
          `/wallets/${chain}/${encodeURIComponent(w.address)}`,
          { period: "30d" },
        ).catch(() => null),
        evmapiGet<Array<{ token?: string; amount?: number | null }>>(
          `/wallets/${chain}/${encodeURIComponent(w.address)}/holdings`,
          { limit: 100 },
        ).catch(() => null),
      ]);
      const raw = profile?.data?.nativeBalance;
      const sol = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      const tokens = (Array.isArray(holdings?.data) ? holdings!.data : []).map((h) => ({
        mint: String(h.token || ""),
        amount: Number(h.amount || 0),
        decimals: 0,
      })).filter((t) => t.mint && t.amount > 0);
      balances[w.id] = { ok: true, balances: { sol, tokens } };
    } catch (e) {
      balances[w.id] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }));
  return { balances };
}
