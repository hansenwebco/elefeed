// Utility to render or update the follow/mutual label in the profile banner
function renderProfileBannerFollowLabel(relationship) {
  const headerWrap = document.querySelector('.profile-header-img-wrap');
  if (!headerWrap) return;
  let label = headerWrap.querySelector('.profile-banner-follow-label');
  // Determine label text
  let text = '';
  if (relationship) {
    if (relationship.following && relationship.followed_by) {
      text = 'Following Each Other';
    } else if (relationship.followed_by) {
      text = 'Following You';
    }
  }
  if (text) {
    if (!label) {
      label = document.createElement('div');
      label.className = 'profile-banner-follow-label';
      headerWrap.appendChild(label);
    }
    label.textContent = text;
  } else if (label) {
    label.remove();
  }
}

// Toggle profile more menu visibility
export function toggleProfileMoreMenu(btn) {
  const accountId = btn.dataset.accountId;
  const menu = document.querySelector(`.profile-more-menu[data-account-id="${accountId}"]`);
  if (!menu) return;
  
  // Close any other open menus
  document.querySelectorAll('.profile-more-menu.open').forEach(m => {
    if (m !== menu) m.classList.remove('open');
  });
  
  menu.classList.toggle('open');
}

// Close all profile more menus
export function closeAllProfileMoreMenus() {
  document.querySelectorAll('.profile-more-menu.open').forEach(m => m.classList.remove('open'));
}

/**
 * @module profile
 * Profile drawer — loads and renders a user's profile, statuses, pinned posts.
 * Also contains the bookmarks drawer and follow/notify/hashtag-follow toggles.
 */

import { $, state } from './state.js';
import { apiGet } from './api.js';
import { showToast } from './ui.js';
import { renderPost } from './render.js';
import {
  escapeHTML, sanitizeHTML, renderCustomEmojis, formatNum, updateURLParam,
} from './utils.js';

/* ── Profile pagination state ──────────────────────────────────────── */

const profilePagination = {
  accountId: null,
  server: null,
  posts: { maxId: null, loading: false },
  replies: { maxId: null, loading: false },
  media: { maxId: null, loading: false },
};

// Cache rendered profile so reopening the same profile is instant (TTL 5 min)
const _profileCache = { accountId: null, ts: 0, scrollTop: 0 };
const PROFILE_CACHE_TTL = 5 * 60 * 1000;

let profileScrollListenerAttached = false;

function checkProfileInfiniteScroll() {
  const inner = document.querySelector('.profile-drawer-inner');
  if (!inner) return;
  const activePanel = inner.querySelector('.profile-tab-panel:not([hidden])') || inner;
  const btn = activePanel.querySelector('.load-more-btn[data-feed="profile"]');
  if (!btn || btn.disabled) return;
  const rect = btn.getBoundingClientRect();
  const innerRect = inner.getBoundingClientRect();
  if (rect.top <= innerRect.bottom + 600) {
    loadMoreProfilePosts(btn);
  }
}

function attachProfileScrollListener() {
  if (profileScrollListenerAttached) return;
  profileScrollListenerAttached = true;
  const inner = document.querySelector('.profile-drawer-inner');
  if (!inner) return;
  let raf = null;
  inner.addEventListener('scroll', () => {
    if (!raf) {
      raf = requestAnimationFrame(() => {
        checkProfileInfiniteScroll();
        raf = null;
      });
    }
  }, { passive: true });
}

function renderMediaItem(status) {
  const s = status.reblog || status;
  const attachments = (s.media_attachments || []).filter(
    m => m.type === 'image' || m.type === 'video' || m.type === 'gifv'
  );
  if (!attachments.length) return '';
  return attachments.map(att => {
    const isVideo = att.type === 'video' || att.type === 'gifv';
    const thumb = escapeHTML(att.preview_url || att.url);
    const fullUrl = escapeHTML(att.url);
    const altText = (att.description || '').replace(/"/g, '&quot;');
    return `<div class="media-item profile-media-item"
      data-full-url="${fullUrl}"
      data-type="${att.type}"
      data-alt="${altText}"
      data-post-id="${escapeHTML(s.id)}"
      data-account-acct="${escapeHTML(s.account.acct)}"
      data-post-url="${escapeHTML(s.url || '')}"
      data-reblogged="${s.reblogged ? 'true' : 'false'}"
      data-favourited="${s.favourited ? 'true' : 'false'}"
      data-reblogs-count="${s.reblogs_count || 0}"
      data-quotes-count="${s.quotes_count || 0}"
      data-favourites-count="${s.favourites_count || 0}"
      data-replies-count="${s.replies_count || 0}"
      data-can-quote="${(!s.quote_approval || s.quote_approval.current_user !== 'denied') && s.visibility !== 'private' && s.visibility !== 'direct' ? 'true' : 'false'}"
      onclick="expandMedia(this)">
      <img src="${thumb}" alt="" loading="lazy"/>
      ${isVideo ? '<div class="profile-media-play"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg></div>' : ''}
    </div>`;
  }).join('');
}

async function loadProfileTab(tabName, panel) {
  if (panel.dataset.loaded) return;
  panel.innerHTML = '<div class="profile-loading"><div class="spinner"></div></div>';
  const { accountId, server } = profilePagination;
  const tabState = profilePagination[tabName];
  let url;
  if (tabName === 'replies') {
    url = `/api/v1/accounts/${accountId}/statuses?limit=20`;
  } else if (tabName === 'media') {
    url = `/api/v1/accounts/${accountId}/statuses?limit=20&only_media=true`;
  } else return;

  try {
    const statuses = await apiGet(url, state.token, server);
    tabState.maxId = statuses.length ? statuses[statuses.length - 1].id : null;
    panel.dataset.loaded = 'true';
    const loadMoreHtml = (statuses.length === 20 && tabState.maxId)
      ? `<button class="load-more-btn" data-feed="profile" data-tab="${tabName}">Load More</button>`
      : '';
    if (tabName === 'media') {
      panel.innerHTML = statuses.length
        ? `<div class="profile-media-grid">${statuses.map(s => renderMediaItem(s)).join('')}</div>${loadMoreHtml}`
        : '<div class="feed-status"><p style="font-size:13px;">No media yet.</p></div>';
    } else {
      panel.innerHTML = statuses.length
        ? statuses.map(s => renderPost(s)).join('') + loadMoreHtml
        : '<div class="feed-status"><p style="font-size:13px;">No posts yet.</p></div>';
    }
  } catch (err) {
    panel.innerHTML = '<div class="feed-status"><p style="font-size:13px;color:var(--danger);">Failed to load.</p></div>';
  }
}

export async function loadMoreProfilePosts(btn) {
  const tabName = btn.dataset.tab || 'posts';
  const tabState = profilePagination[tabName];
  if (!tabState || tabState.loading || !tabState.maxId) return;
  tabState.loading = true;
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    const { accountId, server } = profilePagination;
    let url = `/api/v1/accounts/${accountId}/statuses?limit=20&max_id=${tabState.maxId}`;
    if (tabName === 'posts') url += '&exclude_replies=true';
    if (tabName === 'media') url += '&only_media=true';

    const newPosts = await apiGet(url, state.token, server);
    tabState.maxId = newPosts.length ? newPosts[newPosts.length - 1].id : null;

    const container = btn.parentNode;
    if (!container) return;

    if (tabName === 'media') {
      const grid = container.querySelector('.profile-media-grid');
      if (grid) {
        const html = newPosts.map(s => renderMediaItem(s)).join('');
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        while (tmp.firstChild) grid.appendChild(tmp.firstChild);
      }
    } else {
      const html = newPosts.map(s => renderPost(s)).join('');
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      while (tmp.firstChild) container.insertBefore(tmp.firstChild, btn);
    }

    if (!tabState.maxId) {
      btn.remove();
    } else {
      btn.disabled = false;
      btn.textContent = 'Load More';
      // Check again in case more content is still in view
      setTimeout(checkProfileInfiniteScroll, 100);
    }
  } catch (err) {
    showToast('Failed to load more: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Load More';
  } finally {
    tabState.loading = false;
  }
}

/* ── Open / close ──────────────────────────────────────────────────── */

export function openProfileDrawer(accountId, server) {
  const drawer = $('profile-drawer');
  const backdrop = $('profile-backdrop');
  const content = $('profile-content');

  // Reuse cached profile if it's the same account and still fresh
  const cacheHit = _profileCache.accountId === accountId &&
    (Date.now() - _profileCache.ts) < PROFILE_CACHE_TTL &&
    content.querySelector('.profile-tabs'); // content is actually rendered

  if (cacheHit) {
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    updateURLParam('profile', accountId, true);
    const inner = drawer.querySelector('.profile-drawer-inner');
    if (inner && _profileCache.scrollTop > 0) {
      requestAnimationFrame(() => { inner.scrollTop = _profileCache.scrollTop; });
    }
    // scroll listener may have been detached — recheck
    if (!profileScrollListenerAttached) attachProfileScrollListener();
    setTimeout(checkProfileInfiniteScroll, 200);
    return;
  }

  content.innerHTML = '<div class="profile-loading"><div class="spinner"></div></div>';
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Update URL state
  updateURLParam('profile', accountId, true);

  const srv = server || state.server;

  // Reset pagination state for this profile
  profilePagination.accountId = accountId;
  profilePagination.server = srv;
  profilePagination.posts.maxId = null;
  profilePagination.posts.loading = false;
  profilePagination.replies.maxId = null;
  profilePagination.replies.loading = false;
  profilePagination.media.maxId = null;
  profilePagination.media.loading = false;
  profileScrollListenerAttached = false;

  Promise.all([
    apiGet(`/api/v1/accounts/${accountId}`, state.token, srv),
    apiGet(`/api/v1/accounts/${accountId}/statuses?limit=20&exclude_replies=true`, state.token, srv),
    apiGet(`/api/v1/accounts/relationships?id[]=${accountId}`, state.token, srv).catch(() => []),
    apiGet(`/api/v1/accounts/${accountId}/statuses?pinned=true`, state.token, srv).catch(() => []),
  ]).then(([account, statuses, relationships, pinnedStatuses]) => {
    const relationship = relationships && relationships.length ? relationships[0] : null;
    const isFollowing = relationship && relationship.following;

    // Profile banner (label will be rendered after DOM insert)
    let headerImg = '';
    if (account.header && !account.header.includes('missing')) {
      headerImg = `
        <div class="profile-header-img-wrap">
          <img class="profile-header-img" src="${escapeHTML(account.header)}" alt="" loading="lazy"/>
        </div>
      `;
    } else {
      headerImg = `
        <div class="profile-header-img-wrap">
          <div class="profile-header-img empty"></div>
        </div>
      `;
    }

    const bio = account.note ? `<div class="profile-bio">${account.note}</div>` : '';

    const isSelf = state.account && state.account.id === accountId;
    const isNotifying = relationship && relationship.notifying;
    const isBlocked = relationship && relationship.blocking;
    const isMuted = relationship && relationship.muting;

    const notifyButton = !isSelf
      ? `<button class="profile-notify-btn ${isNotifying ? 'notifying' : ''}"
          data-account-id="${accountId}" data-notifying="${isNotifying ? 'true' : 'false'}"
          title="${isNotifying ? 'Stop post notifications' : 'Get notified about posts'}"
          style="${isFollowing ? '' : 'display: none;'}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${isNotifying ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>`
      : '';

    const moreMenu = !isSelf
      ? `<div class="profile-more-menu-wrapper">
          <button class="profile-more-menu-btn" data-account-id="${accountId}" title="More options">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          </button>
          <div class="profile-more-menu" data-account-id="${accountId}">
            <button class="profile-mute-btn ${isMuted ? 'muted' : ''}"
              data-account-id="${accountId}" data-muted="${isMuted ? 'true' : 'false'}"
              title="${isMuted ? 'Unmute user' : 'Mute user'}">
              ${isMuted ? '✓ Muted' : 'Mute user'}</button>
            <button class="profile-block-btn ${isBlocked ? 'blocked' : ''}"
              data-account-id="${accountId}" data-blocked="${isBlocked ? 'true' : 'false'}"
              title="${isBlocked ? 'Unblock user' : 'Block user'}">
              ${isBlocked ? '✓ Blocked' : 'Block user'}</button>
          </div>
        </div>`
      : '';

    const followButton = isSelf
      ? `<a class="profile-edit-btn" href="https://${srv}/settings/profile" target="_blank" rel="noopener">Edit Profile</a>`
      : `<button class="profile-follow-btn ${isFollowing ? 'following' : ''} ${isBlocked ? 'blocked' : ''} ${isMuted ? 'muted' : ''}" ${isBlocked || isMuted ? 'disabled' : ''}
          data-account-id="${accountId}" data-following="${isFollowing ? 'true' : 'false'}"
          title="${isBlocked ? 'User blocked' : isMuted ? 'User muted' : isFollowing ? 'Unfollow' : 'Follow'}">
          ${isBlocked ? 'Blocked' : isMuted ? 'Muted' : isFollowing ? 'Following' : 'Follow'}</button>`;

    const movedBanner = account.moved ? `
      <div class="profile-moved-banner">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        <div>
          <div class="moved-title">This account has moved</div>
          <div class="moved-text">Its new profile is <strong>@${escapeHTML(account.moved.acct)}</strong></div>
        </div>
        <button class="moved-btn" data-profile-id="${account.moved.id}" data-profile-server="${srv}">View</button>
      </div>` : '';

    // Track cursor for pagination
    if (statuses.length) {
      profilePagination.posts.maxId = statuses[statuses.length - 1].id;
    }

    const loadMoreHtml = (statuses.length === 20 && profilePagination.posts.maxId)
      ? '<button class="load-more-btn" data-feed="profile" data-tab="posts">Load More</button>'
      : '';

    const postsHtml = statuses.length
      ? statuses.map(s => renderPost(s)).join('') + loadMoreHtml
      : '<div class="feed-status"><p style="font-size:13px;">No posts yet.</p></div>';

    /* ── Pinned posts ── */
    const pinned = pinnedStatuses || [];
    let pinnedHtml = '';
    if (pinned.length === 1) {
      pinnedHtml = `
        <div class="pinned-section">
          <div class="pinned-header"><div class="pinned-header-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
            pinned
          </div></div>
          <div class="pinned-single">${renderPost(pinned[0])}</div>
        </div>`;
    } else if (pinned.length > 1) {
      const carouselId = `pinned-carousel-${accountId}`;
      const slides = pinned.map((s, i) =>
        `<div class="pinned-slide${i === 0 ? ' active' : ''}" data-index="${i}">${renderPost(s)}</div>`
      ).join('');
      pinnedHtml = `
        <div class="pinned-section">
          <div class="pinned-header">
            <div class="pinned-header-label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
              pinned
            </div>
            <div class="pinned-header-nav">
              <button class="pinned-nav prev" aria-label="Previous pinned post">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span class="pinned-counter">1 / ${pinned.length}</span>
              <button class="pinned-nav next" aria-label="Next pinned post">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
          <div id="${carouselId}">${slides}</div>
          <div class="pinned-dots">${pinned.map((_, i) =>
        `<button class="pinned-dot${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="Post ${i + 1}"></button>`
      ).join('')}</div>
        </div>`;
    }

    content.innerHTML = `
      ${movedBanner}
      ${headerImg}
      <div class="profile-identity">
        <div class="profile-avatar-wrap">
          <img class="profile-avatar-large" src="${escapeHTML(account.avatar_static || account.avatar)}" alt="" onerror="this.onerror=null;this.src=window._AVATAR_PLACEHOLDER"/>
          <div class="profile-action-group">${followButton}${notifyButton}${moreMenu}</div>
        </div>
        <div class="profile-name-row">
          <div>
            <div class="profile-display-name">
              ${renderCustomEmojis(account.display_name || account.username, account.emojis)}
              ${(account.bot || account.locked) ? `<span class="profile-badges">
                ${account.bot ? `<span class="profile-badge profile-badge-bot" title="Bot"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2v2h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4V4a2 2 0 0 1 2-2z"/><path d="M9 13v.01"/><path d="M15 13v.01"/><path d="M10 17h4"/></svg> Bot</span>` : ''}
                ${account.locked ? `<span class="profile-badge profile-badge-locked" title="Locked (requires approval to follow)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>` : ''}
              </span>` : ''}
            </div>
            <div class="profile-acct">@${escapeHTML(account.acct)}</div>
          </div>
        </div>
        ${bio}
        <div class="profile-stats">
          <div class="profile-stat"><span class="profile-stat-num">${formatNum(account.statuses_count)}</span><span class="profile-stat-label">Posts</span></div>
          <div class="profile-stat"><span class="profile-stat-num">${formatNum(account.following_count)}</span><span class="profile-stat-label">Following</span></div>
          <div class="profile-stat"><span class="profile-stat-num">${formatNum(account.followers_count)}</span><span class="profile-stat-label">Followers</span></div>
        </div>
        ${(account.fields && account.fields.length) ? `
          <div class="profile-fields">
            ${account.fields.map(f => {
      const isVerified = !!f.verified_at;
      return `<div class="profile-field ${isVerified ? 'verified' : ''}">
                <span class="profile-field-name">${escapeHTML(f.name)}</span>
                <div class="profile-field-value">${sanitizeHTML(f.value)}</div>
                ${isVerified ? '<svg class="verified-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>' : ''}
              </div>`;
    }).join('')}
          </div>` : ''}
        <div class="profile-joined">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Joined ${new Date(account.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
        <a class="profile-open-link" href="${escapeHTML(account.url)}" target="_blank" rel="noopener">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          View on ${account.url ? new URL(account.url).hostname : srv}
        </a>
      </div>
      ${pinnedHtml}
      <div class="profile-tabs" role="tablist">
        <button class="profile-tab active" data-tab="posts" role="tab" aria-selected="true">Posts</button>
        <button class="profile-tab" data-tab="replies" role="tab" aria-selected="false">Posts &amp; Replies</button>
        <button class="profile-tab" data-tab="media" role="tab" aria-selected="false">Media</button>
      </div>
      <div class="profile-tab-panel" id="profile-tab-posts" role="tabpanel">${postsHtml}</div>
      <div class="profile-tab-panel" id="profile-tab-replies" role="tabpanel" hidden></div>
      <div class="profile-tab-panel" id="profile-tab-media" role="tabpanel" hidden></div>`;

    // Render the follow/mutual label after DOM is inserted
    renderProfileBannerFollowLabel(relationship);

    // Wire profile content tabs
    content.querySelectorAll('.profile-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        content.querySelectorAll('.profile-tab').forEach(t => {
          t.classList.toggle('active', t === tab);
          t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        });
        content.querySelectorAll('.profile-tab-panel').forEach(p => {
          p.hidden = p.id !== `profile-tab-${tabName}`;
        });
        const panel = content.querySelector(`#profile-tab-${tabName}`);
        if (panel && !panel.dataset.loaded && tabName !== 'posts') {
          loadProfileTab(tabName, panel);
        }
        setTimeout(checkProfileInfiniteScroll, 200);
      });
    });

    if (pinned.length > 1) {
      const carouselEl = $(`pinned-carousel-${accountId}`);
      if (carouselEl) {
        const slides = carouselEl.querySelectorAll('.pinned-slide');
        const dots = carouselEl.closest('.pinned-section').querySelectorAll('.pinned-dot');
        const counter = carouselEl.closest('.pinned-section').querySelector('.pinned-counter');
        const total = slides.length;
        let current = 0;

        function goTo(idx) {
          slides[current].classList.remove('active');
          dots[current].classList.remove('active');
          current = (idx + total) % total;
          slides[current].classList.add('active');
          dots[current].classList.add('active');
          if (counter) counter.textContent = `${current + 1} / ${total}`;
        }

        carouselEl.closest('.pinned-section').querySelector('.pinned-nav.prev')
          .addEventListener('click', e => { e.stopPropagation(); goTo(current - 1); });
        carouselEl.closest('.pinned-section').querySelector('.pinned-nav.next')
          .addEventListener('click', e => { e.stopPropagation(); goTo(current + 1); });

        let touchStartX = 0;
        let touchStartY = 0;
        carouselEl.addEventListener('touchstart', e => {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }, { passive: true });
        carouselEl.addEventListener('touchend', e => {
          const dx = e.changedTouches[0].clientX - touchStartX;
          const dy = e.changedTouches[0].clientY - touchStartY;
          // Only treat as horizontal swipe if mostly horizontal and long enough
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            e.preventDefault();
            e.stopPropagation();
            goTo(dx < 0 ? current + 1 : current - 1);
          }
        }, { passive: false });
      }
    }
    // Mark cache as valid for this account
    _profileCache.accountId = accountId;
    _profileCache.ts = Date.now();
    _profileCache.scrollTop = 0;

    // Attach infinite scroll listener to the drawer
    attachProfileScrollListener();
    setTimeout(checkProfileInfiniteScroll, 200);
  }).catch(err => {
    content.innerHTML = `<div class="feed-status" style="padding-top:60px;">
      <p style="font-size:13px;font-family:var(--font-mono);color:var(--danger);">Could not load profile.</p>
      <p class="status-sub">${escapeHTML(err.message)}</p>
    </div>`;
  });
}

export function closeProfileDrawer() {
  const drawer = $('profile-drawer');
  const backdrop = $('profile-backdrop');

  // Save scroll position so cache restores correctly
  const inner = drawer.querySelector('.profile-drawer-inner');
  if (inner && _profileCache.accountId) _profileCache.scrollTop = inner.scrollTop;

  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('open');
  delete drawer.dataset.fromAnalytics;
  // Don't clear the scroll lock if the analytics drawer is still open behind us
  const analyticsOpen = document.getElementById('post-analytics-drawer')?.classList.contains('open');
  if (!analyticsOpen) document.body.style.overflow = '';
  updateURLParam('profile', null);
  updateURLParam('bookmarks', null);
}

/* ── Bookmarks drawer ──────────────────────────────────────────────── */

export function openBookmarksDrawer() {
  const drawer = $('profile-drawer');
  const backdrop = $('profile-backdrop');
  const content = $('profile-content');

  content.innerHTML = '<div class="profile-loading"><div class="spinner"></div></div>';
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Update URL state
  updateURLParam('bookmarks', 'true', true);

  apiGet('/api/v1/bookmarks?limit=40', state.token)
    .then(bookmarks => {
      if (!bookmarks.length) {
        content.innerHTML = `
          <div style="padding:40px 20px;text-align:center;">
            <h2 style="font-family:var(--font-display);font-size:20px;margin-bottom:8px;">Bookmarks</h2>
            <p style="color:var(--text-muted);font-size:13px;">No bookmarks yet. Bookmark posts to save them here.</p>
          </div>`;
        return;
      }
      const postsHtml = bookmarks.map(s => renderPost(s)).join('');
      content.innerHTML = `
        <div style="padding:20px 20px 12px;">
          <h2 style="font-family:var(--font-display);font-size:20px;margin-bottom:4px;">Bookmarks</h2>
          <p style="color:var(--text-muted);font-size:12px;font-family:var(--font-mono);">${bookmarks.length} saved post${bookmarks.length !== 1 ? 's' : ''}</p>
        </div>
        <div style="border-top:1px solid var(--border);">${postsHtml}</div>`;
    })
    .catch(err => {
      content.innerHTML = `<div style="padding:40px 20px;text-align:center;">
        <p style="color:var(--danger);font-size:13px;">Failed to load bookmarks</p></div>`;
      console.warn('Bookmarks load error:', err);
    });
}

/* ── Follow / Notify / Hashtag toggles ─────────────────────────────── */

export async function handleFollowToggle(btn) {
  if (btn.disabled) return;
  const accountId = btn.dataset.accountId;
  const isFollowing = btn.dataset.following === 'true';

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';

  try {
    const endpoint = isFollowing
      ? `/api/v1/accounts/${accountId}/unfollow`
      : `/api/v1/accounts/${accountId}/follow`;

    const res = await fetch(`https://${state.server}${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to update relationship');

    const relationship = await res.json();
    const nowFollowing = relationship.following;
    const nowRequested = relationship.requested;

    btn.dataset.following = nowFollowing ? 'true' : 'false';
    btn.classList.toggle('following', nowFollowing);
    btn.classList.toggle('requested', !nowFollowing && !!nowRequested);
    btn.textContent = nowFollowing ? 'Following' : (nowRequested ? 'Requested' : 'Follow');

    const notifyBtn = btn.closest('.profile-action-group')?.querySelector('.profile-notify-btn');
    if (notifyBtn) notifyBtn.style.display = nowFollowing ? '' : 'none';

    // Update the follow/mutual label in the banner
    renderProfileBannerFollowLabel(relationship);

    showToast(nowFollowing ? 'Now following' : 'Unfollowed');
  } catch (err) {
    btn.textContent = originalText;
    showToast('Action failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

export async function handleNotifyToggle(btn) {
  if (btn.disabled) return;
  const accountId = btn.dataset.accountId;
  const isNotifying = btn.dataset.notifying === 'true';
  const willNotify = !isNotifying;

  btn.disabled = true;
  const svg = btn.querySelector('svg');

  btn.dataset.notifying = willNotify ? 'true' : 'false';
  btn.classList.toggle('notifying', willNotify);
  btn.title = willNotify ? 'Stop post notifications' : 'Get notified about posts';
  if (svg) svg.setAttribute('fill', willNotify ? 'currentColor' : 'none');

  btn.classList.add('ringing');
  setTimeout(() => btn.classList.remove('ringing'), 600);

  try {
    const res = await fetch(`https://${state.server}/api/v1/accounts/${accountId}/follow`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify: willNotify }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to update notification setting');

    const relationship = await res.json();
    const nowNotifying = !!relationship.notifying;

    btn.dataset.notifying = nowNotifying ? 'true' : 'false';
    btn.classList.toggle('notifying', nowNotifying);
    btn.title = nowNotifying ? 'Stop post notifications' : 'Get notified about posts';
    if (svg) svg.setAttribute('fill', nowNotifying ? 'currentColor' : 'none');

    showToast(nowNotifying ? 'Notifications on for this user' : 'Notifications off for this user');
  } catch (err) {
    btn.dataset.notifying = isNotifying ? 'true' : 'false';
    btn.classList.toggle('notifying', isNotifying);
    btn.title = isNotifying ? 'Stop post notifications' : 'Get notified about posts';
    if (svg) svg.setAttribute('fill', isNotifying ? 'currentColor' : 'none');
    showToast('Failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

export async function handleBlockToggle(btn) {
  if (btn.disabled) return;
  const accountId = btn.dataset.accountId;
  const isBlocked = btn.dataset.blocked === 'true';

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';

  try {
    // If blocking and user is muted, unmute them first
    const muteBtn = document.querySelector(`.profile-mute-btn[data-account-id="${accountId}"]`);
    const isMuted = muteBtn && muteBtn.dataset.muted === 'true';
    
    if (!isBlocked && isMuted) {
      // Blocking and they're muted, so unmute them
      await fetch(`https://${state.server}/api/v1/accounts/${accountId}/unmute`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      if (muteBtn) {
        muteBtn.dataset.muted = 'false';
        muteBtn.textContent = 'Mute user';
        muteBtn.classList.remove('muted');
      }
    }

    const endpoint = isBlocked
      ? `/api/v1/accounts/${accountId}/unblock`
      : `/api/v1/accounts/${accountId}/block`;

    const res = await fetch(`https://${state.server}${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to update block status');

    const relationship = await res.json();
    const nowBlocked = relationship.blocking || false;

    btn.dataset.blocked = nowBlocked ? 'true' : 'false';
    btn.textContent = nowBlocked ? '✓ Blocked' : 'Block user';
    btn.classList.toggle('blocked', nowBlocked);

    // Update the follow button
    const followBtn = document.querySelector(`.profile-follow-btn[data-account-id="${accountId}"]`);
    if (followBtn) {
      followBtn.classList.toggle('blocked', nowBlocked);
      followBtn.classList.remove('muted');
      followBtn.disabled = nowBlocked;
      followBtn.textContent = nowBlocked ? 'Blocked' : followBtn.dataset.following === 'true' ? 'Following' : 'Follow';
      followBtn.title = nowBlocked ? 'User blocked' : followBtn.dataset.following === 'true' ? 'Unfollow' : 'Follow';
    }

    showToast(nowBlocked ? 'User blocked' : 'User unblocked');
  } catch (err) {
    btn.textContent = originalText;
    showToast('Action failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

export async function handleMuteToggle(btn) {
  if (btn.disabled) return;
  const accountId = btn.dataset.accountId;
  const isMuted = btn.dataset.muted === 'true';

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';

  try {
    // If muting and user is blocked, unblock them first
    const blockBtn = document.querySelector(`.profile-block-btn[data-account-id="${accountId}"]`);
    const isBlocked = blockBtn && blockBtn.dataset.blocked === 'true';
    
    if (!isMuted && isBlocked) {
      // Muting and they're blocked, so unblock them
      await fetch(`https://${state.server}/api/v1/accounts/${accountId}/unblock`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      if (blockBtn) {
        blockBtn.dataset.blocked = 'false';
        blockBtn.textContent = 'Block user';
        blockBtn.classList.remove('blocked');
      }
    }

    const endpoint = isMuted
      ? `/api/v1/accounts/${accountId}/unmute`
      : `/api/v1/accounts/${accountId}/mute`;

    const res = await fetch(`https://${state.server}${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to update mute status');

    const relationship = await res.json();
    const nowMuted = relationship.muting || false;

    btn.dataset.muted = nowMuted ? 'true' : 'false';
    btn.textContent = nowMuted ? '✓ Muted' : 'Mute user';
    btn.classList.toggle('muted', nowMuted);

    // Update the follow button
    const followBtn = document.querySelector(`.profile-follow-btn[data-account-id="${accountId}"]`);
    if (followBtn) {
      followBtn.classList.toggle('muted', nowMuted);
      followBtn.classList.remove('blocked');
      followBtn.disabled = nowMuted;
      followBtn.textContent = nowMuted ? 'Muted' : followBtn.dataset.following === 'true' ? 'Following' : 'Follow';
      followBtn.title = nowMuted ? 'User muted' : followBtn.dataset.following === 'true' ? 'Unfollow' : 'Follow';
    }

    showToast(nowMuted ? 'User muted' : 'User unmuted');
  } catch (err) {
    btn.textContent = originalText;
    showToast('Action failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

export async function handleHashtagFollowToggle(btn) {
  if (btn.disabled) return;
  const tag = btn.dataset.tag;
  const isFollowing = btn.dataset.following === 'true';

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';

  try {
    const endpoint = isFollowing ? `/api/v1/tags/${tag}/unfollow` : `/api/v1/tags/${tag}/follow`;
    const res = await fetch(`https://${state.server}${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to update hashtag follow status');

    const tagInfo = await res.json();
    const nowFollowing = tagInfo.following;

    btn.dataset.following = nowFollowing ? 'true' : 'false';
    btn.textContent = nowFollowing ? 'Following' : `Follow #${tag}`;
    btn.classList.toggle('following', nowFollowing);

    if (nowFollowing) {
      if (!state.followedHashtags.some(t => t.name.toLowerCase() === tag.toLowerCase())) {
        state.followedHashtags.push(tagInfo);
      }
    } else {
      state.followedHashtags = state.followedHashtags.filter(t => t.name.toLowerCase() !== tag.toLowerCase());
    }

    showToast(nowFollowing ? `Following #${tag}` : `Unfollowed #${tag}`);
  } catch (err) {
    btn.textContent = originalText;
    showToast('Action failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ── Favorite / Bookmark toggles ───────────────────────────────────── */

export async function handleFavoriteToggle(btn) {
  if (btn.disabled) return;
  const postId = btn.dataset.postId;
  const isFavourited = btn.dataset.favourited === 'true';
  const willBeFavourited = !isFavourited;
  const originalFavourited = isFavourited;
  const svg = btn.querySelector('svg');
  const countSpan = btn.querySelector('.post-fav-count');
  const originalCount = countSpan ? parseInt(countSpan.textContent) || 0 : 0;

  btn.disabled = true;

  if (willBeFavourited) {
    btn.classList.add('favoriting');
    setTimeout(() => btn.classList.remove('favoriting'), 500);
  } else {
    btn.classList.add('unfavoriting');
    setTimeout(() => btn.classList.remove('unfavoriting'), 500);
  }

  btn.dataset.favourited = willBeFavourited ? 'true' : 'false';
  btn.classList.toggle('favourited', willBeFavourited);
  btn.title = willBeFavourited ? 'Unfavorite' : 'Favorite';
  if (svg) {
    svg.setAttribute('fill', 'currentColor');
    if (!willBeFavourited) {
      setTimeout(() => {
        btn.classList.add('unfavorite-fade');
        setTimeout(() => { svg.setAttribute('fill', 'none'); btn.classList.remove('unfavorite-fade'); }, 300);
      }, 500);
    }
  }
  if (countSpan) countSpan.textContent = willBeFavourited ? originalCount + 1 : Math.max(0, originalCount - 1);

  try {
    const endpoint = originalFavourited
      ? `/api/v1/statuses/${postId}/unfavourite`
      : `/api/v1/statuses/${postId}/favourite`;
    const res = await fetch(`https://${state.server}${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to favorite');
    const post = await res.json();
    if (countSpan) countSpan.textContent = post.favourites_count || 0;
  } catch (err) {
    btn.dataset.favourited = originalFavourited ? 'true' : 'false';
    btn.classList.toggle('favourited', originalFavourited);
    btn.title = originalFavourited ? 'Unfavorite' : 'Favorite';
    if (svg) { svg.setAttribute('fill', originalFavourited ? 'currentColor' : 'none'); btn.classList.remove('unfavorite-fade'); }
    if (countSpan) countSpan.textContent = originalCount;
    showToast('Failed to favorite: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

export async function handleBookmarkToggle(btn) {
  if (btn.disabled) return;
  const postId = btn.dataset.postId;
  const isBookmarked = btn.dataset.bookmarked === 'true';
  const willBeBookmarked = !isBookmarked;
  const svg = btn.querySelector('svg');

  btn.disabled = true;

  btn.dataset.bookmarked = willBeBookmarked ? 'true' : 'false';
  btn.classList.toggle('bookmarked', willBeBookmarked);
  btn.title = willBeBookmarked ? 'Remove bookmark' : 'Bookmark';
  if (svg) svg.setAttribute('fill', willBeBookmarked ? 'currentColor' : 'none');
  if (willBeBookmarked) { btn.classList.add('bookmarking'); setTimeout(() => btn.classList.remove('bookmarking'), 400); }

  try {
    const endpoint = isBookmarked
      ? `/api/v1/statuses/${postId}/unbookmark`
      : `/api/v1/statuses/${postId}/bookmark`;
    const res = await fetch(`https://${state.server}${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Failed to bookmark');
    showToast(willBeBookmarked ? 'Bookmarked' : 'Bookmark removed');
  } catch (err) {
    btn.dataset.bookmarked = isBookmarked ? 'true' : 'false';
    btn.classList.toggle('bookmarked', isBookmarked);
    btn.title = isBookmarked ? 'Remove bookmark' : 'Bookmark';
    if (svg) svg.setAttribute('fill', isBookmarked ? 'currentColor' : 'none');
    showToast('Failed to bookmark: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}
