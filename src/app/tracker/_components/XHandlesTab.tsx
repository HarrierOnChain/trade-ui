"use client";
/**
 * X handles tab — card grid of tracked X/Twitter accounts.
 *
 * Each card shows the avatar, @username, verified status, the source
 * (direct follow or pulled in via a tracked wallet), and a remove
 * action. The "+ Track handle" button opens the existing
 * AddXHandleModal.
 */

import React from "react";
import { useIsPhone } from "../../../hooks/useMediaQuery";
import type { TrackedXHandle } from "../../../api/backend";
import { Btn } from "../../../components/atoms";
import { EmptyHero, IconButton, PortfolioGlyph } from "../../portfolio/_components/atoms";
import { proxiedAvatarUrl } from "../../../api/xstream";

export function XHandlesTab({
  handles, regionBaseUrl, loading, onAdd, onRemove,
}: {
  handles: TrackedXHandle[];
  regionBaseUrl: string;
  loading: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const isPhone = useIsPhone();
  if (loading && handles.length === 0) {
    return (
      <div style={{
        display: "grid", gap: 10,
        gridTemplateColumns: isPhone ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
      }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{
            height: 92, borderRadius: 12,
            background: "var(--ink-1)", border: "1px solid var(--line-soft)",
            position: "relative", overflow: "hidden",
          }}>
            <span className="skeleton" style={{ position: "absolute", inset: 12, borderRadius: 6 }} />
          </div>
        ))}
      </div>
    );
  }

  if (handles.length === 0) {
    return (
      <EmptyHero
        title="No X handles tracked yet."
        body="Follow a Twitter/X account to surface its tweets in the Feed tab alongside on-chain alerts. Useful for tying KOL signals to the wallets they shill."
        icon="𝕏"
        cta={<Btn size="sm" tone="primary" onClick={onAdd}>+ Track X handle</Btn>}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn size="sm" tone="primary" onClick={onAdd}>+ Track X handle</Btn>
      </div>
      <div style={{
        display: "grid", gap: 10,
        gridTemplateColumns: isPhone ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
      }}>
        {handles.map((row) => {
          const avatar = proxiedAvatarUrl(row.handle.avatarUrl, regionBaseUrl);
          const sources: string[] = [];
          if (row.directlyTracked) sources.push("Tracked directly");
          for (const w of row.wallets) {
            sources.push(w.label || `${w.pubkey.slice(0, 4)}…${w.pubkey.slice(-4)}`);
          }
          const sourceLabel = sources.join(" · ") || "—";
          return (
            <div key={row.handle.id} style={{
              padding: "14px 16px",
              background: "var(--ink-1)",
              border: "1px solid var(--line-soft)",
              borderRadius: 12,
              display: "flex", alignItems: "center", gap: 12,
              transition: "border-color 140ms",
            }}>
              {avatar ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={avatar} alt="" width={48} height={48}
                  style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                />
              ) : (
                <div style={{
                  width: 48, height: 48, borderRadius: "50%",
                  background: "var(--ink-2)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  color: "var(--paper-3)", fontSize: 22, flexShrink: 0,
                  fontFamily: "var(--font-dis)", fontStyle: "italic",
                }}>𝕏</div>
              )}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <a
                  href={`https://x.com/${row.handle.username}`}
                  target="_blank" rel="noreferrer"
                  style={{
                    fontSize: 14, fontWeight: 600, color: "var(--paper)",
                    letterSpacing: "-0.005em",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    display: "inline-flex", alignItems: "center", gap: 6,
                    textDecoration: "none",
                  }}
                >
                  @{row.handle.username}
                  {row.handle.verified && (
                    <span style={{ color: "var(--info)", fontSize: 12 }}>✓</span>
                  )}
                </a>
                <span style={{
                  fontSize: 11, color: "var(--paper-3)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{row.handle.displayName ?? ""}</span>
                <span className="mono" style={{
                  fontSize: 9.5, color: "var(--paper-4)",
                  letterSpacing: "0.04em", textTransform: "uppercase",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }} title={sourceLabel}>{sourceLabel}</span>
              </div>
              <IconButton onClick={() => onRemove(row.handle.id)} title={`Remove @${row.handle.username}`} tone="danger">
                {PortfolioGlyph.trash}
              </IconButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
