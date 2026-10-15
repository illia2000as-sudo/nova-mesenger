const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.resolve(
  __dirname,
  "..",
  "android-app",
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml"
);

if (!fs.existsSync(manifestPath)) {
  throw new Error("AndroidManifest.xml was not generated: " + manifestPath);
}

let xml = fs.readFileSync(manifestPath, "utf8");
const permissions = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.CAMERA",
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_CONNECT"
];

for (const permission of permissions) {
  const escaped = permission.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp('<uses-permission\\s+android:name="' + escaped + '"').test(xml)) {
    const applicationTag = xml.match(/\s*<application\b/);
    if (!applicationTag || applicationTag.index == null) {
      throw new Error("Could not locate <application> in AndroidManifest.xml");
    }
    xml = xml.slice(0, applicationTag.index) +
      '    <uses-permission android:name="' + permission + '" />\n' +
      xml.slice(applicationTag.index);
  }
}

if (!xml.includes('android.hardware.microphone')) {
  xml = xml.replace(
    /\s*<application\b/,
    '\n    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n    <application'
  );
}

fs.writeFileSync(manifestPath, xml, "utf8");
console.log("Added NOVA Android network, microphone, camera, and call-audio permissions.");
