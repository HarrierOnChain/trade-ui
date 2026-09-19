"use client";

// Wizard-style editors for the automation surface.
//
// Each modal opens with a serif headline + KindChip kicker, then breaks
// the body into rounded SectionCards (Identity → Mode → Sizing → Regions
// → Advanced). The legacy single-column FieldRow layout has been
// retired in favour of vertical fields with explicit eyebrows and
// roomy inputs.

import React, { useEffect, useMemo, useState } from "react";
import { Btn, Modal, ModalCloseButton, ModalFooter } from "../../../components/atoms";
import {
  useBackend,
  EMPTY_AUTOSELL,
  EMPTY_AUTOBUY,
  parseAutosellConfig,
  parseAutobuyConfig,
  type AutosellConfig,
  type AutobuyConfig,
  type Position,
  type WalletList,
  type Sniper,
  type SniperCreateBody,
} from "../../../api/backend";
import { useApp } from "../../../contexts/AppContext";
import { useUserWallets } from "../../../hooks/useUserWallets";
import { useIsPhone } from "../../../hooks/useMediaQuery";
import {
  SectionCard, Field, FieldGrid, TextInput, NumberInput, Select,
  Toggle, Segmented, PillToggle, ChipInput, PhaseLadder,
  KindChip, shortAddr, AUTO_LABEL,
  type DipPhase, type PyramidPhase,
} from "./atoms";

// ── Modal shell ──────────────────────────────────────────────────────

function FormShell({
  kicker, title, onClose, children, footer, width = 680,
}: {
  kicker?: React.ReactNode;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  width?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: "85vh" }}>
      <header style={{
        padding: "14px 20px",
        borderBottom: "1px solid var(--line-soft)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        flexShrink: 0, background: "var(--ink-1)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          {kicker && <div>{kicker}</div>}
          <span style={{
            fontSize: 14, fontWeight: 600, lineHeight: 1.1,
            color: "var(--paper)", letterSpacing: "-0.01em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{title}</span>
        </div>
        <ModalCloseButton onClose={onClose} />
      </header>
      <div style={{
        padding: "16px 20px",
        overflow: "auto",
        display: "flex", flexDirection: "column", gap: 14,
        background: "var(--ink-1)",
        flex: 1, minHeight: 0,
      }}>{children}</div>
      <ModalFooter>{footer}</ModalFooter>
      {/* Hidden marker so the shell width prop is exercised when used via Modal. */}
      <span style={{ display: "none" }} aria-hidden>{width}</span>
    </div>
  );
}

// ── Autosell editor ──────────────────────────────────────────────────

export function AutosellEditor({
  initial, onSave, onCancel,
}: {
  initial: AutosellConfig;
  onSave: (cfg: AutosellConfig) => Promise<void>;
  onCancel?: () => void;
}) {
  const [cfg, setCfg] = useState<AutosellConfig>(initial ?? EMPTY_AUTOSELL);
  const [busy, setBusy] = useState(false);

  function patch(p: Partial<AutosellConfig>) { setCfg((c) => ({ ...c, ...p })); }

  return (
    <>
      <SectionCard
        eyebrow="Status"
        title="Enable autosell"
        hint="Engine watches each price tick and fills ladder steps as triggers are crossed. Disabled rules stay attached but don't fire."
      >
        <Toggle
          value={cfg.enabled}
          onChange={(b) => patch({ enabled: b })}
          label="Run autosell on this position"
          hint={cfg.enabled ? "Ladder is armed. Triggers fire one-by-one in order." : "Save without enabling to keep the config but pause execution."}
        />
      </SectionCard>

      <SectionCard
        eyebrow="Profit"
        title="Take-profit ladder"
        hint="Each step sells a percentage of the remaining bag when the price has gained X%. Steps fire in order from the lowest gain."
      >
        <PhaseLadder
          phases={cfg.tpPhases}
          onChange={(p) => patch({ tpPhases: p })}
          variant="tp"
          onAdd={() => patch({ tpPhases: [...cfg.tpPhases, { gainPct: 50, sellPct: 50 }] })}
          addLabel="Add TP step"
        />
      </SectionCard>

      <SectionCard
        eyebrow="Risk"
        title="Stop-loss ladder"
        hint="Triggers fire when price drops by X% below entry. Typically the last step is a 100% cut to fully exit."
      >
        <PhaseLadder
          phases={cfg.slPhases}
          onChange={(p) => patch({ slPhases: p })}
          variant="sl"
          onAdd={() => patch({ slPhases: [...cfg.slPhases, { lossPct: 30, sellPct: 100 }] })}
          addLabel="Add SL step"
        />
      </SectionCard>

      <SectionCard eyebrow="Dynamic" title="Trailing stop" hint="Arm once price has crossed your highest gain. Fires when price retraces X% from the high.">
        <Toggle
          value={cfg.trailingStopLoss}
          onChange={(b) => patch({ trailingStopLoss: b })}
          label="Arm trailing stop"
          hint="Trails after price has reached new highs."
        />
        {cfg.trailingStopLoss && (
          <FieldGrid cols={2}>
            <Field label="Trail distance" hint="Sell triggers if price falls this far below the running high.">
              <NumberInput
                value={cfg.trailingStopLossPct}
                onChange={(n) => patch({ trailingStopLossPct: n })}
                min={1} max={99} step={1} suffix="% below high"
              />
            </Field>
            <Field label="Sell size" hint="Portion of the bag to sell when the trail fires.">
              <NumberInput
                value={cfg.trailingStopLossSellPct}
                onChange={(n) => patch({ trailingStopLossSellPct: n })}
                min={1} max={100} step={1} suffix="% of bag"
              />
            </Field>
          </FieldGrid>
        )}
      </SectionCard>

      <SectionCard eyebrow="Event" title="Migration auto-dump" hint="Pre-emptively exit when the token migrates to a new venue, before liquidity reshuffles.">
        <Toggle
          value={cfg.migrationSell}
          onChange={(b) => patch({ migrationSell: b })}
          label="Auto-dump on migration"
        />
        {cfg.migrationSell && (
          <Field label="Sell size">
            <NumberInput
              value={cfg.migrationSellPct}
              onChange={(n) => patch({ migrationSellPct: n })}
              min={1} max={100} step={1} suffix="% of bag"
            />
          </Field>
        )}
      </SectionCard>

      <FooterActions
        onCancel={onCancel}
        primaryLabel={busy ? "Saving…" : "Save autosell"}
        disabled={busy}
        onPrimary={async () => {
          setBusy(true);
          try { await onSave(cfg); } finally { setBusy(false); }
        }}
      />
    </>
  );
}

export function PositionAutosellModal({
  position, open, onClose, onSaved,
}: {
  position: Position;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const client = useBackend();
  const { pushToast } = useApp();

  const initial = useMemo<AutosellConfig>(
    () => parseAutosellConfig(position.autosellConfig),
    [position],
  );

  return (
    <Modal open={open} onClose={onClose} width={680} align="top" mobileVariant="sheet">
      <FormShell
        kicker={<KindChip kind="AUTOSELL" />}
        title={`${AUTO_LABEL.autosell} · ${position.symbol ?? shortAddr(position.mint)}`}
        onClose={onClose}
        footer={null}
      >
        <PositionSubhead position={position} />
        <AutosellEditor
          initial={initial}
          onCancel={onClose}
          onSave={async (cfg) => {
            try {
              await client.setPositionAutosell(position.id, cfg);
              pushToast({ title: `${AUTO_LABEL.autosell} saved`, body: position.symbol ?? position.mint.slice(0, 6), tone: "buy" });
              await onSaved();
              onClose();
            } catch (e) {
              pushToast({ title: "SAVE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
            }
          }}
        />
      </FormShell>
    </Modal>
  );
}

// ── Autobuy editor ───────────────────────────────────────────────────

export function AutobuyEditor({
  initial, onSave, onCancel,
}: {
  initial: AutobuyConfig;
  onSave: (cfg: AutobuyConfig) => Promise<void>;
  onCancel?: () => void;
}) {
  const [cfg, setCfg] = useState<AutobuyConfig>(initial ?? EMPTY_AUTOBUY);
  const [busy, setBusy] = useState(false);

  function patch(p: Partial<AutobuyConfig>) { setCfg((c) => ({ ...c, ...p })); }

  return (
    <>
      <SectionCard
        eyebrow="Status"
        title="Enable autobuy"
        hint="Run dip-buy and pyramid ladders against the live price. Disabled rules stay attached but don't fire."
      >
        <Toggle
          value={cfg.enabled}
          onChange={(b) => patch({ enabled: b })}
          label="Run autobuy on this position"
        />
      </SectionCard>

      <SectionCard
        eyebrow="Average down"
        title="Dip-buy ladder"
        hint="Buy more when price retraces. Each step adds SOL exposure at a successive drawdown."
      >
        <PhaseLadder<DipPhase>
          phases={cfg.dipPhases}
          onChange={(p) => patch({ dipPhases: p as DipPhase[] })}
          variant="dip"
          onAdd={() => patch({ dipPhases: [...cfg.dipPhases, { lossPct: 15, buySol: 0.1 }] })}
          addLabel="Add dip step"
        />
      </SectionCard>

      <SectionCard
        eyebrow="Pyramid"
        title="Add-on ladder"
        hint="Buy more as price climbs. Lets you scale into a winner without going all-in at entry."
      >
        <PhaseLadder<PyramidPhase>
          phases={cfg.pyramidPhases}
          onChange={(p) => patch({ pyramidPhases: p as PyramidPhase[] })}
          variant="pyramid"
          onAdd={() => patch({ pyramidPhases: [...cfg.pyramidPhases, { gainPct: 50, buySol: 0.1 }] })}
          addLabel="Add pyramid step"
        />
      </SectionCard>

      <SectionCard
        eyebrow="Dynamic"
        title="Trailing buy"
        hint="Wait for a drop, then enter only once price has recovered — proxy for a 'bottoming' signal."
      >
        <Toggle
          value={cfg.trailingBuy}
          onChange={(b) => patch({ trailingBuy: b })}
          label="Arm trailing buy"
        />
        {cfg.trailingBuy && (
          <FieldGrid cols={3}>
            <Field label="Arm drop" hint="% below the recent high needed to arm.">
              <NumberInput value={cfg.trailingBuyArmDropPct} onChange={(n) => patch({ trailingBuyArmDropPct: n })} min={1} max={99} step={1} suffix="%" />
            </Field>
            <Field label="Recovery" hint="% bounce off the local low needed to fire.">
              <NumberInput value={cfg.trailingBuyRecoveryPct} onChange={(n) => patch({ trailingBuyRecoveryPct: n })} min={1} max={99} step={1} suffix="%" />
            </Field>
            <Field label="Buy size">
              <NumberInput value={cfg.trailingBuySol} onChange={(n) => patch({ trailingBuySol: n })} min={0} step={0.05} suffix="SOL" />
            </Field>
          </FieldGrid>
        )}
      </SectionCard>

      <SectionCard eyebrow="Limits" title="Safety">
        <FieldGrid cols={2}>
          <Field label="Spend cap" hint="Total SOL the engine is allowed to deploy across all ladder fills. 0 = no cap.">
            <NumberInput
              value={cfg.maxTotalBuySol ?? 0}
              onChange={(n) => patch({ maxTotalBuySol: n > 0 ? n : undefined })}
              min={0} step={0.1} suffix="SOL"
            />
          </Field>
          <Field label="Pause after stop-loss" hint="Recommended — avoids averaging into a failing position.">
            <Toggle
              value={cfg.pauseOnSlFire}
              onChange={(b) => patch({ pauseOnSlFire: b })}
              label="Skip dip-buys after an SL fires"
            />
          </Field>
        </FieldGrid>
      </SectionCard>

      <FooterActions
        onCancel={onCancel}
        primaryLabel={busy ? "Saving…" : "Save autobuy"}
        disabled={busy}
        onPrimary={async () => {
          setBusy(true);
          try { await onSave(cfg); } finally { setBusy(false); }
        }}
      />
    </>
  );
}

export function PositionAutobuyModal({
  position, open, onClose, onSaved,
}: {
  position: Position;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const client = useBackend();
  const { pushToast } = useApp();

  const initial = useMemo<AutobuyConfig>(
    () => parseAutobuyConfig(position.autobuyConfig),
    [position],
  );

  return (
    <Modal open={open} onClose={onClose} width={680} align="top" mobileVariant="sheet">
      <FormShell
        kicker={<KindChip kind="AUTOBUY" />}
        title={`${AUTO_LABEL.autobuy} · ${position.symbol ?? shortAddr(position.mint)}`}
        onClose={onClose}
        footer={null}
      >
        <PositionSubhead position={position} />
        <AutobuyEditor
          initial={initial}
          onCancel={onClose}
          onSave={async (cfg) => {
            try {
              await client.setPositionAutobuy(position.id, cfg);
              pushToast({ title: `${AUTO_LABEL.autobuy} saved`, body: position.symbol ?? position.mint.slice(0, 6), tone: "buy" });
              await onSaved();
              onClose();
            } catch (e) {
              pushToast({ title: "SAVE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
            }
          }}
        />
      </FormShell>
    </Modal>
  );
}

function PositionSubhead({ position }: { position: Position }) {
  return (
    <div style={{
      display: "flex", gap: 16, padding: "10px 14px",
      background: "var(--ink-1)", border: "1px solid var(--line-soft)",
      borderRadius: 10, flexWrap: "wrap",
    }}>
      <Stat label="Wallet" value={position.wallet.label ?? shortAddr(position.wallet.pubkey)} mono />
      <Stat label="Entry" value={position.entryPriceSol.toFixed(8)} mono />
      <Stat label="Spent" value={`${position.totalBuySolSpent.toFixed(4)} ◎`} mono />
      <Stat label="Tokens" value={position.totalTokens.toFixed(2)} mono />
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="eyebrow" style={{ fontSize: 9 }}>{label}</span>
      <span style={{
        fontSize: 12, color: "var(--paper)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        fontVariantNumeric: "tabular-nums",
      }}>{value}</span>
    </div>
  );
}

function FooterActions({
  onCancel, onPrimary, primaryLabel, disabled,
}: {
  onCancel?: () => void;
  onPrimary: () => void | Promise<void>;
  primaryLabel: string;
  disabled?: boolean;
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "flex-end", gap: 8,
      paddingTop: 8, borderTop: "1px solid var(--line-soft)",
      marginTop: 4,
    }}>
      {onCancel && <Btn size="sm" onClick={onCancel}>Cancel</Btn>}
      <Btn tone="primary" size="sm" disabled={disabled} onClick={() => void onPrimary()}>
        {primaryLabel}
      </Btn>
    </div>
  );
}

// ── sniper form ─────────────────────────────────────────────────────

interface SniperFormState {
  name: string;
  snipe: boolean;
  copy: boolean;
  walletId: string;
  walletListId: string;
  buyMode: "fixed" | "multiplier" | "dynamic";
  buySol: number;
  buyMultiplier: number;
  amountMin: number;
  amountMax: number;
  firstPurchase: boolean;
  tokenPurchaseLimit: boolean;
  mintWhitelist: string[];
  mintBlacklist: string[];
  regions: string[];
  tx: {
    slippageMode: "percent" | "bps";
    slippage: number;
    altSlippage: number;
    gas: number;
    altGas: number;
    tip: number;
    altTip: number;
    highGasLowTip: boolean;
    computeUnits: number;
    noTipLanders: boolean;
  };
}

const DEFAULT_FORM: SniperFormState = {
  name: "",
  snipe: true,
  copy: false,
  walletId: "",
  walletListId: "",
  buyMode: "fixed",
  buySol: 0.5,
  buyMultiplier: 1,
  amountMin: 0,
  amountMax: 4,
  firstPurchase: false,
  tokenPurchaseLimit: false,
  mintWhitelist: [],
  mintBlacklist: [],
  regions: [],
  tx: {
    slippageMode: "percent",
    slippage: 30,
    altSlippage: 30,
    gas: 0.01,
    altGas: 0.001,
    tip: 0.001,
    altTip: 0.01,
    highGasLowTip: true,
    computeUnits: 80000,
    noTipLanders: false,
  },
};

function fromSniper(s: Sniper): SniperFormState {
  return {
    name: s.name,
    snipe: s.snipeEnabled,
    copy: s.copyEnabled,
    walletId: s.wallets[0]?.walletId ?? "",
    walletListId: s.walletListId,
    buyMode: s.buyMode,
    buySol: s.buySol,
    buyMultiplier: s.buyMultiplier,
    amountMin: s.amountMin,
    amountMax: s.amountMax,
    firstPurchase: s.firstPurchase,
    tokenPurchaseLimit: s.tokenPurchaseLimit,
    mintWhitelist: s.mintWhitelist ?? [],
    mintBlacklist: s.mintBlacklist ?? [],
    regions: s.regions ?? [],
    tx: {
      slippageMode: s.txConfig?.slippageMode ?? "percent",
      slippage: s.txConfig?.slippage ?? 30,
      altSlippage: s.txConfig?.altSlippage ?? 30,
      gas: s.txConfig?.gas ?? 0.01,
      altGas: s.txConfig?.altGas ?? 0.001,
      tip: s.txConfig?.tip ?? 0.001,
      altTip: s.txConfig?.altTip ?? 0.01,
      highGasLowTip: s.txConfig?.highGasLowTip ?? true,
      computeUnits: s.txConfig?.computeUnits ?? 80000,
      noTipLanders: s.txConfig?.noTipLanders ?? false,
    },
  };
}

function toCreateBody(f: SniperFormState): SniperCreateBody {
  return {
    name: f.name.trim(),
    snipeEnabled: f.snipe,
    copyEnabled: f.copy,
    walletIds: [f.walletId],
    walletListId: f.walletListId,
    mintWhitelist: f.mintWhitelist,
    mintBlacklist: f.mintBlacklist,
    buySol: f.buySol,
    buyMode: f.buyMode,
    buyMultiplier: f.buyMultiplier,
    amountMin: f.amountMin,
    amountMax: f.amountMax,
    firstPurchase: f.firstPurchase,
    tokenPurchaseLimit: f.tokenPurchaseLimit,
    txConfig: { ...f.tx },
    regions: f.regions,
  };
}

function SniperForm({
  state, onChange, platformWallets, walletLists, allowedRegions, maxRegions,
}: {
  state: SniperFormState;
  onChange: (patch: Partial<SniperFormState>) => void;
  platformWallets: { id: string; pubkey: string; label: string | null }[];
  walletLists: WalletList[];
  allowedRegions: string[];
  maxRegions: number;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const patchTx = (p: Partial<SniperFormState["tx"]>) =>
    onChange({ tx: { ...state.tx, ...p } });

  function toggleRegion(r: string) {
    const has = state.regions.includes(r);
    if (has) {
      onChange({ regions: state.regions.filter((x) => x !== r) });
    } else {
      const next = [...state.regions, r];
      onChange({ regions: next.slice(-Math.max(1, maxRegions)) });
    }
  }

  return (
    <>
      <SectionCard eyebrow="Step 1" title="Identity" hint="Give the rule a memorable name and pick what it does. Snipe fires on new deploys; copy mirrors a tracked wallet's buys.">
        <Field label="Name">
          <TextInput
            value={state.name}
            onChange={(v) => onChange({ name: v })}
            placeholder="e.g. Alpha-5 copy"
          />
        </Field>
        <FieldGrid cols={2}>
          <Field label="Mode">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Toggle value={state.snipe} onChange={(v) => onChange({ snipe: v })} label="Snipe deploys" />
              <Toggle value={state.copy}  onChange={(v) => onChange({ copy: v })}  label="Copy buys" />
            </div>
          </Field>
        </FieldGrid>
      </SectionCard>

      <SectionCard eyebrow="Step 2" title="Wallets" hint="The signing wallet pays for buys; the tracked-wallets list is who copy-mode mirrors.">
        <FieldGrid cols={2}>
          <Field label="Signing wallet">
            <Select
              value={state.walletId}
              onChange={(v) => onChange({ walletId: v })}
              options={platformWallets.length === 0
                ? [{ value: "", label: "(no platform wallets)" }]
                : platformWallets.map((w) => ({
                    value: w.id,
                    label: w.label ?? shortAddr(w.pubkey),
                  }))
              }
            />
          </Field>
          <Field label="Tracked wallets list">
            <Select
              value={state.walletListId}
              onChange={(v) => onChange({ walletListId: v })}
              options={walletLists.length === 0
                ? [{ value: "", label: "(no lists yet — create one first)" }]
                : walletLists.map((wl) => ({ value: wl.id, label: wl.name }))
              }
            />
          </Field>
        </FieldGrid>
      </SectionCard>

      <SectionCard eyebrow="Step 3" title="Sizing" hint="How much SOL each fire spends. Multiplier scales with the tracked wallet's buy; dynamic lets the bot decide.">
        <Field label="Buy mode">
          <Segmented
            value={state.buyMode}
            onChange={(v) => onChange({ buyMode: v })}
            options={[
              { value: "fixed",      label: "Fixed",      hint: "Constant SOL per fire" },
              { value: "multiplier", label: "Multiplier", hint: "× the tracked wallet's buy size" },
              { value: "dynamic",    label: "Dynamic",    hint: "Bot decides per-fire" },
            ]}
          />
        </Field>
        {state.buyMode === "fixed" && (
          <Field label="Amount per fire">
            <NumberInput
              value={state.buySol}
              onChange={(n) => onChange({ buySol: n })}
              min={0} step={0.05} suffix="SOL"
            />
          </Field>
        )}
        {state.buyMode === "multiplier" && (
          <Field label="Multiplier" hint="1.0 = match the tracked wallet's spend. 0.5 = half size.">
            <NumberInput
              value={state.buyMultiplier}
              onChange={(n) => onChange({ buyMultiplier: n })}
              min={0} step={0.1} suffix="× tracked"
            />
          </Field>
        )}
        {state.buyMode === "dynamic" && (
          <div style={{
            padding: "12px 14px", borderRadius: 8,
            background: "var(--ink-0)", border: "1px solid var(--line-soft)",
            fontSize: 12, color: "var(--paper-3)", lineHeight: 1.5,
          }}>
            Bot infers a sensible buy from the tracked wallet's amount, current liquidity, and your safety caps.
          </div>
        )}
      </SectionCard>

      <SectionCard
        eyebrow="Step 4"
        title="Regions"
        hint={`Push the rule to up to ${maxRegions} regional bot${maxRegions === 1 ? "" : "s"} — first-mover wins. More regions = faster fills, more cost.`}
      >
        {allowedRegions.length === 0 ? (
          <div style={{
            padding: 14, borderRadius: 8,
            background: "var(--sell-w)", border: "1px solid color-mix(in oklch, var(--sell) 35%, transparent)",
            fontSize: 12, color: "var(--paper-2)",
          }}>
            No regions allowed for this account — contact admin.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {allowedRegions.map((r) => (
                <PillToggle
                  key={r}
                  on={state.regions.includes(r)}
                  onClick={() => toggleRegion(r)}
                >{r}</PillToggle>
              ))}
            </div>
            <span style={{ fontSize: 11, color: "var(--paper-4)" }}>
              {state.regions.length} of {maxRegions} selected
            </span>
          </>
        )}
      </SectionCard>

      <button
        onClick={(e) => { e.preventDefault(); setAdvancedOpen((v) => !v); }}
        style={{
          alignSelf: "stretch",
          padding: "12px 16px",
          background: "var(--ink-1)",
          border: "1px solid var(--line-soft)", borderRadius: 10,
          color: "var(--paper-2)", cursor: "pointer",
          fontSize: 12, fontWeight: 500,
          fontFamily: "var(--font-ui)", letterSpacing: "-0.005em",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          transition: "background 120ms, border-color 120ms",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: 6,
            background: "var(--ink-2)", color: "var(--paper-3)",
            fontSize: 12,
          }}>{advancedOpen ? "−" : "+"}</span>
          <span>Advanced — filters, slippage, gas, landers</span>
        </span>
        <span style={{ fontSize: 11, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>
          {advancedOpen ? "HIDE" : "SHOW"}
        </span>
      </button>

      {advancedOpen && (
        <>
          <SectionCard eyebrow="Filters" title="Copy window & modifiers" hint="Narrow which tracked buys actually trigger this rule.">
            <FieldGrid cols={2}>
              <Field label="Min amount" hint="Skip tracked buys smaller than this.">
                <NumberInput value={state.amountMin} onChange={(n) => onChange({ amountMin: n })} min={0} step={0.05} suffix="SOL" />
              </Field>
              <Field label="Max amount" hint="Skip tracked buys larger than this.">
                <NumberInput value={state.amountMax} onChange={(n) => onChange({ amountMax: n })} min={0} step={0.05} suffix="SOL" />
              </Field>
            </FieldGrid>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Toggle
                value={state.firstPurchase}
                onChange={(v) => onChange({ firstPurchase: v })}
                label="Only fire on first buy"
                hint="Trigger only on the tracked wallet's very first buy of the mint."
              />
              <Toggle
                value={state.tokenPurchaseLimit}
                onChange={(v) => onChange({ tokenPurchaseLimit: v })}
                label="One position per mint"
                hint="Skip mints the signing wallet already holds — avoids stacking."
              />
            </div>
          </SectionCard>

          <SectionCard eyebrow="Mints" title="Whitelist & blacklist" hint="Whitelist empty = match anything. Blacklist is checked first.">
            <Field label="Whitelist">
              <ChipInput
                value={state.mintWhitelist}
                onChange={(v) => onChange({ mintWhitelist: v })}
                placeholder="paste mint, Enter to add"
              />
            </Field>
            <Field label="Blacklist">
              <ChipInput
                value={state.mintBlacklist}
                onChange={(v) => onChange({ mintBlacklist: v })}
                placeholder="paste mint, Enter to add"
              />
            </Field>
          </SectionCard>

          <SectionCard eyebrow="Transaction" title="Slippage" hint="Primary used by default. Alt swaps in when 'high gas / low tip' is off.">
            <FieldGrid cols={3}>
              <Field label="Mode">
                <Select
                  value={state.tx.slippageMode}
                  onChange={(v) => patchTx({ slippageMode: v })}
                  options={[{ value: "percent", label: "Percent" }, { value: "bps", label: "BPS" }]}
                />
              </Field>
              <Field label="Primary">
                <NumberInput
                  value={state.tx.slippage}
                  onChange={(n) => patchTx({ slippage: n })}
                  min={0} step={1}
                  suffix={state.tx.slippageMode === "percent" ? "%" : "bps"}
                />
              </Field>
              <Field label="Alt">
                <NumberInput
                  value={state.tx.altSlippage}
                  onChange={(n) => patchTx({ altSlippage: n })}
                  min={0} step={1}
                  suffix={state.tx.slippageMode === "percent" ? "%" : "bps"}
                />
              </Field>
            </FieldGrid>
          </SectionCard>

          <SectionCard eyebrow="Transaction" title="Gas & tip" hint="High gas / low tip races the QUIC/RPC lane; the alt set tilts toward tip-only landers.">
            <FieldGrid cols={2}>
              <Field label="Primary gas">
                <NumberInput value={state.tx.gas} onChange={(n) => patchTx({ gas: n })} min={0} step={0.001} suffix="SOL" />
              </Field>
              <Field label="Alt gas">
                <NumberInput value={state.tx.altGas} onChange={(n) => patchTx({ altGas: n })} min={0} step={0.001} suffix="SOL" />
              </Field>
              <Field label="Primary tip">
                <NumberInput value={state.tx.tip} onChange={(n) => patchTx({ tip: n })} min={0} step={0.001} suffix="SOL" />
              </Field>
              <Field label="Alt tip">
                <NumberInput value={state.tx.altTip} onChange={(n) => patchTx({ altTip: n })} min={0} step={0.001} suffix="SOL" />
              </Field>
            </FieldGrid>
            <Toggle
              value={state.tx.highGasLowTip}
              onChange={(v) => patchTx({ highGasLowTip: v })}
              label="High gas / low tip (primary)"
              hint="Off swaps to the alt gas & tip values."
            />
          </SectionCard>

          <SectionCard eyebrow="Transaction" title="Compute & landers">
            <FieldGrid cols={2}>
              <Field label="Compute units" hint="Per-tx CU limit. 80k handles most snipes.">
                <NumberInput
                  value={state.tx.computeUnits}
                  onChange={(n) => patchTx({ computeUnits: n })}
                  min={0} max={1_400_000} step={10_000} suffix="CU"
                />
              </Field>
              <Field label="Landers">
                <Toggle
                  value={state.tx.noTipLanders}
                  onChange={(v) => patchTx({ noTipLanders: v })}
                  label="Skip tip-only landers"
                  hint="Gateway QUIC + RPC only. Off uses Astralane, Helius, etc."
                />
              </Field>
            </FieldGrid>
          </SectionCard>
        </>
      )}
    </>
  );
}

function validateForm(f: SniperFormState, pushErr: (title: string, body: string) => void): boolean {
  if (!f.name.trim()) { pushErr("NAME REQUIRED", "Give the rule a label."); return false; }
  if (!f.walletId) { pushErr("WALLET REQUIRED", "Pick a platform wallet."); return false; }
  if (!f.walletListId) { pushErr("WALLET LIST REQUIRED", "Create or select a tracked-wallets list."); return false; }
  if (!f.snipe && !f.copy) { pushErr("PICK A MODE", "Enable snipe, copy, or both."); return false; }
  if (f.regions.length === 0) { pushErr("PICK A REGION", "Select at least one region."); return false; }
  if (f.amountMax > 0 && f.amountMin > f.amountMax) {
    pushErr("AMOUNT WINDOW", "min must be ≤ max.");
    return false;
  }
  return true;
}

// ── New sniper modal ────────────────────────────────────────────────

export function NewSniperModal({
  open, onClose, onCreated, walletLists,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
  walletLists: WalletList[];
}) {
  const client = useBackend();
  const { pushToast } = useApp();
  const { wallets } = useUserWallets();
  const platformWallets = useMemo(
    () => wallets.filter((w) => w.kind === "PLATFORM"),
    [wallets],
  );

  const [state, setState] = useState<SniperFormState>(DEFAULT_FORM);
  const [allowedRegions, setAllowedRegions] = useState<string[]>([]);
  const [defaultRegion, setDefaultRegion] = useState<string>("");
  const [maxRegions, setMaxRegions] = useState<number>(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void client.me().then((u) => {
      setAllowedRegions(u.allowedRegions);
      setDefaultRegion(u.defaultRegion ?? "");
      setMaxRegions(u.maxRegions);
      setState((s) => ({
        ...s,
        regions: u.defaultRegion && u.allowedRegions.includes(u.defaultRegion) ? [u.defaultRegion] : [],
      }));
    }).catch(() => {});
  }, [open, client]);

  useEffect(() => {
    if (!open) return;
    setState({
      ...DEFAULT_FORM,
      walletId: platformWallets[0]?.id ?? "",
      walletListId: walletLists[0]?.id ?? "",
      regions: defaultRegion && allowedRegions.includes(defaultRegion) ? [defaultRegion] : [],
    });
  }, [open, platformWallets, walletLists, defaultRegion, allowedRegions]);

  async function submit() {
    if (!validateForm(state, (title, body) => pushToast({ title, body, tone: "sell" }))) return;
    setBusy(true);
    try {
      await client.createSniper(toCreateBody(state));
      pushToast({ title: "sniper created", body: state.name.trim(), tone: "buy" });
      await onCreated();
      onClose();
    } catch (e) {
      pushToast({ title: "CREATE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={720} align="top" mobileVariant="sheet">
      <FormShell
        kicker={<KindChip kind="SNIPER" />}
        title="New sniper"
        onClose={onClose}
        footer={
          <>
            <Btn size="sm" onClick={onClose}>Cancel</Btn>
            <Btn tone="primary" size="sm" disabled={busy} onClick={() => void submit()}>
              {busy ? "Creating…" : "Create sniper"}
            </Btn>
          </>
        }
      >
        <SniperForm
          state={state}
          onChange={(p) => setState((s) => ({ ...s, ...p }))}
          platformWallets={platformWallets}
          walletLists={walletLists}
          allowedRegions={allowedRegions}
          maxRegions={maxRegions}
        />
      </FormShell>
    </Modal>
  );
}

// ── Edit sniper modal ───────────────────────────────────────────────

export function EditSniperModal({
  sniper, open, onClose, onSaved, walletLists,
}: {
  sniper: Sniper;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  walletLists: WalletList[];
}) {
  const client = useBackend();
  const { pushToast } = useApp();
  const { wallets } = useUserWallets();
  const platformWallets = useMemo(
    () => wallets.filter((w) => w.kind === "PLATFORM"),
    [wallets],
  );

  const [state, setState] = useState<SniperFormState>(() => fromSniper(sniper));
  const [allowedRegions, setAllowedRegions] = useState<string[]>([]);
  const [maxRegions, setMaxRegions] = useState<number>(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setState(fromSniper(sniper));
    void client.me().then((u) => {
      setAllowedRegions(u.allowedRegions);
      setMaxRegions(u.maxRegions);
    }).catch(() => {});
  }, [open, sniper, client]);

  async function save() {
    if (!validateForm(state, (title, body) => pushToast({ title, body, tone: "sell" }))) return;
    setBusy(true);
    try {
      await client.updateSniper(sniper.id, toCreateBody(state));
      pushToast({ title: "sniper saved", body: state.name.trim(), tone: "buy" });
      await onSaved();
      onClose();
    } catch (e) {
      pushToast({ title: "SAVE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={720} align="top" mobileVariant="sheet">
      <FormShell
        kicker={<KindChip kind="SNIPER" />}
        title={`Edit · ${sniper.name}`}
        onClose={onClose}
        footer={
          <>
            <Btn size="sm" onClick={onClose}>Cancel</Btn>
            <Btn tone="primary" size="sm" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save changes"}
            </Btn>
          </>
        }
      >
        <SniperForm
          state={state}
          onChange={(p) => setState((s) => ({ ...s, ...p }))}
          platformWallets={platformWallets}
          walletLists={walletLists}
          allowedRegions={allowedRegions}
          maxRegions={maxRegions}
        />
      </FormShell>
    </Modal>
  );
}

// ── Manage wallet lists modal ────────────────────────────────────────

export function ManageWalletListsModal({
  open, onClose, onChanged, walletLists,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  walletLists: WalletList[];
}) {
  const client = useBackend();
  const { pushToast } = useApp();
  const isPhone = useIsPhone();

  const [selectedId, setSelectedId] = useState<string>("");
  const [newListName, setNewListName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedId((id) =>
      walletLists.some((wl) => wl.id === id) ? id : (walletLists[0]?.id ?? ""),
    );
    setNewListName("");
    setNewAddress("");
    setNewLabel("");
  }, [open, walletLists]);

  const selected = walletLists.find((wl) => wl.id === selectedId) ?? null;

  async function createList() {
    const name = newListName.trim();
    if (!name) {
      pushToast({ title: "NAME REQUIRED", body: "Give the list a label.", tone: "sell" });
      return;
    }
    setBusy(true);
    try {
      const { walletList } = await client.createWalletList({ name });
      setNewListName("");
      setSelectedId(walletList.id);
      await onChanged();
    } catch (e) {
      pushToast({ title: "CREATE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteList(id: string, refCount: number) {
    if (refCount > 0) {
      pushToast({
        title: "LIST IN USE",
        body: `Detach from ${refCount} sniper${refCount === 1 ? "" : "s"} first.`,
        tone: "sell",
      });
      return;
    }
    if (!confirm("Delete this list?")) return;
    setBusy(true);
    try {
      await client.deleteWalletList(id);
      if (selectedId === id) setSelectedId("");
      await onChanged();
    } catch (e) {
      pushToast({ title: "DELETE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally {
      setBusy(false);
    }
  }

  async function addEntry() {
    if (!selected) return;
    const address = newAddress.trim();
    if (!address) {
      pushToast({ title: "ADDRESS REQUIRED", body: "Paste a Solana address.", tone: "sell" });
      return;
    }
    setBusy(true);
    try {
      await client.addWalletListEntry(selected.id, {
        address,
        label: newLabel.trim() || undefined,
      });
      setNewAddress("");
      setNewLabel("");
      await onChanged();
    } catch (e) {
      pushToast({ title: "ADD FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(entryId: string) {
    if (!selected) return;
    setBusy(true);
    try {
      await client.removeWalletListEntry(selected.id, entryId);
      await onChanged();
    } catch (e) {
      pushToast({ title: "REMOVE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={820} align="top" mobileVariant="sheet">
      <FormShell
        kicker={
          <span className="eyebrow" style={{ fontSize: 10 }}>
            Reusable across snipers · copy-buy & sell-mirror keys off these
          </span>
        }
        title="Tracked-wallet lists"
        onClose={onClose}
        footer={<Btn size="sm" onClick={onClose}>Close</Btn>}
      >
        <div style={{
          display: "grid",
          gridTemplateColumns: isPhone ? "1fr" : "260px minmax(0, 1fr)",
          gap: 14, minHeight: isPhone ? 0 : 360,
        }}>
          {/* ── Left: list of lists ──────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{
              border: "1px solid var(--line-soft)", borderRadius: 10,
              overflow: "auto", maxHeight: 380, background: "var(--ink-1)",
              display: "flex", flexDirection: "column",
            }}>
              {walletLists.length === 0 && (
                <div style={{ padding: 14, fontSize: 12, color: "var(--paper-4)" }}>
                  No lists yet — create one below.
                </div>
              )}
              {walletLists.map((wl) => {
                const refs = wl._count?.snipers ?? 0;
                const active = wl.id === selectedId;
                return (
                  <button
                    key={wl.id}
                    onClick={() => setSelectedId(wl.id)}
                    style={{
                      textAlign: "left", padding: "12px 14px",
                      borderBottom: "1px solid var(--line-soft)",
                      cursor: "pointer",
                      background: active ? "color-mix(in oklch, var(--accent) 8%, var(--ink-1))" : "transparent",
                      borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
                      display: "flex", flexDirection: "column", gap: 4,
                      transition: "background 120ms",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)" }}>{wl.name}</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); void deleteList(wl.id, refs); }}
                        style={{
                          cursor: refs > 0 ? "not-allowed" : "pointer",
                          color: refs > 0 ? "var(--paper-4)" : "var(--paper-3)",
                          fontSize: 16, lineHeight: 1, padding: "2px 6px", borderRadius: 4,
                        }}
                        title={refs > 0 ? `Used by ${refs} sniper${refs === 1 ? "" : "s"}` : "Delete list"}
                      >×</span>
                    </div>
                    <span style={{ fontSize: 10, color: "var(--paper-4)", fontFamily: "var(--font-mono)" }}>
                      {wl.entries.length} addr · {refs} sniper{refs === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <TextInput value={newListName} onChange={setNewListName} placeholder="New list name" />
              <Btn size="sm" tone="primary" disabled={busy} onClick={() => void createList()}>
                + Add
              </Btn>
            </div>
          </div>

          {/* ── Right: entries ─────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            {!selected ? (
              <div style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, color: "var(--paper-4)",
                border: "1px dashed var(--line-soft)", borderRadius: 10,
                padding: 32, textAlign: "center",
              }}>
                Select a list to manage its tracked addresses.
              </div>
            ) : (
              <>
                <div style={{
                  border: "1px solid var(--line-soft)", borderRadius: 10,
                  overflow: "auto", maxHeight: 320, background: "var(--ink-1)",
                }}>
                  {selected.entries.length === 0 && (
                    <div style={{ padding: 14, fontSize: 12, color: "var(--paper-4)" }}>
                      No addresses yet — add one below.
                    </div>
                  )}
                  {selected.entries.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--line-soft)",
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 2 }}>
                        <span style={{
                          fontSize: 12, color: "var(--paper)", fontFamily: "var(--font-mono)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{entry.address}</span>
                        {entry.label && (
                          <span style={{ fontSize: 10, color: "var(--paper-4)" }}>{entry.label}</span>
                        )}
                      </div>
                      <Btn size="xs" onClick={() => void removeEntry(entry.id)} disabled={busy}>Remove</Btn>
                    </div>
                  ))}
                </div>

                <FieldGrid cols={2}>
                  <Field label="Address">
                    <TextInput value={newAddress} onChange={setNewAddress} placeholder="Solana address" mono />
                  </Field>
                  <Field label="Label (optional)">
                    <TextInput value={newLabel} onChange={setNewLabel} placeholder="e.g. alpha-5" />
                  </Field>
                </FieldGrid>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Btn size="sm" tone="primary" disabled={busy} onClick={() => void addEntry()}>
                    + Add address
                  </Btn>
                </div>
              </>
            )}
          </div>
        </div>
      </FormShell>
    </Modal>
  );
}

// ── New limit order modal ────────────────────────────────────────────

export function NewLimitOrderModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const client = useBackend();
  const { pushToast } = useApp();
  const { wallets } = useUserWallets();
  const platformWallets = useMemo(
    () => wallets.filter((w) => w.kind === "PLATFORM"),
    [wallets],
  );

  const [walletId, setWalletId] = useState<string>("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [mint, setMint] = useState("");
  const [trigger, setTrigger] = useState(0);
  const [amount, setAmount] = useState(0.1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWalletId(platformWallets[0]?.id ?? "");
    setSide("buy"); setMint(""); setTrigger(0); setAmount(0.1);
  }, [open, platformWallets]);

  async function submit() {
    if (!walletId) return pushToast({ title: "WALLET REQUIRED", body: "Pick a platform wallet.", tone: "sell" });
    if (!mint.trim()) return pushToast({ title: "MINT REQUIRED", body: "Paste the token mint.", tone: "sell" });
    if (!(trigger > 0)) return pushToast({ title: "TRIGGER REQUIRED", body: "Set a target mcap (USD).", tone: "sell" });
    if (!(amount > 0)) return pushToast({ title: "AMOUNT REQUIRED", body: "Set a buy size or sell %.", tone: "sell" });
    if (side === "sell" && amount > 100) return pushToast({ title: "INVALID %", body: "Sell amount must be 0–100.", tone: "sell" });
    setBusy(true);
    try {
      await client.createLimitOrder({
        walletId,
        side,
        mint: mint.trim(),
        triggerMcapUsd: trigger,
        amount,
      });
      pushToast({
        title: side === "buy" ? "LIMIT BUY SET" : "LIMIT SELL SET",
        body: `MC $${trigger.toFixed(0)}`,
        tone: side === "buy" ? "buy" : "sell",
      });
      await onCreated();
      onClose();
    } catch (e) {
      pushToast({ title: "CREATE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={520} align="top" mobileVariant="sheet">
      <FormShell
        kicker={<KindChip kind="LIMIT" />}
        title={`New ${AUTO_LABEL.limit}`}
        onClose={onClose}
        footer={
          <>
            <Btn size="sm" onClick={onClose}>Cancel</Btn>
            <Btn tone={side === "buy" ? "buy" : "sell"} size="sm" disabled={busy} onClick={() => void submit()}>
              {busy ? "Creating…" : side === "buy" ? "Place limit buy" : "Place limit sell"}
            </Btn>
          </>
        }
      >
        <SectionCard
          eyebrow="Direction"
          title="Side"
          hint={side === "buy"
            ? "Fires when mcap dips at or below your trigger."
            : "Fires when mcap rises at or above your trigger."}
        >
          <Segmented
            value={side}
            onChange={setSide}
            options={[
              { value: "buy",  label: "Buy on dip" },
              { value: "sell", label: "Sell on rise" },
            ]}
          />
        </SectionCard>

        <SectionCard eyebrow="Target" title="Token & trigger" hint="Trigger is in USD market cap.">
          <Field label="Mint">
            <TextInput value={mint} onChange={setMint} placeholder="base58 mint" mono />
          </Field>
          <Field label="Trigger mcap">
            <NumberInput value={trigger} onChange={setTrigger} min={0} step={1000} suffix="USD" />
          </Field>
        </SectionCard>

        <SectionCard eyebrow="Order" title="Execution">
          <FieldGrid cols={2}>
            <Field label="Signing wallet">
              <Select
                value={walletId}
                onChange={setWalletId}
                options={platformWallets.length === 0
                  ? [{ value: "", label: "(no platform wallets)" }]
                  : platformWallets.map((w) => ({ value: w.id, label: w.label ?? shortAddr(w.pubkey) }))
                }
              />
            </Field>
            <Field
              label={side === "buy" ? "Buy amount" : "Sell size"}
              hint={side === "buy" ? "SOL spent when triggered." : "Percentage of the existing bag."}
            >
              <NumberInput
                value={amount}
                onChange={setAmount}
                min={0}
                max={side === "sell" ? 100 : undefined}
                step={side === "buy" ? 0.05 : 1}
                suffix={side === "buy" ? "SOL" : "%"}
              />
            </Field>
          </FieldGrid>
        </SectionCard>
      </FormShell>
    </Modal>
  );
}
