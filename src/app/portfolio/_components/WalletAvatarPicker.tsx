"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeWalletAvatarInput, walletDisplayGlyph } from "../../../lib/walletAvatar";
import { WalletAvatar } from "../../../components/WalletAvatar";
import type { WalletKind } from "../../../api/backend";

const QUICK_EMOJIS = ["🦊", "🔥", "💎", "🎯", "⚡", "🌙", "🐸", "🚀", "👻", "🎲"];

export function WalletAvatarPicker({
  open,
  anchorRect,
  walletId,
  label,
  kind,
  index,
  customGlyph,
  onSave,
  onClose,
}: {
  open: boolean;
  anchorRect: DOMRect | null;
  walletId: string;
  label: string;
  kind: WalletKind;
  index: number;
  customGlyph?: string | null;
  onSave: (glyph: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(customGlyph ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(customGlyph ?? "");
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, customGlyph, walletId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDoc = (e: MouseEvent) => {
      const el = document.getElementById(`wallet-avatar-picker-${walletId}`);
      if (el && !el.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, onClose, walletId]);

  if (!open || !anchorRect || typeof document === "undefined") return null;

  const preview = walletDisplayGlyph(label, normalizeWalletAvatarInput(draft));

  function commit(raw: string) {
    onSave(normalizeWalletAvatarInput(raw));
    onClose();
  }

  const top = Math.min(anchorRect.bottom + 6, window.innerHeight - 220);
  const left = Math.min(anchorRect.left, window.innerWidth - 248);

  return createPortal(
    <div
      id={`wallet-avatar-picker-${walletId}`}
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 10050,
        width: 236,
        padding: 12,
        borderRadius: 10,
        background: "var(--ink-1)",
        border: "1px solid var(--line-soft)",
        boxShadow: "var(--shadow-lg, 0 12px 40px rgba(0,0,0,0.45))",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <WalletAvatar
          label={label}
          kind={kind}
          index={index}
          customGlyph={preview}
          size={36}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--paper)" }}>Wallet avatar</div>
          <div style={{ fontSize: 10, color: "var(--paper-4)", marginTop: 2 }}>
            1–2 letters or one emoji
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(draft);
        }}
        placeholder="Auto from name"
        maxLength={8}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid var(--line-soft)",
          background: "var(--ink-0)",
          color: "var(--paper)",
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          outline: "none",
        }}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => commit(emoji)}
            style={{
              width: 30, height: 30, borderRadius: 6,
              border: "1px solid var(--line-soft)",
              background: "var(--ink-0)",
              fontSize: 16, cursor: "pointer", lineHeight: 1,
            }}
          >
            {emoji}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => { onSave(null); onClose(); }}
          style={{
            padding: "6px 10px", borderRadius: 6, fontSize: 11,
            border: "1px solid var(--line-soft)", background: "transparent",
            color: "var(--paper-3)", cursor: "pointer",
          }}
        >
          Auto
        </button>
        <button
          type="button"
          onClick={() => commit(draft)}
          style={{
            padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            border: "1px solid color-mix(in oklch, var(--accent) 50%, transparent)",
            background: "var(--accent-dim)", color: "var(--accent)", cursor: "pointer",
          }}
        >
          Save
        </button>
      </div>
    </div>,
    document.body,
  );
}
