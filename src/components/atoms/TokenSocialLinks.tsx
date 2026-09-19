import React from "react";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";
import { XLinkPreview } from "./XLinkPreview";
import { classifyXUrl, type XUrlInfo } from "../../lib/xUrl";
import { classifySocialUrl, type SocialPlatform } from "../../lib/socialUrl";
import { tweetAgeMinutesFromId, tweetFreshnessColor } from "../../lib/tweetAge";

interface TokenSocialLinksProps {
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
  /** Token mint — enables the launchpad + X-search links. */
  mint?: string | null;
  /** Deploy platform (token.dex) — resolves the launchpad coin-page URL. */
  launchpad?: string | null;
  /** Show the launchpad ("pill") link → the token's coin page. */
  showLaunchpad?: boolean;
  /** Show the X-search magnifier → x.com/search?q=<mint> (token page only). */
  showXSearch?: boolean;
  /** Optional node slotted right after the launchpad pill (Axiom order:
   *  launchpad → cashback → socials). Used by TokenHeader for the cashback icon. */
  cashbackSlot?: React.ReactNode;
  iconSize?: number;
  gap?: number;
  stopPropagation?: boolean;
}

// Map a token's deploy platform → its original launchpad coin page. pump.fun
// (incl. its migrated PumpSwap tokens, whose dex still reads "pump") resolves
// to pump.fun/coin/<mint>. Unknown launchpads return null — no link beats a
// wrong one; extend here as other launchpad URL shapes are confirmed.
function launchpadInfo(launchpad?: string | null, mint?: string | null): { url: string; label: string } | null {
  if (!mint) return null;
  const d = String(launchpad || "").toLowerCase();
  if (d.includes("pump")) return { url: `https://pump.fun/coin/${mint}`, label: "View on pump.fun" };
  return null;
}

const TELEGRAM_LABEL = "Telegram";

// Each token's `website` field can actually point at any platform (a GitHub
// repo, an Instagram, a Discord invite, …). We detect the platform from the
// URL and render its own logo — falling back to the globe for unknown hosts.
const PLATFORM_ICON: Record<SocialPlatform, (s: number) => React.ReactNode> = {
  x: Icon.xProfile,
  telegram: Icon.telegram,
  github: Icon.github,
  instagram: Icon.instagram,
  facebook: Icon.facebook,
  youtube: Icon.youtube,
  tiktok: Icon.tiktok,
  discord: Icon.discord,
  reddit: Icon.reddit,
  medium: Icon.medium,
  website: Icon.website,
};

// Pick the right X icon based on the URL kind so the user can see at a
// glance whether the link points at a tweet vs a profile vs a community —
// Axiom-style: quill = single tweet, user = X account, group = community.
function xIconFor(info: XUrlInfo, size: number): React.ReactNode {
  if (info.kind === "tweet") return Icon.quillPen(size);
  if (info.kind === "community" || info.kind === "list") return Icon.group3(size);
  return Icon.userLine(size);
}

// Per-kind color so the X link's type also reads by color. Tweets additionally
// shade green → orange → red by how long ago they were posted (from the ID).
function xColorFor(info: XUrlInfo): string {
  if (info.kind === "tweet") {
    return tweetFreshnessColor(tweetAgeMinutesFromId(info.tweetId));
  }
  if (info.kind === "community" || info.kind === "list") return "#4a9eed"; // community — blue
  return "#1d9bf0"; // X account — azure
}

function xAriaLabel(info: XUrlInfo): string {
  if (info.kind === "tweet") return "X post";
  if (info.kind === "community") return "X community";
  if (info.kind === "list") return "X list";
  return "X profile";
}

export function TokenSocialLinks({
  twitter,
  telegram,
  website,
  mint,
  launchpad,
  showLaunchpad = false,
  showXSearch = false,
  cashbackSlot,
  iconSize = 12,
  gap = 6,
  stopPropagation = false,
}: TokenSocialLinksProps) {
  const xInfo = twitter ? classifyXUrl(twitter) : null;

  const baseStyle: React.CSSProperties = {
    width: iconSize,
    height: iconSize,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    // brighter resting tone than --paper-3 so the icons read clearly
    color: "var(--paper-2)",
    transition: "color 120ms ease, opacity 120ms ease, transform 120ms ease",
  };
  const NEUTRAL_OPACITY = 0.92;

  const onMouseEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.style.color = "var(--paper)";
    e.currentTarget.style.opacity = "1";
    e.currentTarget.style.transform = "translateY(-1px)";
  };
  const onMouseLeave = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.style.color = "var(--paper-2)";
    e.currentTarget.style.opacity = String(NEUTRAL_OPACITY);
    e.currentTarget.style.transform = "translateY(0)";
  };

  // Hover for colored icons (the X link): keep the per-kind hue, just lift +
  // brighten so its color isn't clobbered back to neutral on hover.
  const onColorEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.style.opacity = "1";
    e.currentTarget.style.transform = "translateY(-1px)";
  };
  const onColorLeave = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.style.opacity = "0.9";
    e.currentTarget.style.transform = "translateY(0)";
  };

  const items: React.ReactNode[] = [];

  // Axiom order: launchpad pill first, then X / telegram / website, then search.
  const lp = showLaunchpad ? launchpadInfo(launchpad, mint) : null;
  if (lp) {
    items.push(
      <Tooltip key="lp" content={lp.label}>
        <a
          href={lp.url}
          target="_blank"
          rel="noreferrer"
          aria-label={lp.label}
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          style={{ ...baseStyle, opacity: NEUTRAL_OPACITY }}
        >
          {Icon.pill(iconSize)}
        </a>
      </Tooltip>,
    );
  }

  // Cashback icon slot — Axiom order: right after the launchpad pill.
  if (cashbackSlot) {
    items.push(<React.Fragment key="cashback">{cashbackSlot}</React.Fragment>);
  }

  if (xInfo) {
    const label = xAriaLabel(xInfo);
    items.push(
      <XLinkPreview key="x" info={xInfo} stopPropagation={stopPropagation}>
        <a
          href={xInfo.url}
          target="_blank"
          rel="noreferrer"
          aria-label={label}
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
          onMouseEnter={onColorEnter}
          onMouseLeave={onColorLeave}
          style={{ ...baseStyle, color: xColorFor(xInfo), opacity: 0.9 }}
        >
          {xIconFor(xInfo, iconSize)}
        </a>
      </XLinkPreview>,
    );
  }
  if (telegram) {
    items.push(
      <Tooltip key="tg" content={TELEGRAM_LABEL}>
        <a
          href={telegram}
          target="_blank"
          rel="noreferrer"
          aria-label={TELEGRAM_LABEL}
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          style={{ ...baseStyle, opacity: NEUTRAL_OPACITY }}
        >
          {Icon.telegram(iconSize)}
        </a>
      </Tooltip>,
    );
  }
  const webInfo = classifySocialUrl(website);
  if (webInfo) {
    // Avoid a duplicate glyph when the website field just repeats the
    // dedicated X / Telegram link the token already carries.
    const dupX = webInfo.platform === "x" && !!xInfo;
    const dupTelegram = webInfo.platform === "telegram" && !!telegram;
    if (!dupX && !dupTelegram) {
      items.push(
        <Tooltip key="web" content={webInfo.label}>
          <a
            href={webInfo.url}
            target="_blank"
            rel="noreferrer"
            aria-label={webInfo.label}
            onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            style={{ ...baseStyle, opacity: NEUTRAL_OPACITY }}
          >
            {PLATFORM_ICON[webInfo.platform](iconSize)}
          </a>
        </Tooltip>,
      );
    }
  }

  if (showXSearch && mint) {
    items.push(
      <Tooltip key="xsearch" content="Search on X">
        <a
          href={`https://x.com/search?q=${encodeURIComponent(mint)}`}
          target="_blank"
          rel="noreferrer"
          aria-label="Search on X"
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          style={{ ...baseStyle, opacity: NEUTRAL_OPACITY }}
        >
          {Icon.searchLine(iconSize)}
        </a>
      </Tooltip>,
    );
  }

  if (items.length === 0) return null;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap }}>
      {items}
    </div>
  );
}
