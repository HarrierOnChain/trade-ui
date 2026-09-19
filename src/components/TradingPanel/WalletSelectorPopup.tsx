"use client";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, ChainIcon } from "../atoms";
import { fmtSol, shortAddr } from "../../lib/format";
import { getActiveChain } from "../../lib/chains";
import { useUserWallets, type UserWallet } from "../../hooks/useUserWallets";
import { WalletAvatar } from "../WalletAvatar";
import { readWalletAvatars } from "../../app/portfolio/_components/preferences";

const WALLET_PREFS_EVENT = "portfolio:wallet-prefs";

interface Props {
  anchorRef: React.RefObject<HTMLElement | null>;
  /** @deprecated retained for prop-compat with old call sites; not used. */
  mint?: string;
  /** @deprecated retained for prop-compat with old call sites; not used. */
  symbol?: string;
  onClose: () => void;
  /** When true, render inline (absolute over the parent) instead of via portal. */
  inline?: boolean;
  /** Optional rendered below the wallet list (e.g. account actions). */
  footer?: React.ReactNode;
}

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB";

export function WalletSelectorPopup({ anchorRef, onClose, inline = false, footer }: Props) {
  const userWallets = useUserWallets();
  const { activeIds, toggleActive } = userWallets;
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>(() => readWalletAvatars());

  useEffect(() => {
    const sync = () => setAvatars(readWalletAvatars());
    window.addEventListener(WALLET_PREFS_EVENT, sync);
    return () => window.removeEventListener(WALLET_PREFS_EVENT, sync);
  }, []);

  useEffect(() => {
    if (inline) return;
    const a = anchorRef.current;
    if (!a) return;
    const rect = a.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [anchorRef, inline]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (!popupRef.current) return;
      if (popupRef.current.contains(t)) return;
      if (anchorRef.current && anchorRef.current.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  const platformWallets = userWallets.wallets.filter((w) => w.kind === "PLATFORM");
  const demoWallet = userWallets.wallets.find((w) => w.kind === "DEMO") ?? null;
  const isDemoMode = demoWallet != null && activeIds.has(demoWallet.id);
  const activePlatformCount = platformWallets.filter((w) => activeIds.has(w.id)).length;
  const noPlatforms = platformWallets.length === 0;

  function selectLive() {
    if (demoWallet && activeIds.has(demoWallet.id)) toggleActive(demoWallet.id);
  }

  function selectDemo() {
    if (demoWallet) toggleActive(demoWallet.id);
  }

  if (!inline && !pos) return null;

  const body = (
    <div
      ref={popupRef}
      role="dialog"
      style={{
        position: inline ? "absolute" : "fixed",
        ...(inline
          ? { top: "calc(100% + 4px)", right: 0, minWidth: 300 }
          : { top: pos!.top, right: pos!.right, width: 300 }),
        zIndex: 10000,
        maxHeight: "min(480px, 75vh)",
        background: "var(--ink-1)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        boxShadow: "0 16px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "9px 12px 8px",
          borderBottom: "1px solid var(--line-soft)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.9,
            color: "var(--paper-3)",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          Wallets
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {demoWallet && (
            <div
              role="tablist"
              aria-label="Trading mode"
              style={{
                display: "inline-flex", gap: 2, padding: 2, borderRadius: 999,
                background: "var(--ink-2)", border: "1px solid var(--line-soft)",
              }}
            >
              {(["live", "demo"] as const).map((mode) => {
                const on = mode === "demo" ? isDemoMode : !isDemoMode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => (mode === "demo" ? selectDemo() : selectLive())}
                    style={{
                      padding: "3px 10px", borderRadius: 999, border: "none", cursor: "pointer",
                      fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                      fontFamily: "var(--font-mono)",
                      background: on ? (mode === "demo" ? "var(--gold, #ffb020)" : "var(--accent)") : "transparent",
                      color: on ? "var(--ink-0)" : "var(--paper-4)",
                      transition: "background 120ms, color 120ms",
                    }}
                  >
                    {mode === "live" ? "Live" : "Demo"}
                  </button>
                );
              })}
            </div>
          )}
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: 999,
              background: isDemoMode
                ? "rgba(255,176,32,0.11)"
                : activePlatformCount > 0 ? "rgba(242,200,107,0.11)" : "var(--ink-2)",
              color: isDemoMode
                ? "var(--gold, #ffb020)"
                : activePlatformCount > 0 ? "var(--amber, #F2C86B)" : "var(--paper-3)",
              border: `1px solid ${isDemoMode
                ? "rgba(255,176,32,0.24)"
                : activePlatformCount > 0 ? "rgba(242,200,107,0.24)" : "var(--line-soft)"}`,
              fontFamily: "var(--font-mono)",
              letterSpacing: 0.3,
              flexShrink: 0,
            }}
          >
            {isDemoMode ? "Paper" : `${activePlatformCount} / ${platformWallets.length}`}
          </span>
        </div>
      </div>

      {/* Wallet list */}
      <div
        style={{
          overflowY: "auto",
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {isDemoMode && demoWallet ? (
          <WalletRow
            wallet={demoWallet}
            index={0}
            active
            customGlyph={avatars[demoWallet.id] ?? null}
            sol={demoWallet.solBalance ?? userWallets.balances[demoWallet.id]?.sol ?? 0}
            tokens={userWallets.balances[demoWallet.id]?.tokens ?? {}}
            usdcBalance={demoWallet.usdcBalance ?? 0}
            onClick={() => {}}
          />
        ) : (
          <>
            {platformWallets.map((w, i) => (
              <WalletRow
                key={w.id}
                wallet={w}
                index={i}
                active={activeIds.has(w.id)}
                customGlyph={avatars[w.id] ?? null}
                sol={userWallets.balances[w.id]?.sol ?? 0}
                tokens={userWallets.balances[w.id]?.tokens ?? {}}
                onClick={() => toggleActive(w.id)}
              />
            ))}
            {noPlatforms && (
              <div
                style={{
                  margin: 14,
                  padding: 14,
                  border: "1px dashed var(--line-soft)",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "var(--paper-3)",
                  lineHeight: 1.6,
                  textAlign: "center",
                }}
              >
                {userWallets.loading
                  ? "Loading wallets…"
                  : "No platform wallets. Add one to trade without a Phantom prompt."}
              </div>
            )}
          </>
        )}
      </div>

      {footer && (
        <div
          style={{
            borderTop: "1px solid var(--line-soft)",
            padding: "6px 10px",
            flexShrink: 0,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );

  if (inline) return body;
  return createPortal(body, document.body);
}

function WalletRow({
  wallet,
  index,
  active,
  customGlyph,
  sol,
  tokens,
  usdcBalance,
  onClick,
}: {
  wallet: UserWallet;
  index: number;
  active: boolean;
  customGlyph: string | null;
  sol: number;
  tokens: Record<string, number>;
  usdcBalance?: number;
  onClick: () => void;
}) {
  const isDemo = wallet.kind === "DEMO";
  const accentColor = isDemo ? "#ffb020" : "var(--amber, #F2C86B)";

  const usdcBal = usdcBalance ?? tokens[USDC_MINT] ?? 0;
  const usd1Bal = tokens[USD1_MINT] ?? 0;
  const stableBal = usdcBal + usd1Bal;

  const baseBg = active
    ? isDemo
      ? "rgba(255,176,32,0.07)"
      : "rgba(242,200,107,0.05)"
    : "transparent";
  const hoverBg = active
    ? isDemo
      ? "rgba(255,176,32,0.12)"
      : "rgba(242,200,107,0.09)"
    : "var(--ink-2)";

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(wallet.pubkey);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: baseBg,
        borderLeft: `2px solid ${active ? accentColor : "transparent"}`,
        borderTop: 0,
        borderRight: 0,
        borderBottom: "1px solid var(--line-soft)",
        cursor: "pointer",
        color: "var(--paper)",
        width: "100%",
        textAlign: "left",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = baseBg)}
    >
      <WalletAvatar
        label={wallet.displayLabel}
        kind={wallet.kind}
        index={index}
        size={30}
        customGlyph={customGlyph}
        selected={active}
      />

      {/* Name + address */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: active ? "var(--paper)" : "var(--paper-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {wallet.displayLabel}
          </span>
          {isDemo && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 8,
                letterSpacing: 0.5,
                padding: "1px 4px",
                borderRadius: 3,
                background: "rgba(255,176,32,0.14)",
                color: "#ffb020",
                border: "1px solid rgba(255,176,32,0.3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              DEMO
            </span>
          )}
        </div>
        <span
          role="button"
          tabIndex={-1}
          onClick={copy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--paper-4)",
            transition: "color 100ms",
            lineHeight: 1,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--paper-2)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "var(--paper-4)")
          }
        >
          {shortAddr(wallet.pubkey, 5)}
          <span style={{ display: "inline-flex", lineHeight: 0, marginLeft: 1 }}>
            {Icon.copy(7)}
          </span>
        </span>
      </div>

      {/* Balances */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 2,
          flexShrink: 0,
        }}
      >
        {/* SOL — primary */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              lineHeight: 0,
              color: "var(--paper-3)",
            }}
          >
            <ChainIcon id={getActiveChain()} size={11} />
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              fontWeight: 700,
              color: active ? accentColor : "var(--paper-2)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmtSol(sol, 2)}
          </span>
        </div>

        {/* Stablecoin — secondary */}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: stableBal > 0.005 ? "var(--paper-3)" : "var(--paper-4)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {`$ ${
            stableBal >= 1e6
              ? `${(stableBal / 1e6).toFixed(2)}M`
              : stableBal.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
          }`}
        </span>
      </div>
    </button>
  );
}
