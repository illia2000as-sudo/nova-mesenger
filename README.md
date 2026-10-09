# ✦ NOVA Messenger

A dark, Aurora Glass-styled messenger built with **HTML, CSS, JavaScript, Firebase and Electron**. NOVA can run as a web app or as a Windows desktop installer.

## What’s inside

- **Accounts and profiles** — email/password sign-in, profile names and avatars.
- **Live conversations** — personal chats and group chats powered by Firebase Realtime Database.
- **Chat search** — search messages inside the open conversation.
- **Smart scrolling** — incoming messages won't yank you away from older messages while you're reading; use the floating arrow to jump to the latest message.
- **Mobile chat navigation** — open a conversation, then use the back arrow to return to the chat list.
- **Friends and requests** — find people and manage friend requests.
- **Media and gifts** — send supported images/videos and in-app NOVA gifts.
- **Calls** — audio calling is implemented; video and screen sharing depend on browser/Electron permissions, network conditions and WebRTC connectivity.
- **NOVA Premium preview** — gifting UI is present; paid subscriptions are not enabled.
- **Windows desktop build** — GitHub Actions builds an installer automatically after pushes to `main`.

## Keyboard shortcut

| Shortcut | Action |
| --- | --- |
| `Enter` | Send the current message |\n| `Shift + Enter` | Add a new line without sending |\n| `Ctrl + K` (Windows/Linux) or `⌘ + K` (Mac) | Open Messages and focus the chat-list search |
| `Esc` while conversation search is open | Close conversation search |

## Run locally

You need Node.js 22 or later and npm.

```bash
npm install
npm start
```

This starts the Electron desktop app. The app uses the Firebase project configured in `src/app.js`, so Firebase Authentication, Realtime Database and Storage must be configured and accessible.

## Build the Windows installer

```bash
npm install
npm run dist
```

The installer is written to `dist/`. You can also open the **Actions** tab in GitHub and download the `NOVA-Messenger-Windows` artifact from a successful **Build NOVA Messenger** run.

## Firebase setup checklist

1. Enable **Email/Password** in Firebase Authentication.
2. Configure Realtime Database and Storage.
3. Publish database and storage security rules that restrict each user's data to authorized users. Do not use open/public write rules for a real deployment.
4. Verify the Premium gifting rules in the Firebase Console itself. A JSON file stored in this repository does **not** publish rules to Firebase automatically.
5. Test account creation, friend requests, personal/group messages, media uploads and calls using separate test accounts.

## Important notes

- This is an actively developed preview, not a production-hardened service.
- Video calls and screen sharing may fail on some networks or devices even when audio calls work.
- NOVA coins and gifts are in-app demo features, not real-money balances.
- Never commit private credentials or service-account keys. Firebase web configuration is client-side configuration; database/storage rules and Authentication settings are what protect user data.

## Repository layout

```text
src/
  app.js       Main application and Firebase interactions
  calls.js     Audio/video calling and screen-sharing logic
  style.css    Application interface and responsive styling
main.js        Electron main process
package.json   Dependencies and Windows packaging settings
.github/
  workflows/
    build.yml  Windows installer workflow
```

---
Made with ✦ for NOVA Messenger.
