import React from "react";
import { dexColor } from "../../lib/format";
import { PlatformLogo } from "./PlatformLogo";
import { TokenIcon } from "./TokenIcon";
import { Tooltip } from "./Tooltip";

interface Props {
  mint: string;
  symbol?: string;
  image?: string | null;
  chain?: string;
  dex?: string | null;
  migrated?: boolean;
  size?: number;
  borderWidth?: number;
  badgeSize?: number;
  badgeInset?: number;
  /** Bonding-curve fill from the API (0–100), every launchpad's; an empty
   *  ring when the API has none. */
  progressPercent?: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function TokenAvatarFrame({
  mint,
  symbol,
  image,
  chain,
  dex,
  migrated = false,
  size = 54,
  borderWidth = 1.5,
  badgeSize = 18,
  badgeInset = -4,
  progressPercent,
}: Props) {
  const color = migrated
    ? "var(--gold)"
    : dex
      ? dexColor(dex)
      : "var(--line)";

  // pump.fun tokens migrate to PumpSwap, but the feed keeps dex = the deploy
  // platform ("pumpfun"). Once migrated, the badge should read PumpSwap.
  const badgePlatform =
    migrated && /pump/i.test(String(dex ?? "")) ? "pumpswap" : dex;

  const progress =
    migrated
      ? 1
      : progressPercent != null && Number.isFinite(progressPercent)
        ? clamp(progressPercent / 100)
        : 0;

  const outerRadius = Math.round(size * 0.22);
  const innerRadius = Math.max(outerRadius - borderWidth, outerRadius - 2);
  const outerSize = size + borderWidth * 2;
  const badgeLogoSize = Math.max(9, Math.round(badgeSize * 0.68));
  const strokeInset = borderWidth / 2;
  const strokeRadius = Math.max(outerRadius - strokeInset, 1);
  const strokePath = [
    `M ${strokeInset + strokeRadius} ${strokeInset}`,
    `H ${outerSize - strokeInset - strokeRadius}`,
    `A ${strokeRadius} ${strokeRadius} 0 0 1 ${outerSize - strokeInset} ${strokeInset + strokeRadius}`,
    `V ${outerSize - strokeInset - strokeRadius}`,
    `A ${strokeRadius} ${strokeRadius} 0 0 1 ${outerSize - strokeInset - strokeRadius} ${outerSize - strokeInset}`,
    `H ${strokeInset + strokeRadius}`,
    `A ${strokeRadius} ${strokeRadius} 0 0 1 ${strokeInset} ${outerSize - strokeInset - strokeRadius}`,
    `V ${strokeInset + strokeRadius}`,
    `A ${strokeRadius} ${strokeRadius} 0 0 1 ${strokeInset + strokeRadius} ${strokeInset}`,
  ].join(" ");

  const ringBackground = migrated
    ? "linear-gradient(135deg, color-mix(in oklch, var(--gold) 82%, white), var(--gold), color-mix(in oklch, var(--gold) 68%, black))"
    : `linear-gradient(135deg, color-mix(in oklch, ${color} 32%, transparent), color-mix(in oklch, ${color} 12%, var(--line-soft)))`;

  const ringShadow = migrated
    ? "0 0 12px -4px var(--gold-d), inset 0 0 0 1px color-mix(in oklch, var(--gold) 15%, transparent)"
    : `0 0 10px -4px ${color}, inset 0 0 0 1px color-mix(in oklch, ${color} 18%, transparent)`;

  return (
    <div
      style={{
        position: "relative",
        width: size + borderWidth * 2,
        height: size + borderWidth * 2,
        flexShrink: 0,
      }}
    >
      <div
        style={{
        width: "100%",
        height: "100%",
        padding: borderWidth,
        borderRadius: outerRadius,
        background: ringBackground,
        boxShadow: ringShadow,
        position: "relative",
      }}
    >
        {!migrated && (
          <svg
            width={outerSize}
            height={outerSize}
            viewBox={`0 0 ${outerSize} ${outerSize}`}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
            aria-hidden="true"
          >
            <path
              d={strokePath}
              fill="none"
              stroke={`color-mix(in oklch, ${color} 22%, var(--line-soft))`}
              strokeWidth={borderWidth}
              pathLength={100}
            />
            {progress > 0 && (
              <path
                d={strokePath}
                fill="none"
                stroke={color}
                strokeWidth={borderWidth}
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={`${progress * 100} 100`}
              />
            )}
          </svg>
        )}
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: innerRadius,
            overflow: "hidden",
            background: "var(--ink-1)",
            lineHeight: 0,
          }}
        >
          <TokenIcon
            token={{ mint_address: mint, symbol, image, chain }}
            size={size}
          />
        </div>
      </div>
      {dex && (
        <Tooltip content={badgePlatform}>
          <span
            style={{
              position: "absolute",
              left: badgeInset,
              top: badgeInset,
              width: badgeSize,
              height: badgeSize,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--ink-0)",
              border: `1px solid ${migrated ? "color-mix(in oklch, var(--gold) 60%, transparent)" : color}`,
              borderRadius: 999,
              boxShadow: "0 0 0 2px var(--ink-1), 0 2px 6px rgba(0,0,0,0.35)",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                width: badgeLogoSize,
                height: badgeLogoSize,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PlatformLogo platform={badgePlatform} size={badgeLogoSize} />
            </span>
          </span>
        </Tooltip>
      )}
    </div>
  );
}
