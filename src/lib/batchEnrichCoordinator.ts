import { fetchBatchTokenEnrich } from "../api/client";

export interface BatchEnrichEntry {
  bundle_percentage?: number;
  sniper_percentage?: number;
  trade_count?: number;
  total_sol_volume?: number;
  volume_24h?: number;
  fees_total?: number;
  unique_traders?: number;
  holders?: number;
  buy_count?: number;
  sell_count?: number;
  bundle_trades?: number;
  sniper_trades?: number;
  deploys_by_creator?: number;
  migrations_by_creator?: number;
  creator_deploys?: number;
  creator_migrations?: number;
  creatorDeploys?: number;
  creatorMigrations?: number;
  signer?: string;
  platform?: string;
  dex?: string;
  creator_buy_sol?: number;
  creator_buy_tokens?: number;
  creator_buy_price?: number;
  creatorBuySol?: number;
  creatorBuyTokens?: number;
  creatorBuyPrice?: number;
  last_price?: number;
  lastPrice?: number;
  name?: string;
  symbol?: string;
  uri?: string;
  image?: string;
  image_uri?: string;
  sparkline?: number[];
  /** 24h price change, percent. */
  priceChange?: number;
  marketCap?: number;
  liquidity?: number;
  graduationPercent?: number;
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
