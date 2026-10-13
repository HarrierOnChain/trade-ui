import { fetchBatchTokenEnrich } from "../api/client";
import { CHAIN_CHANGED_EVENT } from "./chains";

export interface BatchEnrichEntry {
  name?: string;
  symbol?: string;
  /** 24h volume, USD. */
  volume_24h?: number;
  /** 24h volume in the chain's native coin. */
  total_sol_volume?: number;
  trade_count?: number;
  buy_count?: number;
  sell_count?: number;
  holders?: number;
  /** 24h price change, percent. */
  priceChange?: number;
  bundle_percentage?: number;
  sniper_percentage?: number;
  /** Tokens the creator launched. */
  creatorDeploys?: number;
  /** Safety shares, percent. */
  top10Percent?: number;
  devPercent?: number;
  insidersPercent?: number;
  freshWalletsPercent?: number;
  botsPercent?: number;
  /** Contract checks: taxes in percent, the honeypot verdict, renounced
   *  mint and freeze (Solana: the mint's). */
  buyTaxPercent?: number;
  sellTaxPercent?: number;
  honeypot?: boolean;
  mintRenounced?: boolean;
  freezeRenounced?: boolean;
  twitter?: string;
  website?: string;
  telegram?: string;
  discord?: string;
  signer?: string;
  platform?: string;
}

type PatchCallback = (data: Record<string, BatchEnrichEntry>) => void;

const GLOBAL_CLAIMED = new Set<string>();
let pending = new Set<string>();
let callbacks: PatchCallback[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;

const DEBOUNCE_MS = 300;

export function resetBatchEnrichClaims(): void {
  GLOBAL_CLAIMED.clear();
}

// Claims are by address, and one 0x address can be a token on several EVM
// chains: a chain switch starts over (a reload used to). The queued batch was
// for the previous chain's rows, which are gone.
if (typeof window !== "undefined") {
  window.addEventListener(CHAIN_CHANGED_EVENT, () => {
    GLOBAL_CLAIMED.clear();
    pending = new Set();
    callbacks = [];
    if (timer) clearTimeout(timer);
    timer = null;
  });
}

export function queueBatchEnrich(mints: string[], onResult: PatchCallback): void {
  const fresh: string[] = [];
  for (const m of mints) {
    if (!m || GLOBAL_CLAIMED.has(m)) continue;
    GLOBAL_CLAIMED.add(m);
    fresh.push(m);
    pending.add(m);
  }
  if (fresh.length === 0 && callbacks.length === 0) return;
  callbacks.push(onResult);
  if (timer != null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushBatchEnrich();
  }, DEBOUNCE_MS);
}

async function flushBatchEnrich(): Promise<void> {
  if (inflight) {
    await inflight;
    if (pending.size > 0 || callbacks.length > 0) scheduleFlush();
    return;
  }

  const mints = [...pending];
  const cbs = callbacks.splice(0);
  pending.clear();
  if (mints.length === 0) {
    for (const cb of cbs) cb({});
    return;
  }

  inflight = (async () => {
    try {
      const res = await fetchBatchTokenEnrich(mints, 0);
      const data =
        res && res.success !== false && res.data && typeof res.data === "object"
          ? (res.data as Record<string, BatchEnrichEntry>)
          : {};
      for (const cb of cbs) cb(data);
    } catch {
      for (const cb of cbs) cb({});
    }
  })();

  try {
    await inflight;
  } finally {
    inflight = null;
  }

  if (pending.size > 0 || callbacks.length > 0) scheduleFlush();
}

function scheduleFlush(): void {
  if (timer != null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushBatchEnrich();
  }, DEBOUNCE_MS);
}
