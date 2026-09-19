"use client";
// Live X-tracker tweet stream, multiplexed over the shared encrypted wire.
//
// The old implementation opened a dedicated `/x/stream` WebSocket; that
// endpoint is gone. Tweets now arrive on the `x.tweets` wire topic — one
// subscription per username, ref-counted here so several UI surfaces
// (Tracker feed + Sidebar pane) watching the same handle share a single
// topic sub. The backend dedupes further: every local sub for @foo collapses
// onto one upstream xshot WebSocket subscription.

import type { XTweet } from "./backend";
import { getWire } from "../lib/wire/singleton";

export type XStreamListener = (msg: { username: string; tweet: XTweet }) => void;

interface SubEntry {
  cancel: () => void;
  rc: number;
}

export class XStreamClient {
  private listeners = new Set<XStreamListener>();
  private subs = new Map<string, SubEntry>();

  constructor(private baseUrl: string) {}

  /** Kept for signature compatibility — the wire connects lazily. */
  start(): void { /* no-op */ }

  close(): void {
    for (const e of this.subs.values()) {
      try { e.cancel(); } catch { /* ignore */ }
    }
    this.subs.clear();
    this.listeners.clear();
  }

  on(fn: XStreamListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  subscribe(rawUsername: string): void {
    const username = rawUsername.toLowerCase();
    if (!username) return;
    const cur = this.subs.get(username);
    if (cur) { cur.rc += 1; return; }
    const sub = getWire(this.baseUrl).subscribe("x.tweets", { username }, (d) => {
      const msg = d as { username?: string; tweet?: XTweet };
      if (!msg?.username || !msg.tweet) return;
      for (const fn of this.listeners) {
        try { fn({ username: msg.username, tweet: msg.tweet }); } catch { /* ignore */ }
      }
    });
    this.subs.set(username, { cancel: () => sub.cancel(), rc: 1 });
  }

  unsubscribe(rawUsername: string): void {
    const username = rawUsername.toLowerCase();
    const cur = this.subs.get(username);
    if (!cur) return;
    if (cur.rc <= 1) {
      try { cur.cancel(); } catch { /* ignore */ }
      this.subs.delete(username);
    } else {
      cur.rc -= 1;
    }
  }
}

/**
 * X avatars ride the backend `/img` proxy (pbs/abs.twimg.com are
 * allow-listed there) so the browser never talks to Twitter's CDN directly.
 * Anything else passes through untouched.
 */
export function proxiedAvatarUrl(rawUrl: string | null, baseUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    if (u.hostname === "pbs.twimg.com" || u.hostname === "abs.twimg.com") {
      return `${baseUrl.replace(/\/$/, "")}/img?url=${encodeURIComponent(rawUrl)}`;
    }
  } catch { /* not an absolute URL — pass through */ }
  return rawUrl;
}

// Per-region singletons — mirrors lib/wire/singleton semantics. The token
// param is unused (the wire is already session-authenticated) but kept so
// existing call sites compile unchanged.
const clients = new Map<string, XStreamClient>();

export function getXStream(baseUrl: string, _token: string): XStreamClient {
  let c = clients.get(baseUrl);
  if (!c) {
    c = new XStreamClient(baseUrl);
    clients.set(baseUrl, c);
  }
  return c;
}
