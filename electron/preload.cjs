const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("tradeUi", {
  desktop: true,
});
