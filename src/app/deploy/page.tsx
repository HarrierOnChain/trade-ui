"use client";

/**
 * /deploy — the Create-Token wizard rendered full-page.
 *
 * The wizard itself lives in `components/shell/DeployModal` (`DeployWizard`),
 * shared with the Deploy nav CTA's modal. Here it fills the route full-page for
 * direct-URL visits. It manages its own synthetic preview + launch and routes
 * to `/token/{mint}` on success, so this page is a thin host: title + a
 * remount hook for the "Create new launch" reset action.
 */

import React, { useEffect, useState } from "react";

import { usePageTitle } from "../../hooks/usePageTitle";
import { DeployWizard } from "../../components/shell/DeployModal";
import { SPOOL_DEPLOY_RESET, notifyShellPath } from "../../lib/shellNavigation";

export default function DeployPage() {
  usePageTitle("Deploy");
  // A fresh key throws away all wizard state (new placeholder mint, blank form)
  // when the sidebar's "Create new launch" fires SPOOL_DEPLOY_RESET.
  const [remountKey, setRemountKey] = useState(0);

  useEffect(() => {
    const onReset = () => {
      setRemountKey((k) => k + 1);
      try { window.history.replaceState(window.history.state, "", "/deploy"); } catch { /* ignore */ }
      notifyShellPath("/deploy");
    };
    window.addEventListener(SPOOL_DEPLOY_RESET, onReset);
    return () => window.removeEventListener(SPOOL_DEPLOY_RESET, onReset);
  }, []);

  return (
    <div style={{ flex: 1, minHeight: 0, height: "100%", display: "flex", flexDirection: "column", background: "var(--ink-0)" }}>
      <DeployWizard key={remountKey} />
    </div>
  );
}
