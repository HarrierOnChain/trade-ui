/** Local API settings for the self-hosted UI. */

export const API_SETTINGS_KEY = "trade-ui.api.v1";
export const DEFAULT_API_BASE = "https://api.raze.bot";

export type ApiSettings = {
  apiBase: string;
  apiKey: string;
};

export function readApiSettings(): ApiSettings {
  if (typeof window === "undefined") {
    return { apiBase: DEFAULT_API_BASE, apiKey: "" };
  }
  try {
    const raw = window.localStorage.getItem(API_SETTINGS_KEY);
    if (!raw) return { apiBase: DEFAULT_API_BASE, apiKey: "" };
    const parsed = JSON.parse(raw) as Partial<ApiSettings>;
    return {
      apiBase: String(parsed.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ""),
      apiKey: String(parsed.apiKey || ""),
    };
  } catch {
    return { apiBase: DEFAULT_API_BASE, apiKey: "" };
  }
}

export async function writeApiSettings(next: ApiSettings): Promise<void> {
  if (typeof window === "undefined") return;
  const value: ApiSettings = {
    apiBase: next.apiBase.replace(/\/+$/, "") || DEFAULT_API_BASE,
    apiKey: next.apiKey.trim(),
  };
  window.localStorage.setItem(API_SETTINGS_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event("trade-ui:api-settings"));
  await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}

export function hasLocalApiKey(): boolean {
  return Boolean(readApiSettings().apiKey);
}
