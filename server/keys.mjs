/**
 * Wallet keys: generating, importing, exporting and signing.
 *
 * Two families:
 *   - `sol`: an ed25519 keypair, stored as the 64-byte Solana secret key
 *     (seed ‖ public key); the address is the base58 public key.
 *   - `evm`: a secp256k1 private key (32 bytes); the address is the last 20
 *     bytes of keccak256 of the public key, EIP-55 checksummed. The same key
 *     works on every EVM chain.
 *
 * Pure apart from randomness: the vault stores what these return, the tests
 * drive them directly.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { getBase58Decoder, getBase58Encoder } from "@solana/kit";

const b58enc = getBase58Encoder();
const b58dec = getBase58Decoder();

export const FAMILIES = /** @type {const} */ (["sol", "evm"]);

export class KeyError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** @param {Uint8Array} bytes */
export function toBase58(bytes) {
  return b58dec.decode(bytes);
}

/** @param {string} text @returns {Uint8Array | null} */
export function fromBase58(text) {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) return null;
  try {
    return Uint8Array.from(b58enc.encode(text));
  } catch {
    return null;
  }
}

/** @param {Uint8Array} bytes */
function toHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

/** A Solana address: base58 of exactly 32 bytes. */
export function isSolanaAddress(s) {
  if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  const b = fromBase58(s);
  return b !== null && b.length === 32;
}

export function isEvmAddress(s) {
  return typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
}

/** EIP-55 mixed-case checksum of a 0x address. */
export function checksumEvm(address) {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const hash = toHex(keccak_256(new TextEncoder().encode(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

/** @param {Uint8Array} priv 32 bytes */
function evmAddressOf(priv) {
  const pub = secp256k1.getPublicKey(priv, false).subarray(1);
  return checksumEvm(`0x${toHex(keccak_256(pub).subarray(-20))}`);
}

/** @param {Uint8Array} seed 32 bytes → the 64-byte Solana secret key */
function solanaSecretFromSeed(seed) {
  const out = new Uint8Array(64);
  out.set(seed, 0);
  out.set(ed25519.getPublicKey(seed), 32);
  return out;
}

/**
 * @param {"sol" | "evm"} family
 * @returns {{ family: "sol" | "evm", address: string, secret: Uint8Array }}
 */
export function generateKey(family) {
  if (family === "sol") {
    const secret = solanaSecretFromSeed(ed25519.utils.randomSecretKey());
    return { family, address: toBase58(secret.subarray(32)), secret };
  }
  if (family === "evm") {
    const secret = secp256k1.utils.randomSecretKey();
    return { family, address: evmAddressOf(secret), secret };
  }
  throw new KeyError("bad_family", "Unknown wallet type");
}

/** A 64-byte Solana secret key whose second half is the public key of the first. */
function checkSolanaSecret(bytes) {
  if (bytes.length !== 64) return null;
  const pub = ed25519.getPublicKey(bytes.subarray(0, 32));
  for (let i = 0; i < 32; i++) if (pub[i] !== bytes[32 + i]) return null;
  return Uint8Array.from(bytes);
}

function looksLikeMnemonic(s) {
  const words = s.split(/\s+/);
  return [12, 15, 18, 21, 24].includes(words.length) && words.every((w) => /^[a-z]+$/.test(w));
}

/**
 * Read a private key in the formats wallets export:
 *   - Solana: base58 secret key (Phantom, Solflare, Backpack), or the JSON byte
 *     array of a keypair file (`solana-keygen`, `id.json`): 64 bytes.
 *   - EVM: 32-byte hex, with or without `0x` (MetaMask "export private key").
 *
 * Refuses what is not a private key, with a sentence the user can act on: an
 * address pasted by mistake, a seed phrase, a key whose halves disagree.
 *
 * @param {string} input
 * @returns {{ family: "sol" | "evm", address: string, secret: Uint8Array }}
 */
export function parseSecret(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new KeyError("invalid_secret", "Paste a private key");

  const hex = raw.replace(/^0x/i, "");
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    const secret = Uint8Array.from(Buffer.from(hex, "hex"));
    if (!secp256k1.utils.isValidSecretKey(secret)) {
      throw new KeyError("invalid_secret", "Not a valid EVM private key");
    }
    return { family: "evm", address: evmAddressOf(secret), secret };
  }

  if (raw.startsWith("[")) {
    let arr;
    try {
      arr = JSON.parse(raw);
    } catch {
      throw new KeyError("invalid_secret", "The key file is not valid JSON");
    }
    if (!Array.isArray(arr) || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      throw new KeyError("invalid_secret", "Expected a JSON array of bytes, like a Solana keypair file");
    }
    if (arr.length !== 64) {
      throw new KeyError("invalid_secret", `A Solana keypair file holds 64 bytes, this one ${arr.length}`);
    }
    const secret = checkSolanaSecret(Uint8Array.from(arr));
    if (!secret) throw new KeyError("invalid_secret", "The keypair's public half does not match its private half");
    return { family: "sol", address: toBase58(secret.subarray(32)), secret };
  }

  if (looksLikeMnemonic(raw)) {
    throw new KeyError(
      "unsupported_mnemonic",
      "Seed phrases are not supported: export the account's private key from your wallet and paste that",
    );
  }
  if (isEvmAddress(raw)) {
    throw new KeyError("looks_like_address", "That is an address, not a private key: add it as a watch-only wallet");
  }

  const bytes = fromBase58(raw);
  if (!bytes) throw new KeyError("invalid_secret", "Not a private key: expected base58, a JSON keypair or EVM hex");
  if (bytes.length === 32) {
    throw new KeyError("looks_like_address", "That is an address, not a private key: add it as a watch-only wallet");
  }
  if (bytes.length !== 64) {
    throw new KeyError("invalid_secret", `A Solana private key is 64 bytes, this one decodes to ${bytes.length}`);
  }
  const secret = checkSolanaSecret(bytes);
  if (!secret) throw new KeyError("invalid_secret", "The key's public half does not match its private half");
  return { family: "sol", address: toBase58(secret.subarray(32)), secret };
}

/**
 * An address to watch (no key). The family comes from the format.
 * @returns {{ family: "sol" | "evm", address: string }}
 */
export function parseAddress(input) {
  const raw = String(input ?? "").trim();
  if (isEvmAddress(raw)) return { family: "evm", address: checksumEvm(raw) };
  if (isSolanaAddress(raw)) return { family: "sol", address: raw };
  throw new KeyError("invalid_address", "Not a Solana or EVM address");
}

/**
 * The secret in the formats other wallets import.
 * @param {"sol" | "evm"} family
 * @param {Uint8Array} secret
 */
export function exportFormats(family, secret) {
  if (family === "sol") {
    return { base58: toBase58(secret), json: JSON.stringify(Array.from(secret)) };
  }
  return { hex: `0x${toHex(secret)}` };
}

/** Stored form of a secret (inside the encrypted vault). */
export function encodeSecret(family, secret) {
  return family === "sol" ? toBase58(secret) : toHex(secret);
}

export function decodeSecret(family, text) {
  if (family === "sol") {
    const b = fromBase58(text);
    if (!b || b.length !== 64) throw new KeyError("corrupt_vault", "Stored Solana key is malformed");
    return b;
  }
  if (!/^[0-9a-f]{64}$/.test(text)) throw new KeyError("corrupt_vault", "Stored EVM key is malformed");
  return Uint8Array.from(Buffer.from(text, "hex"));
}

/**
 * ed25519 signature of `message` with a 64-byte Solana secret key.
 * @param {Uint8Array} secret
 * @param {Uint8Array} message
 */
export function solanaSign(secret, message) {
  if (secret.length !== 64) throw new KeyError("bad_key", "Not a Solana secret key");
  return ed25519.sign(message, secret.subarray(0, 32));
}
