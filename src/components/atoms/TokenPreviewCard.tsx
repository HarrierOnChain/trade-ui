"use client";
import React from "react";
import { TokenIcon } from "./TokenIcon";
import type { TokenEvent } from "../../types";

/** Above these shares a holding is a risk, and shows red. */
const TOP10_RISK_PERCENT = 30;
const DEV_RISK_PERCENT = 10;

type Check = { label: string; value: boolean | null | undefined; good: boolean };
type Share = { label: string; value: number | null | undefined; risk: number };

function Verdict({ value, good }: { value: boolean | null | undefined; good: boolean }) {
  if (value == null) return <span style={{ color: "var(--paper-4)" }}>—</span>;
  const ok = value === good;
  return (
    <span style={{ color: ok ? "var(--buy)" : "var(--sell)" }}>
      {ok ? "✓" : "✗"} {value ? "Yes" : "No"}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
      <span style={{ color: "var(--paper-2)" }}>{label}</span>
      <span className="mono" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{children}</span>
    </div>
  );
}

/**
 * What hovering a token's logo shows: the logo large, its ticker and name,
 * and the contract checks and holder shares the API measured (Solana: mint
 * and freeze authority; EVM: ownership, honeypot, taxes). Unmeasured is "—".
 */
export function TokenPreviewCard({ token: t, size = 232 }: { token: TokenEvent; size?: number }) {
  const evm = /^0x/i.test(t.mint_address);
  const checks: Check[] = evm
    ? [
        { label: "Ownership renounced", value: t.ownershipRenounced, good: true },
        { label: "Honeypot", value: t.honeypot, good: false },
      ]
    : [
        { label: "Mint authority renounced", value: t.mintRenounced, good: true },
        { label: "Freeze authority renounced", value: t.freezeRenounced, good: true },
      ];
  const shares: Share[] = [
    { label: "Top 10 holders", value: t.top10Percent, risk: TOP10_RISK_PERCENT },
    { label: "Dev holds", value: t.devPercent, risk: DEV_RISK_PERCENT },
  ];
  const taxed = evm && (t.buyTaxPercent != null || t.sellTaxPercent != null);
  const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(v < 10 ? 1 : 0)}%`);

  return (
    <div style={{ width: size, display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
      <div style={{ width: size, height: size, borderRadius: 10, overflow: "hidden", background: "var(--ink-1)" }}>
        <TokenIcon token={{ mint_address: t.mint_address, symbol: t.symbol, image: t.image, chain: t.chain }} size={size} />
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--paper)", whiteSpace: "nowrap" }}>{t.symbol || "—"}</span>
        <span style={{ fontSize: 12, color: "var(--paper-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t.name}
        </span>
      </div>
      <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 6, fontSize: 11.5 }}>
        {checks.map((c) => (
          <Row key={c.label} label={c.label}><Verdict value={c.value} good={c.good} /></Row>
        ))}
        {taxed && (
          <Row label="Buy / sell tax">
            <span style={{ color: (t.buyTaxPercent ?? 0) > 0 || (t.sellTaxPercent ?? 0) > 0 ? "var(--gold, var(--paper))" : "var(--buy)" }}>
              {pct(t.buyTaxPercent)} / {pct(t.sellTaxPercent)}
            </span>
          </Row>
        )}
        {shares.map((s) => (
          <Row key={s.label} label={s.label}>
            <span style={{ color: s.value == null ? "var(--paper-4)" : s.value > s.risk ? "var(--sell)" : "var(--buy)" }}>
              {pct(s.value)}
            </span>
          </Row>
        ))}
      </div>
    </div>
  );
}
