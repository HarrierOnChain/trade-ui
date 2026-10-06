"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BackendClient, readSession } from "../api/backend";
import { getXStream } from "../api/xstream";
import { useApp } from "./AppContext";
import { useRegion } from "./RegionContext";
import { useXTracker } from "../hooks/useXTracker";
import { useNotifTweetAlerts } from "../hooks/useNotifPrefs";
import { readWatchlist, WATCHLIST_STORAGE_KEY } from "../lib/trackerWallets";
import { readMutedWallets, MUTED_WALLETS_KEY } from "../lib/mutedAlerts";
import {
  useTrackerStream,
  type TrackerAlert,
  type TrackedWallet,
} from "../hooks/useTrackerStream";
import { useTrackedDeploys, type TrackedDeploy } from "../hooks/useTrackedDeploys";

/** A live tweet from a tracked X handle, shaped for the bell feed. */
export interface TweetAlertItem {
  username: string;
  displayName: string | null;
  tweetId: string;
  text: string;
}

export type LiveFeedItem =
  | { kind: "trade"; ts: number; data: TrackerAlert }
  | { kind: "deploy"; ts: number; data: TrackedDeploy }
  | { kind: "tweet"; ts: number; data: TweetAlertItem };

interface LiveAlertsCtx {
  feedItems: LiveFeedItem[];
  unreadCount: number;
  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  wallets: TrackedWallet[];
  watchlistLoading: boolean;
  mutedWalletIds: Set<string>;
  toggleMuteWallet: (walletId: string) => void;
  addWatchedWallet: (address: string, label: string) => void;
  removeWatchedWallet: (id: string) => void;
  renameWatchedWallet: (id: string, label: string) => void;
}

const Ctx = createContext<LiveAlertsCtx | null>(null);

const SEEN_KEY = "trade.alerts.lastSeen";
const FEED_CAP = 100;
const PREF_WATCHLIST = "tracker.watchlist";
const PREF_MUTED_WALLETS = "alerts.mutedWallets";

function readLastSeen(): number {
  if (typeof window === "undefined") return 0;
  try { return Number(sessionStorage.getItem(SEEN_KEY) ?? 0); }
  catch { return 0; }
}

function writeLastSeen(ts: number) {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(SEEN_KEY, String(ts)); }
  catch { /* ignore */ }
}

function makeWatchId() {
  return `watch:${Math.random().toString(36).slice(2, 9)}`;
}

function rawToWallet(w: { id: string; address: string; label: string }): TrackedWallet {
  return {
    id: w.id.startsWith("watch:") ? w.id : `watch:${w.id}`,
    address: w.address,
    label: w.label,
    source: "watchlist",
  };
}

function walletToRaw(w: TrackedWallet) {
  return { id: w.id.replace(/^watch:/, ""), address: w.address, label: w.label };
}

function LiveAlertsInner({ children }: { children: React.ReactNode }) {
  const { authed, pushToast } = useApp();
  const { region } = useRegion();
  const xTracker = useXTracker();
  const [tweetAlertsOn] = useNotifTweetAlerts();

  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  const [panelOpen, setPanelOpenRaw] = useState(false);
  // Start at 0 on both SSR and the first client render — sessionStorage is
  // browser-only and would otherwise diverge. The persisted value loads in
  // useEffect below.
  const lastSeenRef = useRef<number>(0);
  const [lastSeen, setLastSeen] = useState<number>(0);
  const [mutedWalletIds, setMutedWalletIds] = useState<Set<string>>(new Set());

  // Post-mount: pull the last-seen timestamp from sessionStorage.
  useEffect(() => {
    const ts = readLastSeen();
    if (ts !== lastSeenRef.current) {
      lastSeenRef.current = ts;
      setLastSeen(ts);
    }
  }, []);

  // Load all per-account state from backend when authenticated.
  // Falls back to localStorage and performs a one-time migration so
  // existing data survives the first login after this deploy.
  useEffect(() => {
    if (!authed) {
      setWallets([]);
      setMutedWalletIds(new Set());
      setWatchlistLoading(false);
      return;
    }

    const session = readSession();
    if (!session) {
      setWatchlistLoading(false);
      return;
    }

    const client = new BackendClient(region.baseUrl, session.token);
    let cancelled = false;

    async function load() {
      setWatchlistLoading(true);
      try {
        // ── Watchlist ──────────────────────────────────────────
        const watchlistData = await client.getPreference<Array<{ id: string; address: string; label: string }>>(PREF_WATCHLIST);
        if (!cancelled) {
          if (watchlistData !== null) {
            setWallets(watchlistData.map(rawToWallet));
          } else {
            // One-time migration: seed from localStorage if present
            const local = readWatchlist();
            if (local.length > 0) {
              void client.setPreference(PREF_WATCHLIST, local.map(walletToRaw));
              try { localStorage.removeItem(WATCHLIST_STORAGE_KEY); } catch { /* ignore */ }
            }
            setWallets(local);
          }
        }

        // ── Muted wallets ──────────────────────────────────────
        const mutedWData = await client.getPreference<string[]>(PREF_MUTED_WALLETS);
        if (!cancelled) {
          if (mutedWData !== null) {
            setMutedWalletIds(new Set(mutedWData));
          } else {
            const local = readMutedWallets();
            if (local.size > 0) {
              void client.setPreference(PREF_MUTED_WALLETS, [...local]);
              try { localStorage.removeItem(MUTED_WALLETS_KEY); } catch { /* ignore */ }
            }
            setMutedWalletIds(local);
          }
        }

      } catch (e) {
        console.error("[LiveAlerts] failed to load from backend, using localStorage", e);
        if (!cancelled) {
          setWallets(readWatchlist());
          setMutedWalletIds(readMutedWallets());
        }
      } finally {
        if (!cancelled) setWatchlistLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [authed, region.baseUrl]);

  // ── Watchlist mutations ──────────────────────────────────────────────────

  const addWatchedWallet = useCallback((address: string, label: string) => {
    const newWallet: TrackedWallet = {
      id: makeWatchId(),
      address,
      label,
      source: "watchlist",
    };
    setWallets((prev) => {
      const updated = [...prev, newWallet];
      const session = readSession();
      if (session) {
        const client = new BackendClient(region.baseUrl, session.token);
        void client.setPreference(PREF_WATCHLIST, updated.map(walletToRaw));
      }
      return updated;
    });
  }, [region.baseUrl]);

  const removeWatchedWallet = useCallback((id: string) => {
    setWallets((prev) => {
      const updated = prev.filter((w) => w.id !== id);
      const session = readSession();
      if (session) {
        const client = new BackendClient(region.baseUrl, session.token);
        void client.setPreference(PREF_WATCHLIST, updated.map(walletToRaw));
      }
      return updated;
    });
  }, [region.baseUrl]);

  const renameWatchedWallet = useCallback((id: string, label: string) => {
    setWallets((prev) => {
      const updated = prev.map((w) => w.id === id ? { ...w, label: label.trim() || w.label } : w);
      const session = readSession();
      if (session) {
        const client = new BackendClient(region.baseUrl, session.token);
        void client.setPreference(PREF_WATCHLIST, updated.map(walletToRaw));
      }
      return updated;
    });
  }, [region.baseUrl]);

  // ── Mute toggles ─────────────────────────────────────────────────────────

  const toggleMuteWallet = useCallback((walletId: string) => {
    setMutedWalletIds((prev) => {
      const next = new Set(prev);
      if (next.has(walletId)) next.delete(walletId); else next.add(walletId);
      const session = readSession();
      if (session) {
        const client = new BackendClient(region.baseUrl, session.token);
        void client.setPreference(PREF_MUTED_WALLETS, [...next]);
      }
      return next;
    });
  }, [region.baseUrl]);

  // ── Live streams (seed disabled — history loaded per-page as needed) ──────

  const tradeStream = useTrackerStream(wallets, { seedLimit: 0, maxAlerts: FEED_CAP });
  const deployStream = useTrackedDeploys(wallets, { maxDeploys: 50, perWalletHistory: 0 });

  // ── Tweet alerts — live tweets from every tracked X handle ────────────────
  // Global (this provider wraps the whole shell), so tweets notify no matter
  // which page is open. The `x.tweets` wire subs are ref-counted client-side
  // AND deduped onto one upstream xshot socket server-side, so overlapping
  // with the tracker page's own feed costs nothing extra. The stream only
  // delivers NEW tweets (no replay), so mounting never toast-floods.
  const [tweetItems, setTweetItems] = useState<LiveFeedItem[]>([]);
  const seenTweetIds = useRef<Set<string>>(new Set());
  const xUsernamesKey = useMemo(
    () => xTracker.handles.map((h) => h.handle.username.toLowerCase()).sort().join(","),
    [xTracker.handles],
  );

  useEffect(() => {
    // The pref is the master switch for the whole lane: OFF tears down the
    // subscription (no bell entries, no toasts).
    if (!authed || !tweetAlertsOn || !xUsernamesKey) return;
    const session = readSession();
    if (!session) return;
    const list = xUsernamesKey.split(",").filter(Boolean);
    if (list.length === 0) return;

    const nameByUsername = new Map(
      xTracker.handles.map((h) => [h.handle.username.toLowerCase(), h.handle.displayName]),
    );
    const stream = getXStream(region.baseUrl, session.token);
    for (const u of list) stream.subscribe(u);
    const off = stream.on(({ username, tweet }) => {
      if (!list.includes(username)) return;
      if (seenTweetIds.current.has(tweet.tweetId)) return;
      seenTweetIds.current.add(tweet.tweetId);
      const item: TweetAlertItem = {
        username,
        displayName: nameByUsername.get(username) ?? null,
        tweetId: tweet.tweetId,
        text: tweet.text,
      };
      setTweetItems((prev) =>
        [{ kind: "tweet" as const, ts: Date.now(), data: item }, ...prev].slice(0, 50));
      pushToast({
        title: `@${username} tweeted`,
        body: tweet.text.length > 140 ? `${tweet.text.slice(0, 140)}…` : tweet.text,
        tone: "default",
      });
    });
    return () => {
      off();
      for (const u of list) stream.unsubscribe(u);
    };
    // xTracker.handles is captured via xUsernamesKey (display names only add
    // cosmetics; a rename doesn't need a resubscribe).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, tweetAlertsOn, xUsernamesKey, region.baseUrl, pushToast]);

  const feedItems = useMemo<LiveFeedItem[]>(() => {
    const out: LiveFeedItem[] = [];
    for (const a of tradeStream.alerts) {
      if (a.live && !mutedWalletIds.has(a.walletId))
        out.push({ kind: "trade", ts: a.timestamp, data: a });
    }
    for (const d of deployStream.deploys) {
      if (d.live && !mutedWalletIds.has(d.walletId))
        out.push({ kind: "deploy", ts: d.timestampMs, data: d });
    }
    out.push(...tweetItems);
    return out.sort((a, b) => b.ts - a.ts).slice(0, FEED_CAP);
  }, [tradeStream.alerts, deployStream.deploys, tweetItems, mutedWalletIds]);

  const unreadCount = useMemo(
    () => feedItems.filter((item) => item.ts > lastSeen).length,
    [feedItems, lastSeen],
  );

  const markRead = useCallback(() => {
    const now = Date.now();
    lastSeenRef.current = now;
    setLastSeen(now);
    writeLastSeen(now);
  }, []);

  const setPanelOpen = useCallback((v: boolean) => {
    setPanelOpenRaw(v);
    if (v) markRead();
  }, [markRead]);

  return (
    <Ctx.Provider value={{
      feedItems, unreadCount, panelOpen, setPanelOpen,
      wallets, watchlistLoading,
      mutedWalletIds,
      toggleMuteWallet,
      addWatchedWallet, removeWatchedWallet, renameWatchedWallet,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function LiveAlertsProvider({ children }: { children: React.ReactNode }) {
  return <LiveAlertsInner>{children}</LiveAlertsInner>;
}

export function useLiveAlerts(): LiveAlertsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLiveAlerts must be inside <LiveAlertsProvider>");
  return v;
}
