# NOVA Messenger Mobile

A touch-first mobile web/PWA entry point that reuses the shared NOVA Firebase app and call system.

## What's included

- Responsive, full-height chat view for phone screens.
- Bottom navigation for Chats, Friends, Requests, Gifts and Profile.
- Separate full-screen conversation with a back button.
- Touch-friendly composer, mobile-safe font sizes and safe-area padding.
- Installable PWA manifest and app icon.
- Lightweight service worker for caching the application shell.

## Run it

Serve the repository over HTTPS or from a local web server, then open `/mobile/`. Firebase Authentication, Realtime Database and Storage must be configured as described in the root README.

For GitHub Pages, open **Settings → Pages**, select **GitHub Actions** as the build/deployment source, then check the `Deploy NOVA Mobile to GitHub Pages` workflow. After deployment, open `https://<your-account>.github.io/<repository>/mobile/` on the phone. A PWA install prompt depends on browser/platform support.

## Important

The mobile entry point shares `src/app.js`, `src/style.css` and `src/calls.js`; it does not create a separate Firebase project or duplicate user database. The service worker caches the shell only. Signing in, messaging, media, and calls still require a network connection and appropriate Firebase rules/permissions.

Video calls, screen sharing, background notifications, and incoming-call behavior vary by mobile browser and operating system and need real-device testing. This is a mobile web/PWA version, not yet a signed native Android APK.
