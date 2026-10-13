/**
 * Token images uploaded for a launch, served back at a public URL.
 *
 * The launch router builds a token from an image URL it downloads itself (it
 * has no upload route), so an image picked from disk is kept here and served
 * at `${TRADE_UI_PUBLIC_URL}/launch-media/<id>.<ext>` for Raze's server to
 * fetch during the build. Only when this Trade UI has a public address.
 *
 *   - Only PNG, JPEG, GIF and WebP, recognised by their first bytes (what the
 *     launch builders accept), at most 4 MB.
 *   - The id is 128 random bits: the URL is the only way to it. Served without
 *     a session (Raze has none), as an inert image (nosniff, sandboxed).
 *   - Kept in memory 30 minutes, at most 24 at a time; a restart forgets them.
 */
import crypto from "node:crypto";

export const MEDIA_MAX_BYTES = 4 * 1024 * 1024;
const TTL_MS = 30 * 60_000;
const MAX_ITEMS = 24;

export const MEDIA_ROUTE = /^\/launch-media\/([0-9a-f]{32})\.(png|jpg|gif|webp)$/;

const TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** The image format of `buf` from its signature, or null. */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

export class MediaError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createLaunchMedia({ now = () => Date.now() } = {}) {
  /** @type {Map<string, { bytes: Buffer, ext: string, expires: number }>} */
  const items = new Map();

  function prune() {
    const t = now();
    for (const [id, it] of items) if (it.expires <= t) items.delete(id);
    while (items.size >= MAX_ITEMS) items.delete(items.keys().next().value);
  }

  return {
    /** Keep `bytes`; its path, `/launch-media/<id>.<ext>`. */
    put(bytes) {
      if (!bytes?.length) throw new MediaError("bad_request", "Empty file");
      if (bytes.length > MEDIA_MAX_BYTES) throw new MediaError("bad_request", "Images up to 4 MB", 413);
      const ext = sniffImage(bytes);
      if (!ext) throw new MediaError("bad_request", "PNG, JPEG, GIF or WebP only");
      prune();
      const id = crypto.randomBytes(16).toString("hex");
      items.set(id, { bytes: Buffer.from(bytes), ext, expires: now() + TTL_MS });
      return { path: `/launch-media/${id}.${ext}`, ext, bytes: bytes.length };
    },

    /** Answer GET/HEAD `/launch-media/<id>.<ext>`; false when the path is not one. */
    serve(req, res, pathname) {
      const m = MEDIA_ROUTE.exec(pathname);
      if (!m || (req.method !== "GET" && req.method !== "HEAD")) return false;
      const it = items.get(m[1]);
      if (!it || it.ext !== m[2] || it.expires <= now()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end("Not found\n");
        return true;
      }
      res.writeHead(200, {
        "content-type": TYPES[it.ext],
        "content-length": it.bytes.length,
        "cache-control": "public, max-age=1800",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "cross-origin",
      });
      res.end(req.method === "HEAD" ? undefined : it.bytes);
      return true;
    },
  };
}
