const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico");

async function main() {
  const root = path.resolve(__dirname, "..");
  const svg = await fs.readFile(path.join(root, "mobile", "nova-icon.svg"));
  const png = await sharp(svg, { density: 384 }).resize(256, 256).png().toBuffer();
  const ico = await pngToIco(png);
  const outputDir = path.join(root, "build");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "icon.ico"), ico);
  console.log("Generated build/icon.ico from mobile/nova-icon.svg");
}

main().catch(error => {
  console.error("Failed to generate NOVA Windows icon:", error);
  process.exitCode = 1;
});
