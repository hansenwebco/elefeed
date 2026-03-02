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

/* ── Push Notifications ──────────────────────────────────────────────── */

self.addEventListener('push', event => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    // Mastodon pushes JSON data with title, body, icon etc.
    const title = data.title || 'Elefeed';
    const bodyText = data.body || '';

    const options = {
      body: bodyText,
      icon: data.icon || '/icon512x512.png',
      badge: '/icon512x512.png',
      tag: `elefeed-notif-${data.notification_id || Date.now()}`,
      data: { url: '/' } // defaulting to root url
    };

    // Attempt to route notifications slightly better based on type
    if (data.notification_type === 'mention' || data.notification_type === 'status') {
      options.data.url = '/?notifications=true';
    }

    event.waitUntil(
      self.registration.showNotification(title, options).then(async () => {
        // Tell all open clients to refresh their badge
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        allClients.forEach(c => {
          c.postMessage({ type: 'SW_NEW_NOTIFS', count: 1 });
        });
      })
    );
  } catch (err) {
    console.debug('[SW] Push event error:', err.message);
  }
});

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