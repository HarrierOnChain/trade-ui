import type { XTrendingTweet } from "../api/backend";
import type { TokenEvent } from "../types";

export interface TweetTokenMatch {
  mint: string;
  symbol: string;
  name: string;
  reason: "mint" | "symbol" | "name" | "official";
}

export interface XTweetWithMatches extends XTrendingTweet {
  matches: TweetTokenMatch[];
}

export interface TokenXSignal {
  officialUsername: string | null;
  mentionCount15m: number;
  mentionCount1h: number;
  mentionCount24h: number;
  /** Tweets in the last 24h whose body contained the full mint address. */
  caMentionCount24h: number;
  kolCount24h: number;
  hot: boolean;
  topTweet: {
    username: string;
    text: string;
    postedAt: string;
    tweetId: string;
  } | null;
}

const STOP_SYMBOLS = new Set([
  "AI",
  "BTC",
  "ETH",
  "SOL",
  "USD",
  "USDC",
  "USDT",
  "THE",
  "X",
]);

export function extractXUsername(raw?: string | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const bare = value.replace(/^@/, "");
  if (/^[A-Za-z0-9_]{1,15}$/.test(bare)) return bare.toLowerCase();
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(url.hostname)) return null;
    const first = url.pathname.split("/").filter(Boolean)[0];
    if (first && /^[A-Za-z0-9_]{1,15}$/.test(first)) return first.toLowerCase();
  } catch {
    return null;
  }
  return null;
}

function normalizeWord(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTokenBoundary(text: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = escapeRegex(needle.toLowerCase());
  return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, "i").test(text);
}

function hasCashtag(text: string, symbol: string): boolean {
  const trimmed = symbol.trim();
  if (!/^[A-Za-z0-9_]{2,16}$/.test(trimmed)) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])\\$${escapeRegex(trimmed)}([^A-Za-z0-9_]|$)`, "i").test(text);
}

function hasUppercaseTicker(text: string, symbol: string): boolean {
  const upper = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9_]{3,12}$/.test(upper)) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(upper)}([^A-Za-z0-9_]|$)`).test(text);
}

function hasSymbolMatch(text: string, symbol: string): boolean {
  return hasCashtag(text, symbol) || hasUppercaseTicker(text, symbol);
}

function hasNameMatch(textLower: string, name: string): boolean {
  const trimmed = name.trim();
  // Single-word names like LIFE, TIME, CAT, etc. collide constantly with
  // normal prose. Let the symbol/cashtag path handle those instead.
  if (!/\s/.test(trimmed)) return false;
  return hasTokenBoundary(textLower, normalizeWord(trimmed));
}

function tokenSymbol(token: TokenEvent): string {
  return token.symbol?.trim() || token.name?.trim() || "";
}

function tokenName(token: TokenEvent): string {
  return token.name?.trim() || "";
}

function tweetScore(tweet: XTrendingTweet): number {
  const e = tweet.engagement;
  return (
    (e.views ?? 0) * 0.01 +
    (e.likes ?? 0) * 2 +
    (e.retweets ?? 0) * 4 +
    (e.replies ?? 0) * 3 +
    (e.quotes ?? 0) * 4 +
    (e.bookmarks ?? 0) * 2
  );
}

export function attachTokenMatches(
  tweets: XTrendingTweet[],
  tokens: TokenEvent[],
): XTweetWithMatches[] {
  const tokenInputs = tokens.map((token) => {
    const symbol = tokenSymbol(token);
    const name = tokenName(token);
    return {
      token,
      mint: token.mint_address,
      symbol,
      name,
      symbolNorm: normalizeWord(symbol),
      nameNorm: normalizeWord(name),
      officialUsername: extractXUsername(token.twitter),
    };
  });

  return tweets.map((tweet) => {
    const rawText = `${tweet.text} @${tweet.author.username}`;
    const text = rawText.toLowerCase();
    const matches: TweetTokenMatch[] = [];
    const seen = new Set<string>();

    for (const input of tokenInputs) {
      if (!input.mint || seen.has(input.mint)) continue;

      let reason: TweetTokenMatch["reason"] | null = null;
      if (input.mint.length > 20 && text.includes(input.mint.toLowerCase())) {
        reason = "mint";
      } else if (
        input.officialUsername &&
        (tweet.author.username.toLowerCase() === input.officialUsername ||
          hasTokenBoundary(text, `@${input.officialUsername}`))
      ) {
        reason = "official";
      } else if (
        input.symbolNorm.length >= 3 &&
        !STOP_SYMBOLS.has(input.symbolNorm.toUpperCase()) &&
        hasSymbolMatch(rawText, input.symbol)
      ) {
        reason = "symbol";
      } else if (
        input.nameNorm.length >= 4 &&
        !STOP_SYMBOLS.has(input.nameNorm.toUpperCase()) &&
        hasNameMatch(text, input.name)
      ) {
        reason = "name";
      }

      if (reason) {
        seen.add(input.mint);
        matches.push({
          mint: input.mint,
          symbol: input.symbol || input.name || input.mint.slice(0, 4),
          name: input.name,
          reason,
        });
      }
    }

    return { ...tweet, matches };
  });
}

export function buildTokenXSignals(
  tokens: TokenEvent[],
  tweets: XTweetWithMatches[],
): Map<string, TokenXSignal> {
  const now = Date.now();
  const signals = new Map<string, TokenXSignal>();
  for (const token of tokens) {
    const officialUsername = extractXUsername(token.twitter);
    if (officialUsername) {
      signals.set(token.mint_address, {
        officialUsername,
        mentionCount15m: 0,
        mentionCount1h: 0,
        mentionCount24h: 0,
        caMentionCount24h: 0,
        kolCount24h: 0,
        hot: false,
        topTweet: null,
      });
    }
  }

  const authors24h = new Map<string, Set<string>>();
  const topScores = new Map<string, number>();

  for (const tweet of tweets) {
    const age = now - Date.parse(tweet.postedAt);
    if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) continue;

    for (const match of tweet.matches) {
      const signal = signals.get(match.mint) ?? {
        officialUsername: extractXUsername(tokens.find((t) => t.mint_address === match.mint)?.twitter),
        mentionCount15m: 0,
        mentionCount1h: 0,
        mentionCount24h: 0,
        caMentionCount24h: 0,
        kolCount24h: 0,
        hot: false,
        topTweet: null,
      };

      signal.mentionCount24h += 1;
      if (match.reason === "mint") signal.caMentionCount24h += 1;
      if (age <= 60 * 60 * 1000) signal.mentionCount1h += 1;
      if (age <= 15 * 60 * 1000) signal.mentionCount15m += 1;

      const authors = authors24h.get(match.mint) ?? new Set<string>();
      authors.add(tweet.author.username);
      authors24h.set(match.mint, authors);
      signal.kolCount24h = authors.size;

      const score = tweetScore(tweet);
      if (score > (topScores.get(match.mint) ?? -1)) {
        topScores.set(match.mint, score);
        signal.topTweet = {
          username: tweet.author.username,
          text: tweet.text,
          postedAt: tweet.postedAt,
          tweetId: tweet.tweetId,
        };
      }

      signal.hot = signal.mentionCount15m >= 2 || signal.mentionCount1h >= 4;
      signals.set(match.mint, signal);
    }
  }

  return signals;
}
