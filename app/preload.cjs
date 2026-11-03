const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "aegis",
  Object.freeze({
    call: (method, args) => ipcRenderer.invoke("aegis", method, args),
  }),
);
