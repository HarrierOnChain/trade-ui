"use client";

import { lazy, Suspense, useEffect } from "react";
import { SelectedTokenProvider } from "../../contexts/SelectedTokenContext";
import { useChain } from "../../contexts/ChainContext";
import { getActiveChain, isChainId, setActiveChain } from "../../lib/chains";
import { parseTokenPath, tokenHref } from "../../lib/tokenHref";

const TokenLayout = lazy(() =>
  import("../TokenLayout").then((m) => ({ default: m.TokenLayout })),
);

function Fallback() {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: 0, background: "var(--ink-0)",
    }}>
      <svg width="20" height="20" viewBox="0 0 24 24"
        style={{ animation: "token-host-spin 0.8s linear infinite" }}>
        <circle cx="12" cy="12" r="10" fill="none" stroke="var(--line)" strokeWidth="2" />
        <path d="M12 2 A10 10 0 0 1 22 12" fill="none"
          stroke="var(--paper-3)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <style>{`@keyframes token-host-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/** Token UI mounted from the URL by ClientPages — not by the Next.js page. */
export function TokenPageHost({ pathname }: { pathname: string }) {
  const parsed = parseTokenPath(pathname);
  const mint = parsed?.address ?? "";
  const chain = parsed?.chain;
  const { setChain } = useChain();

  // Sync the module-level chain before children fetch. Same 0x address can
  // exist on eth/base/bsc, so the URL chain must win immediately.
  if (typeof chain === "string" && isChainId(chain) && getActiveChain() !== chain) {
    setActiveChain(chain);
  }

  useEffect(() => {
    if (!mint) return;
    if (typeof chain === "string" && isChainId(chain)) {
      setChain(chain, { reload: false });
    }
    const canonical = tokenHref(mint, typeof chain === "string" ? chain : undefined);
    if (window.location.pathname !== canonical) {
      window.history.replaceState(null, "", canonical);
    }
  }, [mint, chain, setChain]);

  if (!mint) return null;

  const hostKey = `${typeof chain === "string" ? chain : getActiveChain()}:${mint}`;

  return (
    <SelectedTokenProvider key={hostKey} defaultMint={mint}>
      <Suspense fallback={<Fallback />}>
        <TokenLayout mint={mint} />
      </Suspense>
    </SelectedTokenProvider>
  );
}
