// Shared "deploy draft" channel between the Create-Token wizard (DeployModal)
// and the /deploy page form. The wizard configures a launch and, on Apply,
// pushes a draft here; the /deploy page listens (and drains any pending draft
// on mount) and hydrates its own form state so the user can still tweak the
// values inline and launch with the page's own button.
import type { MmDraft } from "../app/automation/_components/automode";
import type { CleanDraft } from "../app/automation/_components/autoClean";

export interface DeployDraftExtra {
  bonkType: "standard" | "bonkers" | "stonk";
  configAddress: string;
  initLiqSol: string;
  initTokenPct: string;
  agentEnabled: boolean;
  agentBuybackPct: number;
  shareEnabled: boolean;
  recipients: Array<{ address: string; pct: string }>;
  charityEnabled: boolean;
  charities: Array<{ id: string; name: string; logo: string | null; city: string | null; state: string | null }>;
  charityPct: number;
}

export interface DeployDraft {
  tokenData: { name: string; symbol: string; description: string; imageUrl: string; twitter: string; telegram: string; website: string };
  platform: "pumpfun" | "raydium" | "meteora";
  quote: "SOL" | "USDC";
  pumpType: boolean;
  holderReward: boolean;
  jitoTipSol: string;
  slippageBps: string;
  sendMode: "bundle" | "stagger";
  staggerMinSec: string;
  staggerMaxSec: string;
  extra: DeployDraftExtra;
  /** Buyer wallet picks (id resolved against the page's PLATFORM wallets). */
  walletAllocs: Array<{ id: string; address: string; label: string; amount: string; source: "SOL" | "USDC" }>;
  mmDrafts: MmDraft[];
  cleanDrafts: CleanDraft[];
}

export const DEPLOY_DRAFT_EVENT = "spool:deploy-draft";

let pending: DeployDraft | null = null;

/** Push a draft from the wizard. Fires an event for a mounted /deploy page and
 *  parks it as `pending` so a page that mounts right after still picks it up. */
export function setDeployDraft(draft: DeployDraft): void {
  pending = draft;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<DeployDraft>(DEPLOY_DRAFT_EVENT, { detail: draft }));
  }
}

/** Drain the pending draft (returns it once, then clears). */
export function consumeDeployDraft(): DeployDraft | null {
  const d = pending;
  pending = null;
  return d;
}

// ── Clone seed ─────────────────────────────────────────────────────────────
// Lighter channel used by the "Clone token" DNA action: it seeds only the
// metadata so the Create-Token wizard opens pre-filled (name/symbol/desc/image
// + socials) and the user picks a launchpad + options for the relaunch.
export interface CloneSeed {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  twitter: string;
  telegram: string;
  website: string;
}

/** Fired by setCloneSeed so an ALREADY-MOUNTED deploy wizard (navigate didn't
 *  remount it — the /deploy Next route was already live) picks the seed up. */
export const CLONE_SEED_EVENT = "spool:clone-seed";

let pendingClone: CloneSeed | null = null;

export function setCloneSeed(seed: CloneSeed): void {
  pendingClone = seed;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CLONE_SEED_EVENT));
}

/** Drain the pending clone seed (returns it once, then clears). Read by the
 *  DeployModal wizard's `tokenData` initializer on a fresh mount. */
export function consumeCloneSeed(): CloneSeed | null {
  const s = pendingClone;
  pendingClone = null;
  return s;
}

/** Non-clearing read (for the already-mounted event path + the reset guard). */
export function peekCloneSeed(): CloneSeed | null {
  return pendingClone;
}
export function hasPendingClone(): boolean {
  return pendingClone !== null;
}
export function clearCloneSeed(): void {
  pendingClone = null;
}
