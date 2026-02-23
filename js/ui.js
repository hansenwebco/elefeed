/**
 * @module ui
 * Screen management, toast notifications, loading states, tab helpers.
 *
 * Tab-loader functions (loadFeedTab, loadExploreTab) are registered at
 * boot time from app.js via registerTabLoader() to avoid circular imports.
 */

import { $, state } from './state.js';

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

export function showToast(msg, duration = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

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
const subtabLabels = { posts: 'Trending Posts', hashtags: 'Trending Hashtags', people: 'Trending People', news: 'Trending News' };
const subtabLabelsMobile = { posts: 'Trending', hashtags: 'Hashtags', people: 'People', news: 'News' };

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
