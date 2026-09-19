"use client";
// Provider + hooks for the X (Twitter) tracker. Wraps:
//   - the REST CRUD on /x/handles (list / add / remove)
//   - a per-region singleton XStreamClient that delivers live `tweet`
//     events for whichever handles a given UI surface is interested in
//
// Components want two things:
//   useXHandles()          → { handles, loading, add, remove, refresh }
//   useXTweetFeed(usernames) → live, prepended-on-top tweet timeline
//                              (REST backfill on mount, then WS deltas)

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { useRegion } from "../contexts/RegionContext";
import {
  BackendClient, readSession, useSession,
  type TrackedXHandle, type XTweet,
} from "../api/backend";
import { getXStream } from "../api/xstream";

interface Ctx {
  handles: TrackedXHandle[];
  loading: boolean;
  error: string | null;
  add: (username: string, walletId?: string) => Promise<void>;
  remove: (handleId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const XTrackerContext = createContext<Ctx | null>(null);

export function XTrackerProvider({ children }: { children: React.ReactNode }) {
  const { region } = useRegion();
  const session = useSession();
  const [handles, setHandles] = useState<TrackedXHandle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(
    () => session?.token ? new BackendClient(region.baseUrl, session.token) : null,
    [region.baseUrl, session?.token],
  );

  const refresh = useCallback(async () => {
    if (!client) { setHandles([]); return; }
    setLoading(true);
    try {
      const { handles } = await client.listXHandles();
      setHandles(handles);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { refresh(); }, [refresh]);

  const add = useCallback(async (username: string, walletId?: string) => {
    if (!client) throw new Error("not_authenticated");
    await client.addXHandle(username, walletId);
    await refresh();
  }, [client, refresh]);

  const remove = useCallback(async (handleId: string) => {
    if (!client) throw new Error("not_authenticated");
    await client.deleteXHandle(handleId);
    await refresh();
  }, [client, refresh]);

  return (
    <XTrackerContext.Provider value={{ handles, loading, error, add, remove, refresh }}>
      {children}
    </XTrackerContext.Provider>
  );
}

export function useXTracker(): Ctx {
  const v = useContext(XTrackerContext);
  if (!v) throw new Error("useXTracker must be used inside <XTrackerProvider>");
  return v;
}

export interface FeedTweet extends XTweet {
  username: string;
}

const FEED_LIMIT = 200;

/**
 * Live tweet feed for one or more handles. Mounts → REST backfill of the
 * cached tweets per handle, then upgrades to a WS subscription so new
 * tweets prepend in real-time. Re-runs the backfill if the handle list
 * changes.
 */
export function useXTweetFeed(usernames: string[]): {
  tweets: FeedTweet[];
  loading: boolean;
} {
  const { region } = useRegion();
  const session = useSession();
  const [tweets, setTweets] = useState<FeedTweet[]>([]);
  const [loading, setLoading] = useState(false);

  // Stabilize the dependency: callers usually pass a freshly-mapped array.
  const key = useMemo(
    () => [...usernames].map((u) => u.toLowerCase()).sort().join(","),
    [usernames],
  );

  // Backfill from /x/handles/:username/tweets on mount or when the
  // tracked set changes. Newly-added handles bring their cached recents
  // along instead of starting empty.
  useEffect(() => {
    if (!session?.token || !key) { setTweets([]); return; }
    const list = key.split(",").filter(Boolean);
    if (list.length === 0) { setTweets([]); return; }
    let cancelled = false;
    setLoading(true);
    const client = new BackendClient(region.baseUrl, session.token);
    Promise.all(list.map(async (u) => {
      try {
        const { tweets } = await client.xHandleTweets(u);
        return tweets.map((t) => ({ ...t, username: u } satisfies FeedTweet));
      } catch { return [] as FeedTweet[]; }
    })).then((batches) => {
      if (cancelled) return;
      const merged = batches.flat()
        .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
        .slice(0, FEED_LIMIT);
      setTweets(merged);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [region.baseUrl, session?.token, key]);

  // Live subscription. Stream client is per-(region,token) so multiple
  // hooks share one WS; ref-counts make the unsubscribe safe.
  useEffect(() => {
    if (!session?.token || !key) return;
    const list = key.split(",").filter(Boolean);
    if (list.length === 0) return;
    const stream = getXStream(region.baseUrl, session.token);
    for (const u of list) stream.subscribe(u);
    const off = stream.on(({ username, tweet }) => {
      if (!list.includes(username)) return;
      setTweets((prev) => {
        // Dedup: a tweet that arrived through both backfill and live
        // shouldn't show twice.
        if (prev.some((t) => t.tweetId === tweet.tweetId)) return prev;
        return [{ ...tweet, username }, ...prev].slice(0, FEED_LIMIT);
      });
    });
    return () => {
      off();
      for (const u of list) stream.unsubscribe(u);
    };
  }, [region.baseUrl, session?.token, key]);

  return { tweets, loading };
}
