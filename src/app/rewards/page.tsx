"use client";

// Rewards — points, tiers, quests, leaderboard, referrals and on-chain SOL
// claims. Restyled to plain raze green (no Tailwind, no new deps): inline
// style={{}} over var(--…) tokens + the shared atoms.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useBackend } from "../../api/backend";
import type {
  RewardsSummary,
  RewardQuest,
  LeaderboardEntry,
  RewardTierInfo,
} from "../../api/backend";
import { useApp } from "../../contexts/AppContext";
import { Btn, Pill, Modal, ModalHeader, ModalFooter, Icon } from "../../components/atoms";
import { useIsPhone } from "../../hooks/useMediaQuery";
import { fluidCols, fluidColsFit } from "../../lib/responsive";

type PayoutWallet = { pubkey: string; kind: string; label?: string | null };

type Tab = "quests" | "leaderboard" | "referrals" | "tiers" | "activity";

const TABS: Array<[Tab, string]> = [
  ["quests", "Quests"],
  ["leaderboard", "Leaderboard"],
  ["referrals", "Referrals"],
  ["tiers", "Tiers"],
  ["activity", "Activity"],
];

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtSol(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export default function RewardsPage() {
  const client = useBackend();
  const { pushToast } = useApp();
  const isPhone = useIsPhone();

  const [summary, setSummary] = useState<RewardsSummary | null>(null);
  const [quests, setQuests] = useState<RewardQuest[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<LeaderboardEntry | null>(null);
  // Payout targets are SOL wallets, fetched independently of the active trading
  // chain.
  const [solWallets, setSolWallets] = useState<PayoutWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("quests");
  const [claimOpen, setClaimOpen] = useState(false);

  const refresh = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const [s, q, lb, w] = await Promise.all([
        client.rewardsSummary().catch(() => null),
        client.rewardsQuests().catch(() => ({ quests: [] as RewardQuest[] })),
        client.rewardsLeaderboard().catch(() => ({ entries: [] as LeaderboardEntry[], me: null })),
        client.listWallets("sol").catch(() => ({ wallets: [] as PayoutWallet[] })),
      ]);
      setSummary(s);
      setQuests(q.quests);
      setLeaderboard(lb.entries);
      setMyRank(lb.me);
      setSolWallets(w.wallets);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => { void refresh(); }, [refresh]);

  const claimQuest = useCallback(async (id: string) => {
    try {
      const res = await client.rewardsClaimQuest(id);
      pushToast({ title: "QUEST CLAIMED", body: `+${fmt(res.awarded)} points`, tone: "buy" });
      void refresh(true);
    } catch (e) {
      pushToast({ title: "CLAIM FAILED", body: humanError(e), tone: "sell" });
    }
  }, [client, pushToast, refresh]);

  if (loading && !summary) return <RewardsSkeleton />;

  if (summary && !summary.enabled) {
    return (
      <CenteredState
        glyph={Icon.star(22)}
        title="Rewards are warming up"
        body="The rewards program isn't live yet. Check back soon — your trades and referrals will start earning points the moment it switches on."
      />
    );
  }

  const s = summary;

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      padding: "20px 24px 36px", overflow: "auto",
      color: "var(--paper)", fontFamily: "var(--font-ui)", gap: 18,
    }}>
      {/* Hero */}
      <header style={{ display: "flex", flexDirection: isPhone ? "column" : "row", alignItems: isPhone ? "stretch" : "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span className="eyebrow" style={{ fontSize: 10 }}>Rewards</span>
          <h1 className="ser" style={{ fontStyle: "italic", fontSize: isPhone ? 30 : 38, lineHeight: 1, margin: 0, color: "var(--paper)", letterSpacing: "-0.015em", fontWeight: 400 }}>
            Trade. Earn. <span style={{ color: "var(--accent)" }}>Climb.</span>
          </h1>
          <p style={{ fontSize: 12, color: "var(--paper-3)", margin: 0, maxWidth: 620, lineHeight: 1.5 }}>
            Every buy, deploy and referral earns points. Climb tiers for bigger multipliers, then redeem points for SOL.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn size="sm" onClick={() => void refresh(true)} disabled={refreshing}>{refreshing ? "Refreshing…" : "↻ Refresh"}</Btn>
          <Btn size="sm" tone="primary" disabled={!s || s.points <= 0} onClick={() => setClaimOpen(true)}>Claim SOL</Btn>
        </div>
      </header>

      {/* KPI tiles */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiTile label="Available points" value={s ? fmt(s.points) : "—"} sub={s ? `≈ ${fmtSol(s.solValue)} SOL` : ""} glyph={Icon.star(13)} />
        <KpiTile label="Tier" value={s ? s.tier.name : "—"} sub={s ? `${s.tier.multiplier}× points` : ""} glyph={Icon.crown(13)} />
        <KpiTile label="Lifetime points" value={s ? fmt(s.lifetimePoints) : "—"} sub={s?.nextTier ? `${fmt(s.nextTier.pointsToNext)} to ${s.nextTier.name}` : "Max tier"} glyph={Icon.trend(13)} />
        <KpiTile label="Trade volume" value={s ? `${fmtSol(s.stats.volumeSol)} SOL` : "—"} sub={s ? `${fmt(s.stats.deploys)} deploys` : ""} glyph={Icon.bolt(13)} />
        <KpiTile label="Referrals" value={s ? fmt(s.stats.referrals) : "—"} sub={s ? `+${fmt(s.referral.earnings)} pts earned` : ""} glyph={Icon.portfolio(13)} />
      </div>

      {/* Tier progress */}
      {s && <TierProgress summary={s} />}

      {/* Tab nav */}
      <nav className={isPhone ? "scroll-x" : undefined} style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--line-soft)" }}>
        {TABS.map(([key, label]) => {
          const on = tab === key;
          const count = key === "quests" ? quests.filter((q) => q.completed && !q.claimed).length : null;
          return (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: "10px 16px 12px", position: "relative", background: "transparent",
              color: on ? "var(--paper)" : "var(--paper-3)", border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: on ? 600 : 500, fontFamily: "var(--font-ui)",
              display: "inline-flex", alignItems: "center", gap: 7,
              whiteSpace: "nowrap", flexShrink: 0,
            }}>
              {label}
              {count != null && count > 0 && (
                <span style={{ padding: "1px 7px", borderRadius: 999, background: "var(--accent-w)", color: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600 }}>{count}</span>
              )}
              {on && (<span style={{ position: "absolute", bottom: -1, left: 0, right: 0, height: 2, background: "var(--accent)", borderRadius: "2px 2px 0 0" }} />)}
            </button>
          );
        })}
      </nav>

      {/* Tab body */}
      {tab === "quests" && <QuestsPanel quests={quests} loading={loading} onClaim={claimQuest} />}
      {tab === "leaderboard" && <LeaderboardPanel entries={leaderboard} me={myRank} loading={loading} />}
      {tab === "referrals" && s && <ReferralsPanel summary={s} onToast={pushToast} />}
      {tab === "tiers" && s && <TiersPanel tiers={s.tiers} currentIndex={s.tier.index} />}
      {tab === "activity" && s && <ActivityPanel history={s.history} />}

      {s && (
        <ClaimModal
          open={claimOpen}
          onClose={() => setClaimOpen(false)}
          summary={s}
          wallets={solWallets}
          onClaimed={() => { setClaimOpen(false); void refresh(true); }}
        />
      )}
    </div>
  );
}

// ── Tier progress bar ─────────────────────────────────────────────────────────

function TierProgress({ summary }: { summary: RewardsSummary }) {
  const cur = summary.tier;
  const next = summary.nextTier;
  return (
    <div style={{ background: "var(--ink-1)", border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="eyebrow">Tier progress</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--paper-2)" }}>
          {fmt(summary.lifetimePoints)} <span style={{ color: "var(--paper-4)" }}>/ {next ? fmt(next.minPoints) : "max"}</span>
        </span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 999, background: "var(--ink-3)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${summary.tierProgressPct}%`, background: "var(--accent)", borderRadius: 999, transition: "width .3s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>{cur.name} · {cur.multiplier}×</span>
        {next
          ? <span style={{ color: "var(--paper-3)" }}>{next.name} · {fmt(next.pointsToNext)} pts to go</span>
          : <span style={{ color: "var(--paper-3)" }}>Top tier reached</span>}
      </div>
    </div>
  );
}

// ── Quests ────────────────────────────────────────────────────────────────────

function QuestsPanel({ quests, loading, onClaim }: { quests: RewardQuest[]; loading: boolean; onClaim: (id: string) => void }) {
  if (loading && quests.length === 0) return <RowsSkeleton />;
  if (quests.length === 0) return <EmptyHero title="No quests yet" body="Quests will appear here once the program is fully live." />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: fluidCols(320), gap: 12 }}>
      {quests.map((q) => {
        const pct = q.target > 0 ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
        return (
          <div key={q.id} style={{ background: "var(--ink-1)", border: "1px solid var(--line)", borderLeft: `2px solid ${q.completed ? "var(--accent)" : "var(--line)"}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--paper)" }}>{q.title}</div>
                {q.description && <div style={{ fontSize: 11, color: "var(--paper-3)", marginTop: 2 }}>{q.description}</div>}
              </div>
              <Pill tone="green" size="xs">+{fmt(q.rewardPoints)}</Pill>
            </div>
            <div style={{ position: "relative", height: 6, borderRadius: 999, background: "var(--ink-3)", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: "var(--accent)", borderRadius: 999 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--paper-3)" }}>{fmt(q.progress)} / {fmt(q.target)} · {q.period}</span>
              {q.claimed
                ? <Pill tone="ghost" size="xs">Claimed</Pill>
                : q.completed
                  ? <Btn size="xs" tone="primary" onClick={() => onClaim(q.id)}>Claim</Btn>
                  : <span style={{ fontSize: 11, color: "var(--paper-4)" }}>In progress</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function LeaderboardPanel({ entries, me, loading }: { entries: LeaderboardEntry[]; me: LeaderboardEntry | null; loading: boolean }) {
  if (loading && entries.length === 0) return <RowsSkeleton />;
  if (entries.length === 0) return <EmptyHero title="No rankings yet" body="Be the first to earn points and top the leaderboard." />;
  return (
    <div style={{ background: "var(--ink-1)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
      {entries.map((e) => <LeaderRow key={`${e.rank}-${e.label}`} e={e} />)}
      {me && !entries.some((e) => e.isMe) && (
        <>
          <div style={{ height: 1, background: "var(--line)" }} />
          <LeaderRow e={me} />
        </>
      )}
    </div>
  );
}

function LeaderRow({ e }: { e: LeaderboardEntry }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
      borderBottom: "1px solid var(--line-soft)",
      background: e.isMe ? "var(--accent-w)" : "transparent",
    }}>
      <span className="mono" style={{ width: 36, fontSize: 12, color: e.rank <= 3 ? "var(--accent)" : "var(--paper-4)", fontWeight: 600 }}>#{e.rank}</span>
      <span className="mono" style={{ flex: 1, fontSize: 12, color: e.isMe ? "var(--accent)" : "var(--paper-2)" }}>{e.isMe ? "You" : e.label}</span>
      <span className="mono" style={{ fontSize: 12, color: "var(--paper)" }}>{fmt(e.points)} pts</span>
    </div>
  );
}

// ── Referrals ─────────────────────────────────────────────────────────────────

function ReferralsPanel({ summary, onToast }: { summary: RewardsSummary; onToast: (t: { title: string; body?: string; tone?: "buy" | "sell" }) => void }) {
  const r = summary.referral;
  const copy = (text: string, label: string) => {
    try {
      void navigator.clipboard.writeText(text);
      onToast({ title: "COPIED", body: label, tone: "buy" });
    } catch {
      onToast({ title: "COPY FAILED", body: "Select and copy manually.", tone: "sell" });
    }
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: fluidColsFit(280), gap: 12 }}>
      <div style={{ background: "var(--ink-1)", border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="eyebrow">Your referral link</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--ink-0)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px" }}>
          <span className="mono ellipsis" style={{ flex: 1, fontSize: 12, color: "var(--paper-2)" }}>{r.link}</span>
          <Btn size="xs" onClick={() => copy(r.link, "Referral link")}>Copy</Btn>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="eyebrow">Code</span>
          <span className="mono" style={{ fontSize: 14, color: "var(--accent)", letterSpacing: "0.06em" }}>{r.code}</span>
          <Btn size="xs" onClick={() => copy(r.code, "Referral code")}>Copy</Btn>
        </div>
        <p style={{ fontSize: 11, color: "var(--paper-3)", margin: 0, lineHeight: 1.5 }}>
          Friends who sign up with your link earn 50 points and hand you 100 — plus 25% of every point they earn, forever.
        </p>
      </div>
      <div style={{ background: "var(--ink-1)", border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <span className="eyebrow">Referral stats</span>
        <div style={{ display: "flex", gap: 24 }}>
          <div>
            <div className="mono" style={{ fontSize: 22, color: "var(--paper)" }}>{fmt(r.count)}</div>
            <div className="eyebrow">Friends referred</div>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 22, color: "var(--accent)" }}>{fmt(r.earnings)}</div>
            <div className="eyebrow">Points earned</div>
          </div>
        </div>
        {r.referred && <Pill tone="ghost" size="xs">You were referred — welcome bonus applied</Pill>}
      </div>
    </div>
  );
}

// ── Tiers ─────────────────────────────────────────────────────────────────────

function TiersPanel({ tiers, currentIndex }: { tiers: RewardTierInfo[]; currentIndex: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: fluidCols(180), gap: 12 }}>
      {tiers.map((t) => {
        const active = t.index === currentIndex;
        const reached = t.index <= currentIndex;
        return (
          <div key={t.index} style={{
            background: active ? "var(--accent-w)" : "var(--ink-1)",
            border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
            borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8,
            opacity: reached ? 1 : 0.7,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="eyebrow" style={{ color: active ? "var(--accent)" : "var(--paper-3)" }}>Tier {t.index + 1}</span>
              {active && <Pill tone="green" size="xs">You</Pill>}
            </div>
            <div className="ser" style={{ fontSize: 20, color: "var(--paper)", fontStyle: "italic" }}>{t.name}</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>{t.multiplier}× points</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--paper-4)" }}>{fmt(t.minPoints)}+ lifetime pts</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  buy: "Buy reward",
  deploy: "Deploy reward",
  referral_signup: "Referral bonus",
  referral_share: "Referral share",
  volume_milestone: "Volume milestone",
  quest: "Quest reward",
  claim: "SOL claim",
  claim_refund: "Claim refund",
  adjust: "Adjustment",
};

function ActivityPanel({ history }: { history: RewardsSummary["history"] }) {
  if (history.length === 0) return <EmptyHero title="No activity yet" body="Your point history will show up here as you trade and refer." />;
  return (
    <div style={{ background: "var(--ink-1)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
      {history.map((h, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--line-soft)" }}>
          <span style={{ flex: 1, fontSize: 12, color: "var(--paper-2)" }}>{TYPE_LABEL[h.type] ?? h.type}{h.reason ? <span style={{ color: "var(--paper-4)" }}> · {h.reason}</span> : null}</span>
          <span className="mono" style={{ fontSize: 12, color: h.points >= 0 ? "var(--accent)" : "var(--sell)" }}>{h.points >= 0 ? "+" : ""}{fmt(h.points)}</span>
          <span className="mono" style={{ fontSize: 10, color: "var(--paper-4)", width: 92, textAlign: "right" }}>{new Date(h.at).toLocaleDateString()}</span>
        </div>
      ))}
    </div>
  );
}

// ── Claim modal ───────────────────────────────────────────────────────────────

function ClaimModal({ open, onClose, summary, wallets, onClaimed }: {
  open: boolean;
  onClose: () => void;
  summary: RewardsSummary;
  wallets: Array<{ pubkey: string; kind: string; label?: string | null }>;
  onClaimed: () => void;
}) {
  const client = useBackend();
  const { pushToast } = useApp();
  const payable = useMemo(() => wallets.filter((w) => w.kind === "PHANTOM" || w.kind === "PLATFORM" || w.kind === "PRIVY"), [wallets]);
  const [points, setPoints] = useState<number>(summary.points);
  const [dest, setDest] = useState<string>(payable[0]?.pubkey ?? "");
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState<string>("");

  useEffect(() => {
    if (open) {
      setPoints(summary.points);
      setDest(payable[0]?.pubkey ?? "");
      setIdemKey(genKey());
    }
  }, [open, summary.points, payable]);

  const sol = summary.pointsPerSol > 0 ? points / summary.pointsPerSol : 0;
  const tooSmall = sol < 0.05;
  const overBalance = points > summary.points;

  const submit = async () => {
    if (!dest) { pushToast({ title: "NO WALLET", body: "Connect a wallet to receive SOL.", tone: "sell" }); return; }
    if (!summary.payoutConfigured) { pushToast({ title: "UNAVAILABLE", body: "Payouts aren't configured yet.", tone: "sell" }); return; }
    setBusy(true);
    try {
      const res = await client.rewardsClaim(Math.floor(points), dest, idemKey);
      pushToast({ title: "CLAIM SENT", body: `${fmtSol(res.sol)} SOL · ${res.signature ? res.signature.slice(0, 8) + "…" : res.status}`, tone: "buy" });
      onClaimed();
    } catch (e) {
      // Default: keep the same idempotency key so a retry can't double-pay. But
      // if the server says the prior attempt failed + was refunded, a brand-new
      // claim is required — regenerate the key.
      if (e instanceof Error && /claim_failed_retry/.test(e.message)) setIdemKey(genKey());
      pushToast({ title: "CLAIM FAILED", body: humanError(e), tone: "sell" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={440} mobileVariant="sheet">
      <ModalHeader eyebrow="Claim rewards" title="Redeem points for SOL" onClose={onClose} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14, background: "var(--ink-1)" }}>
        <div style={{ fontSize: 12, color: "var(--paper-3)" }}>
          Balance: <span className="mono" style={{ color: "var(--paper)" }}>{fmt(summary.points)}</span> pts · rate {fmt(summary.pointsPerSol)} pts = 1 SOL
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="eyebrow">Points to redeem</span>
          <input
            type="number" value={points} min={0} max={summary.points}
            onChange={(e) => setPoints(Math.max(0, Math.min(summary.points, Number(e.target.value) || 0)))}
            style={{ background: "var(--ink-0)", border: `1px solid ${overBalance ? "var(--sell)" : "var(--line-soft)"}`, borderRadius: 6, padding: "8px 10px", color: "var(--paper)", fontFamily: "var(--font-mono)", fontSize: 13, outline: "none" }}
          />
          <span className="mono" style={{ fontSize: 11, color: tooSmall ? "var(--sell)" : "var(--accent)" }}>≈ {fmtSol(sol)} SOL{tooSmall ? " (min 0.05 SOL)" : ""}</span>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="eyebrow">Receive to</span>
          {payable.length === 0
            ? <span style={{ fontSize: 12, color: "var(--sell)" }}>No eligible wallet — connect one first.</span>
            : (
              <select value={dest} onChange={(e) => setDest(e.target.value)} style={{ background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 6, padding: "8px 10px", color: "var(--paper)", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none" }}>
                {payable.map((w) => (
                  <option key={w.pubkey} value={w.pubkey}>{(w.label ? `${w.label} · ` : "")}{w.pubkey.slice(0, 4)}…{w.pubkey.slice(-4)} ({w.kind})</option>
                ))}
              </select>
            )}
        </label>

      </div>
      <ModalFooter>
        <Btn size="sm" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn size="sm" tone="primary" onClick={submit} disabled={busy || tooSmall || overBalance || points <= 0 || payable.length === 0}>
          {busy ? "Sending…" : "Claim SOL"}
        </Btn>
      </ModalFooter>
    </Modal>
  );
}

// ── Local presentation primitives ─────────────────────────────────────────────

function KpiTile({ label, value, sub, glyph }: { label: string; value: React.ReactNode; sub?: React.ReactNode; glyph?: React.ReactNode }) {
  return (
    <div style={{ flex: "1 1 180px", minWidth: 180, background: "var(--ink-1)", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent)" }}>
        {glyph}
        <span className="eyebrow" style={{ color: "var(--paper-3)" }}>{label}</span>
      </div>
      <div className="mono" style={{ fontSize: 22, color: "var(--paper)", lineHeight: 1.1 }}>{value}</div>
      {sub != null && sub !== "" && <div style={{ fontSize: 11, color: "var(--paper-3)" }}>{sub}</div>}
    </div>
  );
}

function EmptyHero({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "48px 24px", textAlign: "center" }}>
      <div style={{ width: 44, height: 44, borderRadius: 999, background: "var(--accent-w)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}>{Icon.star(18)}</div>
      <div className="ser" style={{ fontSize: 18, fontStyle: "italic", color: "var(--paper)" }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--paper-3)", maxWidth: 380, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

function CenteredState({ glyph, title, body }: { glyph: React.ReactNode; title: string; body: string }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "60px 24px", textAlign: "center", color: "var(--paper)", fontFamily: "var(--font-ui)" }}>
      <div style={{ width: 56, height: 56, borderRadius: 999, background: "var(--accent-w)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}>{glyph}</div>
      <h2 className="ser" style={{ fontSize: 24, fontStyle: "italic", margin: 0 }}>{title}</h2>
      <p style={{ fontSize: 13, color: "var(--paper-3)", maxWidth: 420, lineHeight: 1.5, margin: 0 }}>{body}</p>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 84, borderRadius: 12 }} />)}
    </div>
  );
}

function RewardsSkeleton() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px 36px", gap: 18 }}>
      <div className="skeleton" style={{ height: 60, width: 360, borderRadius: 10 }} />
      <div style={{ display: "flex", gap: 12 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 84, flex: 1, borderRadius: 10 }} />)}
      </div>
      <RowsSkeleton />
    </div>
  );
}

function genKey(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* ignore */ }
  return `claim_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const map: Record<string, string> = {
    rewards_disabled: "Rewards aren't live yet.",
    insufficient_points: "Not enough points.",
    amount_too_small: "Below the minimum claim (0.05 SOL).",
    destination_not_owned: "That wallet isn't linked to your account.",
    invalid_destination: "Invalid destination address.",
    invalid_points: "Invalid amount.",
    invalid_idempotency_key: "Couldn't start this claim — refresh and try again.",
    payout_unavailable: "Payouts aren't configured yet.",
    payout_failed: "The payout couldn't be sent — your points were refunded.",
    claim_failed_retry: "The previous attempt failed and your points were refunded. Start a new claim.",
    already_claimed: "Already claimed.",
    quest_incomplete: "Quest isn't complete yet.",
    quest_not_found: "Quest unavailable.",
  };
  return map[msg] ?? msg;
}
