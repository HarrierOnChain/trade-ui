"use strict";
// The app's window: nothing of Electron or Node is exposed, only a marker.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("tradeUi", { desktop: true });
