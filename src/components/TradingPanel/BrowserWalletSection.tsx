"use client";
/**
 * The browser wallet in the wallet picker: connect one of the Solana wallets
 * installed in this browser (Wallet Standard), see which one signs, or
 * disconnect. Trades use it when no local wallet is selected.
 */
import React, { useState } from "react";
import { fmtSol, shortAddr } from "../../lib/format";
import {
  BROWSER_WALLET_ID,
  connectBrowserWallet,
  disconnectBrowserWallet,
  useBrowserWallet,
} from "../../lib/swap/browserWallet";
import { useUserWallets } from "../../hooks/useUserWallets";

const label: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 0.9,
  color: "var(--paper-4)",
  textTransform: "uppercase",
};

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 9px",
  background: "var(--ink-2)",
  border: "1px solid var(--line-soft)",
  borderRadius: 6,
  color: "var(--paper-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

export function BrowserWalletSection() {
  const { available, connected, connecting } = useBrowserWallet();
  const userWallets = useUserWallets();
  const [error, setError] = useState<string | null>(null);
  const localSelected = userWallets.activeWallets.some((w) => !w.isConnected);
  const sol = userWallets.balances[BROWSER_WALLET_ID]?.sol;

  async function connect(name: string) {
    setError(null);
    try {
      await connectBrowserWallet(name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/reject|denied|cancel/i.test(msg) ? "Rejected in wallet" : msg);
    }
  }

  return (
    <div style={{ padding: "9px 12px 10px", borderBottom: "1px solid var(--line-soft)", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={label}>Browser wallet</span>
        {connected && (
          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: localSelected ? "var(--paper-4)" : "var(--buy)" }}>
            {localSelected ? "idle · local wallets selected" : "signs trades"}
          </span>
        )}
      </div>

      {connected ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => userWallets.clearActive()}
            title={localSelected ? "Trade with this wallet instead of the selected local ones" : "Trades are signed in this wallet"}
            style={{ ...pill, flex: 1, minWidth: 0, justifyContent: "flex-start", cursor: localSelected ? "pointer" : "default" }}
          >
            {connected.wallet.icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={connected.wallet.icon} alt="" width={14} height={14} style={{ borderRadius: 3 }} />
            )}
            <span style={{ color: "var(--paper)" }}>{connected.wallet.name}</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--paper-3)" }}>{shortAddr(connected.address, 4)}</span>
            {typeof sol === "number" && (
              <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", color: "var(--paper-2)" }}>{fmtSol(sol, 3)} SOL</span>
            )}
          </button>
          <button type="button" onClick={() => void disconnectBrowserWallet()} style={pill} title="Disconnect">
            Disconnect
          </button>
        </div>
      ) : available.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {available.map((w) => (
            <button key={w.name} type="button" disabled={connecting} onClick={() => void connect(w.name)} style={{ ...pill, opacity: connecting ? 0.6 : 1 }}>
              {w.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.icon} alt="" width={14} height={14} style={{ borderRadius: 3 }} />
              )}
              Connect {w.name}
            </button>
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 11, color: "var(--paper-3)", lineHeight: 1.5 }}>
          No Solana wallet in this browser (Phantom, Solflare, Backpack…). Local wallets trade without one.
        </span>
      )}
      {error && <span style={{ fontSize: 11, color: "var(--sell)" }}>{error}</span>}
    </div>
  );
}
