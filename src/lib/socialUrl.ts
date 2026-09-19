// Classify a token's "website" link (or any generic social URL) into a known
// platform so the UI can swap the generic globe glyph for the platform's own
// logo — mirroring how Axiom previews every link attached to a token.
//
// The token feed only carries three flat fields (website/twitter/telegram),
// but in practice the `website` field is where devs drop a GitHub repo, an
// Instagram, a Discord invite, a Linktree, etc. This maps the host to a
// platform so we render the right icon instead of a generic globe.

export type SocialPlatform =
  | "x"
  | "telegram"
  | "github"
  | "instagram"
  | "facebook"
  | "youtube"
  | "tiktok"
  | "discord"
  | "reddit"
  | "medium"
  | "website";

export interface SocialLinkInfo {
  /** Detected platform, or "website" when the host is not recognized. */
  platform: SocialPlatform;
  /** Normalized href — always carries an http(s) protocol. */
  url: string;
  /** Human label for tooltip / aria-label. */
  label: string;
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  x: "X",
  telegram: "Telegram",
  github: "GitHub",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
  discord: "Discord",
  reddit: "Reddit",
  medium: "Medium",
  website: "Website",
};

// hostname → platform. Matched against the URL host with any leading "www."
// stripped, using an exact-or-suffix test so subdomains resolve too
// (m.facebook.com, vm.tiktok.com, foo.medium.com → facebook/tiktok/medium).
const HOST_RULES: ReadonlyArray<readonly [string, SocialPlatform]> = [
  ["x.com", "x"],
  ["twitter.com", "x"],
  ["t.me", "telegram"],
  ["telegram.me", "telegram"],
  ["telegram.org", "telegram"],
  ["telegram.dog", "telegram"],
  ["github.com", "github"],
  ["instagram.com", "instagram"],
  ["instagr.am", "instagram"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["fb.me", "facebook"],
  ["fb.watch", "facebook"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["tiktok.com", "tiktok"],
  ["discord.com", "discord"],
  ["discord.gg", "discord"],
  ["discordapp.com", "discord"],
  ["reddit.com", "reddit"],
  ["redd.it", "reddit"],
  ["medium.com", "medium"],
];

function platformForHost(host: string): SocialPlatform {
  const h = host.replace(/^www\./i, "").toLowerCase();
  for (const [suffix, platform] of HOST_RULES) {
    if (h === suffix || h.endsWith(`.${suffix}`)) return platform;
  }
  return "website";
}

/**
 * Classify a raw social/website URL. Returns `null` for empty/unparseable
 * values or non-http(s) schemes (which are not safe to open in a new tab).
 */
export function classifySocialUrl(raw?: string | null): SocialLinkInfo | null {
  const value = raw?.trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const platform = platformForHost(url.hostname);
  return { platform, url: url.toString(), label: PLATFORM_LABELS[platform] };
}
