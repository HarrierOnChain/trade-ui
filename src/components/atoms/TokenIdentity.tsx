"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useClientNav } from "../../components/shell/ClientPages";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { fetchPublicMetadata, seedPublicMetadata } from "../../api/metadata";
import { useApp } from "../../contexts/AppContext";
import { useHiddenTokens } from "../../lib/hiddenTokens";
import { useWatchlist } from "../../lib/watchlist";
import { shortAddr } from "../../lib/format";
import { tokenHref } from "../../lib/tokenHref";
import { Icon } from "./Icon";
import { TokenIcon } from "./TokenIcon";
import { Tooltip } from "./Tooltip";
import { TokenChartHover } from "./TokenChartHover";
import type { TokenEvent } from "../../types";
import type { LivePrice } from "../../hooks/useLiveTradePrices";

interface Props {
  mint?: string | null;
  chain?: string | null;
  symbol?: string | null;
  name?: string | null;
  image?: string | null;
  platform?: string | null;
  size?: "xs" | "sm" | "md";
  showImage?: boolean;
  showCopy?: boolean;
  /** Hide-token button. Defaults on so every surface gets the affordance. */
  showHide?: boolean;
  /** Watchlist star toggle. Off by default; the token page turns it on. */
  showWatch?: boolean;
  compact?: boolean;
  /** Show ticker first and token name second. Defaults on for app-wide identity rows. */
  symbolFirst?: boolean;
  mutedName?: boolean;
  /** When true, clicking the primary name/ticker copies the mint instead of opening the token. */
  copyMintOnNameClick?: boolean;
  onOpen?: (mint: string) => void;
  className?: string;
  style?: React.CSSProperties;
  /** When provided, hovering the token identity shows a mini chart popup */
  chartToken?: TokenEvent;
  chartLive?: LivePrice;
  chartSolPrice?: number;
}

const SIZE = {
  xs: { icon: 20, primary: 11, secondary: 9, gap: 7 },
  sm: { icon: 24, primary: 12, secondary: 10, gap: 8 },
  md: { icon: 32, primary: 14, secondary: 11, gap: 10 },
};

export function TokenIdentity({
  mint,
  chain,
  symbol,
  name,
  image,
  // `platform` accepted for backward-compat but no longer rendered — every
  // parent surface already shows the DEX in its own row.
  size = "sm",
  showImage = false,
  showCopy = true,
  showHide = true,
  showWatch = false,
  compact = false,
  symbolFirst = true,
  mutedName = false,
  copyMintOnNameClick = false,
  onOpen,
  className,
  style,
  chartToken,
  chartLive,
  chartSolPrice,
}: Props) {
  const { navigate } = useClientNav();
  const isPhone = useIsPhone();
  // On phones the icon column eats ~30px the text row badly needs at 360px, so
  // drop the avatar there and let the name/ticker reclaim the full width.
  const renderImage = showImage && !isPhone;
  const [meta, setMeta] = useState<{ name?: string; symbol?: string; image?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const cleanMint = mint?.trim() || "";
  const initialName = name?.trim() || "";
  const initialSymbol = symbol?.trim() || "";
  const symbolLooksTruncated = initialSymbol.length <= 1 && initialName.length > 1;
  const metrics = SIZE[size];

  useEffect(() => {
    if (!cleanMint) {
      setMeta(null);
      return;
    }

    seedPublicMetadata(cleanMint, {
      name: initialName,
      symbol: initialSymbol,
      image: image ?? undefined,
    });

    const hasIdentity = Boolean(initialName && initialSymbol && image && !symbolLooksTruncated);
    if (hasIdentity) {
      setMeta(null);
      return;
    }

    let cancelled = false;
    fetchPublicMetadata(cleanMint).then((next) => {
      if (cancelled) return;
      setMeta({
        name: next.name?.trim(),
        symbol: next.symbol?.trim(),
        image: next.image,
      });
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [cleanMint, image, initialName, initialSymbol, symbolLooksTruncated]);

  const display = useMemo(() => {
    const metaSymbol = meta?.symbol || "";
    const nextSymbol = symbolLooksTruncated && metaSymbol
      ? metaSymbol
      : initialSymbol || metaSymbol || "";
    const nextName = initialName || meta?.name || "";
    const primary = symbolFirst
      ? nextSymbol || nextName || (cleanMint ? shortAddr(cleanMint, 4) : "–")
      : nextName || nextSymbol || (cleanMint ? shortAddr(cleanMint, 4) : "–");
    const ticker = nextSymbol && nextName
      ? symbolFirst
        ? nextName
        : nextSymbol
      : "";
    return {
      symbol: nextSymbol,
      name: nextName,
      image: image || meta?.image,
      primary,
      ticker,
      fallback: !nextName && !nextSymbol && cleanMint ? shortAddr(cleanMint, 4) : "",
    };
  }, [cleanMint, image, initialName, initialSymbol, meta, symbolFirst]);

  function open(e: React.MouseEvent) {
    if (!cleanMint) return;
    e.stopPropagation();
    onOpen ? onOpen(cleanMint) : navigate(tokenHref(cleanMint, chain));
  }

  async function copy(e: React.MouseEvent) {
    if (!cleanMint) return;
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(cleanMint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1100);
    } catch {
      /* clipboard is best-effort */
    }
  }

  // Trailing column only renders when at least one action button is visible.
  // We still need the column to exist when either the copy or hide button is
  // shown — once it does, both icon-buttons live inside a single inline-flex
  // wrapper so the grid never has to track two separate trailing cells.
  const hasActions = Boolean(cleanMint) && (showCopy || showHide || showWatch);
  const inner = (
    <div
      className={chartToken ? undefined : className}
      style={{
        display: "grid",
        gridTemplateColumns: renderImage
          ? `${metrics.icon}px minmax(0, 1fr)${hasActions ? " auto" : ""}`
          : `minmax(0, 1fr)${hasActions ? " auto" : ""}`,
        alignItems: "center",
        gap: metrics.gap,
        minWidth: 0,
        width: compact ? "fit-content" : "100%",
        maxWidth: "100%",
        ...(chartToken ? undefined : style),
      }}
    >
      {renderImage && (
        <Tooltip content={cleanMint ? `Open ${display.primary}` : null}>
          <button
            type="button"
            onClick={open}
            style={{ display: "inline-flex", padding: 0 }}
          >
            <TokenIcon
              token={{ mint_address: cleanMint, symbol: display.symbol, image: display.image }}
              size={metrics.icon}
            />
          </button>
        </Tooltip>
      )}

      <ConditionalTooltip
        content={copyMintOnNameClick ? (copied ? "Copied" : "Copy mint") : null}
      >
      <button
        type="button"
        onClick={copyMintOnNameClick ? copy : open}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          minWidth: 0,
          padding: 0,
          textAlign: "left",
          cursor: cleanMint ? "pointer" : "default",
        }}
      >
        <span style={{
          display: "flex",
          alignItems: "baseline",
          gap: 5,
          minWidth: 0,
          width: "100%",
          color: "var(--paper)",
        }}>
          <span
            className={symbolFirst ? undefined : "ellipsis"}
            style={{
              minWidth: symbolFirst ? "auto" : 0,
              flexShrink: symbolFirst ? 0 : 1,
              whiteSpace: "nowrap",
              overflow: symbolFirst ? "visible" : "hidden",
              textOverflow: symbolFirst ? "clip" : "ellipsis",
              fontSize: metrics.primary,
              fontWeight: 600,
              fontFamily: mutedName ? "var(--font-mono)" : "var(--font-ui)",
            }}
          >
            {display.primary}
          </span>
          {display.ticker && (
            <span
              className="mono ellipsis"
              style={{
                minWidth: symbolFirst ? 0 : "auto",
                flexShrink: symbolFirst ? 1 : 0,
                fontSize: metrics.secondary,
                color: "var(--paper-3)",
              }}
            >
              {display.ticker}
            </span>
          )}
          {copyMintOnNameClick && copied && (
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              color: "var(--accent)",
              flexShrink: 0,
            }}>
              {Icon.check(metrics.secondary)}
            </span>
          )}
        </span>
        {/* Secondary line: only the short-address fallback when the token has
            no name/symbol. The `platform` prop is intentionally not rendered
            here — every parent surface already shows the DEX in its own row. */}
        {display.fallback && (
          <span
            className="mono ellipsis"
            style={{
              marginTop: 1,
              maxWidth: "100%",
              fontSize: metrics.secondary,
              color: "var(--paper-4)",
              letterSpacing: "0.04em",
            }}
          >
            {display.fallback}
          </span>
        )}
      </button>
      </ConditionalTooltip>

      {hasActions && (
        <span
          // Stop bubbling so action clicks never trigger the parent row's
          // onClick (e.g. opening a token route).
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 2,
            flexShrink: 0,
            marginLeft: "auto",
          }}
        >
          {showWatch && (
            <WatchStarButton
              mint={cleanMint}
              symbol={display.symbol}
              name={display.name}
              image={display.image}
            />
          )}
          {showCopy && (
            <IconButton
              onClick={copy}
              title={copied ? "Copied" : "Copy mint"}
              ariaLabel={copied ? "Copied mint" : "Copy mint"}
              tone={copied ? "success" : "muted"}
            >
              {copied ? Icon.check(12) : Icon.copy(12)}
            </IconButton>
          )}
          {showHide && (
            <HideTokenButton
              mint={cleanMint}
              symbol={display.symbol}
              name={display.name}
            />
          )}
        </span>
      )}
    </div>
  );
  if (chartToken) {
    return (
      <TokenChartHover
        token={chartToken}
        live={chartLive}
        solPrice={chartSolPrice}
        block
        className={className}
        style={style}
      >
        {inner}
      </TokenChartHover>
    );
  }
  return inner;
}

function ConditionalTooltip({
  content,
  children,
}: {
  content: string | null;
  children: React.ReactElement;
}) {
  if (!content) return children;
  return <Tooltip content={content}>{children}</Tooltip>;
}

/* Small icon-button shared by the copy/hide actions inside TokenIdentity.
   Keeps both buttons visually identical (same size, hover treatment). */
function IconButton({
  onClick,
  title,
  ariaLabel,
  tone = "muted",
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  ariaLabel: string;
  tone?: "muted" | "success" | "danger";
  children: React.ReactNode;
}) {
  const colors =
    tone === "success"
      ? { fg: "var(--accent)", bg: "var(--accent-w)" }
      : tone === "danger"
        ? { fg: "var(--sell)", bg: "color-mix(in oklch, var(--sell) 14%, transparent)" }
        : { fg: "var(--paper-3)", bg: "transparent" };
  return (
    <Tooltip content={title}>
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="tap-target"
      style={{
        width: 22,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        color: colors.fg,
        background: colors.bg,
        flexShrink: 0,
        transition: "color 0.12s, background 0.12s",
      }}
      onMouseEnter={(e) => {
        if (tone === "muted") { e.currentTarget.style.background = "var(--ink-2)"; e.currentTarget.style.color = "var(--paper)"; }
      }}
      onMouseLeave={(e) => {
        if (tone === "muted") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--paper-3)"; }
      }}
    >
      {children}
    </button>
    </Tooltip>
  );
}

/* ─────────────────────────────────────────────────────────────
   HideTokenButton — toggles the token in the global hidden
   registry. Sits next to the copy button so every token surface
   gets the affordance for free.
   ───────────────────────────────────────────────────────────── */

function HideTokenButton({
  mint,
  symbol,
  name,
}: {
  mint: string;
  symbol?: string;
  name?: string;
}) {
  const { isHidden, hide, unhide } = useHiddenTokens();
  const { pushToast } = useApp();
  const hidden = isHidden(mint);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const label = symbol || name || shortAddr(mint, 6);
    if (hidden) {
      unhide(mint);
      pushToast({ title: "TOKEN UNHIDDEN", body: label, tone: "default" });
    } else {
      hide(mint, { symbol, name });
      pushToast({ title: "TOKEN HIDDEN", body: label, tone: "default" });
    }
  }

  return (
    <IconButton
      onClick={toggle}
      title={hidden ? "Unhide token" : "Hide token from lists"}
      ariaLabel={hidden ? "Unhide token" : "Hide token"}
      tone={hidden ? "danger" : "muted"}
    >
      {hidden ? Icon.eye(12) : Icon.eyeOff(12)}
    </IconButton>
  );
}

/* ─────────────────────────────────────────────────────────────
   WatchStarButton — toggles the token in the watchlist. Gold
   filled star when watched; outline star (→ fills gold on hover)
   otherwise.
   ───────────────────────────────────────────────────────────── */

function WatchStarButton({
  mint,
  symbol,
  name,
  image,
}: {
  mint: string;
  symbol?: string;
  name?: string;
  image?: string;
}) {
  const { isWatched, add, remove } = useWatchlist();
  const { pushToast } = useApp();
  const [hover, setHover] = useState(false);
  const watched = isWatched(mint);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const label = symbol || name || shortAddr(mint, 6);
    if (watched) {
      remove(mint);
      pushToast({ title: "REMOVED FROM WATCHLIST", body: label, tone: "default" });
    } else {
      add({ mint_address: mint, name: name ?? "", symbol: symbol ?? "", dex: "", image: image ?? null, created_at: "" });
      pushToast({ title: "ADDED TO WATCHLIST", body: label, tone: "default" });
    }
  }

  // Filled gold when watched or on hover ("ri-star-fill on hover"); otherwise a
  // quiet outline star.
  const filled = watched || hover;
  return (
    <Tooltip content={watched ? "Remove from watchlist" : "Add to watchlist"}>
      <button
        type="button"
        onClick={toggle}
        aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
        aria-pressed={watched}
        className="tap-target"
        onMouseEnter={(e) => { setHover(true); e.currentTarget.style.background = "var(--ink-2)"; }}
        onMouseLeave={(e) => { setHover(false); e.currentTarget.style.background = "transparent"; }}
        style={{
          width: 22, height: 22,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          borderRadius: 4, background: "transparent", border: 0,
          color: filled ? "#FACC15" : "var(--paper-3)",
          flexShrink: 0, cursor: "pointer",
          transition: "color 0.12s, background 0.12s",
        }}
      >
        {filled ? Icon.starFilled(13) : Icon.star(13)}
      </button>
    </Tooltip>
  );
}
