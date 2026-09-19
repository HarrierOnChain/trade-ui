"use client";
/**
 * Thin client for the Raze Terminal regional backend. The region footer selector decides
 * which regional host the browser talks to — the hook returns a memoized
 * client bound to that host plus the cached session token.
 */

import { useEffect, useMemo, useState } from "react";
import { useRegion } from "../contexts/RegionContext";
import { dispatchWalletRpc } from "./localWallets";
// Re-exported from a standalone module so the wire singleton can read these
// constants without importing backend.ts (would create a circular import →
// TDZ at boot).
export { SESSION_STORAGE_KEY, SESSION_CHANGED_EVENT } from "./sessionKey";
import { SESSION_STORAGE_KEY, SESSION_CHANGED_EVENT } from "./sessionKey";

export interface SessionToken {
  token: string;
  expiresAt: string;
  pubkey: string;
}

export function readSession(): SessionToken | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionToken;
    if (!parsed.token || !parsed.expiresAt) return null;
    if (Date.parse(parsed.expiresAt) < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(s: SessionToken | null) {
  if (typeof window === "undefined") return;
  try {
    if (s) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_STORAGE_KEY);
    window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/** Reactive view of the stored session — updates on login/logout and
 *  storage events from other tabs. */
export function useSession(): SessionToken | null {
  // Start null on both SSR and the first client render so React hydration
  // matches. The real session is loaded from localStorage in useEffect
  // below — otherwise an authed user's first paint diverges from the SSR
  // null and triggers React #418 (hydration text mismatch).
  const [session, setSession] = useState<SessionToken | null>(null);

  useEffect(() => {
    setSession(readSession());
    const sync = () => setSession(readSession());
    window.addEventListener(SESSION_CHANGED_EVENT, sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return session;
}

/// What a Phoenix order costs the trader account, as computed by the
/// trading API when it sized the order. `depositUsdcE6` is the collateral
/// top-up folded into the SAME transaction as the order, so it can never
/// land without the position. `effectiveLeverageBps` is what the order
/// actually gets after reserving margin for fees — slightly below the
/// requested leverage when the request sits at the market's cap.
export type PhoenixOrderCost = {
  requiredCollateralUsdcE6: number;
  initialMarginUsdcE6: number;
  costUsdcE6: number;
  notionalUsdcE6: number;
  effectiveLeverageBps: number;
  maxLeverage: number | null;
  depositUsdcE6: number;
  availableBeforeUsdcE6: number | null;
};

export type WalletKind = "PHANTOM" | "PLATFORM" | "DEMO" | "PRIVY";
export type UserRole = "USER" | "ADMIN";

export interface BackendWallet {
  id: string;
  kind: WalletKind;
  /** Chain this wallet belongs to ("sol"). */
  chainId?: string;
  pubkey: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  // Default ladder profiles, snapshotted into Position.{autosellConfig,
  // autobuyConfig} at open. Null when not set. PLATFORM-only — Phantom
  // wallets ignore both fields.
  autosellProfile?: AutosellConfig | null;
  autobuyProfile?: AutobuyConfig | null;
  // DEMO-only paper balances. Null on PHANTOM/PLATFORM; the frontend reads
  // live balances for those via the wallets.balances subscription.
  solBalance?: number | null;
  usdcBalance?: number | null;
  initialSolBalance?: number | null;
  initialUsdcBalance?: number | null;
}

export interface DemoHolding {
  id: string;
  mint: string;
  symbol: string | null;
  tokens: number;
  entryPriceSol: number;
  totalBuySolSpent: number;
  highPriceSol: number;
  lowPriceSol: number;
  openedAt: string;
}

export interface DemoTrade {
  id: string;
  mint: string;
  symbol: string | null;
  side: "buy" | "sell";
  amountSol: number | null;
  sellPct: number | null;
  /** Per-execution token count at fill time (DEMO only). */
  tokensAmount: number | null;
  /** Per-execution SOL price at fill time (DEMO only). */
  priceSolPerToken: number | null;
  reason: string;
  signature: string | null;
  createdAt: string;
}

export interface DemoWalletSummary {
  solBalance: number;
  usdcBalance: number;
  initialSolBalance: number;
  initialUsdcBalance: number;
  stats: {
    realizedPnlSol: number;
    totalTrades: number;
    totalVolumeSol: number;
    openPositions: number;
    openPerpPositions: number;
  };
  holdings: DemoHolding[];
  trades: DemoTrade[];
  perpPositions: Array<{
    id: string;
    marketId: string;
    side: "long" | "short";
    collateralUsd: number;
    leverageBps: number;
    baseUnits: number;
    entryPriceUsd: number;
    status: string;
    openedAt: string;
    closedAt: string | null;
    closePriceUsd: number | null;
    realizedPnlUsd: number | null;
  }>;
}

// DEMO perp position shape returned by trade.demoPerp* handlers.
export interface DemoPerpPosition {
  id: string;
  walletId: string;
  marketId: string;
  side: "long" | "short";
  collateralUsd: number;
  leverageBps: number;
  baseUnits: number;
  entryPriceUsd: number;
  fundingAccruedUsd: number;
  status: "open" | "closed" | "liquidated";
  openedAt: string;
  closedAt: string | null;
  closePriceUsd: number | null;
  realizedPnlUsd: number | null;
}

// ── X tracker ────────────────────────────────────────────────────────────
export interface XHandleSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  verified: boolean;
  lastSyncedAt: string | null;
}

/** A pump.fun-registered charity (deploy "Donate to charity" picker). */
export interface CharitySummary {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface TrackedXHandle {
  handle: XHandleSummary;
  wallets: Array<{ id: string; pubkey: string; label: string | null }>;
  directlyTracked: boolean;
}

export interface XTweet {
  tweetId: string;
  text: string;
  postedAt: string;
  payload: unknown;
}

export type XKolTier = "high" | "medium" | "official";

export interface XTrendingKol {
  handle: string;
  label: string;
  tier: XKolTier;
  tags: string[];
  displayName: string | null;
  avatarUrl: string | null;
  verified: boolean;
  lastSyncedAt: string | null;
}

export interface XTrendingTweet {
  tweetId: string;
  text: string;
  postedAt: string;
  author: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    verified: boolean;
    followersCount: number | null;
    label: string;
    tier: XKolTier;
    tags: string[];
  };
  engagement: {
    views: number | null;
    likes: number | null;
    replies: number | null;
    retweets: number | null;
    quotes: number | null;
    bookmarks: number | null;
  };
}

export type XPreviewKind = "profile" | "tweet" | "community" | "search" | "list" | "other";

export interface XPreviewProfile {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  verified: boolean;
  followersCount: number | null;
  followingCount: number | null;
  tweetCount: number | null;
  joinedAt: string | null;
  description: string | null;
  location: string | null;
}

export interface XPreviewTweet {
  tweetId: string;
  text: string;
  postedAt: string;
  author: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    verified: boolean;
    followersCount: number | null;
  };
  engagement: {
    likes: number | null;
    replies: number | null;
    retweets: number | null;
    quotes: number | null;
    bookmarks: number | null;
    views: number | null;
  };
  mediaUrl: string | null;
  quoted: {
    text: string;
    author: {
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      verified: boolean;
    };
    mediaUrl: string | null;
  } | null;
}

export interface XPreviewCommunity {
  communityId: string;
  name: string | null;
  description: string | null;
  memberCount: number | null;
  createdAt: string | null;
  bannerUrl: string | null;
  creator: {
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    verified: boolean;
  } | null;
}

export interface XPreviewResponse {
  kind: XPreviewKind;
  url: string;
  username: string | null;
  tweetId: string | null;
  communityId: string | null;
  profile: XPreviewProfile | null;
  tweet: XPreviewTweet | null;
  community: XPreviewCommunity | null;
}

export interface SystemConfig {
  phantomAuthEnabled: boolean;
  passwordAuthEnabled: boolean;
  publicViewEnabled: boolean;
  phantomTradingEnabled: boolean;
  privyAuthEnabled: boolean;
  privyTradingEnabled: boolean;
  maintenanceMode: boolean;
  maxWalletsPerUser: number;
  maxRulesPerUser: number;
  regionSelectionEnabled: boolean;
  disabledTerminalRegions: string[];
  /** Chains hidden from the top-bar switcher ("sol" never appears here). */
  disabledChains: string[];
  /** Platform fee in basis points (100 = 1%), charged in-kind via the CPI
   *  router to `feeWallet`. 0 = no percentage fee. */
  feeBps: number;
  /** Recipient pubkey for the percentage fee + the user fixed fee. "" = off. */
  feeWallet: string;
  /** Sponsor wallet public key (display only). The secret is write-only — set
   *  via `adminSetConfig({ sponsorWalletSecret })`, never returned. */
  sponsorWalletPubkey: string;
  /** Master switch for the rewards/referral program. */
  rewardsEnabled: boolean;
  /** Rewards payout wallet public key (display only). The secret is write-only —
   *  set via `adminSetConfig({ rewardsPayoutWalletSecret })`, never returned.
   *  The rest of the economy (points-per-SOL, tiers, milestones, …) is managed
   *  via the rewards admin methods, not here. */
  rewardsPayoutWalletPubkey: string;
}

// ── Rewards / referrals ──────────────────────────────────────────────────────

export interface RewardTierInfo {
  index: number;
  name: string;
  minPoints: number;
  multiplier: number;
}
export interface RewardLedgerEntry {
  type: string;
  points: number;
  reason: string | null;
  mint: string | null;
  at: string;
}
export interface RewardsSummary {
  enabled: boolean;
  points: number;
  lifetimePoints: number;
  pointsPerSol: number;
  solValue: number;
  payoutConfigured: boolean;
  tier: RewardTierInfo;
  nextTier: { name: string; minPoints: number; pointsToNext: number } | null;
  tierProgressPct: number;
  tiers: RewardTierInfo[];
  referral: { code: string; link: string; count: number; earnings: number; referred: boolean };
  stats: { volumeSol: number; deploys: number; referrals: number };
  history: RewardLedgerEntry[];
}
export interface RewardQuest {
  id: string;
  title: string;
  description: string | null;
  metric: string;
  target: number;
  rewardPoints: number;
  period: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
}
export interface LeaderboardEntry {
  rank: number;
  label: string;
  points: number;
  isMe: boolean;
}
export interface RewardClaimResult {
  id: string;
  status: string;
  points: number;
  lamports: number;
  sol: number;
  destination: string;
  signature: string | null;
  at: string;
}
export interface ReferralStats {
  code: string;
  link: string;
  count: number;
  earnings: number;
  referred: boolean;
}

export interface KolProfile {
  id: string;
  address: string;
  name: string;
  imagePath: string | null;
  verified: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface KolLeaderboardEntry extends KolProfile {
  rank: number;
  pnlSol: number;
  pnlUsd: number;
  trades: number;
}

export class BackendClient {
  // The wire singleton is keyed off baseUrl. `token` is kept on the
  // constructor signature for backwards-compatibility with existing call
  // sites (see useBackend below) but isn't used here — the singleton derives
  // it from localStorage and refreshes its connection on session change.
  constructor(public readonly baseUrl: string, public readonly token?: string) {}

  /** All RPC methods route through here. The wire singleton handles the
   *  encrypted handshake, multiplexing, and reconnect. Errors from the server
   *  surface as `Error` whose `message` is the server's `code` (or `msg`).
   *  Every call inherits the WireClient default timeout (`wire_timeout`), so
   *  no per-method timer is needed here. */
  private async call<T>(method: string, params?: unknown): Promise<T> {
    if (method === "config.get") {
      return {
        phantomAuthEnabled: false,
        passwordAuthEnabled: false,
        publicViewEnabled: true,
        phantomTradingEnabled: false,
        privyAuthEnabled: false,
        privyTradingEnabled: false,
        maintenanceMode: false,
        maxWalletsPerUser: 0,
        maxRulesPerUser: 0,
        regionSelectionEnabled: false,
        disabledTerminalRegions: [],
        disabledChains: [],
        feeBps: 0,
        feeWallet: "",
        sponsorWalletPubkey: "",
        rewardsEnabled: false,
        rewardsPayoutWalletPubkey: "",
      } as T;
    }
    if (method.startsWith("wallets.")) {
      return dispatchWalletRpc(method, params) as Promise<T>;
    }
    throw Object.assign(new Error("not_supported_selfhosted"), { code: "not_supported_selfhosted" });
  }

  // ── Public (no auth required) ──────────────────────────────────────────
  getConfig() { return this.call<SystemConfig>("config.get"); }
  publicPrepare(body: {
    pubkey: string; side: "buy" | "sell"; mint: string;
    solAmount?: number; percentage?: number; tokensAmount?: number;
    slippageBps?: number; transactionsFeeLamports?: number;
    fixedFeeLamports?: number; mev?: boolean;
    inputMint?: string; inputAmountRaw?: number; outputMint?: string;
    swapMode?: "exactIn" | "exactOut";
  }) { return this.call<{ transaction: string; encoding: "base64" }>("public.tradePrepare", body); }
  publicSubmit(signedTx: string, pubkey: string, opts?: { mev?: boolean; fixedFeeLamports?: number }) {
    return this.call<{ signature: string; region: string }>("public.tradeSubmit", { signedTx, pubkey, ...opts });
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  nonce(pubkey: string) {
    return this.call<{ nonce: string; message: string; expiresAt: string }>("auth.nonce", { pubkey });
  }
  verify(pubkey: string, nonce: string, signature: string, referralCode?: string) {
    return this.call<{ token: string; expiresAt: string; user: { id: string; phantomPubkey: string | null; role: UserRole } }>(
      "auth.verify", { pubkey, nonce, signature, referralCode },
    );
  }
  register(email: string, password: string, referralCode?: string) {
    return this.call<{ token: string; expiresAt: string; user: { id: string; email: string | null; role: UserRole } }>(
      "auth.register", { email, password, referralCode },
    );
  }
  passwordLogin(email: string, password: string) {
    return this.call<{ token: string; expiresAt: string; user: { id: string; email: string | null; role: UserRole } }>(
      "auth.passwordLogin", { email, password },
    );
  }
  /** Exchange a Privy access token for a Raze session. */
  privyVerify(accessToken: string, referralCode?: string) {
    return this.call<{ token: string; expiresAt: string; user: { id: string; privyId: string | null; role: UserRole } }>(
      "auth.privyVerify", { accessToken, referralCode },
    );
  }
  /** Re-sync the Privy embedded wallets + delegation state (call after the
   *  user grants/revokes server-signer consent). Privy is the source of truth. */
  privyRefresh() {
    return this.call<{ wallets: Array<{ address: string; chainType: "solana" | "ethereum"; delegated: boolean }> }>(
      "auth.privyRefresh",
    );
  }
  me() {
    return this.call<{
      id: string;
      phantomPubkey: string | null;
      email: string | null;
      privyId: string | null;
      role: UserRole;
      disabled: boolean;
      createdAt: string;
      allowedRegions: string[];
      defaultRegion: string | null;
      maxRegions: number;
    }>("auth.me");
  }
  logout() { return this.call<void>("auth.logout"); }

  // ── Wallets ─────────────────────────────────────────────────────────────
  listWallets(chainId?: string) {
    // `limit` = effective per-user wallet cap (0 = unlimited); `used` = total
    // wallets across every chain. Older backends omit both — treat as unlimited.
    return this.call<{ wallets: BackendWallet[]; limit?: number; used?: number }>("wallets.list", { chainId });
  }
  createPlatformWallet(label?: string, chainId?: string) {
    return this.call<BackendWallet>("wallets.createPlatform", { label, chainId });
  }
  importPlatformWallet(secret: string, label?: string, chainId?: string) {
    return this.call<BackendWallet>("wallets.importPlatform", { secret, label, chainId });
  }
  deleteWallet(id: string) { return this.call<void>("wallets.delete", { id }); }
  /** Reveal the bs58 secret for a PLATFORM wallet. PHANTOM and
   *  DEMO wallets reject — they have nothing exportable on this server. */
  exportWalletSecret(id: string) {
    return this.call<{ pubkey: string; chainId: string; secret: string }>(
      "wallets.exportSecret", { id },
    );
  }
  renameWallet(id: string, label: string) { return this.call<BackendWallet>("wallets.rename", { id, label }); }
  // Transfer + burn — wire-method names are stable; backend handlers are
  // expected to land in a follow-up. Until then, calls reject with the
  // server's "method not registered" error; the portfolio modals catch and
  // surface a clean toast. Replace nothing on the call-site once the
  // backend ships these.
  transferSol(args: { fromWalletId: string; toAddress: string; lamports: number; }) {
    return this.call<{ signature: string; signatures: string[] }>("wallets.transferSol", args);
  }
  transferToken(args: { fromWalletId: string; toAddress: string; mint: string; amount: number; decimals: number; }) {
    return this.call<{ signature: string; signatures: string[] }>("wallets.transferToken", args);
  }
  burnToken(args: { fromWalletId: string; mint: string; amount: number; decimals: number; closeAccount?: boolean; }) {
    return this.call<{ signature: string; signatures: string[] }>("wallets.burnToken", args);
  }
  closeEmptyAccounts(args: { walletId: string; mints?: string[] }) {
    return this.call<{ closed: number; recoveredLamports: number; signatures: string[] }>(
      "wallets.closeEmptyAccounts", args,
    );
  }
  // Trading utils — many→one consolidate, pump.fun / Meteora fee claim. All
  // custodial: backend builds via the trading service, signs with the wallets'
  // platform keys, and submits.
  consolidateSol(args: {
    sourceWalletIds: string[];
    toWalletId: string;
    percentage: number;
    feeTipLamports?: number;
  }) {
    return this.call<{ signatures: string[] }>("wallets.consolidateSol", args);
  }
  // SplitNOW funding flow — multi-wallet SOL on-ramp.
  // Step 1: fundQuote (rate preview)
  // Step 2: fundOrder (returns deposit address + amount)
  // Step 3: fundStatus (poll until settled)
  fundQuote(args: {
    fromAmountSol: number;
    distributions: Array<{ walletId: string; bips: number }>;
  }) {
    return this.call<{
      quoteId: string;
      rates: Array<{ exchangeId: string; exchangeRate: number }>;
      legs: Array<{ walletId: string; toAddress: string; toPctBips: number }>;
    }>("wallets.fundQuote", args);
  }
  fundOrder(args: {
    quoteId: string;
    fromAmountSol: number;
    distributions: Array<{ walletId: string; bips: number }>;
    exchangerId?: string;
    /** Optional PLATFORM wallet to auto-pay the SplitNOW deposit from.
     *  If omitted and `manual` is falsy the backend auto-picks a sender. */
    fromWalletId?: string;
    /** Skip auto-pay entirely and return the SplitNOW deposit address so
     *  the caller can send manually from any external wallet. */
    manual?: boolean;
  }) {
    return this.call<{
      orderId: string;
      depositAddress: string;
      depositAmount: number;
      exchangerId: string;
      legs: Array<{ walletId: string; toAddress: string; toPctBips: number }>;
      autoPaid?: boolean;
      signature?: string;
      autoPayError?: string;
    }>("wallets.fundOrder", args);
  }
  fundStatus(args: { orderId: string }) {
    return this.call<{
      orderId: string;
      orderStatus: string;
      orderStatusShort: string;
      orderStatusText: string;
    }>("wallets.fundStatus", args);
  }
  claimFees(args: {
    walletId: string;
    platform: "pumpfun" | "meteora";
    feeType?: "creator" | "claimer";
    pool?: string;
    maxBaseAmount?: number;
    maxQuoteAmount?: number;
    receiver?: string;
    feeTipLamports?: number;
  }) {
    return this.call<{ signatures: string[] }>("wallets.claimFees", args);
  }
  /** Share creator rewards — manage the pump.fun fee-sharing config. */
  feesConfig(args: {
    walletId: string;
    action: "status" | "create" | "setup" | "update" | "reset";
    mint: string;
    pool?: string;
    shareholders?: { address: string; shareBps: number }[];
    currentShareholders?: string[];
    newAdmin?: string;
    feeTipLamports?: number;
  }) {
    return this.call<{ signatures?: string[]; status?: unknown }>("wallets.feesConfig", args);
  }
  /** Tokenized agent — initialize a Pump Agent Payments agent for a mint. */
  agentInit(args: { walletId: string; mint: string; buybackBps: number; feeTipLamports?: number }) {
    return this.call<{ signatures: string[] }>("wallets.agentInit", args);
  }
  /** Deploy "Donate to charity" picker — search pump.fun's 501(c)(3) registry. */
  charitySearch(term: string, limit?: number) {
    return this.call<{ charities: CharitySummary[] }>("deploy.charitySearch", { term, limit });
  }
  createDemoWallet(args?: { label?: string; initialSol?: number; initialUsdc?: number; chainId?: string }) {
    return this.call<BackendWallet>("wallets.createDemo", args ?? {});
  }
  resetDemoWallet(id: string) { return this.call<BackendWallet>("wallets.resetDemo", { id }); }
  demoSummary(walletId: string) {
    return this.call<DemoWalletSummary>("wallets.demoSummary", { walletId });
  }
  demoPerpOpen(args: {
    walletId: string; marketId: string;
    side: "long" | "short"; collateralUsdcE6: number;
    leverageBps: number; markPriceUsd: number;
  }) {
    return this.call<DemoPerpPosition>("trade.demoPerpOpen", args);
  }
  demoPerpClose(args: {
    walletId: string; marketId: string;
    closePctBps: number; markPriceUsd: number;
  }) {
    return this.call<{
      ok: boolean; position: DemoPerpPosition;
      pnlUsd: number; fundingPaidUsd: number; netReturnUsd: number;
    }>("trade.demoPerpClose", args);
  }
  demoPerpList(walletId: string) {
    return this.call<{ positions: DemoPerpPosition[] }>("trade.demoPerpList", { walletId });
  }
  setWalletProfiles(id: string, body: { autosellProfile?: AutosellConfig; autobuyProfile?: AutobuyConfig }) {
    return this.call<BackendWallet>("wallets.setProfiles", { id, ...body });
  }
  setPositionAutosell(id: string, autosellConfig: AutosellConfig) {
    return this.call<{ position: Position }>("automation.positions.setAutosell", { id, autosellConfig });
  }
  setPositionAutobuy(id: string, autobuyConfig: AutobuyConfig) {
    return this.call<{ position: Position }>("automation.positions.setAutobuy", { id, autobuyConfig });
  }
  /** Backend fetches SOL + token balances via gateway RPC proxy. */
  walletBalances(walletIds?: string[]) {
    type Entry =
      | { ok: true; balances: { sol: number; tokens: Array<{ mint: string; amount: number; decimals: number }> } }
      | { ok: false; error: string };
    return this.call<{ balances: Record<string, Entry> }>("wallets.balances",
      walletIds?.length ? { walletIds } : {});
  }

  // ── X tracker — xshot-fed wire methods (backend/src/lib/wire/handlers/x.ts).
  // Live tweets ride the `x.tweets` wire topic — see api/xstream.ts.
  listXHandles() { return this.call<{ handles: TrackedXHandle[] }>("x.handles.list"); }
  addXHandle(username: string, walletId?: string) {
    return this.call<{ handle: XHandleSummary }>("x.handles.add", { username, walletId });
  }
  deleteXHandle(id: string) { return this.call<{ ok: boolean }>("x.handles.remove", { id }); }
  xHandleTweets(username: string, take = 50) {
    return this.call<{ tweets: XTweet[] }>("x.handles.tweets", { username, take });
  }
  xFeed(take = 50) {
    return this.call<{ tweets: (XTweet & { username: string })[] }>("x.feed", { take });
  }
  // Trending-X KOL registry — admin-curated list in SystemConfig
  // (`xTrendingKols`), profiles/tweets served from the shared xshot cache.
  xTrendingKols() { return this.call<{ kols: XTrendingKol[] }>("x.trending.kols"); }
  xTrendingKolTweets(take = 80) {
    return this.call<{ kols: XTrendingKol[]; tweets: XTrendingTweet[] }>("x.trending.tweets", { take });
  }
  async xPreview(url: string): Promise<XPreviewResponse> {
    return this.call<XPreviewResponse>("x.preview", { url });
  }

  // ── Trade ───────────────────────────────────────────────────────────────
  health() { return this.call<{ region: string; trading: unknown }>("trade.health"); }
  prepare(body: {
    walletId: string; side: "buy" | "sell"; mint: string;
    solAmount?: number; percentage?: number; tokensAmount?: number;
    slippageBps?: number; transactionsFeeLamports?: number;
    fixedFeeLamports?: number; mev?: boolean;
    inputMint?: string; inputAmountRaw?: number; outputMint?: string;
    swapMode?: "exactIn" | "exactOut";
  }) { return this.call<{ transaction: string; encoding: "base64" }>("trade.prepare", body); }
  submit(signedTx: string, walletId: string, opts?: { mev?: boolean; fixedFeeLamports?: number; mint?: string; side?: "buy" | "sell" }) {
    return this.call<{ signature: string; region: string }>("trade.submit", { signedTx, walletId, ...opts });
  }
  /** Perp platform path: backend signs the unsigned tx with the platform
   *  wallet's stored keypair and relays via gateway. */
  perpExecute(txB64: string, walletId: string) {
    return this.call<{ signature: string; region: string }>("trade.perpExecute", { txB64, walletId });
  }
  /** Phoenix platform-wallet order — fully backend-driven. Backend holds
   *  the keypair, signs the Phoenix auth nonce + the order tx, relays via
   *  gateway. Returns the confirmed signature. */
  phoenixExecute(body: {
    walletId: string;
    marketId: string;
    side: "long" | "short";
    clientOrderId: string;
    collateralUsdcE6: number;
    leverageBps: number;
  }) {
    return this.call<{ signature: string; region: string; cost?: PhoenixOrderCost }>(
      "trade.phoenixExecute",
      body,
    );
  }
  /** Phoenix order prepare: backend builds the place-order ix locally
   *  (no auth round-trip — Phoenix's Anchor IDL is bundled via the rise
   *  SDK), returns an unsigned V0 tx for browser-side signing. Same
   *  shape as Jupiter's order prepare. */
  phoenixOrderPrepare(body: {
    walletId: string;
    marketId: string;
    side: "long" | "short";
    clientOrderId: string;
    collateralUsdcE6: number;
    leverageBps: number;
  }) {
    return this.call<{ txB64: string; encoding: "base64"; cost?: PhoenixOrderCost }>(
      "trade.phoenixOrderPrepare",
      body,
    );
  }
  /** Phoenix collateral balance. Collateral lives in a Phoenix trader
   *  account, NOT in the wallet, and it survives a failed order — without
   *  this read the app had no way to show funds that had already left the
   *  wallet, which is exactly how a stranded deposit read as lost money. */
  phoenixBalance(body: { walletId: string }) {
    return this.call<{ collateralUsdcE6: number | null; pubkey: string }>(
      "trade.phoenixBalance",
      body,
    );
  }
  /** Phoenix collateral deposit — moves USDC from the wallet through the
   *  Ember wrapper into the Phoenix trader account.
   *
   *  ⚠️ NEVER call this to fund an order. Orders carry their own collateral
   *  top-up inside the order transaction, so funding and filling share a
   *  fate; a deposit sent separately can confirm while the order reverts,
   *  which is precisely the 2026-08-04 stranded-collateral incident. This
   *  is for a deliberate, user-initiated pre-fund only, and no order path
   *  reaches it. */
  phoenixDepositExecute(body: { walletId: string; amountUsdcE6: number; clientOpId?: string }) {
    return this.call<{ signature: string; region: string }>("trade.phoenixDepositExecute", body);
  }
  phoenixDepositPrepare(body: { walletId: string; amountUsdcE6: number; clientOpId?: string }) {
    return this.call<{ txB64: string; encoding: "base64" }>("trade.phoenixDepositPrepare", body);
  }
  /** Phoenix collateral withdraw — pulls USDC out of the trader account
   *  back to the user's wallet via Ember unwrap. Phoenix has a global
   *  FIFO withdraw queue; the tx confirms immediately but the funds may
   *  take time to actually settle depending on queue depth. */
  phoenixWithdrawExecute(body: { walletId: string; amountUsdcE6: number; clientOpId?: string }) {
    return this.call<{ signature: string; region: string }>("trade.phoenixWithdrawExecute", body);
  }
  phoenixWithdrawPrepare(body: { walletId: string; amountUsdcE6: number; clientOpId?: string }) {
    return this.call<{ txB64: string; encoding: "base64" }>("trade.phoenixWithdrawPrepare", body);
  }
  /** Phoenix close (full or partial). Backend looks up the open position
   *  from `/trader/state`, computes the opposite-direction market order,
   *  signs (platform-wallet path) and relays. `closePctBps=10000` is a
   *  full close, smaller values are partial. */
  phoenixCloseExecute(body: { walletId: string; marketId: string; closePctBps?: number; clientOrderId?: string }) {
    return this.call<{ signature: string; region: string }>("trade.phoenixCloseExecute", body);
  }
  phoenixClosePrepare(body: { walletId: string; marketId: string; closePctBps?: number; clientOrderId?: string }) {
    return this.call<{ txB64: string; encoding: "base64" }>("trade.phoenixClosePrepare", body);
  }
  execute(body: {
    walletId: string; side: "buy" | "sell"; mint: string;
    solAmount?: number; percentage?: number; tokensAmount?: number;
    slippageBps?: number; transactionsFeeLamports?: number;
    fixedFeeLamports?: number; mev?: boolean;
    inputMint?: string; inputAmountRaw?: number; outputMint?: string;
    swapMode?: "exactIn" | "exactOut";
  }) {
    return this.call<{ signature: string; region: string }>("trade.execute", body);
  }

  // ── Preferences ─────────────────────────────────────────────────────────
  listPreferences() {
    return this.call<{ preferences: Array<{ key: string; value: unknown; updatedAt: string }> }>("preferences.list");
  }
  async getPreference<T = unknown>(key: string): Promise<T | null> {
    try {
      const res = await this.call<{ key: string; value: T; updatedAt: string }>("preferences.get", { key });
      return res.value;
    } catch (e) {
      if (e instanceof Error && /not_found/.test(e.message)) return null;
      throw e;
    }
  }
  setPreference<T = unknown>(key: string, value: T) {
    return this.call<{ key: string; value: T; updatedAt: string }>("preferences.set", { key, value });
  }
  deletePreference(key: string) { return this.call<void>("preferences.delete", { key }); }

  // ── Automation: snipers ────────────────────────────────────────────────
  listSnipers() { return this.call<{ snipers: Sniper[] }>("automation.snipers.list"); }
  createSniper(body: SniperCreateBody) { return this.call<{ sniper: Sniper }>("automation.snipers.create", body); }
  updateSniper(id: string, body: Partial<SniperCreateBody> & { status?: "paused" | "active" | "stopped" }) {
    return this.call<{ sniper: Sniper }>("automation.snipers.update", { id, ...body });
  }
  deleteSniper(id: string) { return this.call<void>("automation.snipers.delete", { id }); }
  hardDeleteSniper(id: string) { return this.call<void>("automation.snipers.hardDelete", { id }); }

  // ── Automation: wallet lists ────────────────────────────────────────────
  listWalletLists() { return this.call<{ walletLists: WalletList[] }>("automation.walletLists.list"); }
  createWalletList(body: { name: string }) { return this.call<{ walletList: WalletList }>("automation.walletLists.create", body); }
  deleteWalletList(id: string) { return this.call<void>("automation.walletLists.delete", { id }); }
  addWalletListEntry(listId: string, body: { address: string; label?: string }) {
    return this.call<{ entry: WalletListEntry }>("automation.walletLists.addEntry", { listId, ...body });
  }
  removeWalletListEntry(listId: string, entryId: string) {
    return this.call<void>("automation.walletLists.removeEntry", { listId, entryId });
  }

  // ── Automation: positions ───────────────────────────────────────────────
  listPositions(opts: { sniperId?: string; reconcile?: boolean } = {}) {
    return this.call<{ positions: Position[] }>("automation.positions.list", opts);
  }
  closePosition(id: string, sellPct = 100) {
    return this.call<{ ok: boolean; signature: string | null; error: string | null }>("automation.positions.close", { id, sellPct });
  }
  reconcilePositions() {
    return this.call<{ closed: number; checked: number; wallets: number }>("automation.positions.reconcile");
  }
  positionExecutions(id: string, take = 50) {
    return this.call<{ executions: PositionExecution[] }>("automation.positions.executions", { id, take });
  }

  // ── Automation: limit orders ────────────────────────────────────────────
  listLimitOrders(params: { mint?: string; status?: string } = {}) {
    return this.call<{ limitOrders: LimitOrder[] }>("automation.limitOrders.list", params);
  }
  createLimitOrder(body: {
    walletId: string; side: "buy" | "sell"; mint: string; symbol?: string;
    triggerMcapUsd: number; amount: number; slippageBps?: number;
    transactionsFeeLamports?: number; expiresAt?: string;
  }) { return this.call<{ limitOrder: LimitOrder }>("automation.limitOrders.create", body); }
  updateLimitOrder(id: string, body: { triggerMcapUsd?: number; amount?: number }) {
    return this.call<{ limitOrder: LimitOrder }>("automation.limitOrders.update", { id, ...body });
  }
  cancelLimitOrder(id: string) { return this.call<void>("automation.limitOrders.cancel", { id }); }

  // ── Automation: market-making automode ─────────────────────────────────
  listAutomode(params: { mint?: string } = {}) {
    return this.call<{ sessions: AutomodeSession[] }>("automation.automode.list", params);
  }
  createAutomode(body: AutomodeCreateBody) {
    return this.call<{ session: AutomodeSession }>("automation.automode.create", body);
  }
  updateAutomode(id: string, body: Partial<Pick<AutomodeCreateBody, "symbol" | "walletIds" | "startDelaySec" | "slippageBps" | "endMaxAmount" | "endDurationSec">>) {
    return this.call<{ session: AutomodeSession }>("automation.automode.update", { id, ...body });
  }
  setAutomodeStatus(id: string, status: AutomodeStatus) {
    return this.call<{ session: AutomodeSession }>("automation.automode.setStatus", { id, status });
  }
  deleteAutomode(id: string) { return this.call<void>("automation.automode.delete", { id }); }
  addAutomodeStrategy(sessionId: string, body: AutomodeStrategyBody) {
    return this.call<{ strategy: AutomodeStrategy }>("automation.automode.addStrategy", { sessionId, ...body });
  }
  updateAutomodeStrategy(id: string, body: Partial<AutomodeStrategyBody>) {
    return this.call<{ strategy: AutomodeStrategy }>("automation.automode.updateStrategy", { id, ...body });
  }
  removeAutomodeStrategy(id: string) { return this.call<void>("automation.automode.removeStrategy", { id }); }

  // ── Automation: volume bot ─────────────────────────────────────────────
  listVolumeBots(params: { mint?: string } = {}) {
    return this.call<{ sessions: VolumeBotSession[] }>("automation.volumeBot.list", params);
  }
  createVolumeBot(body: VolumeBotCreateBody) {
    return this.call<{ session: VolumeBotSession }>("automation.volumeBot.create", body);
  }
  setVolumeBotStatus(id: string, status: AutomodeStatus) {
    return this.call<{ session: VolumeBotSession }>("automation.volumeBot.setStatus", { id, status });
  }
  deleteVolumeBot(id: string) { return this.call<void>("automation.volumeBot.delete", { id }); }

  // ── Automation: Auto Clean (supply rotator) ────────────────────────────
  listAutoClean(params: { mint?: string } = {}) {
    return this.call<{ sessions: AutoCleanSession[] }>("automation.autoClean.list", params);
  }
  createAutoClean(body: AutoCleanCreateBody) {
    return this.call<{ session: AutoCleanSession }>("automation.autoClean.create", body);
  }
  updateAutoClean(id: string, body: Partial<Omit<AutoCleanCreateBody, "mint">>) {
    return this.call<{ session: AutoCleanSession }>("automation.autoClean.update", { id, ...body });
  }
  setAutoCleanStatus(id: string, status: AutomodeStatus) {
    return this.call<{ session: AutoCleanSession }>("automation.autoClean.setStatus", { id, status });
  }
  runAutoClean(id: string) {
    return this.call<{ session: AutoCleanSession }>("automation.autoClean.runNow", { id });
  }
  deleteAutoClean(id: string) { return this.call<void>("automation.autoClean.delete", { id }); }

  // ── Rewards / referrals ────────────────────────────────────────────────
  rewardsSummary() { return this.call<RewardsSummary>("rewards.summary"); }
  rewardsQuests() { return this.call<{ quests: RewardQuest[] }>("rewards.quests"); }
  rewardsClaimQuest(id: string) { return this.call<{ awarded: number; questId: string }>("rewards.claimQuest", { id }); }
  rewardsLeaderboard() { return this.call<{ entries: LeaderboardEntry[]; me: LeaderboardEntry | null }>("rewards.leaderboard"); }
  /** Redeem points for on-chain SOL. `idempotencyKey` MUST be a fresh unique id
   *  per claim attempt; a retried key returns the original record (no double-pay). */
  rewardsClaim(points: number, destination: string, idempotencyKey: string) {
    return this.call<RewardClaimResult>("rewards.claim", { points, destination, idempotencyKey });
  }
  referralStats() { return this.call<ReferralStats>("referral.stats"); }

  // ── KOLs (verified trader leaderboard) ─────────────────────────────────
  kolsList() { return this.call<{ kols: KolProfile[] }>("kols.list"); }
  kolsLeaderboard(period: "daily" | "weekly" | "monthly" = "weekly") {
    return this.call<{ period: string; kols: KolLeaderboardEntry[]; solPriceUsd: number }>("kols.leaderboard", { period });
  }
}

// ── Market-making automode types ───────────────────────────────────────
export type AutomodeKind = "autobuy" | "autosell";
export type AutomodeMode = "replication" | "time" | "mcap";
export type AutomodeStatus = "paused" | "active" | "stopped";
export type SellUnit = "percent_supply" | "percent_owned" | "token";

export interface AutomodeStrategy {
  id: string;
  sessionId: string;
  mode: AutomodeMode;
  enabled: boolean;
  config: Record<string, unknown>;
  sellUnit: SellUnit | null;
  scopeMcapMinUsd: number | null;
  scopeMcapMaxUsd: number | null;
  endMaxAmount: number | null;
  endDurationSec: number | null;
  whitelist: string[];
  spentAmount: number;
  createdAt: string;
}

export interface AutomodeSession {
  id: string;
  mint: string;
  symbol: string | null;
  kind: AutomodeKind;
  status: AutomodeStatus;
  walletIds: string[];
  startDelaySec: number | null;
  slippageBps: number | null;
  endMaxAmount: number | null;
  endDurationSec: number | null;
  totalBuySol: number;
  totalSellSol: number;
  fireCount: number;
  realizedPnlSol: number;
  startedAt: string | null;
  createdAt: string;
  strategies: AutomodeStrategy[];
}

export interface AutomodeStrategyBody {
  mode: AutomodeMode;
  enabled?: boolean;
  config: Record<string, unknown>;
  sellUnit?: SellUnit | null;
  scopeMcapMinUsd?: number | null;
  scopeMcapMaxUsd?: number | null;
  endMaxAmount?: number | null;
  endDurationSec?: number | null;
  whitelist?: string[];
}

export interface AutomodeCreateBody {
  kind: AutomodeKind;
  mint: string;
  symbol?: string;
  walletIds: string[];
  startDelaySec?: number;
  slippageBps?: number;
  endMaxAmount?: number;
  endDurationSec?: number;
  status?: AutomodeStatus;
  strategies?: AutomodeStrategyBody[];
}

export interface VolumeBotSession {
  id: string;
  mint: string;
  symbol: string | null;
  status: AutomodeStatus;
  walletIds: string[];
  targetVolume: number;
  unit: "sol" | "usd";
  durationSec: number;
  delayMinMs: number;
  delayMaxMs: number;
  execMode: "organic" | "bundle";
  sizing: Record<string, unknown>;
  generatedVolume: number;
  tradeCount: number;
  startedAt: string | null;
  createdAt: string;
}

export interface VolumeBotCreateBody {
  mint: string;
  symbol?: string;
  walletIds: string[];
  targetVolume: number;
  unit?: "sol" | "usd";
  durationSec: number;
  delayMinMs?: number;
  delayMaxMs?: number;
  execMode?: "organic" | "bundle";
  sizing?: Record<string, unknown>;
  status?: AutomodeStatus;
}

// ── Auto Clean types ───────────────────────────────────────────────────
export type AutoCleanMode = "funded";
export type AutoCleanExecMode = "bundle" | "sequential";
// Self-funded bundle leg order: holder dumps then buyer re-buys, or vice-versa.
export type AutoCleanLegOrder = "sellFirst" | "buyFirst";
export type AutoCleanBuyerUnit = "token" | "sol";
export type AutoCleanSellerUnit = "percent" | "token";

export interface AutoCleanBuyer {
  walletId: string;
  amount: number;
  unit: AutoCleanBuyerUnit;
  // Explicit holder that funds this buyer — the modular bundle pairing. Unset on
  // legacy sessions, where the engine round-robins holders over buyers instead.
  sellerWalletId?: string;
}

// How much a seller dumps per rotation: percent of its holdings, or a token qty.
export interface AutoCleanSeller {
  walletId: string;
  // Holders no longer carry a sell amount — the clean derives how much each
  // holder dumps from the buyer it funds (the corrispettivo). Kept optional for
  // back-compat with older saved sessions.
  amount?: number;
  unit?: AutoCleanSellerUnit;
}

export interface AutoCleanStep {
  seq: number;
  rotation: number;
  action: "sell" | "buy" | "sell_remaining";
  wallet: string;
  label?: string;
  amount?: string;
  status: "pending" | "success" | "error";
  signature?: string;
  bundleId?: string;
  error?: string;
  at: number;
}

export interface AutoCleanSession {
  id: string;
  mint: string;
  symbol: string | null;
  status: AutomodeStatus;
  mode: AutoCleanMode;
  sellers: AutoCleanSeller[];
  buyers: AutoCleanBuyer[];
  execMode: AutoCleanExecMode;
  legOrder: AutoCleanLegOrder;
  delayMinMs: number;
  delayMaxMs: number;
  sellRemaining: boolean;
  slippageBps: number | null;
  jitoTipLamports: number | null;
  repeatCount: number;
  repeatDelaySec: number;
  rotationCount: number;
  totalSoldSol: number;
  totalBoughtSol: number;
  lastRun: AutoCleanStep[];
  lastRunAt: string | null;
  pausedReason: string | null;
  startedAt: string | null;
  createdAt: string;
}

export interface AutoCleanCreateBody {
  mint: string;
  symbol?: string;
  mode?: AutoCleanMode;
  sellers: AutoCleanSeller[];
  buyers: AutoCleanBuyer[];
  execMode?: AutoCleanExecMode;
  legOrder?: AutoCleanLegOrder;
  delayMinMs?: number;
  delayMaxMs?: number;
  sellRemaining?: boolean;
  slippageBps?: number;
  jitoTipLamports?: number;
  repeatCount?: number;
  repeatDelaySec?: number;
  status?: AutomodeStatus;
  /** When created paused, a sentinel the engine reads to auto-activate the
   *  session post-launch (e.g. "awaiting_launch_supply" from the /deploy queue). */
  pausedReason?: string;
}

// ── Automation types ───────────────────────────────────────────────────

// ── sniper (entry layer — snipe + copy unified) ────────────────────────

export interface SniperWalletRef {
  walletId: string;
  wallet: { id: string; pubkey: string; label: string | null };
}

export interface SniperTxConfig {
  slippageMode?: "percent" | "bps";
  slippage?: number;
  altSlippage?: number;
  gas?: number;
  altGas?: number;
  tip?: number;
  altTip?: number;
  highGasLowTip?: boolean;
  computeUnits?: number;
  noTipLanders?: boolean;
}

export interface Sniper {
  id: string;
  userId: string;
  name: string;
  status: "paused" | "active" | "stopped";
  snipeEnabled: boolean;
  copyEnabled: boolean;
  walletListId: string;
  walletList?: { id: string; name: string; _count?: { entries: number } };
  mintWhitelist: string[];
  mintBlacklist: string[];
  buySol: number;
  buyMode: "fixed" | "multiplier" | "dynamic";
  buyMultiplier: number;
  amountMin: number;
  amountMax: number;
  firstPurchase: boolean;
  tokenPurchaseLimit: boolean;
  followSellMode: "No" | "Yes" | "Match" | "Bundle";
  fullCloseTrigger: boolean;
  fullCloseTriggerRatio: number;
  txConfig: SniperTxConfig;
  regions: string[];
  fireCount: number;
  lastFiredAt: string | null;
  pausedReason: string | null;
  createdAt: string;
  updatedAt: string;
  wallets: SniperWalletRef[];
}

export interface SniperCreateBody {
  name: string;
  snipeEnabled?: boolean;
  copyEnabled?: boolean;
  walletIds: string[];
  walletListId: string;
  mintWhitelist?: string[];
  mintBlacklist?: string[];
  buySol?: number;
  buyMode?: "fixed" | "multiplier" | "dynamic";
  buyMultiplier?: number;
  amountMin?: number;
  amountMax?: number;
  firstPurchase?: boolean;
  tokenPurchaseLimit?: boolean;
  followSellMode?: "No" | "Yes" | "Match" | "Bundle";
  fullCloseTrigger?: boolean;
  fullCloseTriggerRatio?: number;
  txConfig?: SniperTxConfig;
  regions?: string[];
}

// ── Wallet lists ──────────────────────────────────────────────────────

export interface WalletList {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  entries: WalletListEntry[];
  _count?: { snipers: number };
}

export interface WalletListEntry {
  id: string;
  walletListId: string;
  address: string;
  label: string | null;
  createdAt: string;
}

// ── Position ──────────────────────────────────────────────────────────

export interface Position {
  id: string;
  userId: string;
  walletId: string;
  sniperId: string | null;
  mint: string;
  symbol: string | null;
  entryPriceSol: number;
  entryMcapUsd: number;
  totalTokens: number;
  highPriceSol: number;
  lowPriceSol: number;
  totalBuySolSpent: number;
  autosellConfig: AutosellConfig | unknown;
  autobuyConfig: AutobuyConfig | unknown;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  wallet: { id: string; pubkey: string; label: string | null };
}

export interface PositionExecution {
  id: string;
  positionId: string;
  walletId: string;
  side: "buy" | "sell";
  amountSol: number | null;
  sellPct: number | null;
  reason: string;
  signature: string | null;
  error: string | null;
  remoteStrategyId: string | null;
  region: string | null;
  detectUs: number | null;
  buildUs: number | null;
  sendUs: number | null;
  totalUs: number | null;
  createdAt: string;
}

// ── LimitOrder (pre-position price trigger from the trading panel) ──

export interface LimitOrder {
  id: string;
  userId: string;
  walletId: string;
  side: "buy" | "sell";
  mint: string;
  symbol: string | null;
  triggerMcapUsd: number;
  /** SOL on a buy, percentage (0–100) on a sell. */
  amount: number;
  slippageBps: number | null;
  transactionsFeeLamports: number | null;
  status: "active" | "filled" | "cancelled" | "failed" | "expired";
  expiresAt: string | null;
  filledAt: string | null;
  createdAt: string;
  wallet: { id: string; pubkey: string; label: string | null };
}

// ── Autosell ──────────────────────────────────────────────────────────

export interface AutosellPhaseTp { gainPct: number; sellPct: number }
export interface AutosellPhaseSl { lossPct: number; sellPct: number }

export interface AutosellConfig {
  enabled: boolean;
  tpPhases: AutosellPhaseTp[];
  slPhases: AutosellPhaseSl[];
  trailingStopLoss: boolean;
  trailingStopLossPct: number;
  trailingStopLossSellPct: number;
  migrationSell: boolean;
  migrationSellPct: number;
  slippageBps?: number;
  transactionsFeeLamports?: number;
}

export const EMPTY_AUTOSELL: AutosellConfig = {
  enabled: false,
  tpPhases: [],
  slPhases: [],
  trailingStopLoss: false,
  trailingStopLossPct: 30,
  trailingStopLossSellPct: 100,
  migrationSell: false,
  migrationSellPct: 100,
};

export function parseAutosellConfig(raw: unknown): AutosellConfig {
  if (raw == null) return EMPTY_AUTOSELL;
  let p: Record<string, unknown>;
  if (typeof raw === "string") {
    try { p = JSON.parse(raw) as Record<string, unknown>; } catch { return EMPTY_AUTOSELL; }
  } else if (typeof raw === "object") {
    p = raw as Record<string, unknown>;
  } else {
    return EMPTY_AUTOSELL;
  }
  const num = (v: unknown, d: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const numU = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const phases = <T extends { sellPct: number }>(arr: unknown, k: "gainPct" | "lossPct"): T[] => {
    if (!Array.isArray(arr)) return [];
    const out: T[] = [];
    for (const v of arr) {
      if (!v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      const t = numU(o[k]); const s = numU(o.sellPct);
      if (t == null || s == null) continue;
      out.push({ [k]: t, sellPct: s } as unknown as T);
    }
    return out;
  };
  return {
    enabled: !!p.enabled,
    tpPhases: phases<AutosellPhaseTp>(p.tpPhases, "gainPct"),
    slPhases: phases<AutosellPhaseSl>(p.slPhases, "lossPct"),
    trailingStopLoss: !!p.trailingStopLoss,
    trailingStopLossPct: num(p.trailingStopLossPct, 30),
    trailingStopLossSellPct: num(p.trailingStopLossSellPct, 100),
    migrationSell: !!p.migrationSell,
    migrationSellPct: num(p.migrationSellPct, 100),
    slippageBps: numU(p.slippageBps),
    transactionsFeeLamports: numU(p.transactionsFeeLamports),
  };
}

// ── Autobuy ───────────────────────────────────────────────────────────

export interface AutobuyPhaseDip { lossPct: number; buySol: number }
export interface AutobuyPhasePyramid { gainPct: number; buySol: number }

export interface AutobuyConfig {
  enabled: boolean;
  dipPhases: AutobuyPhaseDip[];
  pyramidPhases: AutobuyPhasePyramid[];
  trailingBuy: boolean;
  trailingBuyArmDropPct: number;
  trailingBuyRecoveryPct: number;
  trailingBuySol: number;
  maxTotalBuySol?: number;
  abortIfMcapAboveUsd?: number;
  abortIfLiquidityBelowSol?: number;
  pauseOnSlFire: boolean;
  slippageBps?: number;
  transactionsFeeLamports?: number;
}

export const EMPTY_AUTOBUY: AutobuyConfig = {
  enabled: false,
  dipPhases: [],
  pyramidPhases: [],
  trailingBuy: false,
  trailingBuyArmDropPct: 25,
  trailingBuyRecoveryPct: 10,
  trailingBuySol: 0.1,
  pauseOnSlFire: true,
};

export function parseAutobuyConfig(raw: unknown): AutobuyConfig {
  if (raw == null) return EMPTY_AUTOBUY;
  let p: Record<string, unknown>;
  if (typeof raw === "string") {
    try { p = JSON.parse(raw) as Record<string, unknown>; } catch { return EMPTY_AUTOBUY; }
  } else if (typeof raw === "object") {
    p = raw as Record<string, unknown>;
  } else {
    return EMPTY_AUTOBUY;
  }
  const num = (v: unknown, d: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const numU = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const phases = <T extends { buySol: number }>(arr: unknown, k: "lossPct" | "gainPct"): T[] => {
    if (!Array.isArray(arr)) return [];
    const out: T[] = [];
    for (const v of arr) {
      if (!v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      const t = numU(o[k]); const a = numU(o.buySol);
      if (t == null || a == null || a <= 0) continue;
      out.push({ [k]: t, buySol: a } as unknown as T);
    }
    return out;
  };
  return {
    enabled: !!p.enabled,
    dipPhases: phases<AutobuyPhaseDip>(p.dipPhases, "lossPct"),
    pyramidPhases: phases<AutobuyPhasePyramid>(p.pyramidPhases, "gainPct"),
    trailingBuy: !!p.trailingBuy,
    trailingBuyArmDropPct: num(p.trailingBuyArmDropPct, 25),
    trailingBuyRecoveryPct: num(p.trailingBuyRecoveryPct, 10),
    trailingBuySol: num(p.trailingBuySol, 0.1),
    maxTotalBuySol: numU(p.maxTotalBuySol),
    abortIfMcapAboveUsd: numU(p.abortIfMcapAboveUsd),
    abortIfLiquidityBelowSol: numU(p.abortIfLiquidityBelowSol),
    pauseOnSlFire: p.pauseOnSlFire == null ? true : !!p.pauseOnSlFire,
    slippageBps: numU(p.slippageBps),
    transactionsFeeLamports: numU(p.transactionsFeeLamports),
  };
}

export function useBackend() {
  const { region } = useRegion();
  return useMemo(() => {
    const session = readSession();
    return new BackendClient(region.baseUrl, session?.token);
  }, [region.baseUrl]);
}
