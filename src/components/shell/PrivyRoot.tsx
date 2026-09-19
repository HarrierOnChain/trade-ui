"use client";
/**
 * PrivyRoot — mounts the Privy SDK provider for the whole app.
 *
 * The app id is baked at build time via NEXT_PUBLIC_PRIVY_APP_ID. When it's
 * unset (the default), this is a no-op passthrough: no provider mounts, no
 * Privy code runs, and the login button / delegation UI never render. So the
 * feature is fully inert until an operator configures the app id AND flips
 * `privyAuthEnabled` in admin.
 *
 * Embedded-wallet auto-creation is DISABLED (`createOnLogin: "off"`): Privy is
 * used for auth/identity only. On first login the backend (`auth.privyVerify`)
 * provisions a PLATFORM wallet instead — which is exportable and backend-signable
 * for automation, unlike a delegated embedded wallet.
 */

import React from "react";
import { PrivyProvider } from "@privy-io/react-auth";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

// Dev/QA escape hatch. Privy's embedded wallet hard-requires a secure context
// (HTTPS or localhost); opened over plain HTTP on a raw IP it throws at init
// and takes down the whole Shell. Set NEXT_PUBLIC_DISABLE_PRIVY=1 to fall back
// to the same inert passthrough used when no app id is configured — lets the
// app (and the chart) load over HTTP for QA, with login simply unavailable.
const PRIVY_DISABLED = process.env.NEXT_PUBLIC_DISABLE_PRIVY === "1";

/** True when the Privy provider is mounted (app id configured at build). */
export function privyAvailable(): boolean {
  return Boolean(PRIVY_APP_ID) && !PRIVY_DISABLED;
}

export function PrivyRoot({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID || PRIVY_DISABLED) return <>{children}</>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
