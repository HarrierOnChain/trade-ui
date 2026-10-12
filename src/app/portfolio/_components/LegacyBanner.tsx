"use client";
/** Wallets an older Trade UI kept unencrypted in this browser. */
import React, { useEffect, useState } from "react";
import { Btn, Icon } from "../../../components/atoms";
import { useApp } from "../../../contexts/AppContext";
import { vault, type VaultWallet } from "../../../lib/vault/client";
import { LEGACY_WALLETS_KEY, keepLegacy, legacyEntries } from "../../../lib/vault/keyText";

export function LegacyBanner({ onMoved }: { onMoved: (created: VaultWallet[]) => void }) {
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
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", flexShrink: 0,
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
