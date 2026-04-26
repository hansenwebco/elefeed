/**
 * @module notifications
 * Notification drawer - loading, rendering, polling, filter tabs, badges.
 * Also manages the Service Worker bridge for background notifications.
 */

import { $, store, state } from './state.js';
import { apiGet } from './api.js';
import { escapeHTML, relativeTime, updateURLParam, formatCount, sanitizeHTML, renderCustomEmojis, processContent } from './utils.js';
import { openProfileDrawer } from './profile.js';
import { openThreadDrawer } from './thread.js';
import { renderFollowingBadge } from './render.js';
import { fetchRelationships } from './feed.js';
import { NOTIF_ICONS, NOTIF_LABELS } from './notif_constants.js';
import { showNotificationToast } from './ui.js';
import { updateTitleBar } from './titlebar.js';

/* ── Pagination / Observer ─────────────────────────────────────────── */
let _notifLoadingMore = false;
let _notifScrollObserver = null;

function _attachNotifObserver() {
  _disconnectNotifObserver();
  const sentinel = $('notif-sentinel');
  if (!sentinel) return;

  _notifScrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !_notifLoadingMore) {
      loadMoreNotifications();
    }
  }, {
    root: $('notif-content'), // Using the scroll container as root
    rootMargin: '200px',      // Start loading before we hit the bottom
    threshold: 0,
  });

  _notifScrollObserver.observe(sentinel);
}

function _disconnectNotifObserver() {
  if (_notifScrollObserver) {
    _notifScrollObserver.disconnect();
    _notifScrollObserver = null;
  }
}

async function loadMoreNotifications() {
  const filter = state.notifFilter;
  const maxId = state.notifMaxId[filter];
  if (_notifLoadingMore || !maxId) return;

  _notifLoadingMore = true;
  const sentinel = $('notif-sentinel');
  if (sentinel) {
    sentinel.innerHTML = '<div class="spinner" style="width:20px;height:20px;margin:20px auto;"></div>';
  }

  try {
    await loadNotifications(true);
  } finally {
    _notifLoadingMore = false;
    const currentMaxId = state.notifMaxId[filter];
    // Only clear the spinner/sentinel if we still have a maxId (meaning we didn't reach the end).
    // If currentMaxId is null, loadNotifications has already set the "end of notifications" message in the sentinel.
    if (sentinel && currentMaxId) {
      sentinel.innerHTML = '';
    }
  }
}

/* ── Service Worker messaging / Web Push ─────────────────────────────── */

// Utility to convert VAPID key for PushManager
function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Safe Uint8Array → base64url without spread (avoids RangeError on large keys)
function uint8ArrayToBase64url(uint8Array) {
  let binary = '';
  for (let i = 0; i < uint8Array.byteLength; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}


/**
 * Send a message to the active service worker.
 * Silently no-ops if no SW is registered.
 */
async function swPost(msg) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.active) reg.active.postMessage(msg);
  } catch { /* sw unavailable */ }
}

/**
 * Start Web Push subscription with Mastodon server
 */
export async function startSwPolling() {
  if (!state.token || state.demoMode || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const bgEnabled = store.get('pref_bg_notifications') !== 'false';

  if (!bgEnabled) {
    return stopSwPolling(); // Unsubscribe if disabled
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      let vapidKey = null;
      try {
        const res = await apiGet('/api/v2/instance', state.token);
        vapidKey = res?.configuration?.vapid?.public_key;
      } catch (e) { }

      if (!vapidKey) {
        try {
          const res = await apiGet('/api/v1/instance', state.token);
          vapidKey = res?.configuration?.vapid?.public_key;
        } catch (e) { }
      }

      if (!vapidKey) {
        console.warn('[Elefeed] Could not find VAPID public key from instance.');
        return;
      }

      console.log('[Elefeed] Creating new push subscription…');
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(vapidKey)
      });
      console.log('[Elefeed] Push subscription created:', sub.endpoint);
    }

    // Only re-register with Mastodon if the endpoint changed or was never registered
    const storedEndpoint = store.get('push_endpoint_' + state.server);
    if (storedEndpoint === sub.endpoint) {
      console.log('[Elefeed] Push subscription unchanged, skipping Mastodon registration.');
      return;
    }

    console.log('[Elefeed] Registering push subscription with Mastodon…');

    // Safe key encoding that avoids RangeError on large keys
    const p256dhKey = sub.getKey('p256dh');
    const authKey = sub.getKey('auth');
    const p256dh = uint8ArrayToBase64url(new Uint8Array(p256dhKey));
    const auth = uint8ArrayToBase64url(new Uint8Array(authKey));

    const alertOn = type => store.get('pref_alert_' + type) !== 'false';
    const body = new URLSearchParams({
      'data[alerts][mention]': alertOn('mention') ? 'true' : 'false',
      'data[alerts][status]': alertOn('status') ? 'true' : 'false',
      'data[alerts][reblog]': alertOn('reblog') ? 'true' : 'false',
      'data[alerts][follow]': alertOn('follow') ? 'true' : 'false',
      'data[alerts][follow_request]': alertOn('follow_request') ? 'true' : 'false',
      'data[alerts][favourite]': alertOn('favourite') ? 'true' : 'false',
      'data[alerts][poll]': alertOn('poll') ? 'true' : 'false',
      'data[alerts][update]': alertOn('update') ? 'true' : 'false',
      'data[policy]': 'all',
      'subscription[endpoint]': sub.endpoint,
      'subscription[keys][p256dh]': p256dh,
      'subscription[keys][auth]': auth
    });

    const response = await fetch(`https://${state.server}/api/v1/push/subscription`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    if (response.ok) {
      store.set('push_endpoint_' + state.server, sub.endpoint);
      console.log('[Elefeed] Push subscription registered with Mastodon ✓');
    } else {
      const errorText = await response.text();
      console.warn('[Elefeed] Mastodon push registration failed:', response.status, errorText);
    }
  } catch (err) {
    console.warn('[Elefeed] Push subscription failed:', err);
  }
}

/** Stop Web Push subscription. */
export async function stopSwPolling() {
  if (!state.token || state.demoMode || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      await fetch(`https://${state.server}/api/v1/push/subscription`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      store.del('push_endpoint_' + state.server);
      console.log('[Elefeed] Push subscription removed.');
    }
  } catch (err) {
    console.warn('[Elefeed] Failed to stop push:', err);
  }
}

/** Tell the SW to sync its lastSeenNotifId (called when drawer is opened). */
export async function swSyncSeen() {
  if (state.lastSeenNotifId) {
    await swPost({ type: 'UPDATE_SEEN', lastSeenNotifId: state.lastSeenNotifId });
  }
}

/** Apply updated bg notification settings. */
export async function updateSwConfig() {
  const bgEnabled = store.get('pref_bg_notifications') !== 'false';
  if (bgEnabled) {
    await startSwPolling();
  } else {
    await stopSwPolling();
  }
}

/**
 * Request the Notification permission from the browser.
 * Returns the resulting permission state: 'granted' | 'denied' | 'default'.
 */
export async function requestNotifPermission() {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/** Current permission status string - used by the settings panel. */
export function getNotifPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

/* ── Listen for messages from the SW ───────────────────────────────── */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    const { type, count, newestId } = event.data || {};
    if (type === 'SW_NEW_NOTIFS') {
      // Update the badge so the user sees the red count even after returning to the app
      if (!state.notifDrawerOpen) {
        state.notifUnreadCount = (state.notifUnreadCount || 0) + count;
        updateNotifBadge();
      }
      // Update the in-memory lastSeen so the next foreground poll is accurate
      if (newestId && (!state.lastSeenNotifId || newestId > state.lastSeenNotifId)) {
        // Don't overwrite lastSeenNotifId - the user hasn't *seen* them yet,
        // but record that we know they exist so we don't double-count.
        state._swLastKnownId = newestId;
      }
    }
  });
}

/* ── Open / close ──────────────────────────────────────────────────── */

export function openNotifDrawer() {
  const drawer = $('notif-drawer');
  const backdrop = $('notif-backdrop');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
  state.notifDrawerOpen = true;

  // Update URL state
  updateURLParam('notifications', 'true', true);

  window.updateSidebarNav?.();

  if (state.notifications.length > 0) {
    renderNotifications();
    // Update the lastSeenNotifId for the badge counter / SW,
    // but individual read state is tracked separately.
    // Tells the server we have seen up to the latest notification in the client
    dismissNotifMarker();
    // Tells the SW the user has seen up to this ID
    swSyncSeen();
  }

  loadNotifications();
}

export function closeNotifDrawer() {
  const drawer = $('notif-drawer');
  const backdrop = $('notif-backdrop');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
  state.notifDrawerOpen = false;
  updateURLParam('notifications', null);
  _disconnectNotifObserver();
  window.updateSidebarNav?.();
}

/* ── Badge ─────────────────────────────────────────────────────────── */

export function updateNotifBadge() {
  const badge = $('notif-badge');
  const clearBtn = $('notif-clear-all');
  if (!badge) return;
  if (state.notifUnreadCount > 0) {
    badge.textContent = state.notifUnreadCount > 99 ? '99+' : String(state.notifUnreadCount);
    badge.classList.add('visible');
    if (clearBtn) clearBtn.classList.add('has-unread');
  } else {
    badge.classList.remove('visible');
    badge.textContent = '';
    if (clearBtn) clearBtn.classList.remove('has-unread');
  }
  
  // Also update sidebar if available
  window.updateSidebarNav?.();
  
  // Update browser title & favicon
  updateTitleBar();
}

async function dismissNotifMarker() {
  if (!state.token || state.demoMode) return;
  try {
    await fetch(`https://${state.server}/api/v1/markers`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifications: { last_read_id: state.lastSeenNotifId } }),
    });
  } catch { /* silent */ }
}

/* ── Read / unread tracking (server-synced) ────────────────────────── */

/** 
 * Check whether a notification is read. 
 * Source of truth: ID compared against state.lastSeenNotifId (which is synced via Marker API)
 */
function _isNotifRead(notifId) {
  if (!state.lastSeenNotifId) return false;
  // Numerical comparison of IDs
  // Mastodon IDs are strings but numerical.
  return BigInt(notifId) <= BigInt(state.lastSeenNotifId);
}


/** Mark ALL current notifications as read by jumping the marker to the top item. */
function markAllRead() {
  const allNotifs = state.notifications;
  if (allNotifs.length === 0) return;

  const newestId = allNotifs[0].id;
  state.lastSeenNotifId = newestId;
  store.set('lastSeenNotifId_' + state.server, newestId);
  dismissNotifMarker();
  swSyncSeen();

  state.notifUnreadCount = 0;
  updateNotifBadge();

  // Visually remove all unread highlights
  document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
}

/** Recalculate the unread count from the notifications cache. */
function _recalcUnreadCount() {
  state.notifUnreadCount = state.notifications.filter(n => !_isNotifRead(n.id)).length;
}

/* ── Cache helpers ─────────────────────────────────────────────────── */

function getNotifCache(filter) {
  return filter === 'all' ? state.notifications : (state.notifByType[filter] || []);
}

function setNotifCache(filter, items) {
  if (filter === 'all') state.notifications = items;
  else state.notifByType[filter] = items;
}

/* ── Loading ───────────────────────────────────────────────────────── */

export async function loadNotifications(append = false) {
  if (!state.token || state.demoMode) return;
  const content = $('notif-content');
  const filter = state.notifFilter;
  const cached = getNotifCache(filter);

  if (!append && cached.length === 0) {
    content.innerHTML = '<div class="notif-empty"><div class="spinner"></div></div>';
  }

  try {
    const params = new URLSearchParams({ limit: '40' });
    if (filter !== 'all') params.append('types[]', filter);
    const maxId = state.notifMaxId[filter];
    if (append && maxId) params.append('max_id', maxId);

    const url = `/api/v1/notifications?${params.toString()}`;
    const notifs = await apiGet(url, state.token);

    if (notifs.length > 0) {
      state.notifMaxId[filter] = notifs[notifs.length - 1].id;
    } else {
      state.notifMaxId[filter] = null;
        const sentinel = $('notif-sentinel');
        if (sentinel) {
          sentinel.innerHTML = '<div class="notif-end" style="text-align:center;padding:24px;font-size:11px;color:var(--text-dim);font-family:var(--font-mono);opacity:0.6;">- end of notifications -</div>';
          _disconnectNotifObserver();
        }
      }

      const statuses = notifs.filter(n => !!n.status).map(n => n.status);
      const accounts = notifs.map(n => n.account);
      await fetchRelationships([...statuses, ...accounts]);

    if (!append) {
      setNotifCache(filter, notifs);
      if (state.notifFilter === filter) renderNotifications();
    } else {
      setNotifCache(filter, [...cached, ...notifs]);
      if (state.notifFilter === filter) appendNotifications(notifs);
    }
  } catch (err) {
    console.warn('Failed to load notifications:', err);
    if (!append && cached.length === 0) {
      content.innerHTML = '<div class="notif-empty"><p style="font-size:13px;color:var(--danger)">Failed to load notifications</p></div>';
    }
  }
}

/* ── Rendering ─────────────────────────────────────────────────────── */

/** Repopulate the entire notification list from cache. */
function renderNotifications() {
  const content = $('notif-content');
  const filter = state.notifFilter;
  const items = getNotifCache(filter);

  if (items.length === 0) {
    content.innerHTML = `
      <div class="notif-empty">
        <iconify-icon icon="ph:bell-bold" style="font-size: 32px; color:var(--text-dim);"></iconify-icon>
        <p style="font-size:13px;">No notifications${filter !== 'all' ? ' of this type' : ''}</p>
      </div>`;
    _disconnectNotifObserver();
    return;
  }

  let html = items.map(n => renderNotifItem(n)).join('');
  const maxId = state.notifMaxId[filter];

  if (maxId) {
    html += '<div id="notif-sentinel" class="notif-sentinel" style="min-height: 48px;"></div>';
  } else {
    html += '<div class="notif-end" style="text-align:center;padding:24px;font-size:11px;color:var(--text-dim);font-family:var(--font-mono);opacity:0.6;">- end of notifications -</div>';
  }

  content.innerHTML = html;

  if (maxId) {
    _attachNotifObserver();
  } else {
    _disconnectNotifObserver();
  }

  _wireEvents(content);
}

/** Append just the new batch of notifications to the existing DOM. */
function appendNotifications(newItems) {
  const content = $('notif-content');
  const sentinel = $('notif-sentinel');
  if (!content) return;

  const html = newItems.map(n => renderNotifItem(n)).join('');
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  const frag = document.createDocumentFragment();
  while (tmp.firstChild) frag.appendChild(tmp.firstChild);

  if (sentinel) {
    content.insertBefore(frag, sentinel);
  } else {
    content.appendChild(frag);
  }

  _wireEvents(content);
}

/** Wire up profile and status click handlers for a container. */
function _wireEvents(container) {
  container.querySelectorAll('[data-notif-profile]:not(.wired)').forEach(el => {
    el.classList.add('wired');
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      e.stopPropagation();
      const id = el.dataset.notifProfile;
      const srv = el.dataset.notifServer || state.server;
      closeNotifDrawer();
      setTimeout(() => openProfileDrawer(id, srv), 180);
    });
  });
  container.querySelectorAll('[data-notif-status]:not(.wired)').forEach(el => {
    el.classList.add('wired');
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      e.stopPropagation();
      const id = el.dataset.notifStatus;
      closeNotifDrawer();
      setTimeout(() => openThreadDrawer(id), 180);
    });
  });
}

function renderNotifItem(n) {
  const account = n.account;
  if (!account) return '';

  const icon = NOTIF_ICONS[n.type] || NOTIF_ICONS.mention;
  const typeClass = `type-${n.type === 'follow_request' ? 'follow' : n.type}`;
  const label = NOTIF_LABELS[n.type] || n.type;
  const time = relativeTime(n.created_at);
  const avatarUrl = account.avatar_static || account.avatar;
  const displayName = escapeHTML(account.display_name || account.username);

  let preview = '';
  if (n.status && n.status.content) {
    const s = n.status.reblog || n.status;
    
    // Check for 'warn' filter
    const filterResults = n.status.filtered || [];
    let isFiltered = filterResults.length > 0;
    let filterAction = isFiltered ? filterResults[0].filter.filter_action : null;
    let filterTitle = isFiltered ? filterResults[0].filter.title : null;

    if (!isFiltered) {
      const ctxFilters = state.filterRegexes.notifications;
      if (ctxFilters) {
        const text = ((s.spoiler_text || '') + ' ' + (s.content || '')).toLowerCase();
        if (ctxFilters.warn && ctxFilters.warn.test(text)) {
          isFiltered = true;
          filterAction = 'warn';
        }
      }
    }

    if (isFiltered && filterAction === 'warn') {
      preview = `<div class="notif-preview-filtered" style="font-size:11px; opacity:0.6; font-style:italic;">Filtered: ${escapeHTML(filterTitle || 'Custom Filter')}</div>`;
    } else {
      preview = `<div class="notif-preview" data-notif-status="${s.id}">${processContent(sanitizeHTML(s.content, { mentions: s.mentions, emojis: s.emojis, server: state.server }))}</div>`;
    }
  }

  const isUnread = !_isNotifRead(n.id);
  const itemClass = isUnread ? 'notif-item unread' : 'notif-item';

  let followProfile = '';
  if ((n.type === 'follow' || n.type === 'follow_request') && account) {
    const headerUrl = account.header_static || account.header;
    const bio = account.note ? processContent(sanitizeHTML(account.note, { emojis: account.emojis, server: state.server })) : '';
    const followers = formatCount(account.followers_count || 0);
    const following = formatCount(account.following_count || 0);
    const statuses = formatCount(account.statuses_count || 0);
    
    followProfile = `
      <div class="notif-follow-panel" data-notif-profile="${account.id}" data-notif-server="${state.server}">
        ${bio ? `<div class="notif-follow-bio">${bio}</div>` : ''}
        <div class="notif-follow-stats">
          <span class="notif-follow-stat"><strong>${followers}</strong> followers</span>
          <span class="notif-follow-stat"><strong>${following}</strong> following</span>
          <span class="notif-follow-stat"><strong>${statuses}</strong> posts</span>
        </div>
      </div>`;
  }

  return `
    <div class="${itemClass}" data-notif-id="${n.id}" 
         ${n.status ? `data-notif-status="${n.status.id}"` : `data-notif-profile="${account.id}" data-notif-server="${state.server}"`}>
      <div class="notif-icon ${typeClass}">${icon}</div>
      <div class="notif-body">
        <div class="notif-meta">
          <div style="position:relative; display:inline-flex;">
            <img class="notif-avatar" src="${escapeHTML(avatarUrl)}" alt="" loading="lazy"
                 onerror="this.onerror=null;this.src=window._AVATAR_PLACEHOLDER"
                 data-notif-profile="${account.id}" data-notif-server="${state.server}" />
            ${renderFollowingBadge(account.id)}
          </div>
          <span class="notif-who" data-notif-profile="${account.id}" data-notif-server="${state.server}">${renderCustomEmojis(account.display_name || account.username, account.emojis)}</span>
          <span class="notif-action">${label}</span>
        </div>
        ${preview}
        ${followProfile}
        <div class="notif-time">${time}</div>
      </div>
    </div>`;
}

/* ── Polling ───────────────────────────────────────────────────────── */

let triedMarkers = false;

/**
 * Poll for new notifications.
 * Handles the "fresh install" case logically:
 * 1. Checks localStorage for last seen ID
 * 2. Checks server markers (via Mastodon API) for synced seen ID
 * 3. Default to marking latest as seen if no record exists (avoids "30" badge)
 */
export async function pollNotifications() {
  if (!state.token || state.demoMode) return;

  // Restore from storage if needed
  if (!state.lastSeenNotifId) {
    state.lastSeenNotifId = store.get('lastSeenNotifId_' + state.server) || null;
  }

  // First-run sync: Check server markers if we have no local seen record
  if (!state.lastSeenNotifId && !triedMarkers) {
    triedMarkers = true;
    try {
      const markers = await apiGet('/api/v1/markers?timeline[]=notifications', state.token);
      const markerId = markers?.notifications?.last_read_id;
      if (markerId) {
        state.lastSeenNotifId = markerId;
        store.set('lastSeenNotifId_' + state.server, markerId);
      }
    } catch (e) {
      console.debug('[Elefeed] Marker sync failed:', e.message);
    }
  }

  try {
    let notifs = await apiGet('/api/v1/notifications?limit=40', state.token);
    
    // Filter out notifications associated with hidden statuses
    notifs = notifs.filter(n => {
      if (!n.status) return true;
      const s = n.status.reblog || n.status;
      
      // Server-side hide
      if (n.status.filtered && n.status.filtered.some(fr => fr.filter.filter_action === 'hide')) return false;
      
      // Client-side fallback
      const ctxFilters = state.filterRegexes.notifications;
      if (ctxFilters && ctxFilters.hide) {
        const text = ((s.spoiler_text || '') + ' ' + (s.content || '')).toLowerCase();
        if (ctxFilters.hide.test(text)) return false;
      }
      return true;
    });

    state.notifications = notifs;

    if (notifs.length > 0) {
      state.notifMaxId['all'] = notifs[notifs.length - 1].id;

      // Sync marker from server every poll to ensure cross-device consistency
      try {
        const markers = await apiGet('/api/v1/markers?timeline[]=notifications', state.token);
        const markerId = markers?.notifications?.last_read_id;
        if (markerId && (!state.lastSeenNotifId || BigInt(markerId) > BigInt(state.lastSeenNotifId))) {
          state.lastSeenNotifId = markerId;
          store.set('lastSeenNotifId_' + state.server, markerId);
        }
      } catch (e) { console.debug('[Elefeed] Marker sync failed:', e.message); }

      // Recalc based on synced marker
      _recalcUnreadCount();
    } else {
      state.notifUnreadCount = 0;
    }

    updateNotifBadge();
    if (state.notifDrawerOpen) renderNotifications();

    // ── Foreground alert ──────────────────────────────────────────────
    // Fire an OS notification when new items arrive while the app is open
    // but the drawer is closed. Conditions:
    //   1. There are genuinely new (unseen) notifications
    //   2. The notification drawer is closed
    //   3. We haven't already alerted for this same notification ID
    //   4. OS permission is granted
    //   5. The background-notifications setting is enabled
    if (
      state.notifUnreadCount > 0 &&
      !state.notifDrawerOpen &&
      notifs.length > 0
    ) {
      const newest = notifs[0];

      // On the very first poll after startup, _lastFiredNotifId is null.
      // Don't fire an alert for notifications that were already queued
      // before the app opened (the SW already handled those). Instead,
      // silently seed the ID so only truly new arrivals trigger an alert.
      if (state._lastFiredNotifId === null) {
        state._lastFiredNotifId = newest.id;
        return;
      }

      const alreadyFired = state._lastFiredNotifId >= newest.id;
      if (!alreadyFired) {
        state._lastFiredNotifId = newest.id;
        
        // Trigger in-app notification toast (handles its own pref check)
        showNotificationToast(newest);

        // OS persistent notification
        if (Notification.permission === 'granted') {
          const bgEnabled = store.get('pref_bg_notifications') !== 'false';
          if (bgEnabled) {
            const who = newest.account?.display_name || newest.account?.username || 'Someone';
            const action = NOTIF_LABELS[newest.type] || newest.type;
            const bodyText = state.notifUnreadCount > 1
              ? `${who} and ${state.notifUnreadCount - 1} other${state.notifUnreadCount > 2 ? 's' : ''}`
              : `${who} ${action}`;

            try {
              const reg = await navigator.serviceWorker.ready;
              await reg.showNotification('Elefeed', {
                body: bodyText,
                icon: newest.account?.avatar_static || '/icon512x512.png',
                badge: '/icon512x512.png',
                tag: `elefeed-fg-${newest.id}`,
                data: { url: '/?notifications=true' },
              });
            } catch (e) {
              console.debug('[Elefeed] Foreground notification failed:', e.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Notification poll failed:', err.message);
  }
}

/* ── Init (called once from app.js) ───────────────────────────────── */

export function initNotifications() {
  // Filter buttons
  document.querySelectorAll('.notif-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.notif-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.notifFilter = btn.dataset.notifFilter;
      const cached = getNotifCache(state.notifFilter);
      if (cached.length > 0) renderNotifications();
      loadNotifications();
    });
  });

  // Open / close / backdrop
  $('notif-btn').addEventListener('click', openNotifDrawer);
  $('notif-close').addEventListener('click', closeNotifDrawer);
  $('notif-backdrop').addEventListener('click', closeNotifDrawer);

  // Mark all read button
  $('notif-clear-all').addEventListener('click', markAllRead);
}

/**
 * Trigger an in-app toast for the absolute latest notification.
 * Used for the secret shortcut (Ctrl+Alt+N).
 */
export async function showLatestNotifToast() {
  if (!state.token || !state.server) return;

  try {
    // Fetch just the single newest notification
    const params = new URLSearchParams({ limit: 1 });
    const res = await apiGet(`/api/v1/notifications?${params.toString()}`, state.token, state.server);
    
    // apiGet might return the array directly
    const notifs = Array.isArray(res) ? res : [];

    if (notifs.length > 0) {
      showNotificationToast(notifs[0]);
    } else {
      showNotificationToast({
        type: 'status',
        account: {
          display_name: 'elefeed',
          username: 'system',
          avatar_static: 'favicon.svg'
        },
        status: { content: 'No notifications found yet! Stay tuned for more.' }
      });
    }
  } catch (err) {
    console.error('[Elefeed] Failed to fetch latest notification for shortcut:', err);
  }
}
