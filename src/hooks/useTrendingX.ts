"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackendClient, useSession, type XTrendingKol, type XTrendingTweet, type XTweet } from "../api/backend";
import { getXStream } from "../api/xstream";
import { useRegion } from "../contexts/RegionContext";
import { attachTokenMatches, buildTokenXSignals, type TokenXSignal, type XTweetWithMatches } from "../lib/xTrending";
import type { TokenEvent } from "../types";

const FEED_LIMIT = 80;

export function useTrendingX(tokens: TokenEvent[]): {
  kols: XTrendingKol[];
  tweets: XTweetWithMatches[];
  signals: Map<string, TokenXSignal>;
  loading: boolean;
  error: string | null;
} {
  const { region } = useRegion();
  const session = useSession();
  const [kols, setKols] = useState<XTrendingKol[]>([]);
  const [tweets, setTweets] = useState<XTrendingTweet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(
    () => session?.token ? new BackendClient(region.baseUrl, session.token) : null,
    [region.baseUrl, session?.token],
  );

  const loadBackfill = useCallback(async () => {
    if (!client) {
      setKols([]);
      setTweets([]);
      return;
    }
    setLoading(true);
    try {
      const res = await client.xTrendingKolTweets(40);
      setKols(res.kols);
      setTweets(res.tweets);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    loadBackfill();
  }, [loadBackfill]);

  const kolsKey = useMemo(
    () => kols.map((kol) => kol.handle.toLowerCase()).sort().join(","),
    [kols],
  );

  useEffect(() => {
    if (!session?.token || !kolsKey) return;
    const handles = kolsKey.split(",").filter(Boolean);
    if (handles.length === 0) return;

    const kolByHandle = new Map(kols.map((kol) => [kol.handle.toLowerCase(), kol]));
    const stream = getXStream(region.baseUrl, session.token);
    for (const handle of handles) stream.subscribe(handle);

    const off = stream.on(({ username, tweet }) => {
      if (!handles.includes(username)) return;
      const next = liveTweetToTrending(username, tweet, kolByHandle.get(username));
      setTweets((prev) => {
        if (prev.some((item) => item.tweetId === next.tweetId)) return prev;
        return [next, ...prev]
          .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
          .slice(0, FEED_LIMIT);
      });
    });

    return () => {
      off();
      for (const handle of handles) stream.unsubscribe(handle);
    };
  }, [kols, kolsKey, region.baseUrl, session?.token]);

  const matchedTweets = useMemo(
    () => attachTokenMatches(tweets, tokens),
    [tweets, tokens],
  );

  const signals = useMemo(
    () => buildTokenXSignals(tokens, matchedTweets),
    [tokens, matchedTweets],
  );

  return { kols, tweets: matchedTweets, signals, loading, error };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function authorFromPayload(payload: unknown): Record<string, unknown> {
  const obj = asRecord(payload);
  return asRecord(obj.author);
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function pickBool(obj: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
  }
  return false;
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function liveTweetToTrending(
  username: string,
  tweet: XTweet,
  kol?: XTrendingKol,
): XTrendingTweet {
  const payload = asRecord(tweet.payload);
  const author = authorFromPayload(tweet.payload);
  return {
    tweetId: tweet.tweetId,
    text: tweet.text,
    postedAt: tweet.postedAt,
    author: {
      username,
      displayName: pickString(author, "name", "display_name") ?? kol?.displayName ?? null,
      avatarUrl: pickString(author, "profile_image", "profile_image_url_https", "profile_image_url", "avatar") ?? kol?.avatarUrl ?? null,
      verified: pickBool(author, "is_blue_verified", "verified", "is_verified", "blue_verified") || kol?.verified === true,
      followersCount: pickNumber(author, "followers_count", "followers", "followersCount"),
      label: kol?.label ?? "KOL",
      tier: kol?.tier ?? "medium",
      tags: kol?.tags ?? [],
    },
    engagement: {
      views: pickNumber(payload, "view_count", "views", "views_count"),
      likes: pickNumber(payload, "like_count", "favorite_count", "likes"),
      replies: pickNumber(payload, "reply_count", "replies"),
      retweets: pickNumber(payload, "retweet_count", "retweets"),
      quotes: pickNumber(payload, "quote_count", "quotes"),
      bookmarks: pickNumber(payload, "bookmark_count", "bookmarks"),
    },
  };
}
