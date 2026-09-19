"use client";
import React, { useEffect, useState } from "react";
import { useSolPrice } from "../../hooks/useSolPrice";
import { RazeWebSocket } from "../../api/websocket";

/** Lightweight strip metrics — no full deploy/migration hooks (those flood the
 *  backend when duplicated beside the monitor columns). */
export function MonitorStrip() {
  const sol = useSolPrice();
  const [deployCount, setDeployCount] = useState(0);
  const [migrationCount, setMigrationCount] = useState(0);
  const wsOk = useWsStatus();

  useEffect(() => {
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    ws.subscribe(["deploy", "migration"]);
    const unsubDeploy = ws.on("deploy", () => {
      setDeployCount((n) => n + 1);
    });
    const unsubMigration = ws.on("migration", () => {
      setMigrationCount((n) => n + 1);
    });
    return () => {
      unsubDeploy();
      unsubMigration();
    };
  }, []);

  const items: Array<{ label: string; val: string; tone?: "buy" | "sell" | "green" }> = [
    { label: "SOL", val: sol ? `$${sol.toFixed(2)}` : "…", tone: "green" },
    { label: "NETWORK", val: "SOLANA · MAINNET" },
    {
      label: "FEED",
      val: wsOk ? "STREAMING" : "RECONNECTING",
      tone: wsOk ? "buy" : "sell",
    },
    { label: "NEW DEPLOYS", val: String(deployCount).padStart(2, "0") },
    { label: "MIGRATIONS", val: String(migrationCount).padStart(2, "0"), tone: "green" },
    { label: "SOURCE", val: "RAZE.SH" },
  ];

  return (
    <div style={{
      display: "flex", alignItems: "center",
      padding: "0 4px", height: 36,
      background: "var(--ink-1)",
      borderBottom: "1px solid var(--line-soft)",
      overflowX: "auto",
      flexShrink: 0,
    }}>
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          <div style={{
            display: "inline-flex", alignItems: "baseline", gap: 8,
            padding: "0 14px", flexShrink: 0,
          }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>{it.label}</span>
            <span className="mono" style={{
              fontSize: 12, fontWeight: 500,
              color:
                it.tone === "buy" ? "var(--buy)" :
                it.tone === "sell" ? "var(--sell)" :
                it.tone === "green" ? "var(--buy)" :
                "var(--paper)",
            }}>{it.val}</span>
          </div>
          {i < items.length - 1 && (
            <div style={{ width: 1, height: 14, background: "var(--line-soft)" }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function useWsStatus() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const ws = RazeWebSocket.getInstance();
    ws.connect();
    const probe = () => {
      const ref = (ws as unknown as { socket?: WebSocket }).socket;
      setOk(ref?.readyState === WebSocket.OPEN);
    };
    probe();
    const id = setInterval(probe, 1500);
    return () => clearInterval(id);
  }, []);
  return ok;
}
