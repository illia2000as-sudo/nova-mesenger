# NOVA Messenger for Android

This directory contains a Capacitor Android wrapper around the same app used by NOVA desktop and the mobile web app. It packages `src/app.js`, `src/calls.js`, `src/style.css`, and the touch-first `mobile/` UI together, rather than shipping an empty WebView shell.

## Build

The repository workflow **Build NOVA Messenger Android APK** builds the debug APK on GitHub Actions. Open **Actions → Build NOVA Messenger Android APK → latest successful run → Artifacts → NOVA-Messenger-Android-APK**.

All platforms use the same Firebase project configured in `src/app.js`; messages and groups therefore sync across Windows and Android when both users are signed in and the Firebase Realtime Database rules are correctly published.

The debug APK is for testing and is not a Play Store release. App size alone does not determine functionality; this build bundles the actual interface and app modules instead of padding the file with meaningless data.
