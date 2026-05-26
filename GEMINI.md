# 🪐 Gemini Developer Guide (GEMINI.md)

Welcome to **Elefeed**, an experimental, ultra-tidy, and visual Mastodon client. 

This guide is designed for **Gemini** (and other AI coding assistants or developers) to understand the architecture, design principles, and strict rules of the codebase before making any modifications. Adhering to these patterns will prevent bugs, keep the app fast, and maintain a seamless multi-account and cloud-sync user experience.

---

## 🏗️ Architecture & Philosophy

Elefeed is a **lightweight, zero-framework, single-page application (SPA)** built with modern web technologies:
1. **No Frontend Frameworks**: Written entirely in **Vanilla JS** (using modern standard ES Modules) and **Vanilla CSS**.
2. **Client-Side Heavy**: Runs directly in the browser. It stores OAuth keys, local settings, and feed state in `localStorage`.
3. **PWA & Android Webview Compatibility**: Operates as a Progressive Web App and interfaces with an Android wrapper using `window.AndroidBridge`.

### Directory Structure

```
├── CNAME
├── README.md               <- Main user-facing project overview
├── GEMINI.md               <- This AI orientation guide
├── index.html              <- Single HTML page container (includes splash & screens)
├── build.js                <- esbuild compiler script for production builds
├── sw.js                   <- Service worker for offline capability and caching
├── css/                    <- Categorized CSS files (vanilla CSS, no frameworks)
│   ├── base.css            <- CSS Variables, theme tokens, & reset rules
│   ├── layout.css          <- Main SPA wrapper grid and responsive structure
│   ├── components.css      <- Shared custom buttons, toggles, badges, and cards
│   ├── drawers.css         <- Slide-over panel transition rules and layouts
│   └── [feature].css       <- Feature-specific styling (posts, compose, lists, etc.)
└── js/                     <- Modular ES Modules logic
    ├── state.js            <- Global central singleton state & DOM selectors
    ├── api.js              <- Core Mastodon REST API wrapper functions
    ├── app.js              <- Main bootstrapper & global event routing
    ├── feed.js             <- Home, hashtags, and public timelines rendering/polling
    ├── lists.js            <- Mastodon custom lists management and suggestions
    ├── notifications.js    <- Foreground/background notifications poller
    ├── profile.js          <- View details, toggle follow, bookmarks drawer
    ├── settingsSync.js     <- Automatic note-based preferences synchronization
    ├── sync.js             <- Account bio/note payload parsing utilities
    └── utils.js            <- General text formatting, custom emojis, and DOM helpers
```

---

## ⚡ Technical Guidelines & Strictest Rules

When editing or adding code, you **MUST** follow these critical rules:

### 1. The `state.js` Dependency Anchor (Circular Reference Protection)
* **Rule**: `js/state.js` holds the central configuration, singleton state object, and global helpers (like `$` and `qs`).
* **Critical Constraint**: **`js/state.js` must NEVER have any internal imports.** It has zero dependencies to guarantee it can never participate in a circular module dependency.
* Always import `state`, `composeState`, `$`, `qs`, and core local storage utilities (`store`) from `js/state.js`.

### 2. DOM Access & Selectors
* Never use raw `document.getElementById` or `document.querySelector` inside JS modules. 
* Use the lightweight global shorthands imported from `js/state.js`:
  ```javascript
  import { $, qs } from './state.js';
  
  const element = $('my-element-id');
  const items = qs('.my-class-selector');
  ```

### 3. Drawer & Screen History (Back-Button Integrity)
* Elefeed uses a single-page view structure where major components (Compose, Notifications, Thread, Profile, Filters, Lists) open in side-drawers using `.open` classes.
* **Rule**: When opening any drawer, you **must** register it in the browser history using `history.pushState` so the browser's back button closes the drawer rather than navigating away from the page.
* Event listening is wired via `popstate` in `js/app.js` to map URL parameters (e.g., `?thread=...`, `?profile=...`) back to their respective drawer handlers.

### 4. Cloud Settings Sync via Mastodon Bio
* User preferences (theme, font settings, feed options) are synced across devices without a custom database.
* **Mechanism**: The app reads/writes custom JSON state to the user's Mastodon profile "Bio" (account note) wrapped in special markers:
  ```text
  --- ELEFEED SETTINGS START ---
  {"updatedAt":1716734732000,"prefs":{"theme":"dark","pref_font_size":"14px",...}}
  --- ELEFEED SETTINGS END ---
  ```
* When editing preferences, ensure `triggerPush()` in `settingsSync.js` is called to debounced-upload the new settings block, and verify that changes handle local vs. remote synchronization conflicts gracefully.

### 5. Multi-Account Isolation
* The client supports seamless switching between multiple Mastodon accounts (`state.accounts`).
* **Rule**: When switching accounts, you must invoke `resetFeeds()` (in `js/app.js`) to wipe existing state and prevent leakage of notifications, timeline caches, or credentials between profiles.

### 6. Android Bridge Communications
* Elefeed integrates with a native Android wrapper app via `window.AndroidBridge`.
* When saving active profiles, access tokens, or configuring backgrounds, you **must** send JSON messages through the bridge using `AndroidBridge.postMessage` (with fallbacks to older legacy direct methods if specified, see `js/app.js` for examples).

---

## 🎨 Theme & Styling System

Styling is driven entirely by vanilla CSS custom properties defined in `css/base.css`.

### Mode & Palette Application
* **Mode (`light` vs `dark`)**: Controlled via the `data-mode` attribute on the `<html>` tag.
* **Accent Palette**: Controlled via the `data-palette` attribute on the `<html>` tag (e.g. `classic`, `grape`, `forest`, etc.).
* Do not apply hardcoded color styles in javascript or layout files. Use variables like `var(--bg)`, `var(--text)`, `var(--accent)`, `var(--border)`, and `var(--surface2)`.

---

## 🛠️ Local Development & Bundling

### 1. Running Locally
Serve the root directory directly using a simple HTTP server:
```bash
npx serve -p 8080
# Or using http-server
npx http-server -p 8080
```

### 2. Building for Production
Elefeed uses a lightweight esbuild script to compile files into a minified production bundle in the `/dist` directory.
Run the build script:
```bash
npm run build
```
This executes `node build.js`, which minifies CSS files and bundles standard ES Modules down for optimal loading.

---

## 🤖 Tip for AI Coding Assistants (Like Me!)
When asked to build a new feature or debug an existing flow:
1. **Check UI selectors**: Elements for settings and toggles are styled and laid out in `index.html` within `<div id="settings-drawer">`.
2. **Wire State early**: If adding a preference toggle, add a default parameter prefixed with `pref_` to the `state` object inside `js/state.js`, and wire its change handler in `js/settingsSync.js`'s `applySettings` function.
3. **Preserve modularity**: Keep logic separate. For example, search behaviors belong in `js/search.js`, rendering post templates belongs in `js/render.js`, and lists-specific functionality lives in `js/lists.js`.
