"use client";
import React from "react";

export function PrivyProvider({ children }: { children?: React.ReactNode } & Record<string, unknown>) {
  return <>{children}</>;
}

export function usePrivy() {
  return {
    ready: true,
    authenticated: false,
    user: {
      linkedAccounts: [] as Array<{
        type: string;
        chainType?: string;
        walletClientType?: string;
        address?: string;
        delegated?: boolean;
      }>,
    },
    logout: async () => {},
    getAccessToken: async () => null as string | null,
  };
}

export function useLogin(_opts?: unknown) {
  return { login: () => {} };
}

export function useDelegatedActions() {
  return { delegateWallet: async (_args?: unknown) => {} };
}
