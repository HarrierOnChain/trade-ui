"use client";
import React, { memo } from "react";

export interface TabButtonProps {
  label: string;
  isActive: boolean;
  isEditMode: boolean;
  onClick: () => void;
}

function TabButtonInner({ label, isActive, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "5px 10px",
        fontSize: 11, fontFamily: "var(--font-mono)",
        color: isActive ? "var(--paper)" : "var(--paper-3)",
        background: isActive ? "var(--ink-2)" : "var(--ink-1)",
        border: `1px solid ${isActive ? "var(--paper-4)" : "var(--line-soft)"}`,
        borderRadius: 3,
        cursor: "pointer",
        letterSpacing: "0.04em",
        transition: "background 120ms, border-color 120ms, color 120ms",
      }}
    >
      {label}
    </button>
  );
}

export const TabButton = memo(TabButtonInner);
