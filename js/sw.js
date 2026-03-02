/**
 * @file sw.js
 * Elefeed Service Worker
 *
 * Responsibilities:
 *  1. Pass-through fetch (network-only, no caching strategy).
 *  2. Background notification polling while the app is in the background.
 *  3. Display OS-level notifications via self.registration.showNotification().
 *  4. Focus / open the PWA when the user taps a notification.
 */

'use strict';

/* ── State ─────────────────────────────────────────────────────────── */

let pollingConfig = null;   // { token, server, lastSeenNotifId, interval }
let pollTimer = null;

/* ── Install / fetch ───────────────────────────────────────────────── */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});

/* ── Message handler (from main thread) ────────────────────────────── */

self.addEventListener('message', event => {
  const { type, ...payload } = event.data || {};

  switch (type) {
    case 'START_POLLING':
      pollingConfig = {
        token: payload.token,
        server: payload.server,
        lastSeenNotifId: payload.lastSeenNotifId || null,
        interval: payload.interval || 60_000,   // default 60 s
        enabled: payload.enabled !== false,    // opt-in toggle
      };
      restartTimer();
      break;

    case 'STOP_POLLING':
      stopTimer();
      pollingConfig = null;
      break;

    case 'UPDATE_SEEN':
      if (pollingConfig) {
        pollingConfig.lastSeenNotifId = payload.lastSeenNotifId;
      }
      break;

    case 'UPDATE_CONFIG':
      if (pollingConfig) {
        if (payload.interval) pollingConfig.interval = payload.interval;
        if ('enabled' in payload) pollingConfig.enabled = payload.enabled;
        restartTimer();
      }
      break;
  }
});

/* ── Timer management ──────────────────────────────────────────────── */

function restartTimer() {
  stopTimer();
  if (!pollingConfig || !pollingConfig.enabled) return;
  // Fire once immediately, then on the interval
  pollInBackground();
  pollTimer = setInterval(pollInBackground, pollingConfig.interval);
}

function stopTimer() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/* ── Background poll ───────────────────────────────────────────────── */

async function pollInBackground() {
  if (!pollingConfig || !pollingConfig.token || !pollingConfig.enabled) return;

  const { token, server, lastSeenNotifId } = pollingConfig;

  try {
    const res = await fetch(`https://${server}/api/v1/notifications?limit=15`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) return;
    const notifs = await res.json();
    if (!Array.isArray(notifs) || notifs.length === 0) return;

    // Determine which are new
    const newNotifs = lastSeenNotifId
      ? notifs.filter(n => n.id > lastSeenNotifId)
      : notifs;

    if (newNotifs.length === 0) return;

    // Check if the PWA is currently focused — if so, skip OS notifications
    // (the main thread's own polling will handle the badge/drawer update)
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const isFocused = allClients.some(c => c.focused);
    if (isFocused) {
      // Still update lastSeen so we don't re-fire when app comes back to background
      pollingConfig.lastSeenNotifId = notifs[0].id;
      return;
    }

    // Build and show grouped or individual notification(s)
    await showNotifications(newNotifs, server);

    // Update the high-water mark
    pollingConfig.lastSeenNotifId = notifs[0].id;

    // Tell all open (but backgrounded) clients to refresh their badge
    allClients.forEach(c => {
      c.postMessage({ type: 'SW_NEW_NOTIFS', count: newNotifs.length, newestId: notifs[0].id });
    });

  } catch (err) {
    // Silently swallow — network may be unavailable
    console.debug('[SW] Poll error:', err.message);
  }
}

/* ── Notification display ──────────────────────────────────────────── */

const TYPE_LABELS = {
  mention: 'mentioned you',
  reblog: 'boosted your post',
  favourite: 'favorited your post',
  follow: 'followed you',
  follow_request: 'requested to follow you',
  poll: 'your poll ended',
  update: 'edited a post',
  status: 'posted',
};

async function showNotifications(notifs, server) {
  // Group: if more than 2 new notifs, show a single grouped notification
  if (notifs.length >= 3) {
    await self.registration.showNotification('Elefeed', {
      body: `You have ${notifs.length} new notifications`,
      icon: '/icon512x512.png',
      badge: '/icon512x512.png',
      tag: 'elefeed-bulk',
      renotify: true,
      data: { url: `/?notifications=true` },
    });
    return;
  }

  // Individual notifications (1–2)
  for (const n of notifs) {
    const acct = n.account;
    if (!acct) continue;

    const name = acct.display_name || acct.username || 'Someone';
    const label = TYPE_LABELS[n.type] || n.type;

    let body = `${name} ${label}`;
    if (n.status?.content) {
      const tmp = n.status.content.replace(/<[^>]+>/g, '').trim();
      const preview = tmp.length > 100 ? tmp.slice(0, 97) + '…' : tmp;
      if (preview) body += `\n"${preview}"`;
    }

    const notifData = {
      url: n.status
        ? `/?thread=${n.status.id}`
        : `/?profile=${acct.id}`,
    };

    await self.registration.showNotification('Elefeed', {
      body,
      icon: acct.avatar_static || acct.avatar || '/icon512x512.png',
      badge: '/icon512x512.png',
      tag: `elefeed-notif-${n.id}`,
      timestamp: new Date(n.created_at).getTime(),
      data: notifData,
    });
  }
}

/* ── Notification click ────────────────────────────────────────────── */

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const targetUrl = (event.notification.data?.url) || '/';
  const origin = self.location.origin;
  const fullUrl = origin + targetUrl;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus an existing window if one is open
      const existing = clients.find(c => c.url.startsWith(origin));
      if (existing) {
        return existing.focus().then(c => c.navigate(fullUrl));
      }
      // Otherwise open a new window
      return self.clients.openWindow(fullUrl);
    })
  );
});