/**
 * @file sw.js  (served from root — scope covers entire origin)
 * Elefeed Service Worker
 *
 * Responsibilities:
 *  1. Pass-through fetch (network-only, no caching strategy).
 *  2. Handle Mastodon Web Push messages and display OS notifications.
 *  3. Focus / open the PWA when the user taps a notification.
 *
 * NOTE: This file must live at the root of the origin so its default scope
 * is "/" and it can receive push events for all pages. If it were inside
 * /js/, the default scope would be "/js/" and push events would be silently
 * discarded on Android Chrome & Firefox.
 */

'use strict';

/* ── Install / Activate ──────────────────────────────────────────────── */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* ── Fetch (pass-through, no caching) ───────────────────────────────── */

self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});

/* ── Push Notifications ──────────────────────────────────────────────── */

self.addEventListener('push', event => {
  // event.waitUntil() MUST receive a Promise that resolves only after the
  // notification has been shown — otherwise Android kills the SW first.
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  if (!event.data) {
    return self.registration.showNotification('Elefeed', {
      body: 'You have a new notification.',
      icon: '/icon512x512.png',
      badge: '/icon512x512.png',
      data: { url: '/?notifications=true' }
    });
  }

  let data = {};
  try {
    const text = event.data.text();
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.debug('[SW] Push data not JSON:', e.message);
    }
  } catch (err) {
    console.debug('[SW] Push data read error:', err.message);
  }

  const title = data.title || 'Elefeed';
  const bodyText = data.body || 'You have a new notification.';

  const options = {
    body: bodyText,
    icon: data.icon || '/icon512x512.png',
    badge: '/icon512x512.png',
    // Fixed tag: new pushes silently replace the previous one instead of
    // stacking a separate OS notification for every queued item.
    tag: 'elefeed-notif',
    renotify: true,
    data: { url: '/' }
  };

  // Route to the correct view based on notification type
  if (data.notification_type === 'mention' || data.notification_type === 'status') {
    options.data.url = '/?notifications=true';
  }

  await self.registration.showNotification(title, options);

  // Tell any open clients to refresh their badge
  try {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    allClients.forEach(c => c.postMessage({ type: 'SW_NEW_NOTIFS', count: 1 }));
  } catch (e) {
    console.debug('[SW] Clients update error:', e.message);
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
      const existing = clients.find(c => c.url.startsWith(origin));
      if (existing) {
        return existing.focus().then(c => c.navigate(fullUrl));
      }
      return self.clients.openWindow(fullUrl);
    })
  );
});