const statusEl = document.getElementById("status");
const bar = document.getElementById("bar");
const percent = document.getElementById("percent");
const version = document.getElementById("version");
const launchButton = document.getElementById("launch");
const checkButton = document.getElementById("check");
let working = false;

function setStatus(status) {
  if (!status) return;
  statusEl.textContent = status.message || "Готово";
  document.body.dataset.state = status.kind || "info";
  if (status.progress !== null && status.progress !== undefined) {
    bar.style.width = Math.max(0, Math.min(100, status.progress)) + "%";
    percent.textContent = status.progress >= 100 ? "ГОТОВО" : status.progress + "%";
  } else {
    percent.textContent = status.kind === "error" ? "НУЖНО ВНИМАНИЕ" : "АВТООБНОВЛЕНИЕ";
  }
}
window.novaLauncher.onStatus(setStatus);

async function check() {
  checkButton.disabled = true;
  try {
    const result = await window.novaLauncher.check();
    if (result.ok) version.textContent = "GitHub: " + result.version;
    else version.textContent = "Не удалось проверить релиз";
  } finally {
    checkButton.disabled = false;
  }
}
checkButton.addEventListener("click", check);
launchButton.addEventListener("click", async () => {
  if (working) return;
  working = true;
  launchButton.disabled = true;
  checkButton.disabled = true;
  try { await window.novaLauncher.installOrLaunch(); }
  finally {
    working = false;
    launchButton.disabled = false;
    checkButton.disabled = false;
  }
});
document.getElementById("github").addEventListener("click", () => window.novaLauncher.openGitHub());
