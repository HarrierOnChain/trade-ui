"use client";
// Hover-preview popup for X (Twitter) links on a token card. Replaces the
// generic single-line Tooltip on the X icon with a full profile/tweet
// card, mirroring the affordance competitor terminals offer. Data is
// lazy-fetched on first hover and module-cached; the card renders
// gracefully from URL-derived info even when the fetch fails or is still
// in flight.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useXPreview } from "../../hooks/useXPreview";
import { proxiedAvatarUrl } from "../../api/xstream";
import { useRegion } from "../../contexts/RegionContext";
import { VerifiedBadge, relativeTime } from "../XTrackerColumn/TweetRow";
import { Icon } from "./Icon";
import { tweetAgeMinutesFromId, tweetAgeMinutesFromDate, tweetFreshnessColor } from "../../lib/tweetAge";
import type { XPreviewProfile, XPreviewTweet, XPreviewCommunity } from "../../api/backend";
import type { XUrlInfo } from "../../lib/xUrl";

const GAP = 8;
const VIEWPORT_PAD = 6;
const POPUP_WIDTH = 320;

type Placement = "top" | "bottom" | "left" | "right";

interface Pos {
  top: number;
  left: number;
  placement: Placement;
  arrowOffset: number;
}

function computePosition(anchor: DOMRect, tip: { width: number; height: number }, desired: Placement): Pos {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const fits = (p: Placement) => {
    if (p === "top") return anchor.top - tip.height - GAP >= VIEWPORT_PAD;
    if (p === "bottom") return anchor.bottom + tip.height + GAP <= vh - VIEWPORT_PAD;
    if (p === "left") return anchor.left - tip.width - GAP >= VIEWPORT_PAD;
    return anchor.right + tip.width + GAP <= vw - VIEWPORT_PAD;
  };
  const order: Placement[] = [desired, "top", "bottom", "right", "left"];
  const placement = order.find(fits) ?? desired;

  let top = 0;
  let left = 0;
  if (placement === "top") {
    top = anchor.top - tip.height - GAP;
    left = anchor.left + anchor.width / 2 - tip.width / 2;
  } else if (placement === "bottom") {
    top = anchor.bottom + GAP;
    left = anchor.left + anchor.width / 2 - tip.width / 2;
  } else if (placement === "left") {
    top = anchor.top + anchor.height / 2 - tip.height / 2;
    left = anchor.left - tip.width - GAP;
  } else {
    top = anchor.top + anchor.height / 2 - tip.height / 2;
    left = anchor.right + GAP;
  }
  const anchorCenterX = anchor.left + anchor.width / 2;
  const anchorCenterY = anchor.top + anchor.height / 2;
  left = Math.min(Math.max(VIEWPORT_PAD, left), vw - tip.width - VIEWPORT_PAD);
  top = Math.min(Math.max(VIEWPORT_PAD, top), vh - tip.height - VIEWPORT_PAD);
  const CORNER_PAD = 12;
  const arrowOffset =
    placement === "top" || placement === "bottom"
      ? Math.min(Math.max(CORNER_PAD, anchorCenterX - left), tip.width - CORNER_PAD)
      : Math.min(Math.max(CORNER_PAD, anchorCenterY - top), tip.height - CORNER_PAD);
  return { top, left, placement, arrowOffset };
}

function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

function formatJoined(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatPostedAt(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    hour: "numeric", minute: "2-digit", hour12: true,
    month: "short", day: "numeric", year: "numeric",
  });
}

// Compact age label used in the tweet card header when the fetched timestamp
// isn't available yet (we still know the age from the snowflake ID).
function shortAge(min: number): string {
  if (min < 1) return "now";
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

export interface XLinkPreviewProps {
  info: XUrlInfo;
  children: React.ReactElement;
  delay?: number;
  placement?: Placement;
  stopPropagation?: boolean;
}

export function XLinkPreview({
  info,
  children,
  delay = 220,
  placement = "top",
  stopPropagation = false,
}: XLinkPreviewProps) {
  const { region } = useRegion();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<Pos>({ top: 0, left: 0, placement, arrowOffset: 0 });
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enrichable = info.kind === "profile" || info.kind === "tweet" || info.kind === "community";
  const fetchUrl = enrichable ? info.url : null;
  const { data, loading } = useXPreview(fetchUrl, open && enrichable);

  useEffect(() => {
    setMounted(true);
  }, []);

  const clearShowTimer = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  const show = useCallback(() => {
    clearCloseTimer();
    clearShowTimer();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [clearCloseTimer, clearShowTimer, delay]);

  // Brief grace period so the user can move the cursor from the icon onto
  // the popup itself (which is interactive — they can click "Open on X").
  const hide = useCallback(() => {
    clearShowTimer();
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 80);
  }, [clearShowTimer, clearCloseTimer]);

  useEffect(() => () => { clearShowTimer(); clearCloseTimer(); }, [clearShowTimer, clearCloseTimer]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const update = () => {
      if (!anchorRef.current || !tipRef.current) return;
      const a = anchorRef.current.getBoundingClientRect();
      const t = tipRef.current.getBoundingClientRect();
      setPos(computePosition(a, { width: t.width, height: t.height }, placement));
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, placement, data, loading]);

  const child = children as React.ReactElement<Record<string, unknown>>;
  const childProps = child.props as Record<string, unknown>;

  const handlers = useMemo(
    () => ({
      onMouseEnter: (e: React.MouseEvent) => {
        show();
        const fn = childProps.onMouseEnter as ((e: React.MouseEvent) => void) | undefined;
        fn?.(e);
      },
      onMouseLeave: (e: React.MouseEvent) => {
        hide();
        const fn = childProps.onMouseLeave as ((e: React.MouseEvent) => void) | undefined;
        fn?.(e);
      },
      onFocus: (e: React.FocusEvent) => {
        show();
        const fn = childProps.onFocus as ((e: React.FocusEvent) => void) | undefined;
        fn?.(e);
      },
      onBlur: (e: React.FocusEvent) => {
        hide();
        const fn = childProps.onBlur as ((e: React.FocusEvent) => void) | undefined;
        fn?.(e);
      },
    }),
    [show, hide, childProps],
  );

  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      anchorRef.current = node;
      const existing = (childProps as { ref?: React.Ref<HTMLElement> }).ref;
      if (typeof existing === "function") existing(node);
      else if (existing && typeof existing === "object")
        (existing as React.MutableRefObject<HTMLElement | null>).current = node;
    },
    [childProps],
  );

  const cloned = React.cloneElement(child, {
    ...handlers,
    ref: setRefs,
    title: undefined,
  } as Record<string, unknown>);

  const arrowSize = 5;
  const arrowStyle: React.CSSProperties = {
    position: "absolute",
    width: arrowSize * 2,
    height: arrowSize * 2,
    background: "var(--ink-2)",
    borderRight: "1px solid var(--line)",
    borderBottom: "1px solid var(--line)",
    pointerEvents: "none",
    ...(pos.placement === "top" && {
      bottom: -arrowSize, left: pos.arrowOffset - arrowSize, transform: "rotate(45deg)",
    }),
    ...(pos.placement === "bottom" && {
      top: -arrowSize, left: pos.arrowOffset - arrowSize, transform: "rotate(225deg)",
    }),
    ...(pos.placement === "left" && {
      right: -arrowSize, top: pos.arrowOffset - arrowSize, transform: "rotate(-45deg)",
    }),
    ...(pos.placement === "right" && {
      left: -arrowSize, top: pos.arrowOffset - arrowSize, transform: "rotate(135deg)",
    }),
  };

  const onPopupClick = stopPropagation ? (e: React.MouseEvent) => e.stopPropagation() : undefined;

  return (
    <>
      {cloned}
      {mounted && open
        ? createPortal(
            <div
              ref={tipRef}
              role="tooltip"
              onMouseEnter={() => { clearCloseTimer(); }}
              onMouseLeave={hide}
              onClick={onPopupClick}
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                zIndex: 9999,
                width: POPUP_WIDTH,
                background: "var(--ink-2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-2)",
                boxShadow: "var(--shadow-pop)",
                color: "var(--paper)",
                fontFamily: "var(--font-ui)",
                fontSize: 12,
                lineHeight: 1.4,
                overflow: "hidden",
                animation: "tooltipIn 140ms cubic-bezier(0.16, 1, 0.3, 1)",
                transformOrigin:
                  pos.placement === "top" ? "50% 100%" :
                  pos.placement === "bottom" ? "50% 0%" :
                  pos.placement === "left" ? "100% 50%" : "0% 50%",
              }}
            >
              <PreviewBody info={info} data={data?.profile ?? null} tweet={data?.tweet ?? null} community={data?.community ?? null} loading={loading} regionBaseUrl={region.baseUrl} />
              <span aria-hidden style={arrowStyle} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function PreviewBody({
  info,
  data,
  tweet,
  community,
  loading,
  regionBaseUrl,
}: {
  info: XUrlInfo;
  data: XPreviewProfile | null;
  tweet: XPreviewTweet | null;
  community: XPreviewCommunity | null;
  loading: boolean;
  regionBaseUrl: string;
}) {
  if (info.kind === "tweet") {
    return <TweetCard info={info} tweet={tweet} loading={loading} regionBaseUrl={regionBaseUrl} />;
  }
  if (info.kind === "profile") {
    return <ProfileCard info={info} profile={data} loading={loading} regionBaseUrl={regionBaseUrl} />;
  }
  if (info.kind === "community") {
    return <CommunityCard info={info} community={community} loading={loading} regionBaseUrl={regionBaseUrl} />;
  }
  return <FallbackCard info={info} />;
}

function CTA({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "8px 12px",
        background: "var(--accent, var(--paper))",
        color: "var(--ink)",
        fontWeight: 600,
        fontSize: 12,
        textDecoration: "none",
        borderRadius: "var(--r-1)",
        transition: "opacity 120ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
    >
      {label}
    </a>
  );
}

function Avatar({ url, regionBaseUrl, size = 40 }: { url: string | null; regionBaseUrl: string; size?: number }) {
  const proxied = url ? proxiedAvatarUrl(url, regionBaseUrl) : null;
  if (proxied) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={proxied}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: "var(--ink-3)" }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "var(--ink-3)", flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      color: "var(--paper-3)", fontSize: size * 0.45,
    }}>𝕏</div>
  );
}

function ProfileCard({
  info,
  profile,
  loading,
  regionBaseUrl,
}: {
  info: XUrlInfo;
  profile: XPreviewProfile | null;
  loading: boolean;
  regionBaseUrl: string;
}) {
  const username = profile?.username ?? info.username ?? "";
  const displayName = profile?.displayName;
  const joined = formatJoined(profile?.joinedAt ?? null);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {profile?.bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proxiedAvatarUrl(profile.bannerUrl, regionBaseUrl) ?? profile.bannerUrl}
          alt=""
          style={{ width: "100%", height: 90, objectFit: "cover", display: "block", background: "var(--ink-3)" }}
        />
      )}
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Avatar url={profile?.avatarUrl ?? null} regionBaseUrl={regionBaseUrl} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 4,
            color: "var(--paper)", fontSize: 13, fontWeight: 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {displayName || `@${username}`}
            {profile?.verified && <VerifiedBadge />}
          </div>
          <div style={{ color: "var(--paper-3)", fontSize: 11, marginTop: 1 }}>
            @{username}
          </div>
        </div>
      </div>
      {profile?.description && (
        <div style={{
          color: "var(--paper-2)", fontSize: 12, lineHeight: 1.45,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          // Cap to ~3 lines so the popup stays compact on huge bios.
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>{profile.description}</div>
      )}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: "4px 14px",
        color: "var(--paper-3)", fontSize: 11,
      }}>
        {profile?.followersCount != null && (
          <span><strong style={{ color: "var(--paper)" }}>{formatCount(profile.followersCount)}</strong> Followers</span>
        )}
        {profile?.followingCount != null && (
          <span><strong style={{ color: "var(--paper)" }}>{formatCount(profile.followingCount)}</strong> Following</span>
        )}
        {joined && <span>Joined {joined}</span>}
      </div>
      {loading && !profile && (
        <div style={{ color: "var(--paper-3)", fontSize: 11 }}>Loading profile…</div>
      )}
      <CTA url={info.url} label="View profile on X" />
      </div>
    </div>
  );
}

function TweetCard({
  info,
  tweet,
  loading,
  regionBaseUrl,
}: {
  info: XUrlInfo;
  tweet: XPreviewTweet | null;
  loading: boolean;
  regionBaseUrl: string;
}) {
  const username = tweet?.author.username ?? info.username ?? "";
  const displayName = tweet?.author.displayName;
  // Age from the snowflake ID (always known) — fall back to the fetched
  // timestamp; color it green → orange → red by freshness like the icon.
  const ageMin = tweetAgeMinutesFromId(info.tweetId) ?? tweetAgeMinutesFromDate(tweet?.postedAt);
  const ageColor = tweetFreshnessColor(ageMin);
  const ageLabel = tweet?.postedAt
    ? relativeTime(tweet.postedAt)
    : ageMin != null ? shortAge(ageMin) : null;
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Avatar url={tweet?.author.avatarUrl ?? null} regionBaseUrl={regionBaseUrl} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 4,
            color: "var(--paper)", fontSize: 12.5, fontWeight: 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {displayName || `@${username}`}
            {tweet?.author.verified && <VerifiedBadge />}
          </div>
          <div style={{ color: "var(--paper-3)", fontSize: 11, marginTop: 1 }}>
            @{username}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, gap: 3 }}>
          <span style={{ color: "var(--paper-2)", lineHeight: 0 }}>{Icon.x(13)}</span>
          {ageLabel && (
            <span style={{ color: ageColor, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
              {ageLabel}
            </span>
          )}
        </div>
      </div>
      {tweet?.text && (
        <div style={{
          color: "var(--paper)", fontSize: 12.5, lineHeight: 1.45,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          display: "-webkit-box",
          WebkitLineClamp: 6,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>{tweet.text}</div>
      )}
      {tweet?.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proxiedAvatarUrl(tweet.mediaUrl, regionBaseUrl) ?? tweet.mediaUrl}
          alt=""
          style={{
            width: "100%", maxHeight: 200, objectFit: "cover",
            borderRadius: "var(--r-1)", display: "block", background: "var(--ink-3)",
          }}
        />
      )}
      {tweet?.quoted && (
        <div style={{
          border: "1px solid var(--line)", borderRadius: "var(--r-1)",
          padding: 8, display: "flex", flexDirection: "column", gap: 5,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <Avatar url={tweet.quoted.author.avatarUrl} regionBaseUrl={regionBaseUrl} size={18} />
            <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, fontSize: 11.5 }}>
              <span style={{
                color: "var(--paper)", fontWeight: 600,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{tweet.quoted.author.displayName || `@${tweet.quoted.author.username}`}</span>
              {tweet.quoted.author.verified && <VerifiedBadge />}
              <span style={{ color: "var(--paper-3)" }}>@{tweet.quoted.author.username}</span>
            </div>
          </div>
          {tweet.quoted.text && (
            <div style={{
              color: "var(--paper-2)", fontSize: 11.5, lineHeight: 1.4,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>{tweet.quoted.text}</div>
          )}
          {tweet.quoted.mediaUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proxiedAvatarUrl(tweet.quoted.mediaUrl, regionBaseUrl) ?? tweet.quoted.mediaUrl}
              alt=""
              style={{ width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: "var(--r-1)", display: "block", background: "var(--ink-3)" }}
            />
          )}
        </div>
      )}
      {tweet && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "4px 14px",
          color: "var(--paper-3)", fontSize: 11,
        }}>
          <Engagement label="Replies" value={tweet.engagement.replies} />
          <Engagement label="Reposts" value={tweet.engagement.retweets} />
          <Engagement label="Likes" value={tweet.engagement.likes} />
          {tweet.engagement.views != null && <Engagement label="Views" value={tweet.engagement.views} />}
        </div>
      )}
      {tweet?.postedAt && (
        <div style={{ color: "var(--paper-3)", fontSize: 10.5 }}>{formatPostedAt(tweet.postedAt)}</div>
      )}
      {loading && !tweet && (
        <div style={{ color: "var(--paper-3)", fontSize: 11 }}>Loading tweet…</div>
      )}
      <CTA url={info.url} label="Read more on X" />
    </div>
  );
}

function Engagement({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <span><strong style={{ color: "var(--paper)" }}>{formatCount(value)}</strong> {label}</span>
  );
}

function CommunityCard({
  info,
  community,
  loading,
  regionBaseUrl,
}: {
  info: XUrlInfo;
  community: XPreviewCommunity | null;
  loading: boolean;
  regionBaseUrl: string;
}) {
  const created = formatJoined(community?.createdAt ?? null);
  const creator = community?.creator ?? null;
  const hasCreator = !!creator && !!(creator.displayName || creator.username);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {community?.bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proxiedAvatarUrl(community.bannerUrl, regionBaseUrl) ?? community.bannerUrl}
          alt=""
          style={{ width: "100%", height: 92, objectFit: "cover", display: "block", background: "var(--ink-3)" }}
        />
      )}
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ color: "var(--paper)", fontSize: 14, fontWeight: 700, wordBreak: "break-word" }}>
          {community?.name || "X Community"}
        </div>
        {community?.description && (
          <div style={{
            color: "var(--paper-2)", fontSize: 12, lineHeight: 1.45,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{community.description}</div>
        )}
        {community?.memberCount != null && (
          <div style={{ color: "var(--paper-3)", fontSize: 11 }}>
            <strong style={{ color: "var(--paper)" }}>{formatCount(community.memberCount)}</strong> Members
          </div>
        )}
        {hasCreator && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <span style={{ color: "var(--paper-3)", fontSize: 10.5 }}>Created by</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <Avatar url={creator!.avatarUrl} regionBaseUrl={regionBaseUrl} size={24} />
              <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                <span style={{
                  color: "var(--paper)", fontSize: 12, fontWeight: 600,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{creator!.displayName || `@${creator!.username}`}</span>
                {creator!.verified && <VerifiedBadge />}
                {creator!.username && creator!.displayName && (
                  <span style={{ color: "var(--paper-3)", fontSize: 11 }}>@{creator!.username}</span>
                )}
              </div>
            </div>
          </div>
        )}
        {created && <div style={{ color: "var(--paper-3)", fontSize: 10.5 }}>Created {created}</div>}
        {loading && !community && (
          <div style={{ color: "var(--paper-3)", fontSize: 11 }}>Loading community…</div>
        )}
        <CTA url={info.url} label="View community on X" />
      </div>
    </div>
  );
}

function FallbackCard({ info }: { info: XUrlInfo }) {
  const heading =
    info.kind === "community" ? "X Community" :
    info.kind === "list" ? "X List" :
    info.kind === "search" ? "X Search" :
    "X Link";
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ color: "var(--paper)", fontSize: 13, fontWeight: 600 }}>{heading}</div>
      <div style={{
        color: "var(--paper-3)", fontSize: 11,
        wordBreak: "break-all",
      }}>{info.url}</div>
      <CTA url={info.url} label="Open on X" />
    </div>
  );
}
