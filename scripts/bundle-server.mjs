/**
 * The self-contained server: `dist/server`, run with `node dist/server/server.mjs`
 * (Docker, a VPS without the source tree) or by the desktop app. Run after
 * `npm run build`.
 *
 *   .next-prod/standalone   the Next.js server and the node_modules it needs
 *   .next-prod/static       the browser bundles
 *   public/                 static files
 *   server.mjs, server/     this server, and the modules they import (traced)
 *
 * It also lays out `dist/app`, the desktop app electron-builder packs: the
 * Electron main process and a package.json without dependencies (the server
 * ships next to it as a resource, not inside the asar).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const out = path.join(dist, "server");
const standalone = path.join(root, ".next-prod", "standalone");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(path.join(standalone, ".next-prod")))) {
  console.error("No standalone build in .next-prod/standalone: run `npm run build` first.");
  process.exit(1);
}

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
await fs.cp(standalone, out, { recursive: true });
// Next's own entry point: ours is server.mjs (the lock, the vault, the proxies).
await fs.rm(path.join(out, "server.js"), { force: true });
await fs.cp(path.join(root, ".next-prod", "static"), path.join(out, ".next-prod", "static"), { recursive: true });
await fs.cp(path.join(root, "public"), path.join(out, "public"), { recursive: true });
await fs.copyFile(path.join(root, "server.mjs"), path.join(out, "server.mjs"));
await fs.cp(path.join(root, "server"), path.join(out, "server"), { recursive: true });
// Never ship a developer's settings or data.
for (const f of [".env", ".env.local", ".env.production", "data"]) {
  await fs.rm(path.join(out, f), { recursive: true, force: true });
}

// What server.mjs and server/ import that Next's trace does not cover
// (@solana/kit, @noble/*). Next itself is in the standalone output already.
const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
const { fileList } = await nodeFileTrace([path.join(root, "server.mjs")], {
  base: root,
  processCwd: root,
  ignore: (p) => {
    const f = p.split(path.sep).join("/");
    return /^node_modules\/(next|@next|react|react-dom|scheduler|sharp|@img|typescript)\//.test(f);
  },
});
let added = 0;
for (const rel of fileList) {
  const f = String(rel).split(path.sep).join("/");
  if (!f.startsWith("node_modules/")) continue;
  const dest = path.join(out, f);
  if (await exists(dest)) continue;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(path.join(root, f), dest);
  added += 1;
}

// The desktop app: main process, preload, first-run window.
const app = path.join(dist, "app");
await fs.rm(app, { recursive: true, force: true });
await fs.cp(path.join(root, "electron"), app, { recursive: true });
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
await fs.writeFile(path.join(app, "package.json"), `${JSON.stringify({
  name: pkg.name,
  productName: pkg.productName,
  version: pkg.version,
  description: pkg.description,
  author: pkg.author,
  license: pkg.license,
  homepage: pkg.homepage,
  // Linux: the window's WM_CLASS, so desktops tie it to its launcher.
  desktopName: "raze-trade-ui.desktop",
  main: "main.cjs",
}, null, 2)}\n`);

console.log(`dist/server ready (${added} extra files traced for server/), dist/app ready`);
