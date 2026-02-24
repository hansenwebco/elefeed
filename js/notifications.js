/**
 * @module notifications
 * Notification drawer — loading, rendering, polling, filter tabs, badges.
 */

import { $, store, state } from './state.js';
import { apiGet } from './api.js';
import { escapeHTML, relativeTime } from './utils.js';
import { openProfileDrawer } from './profile.js';
import { openThreadDrawer } from './thread.js';

/* ── Icon / label maps ─────────────────────────────────────────────── */

const NOTIF_ICONS = {
  mention:        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  reblog:         '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  favourite:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  follow:         '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
  follow_request: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
  poll:           '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="8" x2="9" y2="16"/><line x1="15" y1="11" x2="15" y2="16"/></svg>',
  update:         '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  status:         '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
};

const NOTIF_LABELS = {
  mention: 'mentioned you',
  reblog: 'boosted your post',
  favourite: 'favorited your post',
  follow: 'followed you',
  follow_request: 'requested to follow you',
  poll: 'poll ended',
  update: 'edited a post',
  status: 'posted',
};

/* ── Open / close ──────────────────────────────────────────────────── */

export function openNotifDrawer() {
  const drawer = $('notif-drawer');
  const backdrop = $('notif-backdrop');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
  state.notifDrawerOpen = true;

  // Push history state for back button
  history.pushState({ drawer: 'notif-drawer' }, '', '');

  if (state.notifications.length > 0) {
    renderNotifications();
    state.lastSeenNotifId = state.notifications[0].id;
    store.set('lastSeenNotifId_' + state.server, state.lastSeenNotifId);
    state.notifUnreadCount = 0;
    updateNotifBadge();
    dismissNotifMarker();
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
}

/* ── Badge ─────────────────────────────────────────────────────────── */

export function updateNotifBadge() {
  const badge = $('notif-badge');
  if (!badge) return;
  if (state.notifUnreadCount > 0) {
    badge.textContent = state.notifUnreadCount > 99 ? '99+' : String(state.notifUnreadCount);
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
    badge.textContent = '';
  }
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
    let url = '/api/v1/notifications?limit=30';
    if (filter !== 'all') url += `&types[]=${filter}`;
    const maxId = state.notifMaxId[filter];
    if (append && maxId) url += `&max_id=${maxId}`;

    const notifs = await apiGet(url, state.token);

    if (!append) setNotifCache(filter, notifs);
    else setNotifCache(filter, [...cached, ...notifs]);

    if (notifs.length > 0) state.notifMaxId[filter] = notifs[notifs.length - 1].id;

    if (state.notifFilter === filter) renderNotifications();
  } catch (err) {
    console.warn('Failed to load notifications:', err);
    if (!append && cached.length === 0) {
      content.innerHTML = '<div class="notif-empty"><p style="font-size:13px;color:var(--danger)">Failed to load notifications</p></div>';
    }
  }
}

/* ── Rendering ─────────────────────────────────────────────────────── */

function renderNotifications() {
  const content = $('notif-content');
  const filter = state.notifFilter;
  const items = getNotifCache(filter);

  if (items.length === 0) {
    content.innerHTML = `
      <div class="notif-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <p style="font-size:13px;">No notifications${filter !== 'all' ? ' of this type' : ''}</p>
      </div>`;
    return;
  }

  let html = items.map(n => renderNotifItem(n)).join('');
  const maxId = state.notifMaxId[filter];
  if (items.length >= 30 && maxId) {
    html += '<button class="notif-load-more" id="notif-load-more">Load more notifications</button>';
  }
  content.innerHTML = html;

  // Wire load-more
  const loadMoreBtn = $('notif-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      loadMoreBtn.textContent = 'Loading…';
      loadMoreBtn.disabled = true;
      loadNotifications(true);
    });
  }

  // Wire profile & status clicks
  content.querySelectorAll('[data-notif-profile]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.notifProfile;
      const srv = el.dataset.notifServer || state.server;
      closeNotifDrawer();
      setTimeout(() => openProfileDrawer(id, srv), 180);
    });
  });
  content.querySelectorAll('[data-notif-status]').forEach(el => {
    el.addEventListener('click', () => {
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
  if (n.status) {
    const text = n.status.content ? n.status.content.replace(/<[^>]*>/g, '').substring(0, 200) : '';
    if (text) preview = `<div class="notif-preview" data-notif-status="${n.status.id}">${escapeHTML(text)}</div>`;
  }

  return `
    <div class="notif-item">
      <div class="notif-icon ${typeClass}">${icon}</div>
      <div class="notif-body">
        <div class="notif-meta">
          <img class="notif-avatar" src="${escapeHTML(avatarUrl)}" alt="" loading="lazy"
               data-notif-profile="${account.id}" data-notif-server="${state.server}" />
          <span class="notif-who" data-notif-profile="${account.id}" data-notif-server="${state.server}">${displayName}</span>
          <span class="notif-action">${label}</span>
        </div>
        ${preview}
        <div class="notif-time">${time}</div>
      </div>
    </div>`;
}

/* ── Polling ───────────────────────────────────────────────────────── */

export async function pollNotifications() {
  if (!state.token || state.demoMode) return;
  state.lastSeenNotifId = store.get('lastSeenNotifId_' + state.server) || null;

  try {
    const notifs = await apiGet('/api/v1/notifications?limit=30', state.token);
    state.notifications = notifs;

    if (notifs.length > 0) {
      state.notifMaxId['all'] = notifs[notifs.length - 1].id;
      state.notifUnreadCount = state.lastSeenNotifId
        ? notifs.filter(n => n.id > state.lastSeenNotifId).length
        : notifs.length;
    } else {
      state.notifUnreadCount = 0;
    }

    updateNotifBadge();
    if (state.notifDrawerOpen) renderNotifications();
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
}
