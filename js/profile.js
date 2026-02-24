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
  escapeHTML, sanitizeHTML, renderCustomEmojis, formatNum,
} from './utils.js';

/* ── Open / close ──────────────────────────────────────────────────── */

export function openProfileDrawer(accountId, server) {
  const drawer = $('profile-drawer');
  const backdrop = $('profile-backdrop');
  const content = $('profile-content');

  content.innerHTML = '<div class="profile-loading"><div class="spinner"></div></div>';
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

    // Push history state for back button
  history.pushState({ drawer: 'profile-drawer' }, '', '');

  const srv = server || state.server;

  Promise.all([
    apiGet(`/api/v1/accounts/${accountId}`, state.token, srv),
    apiGet(`/api/v1/accounts/${accountId}/statuses?limit=20&exclude_replies=true`, state.token, srv),
    apiGet(`/api/v1/accounts/relationships?id[]=${accountId}`, state.token, srv).catch(() => []),
    apiGet(`/api/v1/accounts/${accountId}/statuses?pinned=true`, state.token, srv).catch(() => []),
  ]).then(([account, statuses, relationships, pinnedStatuses]) => {
    const relationship = relationships && relationships.length ? relationships[0] : null;
    const isFollowing = relationship && relationship.following;

    const headerImg = account.header && !account.header.includes('missing')
      ? `<img class="profile-header-img" src="${escapeHTML(account.header)}" alt="" loading="lazy"/>`
      : '<div class="profile-header-img empty"></div>';

    const bio = account.note ? `<div class="profile-bio">${account.note}</div>` : '';

    const isSelf = state.account && state.account.id === accountId;
    const isNotifying = relationship && relationship.notifying;

    const notifyButton = (!isSelf && isFollowing)
      ? `<button class="profile-notify-btn ${isNotifying ? 'notifying' : ''}"
          data-account-id="${accountId}" data-notifying="${isNotifying ? 'true' : 'false'}"
          title="${isNotifying ? 'Stop post notifications' : 'Get notified about posts'}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${isNotifying ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>`
      : '';

    const followButton = isSelf
      ? `<a class="profile-edit-btn" href="https://${srv}/settings/profile" target="_blank" rel="noopener">Edit Profile</a>`
      : `<button class="profile-follow-btn ${isFollowing ? 'following' : ''}"
          data-account-id="${accountId}" data-following="${isFollowing ? 'true' : 'false'}">
          ${isFollowing ? 'Following' : 'Follow'}</button>`;

    const postsHtml = statuses.length
      ? statuses.map(s => renderPost(s)).join('')
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
      ${headerImg}
      <div class="profile-identity">
        <div class="profile-avatar-wrap">
          <img class="profile-avatar-large" src="${escapeHTML(account.avatar_static || account.avatar)}" alt=""/>
        </div>
        <div class="profile-name-row">
          <div>
            <div class="profile-display-name">${renderCustomEmojis(account.display_name || account.username, account.emojis)}</div>
            <div class="profile-acct">@${escapeHTML(account.acct)}</div>
          </div>
          <div class="profile-action-group">${followButton}${notifyButton}</div>
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
      <div class="profile-posts-header">recent posts</div>
      ${postsHtml}`;

    // Wire pinned carousel
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
        carouselEl.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientY; }, { passive: true });
        carouselEl.addEventListener('touchend', e => {
          const dx = e.changedTouches[0].clientX - touchStartX;
          if (Math.abs(dx) > 40) goTo(dx < 0 ? current + 1 : current - 1);
        }, { passive: true });
      }
    }
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
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
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

    btn.dataset.following = nowFollowing ? 'true' : 'false';
    btn.textContent = nowFollowing ? 'Following' : 'Follow';
    btn.classList.toggle('following', nowFollowing);

    const notifyBtn = btn.closest('.profile-action-group')?.querySelector('.profile-notify-btn');
    if (notifyBtn) notifyBtn.style.display = nowFollowing ? '' : 'none';

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
