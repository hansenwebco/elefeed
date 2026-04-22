/**
 * @module ui
 * Screen management, toast notifications, loading states, tab helpers.
 *
 * Tab-loader functions (loadFeedTab, loadExploreTab) are registered at
 * boot time from app.js via registerTabLoader() to avoid circular imports.
 */

import { $, state, CLIENT_VERSION, store } from './state.js';
import { escapeHTML } from './utils.js';
import { NOTIF_ICONS, NOTIF_LABELS } from './notif_constants.js';

/* ── Tab loader registry (avoids circular imports) ─────────────────── */

const _tabLoaders = {};

/** Register a function to call when a tab becomes active. */
export function registerTabLoader(tab, fn) { _tabLoaders[tab] = fn; }

/* ── Screen switching ──────────────────────────────────────────────── */

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

/* ── Toast ──────────────────────────────────────────────────────────── */

/** Ensure the toast region container exists */
function _getRegion() {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    document.body.appendChild(region);
  }
  return region;
}

const ICONS = {
  info: `<iconify-icon icon="ph:info-bold" style="font-size: 20px;"></iconify-icon>`,
  success: `<iconify-icon icon="ph:check-circle-bold" style="font-size: 20px;"></iconify-icon>`,
  error: `<iconify-icon icon="ph:warning-circle-bold" style="font-size: 20px;"></iconify-icon>`,
};

/**
 * Show a toast notification.
 *
 * @param {string} msg        - The message to display.
 * @param {string|number} [typeOrDuration='info'] - 'info' | 'success' | 'error', or a duration (ms) for backward compat.
 * @param {number} [duration=2800] - How long (ms) to show the toast.
 */
export function showToast(msg, typeOrDuration = 'info', duration = 2800) {
  // Backward-compat: showToast(msg, durationMs)
  let type = 'info';
  if (typeof typeOrDuration === 'number') {
    duration = typeOrDuration;
  } else if (typeof typeOrDuration === 'string' && ['info', 'success', 'error'].includes(typeOrDuration)) {
    type = typeOrDuration;
  }

  // Auto-detect type from message content if still 'info'
  if (type === 'info') {
    const lower = msg.toLowerCase();
    if (/fail|error|denied|could not|unable|permission/.test(lower)) {
      type = 'error';
    } else if (/success|posted|bookmarked|bookmark removed|follow|notif|enabled|on$|off$|signed out|refresh|updat|interval/.test(lower)) {
      type = 'success';
    }
  }

  const region = _getRegion();

  // Build DOM
  const item = document.createElement('div');
  item.className = `toast-item toast-${type}`;
  item.setAttribute('role', 'alert');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.innerHTML = ICONS[type] || ICONS.info;

  const text = document.createElement('span');
  text.className = 'toast-msg';
  text.textContent = msg;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.innerHTML = `<iconify-icon icon="ph:x-bold" style="font-size: 12px;"></iconify-icon>`;

  const progress = document.createElement('div');
  progress.className = 'toast-progress';

  item.append(icon, text, closeBtn, progress);
  region.appendChild(item);

  // Animate in (next frame so CSS transition fires)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => item.classList.add('toast-show'));
  });

  // Progress bar drain via CSS animation
  progress.style.transition = `transform ${duration}ms linear`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      progress.style.transform = 'scaleX(0)';
    });
  });

  function dismiss() {
    item.classList.add('toast-hiding');
    item.classList.remove('toast-show');
    item.addEventListener('transitionend', () => item.remove(), { once: true });
    // Failsafe
    setTimeout(() => item.remove(), 400);
  }

  const timer = setTimeout(dismiss, duration);
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); clearTimeout(timer); dismiss(); });
}

/**
 * Show a premium in-app notification preview.
 * @param {object} notif - The Mastodon notification object.
 */
export function showNotificationToast(notif) {
  // Respect user preference (will add toggle in settings later)
  const enabled = store.get('pref_in_app_notifs') !== 'false';
  if (!enabled) return;

  const account = notif.account;
  if (!account) return;

  const region = _getRegion();
  const icon = NOTIF_ICONS[notif.type] || NOTIF_ICONS.mention;
  const label = NOTIF_LABELS[notif.type] || notif.type;
  const avatarUrl = account.avatar_static || account.avatar;
  const displayName = account.display_name || account.username;

  let preview = '';
  if (notif.status && notif.status.content) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = notif.status.content;
    preview = (tempDiv.textContent || tempDiv.innerText || '').substring(0, 100);
    if (preview.length >= 100) preview = preview.trim() + '…';
  }

  const item = document.createElement('div');
  item.className = `toast-item toast-notification toast-notif-${notif.type}`;
  item.setAttribute('role', 'alert');
  item.setAttribute('data-id', notif.id);

  // If clicked, we go to notifications or the specific item
  item.addEventListener('click', (e) => {
    // Only if we didn't click the close button
    if (e.target.closest('.toast-close')) return;
    
    // Smoothly close the toast
    const dismissEvent = new MouseEvent('click', { bubbles: true });
    item.querySelector('.toast-close').dispatchEvent(dismissEvent);

    // Open notifications drawer
    // We can't import openNotifDrawer here safely (circular), 
    // so we use a window-level helper or event.
    if (window.openNotifDrawer) window.openNotifDrawer();
    else if (notif.status) window.openThreadDrawer?.(notif.status.id);
    else if (account) window.openProfileDrawer?.(account.id);
  });

  item.innerHTML = `
    <div class="toast-notif-avatar-wrap">
      <img class="toast-notif-avatar" src="${escapeHTML(avatarUrl)}" alt="" 
           onerror="this.src=window._AVATAR_PLACEHOLDER" />
      <div class="toast-notif-icon-badge toast-notif-icon-${notif.type}">${icon}</div>
    </div>
    <div class="toast-msg-content">
      <div class="toast-notif-who">
        <div class="toast-notif-name">${escapeHTML(displayName)}</div>
        <div class="toast-notif-action">${escapeHTML(label)}</div>
      </div>
      ${preview ? `<div class="toast-notif-preview">${escapeHTML(preview)}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Dismiss">
      <iconify-icon icon="ph:x-bold" style="font-size: 12px;"></iconify-icon>
    </button>
    <div class="toast-progress"></div>
  `;

  region.appendChild(item);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => item.classList.add('toast-show'));
  });

  // Progress/dismiss logic (longer for notifications: 5s)
  const duration = 5000;
  const progress = item.querySelector('.toast-progress');
  progress.style.transition = `transform ${duration}ms linear`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      progress.style.transform = 'scaleX(0)';
    });
  });

  function dismiss() {
    item.classList.add('toast-hiding');
    item.classList.remove('toast-show');
    item.addEventListener('transitionend', () => item.remove(), { once: true });
    setTimeout(() => item.remove(), 400);
  }

  const timer = setTimeout(dismiss, duration);
  item.querySelector('.toast-close').addEventListener('click', (e) => {
    e.stopPropagation();
    clearTimeout(timer);
    dismiss();
  });
}

// Convenience helpers
showToast.success = (msg, duration) => showToast(msg, 'success', duration);
showToast.error = (msg, duration) => showToast(msg, 'error', duration);

/* ── Login error helpers ───────────────────────────────────────────── */

export function showLoginError(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

export function clearLoginError() {
  const el = $('login-error');
  el.style.display = 'none';
  el.textContent = '';
}

/* ── Section error / loading ───────────────────────────────────────── */

export function setError(section, msg) {
  const el = $(`${section}-error`);
  if (msg) {
    el.textContent = msg;
    el.classList.add('visible');
  } else {
    el.classList.remove('visible');
  }
}

export function makeSkeleton(count = 5) {
  return Array.from({ length: count }, () => `
    <div class="skeleton-post">
      <div class="skel-header">
        <div class="skel-avatar"></div>
        <div class="skel-meta">
          <div class="skel-line w-40"></div>
          <div class="skel-line w-60" style="margin-top:4px;height:8px;"></div>
        </div>
      </div>
      <div class="skel-line w-90"></div>
      <div class="skel-line w-80" style="margin-top:5px;"></div>
      <div class="skel-line w-70" style="margin-top:5px;"></div>
    </div>
  `).join('');
}

export function setLoading(section, on) {
  const el = $(`${section}-loading`);
  if (!el) return;
  if (on) {
    $(`${section}-skeleton`).innerHTML = makeSkeleton(5);
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
}

/* ── Tab management ────────────────────────────────────────────────── */

export function isMobileWidth() { return window.innerWidth <= 500; }

const filterLabels = { all: 'All', following: 'Followed Profiles', hashtags: 'Followed Hashtags' };
const filterLabelsMobile = { all: 'All', following: 'Following', hashtags: 'Hashtags' };
const subtabLabels = { posts: 'Trending Posts', hashtags: 'Trending Hashtags', people: 'Trending People', news: 'Trending News', following: 'From Following', live: 'Local Feed', federated: 'Federated Feed' };
const subtabLabelsMobile = { posts: 'Trending', hashtags: 'Hashtags', people: 'People', news: 'News', following: 'Following', live: 'Local', federated: 'Federated' };

export function updateTabLabel(tab) {
  const btn = $(`tab-btn-${tab}`);
  if (!btn) return;
  const label = btn.querySelector('.tab-btn-label');
  const isActive = tab === state.activeTab;
  const mobile = isMobileWidth();

  if (tab === 'feed') {
    if (isActive) {
      const labels = mobile ? filterLabelsMobile : filterLabels;
      label.textContent = `Home · ${labels[state.feedFilter] || 'All'}`;
    } else {
      label.textContent = 'Home';
    }
  } else if (tab === 'explore') {
    if (isActive) {
      const activeSubtab = document.querySelector('#tab-dropdown-explore .tab-dropdown-item.active');
      const subtabName = activeSubtab ? activeSubtab.dataset.subtab : 'posts';
      const labels = mobile ? subtabLabelsMobile : subtabLabels;
      label.textContent = `Explore · ${labels[subtabName] || (mobile ? 'Trending' : 'Trending Posts')}`;
    } else {
      label.textContent = 'Explore';
    }
  }

  const chevron = btn.querySelector('.tab-chevron');
  if (chevron) chevron.style.display = isActive ? '' : 'none';
}

export function closeAllTabDropdowns() {
  document.querySelectorAll('.tab-dropdown').forEach(d => d.classList.remove('show'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('dropdown-open'));
}

let tabSwitchTimeout = null;

export function switchToTab(tab) {
  if (tab === state.activeTab) return;
  closeAllTabDropdowns();

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${tab}`);
  });

  state.activeTab = tab;
  updateTabLabel('feed');
  updateTabLabel('explore');

  clearTimeout(tabSwitchTimeout);
  tabSwitchTimeout = setTimeout(() => {
    _tabLoaders[tab]?.();
  }, 100);

  window.updateSidebarNav?.();
}

/* ── About Modal ───────────────────────────────────────────────────── */

export function openAboutModal() {
  $('about-modal').style.display = 'flex';
}

export function closeAboutModal() {
  $('about-modal').style.display = 'none';
}

/** Set version strings from state.js into the DOM */
export function initVersion() {
  const v = `v${CLIENT_VERSION}`;
  const sidebarEl = $('client-version');
  if (sidebarEl) sidebarEl.textContent = v;
  
  const modalEls = document.querySelectorAll('.about-version-num');
  modalEls.forEach(el => el.textContent = v);
}

/**
 * Modern, premium confirmation modal.
 * @param {string} msg - The message to display.
 * @param {string} title - The title of the modal.
 * @param {string} previewHTML - Optional post snippet / HTML to preview.
 * @returns {Promise<boolean>} - Promise that resolves to true if confirmed, false otherwise.
 */
export function showConfirm(msg, title = 'Are you sure?', previewHTML = '') {
  const modal = document.getElementById('confirm-modal');
  if (!modal) return Promise.resolve(true); // Fallback

  const titleEl = document.getElementById('confirm-modal-title');
  const msgEl = document.getElementById('confirm-modal-msg');
  const previewEl = document.getElementById('confirm-modal-preview');
  const cancelBtn = document.getElementById('confirm-modal-cancel');
  const confirmBtn = document.getElementById('confirm-modal-confirm');
  const content = modal.querySelector('.modal-content');

  titleEl.textContent = title;
  msgEl.textContent = msg;

  if (previewEl) {
    if (previewHTML) {
      previewEl.innerHTML = previewHTML;
      previewEl.style.display = 'block';
    } else {
      previewEl.style.display = 'none';
    }
  }

  modal.style.display = 'flex';
  // Double-RAF ensures the browser has rendered the display: flex state before we animate opacity/scale
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      modal.style.opacity = '1';
      if (content) {
        content.style.transform = 'scale(1)';
        content.style.opacity = '1';
      }
    });
  });

  return new Promise((resolve) => {
    const cleanup = (result) => {
      modal.style.opacity = '0';
      if (content) content.style.transform = 'scale(0.92)';
      setTimeout(() => {
        modal.style.display = 'none';
        resolve(result);
      }, 200);
    };

    confirmBtn.onclick = (e) => { e.stopPropagation(); cleanup(true); };
    cancelBtn.onclick = (e) => { e.stopPropagation(); cleanup(false); };
    modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
  });
}
