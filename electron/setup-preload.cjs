"use strict";
// The settings window: save or cancel, nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tradeUiSettings", {
  save: (values) => ipcRenderer.invoke("settings:save", values),
  cancel: () => ipcRenderer.invoke("settings:cancel"),
  openExternal: (url) => ipcRenderer.invoke("settings:open-external", url),
});
