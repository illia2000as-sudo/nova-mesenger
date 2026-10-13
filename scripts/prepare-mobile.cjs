const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "mobile");
const src = path.join(root, "src");
const destination = path.join(root, "android-app", "www");

function copyRequired(from, to) {
  if (!fs.existsSync(from)) throw new Error("Required NOVA mobile file is missing: " + from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDirectory(from, to) {
  if (!fs.existsSync(from)) throw new Error("Required source directory is missing: " + from);
  fs.cpSync(from, to, { recursive: true, force: true });
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
copyDirectory(src, path.join(destination, "src"));

const htmlPath = path.join(source, "index.html");
if (!fs.existsSync(htmlPath)) throw new Error("mobile/index.html not found");
let html = fs.readFileSync(htmlPath, "utf8");
html = html
  .replaceAll("../src/style.css", "./src/style.css")
  .replaceAll("../src/app.js", "./src/app.js")
  .replaceAll("./mobile.css", "./mobile.css")
  .replaceAll("./manifest.webmanifest", "./manifest.webmanifest")
  .replaceAll("./nova-icon.svg", "./nova-icon.svg");
fs.writeFileSync(path.join(destination, "index.html"), html, "utf8");

for (const name of ["mobile.css", "manifest.webmanifest", "nova-icon.svg", "service-worker.js"]) {
  copyRequired(path.join(source, name), path.join(destination, name));
}

console.log("Prepared NOVA Android web bundle:", destination);
console.log("Included shared Firebase app, calls module, desktop-shared styles, and mobile navigation.");
