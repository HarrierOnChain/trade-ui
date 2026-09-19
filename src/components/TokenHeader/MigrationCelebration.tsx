"use client";

// Thin wrapper around CelebrationOverlay for a live migration event
// (pump.fun → PumpSwap). Fires when useMigration stamps `liveMigratedAt`.

import { CelebrationOverlay, type ReserveSidePanel } from "./CelebrationOverlay";

interface Props {
  triggerAt: number;
  symbol?: string;
  name?: string;
  image?: string;
  /** "PumpSwap" / etc. — appears in the tagline. */
  poolDex?: string | null;
  /** Chain slug — drives the DexScreener URL. */
  chainSlug: string;
  /** Mint / token address for the DexScreener CTA. */
  mint: string;
  reserveSidePanel?: ReserveSidePanel;
}

// `chainSlug` matches DexScreener's URL convention. Solana uses "solana"
// (the chains lib stores it as "sol" internally).
export function MigrationCelebration({
  triggerAt,
  symbol,
  name,
  image,
  poolDex,
  chainSlug,
  mint,
  reserveSidePanel,
}: Props) {
  const dex = poolDex?.trim();
  const tagline = dex
    ? `Bonding curve complete — now trading on ${dex}.`
    : "Bonding curve complete — now trading on a public DEX.";

  // Migration confetti leans a touch more electric (purple/cyan/gold) over
  // the brand green, to differentiate the moment from the dex-paid one.
  return (
    <CelebrationOverlay
      triggerAt={triggerAt}
      reserveSidePanel={reserveSidePanel}
      title="Migrated"
      tagline={tagline}
      symbol={symbol}
      name={name}
      image={image}
      cta={{
        label: "View Pool on DexScreener →",
        href: `https://dexscreener.com/${chainSlug}/${mint}`,
      }}
      confettiColors={["#3DD96F", "#3DD96F", "#FFD15C", "#5CC8FF", "#A78BFA", "#FF6FB5"]}
      ariaLabel="Migration celebration"
    />
  );
}
