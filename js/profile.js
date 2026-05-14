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

/**
 * Updates a follow button's UI state based on relationship data.
 * Preserves icons and handles spans correctly.
 */
export function updateFollowButtonUI(btn, relationship, isLocked = false) {
  if (!btn || !relationship) return;

  const isFollowing = !!relationship.following;
  const followedBy = !!relationship.followed_by;
  const isRequested = !!relationship.requested;
  const isBlocked = !!relationship.blocking;
  const isMuted = !!relationship.muting;

  btn.dataset.following = isFollowing ? 'true' : 'false';
  btn.classList.toggle('following', isFollowing);
  btn.classList.toggle('requested', !isFollowing && isRequested);
  btn.classList.toggle('blocked', isBlocked);
  btn.classList.toggle('muted', isMuted);
  btn.disabled = isBlocked || isMuted;

  const icon = btn.querySelector('iconify-icon');
  const label = btn.querySelector('span');

  let labelText = 'Follow';
  let iconName = isLocked ? 'ph:lock-key-bold' : 'ph:user-plus-bold';

  if (isBlocked) {
    labelText = 'Blocked';
  } else if (isMuted) {
    labelText = 'Muted';
  } else if (isFollowing) {
    labelText = followedBy ? 'Mutual' : 'Following';
    iconName = followedBy ? 'ph:handshake-bold' : 'ph:user-check-bold';
  } else if (isRequested) {
    labelText = 'Requested';
    iconName = 'ph:hourglass-bold';
  } else if (followedBy) {
    labelText = isLocked ? 'Request Back' : 'Follow Back';
    if (isLocked) iconName = 'ph:lock-key-bold';
  } else if (isLocked) {
    labelText = 'Request';
    iconName = 'ph:lock-key-bold';
  }

  if (icon) {
    icon.setAttribute('icon', iconName);
  }

  if (label) {
    label.textContent = labelText;
  } else {
    // Fallback if no span, but try to preserve icon if it exists
    if (icon) {
      btn.innerHTML = '';
      btn.appendChild(icon);
      const s = document.createElement('span');
      s.textContent = labelText;
      btn.appendChild(s);
    } else {
      btn.textContent = labelText;
    }
  }

  btn.title = isBlocked ? 'User blocked' : isMuted ? 'User muted' : isFollowing ? 'Unfollow' : 'Follow';
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
 * Profile drawer - loads and renders a user's profile, statuses, pinned posts.
 * Also contains the bookmarks drawer and follow/notify/hashtag-follow toggles.
 */

import { $, state, store } from './state.js';
import { apiGet } from './api.js';
import { applyCountsFromStatus } from './counts.js';
import { showToast, showConfirm } from './ui.js';
import { renderPost, renderFollowingBadge } from './render.js';
import { fetchRelationships } from './feed.js';
import {
  escapeHTML, sanitizeHTML, renderCustomEmojis, formatNum, updateURLParam,
  matchesLanguage,
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
      ${isVideo ? '<div class="profile-media-play"><iconify-icon icon="ph:play-fill" style="font-size: 18px;"></iconify-icon></div>' : ''}
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
    url = `/api/v1/accounts/${accountId}/statuses?limit=20&exclude_reblogs=true`;
  } else if (tabName === 'media') {
    url = `/api/v1/accounts/${accountId}/statuses?limit=20&only_media=true`;
  } else return;

  try {
    const statuses = await apiGet(url, state.token, server);
    await fetchRelationships(statuses);
    tabState.maxId = statuses.length ? statuses[statuses.length - 1].id : null;
    panel.dataset.loaded = 'true';
    const loadMoreHtml = (statuses.length === 20 && tabState.maxId)
      ? `<button class="load-more-btn" data-feed="profile" data-tab="${tabName}">Load More</button>`
      : '';
    const preferredLang = state.preferredLanguage || 'all';
    let display = statuses;
    if (tabName !== 'media') {
      display = display.filter(s => {
        const postLang = (s.reblog || s).language || s.language;
        return matchesLanguage(postLang, preferredLang);
      });
    }

    if (tabName === 'media') {
      panel.innerHTML = statuses.length
        ? `<div class="profile-media-grid">${statuses.map(s => renderMediaItem(s)).join('')}</div>${loadMoreHtml}`
        : '<div class="feed-status"><p style="font-size:13px;">No media yet.</p></div>';
    } else {
      panel.innerHTML = display.length
        ? display.map(s => renderPost(s, { context: 'account' })).join('') + loadMoreHtml
        : '<div class="feed-status"><p style="font-size:13px;">No posts matching your language filter.</p></div>';
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
    if (tabName === 'replies') url += '&exclude_reblogs=true';
    if (tabName === 'media') url += '&only_media=true';

    const newPosts = await apiGet(url, state.token, server);
    await fetchRelationships(newPosts);
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
      const preferredLang = state.preferredLanguage || 'all';
      let display = newPosts;
      display = display.filter(s => {
        const postLang = (s.reblog || s).language || s.language;
        return matchesLanguage(postLang, preferredLang);
      });
      const html = display.map(s => renderPost(s, { context: 'account' })).join('');
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
    // scroll listener may have been detached - recheck
    if (!profileScrollListenerAttached) attachProfileScrollListener();
    setTimeout(checkProfileInfiniteScroll, 200);
    return;
  }

  content.innerHTML = '<div class="profile-loading"><div class="spinner"></div></div>';
  const titleEl = $('profile-drawer-title');
  const extraEl = $('profile-drawer-extra');
  if (titleEl) titleEl.textContent = 'Profile';
  if (extraEl) extraEl.innerHTML = '';

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
  state.bookmarksActive = false;
  if (window.updateSidebarNav) window.updateSidebarNav();

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
  ]).then(async ([account, statuses, relationships, pinnedStatuses]) => {
    const titleEl = $('profile-drawer-title');
    if (titleEl) titleEl.innerHTML = renderCustomEmojis(account.display_name || account.username, account.emojis);

    const relationship = relationships && relationships.length ? relationships[0] : null;
    const isFollowing = relationship && relationship.following;

    // Update global following state
    if (relationship) {
      if (relationship.following || relationship.requested) {
        state.knownFollowing.add(accountId);
        state.knownNotFollowing.delete(accountId);
      } else {
        state.knownFollowing.delete(accountId);
        state.knownNotFollowing.add(accountId);
      }
    }

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
          <iconify-icon icon="${isNotifying ? 'ph:bell-fill' : 'ph:bell-bold'}" style="font-size: 15px;"></iconify-icon></button>`
      : '';

    const moreMenu = !isSelf
      ? `<div class="profile-more-menu-wrapper">
          <button class="profile-more-menu-btn" data-account-id="${accountId}" title="More options">
            <iconify-icon icon="ph:dots-three-bold" style="font-size: 18px;"></iconify-icon>
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

    const isLocked = !!account.locked;
    const isRequested = relationship && relationship.requested;

    const followButton = isSelf
      ? `<a class="profile-edit-btn" href="https://${srv}/settings/profile" target="_blank" rel="noopener">Edit Profile</a>`
      : `<button class="profile-follow-btn ${isFollowing ? 'following' : ''} ${isRequested ? 'requested' : ''} ${isBlocked ? 'blocked' : ''} ${isMuted ? 'muted' : ''}" ${isBlocked || isMuted ? 'disabled' : ''}
          data-account-id="${accountId}" data-following="${isFollowing ? 'true' : 'false'}" data-locked="${isLocked}"
          title="${isBlocked ? 'User blocked' : isMuted ? 'User muted' : isFollowing ? 'Unfollow' : (isLocked ? 'Send follow request' : 'Follow')}">
          <iconify-icon icon="${isFollowing ? 'ph:user-check-bold' : (isRequested ? 'ph:hourglass-bold' : (isLocked ? 'ph:lock-key-bold' : 'ph:user-plus-bold'))}" style="font-size: 14px; margin-right: 4px; vertical-align: -2px;"></iconify-icon>
          <span>${isBlocked ? 'Blocked' : isMuted ? 'Muted' : isFollowing ? 'Following' : (isRequested ? 'Requested' : (isLocked ? 'Request' : 'Follow'))}</span></button>`;

    const movedBanner = account.moved ? `
      <div class="profile-moved-banner">
        <iconify-icon icon="ph:paper-plane-tilt-bold" style="font-size: 20px;"></iconify-icon>
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

    await fetchRelationships([...statuses, ...(pinnedStatuses || [])]);

    const preferredLang = state.preferredLanguage || 'all';
    let display = statuses;
    display = display.filter(s => {
      const postLang = (s.reblog || s).language || s.language;
      return matchesLanguage(postLang, preferredLang);
    });

    const postsHtml = display.length
      ? display.map(s => renderPost(s, { context: 'account' })).join('') + loadMoreHtml
      : '<div class="feed-status"><p style="font-size:13px;">No posts matching your language filter.</p></div>';

    /* ── Pinned posts ── */
    const pinned = pinnedStatuses || [];
    let pinnedHtml = '';
    if (pinned.length === 1) {
      pinnedHtml = `
        <div class="pinned-section">
          <div class="pinned-header"><div class="pinned-header-label">
            <iconify-icon icon="ph:push-pin-bold" style="font-size: 12px;"></iconify-icon>
            pinned
          </div></div>
          <div class="pinned-single">${renderPost(pinned[0], { context: 'account' })}</div>
        </div>`;
    } else if (pinned.length > 1) {
      const carouselId = `pinned-carousel-${accountId}`;
      const slides = pinned.map((s, i) =>
        `<div class="pinned-slide${i === 0 ? ' active' : ''}" data-index="${i}">${renderPost(s, { context: 'account' })}</div>`
      ).join('');
      pinnedHtml = `
        <div class="pinned-section">
          <div class="pinned-header">
            <div class="pinned-header-label">
              <iconify-icon icon="ph:push-pin-bold" style="font-size: 12px;"></iconify-icon>
              pinned
            </div>
            <div class="pinned-header-nav">
              <button class="pinned-nav prev" aria-label="Previous pinned post">
                <iconify-icon icon="ph:caret-left-bold" style="font-size: 10px;"></iconify-icon>
              </button>
              <span class="pinned-counter">1 / ${pinned.length}</span>
              <button class="pinned-nav next" aria-label="Next pinned post">
                <iconify-icon icon="ph:caret-right-bold" style="font-size: 10px;"></iconify-icon>
              </button>
            </div>
          </div>
          <div class="pinned-carousel-outer">
            <div id="${carouselId}" class="pinned-carousel-track">${slides}</div>
          </div>
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
          <div style="position:relative;">
            <img class="profile-avatar-large" src="${escapeHTML(account.avatar_static || account.avatar)}" alt="" onerror="this.onerror=null;this.src=window._AVATAR_PLACEHOLDER"/>
            ${renderFollowingBadge(account.id)}
          </div>
          <div class="profile-action-group">${followButton}${notifyButton}${moreMenu}</div>
        </div>
        <div class="profile-name-row">
          <div>
            <div class="profile-display-name">
              ${renderCustomEmojis(account.display_name || account.username, account.emojis)}
              ${(account.bot || account.locked) ? `<span class="profile-badges">
                ${account.bot ? `<span class="profile-badge profile-badge-bot" title="Bot"><iconify-icon icon="ph:robot-bold" style="font-size: 12px;"></iconify-icon> Bot</span>` : ''}
                ${account.locked ? `<span class="profile-badge profile-badge-locked" title="Locked (requires approval to follow)"><iconify-icon icon="ph:lock-bold" style="font-size: 12px;"></iconify-icon></span>` : ''}
              </span>` : ''}
            </div>
            <div class="profile-acct">@${escapeHTML(account.acct)}</div>
          </div>
        </div>
        ${bio}
        <div class="profile-stats">
          <div class="profile-stat"><span class="profile-stat-num">${formatNum(account.statuses_count)}</span><span class="profile-stat-label">Posts</span></div>
          <button class="profile-stat" id="profile-following-btn" data-account-id="${accountId}" data-server="${srv}"><span class="profile-stat-num">${formatNum(account.following_count)}</span><span class="profile-stat-label">Following</span></button>
          <button class="profile-stat" id="profile-followers-btn" data-account-id="${accountId}" data-server="${srv}"><span class="profile-stat-num">${formatNum(account.followers_count)}</span><span class="profile-stat-label">Followers</span></button>
        </div>
        ${(account.fields && account.fields.length) ? `
          <div class="profile-fields">
            ${account.fields.map(f => {
      const isVerified = !!f.verified_at;
      return `<div class="profile-field ${isVerified ? 'verified' : ''}">
                <span class="profile-field-name">${escapeHTML(f.name)}</span>
                <div class="profile-field-value">${sanitizeHTML(f.value)}</div>
                ${isVerified ? '<iconify-icon icon="ph:check-circle-fill" class="verified-icon" style="font-size: 12px;"></iconify-icon>' : ''}
              </div>`;
    }).join('')}
          </div>` : ''}
        <div class="profile-joined">
          <iconify-icon icon="ph:calendar-blank-bold" style="font-size: 12px;"></iconify-icon>
          Joined ${new Date(account.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
        <a class="profile-open-link" href="${escapeHTML(account.url)}" target="_blank" rel="noopener">
          <iconify-icon icon="ph:link-bold" style="font-size: 11px;"></iconify-icon>
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

        // Scroll tabs to top of container - use a small delay to ensure layout has settled
        setTimeout(() => {
          const inner = drawer.querySelector('.profile-drawer-inner');
          const tabs = content.querySelector('.profile-tabs');
          const panel = content.querySelector(`#profile-tab-${tabName}`);
          if (inner && tabs && panel) {
            inner.scrollTo({
              top: panel.offsetTop - tabs.offsetHeight,
              behavior: 'smooth'
            });
          }
        }, 10);
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

        function updateHeight(idx) {
          const slide = slides[idx];
          const outer = carouselEl.parentElement; // .pinned-carousel-outer
          if (slide && outer) {
            outer.style.height = slide.offsetHeight + 'px';
          }
        }

        function goTo(idx) {
          const newIdx = (idx + total) % total;
          carouselEl.style.transform = `translateX(-${newIdx * 100}%)`;

          updateHeight(newIdx);

          slides[current].classList.remove('active');
          dots[current].classList.remove('active');
          current = newIdx;
          slides[current].classList.add('active');
          dots[current].classList.add('active');
          if (counter) counter.textContent = `${current + 1} / ${total}`;
        }

        // Update height if images load later
        carouselEl.addEventListener('load', () => updateHeight(current), true);

        // Initial height set
        setTimeout(() => updateHeight(0), 100);

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
  state.bookmarksActive = false;
  if (window.updateSidebarNav) window.updateSidebarNav();
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
  state.bookmarksActive = true;
  if (window.updateSidebarNav) window.updateSidebarNav();

  // Update URL state
  updateURLParam('bookmarks', 'true', true);

  apiGet('/api/v1/bookmarks?limit=40', state.token)
    .then(bookmarks => {
      if (!bookmarks.length) {
        const titleEl = $('profile-drawer-title');
        const extraEl = $('profile-drawer-extra');
        if (titleEl) titleEl.textContent = 'Bookmarks';
        if (extraEl) extraEl.innerHTML = '';

        content.innerHTML = `
          <div style="padding:40px 20px;text-align:center;">
            <p style="color:var(--text-muted);font-size:13px;">No bookmarks yet. Bookmark posts to save them here.</p>
          </div>`;
        return;
      }
      const preferredLang = state.preferredLanguage || 'all';
      let display = bookmarks;
      display = display.filter(s => {
        const postLang = (s.reblog || s).language || s.language;
        return matchesLanguage(postLang, preferredLang);
      });
      const postsHtml = display.map(s => renderPost(s, { context: 'account' })).join('');

      const titleEl = $('profile-drawer-title');
      const extraEl = $('profile-drawer-extra');
      if (titleEl) titleEl.textContent = 'Bookmarks';
      if (extraEl) {
        extraEl.innerHTML = `<span style="color:var(--text-dim);font-size:11px;font-family:var(--font-mono);opacity:0.8;">${display.length} post${display.length !== 1 ? 's' : ''}</span>`;
      }

      content.innerHTML = `<div>${postsHtml}</div>`;
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

  if (isFollowing && store.get('pref_confirm_interactions') === 'true') {
    const postEl = btn.closest('.feed-status, .post-item, .profile-drawer, .post-thread-item');
    const name = postEl?.querySelector('.post-display-name, .profile-display-name')?.textContent || 'this user';
    const acct = postEl?.querySelector('.post-acct, .profile-acct')?.textContent || '';
    const previewHTML = `<div style="font-weight:600;">Action on ${name}</div><div style="font-size:11px; opacity:0.7;">${acct}</div>`;

    const confirmed = await showConfirm(`Are you sure you want to unfollow this user?`, `Confirm Unfollow`, previewHTML);
    if (!confirmed) {
      return;
    }
  }

  const label = btn.querySelector('span');
  const originalHTML = btn.innerHTML;
  if (label) label.textContent = '...';
  else btn.textContent = '...';
  btn.disabled = true;

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

    // Use helper to update UI consistently
    updateFollowButtonUI(btn, relationship, btn.dataset.locked === 'true');

    const nowFollowing = relationship.following;
    const nowRequested = relationship.requested;

    const notifyBtn = btn.closest('.profile-action-group')?.querySelector('.profile-notify-btn');
    if (notifyBtn) {
      const wasHidden = notifyBtn.style.display === 'none';
      notifyBtn.style.display = nowFollowing ? '' : 'none';
      if (wasHidden && nowFollowing) {
        notifyBtn.classList.add('pop-in');
        setTimeout(() => notifyBtn.classList.remove('pop-in'), 500);

        // Also trigger a small ring after the pop
        setTimeout(() => {
          notifyBtn.classList.add('ringing');
          setTimeout(() => notifyBtn.classList.remove('ringing'), 600);
        }, 300);
      }
    }

    // Update the follow/mutual label in the banner
    renderProfileBannerFollowLabel(relationship);

    showToast(nowFollowing ? 'Now following' : (nowRequested ? 'Follow requested' : 'Unfollowed'));
  } catch (err) {
    btn.innerHTML = originalHTML;
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
  const icon = btn.querySelector('svg, iconify-icon');

  btn.dataset.notifying = willNotify ? 'true' : 'false';
  btn.classList.toggle('notifying', willNotify);
  btn.title = willNotify ? 'Stop post notifications' : 'Get notified about posts';

  // Replace innerHTML to ensure the iconify-icon is fresh and updates immediately
  btn.innerHTML = `<iconify-icon icon="${willNotify ? 'ph:bell-fill' : 'ph:bell-bold'}" style="font-size: 15px;"></iconify-icon>`;

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
    btn.innerHTML = `<iconify-icon icon="${nowNotifying ? 'ph:bell-fill' : 'ph:bell-bold'}" style="font-size: 15px;"></iconify-icon>`;

    showToast(nowNotifying ? 'Notifications on for this user' : 'Notifications off for this user');
  } catch (err) {
    btn.dataset.notifying = isNotifying ? 'true' : 'false';
    btn.classList.toggle('notifying', isNotifying);
    btn.title = isNotifying ? 'Stop post notifications' : 'Get notified about posts';
    btn.innerHTML = `<iconify-icon icon="${isNotifying ? 'ph:bell-fill' : 'ph:bell-bold'}" style="font-size: 15px;"></iconify-icon>`;
    showToast('Failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

export async function handleBlockToggle(btn) {
  if (btn.disabled) return;
  const accountId = btn.dataset.accountId;
  const isBlocked = btn.dataset.blocked === 'true';

  if (store.get('pref_confirm_interactions') === 'true') {
    const action = isBlocked ? 'unblock' : 'block';
    // Find user context
    const postEl = btn.closest('.feed-status, .post-item, .profile-drawer, .post-thread-item');
    const name = postEl?.querySelector('.post-display-name, .profile-display-name')?.textContent || 'this user';
    const acct = postEl?.querySelector('.post-acct, .profile-acct')?.textContent || '';
    const previewHTML = `<div style="font-weight:600;">Action on ${name}</div><div style="font-size:11px; opacity:0.7;">${acct}</div>`;

    const confirmed = await showConfirm(`Are you sure you want to ${action} this user?`, `Confirm ${action.charAt(0).toUpperCase() + action.slice(1)}`, previewHTML);
    if (!confirmed) {
      btn.disabled = false;
      return;
    }
  }

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
      updateFollowButtonUI(followBtn, relationship, followBtn.dataset.locked === 'true');
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

  if (store.get('pref_confirm_interactions') === 'true') {
    const action = isMuted ? 'unmute' : 'mute';
    // Find user context
    const postEl = btn.closest('.feed-status, .post-item, .profile-drawer, .post-thread-item');
    const name = postEl?.querySelector('.post-display-name, .profile-display-name')?.textContent || 'this user';
    const acct = postEl?.querySelector('.post-acct, .profile-acct')?.textContent || '';
    const previewHTML = `<div style="font-weight:600;">Action on ${name}</div><div style="font-size:11px; opacity:0.7;">${acct}</div>`;

    const confirmed = await showConfirm(`Are you sure you want to ${action} this user?`, `Confirm ${action.charAt(0).toUpperCase() + action.slice(1)}`, previewHTML);
    if (!confirmed) {
      btn.disabled = false;
      return;
    }
  }

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
      updateFollowButtonUI(followBtn, relationship, followBtn.dataset.locked === 'true');
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
    const safeTag = encodeURIComponent(tag);
    const endpoint = isFollowing ? `/api/v1/tags/${safeTag}/unfollow` : `/api/v1/tags/${safeTag}/follow`;
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
      if (!state.followedHashtags) state.followedHashtags = [];
      if (!state.followedHashtags.some(t => t.name.toLowerCase() === tag.toLowerCase())) {
        state.followedHashtags.push(tagInfo);
      }
    } else {
      state.followedHashtags = (state.followedHashtags || []).filter(t => t.name.toLowerCase() !== tag.toLowerCase());
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
  window.handleFavoriteToggle = handleFavoriteToggle;
  if (btn.disabled) return;
  const postId = btn.dataset.postId;
  const isFavourited = btn.dataset.favourited === 'true';
  const willBeFavourited = !isFavourited;
  const originalFavourited = isFavourited;
  const icon = btn.querySelector('svg, iconify-icon');
  const countSpan = btn.querySelector('.post-fav-count');
  const originalCount = countSpan ? parseInt(countSpan.textContent) || 0 : 0;

  btn.disabled = true;

  if (store.get('pref_confirm_interactions') === 'true') {
    const isActuallyFavourited = btn.dataset.favourited === 'true';
    const action = isActuallyFavourited ? 'unfavorite' : 'favorite';

    // Find preview content by searching for the parent post container
    const postEl = btn.closest('.feed-status, .post-item, .notification-item, .post-thread-item, article.post, .post') ||
      document.querySelector(`[data-id="${postId}"]`);

    // Capture content, media, and quotes for a high-fidelity preview
    let previewHTML = '';
    if (postEl) {
      const content = postEl.querySelector('.post-content, .status-content')?.outerHTML || '';
      const media = postEl.querySelector('.post-media, .post-media-grid')?.outerHTML || '';
      const quote = postEl.querySelector('.post-quote')?.outerHTML || '';
      const card = postEl.querySelector('.post-card')?.outerHTML || '';

      previewHTML = (content + media + quote + card).replace(/onclick="[^"]*"/g, ''); // Strip interactions
    }

    // Fallback: if no text found, show author info
    if (!previewHTML && postEl) {
      const name = postEl.querySelector('.post-display-name, .profile-display-name')?.textContent || 'this post';
      const acct = postEl.querySelector('.post-acct, .profile-acct')?.textContent || '';
      previewHTML = `<div style="font-weight:600;">Post by ${name}</div><div style="font-size:11px; opacity:0.7;">${acct}</div>`;
    }

    const confirmed = await showConfirm(`Are you sure you want to ${action} this post?`, `Confirm ${action.charAt(0).toUpperCase() + action.slice(1)}`, previewHTML);
    if (!confirmed) {
      btn.disabled = false;
      return;
    }
  }

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
  if (icon) {
    if (icon.tagName.toLowerCase() === 'iconify-icon') {
      icon.setAttribute('icon', willBeFavourited ? 'ph:star-fill' : 'ph:star-bold');
    } else {
      icon.setAttribute('fill', 'currentColor');
      if (!willBeFavourited) {
        setTimeout(() => {
          btn.classList.add('unfavorite-fade');
          setTimeout(() => { icon.setAttribute('fill', 'none'); btn.classList.remove('unfavorite-fade'); }, 300);
        }, 500);
      }
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
    applyCountsFromStatus(post);
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
  const icon = btn.querySelector('svg, iconify-icon');

  btn.disabled = true;

  btn.dataset.bookmarked = willBeBookmarked ? 'true' : 'false';
  btn.classList.toggle('bookmarked', willBeBookmarked);
  btn.title = willBeBookmarked ? 'Remove bookmark' : 'Bookmark';
  if (icon) {
    if (icon.tagName.toLowerCase() === 'iconify-icon') {
      icon.setAttribute('icon', willBeBookmarked ? 'ph:bookmark-simple-fill' : 'ph:bookmark-simple-bold');
    } else {
      icon.setAttribute('fill', willBeBookmarked ? 'currentColor' : 'none');
    }
  }
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
    if (icon) {
      if (icon.tagName.toLowerCase() === 'iconify-icon') {
        icon.setAttribute('icon', isBookmarked ? 'ph:bookmark-simple-fill' : 'ph:bookmark-simple-bold');
      } else {
        icon.setAttribute('fill', isBookmarked ? 'currentColor' : 'none');
      }
    }
    showToast('Failed to bookmark: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

window.handleFavoriteToggle = handleFavoriteToggle;

/* ── Following drawer ──────────────────────────────────────────────── */

export function closeFollowingDrawer() {
  const drawer = $('following-drawer');
  const backdrop = $('following-backdrop');
  if (drawer) {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  }
  if (backdrop) backdrop.classList.remove('open');
}

export async function openFollowingDrawer(accountId, server) {
  return openUserListDrawer(accountId, server, 'following');
}

export async function openFollowersDrawer(accountId, server) {
  return openUserListDrawer(accountId, server, 'followers');
}

async function openUserListDrawer(accountId, server, type = 'following') {
  const drawer = $('following-drawer');
  const backdrop = $('following-backdrop');
  const content = $('following-content');
  const searchInput = $('following-search-input');
  const titleEl = $('following-drawer-title');
  const inner = drawer.querySelector('.following-drawer-inner');

  if (!drawer || !backdrop || !content) return;

  const isFollowing = type === 'following';
  if (titleEl) titleEl.textContent = isFollowing ? 'Following' : 'Followers';
  if (searchInput) searchInput.placeholder = isFollowing ? 'Search people you follow...' : 'Search people...';

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  content.innerHTML = '<div class="profile-loading"><div class="spinner"></div></div>';
  if (searchInput) searchInput.value = '';

  const srv = server || state.server;
  let allUsers = [];
  let maxId = null;
  let isLoading = false;

  const renderUserHtml = (account, relationship) => {
    const isFollowingAccount = relationship ? relationship.following : (state.knownNotFollowing ? !state.knownNotFollowing.has(account.id) : true);
    const followedBy = relationship ? relationship.followed_by : false;
    const isRequested = relationship ? relationship.requested : false;
    const displayName = renderCustomEmojis(account.display_name || account.username, account.emojis);

    let followBtnClass = `profile-follow-btn ${isFollowingAccount ? 'following' : ''}`;
    let followBtnText = isFollowingAccount ? 'Following' : (account.locked ? 'Request' : 'Follow');
    let followBtnIcon = isFollowingAccount ? 'ph:user-check-bold' : (account.locked ? 'ph:lock-key-bold' : 'ph:user-plus-bold');

    if (isRequested) {
      followBtnText = 'Requested';
      followBtnIcon = 'ph:hourglass-bold';
      followBtnClass += ' requested';
    } else if (isFollowingAccount && followedBy) {
      followBtnText = 'Mutual';
      followBtnIcon = 'ph:handshake-bold';
    } else if (!isFollowingAccount && followedBy) {
      followBtnText = account.locked ? 'Request Back' : 'Follow Back';
      if (account.locked) followBtnIcon = 'ph:lock-key-bold';
    }

    return `
      <div class="following-user-row">
        <div class="following-user-avatar" data-profile-id="${escapeHTML(account.id)}" data-profile-server="${escapeHTML(srv)}" style="cursor:pointer;">
          <img src="${escapeHTML(account.avatar_static || account.avatar)}" alt="" onerror="this.onerror=null;this.src=window._AVATAR_PLACEHOLDER"/>
        </div>
        <div class="following-user-info">
          <div class="following-user-name" data-profile-id="${escapeHTML(account.id)}" data-profile-server="${escapeHTML(srv)}" style="cursor:pointer;">
            <span class="following-name-text">${displayName}</span>
          </div>
          <div class="following-user-acct">
            <span class="following-acct-text">@${escapeHTML(account.acct)}</span>
          </div>
        </div>
        <button class="${followBtnClass}" data-account-id="${escapeHTML(account.id)}" data-following="${isFollowingAccount}">
          <iconify-icon icon="${followBtnIcon}" style="font-size: 13px; margin-right: 4px; vertical-align: -2px;"></iconify-icon>
          <span>${followBtnText}</span>
        </button>
      </div>`;
  };

  const renderUserList = (users, relationshipsMap = {}) => {
    if (!users || !users.length) {
      content.innerHTML = `<div class="following-empty">No ${type} found.</div>`;
      return;
    }
    content.innerHTML = users.map(u => renderUserHtml(u, relationshipsMap[u.id])).join('');
  };

  const loadUsers = async (isAppend = false) => {
    if (isLoading) return;
    isLoading = true;

    let loadingIndicator = null;
    if (!isAppend) {
      content.innerHTML = '<div class="profile-loading"><div class="spinner"></div></div>';
      allUsers = [];
      maxId = null;
    } else {
      loadingIndicator = document.createElement('div');
      loadingIndicator.className = 'profile-loading-more';
      loadingIndicator.innerHTML = '<div class="spinner"></div><span>Loading more…</span>';
      content.appendChild(loadingIndicator);
    }

    try {
      let url = `https://${srv}/api/v1/accounts/${accountId}/${type}?limit=40`;
      if (isAppend && maxId) {
        url += `&max_id=${maxId}`;
      }

      const res = await fetch(url, {
        headers: state.token ? { 'Authorization': `Bearer ${state.token}` } : {},
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('Failed to load');

      const linkHeader = res.headers.get('link');
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<[^>]+max_id=([^&>]+)[^>]*>;\s*rel="next"/);
        maxId = nextMatch ? nextMatch[1] : null;
      } else {
        maxId = null;
      }

      const users = await res.json();

      let relationshipsMap = {};
      if (users.length > 0 && state.token) {
        try {
          const relRes = await apiGet(`/api/v1/accounts/relationships?${users.map(u => `id[]=${u.id}`).join('&')}`, state.token, srv);
          relRes.forEach(r => relationshipsMap[r.id] = r);
        } catch (e) { }
      }

      if (loadingIndicator) loadingIndicator.remove();

      if (isAppend) {
        allUsers = allUsers.concat(users);
        const tmp = document.createElement('div');
        tmp.innerHTML = users.map(u => renderUserHtml(u, relationshipsMap[u.id])).join('');
        while (tmp.firstChild) content.appendChild(tmp.firstChild);
      } else {
        allUsers = users;
        renderUserList(allUsers, relationshipsMap);
      }
    } catch (err) {
      if (loadingIndicator) loadingIndicator.remove();
      if (!isAppend) content.innerHTML = `<div class="following-empty" style="color:var(--danger)">Failed to load ${type} list</div>`;
    } finally {
      isLoading = false;
    }
  };

  // Initial load
  await loadUsers(false);

  // Infinite scroll
  if (inner) {
    inner.onscroll = () => {
      if (searchInput && searchInput.value.trim()) return; // Don't infinite scroll while searching
      if (!maxId || isLoading) return;
      if (inner.scrollTop + inner.clientHeight >= inner.scrollHeight - 200) {
        loadUsers(true);
      }
    };
  }

  if (searchInput) {
    let searchTimeout;
    searchInput.oninput = (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      if (!query) {
        loadUsers(false);
        return;
      }

      searchTimeout = setTimeout(async () => {
        content.innerHTML = '<div class="profile-loading"><div class="spinner"></div></div>';
        try {
          const searchRes = await apiGet(`/api/v2/search?q=${encodeURIComponent(query)}&type=accounts&limit=40${isFollowing ? '&following=true' : ''}`, state.token, srv);
          if (searchRes && searchRes.accounts && searchRes.accounts.length > 0) {
            let relationshipsMap = {};
            try {
              const relRes = await apiGet(`/api/v1/accounts/relationships?${searchRes.accounts.map(u => `id[]=${u.id}`).join('&')}`, state.token, srv);
              relRes.forEach(r => relationshipsMap[r.id] = r);
            } catch (e) { }
            renderUserList(searchRes.accounts, relationshipsMap);
          } else {
            renderUserList([]);
          }
        } catch (err) {
          content.innerHTML = `<div class="following-empty" style="color:var(--danger)">Search failed</div>`;
        }
      }, 400);
    };
  }
}
