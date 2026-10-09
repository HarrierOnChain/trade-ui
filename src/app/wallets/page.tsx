"use client";
/**
 * Wallets — the vault of this Trade UI.
 *
 * Every wallet lives encrypted on this Trade UI's server; the browser sees
 * addresses and labels only. From here: create, import, watch, rename, pick
 * which wallets trade, export a key (password), send SOL (password), delete
 * (password). The right column holds the lock's settings.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Btn, Icon, Tooltip } from "../../components/atoms";
import { WalletAvatar } from "../../components/WalletAvatar";
import { useApp } from "../../contexts/AppContext";
import { useChain } from "../../contexts/ChainContext";
import { useIsMobile, useIsPhone } from "../../hooks/useMediaQuery";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useUserWallets } from "../../hooks/useUserWallets";
import { explorerAccountUrl, nativeSymbol, type ChainId } from "../../lib/chains";
import { shortAddr } from "../../lib/format";
import {
  WALLETS_EVENT,
  auth,
  cachedWallets,
  vault,
  type ImportResult,
  type RuntimeConfig,
  type VaultWallet,
  type WalletFamily,
} from "../../lib/vault/client";
import { LEGACY_WALLETS_KEY, keepLegacy, legacyEntries } from "../../lib/vault/keyText";
import { familyOf } from "../../api/vaultWallets";
import { SecurityPanel, autoLockLabel } from "../../components/vault/SecurityPanel";
import { DeleteModal, ExportModal, ImportModal, NewWalletModal, RenameModal, SendModal, WatchModal } from "./_components/modals";

function useVaultWallets(): { list: VaultWallet[]; loaded: boolean } {
  const [list, setList] = useState<VaultWallet[]>(() => cachedWallets());
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const sync = () => { setList(cachedWallets()); setLoaded(true); };
    window.addEventListener(WALLETS_EVENT, sync);
    vault.list().catch(() => {}).finally(() => setLoaded(true));
    return () => window.removeEventListener(WALLETS_EVENT, sync);
  }, []);
  return { list, loaded };
}

export default function WalletsPage() {
  usePageTitle("Wallets");
  const { pushToast } = useApp();
  const { chainId } = useChain();
  const isMobile = useIsMobile();
  const userWallets = useUserWallets();
  const { list, loaded } = useVaultWallets();
  const currentFamily = familyOf(chainId);

  const [family, setFamily] = useState<WalletFamily>(currentFamily);
  useEffect(() => { setFamily(currentFamily); }, [currentFamily]);
  const [query, setQuery] = useState("");
  const [config, setConfig] = useState<RuntimeConfig | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [exportW, setExportW] = useState<VaultWallet | null>(null);
  const [sendW, setSendW] = useState<VaultWallet | null>(null);
  const [renameW, setRenameW] = useState<VaultWallet | null>(null);
  const [deleteW, setDeleteW] = useState<VaultWallet | null>(null);

  useEffect(() => {
    auth.config().then(setConfig).catch(() => {});
  }, []);

  const counts = useMemo(() => ({
    sol: list.filter((w) => w.family === "sol").length,
    evm: list.filter((w) => w.family === "evm").length,
  }), [list]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((w) => w.family === family)
      .filter((w) => !q || w.address.toLowerCase().includes(q) || (w.label ?? "").toLowerCase().includes(q));
  }, [list, family, query]);

  const balanceOf = useCallback((w: VaultWallet): number | null => {
    if (w.family !== currentFamily) return null;
    const b = userWallets.balances[w.id];
    if (!b || (b.loading && b.updatedAt === 0)) return null;
    return b.sol;
  }, [currentFamily, userWallets.balances]);

  // After creating or importing the first Solana keys, trade with them.
  const adopt = useCallback((created: VaultWallet[]) => {
    const keys = created.filter((w) => w.family === currentFamily && !w.watchOnly);
    if (keys.length > 0 && userWallets.activeIds.size === 0) userWallets.setActive([keys[0].id]);
  }, [currentFamily, userWallets]);

  const onImported = useCallback((r: ImportResult) => adopt(r.created), [adopt]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      pushToast({ title: "COPIED", body: shortAddr(text, 6), tone: "buy" });
    } catch { /* ignore */ }
  }

  const pageStyle: React.CSSProperties = {
    flex: 1, minHeight: 0, overflowY: "auto",
    padding: isMobile ? "var(--pad-y) var(--pad-x) 32px" : "22px 24px 40px",
    display: "flex", flexDirection: "column", gap: isMobile ? 14 : 18,
    color: "var(--paper)",
  };

  return (
    <div style={pageStyle}>
      <Header
        onNew={() => setNewOpen(true)}
        onImport={() => setImportOpen(true)}
        onWatch={() => setWatchOpen(true)}
      />

      <LegacyBanner onMoved={adopt} />

      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(300px, 380px)",
        gap: 18, alignItems: "start",
      }}>
        <section style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "14px 16px 12px" }}>
            <div role="tablist" style={{ display: "inline-flex", gap: 4 }}>
              {(["sol", "evm"] as const).map((f) => {
                const on = family === f;
                return (
                  <button key={f} role="tab" aria-selected={on} type="button" onClick={() => setFamily(f)} style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                    border: `1px solid ${on ? "var(--line)" : "transparent"}`,
                    background: on ? "var(--ink-2)" : "transparent", color: on ? "var(--paper)" : "var(--paper-3)",
                  }}>
                    {f === "sol" ? "Solana" : "EVM"}
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--paper-4)" }}>{counts[f]}</span>
                  </button>
                );
              })}
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 32,
              background: "var(--ink-0)", border: "1px solid var(--line-soft)", borderRadius: 8,
              flex: isMobile ? "1 1 100%" : "0 1 260px",
            }}>
              <span style={{ color: "var(--paper-4)", display: "inline-flex" }}>{Icon.search(12)}</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Label or address"
                aria-label="Filter wallets"
                style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "var(--paper)", fontSize: 12.5 }} />
            </div>
          </div>
          {family === "evm" && (
            <p style={{ margin: 0, padding: "0 16px 12px", fontSize: 11.5, color: "var(--paper-4)", lineHeight: 1.5 }}>
              One EVM key works on Ethereum, BNB Chain, Base and Robinhood with the same address.
              It trades on all four through the Raze EVM router; sending coins runs on Solana for now.
            </p>
          )}

          <div style={{ borderTop: "1px solid var(--line-soft)" }}>
            {!loaded && list.length === 0 ? (
              <Empty text="Loading wallets…" />
            ) : shown.length === 0 ? (
              query ? <Empty text="No wallet matches." /> : (
                <Empty
                  text={`No ${family === "sol" ? "Solana" : "EVM"} wallets yet.`}
                  actions={<>
                    <Btn size="sm" tone="primary" onClick={() => setNewOpen(true)}>{Icon.plus(11)} New wallet</Btn>
                    <Btn size="sm" tone="ghost" onClick={() => setImportOpen(true)}>Import key</Btn>
                  </>}
                />
              )
            ) : (
              shown.map((w, i) => (
                <WalletRow
                  key={w.id}
                  wallet={w}
                  index={i}
                  chainId={chainId}
                  balance={balanceOf(w)}
                  native={nativeSymbol(w.family === currentFamily ? chainId : w.family === "sol" ? "sol" : "eth")}
                  trading={userWallets.activeIds.has(w.id)}
                  canTrade={!w.watchOnly && w.family === "sol" && chainId === "sol"}
                  onToggleTrading={() => userWallets.toggleActive(w.id)}
                  onCopy={() => void copy(w.address)}
                  onExport={() => setExportW(w)}
                  onSend={() => setSendW(w)}
                  onRename={() => setRenameW(w)}
                  onDelete={() => setDeleteW(w)}
                />
              ))
            )}
          </div>
        </section>

        <aside style={{ ...card, padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 6 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center",
              color: "var(--accent)", background: "color-mix(in oklch, var(--accent) 12%, transparent)",
            }}>{Icon.shield(16)}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Vault unlocked</span>
              <span style={{ fontSize: 11.5, color: "var(--paper-3)" }}>
                {config ? `Auto-lock: ${autoLockLabel(config.autoLockMinutes).toLowerCase()}` : "…"}
              </span>
            </div>
          </div>
          <SecurityPanel config={config} onConfig={setConfig} />
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--paper-4)", lineHeight: 1.55 }}>
            Backups: keep the recovery key offline and a copy of the vault file. Exported keys work
            anywhere, even without Trade UI.
          </p>
        </aside>
      </div>

      <NewWalletModal open={newOpen} family={family} onClose={() => setNewOpen(false)} onCreated={adopt} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={onImported} />
      <WatchModal open={watchOpen} onClose={() => setWatchOpen(false)} />
      <ExportModal wallet={exportW} onClose={() => setExportW(null)} />
      <SendModal
        wallet={sendW}
        balanceSol={sendW ? balanceOf(sendW) : null}
        onClose={() => setSendW(null)}
        onSent={() => void userWallets.refreshBalances()}
      />
      <RenameModal wallet={renameW} onClose={() => setRenameW(null)} />
      <DeleteModal wallet={deleteW} onClose={() => setDeleteW(null)} />
    </div>
  );
}

const card: React.CSSProperties = {
  background: "var(--ink-1)",
  border: "1px solid var(--line-soft)",
  borderRadius: 12,
  minWidth: 0,
};

function Header({ onNew, onImport, onWatch }: { onNew: () => void; onImport: () => void; onWatch: () => void }) {
  const isPhone = useIsPhone();
  return (
    <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, maxWidth: 680 }}>
        <span className="eyebrow" style={{ fontSize: 10 }}>Wallets</span>
        <h1 className="ser" style={{
          fontStyle: "italic", fontSize: isPhone ? 28 : 38, lineHeight: 1, margin: 0,
          letterSpacing: "-0.015em", fontWeight: 400,
        }}>
          Your keys, <span style={{ color: "var(--accent)" }}>under lock</span>.
        </h1>
        <p style={{ fontSize: 12, color: "var(--paper-3)", margin: 0, lineHeight: 1.55 }}>
          Every key is encrypted in this Trade UI&apos;s vault and signs on its server. The browser sees addresses only;
          a key leaves the vault when you export it, with your password.
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn tone="primary" onClick={onNew}>{Icon.plus(12)} New wallet</Btn>
        <Btn tone="ghost" onClick={onImport}>{Icon.key(12)} Import key</Btn>
        <Btn tone="ghost" onClick={onWatch}>{Icon.eye(12)} Watch address</Btn>
      </div>
    </header>
  );
}

function Empty({ text, actions }: { text: string; actions?: React.ReactNode }) {
  return (
    <div style={{ padding: "32px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 12.5, color: "var(--paper-3)" }}>{text}</span>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>{actions}</div>}
    </div>
  );
}

function IconAction({ label, onClick, children, danger }: {
  label: string; onClick: () => void; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <button type="button" aria-label={label} onClick={onClick} style={{
        width: 30, height: 30, borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "1px solid var(--line-soft)", cursor: "pointer",
        color: danger ? "var(--sell)" : "var(--paper-3)",
      }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ink-2)"; e.currentTarget.style.color = danger ? "var(--sell)" : "var(--paper)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = danger ? "var(--sell)" : "var(--paper-3)"; }}
      >{children}</button>
    </Tooltip>
  );
}

function TradeSwitch({ on, enabled, onChange }: { on: boolean; enabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Trade with this wallet"
      disabled={!enabled}
      onClick={onChange}
      style={{
        width: 34, height: 19, borderRadius: 999, position: "relative", padding: 0,
        border: "1px solid var(--line-soft)", cursor: enabled ? "pointer" : "not-allowed",
        background: on ? "var(--accent)" : "var(--ink-2)", opacity: enabled ? 1 : 0.4, transition: "background 150ms",
      }}
    >
      <span style={{
        position: "absolute", top: 1, left: on ? 16 : 1, width: 15, height: 15, borderRadius: "50%",
        background: "var(--paper)", transition: "left 150ms",
      }} />
    </button>
  );
}

function WalletRow({
  wallet, index, chainId, balance, native, trading, canTrade,
  onToggleTrading, onCopy, onExport, onSend, onRename, onDelete,
}: {
  wallet: VaultWallet;
  index: number;
  chainId: ChainId;
  balance: number | null;
  native: string;
  trading: boolean;
  canTrade: boolean;
  onToggleTrading: () => void;
  onCopy: () => void;
  onExport: () => void;
  onSend: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const isPhone = useIsPhone();
  const label = wallet.label || (wallet.watchOnly ? "Watched" : "Wallet");
  const explorerChain: ChainId = wallet.family === "sol" ? "sol" : (familyOf(chainId) === "evm" ? chainId : "eth");
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isPhone ? "minmax(0, 1fr) auto" : "minmax(0, 1fr) 120px 70px auto",
      alignItems: "center", gap: isPhone ? 10 : 14,
      padding: "12px 16px", borderBottom: "1px solid var(--line-soft)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <WalletAvatar label={label} index={index} size={32} />
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            <span className="mono" style={{
              fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 999, flexShrink: 0,
              color: wallet.watchOnly ? "var(--info, var(--paper-3))" : "var(--accent)",
              border: `1px solid color-mix(in oklch, ${wallet.watchOnly ? "var(--info, var(--paper-3))" : "var(--accent)"} 45%, transparent)`,
            }}>{wallet.watchOnly ? "watch" : "key"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <button type="button" onClick={onCopy} title="Copy address" className="mono" style={{
              background: "transparent", border: 0, padding: 0, cursor: "pointer",
              fontSize: 11.5, color: "var(--paper-3)", display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0,
            }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortAddr(wallet.address, isPhone ? 5 : 8)}</span>
              <span style={{ display: "inline-flex", flexShrink: 0 }}>{Icon.copy(10)}</span>
            </button>
            <a href={explorerAccountUrl(wallet.address, explorerChain)} target="_blank" rel="noopener noreferrer"
              aria-label="Open in explorer" style={{ color: "var(--paper-4)", display: "inline-flex" }}>{Icon.ext(10)}</a>
          </div>
        </div>
      </div>

      {!isPhone && (
        <span className="mono" style={{ fontSize: 12.5, textAlign: "right", color: balance == null ? "var(--paper-4)" : "var(--paper)" }}>
          {balance == null ? "—" : `${balance.toLocaleString("en-US", { maximumFractionDigits: balance < 10 ? 4 : 2 })} ${native}`}
        </span>
      )}

      {!isPhone && (
        <Tooltip content={canTrade ? (trading ? "Trades with the panels and quick buys" : "Pick it for trading") : wallet.watchOnly ? "Watch-only: no key to trade with" : "Trading runs on Solana for now"}>
          <span style={{ display: "inline-flex", justifyContent: "center" }}>
            <TradeSwitch on={trading && canTrade} enabled={canTrade} onChange={onToggleTrading} />
          </span>
        </Tooltip>
      )}

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {!wallet.watchOnly && wallet.family === "sol" && (
          <IconAction label="Send SOL" onClick={onSend}>{Icon.send(13)}</IconAction>
        )}
        {!wallet.watchOnly && <IconAction label="Export key" onClick={onExport}>{Icon.key(13)}</IconAction>}
        <IconAction label="Rename" onClick={onRename}>{Icon.quillPen(13)}</IconAction>
        <IconAction label={wallet.watchOnly ? "Stop watching" : "Delete"} onClick={onDelete} danger>{Icon.trash(13)}</IconAction>
      </div>
    </div>
  );
}

/** Wallets an older Trade UI kept unencrypted in this browser. */
function LegacyBanner({ onMoved }: { onMoved: (created: VaultWallet[]) => void }) {
  const { pushToast } = useApp();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const [left, setLeft] = useState<string | null>(null);

  useEffect(() => {
    try {
      setCount(legacyEntries(window.localStorage).length);
    } catch {
      setCount(0);
    }
  }, []);

  if (count === 0) return null;

  async function move() {
    setBusy(true);
    try {
      const entries = legacyEntries(window.localStorage);
      const r = await vault.import(entries.map((e) => e.item));
      const failed = r.errors.filter((e) => e.code !== "duplicate");
      onMoved(r.created);
      // What made it into the vault (or was there already) leaves the browser;
      // only what failed stays, for another try or to discard.
      keepLegacy(window.localStorage, failed.map((f) => entries[f.index]?.source).filter(Boolean));
      setCount(failed.length);
      if (failed.length === 0) {
        pushToast({ title: "MOVED INTO THE VAULT", body: `${r.created.length} wallet${r.created.length === 1 ? "" : "s"} encrypted; the browser copy is erased.`, tone: "buy", duration: 7000 });
      } else {
        setLeft(failed[0].message);
        pushToast({
          title: "SOME WALLETS NOT MOVED",
          body: `${failed.length} could not be imported (${failed[0].message}). Only those stay in this browser.`,
          tone: "sell",
          duration: 9000,
        });
      }
    } catch (e) {
      pushToast({ title: "NOT MOVED", body: e instanceof Error ? e.message : String(e), tone: "sell" });
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    if (!window.confirm(`Erase the ${count} wallet${count === 1 ? "" : "s"} left in this browser? A key that is not in the vault or backed up is lost.`)) return;
    window.localStorage.removeItem(LEGACY_WALLETS_KEY);
    setCount(0);
  }

  return (
    <div role="status" style={{
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      padding: "12px 16px", borderRadius: 12,
      background: "color-mix(in oklch, var(--amber) 9%, var(--ink-1))",
      border: "1px solid color-mix(in oklch, var(--amber) 45%, transparent)",
    }}>
      <span style={{ color: "var(--amber)", display: "inline-flex" }}>{Icon.key(16)}</span>
      <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {count} wallet{count === 1 ? "" : "s"} from an older Trade UI, unencrypted in this browser
        </span>
        <span style={{ fontSize: 12, color: "var(--paper-3)", lineHeight: 1.5 }}>
          {left
            ? `These could not be imported (${left}). Try again, or discard them.`
            : "Move them into the vault: they get encrypted with your password and the browser copy is erased."}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {left && <Btn tone="ghost" disabled={busy} onClick={discard}>Discard</Btn>}
        <Btn tone="primary" disabled={busy} onClick={() => void move()}>{busy ? "Moving…" : "Move into the vault"}</Btn>
      </div>
    </div>
  );
}
