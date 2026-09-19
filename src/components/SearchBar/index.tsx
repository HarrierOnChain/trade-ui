"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useClientNav } from "../shell/ClientPages";
import { fetchSearchWithMetadataFallback, looksLikeSolanaAddress } from "../../api/search";
import { tokenHref } from "../../lib/tokenHref";
import { useApp } from "../../contexts/AppContext";
import { ChainIcon, TokenIdentity } from "../atoms";
import { isChainId } from "../../lib/chains";
import type { SearchResult } from "../../types";
import styles from "./styles.module.css";

export function SearchBar() {
  const { navigate } = useClientNav();
  const { openWalletModal } = useApp();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback((q: string) => {
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    fetchSearchWithMetadataFallback(q, 10)
      .then((res) => {
        setResults(res.data ?? []);
        setOpen(true);
      })
      .catch(() => { setResults([]); setOpen(true); })
      .finally(() => setLoading(false));
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    setActive(-1);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(v), 300);
  }

  function select(mint: string, chain?: string) {
    setOpen(false);
    setQuery("");
    setResults([]);
    navigate(tokenHref(mint, chain));
  }

  function selectWallet(address: string) {
    setOpen(false);
    setQuery("");
    setResults([]);
    openWalletModal(address);
  }

  function looksLikeAddress(s: string): boolean {
    return looksLikeSolanaAddress(s);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      // If user pasted a raw address and there are no token matches, go to wallet page
      if (active < 0 && results.length === 0 && looksLikeAddress(query)) {
        e.preventDefault();
        selectWallet(query.trim());
        return;
      }
      if (active >= 0 && results[active]) {
        e.preventDefault();
        select(results[active].mint, results[active].chain);
      }
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    }
  }

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <input
        className={styles.input}
        type="text"
        placeholder="Search token or paste address..."
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {loading && <span className={styles.spinner} />}

      {open && results.length > 0 && (
        <div className={styles.dropdown}>
          {results.map((r, i) => (
            <div
              key={`${r.chain ?? ""}:${r.mint}`}
              role="button"
              tabIndex={0}
              className={`${styles.row} ${i === active ? styles.rowActive : ""}`}
              onClick={() => select(r.mint, r.chain)}
              onMouseEnter={() => setActive(i)}
            >
              <TokenIdentity
                mint={r.mint}
                chain={r.chain}
                symbol={r.symbol}
                name={r.name}
                platform={r.platform}
                showImage
                compact
                size="xs"
                onOpen={() => select(r.mint, r.chain)}
                chartToken={{ mint_address: r.mint, chain: r.chain, name: r.name, symbol: r.symbol, dex: r.platform, created_at: r.created_at ?? "" }}
              />
              {r.chain && isChainId(r.chain) && (
                <span style={{ marginLeft: "auto", display: "inline-flex", opacity: 0.8 }} title={r.chain}>
                  <ChainIcon id={r.chain} size={12} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {open && !loading && query.length >= 2 && results.length === 0 && (
        <div className={styles.dropdown}>
          {looksLikeAddress(query) ? (
            <button
              className={styles.row}
              onMouseDown={() => selectWallet(query.trim())}
            >
              <span className={styles.symbol}>WALLET</span>
              <span className={styles.name}>Open wallet page</span>
              <span className={styles.mint}>
                {query.slice(0, 4)}...{query.slice(-4)}
              </span>
            </button>
          ) : (
            <div className={styles.empty}>No results</div>
          )}
        </div>
      )}
    </div>
  );
}
