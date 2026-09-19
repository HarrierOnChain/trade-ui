// Classify an x.com / twitter.com URL so the UI can pick the right icon
// and render a useful preview popup. The token feed only stores raw URLs
// (token.twitter), but the same field can point at a profile, a single
// tweet, or an X community — each warrants different affordances.

export type XUrlKind = "profile" | "tweet" | "community" | "search" | "list" | "other";

export interface XUrlInfo {
  kind: XUrlKind;
  url: string;
  username: string | null;
  tweetId: string | null;
  communityId: string | null;
  listId: string | null;
}

const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const NUMERIC_ID_RE = /^[0-9]{5,25}$/;
// Path segments X uses for app surfaces, not user handles. A path like
// `x.com/i/communities/123` must not be mistaken for "@i".
const RESERVED_HANDLES = new Set([
  "i", "home", "explore", "notifications", "messages", "compose",
  "search", "settings", "login", "signup", "share", "intent", "hashtag",
]);

function isXHost(host: string): boolean {
  return /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(host);
}

export function classifyXUrl(raw?: string | null): XUrlInfo | null {
  const value = raw?.trim();
  if (!value) return null;

  // Bare handles like "@foo" or "foo" — common in the metadata field.
  const bare = value.replace(/^@/, "");
  if (USERNAME_RE.test(bare)) {
    const username = bare.toLowerCase();
    return {
      kind: "profile",
      url: `https://x.com/${username}`,
      username,
      tweetId: null,
      communityId: null,
      listId: null,
    };
  }

  let url: URL;
  try {
    url = new URL(value.startsWith("http") ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!isXHost(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const baseUrl = `https://x.com${url.pathname}`;

  if (segments.length === 0) {
    return { kind: "other", url: baseUrl, username: null, tweetId: null, communityId: null, listId: null };
  }

  const [first, second, third] = segments;

  // /i/communities/<id> and /i/lists/<id>
  if (first === "i") {
    if (second === "communities" && third && NUMERIC_ID_RE.test(third)) {
      return { kind: "community", url: baseUrl, username: null, tweetId: null, communityId: third, listId: null };
    }
    if (second === "lists" && third && NUMERIC_ID_RE.test(third)) {
      return { kind: "list", url: baseUrl, username: null, tweetId: null, communityId: null, listId: third };
    }
    return { kind: "other", url: baseUrl, username: null, tweetId: null, communityId: null, listId: null };
  }

  if (first === "search" || first === "hashtag" || first === "explore") {
    return { kind: "search", url: baseUrl, username: null, tweetId: null, communityId: null, listId: null };
  }

  if (RESERVED_HANDLES.has(first)) {
    return { kind: "other", url: baseUrl, username: null, tweetId: null, communityId: null, listId: null };
  }

  if (!USERNAME_RE.test(first)) {
    return { kind: "other", url: baseUrl, username: null, tweetId: null, communityId: null, listId: null };
  }

  const username = first.toLowerCase();

  // /<user>/status/<tweetId> — also accept /statuses/ (legacy) and trailing /photo|/video/n.
  if ((second === "status" || second === "statuses") && third && NUMERIC_ID_RE.test(third)) {
    return {
      kind: "tweet",
      url: `https://x.com/${username}/status/${third}`,
      username,
      tweetId: third,
      communityId: null,
      listId: null,
    };
  }

  // Bare /<user> or /<user>/with_replies, /media etc. — still a profile.
  return {
    kind: "profile",
    url: `https://x.com/${username}`,
    username,
    tweetId: null,
    communityId: null,
    listId: null,
  };
}
