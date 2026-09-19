"use client";

import { WIRE_OPEN_EVENT } from "./events";

export interface WireSubscription {
  cancel(): void;
}

class DummyWire {
  async call<T>(_method: string, _params?: unknown): Promise<T> {
    throw new Error("terminal_backend_unavailable");
  }
  subscribe(_topic: string, _params?: unknown, _onEvent?: (ev: unknown) => void, _onErr?: (err?: { code?: string }) => void): WireSubscription {
    return { cancel() {} };
  }
  close(): void {}
}

const dummy = new DummyWire();

export function wireUrlFor(baseUrl: string): string {
  return baseUrl;
}

export function getWire(_baseUrl?: string): DummyWire {
  return dummy;
}

export function notifyWireOpen(wsUrl = "wss://api.raze.bot/ws"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent< { wsUrl: string } >(WIRE_OPEN_EVENT, { detail: { wsUrl } }));
}
