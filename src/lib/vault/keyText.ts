/**
 * Text the user pastes or a file they pick, turned into what the vault's
 * import takes. Pure: the server decides what each piece is (and says why it
 * refuses one), this only splits.
 */
import type { ImportItem } from "./client";

/** Each private key in `text`: a keypair file (JSON bytes), a JSON list of
 *  keys, or keys one per line / separated by spaces or commas. */
export function splitKeys(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const v: unknown = JSON.parse(t);
      const one = (x: unknown): string | null => {
        if (Array.isArray(x) && x.every((n) => typeof n === "number")) return JSON.stringify(x);
        if (typeof x === "string") return x.trim() || null;
        if (x && typeof x === "object" && Array.isArray((x as { secretKey?: unknown }).secretKey)) {
          return JSON.stringify((x as { secretKey: number[] }).secretKey);
        }
        return null;
      };
      if (Array.isArray(v) && v.every((n) => typeof n === "number")) return [JSON.stringify(v)];
      if (Array.isArray(v)) return dedupe(v.map(one).filter((x): x is string => !!x));
      const single = one(v);
      if (single) return [single];
    } catch {
      /* not JSON: read it as text */
    }
  }
  const out: string[] = [];
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // A seed phrase stays whole, so the server can say it is not supported.
    if (/^[a-z]+(?: [a-z]+){11,23}$/.test(line)) {
      out.push(line);
      continue;
    }
    for (const tok of line.split(/[\s,;]+/)) if (tok) out.push(tok);
  }
  return dedupe(out);
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/** Import items for `keys`, labelled "Label", or "Label 1", "Label 2"… */
export function importItems(keys: string[], label: string): ImportItem[] {
  const l = label.trim();
  return keys.map((secret, i) => ({
    secret,
    ...(l ? { label: keys.length === 1 ? l : `${l} ${i + 1}` } : {}),
  }));
}

/** "1.5" SOL → lamports, exactly; null for anything that is not an amount. */
export function solToLamports(text: string): bigint | null {
  const m = /^\s*(\d{1,12})(?:[.,](\d{0,9}))?\s*$/.exec(text);
  if (!m) return null;
  const v = BigInt(m[1]) * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0") || "0");
  return v > 0n ? v : null;
}

// ── wallets an older Trade UI kept in this browser, unencrypted ─────────

export const LEGACY_WALLETS_KEY = "trade-ui.wallets.v1";

interface LegacyWallet {
  kind?: string;
  chainId?: string;
  pubkey?: string;
  label?: string | null;
  secret?: string | null;
}

function base64ToBytes(b64: string): number[] | null {
  try {
    const bin = atob(b64);
    return Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * What an older Trade UI stored in localStorage (`trade-ui.wallets.v1`), as
 * import items, each with the stored entry it came from. Solana keys were
 * base64 there; a base58 key imported through its bulk importer could end up
 * stored as an "address": anything that long is offered back as the key it
 * is. Demo wallets are skipped.
 */
export function legacyEntries(storage: Pick<Storage, "getItem"> | null): Array<{ item: ImportItem; source: unknown }> {
  if (!storage) return [];
  let parsed: { wallets?: LegacyWallet[] } | null = null;
  try {
    parsed = JSON.parse(storage.getItem(LEGACY_WALLETS_KEY) || "null");
  } catch {
    return [];
  }
  const out: Array<{ item: ImportItem; source: unknown }> = [];
  for (const w of Array.isArray(parsed?.wallets) ? parsed!.wallets! : []) {
    if (!w || w.kind === "DEMO" || !w.pubkey || w.pubkey.startsWith("demo:")) continue;
    const label = w.label?.trim() || undefined;
    const chain = w.chainId || "sol";
    if (w.secret) {
      const bytes = chain === "sol" ? base64ToBytes(w.secret) : null;
      if (bytes && bytes.length === 64) out.push({ item: { secret: JSON.stringify(bytes), label }, source: w });
      else if (chain !== "sol" && /^[0-9a-fA-F]{64}$/.test(w.secret)) out.push({ item: { secret: `0x${w.secret}`, label }, source: w });
      // Unreadable here: the server says why, and the entry stays in the browser.
      else out.push({ item: { secret: w.secret, label }, source: w });
      continue;
    }
    if (/^[1-9A-HJ-NP-Za-km-z]{80,120}$/.test(w.pubkey)) out.push({ item: { secret: w.pubkey, label }, source: w });
    else out.push({ item: { address: w.pubkey, label }, source: w });
  }
  return out;
}

export function readLegacyWallets(storage: Pick<Storage, "getItem"> | null): ImportItem[] {
  return legacyEntries(storage).map((e) => e.item);
}

/** Keep only `sources` in the browser's old store, or erase it when none are left. */
export function keepLegacy(storage: Pick<Storage, "setItem" | "removeItem">, sources: unknown[]): void {
  if (sources.length === 0) storage.removeItem(LEGACY_WALLETS_KEY);
  else storage.setItem(LEGACY_WALLETS_KEY, JSON.stringify({ wallets: sources }));
}
