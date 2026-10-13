"use client";
/**
 * Pick a Solana token for the swap: the curated list at once, search by name,
 * symbol or mint through the market-data API, or any pasted mint.
 */
import React, { useEffect, useState } from "react";
import { Modal, ModalHeader, TokenIcon } from "../atoms";
import { fetchSearchWithMetadataFallback } from "../../api/search";
import { MINT_RE } from "../../lib/swap/quote";
import { shortAddr } from "../../lib/format";
import { KNOWN_TOKENS, learnToken, type SwapToken } from "./tokens";
import { useTokenImages } from "../../hooks/useTokenImages";

export function TokenPicker({
  open,
  exclude,
  onPick,
  onClose,
}: {
  open: boolean;
  exclude: string;
  onPick: (t: SwapToken) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SwapToken[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setRows(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      fetchSearchWithMetadataFallback(text, 20)
        .then((res) => {
          if (cancelled) return;
          const found: SwapToken[] = (res.data ?? [])
            .filter((r) => (!r.chain || r.chain === "sol") && MINT_RE.test(r.mint))
            .map((r) => ({
              mint: r.mint,
              symbol: r.symbol || shortAddr(r.mint, 4),
              name: r.name,
              image: r.image ?? null,
              priceSol: typeof r.lastPrice === "number" ? r.lastPrice : null,
            }));
          // A pasted mint the index does not know is still tradable.
          if (MINT_RE.test(text) && !found.some((r) => r.mint === text)) {
            found.unshift({ mint: text, symbol: shortAddr(text, 4) });
          }
          setRows(found);
        })
        .catch(() => {
          if (!cancelled) setRows(MINT_RE.test(text) ? [{ mint: text, symbol: shortAddr(text, 4) }] : []);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const list = (rows ?? KNOWN_TOKENS).filter((t) => t.mint !== exclude);
  // Rows without an image (the curated list, a pasted mint): the API's logos.
  const logo = useTokenImages("sol", list.filter((t) => !t.image).map((t) => t.mint));

  return (
    <Modal open={open} onClose={onClose} width={420}>
      <ModalHeader title="Select a token" onClose={onClose} />
      <div style={{ padding: "0 16px 12px" }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, symbol, or paste a mint"
          aria-label="Search tokens"
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "var(--ink-0)",
            border: "1px solid var(--line-soft)",
            borderRadius: 6,
            color: "var(--paper)",
            fontSize: 13,
            outline: "none",
          }}
        />
      </div>
      <div style={{ maxHeight: 380, overflowY: "auto", borderTop: "1px solid var(--line-soft)" }}>
        {loading && rows === null && <Note>Searching…</Note>}
        {rows !== null && list.length === 0 && !loading && <Note>No Solana token matches.</Note>}
        {list.map((t) => (
          <button
            key={t.mint}
            type="button"
            onClick={() => {
              const picked = t.image ? t : { ...t, image: logo(t.mint) };
              learnToken(picked);
              onPick(picked);
            }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "9px 16px",
              background: "transparent", border: 0, borderBottom: "1px solid var(--line-soft)",
              color: "var(--paper)", cursor: "pointer", textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ink-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <TokenIcon token={{ mint_address: t.mint, symbol: t.symbol, image: t.image ?? logo(t.mint) ?? undefined, chain: "sol" }} size={24} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t.symbol}</span>
              <span style={{ fontSize: 11, color: "var(--paper-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.name ?? ""}
              </span>
            </span>
            <span style={{ marginLeft: "auto", fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--paper-4)" }}>
              {shortAddr(t.mint, 4)}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 16, fontSize: 12, color: "var(--paper-3)", textAlign: "center" }}>{children}</div>;
}
