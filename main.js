
const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "NOVA Messenger",
    icon: path.join(__dirname, "build", "icon.ico"),
    backgroundColor: "#171923",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Calls use an actual, separate Electron window rather than a modal in the chat.
    if (url === "about:blank") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 430,
          height: 700,
          minWidth: 350,
          minHeight: 500,
          title: "NOVA · Звонок",
          autoHideMenuBar: true,
          backgroundColor: "#090c14",
          icon: path.join(__dirname, "build", "icon.ico"),
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        }
      };
    }
    return { action: "deny" };
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
