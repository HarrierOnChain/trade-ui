"use strict";
/**
 * Trade UI desktop: Electron around the same server as the browser version.
 *
 *   - Settings in `<userData>/config.env` (RAZE_API_KEY, optionally
 *     SOLANA_RPC_URL…), written by the first-run window and read by the server
 *     through TRADE_UI_ENV_FILE. Environment variables still win.
 *   - The vault lives in `<userData>/data` (TRADE_UI_DATA_DIR).
 *   - The server listens on 127.0.0.1 only, on a fixed port (so the window's
 *     storage, layouts and preferences, survives restarts), and runs on
 *     Electron's own Node.
 *   - The window shows that local origin only; every other link opens in the
 *     system browser.
 *
 * Packaged, the server is `resources/server` (built by `npm run bundle`). From
 * a checkout (`npm run electron`) it is the repo's server.mjs, which needs
 * `npm run build` first; TRADE_UI_URL points the window at a server already
 * running instead (`npm run electron:dev`).
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const PREFERRED_PORT = 38211;
const EXTERNAL_URL = process.env.TRADE_UI_URL || "";

let server = null;
let serverUrl = "";
let mainWindow = null;
let setupWindow = null;
let quitting = false;

app.setName("Raze Trade UI");

const userData = () => app.getPath("userData");
const configFile = () => path.join(userData(), "config.env");
const dataDir = () => path.join(userData(), "data");
const logFile = () => path.join(userData(), "logs", "server.log");

// ── config.env ──────────────────────────────────────────────────────────

function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

function readConfig() {
  try {
    return parseEnv(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(values) {
  const lines = [
    "# Raze Trade UI desktop settings. Written by the app (Trade UI → Settings…).",
    "# Environment variables of the same name take precedence.",
  ];
  for (const [k, v] of Object.entries(values)) {
    if (v == null || v === "") continue;
    if (/[\r\n]/.test(String(v))) throw new Error(`${k} cannot span lines`);
    lines.push(`${k}=${v}`);
  }
  fs.mkdirSync(userData(), { recursive: true, mode: 0o700 });
  const tmp = `${configFile()}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${lines.join("\n")}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, configFile());
  try { fs.chmodSync(configFile(), 0o600); } catch { /* not on every filesystem */ }
}

function hasApiKey() {
  return Boolean((process.env.RAZE_API_KEY || "").trim() || (readConfig().RAZE_API_KEY || "").trim());
}

// ── the server ──────────────────────────────────────────────────────────

function serverEntry() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server", "server.mjs")
    : path.join(__dirname, "..", "server.mjs");
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

async function pickPort() {
  const wanted = Number(process.env.TRADE_UI_DESKTOP_PORT || readConfig().TRADE_UI_DESKTOP_PORT || PREFERRED_PORT);
  if (await portFree(wanted)) return wanted;
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, child, timeoutMs = 45_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`the server exited (code ${child.exitCode})`);
    try {
      const r = await fetch(`${url}/api/auth/status`, { signal: AbortSignal.timeout(2_000) });
      if (r.ok) return r.json();
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("the server did not start in time");
}

function tailLog(lines = 25) {
  try {
    return fs.readFileSync(logFile(), "utf8").trim().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

async function startServer() {
  const port = await pickPort();
  const setupToken = crypto.randomBytes(12).toString("base64url");
  fs.mkdirSync(path.dirname(logFile()), { recursive: true });
  const log = fs.openSync(logFile(), "w", 0o600);
  const child = spawn(process.execPath, [serverEntry()], {
    cwd: path.dirname(serverEntry()),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      TRADE_UI_DESKTOP: "1",
      TRADE_UI_ENV_FILE: configFile(),
      TRADE_UI_DATA_DIR: dataDir(),
      TRADE_UI_SETUP_TOKEN: setupToken,
    },
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  fs.closeSync(log);
  server = child;
  const url = `http://127.0.0.1:${port}`;
  child.on("exit", (code, signal) => {
    if (server === child) server = null;
    if (quitting || child.restarting) return;
    void dialog.showMessageBox({
      type: "error",
      title: "Trade UI stopped",
      message: "The Trade UI server stopped.",
      detail: `${code !== null ? `Exit code ${code}` : `Signal ${signal}`}.\n\n${tailLog()}`,
      buttons: ["Restart", "Quit"],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) void relaunchServer();
      else app.quit();
    });
  });
  const status = await waitForServer(url, child);
  serverUrl = url;
  return { url, status, setupToken };
}

function stopServer() {
  const child = server;
  server = null;
  if (!child || child.exitCode !== null) return Promise.resolve();
  child.restarting = true;
  return new Promise((resolve) => {
    const done = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve();
    }, 4_000);
    child.once("exit", () => {
      clearTimeout(done);
      resolve();
    });
    try { child.kill("SIGTERM"); } catch { resolve(); }
  });
}

/** The page to open: the setup link on a first run, else the app. */
function entryUrl({ url, status, setupToken }) {
  return status && status.initialized === false ? `${url}/?setup=${encodeURIComponent(setupToken)}` : `${url}/`;
}

async function relaunchServer() {
  await stopServer();
  try {
    const started = await startServer();
    if (mainWindow) await mainWindow.loadURL(entryUrl(started));
  } catch (e) {
    dialog.showErrorBox("Trade UI cannot start", `${e.message}\n\n${tailLog()}`);
  }
}

// ── windows ─────────────────────────────────────────────────────────────

function lockDown(win, origin) {
  const contents = win.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Navigations and redirects (a same-origin link answering 302 elsewhere)
  // stay on the local origin; anything else opens in the system browser.
  const keepLocal = (e, url) => {
    if (origin && url.startsWith(`${origin}/`)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  contents.on("will-navigate", keepLocal);
  contents.on("will-redirect", keepLocal);
  contents.on("will-attach-webview", (e) => e.preventDefault());
}

function createMainWindow(url) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#1a1714",
    autoHideMenuBar: true,
    title: "Raze Trade UI",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  lockDown(win, new URL(url).origin);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  void win.loadURL(url);
  mainWindow = win;
  return win;
}

/** The settings window: the Raze API key and the Solana RPC. Resolves true when saved. */
function openSettings({ firstRun }) {
  if (setupWindow) {
    setupWindow.focus();
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: firstRun ? 560 : 520,
      resizable: false,
      minimizable: false,
      maximizable: false,
      backgroundColor: "#1a1714",
      title: "Raze Trade UI — Settings",
      autoHideMenuBar: true,
      parent: firstRun ? undefined : mainWindow ?? undefined,
      modal: !firstRun && !!mainWindow,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "setup-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    setupWindow = win;
    let saved = false;
    lockDown(win, null);
    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
      setupWindow = null;
      resolve(saved);
    });
    const cfg = readConfig();
    void win.loadFile(path.join(__dirname, "setup.html"), {
      query: {
        firstRun: firstRun ? "1" : "0",
        rpcUrl: cfg.SOLANA_RPC_URL || "",
        hasKey: cfg.RAZE_API_KEY ? "1" : "0",
        envKey: process.env.RAZE_API_KEY ? "1" : "0",
      },
    });
    win.markSaved = () => { saved = true; };
  });
}

ipcMain.handle("settings:save", async (event, input) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== setupWindow) throw new Error("not the settings window");
  const apiKey = String(input?.apiKey ?? "").trim();
  const rpcUrl = String(input?.rpcUrl ?? "").trim();
  const cfg = readConfig();
  const key = apiKey || cfg.RAZE_API_KEY || "";
  if (!key && !process.env.RAZE_API_KEY) return { ok: false, error: "Paste your Raze API key." };
  if (key.length > 256 || /\s/.test(key)) return { ok: false, error: "That does not look like an API key." };
  if (rpcUrl) {
    try {
      const u = new URL(rpcUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    } catch {
      return { ok: false, error: "The RPC URL must start with https://" };
    }
  }
  // Check the key against the API before keeping it.
  if (apiKey) {
    const base = (process.env.RAZE_API_BASE || cfg.RAZE_API_BASE || "https://api.raze.bot").replace(/\/+$/, "");
    try {
      const r = await fetch(`${base}/prices`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(8_000) });
      if (r.status === 401 || r.status === 403) return { ok: false, error: "The API refused this key." };
    } catch {
      /* offline: keep it, the app says so later */
    }
  }
  writeConfig({ ...cfg, RAZE_API_KEY: key, SOLANA_RPC_URL: rpcUrl || undefined });
  win.markSaved?.();
  setImmediate(() => win.close());
  return { ok: true };
});

ipcMain.handle("settings:cancel", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && win === setupWindow) win.close();
});

ipcMain.handle("settings:open-external", (_event, url) => {
  if (url === "https://raze.bot" || url === "https://raze.bot/pricing" || url === "https://docs.raze.bot") {
    void shell.openExternal(url);
  }
});

// ── menu ────────────────────────────────────────────────────────────────

function lockApp() {
  if (mainWindow) void mainWindow.webContents.executeJavaScript("window.__tradeUiLock && window.__tradeUiLock()", true).catch(() => {});
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    {
      label: "Trade UI",
      submenu: [
        { label: "Lock", accelerator: "CmdOrCtrl+L", click: lockApp },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: async () => {
            if (await openSettings({ firstRun: false })) await relaunchServer();
          },
        },
        { label: "Open data folder", click: () => void shell.openPath(userData()) },
        { type: "separator" },
        { role: "reload" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
        { type: "separator" },
        isMac ? { role: "quit" } : { role: "quit", label: "Quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── lifecycle ───────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (e) => e.preventDefault());
  });

  app.whenReady().then(async () => {
    // Clipboard writes (copy buttons) and notifications (alerts); nothing else.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "clipboard-sanitized-write" || permission === "notifications");
    });
    buildMenu();

    if (EXTERNAL_URL) {
      createMainWindow(EXTERNAL_URL);
      return;
    }
    if (!hasApiKey()) {
      const saved = await openSettings({ firstRun: true });
      if (!saved) {
        app.quit();
        return;
      }
    }
    try {
      const started = await startServer();
      createMainWindow(entryUrl(started));
    } catch (e) {
      dialog.showErrorBox("Trade UI cannot start", `${e.message}\n\n${tailLog()}`);
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!mainWindow && serverUrl) createMainWindow(`${serverUrl}/`);
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("will-quit", (e) => {
    if (!server) return;
    e.preventDefault();
    void stopServer().finally(() => app.exit(0));
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
