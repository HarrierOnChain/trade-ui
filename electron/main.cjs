const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEV_URL = process.env.TRADE_UI_URL || "http://127.0.0.1:3000";

let server = null;

function startNextIfNeeded() {
  if (process.env.TRADE_UI_URL) return;
  if (process.env.NODE_ENV === "development") return;
  // server.cjs = `next start` + the same-origin `/api/ws` proxy that keeps the
  // API key server-side.
  server = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, PORT: "3000", NODE_ENV: "production", ELECTRON_RUN_AS_NODE: "1" },
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#1a1714",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  const load = () => {
    win.loadURL(DEV_URL).catch(() => {
      setTimeout(load, 400);
    });
  };
  load();
}

app.whenReady().then(() => {
  startNextIfNeeded();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (server) {
    try { server.kill(); } catch { /* ignore */ }
  }
  if (process.platform !== "darwin") app.quit();
});
