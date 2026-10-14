const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novaLauncher", {
  check: () => ipcRenderer.invoke("launcher:check"),
  installOrLaunch: () => ipcRenderer.invoke("launcher:install"),
  openGitHub: () => ipcRenderer.invoke("launcher:github"),
  onStatus: callback => {
    if (typeof callback !== "function") return;
    ipcRenderer.on("launcher:status", (_event, status) => callback(status));
  }
});
