"use client";

// Market-making automode UI (Proxima-style). Shared by the token/live trading
// panel (mint-scoped) and the /automation "Automode" tab (cross-token).
//
//   <AutomodePanel client wallets pushToast [mint] [symbol] /> — self-fetches
//   the user's automode + volume-bot sessions (filtered by mint when scoped),
//   renders the list with pause/resume/stop/delete, and hosts the create
//   modals (Auto-Buy / Auto-Sell composable strategies + Volume Bot).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Btn, Icon, Modal, ModalHeader, ModalFooter } from "../../../components/atoms";
import { useApp } from "../../../contexts/AppContext";
import type { useBackend } from "../../../api/backend";
import type {
  AutomodeSession, VolumeBotSession, AutomodeKind, AutomodeMode,
  SellUnit, AutomodeStrategyBody, AutomodeCreateBody, VolumeBotCreateBody,
} from "../../../api/backend";
import type { UserWallet } from "../../../hooks/useUserWallets";
import {
  SectionCard, Field, FieldGrid, NumberInput, Select, Toggle, Segmented,
  PillToggle, ChipInput, StatusBadge, shortAddr,
  AUTO_LABEL, autoAddLabel,
} from "./atoms";

type Client = ReturnType<typeof useBackend>;
type Toast = ReturnType<typeof useApp>["pushToast"];

const MODE_LABEL: Record<AutomodeMode, string> = {
  replication: "Replication", time: "Time-based", mcap: "Market-cap",
};

// ── Panel ────────────────────────────────────────────────────────────────

export function AutomodePanel({
  client, wallets, pushToast, mint, symbol,
  embedded, create: createProp, onCreateChange, refreshNonce,
}: {
  client: Client;
  wallets: UserWallet[];
  pushToast: Toast;
  mint?: string;
  symbol?: string | null;
  /** Embedded in a unified parent panel: hide own buttons + prose; the parent
   *  renders the action grid and drives the create modal via `create`. */
  embedded?: boolean;
  create?: null | "autobuy" | "autosell" | "volume";
  onCreateChange?: (c: null | "autobuy" | "autosell" | "volume") => void;
  refreshNonce?: number;
}) {
  const [sessions, setSessions] = useState<AutomodeSession[]>([]);
  const [vols, setVols] = useState<VolumeBotSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [createInternal, setCreateInternal] = useState<null | "autobuy" | "autosell" | "volume">(null);
  const create = embedded ? (createProp ?? null) : createInternal;
  const setCreate = embedded ? (onCreateChange ?? (() => {})) : setCreateInternal;

  const refresh = useCallback(async () => {
    const [a, v] = await Promise.all([
      client.listAutomode(mint ? { mint } : {}).catch(() => ({ sessions: [] as AutomodeSession[] })),
      client.listVolumeBots(mint ? { mint } : {}).catch(() => ({ sessions: [] as VolumeBotSession[] })),
    ]);
    setSessions(a.sessions);
    setVols(v.sessions);
    setLoading(false);
  }, [client, mint]);

  useEffect(() => { void refresh(); }, [refresh, refreshNonce]);

  const platform = useMemo(() => wallets.filter((w) => w.kind === "PLATFORM"), [wallets]);

  async function setStatus(id: string, status: "paused" | "active" | "stopped", vol = false) {
    try {
      if (vol) await client.setVolumeBotStatus(id, status);
      else await client.setAutomodeStatus(id, status);
      await refresh();
    } catch (e) {
      pushToast({ title: "UPDATE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    }
  }
  async function remove(id: string, vol = false) {
    if (!confirm("Delete this session permanently?")) return;
    try {
      if (vol) await client.deleteVolumeBot(id); else await client.deleteAutomode(id);
      await refresh();
    } catch (e) {
      pushToast({ title: "DELETE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!embedded && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn size="sm" tone="primary" onClick={() => setCreate("autobuy")}>{autoAddLabel("autobuy")}</Btn>
          <Btn size="sm" tone="primary" onClick={() => setCreate("autosell")}>{autoAddLabel("autosell")}</Btn>
          <Btn size="sm" onClick={() => setCreate("volume")}>{autoAddLabel("volume")}</Btn>
          <Btn size="sm" onClick={() => void refresh()}>↻</Btn>
        </div>
      )}

      {loading ? (
        <div className="skeleton" style={{ height: 72, borderRadius: 12 }} />
      ) : sessions.length === 0 && vols.length === 0 ? (
        embedded ? null : (
          <div style={{
            padding: "26px 20px", textAlign: "center", borderRadius: 12,
            background: "var(--ink-1)", border: "1px dashed var(--line-soft)",
            color: "var(--paper-3)", fontSize: 12,
          }}>
            No market-making sessions yet. {AUTO_LABEL.autobuy} counters dumps, {AUTO_LABEL.autosell}
            distributes exits, and {AUTO_LABEL.volume} generates volume — all across
            your wallet pool.
          </div>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sessions.map((s) => (
            <SessionRow key={s.id} s={s}
              onStatus={(st) => setStatus(s.id, st)}
              onDelete={() => remove(s.id)} />
          ))}
          {vols.map((v) => (
            <VolumeRow key={v.id} v={v}
              onStatus={(st) => setStatus(v.id, st, true)}
              onDelete={() => remove(v.id, true)} />
          ))}
        </div>
      )}

      {create === "volume" ? (
        <NewVolumeBotModal
          open onClose={() => setCreate(null)}
          onCreated={() => { setCreate(null); void refresh(); }}
          client={client} wallets={platform} mint={mint} symbol={symbol}
        />
      ) : create ? (
        <NewAutomodeModal
          open kind={create} onClose={() => setCreate(null)}
          onCreated={() => { setCreate(null); void refresh(); }}
          client={client} wallets={platform} mint={mint} symbol={symbol}
        />
      ) : null}
    </div>
  );
}

function RowShell({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--ink-1)", border: "1px solid var(--line-soft)",
      borderLeft: `3px solid ${accent}`, borderRadius: 12, padding: "12px 14px",
    }}>{children}</div>
  );
}

function Controls({ status, onStatus, onDelete }: {
  status: string; onStatus: (s: "paused" | "active" | "stopped") => void; onDelete: () => void;
}) {
  const stopped = status === "stopped";
  return (
    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
      {!stopped && status === "active" && <Btn size="xs" onClick={() => onStatus("paused")}>Pause</Btn>}
      {!stopped && status !== "active" && <Btn size="xs" tone="primary" onClick={() => onStatus("active")}>Start</Btn>}
      {!stopped && <Btn size="xs" tone="sell" onClick={() => onStatus("stopped")}>Stop</Btn>}
      {stopped && <Btn size="xs" tone="sell" onClick={onDelete}>Delete</Btn>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 8, color: "var(--paper-4)", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--paper)", fontFamily: "var(--font-mono)" }}>{value}</span>
    </span>
  );
}

function SessionRow({ s, onStatus, onDelete }: {
  s: AutomodeSession; onStatus: (st: "paused" | "active" | "stopped") => void; onDelete: () => void;
}) {
  const buy = s.kind === "autobuy";
  return (
    <RowShell accent={buy ? "var(--buy)" : "var(--sell)"}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: buy ? "var(--buy)" : "var(--sell)", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "var(--font-mono)" }}>
              {buy ? AUTO_LABEL.autobuy : AUTO_LABEL.autosell}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)" }}>{s.symbol ?? shortAddr(s.mint)}</span>
            <StatusBadge status={s.status} />
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Stat label="Strategies" value={`${s.strategies.length} · ${[...new Set(s.strategies.map((x) => MODE_LABEL[x.mode]))].join(", ") || "—"}`} />
            <Stat label="Wallets" value={String(s.walletIds.length)} />
            <Stat label="Fires" value={String(s.fireCount)} />
            {buy ? <Stat label="Bought" value={`${s.totalBuySol.toFixed(3)} ◎`} /> : null}
          </div>
        </div>
        <Controls status={s.status} onStatus={onStatus} onDelete={onDelete} />
      </div>
    </RowShell>
  );
}

function VolumeRow({ v, onStatus, onDelete }: {
  v: VolumeBotSession; onStatus: (st: "paused" | "active" | "stopped") => void; onDelete: () => void;
}) {
  const pct = v.targetVolume > 0 ? Math.min(100, (v.generatedVolume / v.targetVolume) * 100) : 0;
  return (
    <RowShell accent="var(--info)">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--info)", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "var(--font-mono)" }}>{AUTO_LABEL.volume}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)" }}>{v.symbol ?? shortAddr(v.mint)}</span>
            <StatusBadge status={v.status} />
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Stat label="Volume" value={`${v.generatedVolume.toFixed(2)} / ${v.targetVolume} ${v.unit.toUpperCase()} (${pct.toFixed(0)}%)`} />
            <Stat label="Trades" value={String(v.tradeCount)} />
            <Stat label="Mode" value={v.execMode} />
            <Stat label="Wallets" value={String(v.walletIds.length)} />
          </div>
        </div>
        <Controls status={v.status} onStatus={onStatus} onDelete={onDelete} />
      </div>
    </RowShell>
  );
}

// ── Wallet pool selector ──────────────────────────────────────────────────

function WalletPool({ wallets, selected, onToggle }: {
  wallets: UserWallet[]; selected: Set<string>; onToggle: (id: string) => void;
}) {
  if (wallets.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--paper-4)" }}>No platform wallets — create one in the Wallets panel.</div>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {wallets.map((w) => (
        <PillToggle key={w.id} on={selected.has(w.id)} onClick={() => onToggle(w.id)}>
          {w.displayLabel || shortAddr(w.pubkey)}
        </PillToggle>
      ))}
    </div>
  );
}

// ── Strategy draft + editor ────────────────────────────────────────────────

interface Draft {
  mode: AutomodeMode;
  factorPct: number; swapRatePct: number; minAmount: number;          // replication
  amount: number; delayMinSec: number; delayMaxSec: number;            // time
  mcapAmount: number; targets: string[];                               // mcap
  sellUnit: SellUnit;
  scopeMin: number; scopeMax: number;
  endMaxAmount: number; endDurationSec: number;
  whitelist: string[];
}

function newDraft(mode: AutomodeMode): Draft {
  return {
    mode,
    factorPct: 50, swapRatePct: 100, minAmount: 0,
    amount: 0.1, delayMinSec: 30, delayMaxSec: 30,
    mcapAmount: 0.1, targets: [],
    sellUnit: "percent_supply",
    scopeMin: 0, scopeMax: 0,
    endMaxAmount: 0, endDurationSec: 0,
    whitelist: [],
  };
}

function draftToBody(d: Draft, kind: AutomodeKind): AutomodeStrategyBody {
  let config: Record<string, unknown>;
  if (d.mode === "replication") config = { factorPct: d.factorPct, swapRatePct: d.swapRatePct, minAmount: d.minAmount };
  else if (d.mode === "time") config = { amount: d.amount, delayMinMs: d.delayMinSec * 1000, delayMaxMs: d.delayMaxSec * 1000 };
  else config = { amount: d.mcapAmount, targetsUsd: d.targets.map(Number).filter((n) => Number.isFinite(n) && n > 0) };
  return {
    mode: d.mode,
    config,
    sellUnit: kind === "autosell" ? d.sellUnit : null,
    scopeMcapMinUsd: d.scopeMin > 0 ? d.scopeMin : null,
    scopeMcapMaxUsd: d.scopeMax > 0 ? d.scopeMax : null,
    endMaxAmount: d.endMaxAmount > 0 ? d.endMaxAmount : null,
    endDurationSec: d.endDurationSec > 0 ? d.endDurationSec : null,
    whitelist: d.whitelist,
  };
}

function StrategyEditor({ kind, draft, set, onRemove }: {
  kind: AutomodeKind; draft: Draft; set: (d: Draft) => void; onRemove: () => void;
}) {
  const buy = kind === "autobuy";
  const amtSuffix = buy ? "SOL" : (draft.sellUnit === "token" ? "tokens" : "%");
  return (
    <SectionCard dense
      eyebrow={MODE_LABEL[draft.mode]}
      right={<Btn size="xs" tone="sell" onClick={onRemove}>Remove</Btn>}>
      <Field label="Mode">
        <Segmented value={draft.mode} onChange={(m) => set({ ...draft, mode: m })}
          options={[
            { value: "replication", label: "Replication" },
            { value: "time", label: "Time" },
            { value: "mcap", label: "Market-cap" },
          ]} />
      </Field>

      {!buy && (
        <Field label="Sell unit" hint="How the amount is interpreted">
          <Select value={draft.sellUnit} onChange={(u) => set({ ...draft, sellUnit: u })}
            options={[
              { value: "percent_supply", label: "% Supply" },
              { value: "percent_owned", label: "% Owned" },
              { value: "token", label: "Token amount" },
            ]} />
        </Field>
      )}

      {draft.mode === "replication" && (
        <FieldGrid cols={3}>
          <Field label="Factor %" hint={buy ? "buy this % of each sell" : "sell this % of each buy"}>
            <NumberInput value={draft.factorPct} onChange={(n) => set({ ...draft, factorPct: n })} min={0} suffix="%" />
          </Field>
          <Field label="Swap rate %" hint="how often it triggers">
            <NumberInput value={draft.swapRatePct} onChange={(n) => set({ ...draft, swapRatePct: n })} min={0} max={100} suffix="%" />
          </Field>
          <Field label="Min amount" hint="accumulate below this">
            <NumberInput value={draft.minAmount} onChange={(n) => set({ ...draft, minAmount: n })} min={0} suffix={buy ? "SOL" : "tok"} />
          </Field>
        </FieldGrid>
      )}

      {draft.mode === "time" && (
        <FieldGrid cols={3}>
          <Field label="Amount"><NumberInput value={draft.amount} onChange={(n) => set({ ...draft, amount: n })} min={0} suffix={amtSuffix} /></Field>
          <Field label="Delay min" ><NumberInput value={draft.delayMinSec} onChange={(n) => set({ ...draft, delayMinSec: n })} min={0} suffix="s" /></Field>
          <Field label="Delay max" hint="= min for fixed"><NumberInput value={draft.delayMaxSec} onChange={(n) => set({ ...draft, delayMaxSec: n })} min={0} suffix="s" /></Field>
        </FieldGrid>
      )}

      {draft.mode === "mcap" && (
        <>
          <Field label="Amount per target"><NumberInput value={draft.mcapAmount} onChange={(n) => set({ ...draft, mcapAmount: n })} min={0} suffix={amtSuffix} /></Field>
          <Field label="Targets (USD mcap)" hint="fires once as each is crossed">
            <ChipInput value={draft.targets} onChange={(t) => set({ ...draft, targets: t })} placeholder="100000  500000  1000000" />
          </Field>
        </>
      )}

      <FieldGrid cols={2}>
        <Field label="Scope min mcap $" hint="0 = no floor"><NumberInput value={draft.scopeMin} onChange={(n) => set({ ...draft, scopeMin: n })} min={0} prefix="$" /></Field>
        <Field label="Scope max mcap $" hint="0 = no ceiling"><NumberInput value={draft.scopeMax} onChange={(n) => set({ ...draft, scopeMax: n })} min={0} prefix="$" /></Field>
        <Field label="End: max amount" hint={buy ? "SOL · 0 = none" : "%supply · 0 = none"}><NumberInput value={draft.endMaxAmount} onChange={(n) => set({ ...draft, endMaxAmount: n })} min={0} /></Field>
        <Field label="End: duration" hint="0 = none"><NumberInput value={draft.endDurationSec} onChange={(n) => set({ ...draft, endDurationSec: n })} min={0} suffix="s" /></Field>
      </FieldGrid>

      {draft.mode === "replication" && (
        <Field label="Whitelist" hint="addresses excluded from trigger logic">
          <ChipInput value={draft.whitelist} onChange={(w) => set({ ...draft, whitelist: w })} placeholder="Paste addresses…" />
        </Field>
      )}
    </SectionCard>
  );
}

// ── Create Automode modal ──────────────────────────────────────────────────

function NewAutomodeModal({
  open, kind, onClose, onCreated, client, wallets, mint, symbol, onDraft,
}: {
  open: boolean; kind: AutomodeKind; onClose: () => void; onCreated: () => void;
  client: Client; wallets: UserWallet[]; mint?: string; symbol?: string | null;
  // Draft mode (deploy "before launch"): return the config instead of creating.
  onDraft?: (body: Omit<AutomodeCreateBody, "mint" | "symbol">) => void;
}) {
  const { pushToast } = useApp();
  const [mintInput, setMintInput] = useState(mint ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [startDelaySec, setStartDelay] = useState(0);
  const [slippagePct, setSlippage] = useState(10);
  const [endMaxAmount, setEndMax] = useState(0);
  const [endDurationSec, setEndDur] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([newDraft("time")]);
  const [startActive, setStartActive] = useState(true);
  const [busy, setBusy] = useState(false);

  const effMint = (mint ?? mintInput).trim();
  const canSave = (!!effMint || !!onDraft) && selected.size > 0 && drafts.length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    const body: Omit<AutomodeCreateBody, "mint" | "symbol"> = {
      kind,
      walletIds: [...selected],
      startDelaySec: startDelaySec > 0 ? startDelaySec : undefined,
      slippageBps: Math.round(slippagePct * 100),
      endMaxAmount: endMaxAmount > 0 ? endMaxAmount : undefined,
      endDurationSec: endDurationSec > 0 ? endDurationSec : undefined,
      status: startActive ? "active" : "paused",
      strategies: drafts.map((d) => draftToBody(d, kind)),
    };
    if (onDraft) { onDraft(body); onCreated(); return; }
    setBusy(true);
    try {
      await client.createAutomode({ ...body, mint: effMint, symbol: symbol ?? undefined });
      pushToast({ title: `${AUTO_LABEL[kind]} created`, body: symbol ?? shortAddr(effMint), tone: "buy" });
      onCreated();
    } catch (e) {
      pushToast({ title: "CREATE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} width={720} mobileVariant="sheet">
      <ModalHeader
        title={`New ${kind === "autobuy" ? AUTO_LABEL.autobuy : AUTO_LABEL.autosell}`}
        onClose={onClose}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14, padding: "16px 20px", overflowY: "auto", background: "var(--ink-1)" }}>
        <ModalIntro>{kind === "autobuy"
          ? "Automatically buys more of your token from the selected wallets once your triggers hit — reach a market cap, wait a delay, or mirror another wallet. Add one or more strategies below."
          : "Automatically sells (takes profit) from the selected wallets when your triggers hit — a market-cap target, a delay, or mirroring. Add one or more strategies below."}</ModalIntro>
        <SectionCard dense eyebrow="Wallets & limits" title="Pool & options">
          {!mint && !onDraft && (
            <Field label="Token mint">
              <input value={mintInput} onChange={(e) => setMintInput(e.target.value)} placeholder="mint address"
                style={{ background: "var(--ink-0)", border: "1px solid var(--line-soft)", color: "var(--paper)", padding: "9px 12px", borderRadius: 8, fontSize: 12, fontFamily: "var(--font-mono)", width: "100%", outline: "none" }} />
            </Field>
          )}
          <Field label="Wallet pool" hint="strategies share these wallets (round-robin)">
            <WalletPool wallets={wallets} selected={selected} onToggle={(id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} />
          </Field>
          <FieldGrid cols={2}>
            <Field label="Start delay" hint="0 = immediate"><NumberInput value={startDelaySec} onChange={setStartDelay} min={0} suffix="s" /></Field>
            <Field label="Slippage"><NumberInput value={slippagePct} onChange={setSlippage} min={0} max={100} suffix="%" /></Field>
            <Field label="Global max" hint={kind === "autobuy" ? "total SOL · 0 = none" : "total %supply · 0 = none"}><NumberInput value={endMaxAmount} onChange={setEndMax} min={0} /></Field>
            <Field label="Global duration" hint="0 = none"><NumberInput value={endDurationSec} onChange={setEndDur} min={0} suffix="s" /></Field>
          </FieldGrid>
        </SectionCard>

        {drafts.map((d, i) => (
          <StrategyEditor key={i} kind={kind} draft={d}
            set={(nd) => setDrafts((arr) => arr.map((x, j) => (j === i ? nd : x)))}
            onRemove={() => setDrafts((arr) => arr.filter((_, j) => j !== i))} />
        ))}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn size="sm" onClick={() => setDrafts((a) => [...a, newDraft("replication")])}>+ Replication</Btn>
          <Btn size="sm" onClick={() => setDrafts((a) => [...a, newDraft("time")])}>+ Time</Btn>
          <Btn size="sm" onClick={() => setDrafts((a) => [...a, newDraft("mcap")])}>+ Market-cap</Btn>
        </div>

        <Toggle value={startActive} onChange={setStartActive} label="Start immediately" hint="otherwise it's created paused" />
      </div>
      <ModalFooter>
        <Btn size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" tone="primary" onClick={() => void save()} disabled={!canSave}>
          {busy ? "Creating…" : onDraft ? "Queue for launch" : "Create"}
        </Btn>
      </ModalFooter>
    </Modal>
  );
}

// ── Create Volume Bot modal ────────────────────────────────────────────────

function NewVolumeBotModal({
  open, onClose, onCreated, client, wallets, mint, symbol, onDraft,
}: {
  open: boolean; onClose: () => void; onCreated: () => void;
  client: Client; wallets: UserWallet[]; mint?: string; symbol?: string | null;
  onDraft?: (body: Omit<VolumeBotCreateBody, "mint" | "symbol">) => void;
}) {
  const { pushToast } = useApp();
  const [mintInput, setMintInput] = useState(mint ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(10);
  const [unit, setUnit] = useState<"sol" | "usd">("sol");
  const [durationMin, setDurationMin] = useState(60);
  const [delayMinSec, setDelayMin] = useState(1);
  const [delayMaxSec, setDelayMax] = useState(60);
  const [execMode, setExecMode] = useState<"organic" | "bundle">("organic");
  const [sizing, setSizing] = useState<"auto" | "fixed" | "random">("auto");
  const [fixed, setFixed] = useState(0.01);
  const [minSize, setMinSize] = useState(0.005);
  const [maxSize, setMaxSize] = useState(0.05);
  const [startActive, setStartActive] = useState(true);
  const [busy, setBusy] = useState(false);

  const effMint = (mint ?? mintInput).trim();
  const canSave = (!!effMint || !!onDraft) && selected.size > 0 && target > 0 && durationMin > 0 && !busy;

  async function save() {
    if (!canSave) return;
    const sz = sizing === "fixed" ? { kind: "fixed", fixed }
      : sizing === "random" ? { kind: "random", min: minSize, max: maxSize }
      : { kind: "auto" };
    const body: Omit<VolumeBotCreateBody, "mint" | "symbol"> = {
      walletIds: [...selected], targetVolume: target, unit, durationSec: durationMin * 60,
      delayMinMs: delayMinSec * 1000, delayMaxMs: delayMaxSec * 1000,
      execMode, sizing: sz, status: startActive ? "active" : "paused",
    };
    if (onDraft) { onDraft(body); onCreated(); return; }
    setBusy(true);
    try {
      await client.createVolumeBot({ ...body, mint: effMint, symbol: symbol ?? undefined });
      pushToast({ title: `${AUTO_LABEL.volume} created`, body: symbol ?? shortAddr(effMint), tone: "buy" });
      onCreated();
    } catch (e) {
      pushToast({ title: "CREATE FAILED", body: e instanceof Error ? e.message : "request failed", tone: "sell" });
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} width={680} mobileVariant="sheet">
      <ModalHeader title={`New ${AUTO_LABEL.volume}`} onClose={onClose} />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14, padding: "16px 20px", overflowY: "auto", background: "var(--ink-1)" }}>
        <ModalIntro>Trades small amounts back and forth across the selected wallets to keep your chart active and volume up. Set a target volume and how long it should run.</ModalIntro>
        <SectionCard dense eyebrow="Volume" title="Target & cadence">
          {!mint && !onDraft && (
            <Field label="Token mint">
              <input value={mintInput} onChange={(e) => setMintInput(e.target.value)} placeholder="mint address"
                style={{ background: "var(--ink-0)", border: "1px solid var(--line-soft)", color: "var(--paper)", padding: "9px 12px", borderRadius: 8, fontSize: 12, fontFamily: "var(--font-mono)", width: "100%", outline: "none" }} />
            </Field>
          )}
          <Field label="Wallet pool">
            <WalletPool wallets={wallets} selected={selected} onToggle={(id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} />
          </Field>
          <FieldGrid cols={3}>
            <Field label="Target volume"><NumberInput value={target} onChange={setTarget} min={0} /></Field>
            <Field label="Unit"><Select value={unit} onChange={setUnit} options={[{ value: "sol", label: "SOL" }, { value: "usd", label: "USD" }]} /></Field>
            <Field label="Duration"><NumberInput value={durationMin} onChange={setDurationMin} min={1} suffix="min" /></Field>
            <Field label="Delay min"><NumberInput value={delayMinSec} onChange={setDelayMin} min={0} suffix="s" /></Field>
            <Field label="Delay max"><NumberInput value={delayMaxSec} onChange={setDelayMax} min={0} suffix="s" /></Field>
            <Field label="Mode"><Select value={execMode} onChange={setExecMode} options={[{ value: "organic", label: "Organic" }, { value: "bundle", label: "Bundle" }]} /></Field>
          </FieldGrid>
          <Field label="Trade sizing">
            <Segmented value={sizing} onChange={setSizing} options={[{ value: "auto", label: "Auto" }, { value: "fixed", label: "Fixed" }, { value: "random", label: "Random" }]} />
          </Field>
          {sizing === "fixed" && <Field label="Size per trade"><NumberInput value={fixed} onChange={setFixed} min={0} suffix="SOL" /></Field>}
          {sizing === "random" && (
            <FieldGrid cols={2}>
              <Field label="Min size"><NumberInput value={minSize} onChange={setMinSize} min={0} suffix="SOL" /></Field>
              <Field label="Max size"><NumberInput value={maxSize} onChange={setMaxSize} min={0} suffix="SOL" /></Field>
            </FieldGrid>
          )}
        </SectionCard>
        <Toggle value={startActive} onChange={setStartActive} label="Start immediately" hint="otherwise it's created paused" />
      </div>
      <ModalFooter>
        <Btn size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" tone="primary" onClick={() => void save()} disabled={!canSave}>{busy ? "Creating…" : onDraft ? "Queue for launch" : "Create"}</Btn>
      </ModalFooter>
    </Modal>
  );
}

// ── Deploy "before launch" draft configurator ──────────────────────────────
// Queues market-making sessions that arm on a token the moment it launches.
// Used by the /deploy form; the deploy page calls applyMarketMakingDrafts on
// the new mint after a successful launch.

export interface MmDraft {
  id: string;
  kind: "autobuy" | "autosell" | "volume";
  summary: string;
  automode?: Omit<AutomodeCreateBody, "mint" | "symbol">;
  volume?: Omit<VolumeBotCreateBody, "mint" | "symbol">;
}

// Plain-language explainer shown at the top of an automation modal so a
// first-time user immediately understands what the config below does.
function ModalIntro({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--paper-3)", background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 10, padding: "10px 12px" }}>
      {children}
    </p>
  );
}

// A clear, self-describing "add automation" card (icon + title + description +
// Add/queued badge). Used by the deploy wizard so it's obvious what each
// automation does and that they arm AFTER launch — replaces bare add-buttons.
export function AdvActionCard({ icon, tint, title, desc, count, onClick }: {
  icon: React.ReactNode; tint: string; title: string; desc: string; count: number; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "10px 12px", borderRadius: 10,
        border: `1px solid ${count > 0 ? tint : "var(--line-soft)"}`,
        background: count > 0 ? "var(--ink-2)" : "var(--ink-0)",
        cursor: "pointer", textAlign: "left", transition: "border-color 120ms, background 120ms",
      }}
    >
      <span style={{
        flexShrink: 0, width: 32, height: 32, borderRadius: 9,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: `color-mix(in oklch, ${tint} 16%, transparent)`, color: tint,
      }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--paper)" }}>{title}</span>
        <span style={{ display: "block", fontSize: 10.5, color: "var(--paper-4)", marginTop: 1, lineHeight: 1.35 }}>{desc}</span>
      </span>
      {count > 0 ? (
        <span style={{
          flexShrink: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: tint,
          background: `color-mix(in oklch, ${tint} 14%, transparent)`,
          border: `1px solid color-mix(in oklch, ${tint} 40%, transparent)`,
          borderRadius: 999, padding: "2px 8px",
        }}>{count} queued</span>
      ) : (
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: "var(--paper-3)" }}>+ Add</span>
      )}
    </button>
  );
}

export function MarketMakingDraftConfig({ client, wallets, value, onChange, embedded }: {
  client: Client; wallets: UserWallet[]; value: MmDraft[]; onChange: (next: MmDraft[]) => void;
  /** Render only the add-buttons (+ modal) so a parent can frame a unified panel. */
  embedded?: boolean;
}) {
  const [open, setOpen] = useState<null | "autobuy" | "autosell" | "volume">(null);
  const platform = useMemo(() => wallets.filter((w) => w.kind === "PLATFORM"), [wallets]);
  const rid = () => Math.random().toString(36).slice(2);

  const buttons = (
    <>
      <Btn size="sm" tone="primary" onClick={() => setOpen("autobuy")}>{autoAddLabel("autobuy")}</Btn>
      <Btn size="sm" tone="primary" onClick={() => setOpen("autosell")}>{autoAddLabel("autosell")}</Btn>
      <Btn size="sm" onClick={() => setOpen("volume")}>{autoAddLabel("volume")}</Btn>
    </>
  );
  const modal = open === "volume" ? (
    <NewVolumeBotModal
      open onClose={() => setOpen(null)} onCreated={() => setOpen(null)}
      client={client} wallets={platform}
      onDraft={(b) => { onChange([...value, { id: rid(), kind: "volume", summary: `Volume · ${b.targetVolume} ${(b.unit ?? "sol").toUpperCase()} / ${Math.round((b.durationSec ?? 0) / 60)}min · ${b.walletIds.length}w`, volume: b }]); setOpen(null); }} />
  ) : open ? (
    <NewAutomodeModal
      open kind={open} onClose={() => setOpen(null)} onCreated={() => setOpen(null)}
      client={client} wallets={platform}
      onDraft={(b) => { onChange([...value, { id: rid(), kind: open, summary: `${AUTO_LABEL[open]} · ${b.strategies?.length ?? 0} strat · ${b.walletIds.length}w`, automode: b }]); setOpen(null); }} />
  ) : null;

  if (embedded) return (
    <>
      <AdvActionCard icon={Icon.autobuy(18)} tint="var(--buy)" title="Auto-buy"
        desc="Automatically buy more once the token hits market-cap or time targets you set."
        count={value.filter((v) => v.kind === "autobuy").length} onClick={() => setOpen("autobuy")} />
      <AdvActionCard icon={Icon.autosell(18)} tint="var(--sell)" title="Auto-sell"
        desc="Take profit automatically — sell at market-cap targets or on a schedule."
        count={value.filter((v) => v.kind === "autosell").length} onClick={() => setOpen("autosell")} />
      <AdvActionCard icon={Icon.volumeBot(18)} tint="var(--info)" title="Volume bot"
        desc="Keep the chart active by trading small amounts back and forth across your wallets."
        count={value.filter((v) => v.kind === "volume").length} onClick={() => setOpen("volume")} />
      {modal}
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 11, color: "var(--paper-3)", lineHeight: 1.5 }}>
        Queue market-making that arms on the new token the instant it launches —
        {AUTO_LABEL.autobuy} / {AUTO_LABEL.autosell} strategies and {AUTO_LABEL.volume} across your platform wallets.
      </span>
      {value.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {value.map((d) => (
            <div key={d.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
              padding: "8px 10px", background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 8,
            }}>
              <span style={{ fontSize: 11, color: "var(--paper)", fontFamily: "var(--font-mono)" }}>{d.summary}</span>
              <Btn size="xs" tone="sell" onClick={() => onChange(value.filter((x) => x.id !== d.id))}>Remove</Btn>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{buttons}</div>
      {modal}
    </div>
  );
}

/// Arm every queued draft on the freshly-launched mint (created active). Returns
/// how many sessions were armed; individual failures are swallowed.
export async function applyMarketMakingDrafts(
  client: Client, mint: string, symbol: string | undefined, drafts: MmDraft[],
): Promise<{ armed: number; failures: { kind: string; error: string }[] }> {
  let armed = 0;
  const failures: { kind: string; error: string }[] = [];
  for (const d of drafts) {
    try {
      if (d.kind === "volume" && d.volume) { await client.createVolumeBot({ ...d.volume, mint, symbol }); armed++; }
      else if (d.automode) { await client.createAutomode({ ...d.automode, mint, symbol }); armed++; }
      else { failures.push({ kind: d.kind, error: "draft had no strategy payload" }); }
    } catch (e) {
      // No longer swallowed: surface the reason so a queued session that fails
      // to arm on the freshly-launched mint is visible to the user.
      failures.push({ kind: d.kind, error: e instanceof Error ? e.message : "request failed" });
    }
  }
  return { armed, failures };
}
