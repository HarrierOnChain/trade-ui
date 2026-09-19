"use client";

// Thin wrapper around CelebrationOverlay for the DexScreener "Enhanced Token
// Info" paid moment. Fires when useDexPaid stamps `liveFlipAt` (WS-only —
// opening a page on an already-paid token stays quiet).

import { CelebrationOverlay, type ReserveSidePanel } from "./CelebrationOverlay";

interface Props {
  triggerAt: number;
  symbol?: string;
  name?: string;
  image?: string;
  dexscreenerUrl?: string;
  reserveSidePanel?: ReserveSidePanel;
}

export function DexPaidCelebration({
  triggerAt,
  symbol,
  name,
  image,
  dexscreenerUrl,
  reserveSidePanel,
}: Props) {
  return (
    <CelebrationOverlay
      triggerAt={triggerAt}
      reserveSidePanel={reserveSidePanel}
      title="DEX Paid"
      tagline="Just received DexScreener Enhanced Token Info live."
      symbol={symbol}
      name={name}
      image={image}
      cta={
        dexscreenerUrl
          ? { label: "View on DexScreener →", href: dexscreenerUrl }
          : undefined
      }
      ariaLabel="DEX Paid celebration"
    />
  );
}
