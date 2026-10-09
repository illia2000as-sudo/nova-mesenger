
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
  // The app uses the microphone for audio-only WebRTC calls; video is never requested.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = permission === "media" && Array.isArray(details.mediaTypes) && details.mediaTypes.includes("audio");
    callback(allowed);
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
