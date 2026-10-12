/**
 * The vault: every wallet of this Trade UI, encrypted at rest. Nothing in it
 * is readable until `unlock(password)` (or `recover(recoveryKey, password)`);
 * `lock()` drops the key and the decrypted wallets.
 *
 * File: `<dataDir>/vault.json` (mode 0600), written atomically (temp file,
 * fsync, rename). Format, version 2:
 *
 *   {
 *     "format": "trade-ui-vault", "version": 2,
 *     "kdf":    { "name": "scrypt", "N", "r", "p", "salt" },
 *     "keys": {
 *       "password": { "iv", "tag", "wrapped" },
 *       "recovery": { "salt", "iv", "tag", "wrapped" }
 *     },
 *     "cipher": { "name": "aes-256-gcm", "iv", "tag" },
 *     "ciphertext": "<base64>",
 *     "updatedAt": "<ISO time>"
 *   }
 *
 * The wallets are encrypted (AES-256-GCM) under a random 256-bit data key,
 * stored twice, wrapped: under scrypt(password, salt), and under
 * HKDF-SHA256(recovery key, salt). The recovery key is 160 random bits shown
 * once, when the vault is made, as nine groups of four characters (the last
 * group is a checksum); with it a forgotten password is replaced and nothing
 * is lost. Each wrap binds its derivation parameters as associated data, so
 * editing them breaks decryption instead of weakening it. Every write uses
 * fresh IVs. The plaintext is `{ wallets: [...], settings: {...} }`; wallet
 * secrets are stored base58 (Solana) or hex (EVM) inside it.
 *
 * Version 1 (the wallets directly under the password's key, no recovery key)
 * is rewritten as version 2 on its first unlock, still without a recovery key
 * until one is made (`newRecoveryKey`).
 *
 * Every wallet has its key. Address-only ("watch") entries, accepted until
 * 2026-10-11, are left out when the vault opens and leave the file at its next
 * write: they held no key, only an address and a label.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsc } from "node:fs";
import path from "node:path";
import { decodeSecret, encodeSecret, generateKey, KeyError, parseSecret } from "./keys.mjs";

export const VAULT_FILE = "vault.json";
const FORMAT = "trade-ui-vault";
const VERSION = 2;

/** scrypt N=2^17, r=8: 128 MiB and ~0.4-1 s per derivation. */
export const DEFAULT_KDF = Object.freeze({ N: 1 << 17, r: 8, p: 1 });
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 1024;
const MAX_WALLETS = 2000;
const MAX_LABEL = 64;

export const AUTO_LOCK_CHOICES = Object.freeze([0, 5, 15, 30, 60, 240]);
const DEFAULT_SETTINGS = Object.freeze({ autoLockMinutes: 15 });

export class VaultError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Password rules: long enough to resist guessing, NFKC so the same text typed
 *  on another keyboard derives the same key. */
export function checkNewPassword(password) {
  if (typeof password !== "string") throw new VaultError("bad_password", "Choose a password");
  const p = password.normalize("NFKC");
  if ([...p].length < MIN_PASSWORD) {
    throw new VaultError("weak_password", `Use at least ${MIN_PASSWORD} characters`);
  }
  if (p.length > MAX_PASSWORD) throw new VaultError("weak_password", "That password is too long");
  return p;
}

function normalizePassword(password) {
  if (typeof password !== "string" || !password || password.length > MAX_PASSWORD) return null;
  return password.normalize("NFKC");
}

function cleanLabel(label) {
  if (label == null) return null;
  const s = String(label).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_LABEL);
  return s || null;
}

function newId() {
  return `w_${crypto.randomBytes(8).toString("hex")}`;
}

// ── the recovery key ────────────────────────────────────────────────────

/** Crockford's base32: no I, L, O or U to misread. */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_BYTES = 20;
const RECOVERY_CHARS = 36; // 32 for the 160 bits, 4 of checksum

function toBase32(bytes) {
  let out = "";
  let value = 0;
  let bits = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text) {
  const out = [];
  let value = 0;
  let bits = 0;
  for (const c of text) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

/** 20 bits of SHA-256: catches a mistyped group before anything is tried. */
function recoveryChecksum(bytes) {
  return toBase32(crypto.createHash("sha256").update(bytes).digest().subarray(0, 3)).slice(0, 4);
}

/** 20 random bytes → "ABCD-EFGH-…" (9 groups of 4). */
export function formatRecoveryKey(bytes) {
  const s = toBase32(bytes) + recoveryChecksum(bytes);
  return s.match(/.{4}/g).join("-");
}

/**
 * The 20 bytes of a recovery key as typed: any case, with or without dashes
 * and spaces, O read as 0 and I or L as 1. Throws `bad_recovery_key` when it
 * cannot be one (wrong length, or a typo the checksum catches).
 */
export function parseRecoveryKey(text) {
  const s = String(text ?? "").toUpperCase().replace(/[\s-]+/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (s.length !== RECOVERY_CHARS || ![...s].every((c) => B32.includes(c))) {
    throw new VaultError("bad_recovery_key", "A recovery key is 9 groups of 4 letters and digits");
  }
  const bytes = fromBase32(s.slice(0, 32));
  if (recoveryChecksum(bytes) !== s.slice(32)) {
    bytes.fill(0);
    throw new VaultError("bad_recovery_key", "That recovery key has a typo: check each group");
  }
  return bytes;
}

// ── encryption ──────────────────────────────────────────────────────────

/** @param {{ N: number, r: number, p: number }} kdf @param {Buffer} salt */
function derive(password, salt, kdf) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, {
      N: kdf.N,
      r: kdf.r,
      p: kdf.p,
      maxmem: 256 * 1024 * 1024,
    }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function recoveryKek(bytes, salt) {
  return Buffer.from(crypto.hkdfSync("sha256", bytes, Buffer.from(salt, "base64"), "trade-ui-vault recovery key", 32));
}

// Associated data: what each key depends on, bound to what it encrypts.
const aadV1 = (kdf) => Buffer.from(`${FORMAT}/1|scrypt|${kdf.N}|${kdf.r}|${kdf.p}|${kdf.salt}`);
const aadData = () => Buffer.from(`${FORMAT}/2|data`);
const aadPassword = (kdf) => Buffer.from(`${FORMAT}/2|password|scrypt|${kdf.N}|${kdf.r}|${kdf.p}|${kdf.salt}`);
const aadRecovery = (salt) => Buffer.from(`${FORMAT}/2|recovery|hkdf-sha256|${salt}`);

function gcmSeal(key, aad, plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct };
}

/** @returns {Buffer | null} null when the key is wrong or the bytes were edited */
function gcmOpen(key, aad, ivB64, tagB64, ct) {
  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    // A shorter tag would be easier to forge; the vault always writes 16 bytes.
    if (iv.length !== 12 || tag.length !== 16) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    d.setAAD(aad);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    return null;
  }
}

function wrapKey(kek, aad, dek) {
  const s = gcmSeal(kek, aad, dek);
  return { iv: s.iv, tag: s.tag, wrapped: s.ct.toString("base64") };
}

/** @returns {Buffer | null} the data key, or null when `kek` is not the one */
function unwrapKey(kek, aad, w) {
  const k = gcmOpen(kek, aad, w.iv, w.tag, Buffer.from(w.wrapped, "base64"));
  if (k && k.length !== 32) {
    k.fill(0);
    return null;
  }
  return k;
}

/** `dek` wrapped under a recovery key, with a salt of its own. */
function recoveryWrap(bytes, dek) {
  const salt = crypto.randomBytes(16).toString("base64");
  const kek = recoveryKek(bytes, salt);
  try {
    return { salt, ...wrapKey(kek, aadRecovery(salt), dek) };
  } finally {
    kek.fill(0);
  }
}

/** The file for `data` under `dek`, with `header` (format, version, kdf, keys). */
function sealFile(dek, header, data) {
  const s = gcmSeal(dek, aadData(), Buffer.from(JSON.stringify(data)));
  return {
    ...header,
    cipher: { name: "aes-256-gcm", iv: s.iv, tag: s.tag },
    ciphertext: s.ct.toString("base64"),
    updatedAt: new Date().toISOString(),
  };
}

const serialize = (file) => `${JSON.stringify(file, null, 2)}\n`;

function parseData(plain) {
  let data;
  try {
    data = JSON.parse(plain.toString("utf8"));
  } catch {
    data = null;
  } finally {
    plain.fill(0);
  }
  if (!data || !Array.isArray(data.wallets)) {
    throw new VaultError("corrupt_vault", "The vault decrypted but its contents are malformed", 500);
  }
  data.wallets = data.wallets.filter((w) => w && w.secret);
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  return data;
}

/** The wallets of a version 2 file, once its data key is known. */
function openData(dek, file) {
  const plain = gcmOpen(dek, aadData(), file.cipher.iv, file.cipher.tag, Buffer.from(file.ciphertext, "base64"));
  if (!plain) throw new VaultError("corrupt_vault", "The vault's key is right but its contents were edited or damaged", 500);
  return parseData(plain);
}

/** A version 1 file's plaintext under the password's key, or null. */
function openV1(key, file) {
  return gcmOpen(key, aadV1(file.kdf), file.cipher.iv, file.cipher.tag, Buffer.from(file.ciphertext, "base64"));
}

const isStr = (x) => typeof x === "string";
const isWrap = (w) => Boolean(w) && isStr(w.iv) && isStr(w.tag) && isStr(w.wrapped);

function validateFile(f) {
  const ok = f && f.format === FORMAT && (f.version === 1 || f.version === 2)
    && f.kdf?.name === "scrypt" && Number.isInteger(f.kdf.N) && Number.isInteger(f.kdf.r)
    && Number.isInteger(f.kdf.p) && isStr(f.kdf.salt)
    && f.cipher?.name === "aes-256-gcm" && isStr(f.cipher.iv)
    && isStr(f.cipher.tag) && isStr(f.ciphertext)
    && (f.version === 1 || (isWrap(f.keys?.password)
      && (f.keys.recovery == null || (isWrap(f.keys.recovery) && isStr(f.keys.recovery.salt)))));
  if (!ok) throw new VaultError("corrupt_vault", "The vault file is not readable by this version", 500);
  // Refuse parameters an edited file could use to make derivation trivial or
  // exhaust memory.
  const { N, r, p } = f.kdf;
  if (N < 1 << 10 || N > 1 << 20 || (N & (N - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 16) {
    throw new VaultError("corrupt_vault", "The vault file has unusual key-derivation parameters", 500);
  }
  return f;
}

/** Write `text` to `file` so a crash leaves either the old or the new file. */
async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const fh = await fs.open(tmp, fsc.O_CREAT | fsc.O_EXCL | fsc.O_WRONLY, 0o600);
  try {
    await fh.writeFile(text);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

export class Vault {
  #dir;
  #file;
  #kdf;
  /** @type {Buffer | null} the data key */
  #dek = null;
  /** @type {any} the file's header: format, version, kdf, keys */
  #header = null;
  /** @type {{ wallets: any[], settings: any } | null} */
  #data = null;
  #queue = Promise.resolve();

  /** @param {{ dir: string, kdf?: { N: number, r: number, p: number } }} opts */
  constructor({ dir, kdf = DEFAULT_KDF }) {
    this.#dir = dir;
    this.#file = path.join(dir, VAULT_FILE);
    this.#kdf = kdf;
  }

  get file() {
    return this.#file;
  }

  get unlocked() {
    return this.#dek !== null;
  }

  async initialized() {
    try {
      await fs.access(this.#file);
      return true;
    } catch {
      return false;
    }
  }

  async #readFile() {
    let text;
    try {
      text = await fs.readFile(this.#file, "utf8");
    } catch (e) {
      if (e && e.code === "ENOENT") throw new VaultError("no_vault", "No vault yet: set a password first", 409);
      throw e;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new VaultError("corrupt_vault", "The vault file is not valid JSON", 500);
    }
    return validateFile(parsed);
  }

  #newKdf() {
    return { name: "scrypt", N: this.#kdf.N, r: this.#kdf.r, p: this.#kdf.p, salt: crypto.randomBytes(16).toString("base64") };
  }

  #set(dek, header, data) {
    if (this.#dek && this.#dek !== dek) this.#dek.fill(0);
    this.#dek = dek;
    this.#header = header;
    this.#data = data;
  }

  /** Encrypt the current state under the current key and write it. */
  async #write() {
    if (!this.#dek || !this.#data) throw new VaultError("locked", "Locked", 401);
    await writeAtomic(this.#file, serialize(sealFile(this.#dek, this.#header, this.#data)));
  }

  /** Changes to the file run one at a time. */
  #queued(fn) {
    const p = this.#queue.then(fn, fn);
    this.#queue = p.catch(() => {});
    return p;
  }

  /**
   * One change, all or nothing: `fn` mutates the decrypted state, which is then
   * written; if anything throws, the state in memory goes back to what is on
   * disk (a wallet shown but never saved would be a key lost).
   */
  #transact(fn) {
    return this.#queued(async () => {
      const data = this.#need();
      const before = structuredClone(data);
      try {
        const out = await fn(data);
        await this.#write();
        return out;
      } catch (e) {
        if (this.#data === data) this.#data = before;
        throw e;
      }
    });
  }

  /**
   * First run: a new, empty vault under `password`. Resolves with its
   * recovery key, which is not kept anywhere: it is shown to the user once.
   * @returns {Promise<{ recoveryKey: string }>}
   */
  async create(password) {
    const p = checkNewPassword(password);
    if (await this.initialized()) throw new VaultError("vault_exists", "A vault already exists", 409);
    await fs.mkdir(this.#dir, { recursive: true, mode: 0o700 });
    const kdf = this.#newKdf();
    const kek = await derive(p, Buffer.from(kdf.salt, "base64"), kdf);
    const dek = crypto.randomBytes(32);
    const recovery = crypto.randomBytes(RECOVERY_BYTES);
    const header = {
      format: FORMAT,
      version: VERSION,
      kdf,
      keys: { password: wrapKey(kek, aadPassword(kdf), dek), recovery: recoveryWrap(recovery, dek) },
    };
    kek.fill(0);
    const data = { wallets: [], settings: { ...DEFAULT_SETTINGS } };
    try {
      // O_EXCL: two setups racing cannot both create a vault.
      const fh = await fs.open(this.#file, fsc.O_CREAT | fsc.O_EXCL | fsc.O_WRONLY, 0o600).catch((e) => {
        if (e && e.code === "EEXIST") throw new VaultError("vault_exists", "A vault already exists", 409);
        throw e;
      });
      try {
        await fh.writeFile(serialize(sealFile(dek, header, data)));
        await fh.sync();
      } finally {
        await fh.close();
      }
      this.#set(dek, header, data);
      return { recoveryKey: formatRecoveryKey(recovery) };
    } catch (e) {
      dek.fill(0);
      throw e;
    } finally {
      recovery.fill(0);
    }
  }

  /** @returns {Promise<boolean>} false when the password is wrong */
  async unlock(password) {
    const p = normalizePassword(password);
    if (p === null) return false;
    const file = await this.#readFile();
    const kek = await derive(p, Buffer.from(file.kdf.salt, "base64"), file.kdf);
    if (file.version === 1) {
      const plain = openV1(kek, file);
      if (!plain) {
        kek.fill(0);
        return false;
      }
      const data = parseData(plain);
      // Rewritten as version 2: a data key under the same password, no
      // recovery key until one is made.
      const dek = crypto.randomBytes(32);
      const header = { format: FORMAT, version: VERSION, kdf: file.kdf, keys: { password: wrapKey(kek, aadPassword(file.kdf), dek) } };
      kek.fill(0);
      this.#set(dek, header, data);
      await this.#queued(() => this.#write()).catch((e) => {
        console.warn(`[trade-ui] the vault opened but could not be rewritten in the new format: ${e.message}`);
      });
      return true;
    }
    const dek = unwrapKey(kek, aadPassword(file.kdf), file.keys.password);
    kek.fill(0);
    if (!dek) return false;
    let data;
    try {
      data = openData(dek, file);
    } catch (e) {
      dek.fill(0);
      throw e;
    }
    this.#set(dek, { format: file.format, version: file.version, kdf: file.kdf, keys: file.keys }, data);
    return true;
  }

  /** Whether `password` is the vault's password, without changing state. */
  async verify(password) {
    const p = normalizePassword(password);
    if (p === null) return false;
    const file = this.#dek && this.#header ? this.#header : await this.#readFile();
    const kek = await derive(p, Buffer.from(file.kdf.salt, "base64"), file.kdf);
    try {
      const plain = file.version === 1 ? openV1(kek, file) : unwrapKey(kek, aadPassword(file.kdf), file.keys.password);
      plain?.fill(0);
      return plain !== null;
    } finally {
      kek.fill(0);
    }
  }

  lock() {
    if (this.#dek) this.#dek.fill(0);
    this.#dek = null;
    this.#data = null;
    this.#header = null;
  }

  #need() {
    if (!this.#dek || !this.#data) throw new VaultError("locked", "Locked", 401);
    return this.#data;
  }

  /** Whether the vault (unlocked) has a recovery key. */
  get hasRecoveryKey() {
    this.#need();
    return Boolean(this.#header.keys.recovery);
  }

  /** Whether the vault on disk can be opened with a recovery key. */
  async canRecover() {
    try {
      const f = await this.#readFile();
      return f.version === 2 && Boolean(f.keys.recovery);
    } catch {
      return false;
    }
  }

  /** New password: its own salt and key; the recovery key keeps working. */
  async changePassword(current, next) {
    this.#need();
    const p = checkNewPassword(next);
    if (!(await this.verify(current))) throw new VaultError("bad_password", "Wrong password", 403);
    const kdf = this.#newKdf();
    const kek = await derive(p, Buffer.from(kdf.salt, "base64"), kdf);
    return this.#queued(async () => {
      this.#need();
      const before = this.#header;
      this.#header = { ...before, kdf, keys: { ...before.keys, password: wrapKey(kek, aadPassword(kdf), this.#dek) } };
      try {
        await this.#write();
      } catch (e) {
        this.#header = before;
        throw e;
      }
    }).finally(() => kek.fill(0));
  }

  /**
   * A forgotten password: the recovery key opens the vault and `password`
   * replaces the old one. Leaves the vault unlocked.
   * @returns {Promise<boolean>} false when it is not this vault's recovery key
   */
  async recover(recoveryKey, password) {
    const p = checkNewPassword(password);
    const bytes = parseRecoveryKey(recoveryKey);
    try {
      // In the queue: the file on disk is then the latest state (every change
      // is written before the next one runs), whoever else is unlocked.
      return await this.#queued(async () => {
        const file = await this.#readFile();
        const r = file.version === 2 ? file.keys.recovery : null;
        if (!r) throw new VaultError("no_recovery", "This vault has no recovery key", 409);
        const rk = recoveryKek(bytes, r.salt);
        const dek = unwrapKey(rk, aadRecovery(r.salt), r);
        rk.fill(0);
        if (!dek) return false;
        try {
          const data = openData(dek, file);
          const kdf = this.#newKdf();
          const kek = await derive(p, Buffer.from(kdf.salt, "base64"), kdf);
          const header = { format: FORMAT, version: VERSION, kdf, keys: { password: wrapKey(kek, aadPassword(kdf), dek), recovery: r } };
          kek.fill(0);
          await writeAtomic(this.#file, serialize(sealFile(dek, header, data)));
          this.#set(dek, header, data);
          return true;
        } catch (e) {
          if (this.#dek !== dek) dek.fill(0);
          throw e;
        }
      });
    } finally {
      bytes.fill(0);
    }
  }

  /**
   * A new recovery key (the old one stops working), with a new data key: an
   * old copy of the file, opened with an old password or recovery key, says
   * nothing about what the vault holds from now on. Needs the password.
   * @returns {Promise<string>} the recovery key, to show once
   */
  async newRecoveryKey(password) {
    this.#need();
    const p = normalizePassword(password);
    const kdf = this.#header.kdf;
    const kek = p === null ? null : await derive(p, Buffer.from(kdf.salt, "base64"), kdf);
    const current = kek && unwrapKey(kek, aadPassword(kdf), this.#header.keys.password);
    if (!current) {
      kek?.fill(0);
      throw new VaultError("bad_password", "Wrong password", 403);
    }
    current.fill(0);
    const dek = crypto.randomBytes(32);
    const recovery = crypto.randomBytes(RECOVERY_BYTES);
    return this.#queued(async () => {
      this.#need();
      if (this.#header.kdf !== kdf) throw new VaultError("conflict", "The password changed meanwhile: try again", 409);
      const header = {
        ...this.#header,
        keys: { password: wrapKey(kek, aadPassword(kdf), dek), recovery: recoveryWrap(recovery, dek) },
      };
      await writeAtomic(this.#file, serialize(sealFile(dek, header, this.#data)));
      this.#set(dek, header, this.#data);
      return formatRecoveryKey(recovery);
    }).catch((e) => {
      if (this.#dek !== dek) dek.fill(0);
      throw e;
    }).finally(() => {
      kek.fill(0);
      recovery.fill(0);
    });
  }

  get settings() {
    return { ...this.#need().settings };
  }

  updateSettings(patch) {
    return this.#transact((data) => {
      const next = { ...data.settings };
      if (patch && "autoLockMinutes" in patch) {
        const m = Number(patch.autoLockMinutes);
        if (!AUTO_LOCK_CHOICES.includes(m)) throw new VaultError("bad_request", "Unsupported auto-lock delay");
        next.autoLockMinutes = m;
      }
      data.settings = next;
      return { ...next };
    });
  }

  // ── wallets ──────────────────────────────────────────────────────────

  /** What the browser may see: never the secret. */
  static publicView(w) {
    return {
      id: w.id,
      family: w.family,
      address: w.address,
      label: w.label,
      createdAt: w.createdAt,
    };
  }

  list() {
    return this.#need().wallets.map(Vault.publicView);
  }

  /** Internal: the wallet with its decoded secret. */
  get(id) {
    const w = this.#need().wallets.find((x) => x.id === id);
    if (!w) throw new VaultError("not_found", "Wallet not found", 404);
    return { ...Vault.publicView(w), secret: decodeSecret(w.family, w.secret) };
  }

  #exists(family, address) {
    const a = family === "evm" ? address.toLowerCase() : address;
    return this.#need().wallets.find((w) => w.family === family && (family === "evm" ? w.address.toLowerCase() : w.address) === a);
  }

  #room(n) {
    if (this.#need().wallets.length + n > MAX_WALLETS) {
      throw new VaultError("too_many_wallets", `A vault holds at most ${MAX_WALLETS} wallets`);
    }
  }

  /** @param {"sol" | "evm"} family */
  generate(family, { label, count = 1 } = {}) {
    const n = Math.floor(Number(count));
    if (!(n >= 1 && n <= 100)) throw new VaultError("bad_request", "Generate between 1 and 100 wallets at a time");
    if (family !== "sol" && family !== "evm") throw new VaultError("bad_request", "Unknown wallet type");
    return this.#transact((data) => {
      this.#room(n);
      const base = cleanLabel(label);
      const created = [];
      for (let i = 0; i < n; i++) {
        const k = generateKey(family);
        const w = {
          id: newId(),
          family,
          address: k.address,
          label: base ? (n === 1 ? base : `${base} ${i + 1}`) : null,
          secret: encodeSecret(family, k.secret),
          createdAt: new Date().toISOString(),
        };
        k.secret.fill(0);
        data.wallets.push(w);
        created.push(w);
      }
      return created.map(Vault.publicView);
    });
  }

  /** Import keys in one go. Each item is `{ secret, label? }`. */
  import(items) {
    if (!Array.isArray(items) || items.length === 0) throw new VaultError("bad_request", "Nothing to import");
    if (items.length > 500) throw new VaultError("bad_request", "Import at most 500 wallets at a time");
    return this.#transact((data) => {
      const created = [];
      const errors = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i] || {};
        const label = cleanLabel(item.label);
        try {
          if (item.secret == null) throw new VaultError("bad_request", "Each item needs a private key");
          const k = parseSecret(String(item.secret));
          try {
            if (this.#exists(k.family, k.address)) throw new VaultError("duplicate", "Already in the vault");
            this.#room(1);
            const w = {
              id: newId(), family: k.family, address: k.address, label,
              secret: encodeSecret(k.family, k.secret), createdAt: new Date().toISOString(),
            };
            data.wallets.push(w);
            created.push(w);
          } finally {
            k.secret.fill(0);
          }
        } catch (e) {
          if (e instanceof KeyError || e instanceof VaultError) errors.push({ index: i, code: e.code, message: e.message });
          else throw e;
        }
      }
      return { created: created.map(Vault.publicView), errors };
    });
  }

  rename(id, label) {
    return this.#transact((data) => {
      const w = data.wallets.find((x) => x.id === id);
      if (!w) throw new VaultError("not_found", "Wallet not found", 404);
      w.label = cleanLabel(label);
      return Vault.publicView(w);
    });
  }

  remove(id) {
    return this.#transact((data) => {
      const i = data.wallets.findIndex((x) => x.id === id);
      if (i < 0) throw new VaultError("not_found", "Wallet not found", 404);
      data.wallets.splice(i, 1);
    });
  }
}
