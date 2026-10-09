"use client";
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../atoms";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { viewportMaxWidth } from "../../lib/popover";

export interface TradeCategoryFilterProps<C extends string> {
  categories: readonly C[];
  labels: Record<C, string>;
  active: C | null;
  onChange: (next: C | null) => void;
  isDisabled?: (cat: C) => boolean;
  /** Shown in button title when a category is active. */
  filterTitle?: (label: string) => string;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={9}
      height={9}
      viewBox="0 0 10 10"
      aria-hidden
      style={{
        flexShrink: 0,
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 120ms ease, color 120ms ease",
        color: "var(--paper-4)",
      }}
    >
      <path
        d="M2 3.5L5 6.5L8 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Single-select wallet-category filter for transaction tables.
 * Only one of DEV / YOU may be active at a time.
 */
export function TradeCategoryFilter<C extends string>({
  categories,
  labels,
  active,
  onChange,
  isDisabled = () => false,
  filterTitle = (label) => `Filter transactions by ${label}`,
}: TradeCategoryFilterProps<C>) {
  const [open, setOpen] = useState(false);
  const isPhone = useIsPhone();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (cat: C | null) => {
    onChange(cat);
    setOpen(false);
  };

  const buttonLabel = active ? labels[active] : "Category";
  const anyEnabled = categories.some((c) => !isDisabled(c));
  const highlighted = open || active !== null;

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "center",
        padding: "6px 0",
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!anyEnabled}
        title={
          !anyEnabled
            ? "No wallets in these categories"
            : active
              ? filterTitle(labels[active])
              : "Filter transactions by wallet category"
        }
        onClick={() => anyEnabled && setOpen((o) => !o)}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 10px",
          borderRadius: 6,
          border: `1px solid ${
            highlighted
              ? "color-mix(in oklch, var(--accent) 50%, transparent)"
              : "var(--line-soft)"
          }`,
          background: "var(--ink-0)",
          boxShadow: highlighted
            ? "0 0 0 3px color-mix(in oklch, var(--accent) 8%, transparent)"
            : "inset 0 1px 0 color-mix(in oklch, black 20%, transparent)",
          color: !anyEnabled
            ? "var(--paper-4)"
            : highlighted
              ? "var(--paper)"
              : "var(--paper-3)",
          fontSize: 11.5,
          fontWeight: highlighted ? 600 : 500,
          letterSpacing: 0.2,
          fontFamily: "var(--font-mono, inherit)",
          cursor: anyEnabled ? "pointer" : "not-allowed",
          opacity: anyEnabled ? 1 : 0.5,
          transition: "border-color 120ms ease, box-shadow 120ms ease, color 120ms ease",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            flexShrink: 0,
            lineHeight: 0,
            color: highlighted ? "var(--accent)" : "var(--paper-4)",
            transition: "color 120ms ease",
          }}
        >
          {Icon.filter(11)}
        </span>
        <span style={{ whiteSpace: "nowrap" }}>{buttonLabel}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Wallet category filter"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            // Phone: shrink the floor width and clamp to the viewport so a
            // near-edge anchor can't push the menu off-screen. Desktop unchanged.
            minWidth: isPhone ? 120 : 148,
            maxWidth: isPhone ? viewportMaxWidth() : undefined,
            background: "var(--ink-1)",
            border: "1px solid var(--line-soft)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            padding: 4,
            zIndex: "var(--z-dropdown, 50)",
          }}
        >
          <MenuRow
            label="All"
            selected={active === null}
            onPick={() => pick(null)}
          />
          {categories.map((c) => {
            const disabled = isDisabled(c);
            const selected = active === c;
            return (
              <MenuRow
                key={c}
                label={labels[c]}
                selected={selected}
                disabled={disabled}
                title={disabled ? "No wallets in this category" : filterTitle(labels[c])}
                onPick={() => {
                  if (disabled) return;
                  pick(selected ? null : c);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function MenuRow({
  label,
  selected,
  disabled,
  title,
  onPick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  title?: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      title={title}
      onClick={onPick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "7px 10px",
        border: "none",
        borderRadius: 4,
        background: selected
          ? "color-mix(in oklch, var(--accent) 12%, transparent)"
          : "transparent",
        color: disabled ? "var(--paper-4)" : selected ? "var(--paper)" : "var(--paper-2)",
        fontSize: 11.5,
        fontWeight: selected ? 600 : 500,
        fontFamily: "var(--font-mono, inherit)",
        letterSpacing: 0.2,
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 100ms ease",
      }}
      onMouseEnter={(e) => {
        if (disabled || selected) return;
        e.currentTarget.style.background = "var(--ink-2)";
      }}
      onMouseLeave={(e) => {
        if (selected) {
          e.currentTarget.style.background = "color-mix(in oklch, var(--accent) 12%, transparent)";
        } else {
          e.currentTarget.style.background = "transparent";
        }
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          border: `1.5px solid ${selected ? "var(--accent)" : "var(--line-soft)"}`,
          background: selected ? "var(--accent)" : "transparent",
          flexShrink: 0,
        }}
      />
      {label}
    </button>
  );
}
