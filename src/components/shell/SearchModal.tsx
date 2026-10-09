"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Icon } from "../atoms";
import { TokenRow } from "../TokenRow";
import { useApp } from "../../contexts/AppContext";
import { useClientNav } from "./ClientPages";
import { lockNow } from "./LockGate";
import { fetchSearchWithMetadataFallback, looksLikeSolanaAddress } from "../../api/search";
import { useTokenEnrichment } from "../../hooks/useTokenEnrichment";
import { useLiveTradePrices } from "../../hooks/useLiveTradePrices";
import { useSolPrice } from "../../hooks/useSolPrice";
import type { SearchResult, TokenEvent } from "../../types";
import { tokenHref } from "../../lib/tokenHref";
import { WalletLabel } from "../../hooks/useWalletLabels";
import { useIsPhone } from "../../hooks/useMediaQuery";

function searchResultToTokenEvent(r: SearchResult): TokenEvent {
  return {
    mint_address: r.mint,
    chain: r.chain,
    name: r.name,
    symbol: r.symbol,
    dex: r.platform,
    // The API's search rows carry the image, market cap and price already.
    image: r.image ?? null,
    marketCap: r.marketCap,
    lastPrice: r.lastPrice,
    created_at: r.created_at ?? r.time ?? "",
  };
}

export function SearchModal() {
  const { searchOpen, setSearchOpen, openWalletModal } = useApp();
  const { navigate } = useClientNav();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [tokens, setTokens] = useState<TokenEvent[]>([]);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const solPrice = useSolPrice();

  useEffect(() => {
    if (!searchOpen) return;
    setQ("");
    setResults([]);
    setTokens([]);
    setActive(0);
    setTimeout(() => ref.current?.focus(), 50);
  }, [searchOpen]);

  useEffect(() => {
    if (!q.trim()) { setResults([]); setTokens([]); return; }
    let cancelled = false;
    fetchSearchWithMetadataFallback(q).then((r) => {
      if (!cancelled) {
        const seen = new Set<string>();
        const deduped = r.data.filter((x) => {
          if (seen.has(x.mint)) return false;
          seen.add(x.mint);
          return true;
        });
        setResults(deduped);
        setTokens(deduped.map(searchResultToTokenEvent));
        setActive(0);
      }
    }).catch(() => {
      if (!cancelled) { setResults([]); setTokens([]); }
    });
    return () => { cancelled = true; };
  }, [q]);

  const hasQuery = q.trim().length > 0;
  const trimmedQuery = q.trim();
  const list = hasQuery ? results : [];
  const walletCandidate = hasQuery && list.length === 0 && looksLikeSolanaAddress(trimmedQuery);

  const visibleMints = useMemo(() => tokens.map((t) => t.mint_address), [tokens]);
  useTokenEnrichment(tokens, setTokens, 20);
  const liveMap = useLiveTradePrices(visibleMints);

  const actions: Array<{ id: string; icon: React.ReactNode; label: string; hint: string; run: () => void }> = [
    { id: "monitor", icon: Icon.deploy(12), label: "Go to Monitor", hint: "G M", run: () => { setSearchOpen(false); navigate("/monitor"); } },
    { id: "portfolio", icon: Icon.portfolio(12), label: "Go to Portfolio", hint: "G P", run: () => { setSearchOpen(false); navigate("/portfolio"); } },
    { id: "wallets", icon: Icon.wallet(12), label: "Go to Wallets", hint: "G W", run: () => { setSearchOpen(false); navigate("/wallets"); } },
    { id: "swap", icon: Icon.swap(12), label: "Go to Swap", hint: "G S", run: () => { setSearchOpen(false); navigate("/swap"); } },
    { id: "lock", icon: Icon.lock(12), label: "Lock Trade UI", hint: "", run: () => { setSearchOpen(false); void lockNow(); } },
  ];

  function pick(mint: string) {
    setSearchOpen(false);
    const hit = tokens.find((t) => t.mint_address === mint);
    navigate(tokenHref(mint, hit?.chain));
  }

  function pickWallet(address: string) {
    setSearchOpen(false);
    openWalletModal(address);
  }

  const isPhone = useIsPhone();

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter" && list[active]) { e.preventDefault(); pick(list[active].mint); }
    if (e.key === "Enter" && walletCandidate) { e.preventDefault(); pickWallet(trimmedQuery); }
  }

  return (
    <Modal open={searchOpen} onClose={() => setSearchOpen(false)} width={560} align="top" mobileVariant={isPhone ? "sheet" : "center"}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "14px 16px",
        borderBottom: "1px solid var(--line-soft)",
      }}>
        <span style={{ color: "var(--paper-3)" }}>{Icon.search(16)}</span>
        <input
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search tokens, wallets, contracts…"
          style={{
            flex: 1, background: "transparent", border: 0, outline: 0,
            fontSize: 14, color: "var(--paper)",
          }}
        />
        {!isPhone && <span className="kbd">esc</span>}
      </div>

      <div className="app-scroll" style={{ overflow: "auto", maxHeight: isPhone ? "60dvh" : 440 }}>
        {!hasQuery && (
          <div style={{ padding: "6px 10px" }}>
            <div className="eyebrow" style={{ padding: "10px 8px 4px" }}>ACTIONS</div>
            {actions.map((a) => (
              <button
                key={a.id}
                onClick={a.run}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", textAlign: "left",
                  padding: "9px 10px",
                  borderRadius: 4,
                  fontSize: 13, color: "var(--paper-2)",
                  background: "transparent",
                  transition: "background 120ms",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ink-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ color: "var(--paper-3)" }}>{a.icon}</span>
                <span style={{ flex: 1 }}>{a.label}</span>
                {a.hint && <span className="kbd">{a.hint}</span>}
              </button>
            ))}
          </div>
        )}

        {walletCandidate && (
          <button
            onClick={() => pickWallet(trimmedQuery)}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 16px", width: "100%",
              background: "transparent",
              borderLeft: "2px solid var(--accent)",
              textAlign: "left",
            }}
          >
            <span style={{
              width: 28, height: 28,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              borderRadius: 4,
              color: "var(--paper-3)",
              background: "var(--ink-2)",
            }}>
              {Icon.wallet(13)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>WALLET</span>
                <span style={{ fontSize: 12, color: "var(--paper-2)" }}>Open wallet</span>
              </div>
              <div className="mono" style={{ marginTop: 2, fontSize: 10, color: "var(--paper-3)" }}>
                <WalletLabel address={trimmedQuery} chars={6} />
              </div>
            </div>
            <span style={{ color: "var(--paper-4)" }}>{Icon.arrowUp(10)}</span>
          </button>
        )}

        {hasQuery && list.length === 0 && !walletCandidate && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--paper-4)", fontSize: 12 }}>
            No matches for “{q}”
          </div>
        )}

        {hasQuery && list.length > 0 && (
          <div className="eyebrow" style={{ padding: "10px 16px 6px" }}>Results</div>
        )}

        {tokens.map((t, i) => (
          <TokenRow
            key={`${t.chain ?? ""}:${t.mint_address}`}
            t={t}
            variant="trending"
            live={liveMap.get(t.mint_address)}
            solPrice={solPrice ?? undefined}
            active={i === active}
            onClick={pick}
          />
        ))}
      </div>

      {!isPhone && (
        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          padding: "10px 16px",
          borderTop: "1px solid var(--line-soft)",
          fontSize: 10, color: "var(--paper-4)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.05em",
        }}>
          <span><span className="kbd">↑↓</span> navigate</span>
          <span><span className="kbd">↵</span> open</span>
          <span><span className="kbd">esc</span> close</span>
        </div>
      )}
    </Modal>
  );
}
