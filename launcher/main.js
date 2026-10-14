const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

const REPO = "illia2000as-sudo/nova-mesenger";
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const INSTALLER_NAME = "NOVA-Messenger-Setup.exe";
const GITHUB_URL = `https://github.com/${REPO}`;
let win;
let latestRelease = null;
let busy = false;

function sendStatus(message, progress = null, kind = "info") {
  if (win && !win.isDestroyed()) win.webContents.send("launcher:status", { message, progress, kind });
}

function appCandidates() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  return [
    path.join(local, "Programs", "nova-messenger", "NOVA Messenger.exe"),
    path.join(local, "Programs", "NOVA Messenger", "NOVA Messenger.exe"),
    path.join(local, "NOVA Messenger", "NOVA Messenger.exe"),
    path.join(programFiles, "NOVA Messenger", "NOVA Messenger.exe")
  ];
}

function findInstalledApp() {
  return appCandidates().find(candidate => fs.existsSync(candidate)) || null;
}

function installedReleasePath() {
  return path.join(app.getPath("userData"), "installed-release.json");
}

function readInstalledTag() {
  try {
    return JSON.parse(fs.readFileSync(installedReleasePath(), "utf8")).tag || "";
  } catch {
    return "";
  }
}

async function fetchLatestRelease() {
  sendStatus("Проверяем последнюю версию на GitHub…", null);
  const response = await fetch(RELEASE_API, {
    headers: { "Accept": "application/vnd.github+json", "User-Agent": "NOVA-Launcher" }
  });
  if (!response.ok) throw new Error(response.status === 404
    ? "На GitHub пока нет опубликованного релиза. Сначала запусти сборку из Actions."
    : `GitHub ответил ошибкой HTTP ${response.status}`);
  const release = await response.json();
  const asset = Array.isArray(release.assets) && release.assets.find(item => item.name === INSTALLER_NAME);
  if (!asset || !asset.browser_download_url) {
    throw new Error(`В последнем релизе нет файла ${INSTALLER_NAME}. Проверь публикацию GitHub Actions.`);
  }
  latestRelease = { ...release, installer: asset };
  const installedTag = readInstalledTag();
  const installedPath = findInstalledApp();
  return {
    tag: release.tag_name,
    version: release.name || release.tag_name,
    notes: release.body || "Обновление NOVA Messenger",
    url: release.html_url || GITHUB_URL,
    installed: Boolean(installedPath),
    updateAvailable: !installedPath || installedTag !== release.tag_name,
    installedTag
  };
}

async function downloadInstaller(asset) {
  const destination = path.join(app.getPath("userData"), INSTALLER_NAME);
  const partial = destination + ".download";
  sendStatus("Скачиваем обновление NOVA Messenger…", 0);
  const response = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "NOVA-Launcher" }
  });
  if (!response.ok || !response.body) throw new Error(`Не удалось скачать установщик (HTTP ${response.status}).`);
  const total = Number(response.headers.get("content-length")) || asset.size || 0;
  let received = 0;
  const source = Readable.fromWeb(response.body);
  source.on("data", chunk => {
    received += chunk.length;
    if (total > 0) sendStatus("Скачиваем обновление NOVA Messenger…", Math.min(99, Math.round(received / total * 100)));
  });
  await pipeline(source, fs.createWriteStream(partial));
  const stat = fs.statSync(partial);
  if (stat.size < 100000) {
    fs.rmSync(partial, { force: true });
    throw new Error("Скачанный установщик выглядит неполным. Попробуй ещё раз.");
  }
  fs.renameSync(partial, destination);
  sendStatus("Загрузка завершена.", 100);
  return destination;
}

async function runInstaller(installer) {
  sendStatus("Открываем установщик. Заверши установку в окне Windows…", null);
  await new Promise((resolve, reject) => {
    const child = spawn(installer, [], { detached: false, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("close", code => resolve(code));
  });
}

async function installOrLaunch() {
  if (busy) return;
  busy = true;
  try {
    const info = await fetchLatestRelease();
    const release = latestRelease;
    const existing = findInstalledApp();
    if (info.updateAvailable) {
      const installer = await downloadInstaller(release.installer);
      await runInstaller(installer);
      const installedApp = findInstalledApp();
      if (!installedApp) {
        sendStatus("Установщик закрылся, но NOVA не найдена. Если ты отменил установку, нажми кнопку ещё раз.", null, "error");
        return;
      }
      fs.mkdirSync(path.dirname(installedReleasePath()), { recursive: true });
      fs.writeFileSync(installedReleasePath(), JSON.stringify({ tag: release.tag_name, installedAt: new Date().toISOString() }, null, 2));
      sendStatus("NOVA обновлена. Запускаем мессенджер…", 100, "success");
      const child = spawn(installedApp, [], { detached: true, stdio: "ignore" });
      child.unref();
      return;
    }
    if (existing) {
      sendStatus("У тебя последняя версия. Запускаем NOVA Messenger…", 100, "success");
      const child = spawn(existing, [], { detached: true, stdio: "ignore" });
      child.unref();
    } else {
      sendStatus("Приложение не найдено. Скачиваем установщик…", null);
      const installer = await downloadInstaller(release.installer);
      await runInstaller(installer);
      const installedApp = findInstalledApp();
      if (installedApp) {
        fs.writeFileSync(installedReleasePath(), JSON.stringify({ tag: release.tag_name, installedAt: new Date().toISOString() }, null, 2));
        const child = spawn(installedApp, [], { detached: true, stdio: "ignore" });
        child.unref();
        sendStatus("NOVA Messenger запущен.", 100, "success");
      } else {
        sendStatus("Установка не завершена. Запусти установщик ещё раз и не закрывай мастер установки.", null, "error");
      }
    }
  } catch (error) {
    sendStatus(error?.message || "Не удалось выполнить обновление.", null, "error");
  } finally {
    busy = false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 620,
    minHeight: 480,
    title: "NOVA Launcher",
    backgroundColor: "#0b0d16",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.once("did-finish-load", () => {
    // Check on every launcher start. If a newer release exists, download and install it automatically.
    setTimeout(() => installOrLaunch(), 500);
  });
}

ipcMain.handle("launcher:check", async () => {
  try {
    const info = await fetchLatestRelease();
    sendStatus(info.updateAvailable ? `Доступна версия ${info.version} — подготовим обновление.` : `Установлена последняя версия: ${info.version}`, null, info.updateAvailable ? "info" : "success");
    return { ok: true, ...info };
  } catch (error) {
    sendStatus(error?.message || "Не удалось проверить обновления.", null, "error");
    return { ok: false, error: error?.message || "Ошибка проверки обновлений" };
  }
});
ipcMain.handle("launcher:install", installOrLaunch);
ipcMain.handle("launcher:github", () => shell.openExternal(GITHUB_URL));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
