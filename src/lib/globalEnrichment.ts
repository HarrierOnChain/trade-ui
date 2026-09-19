/** Cross-column dedup so 3 monitor columns don't triple-fetch the same mint. */

const mintStats = new Set<string>();
const mintMeta = new Set<string>();
const signers = new Set<string>();

export function resetEnrichmentClaims(): void {
  mintStats.clear();
  mintMeta.clear();
  signers.clear();
}

export function claimMintStats(mint: string): boolean {
  if (!mint || mintStats.has(mint)) return false;
  mintStats.add(mint);
  return true;
}

export function claimMintMeta(mint: string): boolean {
  if (!mint || mintMeta.has(mint)) return false;
  mintMeta.add(mint);
  return true;
}

export function claimSignerCounts(signer: string): boolean {
  if (!signer || signers.has(signer)) return false;
  signers.add(signer);
  return true;
}
