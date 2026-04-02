/**
 * @module ui
 * Screen management, toast notifications, loading states, tab helpers.
 *
 * Tab-loader functions (loadFeedTab, loadExploreTab) are registered at
 * boot time from app.js via registerTabLoader() to avoid circular imports.
 */

import { $, state, CLIENT_VERSION } from './state.js';

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
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
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
  closeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

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
  closeBtn.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
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
