"use client";
// Reusable bits for rendering an X tweet row + the bits the sidebar
// needs (verified badge, payload avatar fallback, relative-time format).
// Originally lived inside the home-page XTrackerColumn; broken out so
// the sidebar Tracker pane can render the same row shape without
// importing a defunct full-column component.

import React from "react";

export function VerifiedBadge({ size = 12 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 22 22"
      width={size}
      height={size}
      aria-label="Verified"
      style={{ flexShrink: 0 }}
    >
      <path
        fill="var(--info, #1d9bf0)"
        d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44-.541-.354-1.17-.553-1.817-.57-.646.017-1.275.216-1.816.57-.541.354-.972.853-1.245 1.44-.607-.223-1.264-.27-1.898-.14-.633.131-1.216.437-1.687.882-.445.47-.75 1.053-.881 1.687-.131.633-.083 1.29.14 1.897-.587.274-1.087.705-1.441 1.246-.354.541-.55 1.17-.569 1.816.018.647.215 1.276.57 1.817.354.54.853.972 1.44 1.245-.224.608-.27 1.264-.141 1.898.131.634.437 1.218.882 1.687.47.445 1.054.75 1.687.882.634.13 1.29.083 1.898-.14.273.587.704 1.086 1.245 1.44.54.354 1.17.553 1.816.57.647-.017 1.276-.216 1.817-.57.54-.354.972-.853 1.245-1.44.604.225 1.26.274 1.894.14.634-.133 1.218-.44 1.687-.882.445-.47.749-1.053.88-1.687.131-.634.084-1.29-.137-1.898.587-.273 1.086-.704 1.44-1.245.354-.541.551-1.17.569-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
      />
    </svg>
  );
}

export function authorAvatarFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const author = (payload as Record<string, unknown>).author;
  if (!author || typeof author !== "object") return null;
  const a = author as Record<string, unknown>;
  for (const k of ["profile_image", "profile_image_url_https", "profile_image_url", "avatar"]) {
    const v = a[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/**
 * Compact tweet row sized for the left sidebar (~264px wide). Anchor
 * → opens the tweet on x.com in a new tab. Caller is responsible for
 * passing an already-proxied avatarUrl.
 */
export function TweetRow({
  username,
  text,
  postedAt,
  avatarUrl,
  tweetId,
  verified,
}: {
  username: string;
  text: string;
  postedAt: string;
  avatarUrl: string | null;
  tweetId: string;
  verified: boolean;
}) {
  return (
    <a
      href={`https://x.com/${username}/status/${tweetId}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex", gap: 9,
        padding: "9px 12px",
        borderBottom: "1px solid var(--line-soft)",
        textDecoration: "none", color: "inherit",
      }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          width={26}
          height={26}
          style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: "var(--ink-2)", flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "var(--paper-3)", fontSize: 11,
        }}>𝕏</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontSize: 11, color: "var(--paper-3)", marginBottom: 2,
        }}>
          <span style={{
            color: "var(--paper-2)",
            display: "inline-flex", alignItems: "center", gap: 4,
            minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            @{username}
            {verified && <VerifiedBadge />}
          </span>
          <span style={{ flexShrink: 0 }}>{relativeTime(postedAt)}</span>
        </div>
        <div style={{
          fontSize: 12, color: "var(--paper)",
          lineHeight: 1.35,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>{text}</div>
      </div>
    </a>
  );
}
