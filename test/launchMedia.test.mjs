/**
 * Images uploaded for a launch: recognised by their bytes, served at an
 * unguessable path as inert images, forgotten after their time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLaunchMedia, MEDIA_MAX_BYTES, sniffImage } from "../server/launchMedia.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function fakeRes() {
  const r = { status: 0, headers: {}, body: null };
  return Object.assign(r, {
    writeHead(status, headers) { r.status = status; r.headers = headers; return r; },
    end(body) { r.body = body ?? null; },
  });
}

test("sniffImage: the four formats the launch builders take, by their bytes", () => {
  assert.equal(sniffImage(PNG), "png");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "jpg");
  assert.equal(sniffImage(Buffer.from("GIF89a\0\0\0\0\0\0")), "gif");
  assert.equal(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  assert.equal(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  assert.equal(sniffImage(Buffer.from("<html><script>")), null);
});

test("kept, served as an inert image at its path, gone after 30 minutes", () => {
  let now = 1_000;
  const media = createLaunchMedia({ now: () => now });
  const { path, ext } = media.put(PNG);
  assert.equal(ext, "png");
  assert.match(path, /^\/launch-media\/[0-9a-f]{32}\.png$/);

  const res = fakeRes();
  assert.equal(media.serve({ method: "GET" }, res, path), true);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.match(res.headers["content-security-policy"], /sandbox/);
  assert.deepEqual(res.body, PNG);

  // Another extension, another id, or not a media path at all.
  const wrong = fakeRes();
  media.serve({ method: "GET" }, wrong, path.replace(".png", ".gif"));
  assert.equal(wrong.status, 404);
  assert.equal(media.serve({ method: "GET" }, fakeRes(), "/api/wallets"), false);
  assert.equal(media.serve({ method: "POST" }, fakeRes(), path), false);

  now += 30 * 60_000;
  const late = fakeRes();
  media.serve({ method: "GET" }, late, path);
  assert.equal(late.status, 404);
});

test("refuses what is not an image, and what is too large", () => {
  const media = createLaunchMedia();
  assert.throws(() => media.put(Buffer.from("<svg onload=alert(1)>")), /PNG, JPEG, GIF or WebP/);
  assert.throws(() => media.put(Buffer.alloc(0)), /Empty/);
  const big = Buffer.concat([PNG, Buffer.alloc(MEDIA_MAX_BYTES)]);
  assert.throws(() => media.put(big), /4 MB/);
});
