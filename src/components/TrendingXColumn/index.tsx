"use client";
import React, { useMemo, useState } from "react";
import { Icon, Tooltip } from "../atoms";
import { Empty, LoadingRows } from "../DeployColumn";
import { useRegion } from "../../contexts/RegionContext";
import { useXTracker } from "../../hooks/useXTracker";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { proxiedAvatarUrl } from "../../api/xstream";
import { fmtNum } from "../../lib/format";
import { relativeTime, VerifiedBadge } from "../XTrackerColumn/TweetRow";
import type { XTrendingKol } from "../../api/backend";
import type { TokenEvent } from "../../types";
import type { XTweetWithMatches } from "../../lib/xTrending";

type Mode = "kols" | "mentions";

const MODES: Array<{ id: Mode; label: string }> = [
  { id: "kols", label: "KOLs" },
  { id: "mentions", label: "Mentions" },
];

interface Props {
  tokens: TokenEvent[];
  kols: XTrendingKol[];
  tweets: XTweetWithMatches[];
  loading: boolean;
  error: string | null;
  selectedMint: string | null;
  onClearSelectedMint: () => void;
  onSelectToken: (mint: string) => void;
}

export function TrendingXColumn({
  tokens,
  kols,
  tweets,
  loading,
  error,
  selectedMint,
  onClearSelectedMint,
  onSelectToken,
}: Props) {
  const [mode, setMode] = useState<Mode>("kols");
  const activeMode: Mode = selectedMint ? "mentions" : mode;
  const selectedToken = useMemo(
    () => tokens.find((token) => token.mint_address === selectedMint) ?? null,
    [tokens, selectedMint],
  );

  const visibleTweets = useMemo(() => {
    if (activeMode === "kols") return tweets;
    return tweets.filter((tweet) =>
      selectedMint
        ? tweet.matches.some((match) => match.mint === selectedMint)
        : tweet.matches.length > 0,
    );
  }, [activeMode, selectedMint, tweets]);

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        background: "var(--ink-0)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--line-soft)",
          background: "var(--ink-1)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ color: "var(--paper)", display: "inline-flex" }}>{Icon.x(13)}</span>
          <span className="ser" style={{ fontSize: 15, fontStyle: "italic" }}>X Intel</span>
          {MODES.map((item) => {
            const active = activeMode === item.id;
            return (
              <Tooltip
                key={item.id}
                content={item.id === "kols" ? "Curated KOL feed" : "Tweets matching visible tokens"}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (selectedMint && item.id !== "mentions") onClearSelectedMint();
                    setMode(item.id);
                  }}
                  className="mono"
                  style={{
                    padding: "5px 12px",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    fontWeight: active ? 700 : 500,
                    color: active ? "var(--paper)" : "var(--paper-3)",
                    background: active ? "var(--ink-2)" : "transparent",
                    border: `1px solid ${active ? "var(--line)" : "var(--line-soft)"}`,
                    borderRadius: 4,
                    cursor: "pointer",
                    transition: "background 120ms, color 120ms, border-color 120ms",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "var(--ink-2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {item.label}
                </button>
              </Tooltip>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--paper-3)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {activeMode === "mentions" ? visibleTweets.length : kols.length}
          </span>
          <span
            className="mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "var(--accent)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent)",
                boxShadow: "0 0 8px var(--accent)",
              }}
            />
            Live
          </span>
        </div>
      </div>

      {selectedToken && (
        <div
          className="mono"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "7px 14px",
            borderBottom: "1px solid var(--line-soft)",
            background: "var(--accent-w)",
            color: "var(--paper-2)",
            fontSize: 10,
          }}
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            FILTER · {selectedToken.symbol || selectedToken.name || selectedToken.mint_address}
          </span>
          <button
            type="button"
            onClick={onClearSelectedMint}
            style={{ color: "var(--paper-3)", display: "inline-flex", lineHeight: 0 }}
          >
            {Icon.close(12)}
          </button>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {error && <Empty>{error}</Empty>}
        {loading && tweets.length === 0 && <LoadingRows />}
        {!loading && !error && visibleTweets.length === 0 && (
          <Empty>{activeMode === "mentions" ? "No token-linked X hits yet" : "No KOL tweets cached yet"}</Empty>
        )}
        {visibleTweets.map((tweet) => (
          <TrendingXTweetCard
            key={`${tweet.author.username}:${tweet.tweetId}`}
            tweet={tweet}
            onSelectToken={onSelectToken}
          />
        ))}
      </div>
    </aside>
  );
}

function TrendingXTweetCard({
  tweet,
  onSelectToken,
}: {
  tweet: XTweetWithMatches;
  onSelectToken: (mint: string) => void;
}) {
  const { region } = useRegion();
  const xTracker = useXTracker();
  const isPhone = useIsPhone();
  // Tighter card on phones: smaller avatar + gutters and a 3-line clamp on the
  // tweet body so long tweets don't balloon the card height. Desktop unchanged.
  const avatarSize = isPhone ? 36 : 44;
  const tracked = xTracker.handles.some((h) => h.handle.username === tweet.author.username);
  const avatarUrl = proxiedAvatarUrl(tweet.author.avatarUrl, region.baseUrl);
  const tweetUrl = `https://x.com/${tweet.author.username}/status/${tweet.tweetId}`;

  const track = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (tracked) return;
    await xTracker.add(tweet.author.username).catch(() => {});
  };

  const openTweet = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <article
      onClick={openTweet}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `${avatarSize}px minmax(0,1fr)`,
        gap: isPhone ? 8 : 12,
        padding: isPhone ? 10 : 14,
        background: "var(--ink-1)",
        border: "1px solid var(--line-soft)",
        borderRadius: 10,
        boxShadow: "0 1px 0 rgba(0,0,0,0.25), 0 6px 18px rgba(0,0,0,0.18)",
        cursor: "pointer",
        transition: "border-color 140ms, transform 140ms, box-shadow 140ms, background 140ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--line)";
        e.currentTarget.style.background = "var(--ink-2)";
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow =
          "0 1px 0 rgba(0,0,0,0.3), 0 10px 24px rgba(0,0,0,0.28)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--line-soft)";
        e.currentTarget.style.background = "var(--ink-1)";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow =
          "0 1px 0 rgba(0,0,0,0.25), 0 6px 18px rgba(0,0,0,0.18)";
      }}
    >
      <a
        href={`https://x.com/${tweet.author.username}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{ display: "block", width: avatarSize, height: avatarSize }}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            width={avatarSize}
            height={avatarSize}
            style={{
              borderRadius: "50%",
              objectFit: "cover",
              display: "block",
              border: "1px solid var(--line)",
            }}
          />
        ) : (
          <span
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: "50%",
              background: "var(--ink-2)",
              border: "1px solid var(--line)",
              color: "var(--paper-3)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
            }}
          >
            {Icon.x(16)}
          </span>
        )}
      </a>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <a
            href={`https://x.com/${tweet.author.username}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              color: "var(--paper)",
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            @{tweet.author.username}
          </a>
          {tweet.author.verified && <VerifiedBadge size={12} />}
          {tweet.author.followersCount != null && tweet.author.followersCount > 0 && (
            <span
              className="mono"
              style={{
                color: "var(--paper-4)",
                fontSize: 10,
                letterSpacing: "0.04em",
              }}
            >
              · {fmtNum(tweet.author.followersCount)} followers
            </span>
          )}
          <span
            className="mono"
            style={{ marginLeft: "auto", color: "var(--paper-4)", fontSize: 10, flexShrink: 0 }}
          >
            {relativeTime(tweet.postedAt)}
          </span>
          <button
            type="button"
            onClick={track}
            className="mono"
            style={{
              padding: "3px 8px",
              borderRadius: 999,
              border: `1px solid ${tracked ? "var(--accent)" : "var(--line)"}`,
              background: tracked ? "var(--accent-w)" : "transparent",
              color: tracked ? "var(--accent)" : "var(--paper-2)",
              fontSize: 9,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: tracked ? "default" : "pointer",
              flexShrink: 0,
            }}
          >
            {tracked ? "Tracked" : "+ Track"}
          </button>
        </div>

        <div
          style={{
            color: "var(--paper)",
            fontSize: 13,
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            marginTop: 6,
            // Clamp long tweets to 3 lines on phones so cards stay compact.
            ...(isPhone
              ? {
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical" as const,
                  WebkitLineClamp: 3,
                  overflow: "hidden",
                }
              : {}),
          }}
        >
          {tweet.text}
        </div>

        {tweet.matches.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {tweet.matches.slice(0, 5).map((match) => (
              <button
                key={match.mint}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectToken(match.mint);
                }}
                className="mono"
                style={{
                  padding: "3px 8px",
                  borderRadius: 999,
                  border: "1px solid color-mix(in oklch, var(--accent) 35%, var(--line) 65%)",
                  background: "color-mix(in oklch, var(--accent) 14%, var(--ink-2) 86%)",
                  color: "var(--paper)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  lineHeight: 1.2,
                  cursor: "pointer",
                }}
              >
                ${match.symbol}
              </button>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            marginTop: 10,
            paddingTop: 9,
            borderTop: "1px solid var(--line-soft)",
          }}
        >
          <Stat icon="reply" value={tweet.engagement.quotes} />
          <Stat icon="retweet" value={tweet.engagement.retweets} />
          <Stat icon="like" value={tweet.engagement.likes} />
          <Stat icon="view" value={tweet.engagement.views} />
        </div>
      </div>
    </article>
  );
}

type StatIcon = "reply" | "retweet" | "like" | "view";

function Stat({ icon, value }: { icon: StatIcon; value: number | null }) {
  if (value == null || value <= 0) return null;
  return (
    <span
      className="mono"
      style={{
        color: "var(--paper-3)",
        fontSize: 11,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <StatIconSvg icon={icon} />
      <span style={{ color: "var(--paper-2)" }}>{fmtNum(value)}</span>
    </span>
  );
}

function StatIconSvg({ icon }: { icon: StatIcon }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { display: "block" },
  };
  if (icon === "reply") {
    return (
      <svg {...common}>
        <path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3 21l1.4-5A8.5 8.5 0 1 1 21 12z" />
      </svg>
    );
  }
  if (icon === "retweet") {
    return (
      <svg {...common}>
        <path d="M17 2l4 4-4 4" />
        <path d="M3 12V8a2 2 0 0 1 2-2h16" />
        <path d="M7 22l-4-4 4-4" />
        <path d="M21 12v4a2 2 0 0 1-2 2H3" />
      </svg>
    );
  }
  if (icon === "like") {
    return (
      <svg {...common}>
        <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
