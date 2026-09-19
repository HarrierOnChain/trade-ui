import React from "react";
import {
  PLATFORM_FAMILY,
  PLATFORM_ICONS,
} from "../../lib/launchpadPlatforms.generated";

interface Props {
  platform?: string | null;
  size?: number;
  className?: string;
}

function normalizeBrand(platform?: string | null): string {
  return String(platform || "").trim();
}

function platformLogoSrc(platform?: string | null): string | null {
  const raw = normalizeBrand(platform);
  if (!raw) return null;

  // Exact brand match (case-insensitive) against curated icon map.
  const exact = Object.entries(PLATFORM_ICONS).find(
    ([brand]) => brand.toLowerCase() === raw.toLowerCase(),
  );
  if (exact) return `/platforms/${exact[1]}`;

  const value = raw.toLowerCase();
  // Substring aliases for deploy wizard / loose labels ("pumpfun", "letsbonk", …).
  // "pumpswap" contains "pump", so it MUST be checked before the generic pump branch.
  if (value.includes("pumpswap")) return `/platforms/${PLATFORM_ICONS.PumpSwap}`;
  if (value.includes("mayhem")) return `/platforms/${PLATFORM_ICONS.Mayhem}`;
  if (value.includes("pump")) return `/platforms/${PLATFORM_ICONS.Pumpfun}`;
  if (value.includes("bonkers")) return `/platforms/${PLATFORM_ICONS.Bonkers}`;
  if (value.includes("bonk") || value.includes("letsbonk")) {
    return `/platforms/${PLATFORM_ICONS.LetsBonk}`;
  }
  if (value.includes("bags")) return `/platforms/${PLATFORM_ICONS.Bags}`;
  if (value.includes("believe")) return `/platforms/${PLATFORM_ICONS.Believe}`;
  if (value.includes("jupiterstudio") || value.includes("jupstudio")) {
    return `/platforms/${PLATFORM_ICONS.JupiterStudio}`;
  }
  if (value.includes("moonshot")) return `/platforms/${PLATFORM_ICONS.Moonshot}`;
  if (value.includes("moon")) return `/platforms/${PLATFORM_ICONS.Moonit}`;
  if (value.includes("heaven")) return `/platforms/${PLATFORM_ICONS.Heaven}`;
  if (value.includes("boop")) return `/platforms/${PLATFORM_ICONS.Boopfun}`;
  if (value.includes("sugar")) return `/platforms/${PLATFORM_ICONS.Sugar}`;
  if (value.includes("zora")) return `/platforms/${PLATFORM_ICONS.ZoraSolana}`;
  if (value.includes("tokenmill")) return `/platforms/${PLATFORM_ICONS.TokenMillV2}`;
  if (value.includes("fourmeme") || value.includes("four.meme")) return `/platforms/fourmeme.svg`;
  if (value.includes("flap")) return `/platforms/flap.svg`;
  if (value.includes("pons")) return `/platforms/${PLATFORM_ICONS.Pons}`;
  if (value.includes("uniswap")) return `/platforms/uniswap.svg`;
  if (value.includes("clanker")) return `/platforms/clanker.svg`;
  if (value.includes("hood.fun") || value.includes("hoodfun")) return `/platforms/hoodfun.svg`;
  if (value.includes("printr")) return `/platforms/printr.svg`;
  if (value.includes("bankr")) return `/platforms/${PLATFORM_ICONS.Bankr}`;
  if (value.includes("raydium") || value.includes("launchlab")) {
    return `/platforms/${PLATFORM_ICONS.RaydiumLaunchpad}`;
  }
  if (value.includes("meteora")) return `/platforms/${PLATFORM_ICONS.MeteoraDBC}`;

  const family = Object.entries(PLATFORM_FAMILY).find(
    ([brand]) => brand.toLowerCase() === value,
  )?.[1];
  if (family && PLATFORM_ICONS[family]) {
    return `/platforms/${PLATFORM_ICONS[family]}`;
  }
  if (family?.toLowerCase().includes("meteora")) {
    return `/platforms/${PLATFORM_ICONS.MeteoraDBC}`;
  }
  if (family?.toLowerCase().includes("raydium")) {
    return `/platforms/${PLATFORM_ICONS.RaydiumLaunchpad}`;
  }
  return null;
}

export function PlatformLogo({ platform, size = 14, className }: Props) {
  const src = platformLogoSrc(platform);
  if (!src) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        display: "block",
        flexShrink: 0,
        objectFit: "contain",
        objectPosition: "center",
      }}
    />
  );
}
