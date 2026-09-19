/**
 * Bulk wallet-import parsing for the portfolio Import modal.
 *
 * Raze's backend stores/signs with base58 ed25519 secrets, so this normalizes
 * every supported input into a list of base58 secret strings ready to hand to
 * `wallets.importPlatform`. Supported formats (keys + JSON only — seed phrases
 * are intentionally NOT derived here; the backend has no mnemonic path and we
 * don't want to commit to a derivation path client-side):
 *
 *   • one base58 secret per line / whitespace- or comma-separated (.txt/.csv)
 *   • a Solana JSON keypair byte-array — `[12,34,…]` (64 numbers, e.g. id.json)
 *   • a JSON array of byte-arrays and/or base58 strings
 *   • a JSON `{ "secretKey": [12,34,…] }` object
 *
 * A 12/24-word seed phrase is detected and reported as skipped-unsupported so
 * the user gets a clear message instead of a silent drop.
 */

// Bitcoin/Solana base58 alphabet. Inlined encoder (no `bs58` dep — it ships no
// types and the frontend is strict) to turn a JSON keypair byte-array into the
// base58 secret the backend expects.
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

export interface ParsedImport {
  /** Deduped base58 secret strings ready for `wallets.importPlatform`. */
  secrets: string[];
  /** Inputs we recognized but couldn't import, with a human reason. */
  skipped: Array<{ value: string; reason: string }>;
}

// A 64-byte ed25519 secret is ~87–88 base58 chars; use a wide 80–120 window so
// odd encoders still match, but stay well above the 32–44 of a *public* key so
// a pasted address is never mistaken for a secret.
const BS58_SECRET = /^[1-9A-HJ-NP-Za-km-z]{80,120}$/;

function looksLikeMnemonic(s: string): boolean {
  const words = s.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) return false;
  // All lowercase alpha words — a base58 blob split on nothing won't hit this.
  return words.every((w) => /^[a-z]+$/.test(w));
}

/** Encode a 64-number byte array as a base58 secret. Returns null if invalid. */
function bytesToSecret(arr: unknown): string | null {
  if (!Array.isArray(arr) || arr.length !== 64) return null;
  if (!arr.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)) return null;
  try {
    return base58Encode(Uint8Array.from(arr as number[]));
  } catch {
    return null;
  }
}

export function parseWalletImport(text: string, fileName?: string): ParsedImport {
  const secrets: string[] = [];
  const skipped: Array<{ value: string; reason: string }> = [];
  const seen = new Set<string>();

  const push = (secret: string) => {
    if (seen.has(secret)) return;
    seen.add(secret);
    secrets.push(secret);
  };
  const consider = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (BS58_SECRET.test(t)) { push(t); return; }
    if (looksLikeMnemonic(t)) {
      skipped.push({ value: t, reason: "seed phrases aren't supported — paste base58 keys" });
      return;
    }
    skipped.push({ value: t, reason: "not a base58 secret key" });
  };

  const ext = fileName?.split(".").pop()?.toLowerCase();
  const trimmed = text.trim();
  const looksJson = ext === "json" || trimmed.startsWith("[") || trimmed.startsWith("{");

  if (looksJson) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      // Not valid JSON after all — fall back to line parsing below.
      data = undefined;
    }
    if (data !== undefined) {
      // Single 64-byte keypair array.
      const single = bytesToSecret(data);
      if (single) { push(single); return { secrets, skipped }; }

      if (Array.isArray(data)) {
        for (const item of data) {
          const asBytes = bytesToSecret(item);
          if (asBytes) { push(asBytes); continue; }
          if (typeof item === "string") { consider(item); continue; }
          if (item && typeof item === "object" && "secretKey" in item) {
            const sk = bytesToSecret((item as { secretKey: unknown }).secretKey);
            if (sk) { push(sk); continue; }
          }
          skipped.push({ value: JSON.stringify(item).slice(0, 24), reason: "unrecognized entry" });
        }
        return { secrets, skipped };
      }

      if (data && typeof data === "object" && "secretKey" in data) {
        const sk = bytesToSecret((data as { secretKey: unknown }).secretKey);
        if (sk) { push(sk); return { secrets, skipped }; }
      }
      skipped.push({ value: "JSON", reason: "no keypair found in JSON" });
      return { secrets, skipped };
    }
  }

  // Plain text: split on newlines, commas, and whitespace.
  for (const tok of trimmed.split(/[\s,]+/)) consider(tok);
  return { secrets, skipped };
}
