/**
 * @module analytics
 * Post analytics drawer - shows who replied, boosted, or favourited a focal post.
 * Opened via the bar-chart icon on the root (focal) post in a thread.
 */

import { $, state } from './state.js';
import { apiGet } from './api.js';
import { escapeHTML, renderCustomEmojis } from './utils.js';

/* ── Open / close ──────────────────────────────────────────────────── */

export function openPostAnalyticsDrawer(postId, type) {
  const backdrop = $('post-analytics-backdrop');
  const drawer = $('post-analytics-drawer');
  if (!backdrop || !drawer) return;

  // Push a history entry so the back button closes this drawer
  history.pushState({ drawer: 'post-analytics-drawer' }, '', '');

  backdrop.classList.add('open');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  loadAnalyticsUsers(postId, type);
}

export function closePostAnalyticsDrawer() {
  const backdrop = $('post-analytics-backdrop');
  const drawer = $('post-analytics-drawer');
  if (!backdrop || !drawer) return;

  backdrop.classList.remove('open');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';

  if (_analyticsObserver) { _analyticsObserver.disconnect(); _analyticsObserver = null; }
}

/* ── Load + render users ───────────────────────────────────────────── */

async function loadAnalyticsUsers(postId, type) {
  const content = $('post-analytics-content');
  const titleEl = $('post-analytics-title');

  const titleMap = { replies: 'Replied', boosts: 'Boosted', favs: 'Favorited' };
  if (titleEl) titleEl.textContent = titleMap[type] || 'Interactions';
  if (content) content.innerHTML = '<div class="analytics-loading"><div class="spinner"></div></div>';

  try {
    let accounts = [];

    if (type === 'replies') {
      // Fetch thread context and extract direct repliers to this post
      const context = await apiGet(`/api/v1/statuses/${postId}/context`, state.token);
      const seen = new Set();
      for (const st of (context.descendants || [])) {
        if (st.in_reply_to_id === postId && !seen.has(st.account.id)) {
          seen.add(st.account.id);
          accounts.push(st.account);
        }
      }
    } else if (type === 'boosts') {
      accounts = await apiGet(`/api/v1/statuses/${postId}/reblogged_by?limit=80`, state.token);
    } else if (type === 'favs') {
      accounts = await apiGet(`/api/v1/statuses/${postId}/favourited_by?limit=80`, state.token);
    }

    if (!accounts.length) {
      const emptyMsg = {
        replies: 'No replies yet.',
        boosts: 'No boosts yet.',
        favs: 'No favorites yet.',
      };
      if (content) content.innerHTML = `<div class="analytics-empty">${emptyMsg[type] || 'Nothing yet.'}</div>`;
      return;
    }

    // Batch-fetch relationships (max 40 per request)
    const relMap = {};
    const chunkSize = 40;
    for (let i = 0; i < accounts.length; i += chunkSize) {
      const chunk = accounts.slice(i, i + chunkSize);
      const rels = await apiGet(
        `/api/v1/accounts/relationships?${chunk.map(a => `id[]=${a.id}`).join('&')}`,
        state.token
      ).catch(() => []);
      for (const r of rels) relMap[r.id] = r;
    }

    const html = accounts.map(acc => renderAnalyticsUserRow(acc, relMap[acc.id])).join('');
    // Show a load-more button if the full page was returned (may be more pages)
    const hasMore = (type === 'boosts' || type === 'favs') && accounts.length === 80;
    const lastId = hasMore ? accounts[accounts.length - 1].id : null;
    const loadMoreHTML = hasMore
      ? `<button class="load-more-btn analytics-load-more-btn"
          data-post-id="${postId}"
          data-action="${type}"
          data-max-id="${lastId}">Load more</button>`
      : '';
    if (content) content.innerHTML = `<div class="analytics-user-list">${html}</div>${loadMoreHTML}`;
    if (hasMore) _observeAnalyticsLoadMore();
  } catch (err) {
    if (content) content.innerHTML = `<div class="analytics-empty" style="color:var(--danger);">Failed to load: ${escapeHTML(err.message)}</div>`;
  }
}

/* ── Infinite-scroll observer ──────────────────────────────────────── */

let _analyticsObserver = null;

function _observeAnalyticsLoadMore() {
  const content = $('post-analytics-content');
  if (!content) return;
  const btn = content.querySelector('.analytics-load-more-btn');
  if (!btn) return;

  if (_analyticsObserver) _analyticsObserver.disconnect();
  _analyticsObserver = new IntersectionObserver(
    entries => entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.disabled) appendMoreAnalyticsUsers(entry.target);
    }),
    { root: content, rootMargin: '400px' }
  );
  _analyticsObserver.observe(btn);
}

/* ── Append next page of users ─────────────────────────────────────── */

export async function appendMoreAnalyticsUsers(btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Loading…';

  const postId = btn.dataset.postId;
  const type = btn.dataset.action;
  const maxId = btn.dataset.maxId;

  try {
    let accounts = [];
    if (type === 'boosts') {
      accounts = await apiGet(`/api/v1/statuses/${postId}/reblogged_by?limit=80&max_id=${maxId}`, state.token);
    } else if (type === 'favs') {
      accounts = await apiGet(`/api/v1/statuses/${postId}/favourited_by?limit=80&max_id=${maxId}`, state.token);
    }

    if (accounts.length) {
      const relMap = {};
      for (let i = 0; i < accounts.length; i += 40) {
        const chunk = accounts.slice(i, i + 40);
        const rels = await apiGet(
          `/api/v1/accounts/relationships?${chunk.map(a => `id[]=${a.id}`).join('&')}`,
          state.token
        ).catch(() => []);
        for (const r of rels) relMap[r.id] = r;
      }
      const html = accounts.map(acc => renderAnalyticsUserRow(acc, relMap[acc.id])).join('');
      const list = btn.previousElementSibling;
      if (list) list.insertAdjacentHTML('beforeend', html);
    }

    if (accounts.length === 80) {
      // More pages remain - update cursor and re-observe
      btn.dataset.maxId = accounts[accounts.length - 1].id;
      btn.textContent = 'Load more';
      btn.disabled = false;
      _observeAnalyticsLoadMore();
    } else {
      // Reached the end
      if (_analyticsObserver) { _analyticsObserver.disconnect(); _analyticsObserver = null; }
      btn.remove();
    }
  } catch (err) {
    btn.textContent = 'Try again';
    btn.disabled = false;
  }
}

/* ── Single user row ───────────────────────────────────────────────── */

function renderAnalyticsUserRow(account, relationship) {
  const isSelf = state.account && state.account.id === account.id;
  const isFollowing = relationship?.following;
  const followedBy = relationship?.followed_by;
  const isRequested = relationship?.requested;
  const isLocked = account.locked;
  const profileServer = escapeHTML(state.server || '');

  let followBtnHTML = '';
  if (!isSelf) {
    let btnText;
    let btnClass = 'analytics-follow-btn profile-follow-btn';

    if (isFollowing) {
      btnText = 'Following';
      btnClass += ' following';
    } else if (isRequested) {
      btnText = 'Requested';
      btnClass += ' requested';
    } else if (followedBy) {
      btnText = 'Follow back';
    } else if (isLocked) {
      btnText = 'Request';
    } else {
      btnText = 'Follow';
    }

    followBtnHTML = `<button class="${btnClass}"
      data-account-id="${account.id}"
      data-following="${isFollowing ? 'true' : 'false'}"
      title="${btnText}">${btnText}</button>`;
  }

  const followsYouBadge = followedBy
    ? `<span class="analytics-follows-you">Follows you</span>`
    : '';

  const lockIcon = isLocked
    ? `<svg class="analytics-lock-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="Locked account"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
    : '';

  return `<div class="analytics-user-row">
    <div class="post-avatar analytics-user-avatar"
      data-profile-id="${account.id}"
      data-profile-server="${profileServer}"
      style="cursor:pointer;width:44px;height:44px;flex-shrink:0;">
      <img src="${escapeHTML(account.avatar_static || account.avatar)}" alt="" loading="lazy" />
      ${state.knownFollowing.has(account.id) ? `<div class="following-badge" title="Following">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
      </div>` : ''}
    </div>
    <div class="analytics-user-info">
      <div class="analytics-user-name"
        data-profile-id="${account.id}"
        data-profile-server="${profileServer}"
        style="cursor:pointer;">
        ${renderCustomEmojis(account.display_name || account.username, account.emojis)}${lockIcon}
      </div>
      <div class="analytics-user-acct">@${escapeHTML(account.acct)}${followsYouBadge}</div>
    </div>
    ${followBtnHTML}
  </div>`;
}
