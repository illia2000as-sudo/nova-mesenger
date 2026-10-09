
const { app, BrowserWindow, session } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "NOVA Messenger",
    backgroundColor: "#171923",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile("src/index.html");
}

app.whenReady().then(() => {
  // Allow the app to request microphone, camera and screen capture for calls.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    const mediaAllowed = permission === "media" && mediaTypes.length > 0 && mediaTypes.every(type => type === "audio" || type === "video");
    const screenAllowed = permission === "display-capture";
    callback(mediaAllowed || screenAllowed);
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
