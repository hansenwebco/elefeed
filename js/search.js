/**
 * @module search
 * Full-text search using the Mastodon /api/v2/search endpoint.
 * Supports searching accounts, hashtags, and statuses with
 * infinite scroll pagination for post results.
 */

import { state } from './state.js';
import { apiGet } from './api.js';
import {
  escapeHTML, sanitizeHTML,
  renderCustomEmojis, relativeTime,
} from './utils.js';

/* ══════════════════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════════════════ */

let _debounceTimer = null;
let _currentQuery = '';
let _activeFilter = 'all'; // 'all' | 'accounts' | 'hashtags' | 'statuses'
let _abortCtrl = null;

// Post pagination
let _statusOffset = 0;
let _hasMorePosts = false;
let _loadingMore = false;
let _scrollObserver = null;  // IntersectionObserver watching the sentinel

const STATUS_PAGE = 20;    // results per page

/* ══════════════════════════════════════════════════════════════════════
   DRAWER OPEN / CLOSE
   ══════════════════════════════════════════════════════════════════════ */

export function openSearchDrawer() {
  const drawer = document.getElementById('search-drawer');
  const backdrop = document.getElementById('search-backdrop');
  if (!drawer) return;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  if (backdrop) backdrop.classList.add('open');

  history.pushState({ searchDrawer: true }, '');

  const input = document.getElementById('search-input');
  if (input) setTimeout(() => input.focus(), 120);
}

export function closeSearchDrawer() {
  const drawer = document.getElementById('search-drawer');
  const backdrop = document.getElementById('search-backdrop');
  if (!drawer) return;

  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  if (backdrop) backdrop.classList.remove('open');

  _disconnectObserver();
}

/* ══════════════════════════════════════════════════════════════════════
   SEARCH API
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Fresh search — resets pagination and replaces results.
 */
async function performSearch(query, filter) {
  if (!query || query.length < 2) { renderEmpty(); return; }

  // Cancel any in-flight request
  if (_abortCtrl) _abortCtrl.abort();
  _abortCtrl = new AbortController();

  // Reset pagination state
  _statusOffset = 0;
  _hasMorePosts = false;
  _disconnectObserver();

  showLoading();

  const typeParam = filter === 'all' ? '' : `&type=${filter}`;
  const url = `/api/v2/search?q=${encodeURIComponent(query)}&limit=${STATUS_PAGE}&resolve=true${typeParam}`;

  try {
    const data = await apiGet(url, state.token, state.server, _abortCtrl.signal);
    _statusOffset = data.statuses ? data.statuses.length : 0;
    // If we got a full page of statuses, there may be more
    _hasMorePosts = (filter === 'all' || filter === 'statuses')
      && data.statuses && data.statuses.length === STATUS_PAGE;
    renderResults(data, query, filter);
    if (_hasMorePosts) _attachObserver(query, filter);
  } catch (err) {
    if (err.name === 'AbortError') return;
    renderError(err.message);
  }
}

/**
 * Load the next page of post results and append them.
 */
async function loadMorePosts(query, filter) {
  if (_loadingMore || !_hasMorePosts) return;
  _loadingMore = true;

  const sentinel = document.getElementById('search-sentinel');
  if (sentinel) sentinel.innerHTML = `
      <div class="search-loading-more">
        <div class="spinner"></div>
        <span>Loading more…</span>
      </div>`;

  const typeParam = filter === 'all' || filter === 'statuses' ? '&type=statuses' : '';
  const url = `/api/v2/search?q=${encodeURIComponent(query)}&limit=${STATUS_PAGE}&offset=${_statusOffset}&resolve=true${typeParam}`;

  try {
    const ctrl = new AbortController();
    const data = await apiGet(url, state.token, state.server, ctrl.signal);
    const newStatuses = data.statuses || [];

    _statusOffset += newStatuses.length;
    _hasMorePosts = newStatuses.length === STATUS_PAGE;

    if (newStatuses.length > 0) {
      appendPosts(newStatuses);
    }

    // Update or remove sentinel
    const sent = document.getElementById('search-sentinel');
    if (sent) {
      if (_hasMorePosts) {
        sent.innerHTML = ''; // empty — observer will trigger again
      } else {
        sent.innerHTML = `<div class="search-end-of-results">— end of results —</div>`;
        _disconnectObserver();
      }
    }
  } catch (err) {
    const sent = document.getElementById('search-sentinel');
    if (sent) sent.innerHTML = '';
  } finally {
    _loadingMore = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   INTERSECTION OBSERVER (infinite scroll trigger)
   ══════════════════════════════════════════════════════════════════════ */

function _attachObserver(query, filter) {
  _disconnectObserver();
  const sentinel = document.getElementById('search-sentinel');
  if (!sentinel) return;

  _scrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !_loadingMore) {
      loadMorePosts(query, filter);
    }
  }, {
    root: document.querySelector('.search-drawer-body'),
    rootMargin: '120px',   // start loading 120px before reaching the bottom
    threshold: 0,
  });

  _scrollObserver.observe(sentinel);
}

function _disconnectObserver() {
  if (_scrollObserver) {
    _scrollObserver.disconnect();
    _scrollObserver = null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   RENDERING
   ══════════════════════════════════════════════════════════════════════ */

function showLoading() {
  const body = document.getElementById('search-results');
  if (!body) return;
  body.innerHTML = `
    <div class="search-loading">
      <div class="spinner"></div>
    </div>`;
}

function renderEmpty() {
  const body = document.getElementById('search-results');
  if (!body) return;
  body.innerHTML = `
    <div class="search-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <p>Type to search profiles, posts, and hashtags</p>
    </div>`;
}

function renderError(msg) {
  const body = document.getElementById('search-results');
  if (!body) return;
  body.innerHTML = `<div class="search-error">Search failed: ${escapeHTML(msg)}</div>`;
}

function renderResults(data, query, filter) {
  const body = document.getElementById('search-results');
  if (!body) return;

  const { accounts = [], statuses = [], hashtags = [] } = data;
  const hasAny = accounts.length || statuses.length || hashtags.length;

  if (!hasAny) {
    body.innerHTML = `
      <div class="search-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p>No results for <strong>${escapeHTML(query)}</strong></p>
      </div>`;
    return;
  }

  let html = '';

  // ── Profiles ──────────────────────────────────────────────────────────
  if ((filter === 'all' || filter === 'accounts') && accounts.length) {
    html += `
      <div class="search-section">
        <div class="search-section-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <span>Profiles</span>
        </div>
        ${accounts.slice(0, filter === 'all' ? 3 : 20).map(a => renderAccount(a)).join('')}
        ${filter === 'all' && accounts.length > 3 ? `
          <button class="search-see-all" data-filter="accounts">See all ${accounts.length} profiles →</button>
        ` : ''}
      </div>`;
  }

  // ── Hashtags ──────────────────────────────────────────────────────────
  if ((filter === 'all' || filter === 'hashtags') && hashtags.length) {
    html += `
      <div class="search-section">
        <div class="search-section-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
            <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
          </svg>
          <span>Hashtags</span>
        </div>
        ${hashtags.slice(0, filter === 'all' ? 4 : 30).map(h => renderHashtag(h)).join('')}
        ${filter === 'all' && hashtags.length > 4 ? `
          <button class="search-see-all" data-filter="hashtags">See all hashtags →</button>
        ` : ''}
      </div>`;
  }

  // ── Posts ──────────────────────────────────────────────────────────────
  if ((filter === 'all' || filter === 'statuses') && statuses.length) {
    const showLimit = filter === 'all' ? 5 : STATUS_PAGE;
    html += `
      <div class="search-section" id="search-posts-section">
        <div class="search-section-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>Posts</span>
        </div>
        <div id="search-posts-list">
          ${statuses.slice(0, showLimit).map(s => renderStatus(s)).join('')}
        </div>
        ${filter === 'all' && statuses.length > 5 ? `
          <button class="search-see-all" data-filter="statuses">See all posts →</button>
        ` : filter === 'statuses' ? `
          <div id="search-sentinel"></div>
        ` : ''}
      </div>`;
  }

  body.innerHTML = html || `<div class="search-empty"><p>No results</p></div>`;
}

/**
 * Append additional post rows to the existing posts list (pagination).
 */
function appendPosts(statuses) {
  const list = document.getElementById('search-posts-list');
  if (!list) return;
  const frag = document.createDocumentFragment();
  statuses.forEach(s => {
    const div = document.createElement('div');
    div.innerHTML = renderStatus(s);
    while (div.firstChild) frag.appendChild(div.firstChild);
  });
  list.appendChild(frag);
}

/* ──── Individual item renderers ──────────────────────────────────── */

function renderAccount(account) {
  const server = escapeHTML(state.server || '');
  const displayName = renderCustomEmojis(
    account.display_name || account.username,
    account.emojis
  );
  const followersNum = new Intl.NumberFormat().format(account.followers_count || 0);

  return `
    <div class="search-account-row" data-profile-id="${account.id}" data-profile-server="${server}" style="cursor:pointer;">
      <img class="search-account-avatar" src="${escapeHTML(account.avatar_static || account.avatar)}" alt="" loading="lazy" />
      <div class="search-account-info">
        <div class="search-account-name">${displayName}</div>
        <div class="search-account-acct">@${escapeHTML(account.acct)}</div>
        ${account.note ? `<div class="search-account-bio">${sanitizeHTML(account.note)}</div>` : ''}
      </div>
      <div class="search-account-meta">
        <span class="search-account-followers">${followersNum} followers</span>
      </div>
    </div>`;
}

function renderHashtag(tag) {
  const recentPosts = tag.history && tag.history.length
    ? tag.history.reduce((sum, h) => sum + (parseInt(h.uses) || 0), 0)
    : null;
  const trend = buildHashtagSparkline(tag.history);

  return `
    <div class="search-hashtag-row" data-hashtag="${escapeHTML(tag.name)}" style="cursor:pointer;">
      <div class="search-hashtag-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
          <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
        </svg>
      </div>
      <div class="search-hashtag-info">
        <div class="search-hashtag-name">#${escapeHTML(tag.name)}</div>
        ${recentPosts !== null ? `<div class="search-hashtag-uses">${recentPosts.toLocaleString()} posts this week</div>` : ''}
      </div>
      ${trend ? `<div class="search-hashtag-sparkline">${trend}</div>` : ''}
    </div>`;
}

function buildHashtagSparkline(history) {
  if (!history || history.length < 2) return '';
  const values = [...history].reverse().map(h => parseInt(h.uses) || 0);
  const max = Math.max(...values, 1);
  const W = 60, H = 28, pts = values.length;
  const points = values.map((v, i) => {
    const x = (i / (pts - 1)) * W;
    const y = H - (v / max) * (H - 4) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polyline fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${points}"/>
  </svg>`;
}

function renderStatus(status) {
  const s = status.reblog || status;
  const server = escapeHTML(state.server || '');
  const rawContent = s.content ? sanitizeHTML(s.content) : '';
  const textContent = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const preview = textContent.length > 140 ? textContent.slice(0, 140) + '…' : textContent;

  const hasMedia = s.media_attachments && s.media_attachments.length > 0;
  const mediaPreview = hasMedia ? `
    <div class="search-status-media">
      ${s.media_attachments.slice(0, 2).map(m => `
        <img src="${escapeHTML(m.preview_url || m.url)}" alt="" class="search-status-thumb" loading="lazy" />
      `).join('')}
    </div>` : '';

  return `
    <div class="search-status-row" data-status-id="${s.id}" style="cursor:pointer;">
      <div class="search-status-header">
        <img class="search-status-avatar" src="${escapeHTML(s.account.avatar_static || s.account.avatar)}" alt=""
          data-profile-id="${s.account.id}" data-profile-server="${server}" style="cursor:pointer;" loading="lazy" />
        <div class="search-status-author">
          <span class="search-status-name" data-profile-id="${s.account.id}" data-profile-server="${server}"
            style="cursor:pointer;">${renderCustomEmojis(s.account.display_name || s.account.username, s.account.emojis)}</span>
          <span class="search-status-acct">@${escapeHTML(s.account.acct)}</span>
        </div>
        <span class="search-status-time">${relativeTime(s.created_at)}</span>
      </div>
      ${s.spoiler_text ? `<div class="search-status-cw">CW: ${escapeHTML(s.spoiler_text)}</div>` : ''}
      <div class="search-status-preview">${escapeHTML(preview)}</div>
      ${mediaPreview}
      <div class="search-status-footer">
        <span class="search-status-stat">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 10l5-5v3c8 0 13 4 13 11-3-4-7-5-13-5v3l-5-5z"/>
          </svg>
          ${s.replies_count || 0}
        </span>
        <span class="search-status-stat">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--boost)">
            <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
          ${s.reblogs_count || 0}
        </span>
        <span class="search-status-stat">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="${s.favourited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" style="color:var(--fav)">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          ${s.favourites_count || 0}
        </span>
        <a href="${escapeHTML(s.url)}" target="_blank" rel="noopener" class="search-status-link"
          onclick="event.stopPropagation();">↗</a>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════════════ */

export function initSearch() {
  const drawer = document.getElementById('search-drawer');
  const backdrop = document.getElementById('search-backdrop');
  const closeBtn = document.getElementById('search-close');
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');
  const filterBtns = document.querySelectorAll('.search-filter-btn');
  const results = document.getElementById('search-results');

  if (!drawer || !input) return;

  // Close handlers
  if (closeBtn) closeBtn.addEventListener('click', closeSearchDrawer);
  if (backdrop) backdrop.addEventListener('click', closeSearchDrawer);

  // Input → debounced search (400ms — comfortable pause before firing)
  input.addEventListener('input', () => {
    const q = input.value.trim();
    _currentQuery = q;
    if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
    clearTimeout(_debounceTimer);
    if (!q) { renderEmpty(); return; }
    _debounceTimer = setTimeout(() => performSearch(q, _activeFilter), 400);
  });

  // Clear button
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      _currentQuery = '';
      clearBtn.style.display = 'none';
      _disconnectObserver();
      renderEmpty();
      input.focus();
    });
  }

  // Enter key — fire immediately, skip debounce
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSearchDrawer(); return; }
    if (e.key === 'Enter') {
      clearTimeout(_debounceTimer);
      const q = input.value.trim();
      if (q) performSearch(q, _activeFilter);
    }
  });

  // Filter tabs
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activeFilter = btn.dataset.filter;
      if (_currentQuery) performSearch(_currentQuery, _activeFilter);
    });
  });

  // Delegation for search results interactions
  results.addEventListener('click', e => {
    // "See all" buttons
    const seeAll = e.target.closest('.search-see-all');
    if (seeAll) {
      const f = seeAll.dataset.filter;
      filterBtns.forEach(b => b.classList.toggle('active', b.dataset.filter === f));
      _activeFilter = f;
      if (_currentQuery) performSearch(_currentQuery, _activeFilter);
      return;
    }

    // Hashtag row → load hashtag feed
    const hashtagRow = e.target.closest('.search-hashtag-row');
    if (hashtagRow) {
      const tag = hashtagRow.dataset.hashtag;
      if (tag) {
        window.__searchHashtagClick && window.__searchHashtagClick(tag);
        closeSearchDrawer();
      }
      return;
    }

    // Status row → open thread
    const statusRow = e.target.closest('.search-status-row');
    if (statusRow && !e.target.closest('[data-profile-id]') && !e.target.closest('.search-status-link')) {
      const id = statusRow.dataset.statusId;
      if (id) {
        window.__searchOpenThread && window.__searchOpenThread(id);
        closeSearchDrawer();
      }
      return;
    }
  });

  // Initial empty state
  renderEmpty();
}
