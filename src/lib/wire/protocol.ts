// terminal-wire-v1 — frontend mirror of backend/src/lib/wire/protocol.ts.
// Keep these two files byte-for-byte aligned on wire format. Anything that
// touches handshake, key derivation, or frame layout must change in both.
//
// See the backend file for the threat model + handshake derivation.

import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";

export const WIRE_VERSION = 1;
export const WIRE_INFO = new TextEncoder().encode("terminal-wire-v1");

export const DIR_C2S = 0x00;
export const DIR_S2C = 0x01;

export interface HandshakeClientHello { v: number; ce: string }
export interface HandshakeServerHello { v: number; se: string }

export function deriveKey(opts: {
  dh1: Uint8Array;
  dh2: Uint8Array;
  clientEphPub: Uint8Array;
  serverEphPub: Uint8Array;
}): Uint8Array {
  const ikm = concat(opts.dh1, opts.dh2);
  const salt = concat(opts.clientEphPub, opts.serverEphPub);
  return hkdf(sha256, ikm, salt, WIRE_INFO, 32);
}

export function newEphemeral(): { priv: Uint8Array; pub: Uint8Array } {
  const { secretKey, publicKey } = x25519.keygen();
  return { priv: secretKey, pub: publicKey };
}

export function dh(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(priv, pub);
}

export function encryptFrame(
  key: Uint8Array,
  direction: number,
  seq: bigint,
  plaintext: Uint8Array,
): Uint8Array {
  const nonce = nonceFor(direction, seq);
  const ct = gcm(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce, 0);
  out.set(ct, 12);
  return out;
}

export function decryptFrame(
  key: Uint8Array,
  frame: Uint8Array,
): { direction: number; seq: bigint; plaintext: Uint8Array } {
  if (frame.length < 12 + 16) throw new Error("frame too short");
  const nonce = frame.subarray(0, 12);
  const ct = frame.subarray(12);
  const pt = gcm(key, nonce).decrypt(ct);
  return { direction: nonce[0]!, seq: readSeq11BE(nonce, 1), plaintext: pt };
}

function nonceFor(direction: number, seq: bigint): Uint8Array {
  if (direction !== DIR_C2S && direction !== DIR_S2C) throw new Error("invalid direction");
  if (seq < 0n || seq >= 1n << 88n) throw new Error("seq out of range");
  const out = new Uint8Array(12);
  out[0] = direction;
  let s = seq;
  for (let i = 11; i >= 1; i--) {
    out[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  return out;
}

function readSeq11BE(buf: Uint8Array, offset: number): bigint {
  let s = 0n;
  for (let i = 0; i < 11; i++) s = (s << 8n) | BigInt(buf[offset + i]!);
  return s;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ── Application envelope ────────────────────────────────────────────────────

export interface AppRequest { id: number; m: string; p?: unknown }
export interface AppResponseOk { id: number; ok: true; d?: unknown }
export interface AppResponseErr { id: number; ok: false; e: { code: string; msg?: string } }
export type AppResponse = AppResponseOk | AppResponseErr;

export interface AppSub { sub: number; t: string; p?: unknown }
export interface AppUnsub { unsub: number }
export interface AppEvent { ev: number; d: unknown }
export interface AppEos { eos: number; e?: { code: string; msg?: string } }

export interface AppAuth { auth: string | null }
export interface AppAuthAck {
  auth: { ok: boolean; user?: { id: string; role: string; email: string | null; phantomPubkey: string | null } };
}

export type AppMessage =
  | AppRequest | AppResponse | AppSub | AppUnsub | AppEvent | AppEos
  | AppAuth | AppAuthAck;

const enc = new TextEncoder();
const dec = new TextDecoder();
export function encodeMessage(m: AppMessage): Uint8Array { return enc.encode(JSON.stringify(m)); }
export function decodeMessage(b: Uint8Array): AppMessage { return JSON.parse(dec.decode(b)) as AppMessage; }
