// Position overlay pill relative to #feed-posts
function positionOverlayPill() {
  const pill = document.getElementById('new-posts-pill');
  const feed = document.getElementById('feed-posts');
  if (!pill || !feed) return;
  const rect = feed.getBoundingClientRect();
  pill.style.left = (rect.left + rect.width / 2) + 'px';
  pill.style.top = (rect.top + window.scrollY + 20) + 'px';
}

window.addEventListener('scroll', positionOverlayPill);
window.addEventListener('resize', positionOverlayPill);

/**
 * @module feed
 * Home feed: loading, filtering, polling, pagination, pending-post buffering.
 */

import { $, state } from './state.js';
import { apiGet } from './api.js';
import { setLoading, setError, showToast, updateTabLabel } from './ui.js';
import { renderPost } from './render.js';
import { getDemoHomePosts, getDemoHashtagData } from './demo.js';

/* ── Key helpers ───────────────────────────────────────────────────── */

export let overlayPillDismissed = false;

export function activeFeedKey() {
  const filter = state.feedFilter || 'all';
  if (filter === 'hashtags') {
    return 'feed_hashtags_' + (state.selectedHashtagFilter || 'all');
  }
  return 'feed_' + filter;
}

export function updateTabPill(feedKey) {
  // Overlay pill logic
  const overlayPill = document.getElementById('new-posts-pill');
  const count = (state.pendingPosts[feedKey] || []).length;
  if (!overlayPill) return;
  if (count === 0) {
    overlayPill.style.display = 'none';
    overlayPill.textContent = 'New posts';
    return;
  }
  overlayPill.textContent = count > 99 ? '99+ new posts' : `${count} new post${count > 1 ? 's' : ''}`;
  overlayPill.style.display = '';
  positionOverlayPill();
}

// ...existing code...
// Overlay pill click handler
function setupOverlayPill() {
  const overlayPill = document.getElementById('new-posts-pill');
  if (!overlayPill) return;
  overlayPill.onclick = () => {
    flushPendingPosts(activeFeedKey(), true);
    // Do not hide here; updateTabPill will handle visibility
  };
}

let scrollPillListenerAttached = false;

// Hide overlay pill on scroll up
function setupOverlayPillScroll() {
  if (scrollPillListenerAttached) return;
  scrollPillListenerAttached = true;
  window.addEventListener('scroll', () => {
    const overlayPill = document.getElementById('new-posts-pill');
    if (!overlayPill) return;
    const feedKey = activeFeedKey();
    const pending = state.pendingPosts[feedKey] || [];
    if (pending.length === 0) {
      overlayPill.style.display = 'none';
      return;
    }
    // If the user scrolls to the top of the feed (where new posts would be), dismiss the pill
    const feed = document.getElementById('feed-posts');
    if (feed) {
      const rect = feed.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < 100) {
        overlayPillDismissed = true;
        overlayPill.style.display = 'none';
        return;
      }
    }
    overlayPill.style.display = pending.length > 0 && !overlayPillDismissed ? '' : 'none';
    positionOverlayPill();
  });
}

/* ── Rendering ─────────────────────────────────────────────────────── */

function renderFilteredPosts(displayPosts) {
  const container = $('feed-posts');
  const filter = state.feedFilter;

  if (!displayPosts.length) {
    let msg = 'Nothing here yet.';
    if (filter === 'following') msg = 'No recent posts from people you follow.';
    if (filter === 'hashtags') msg = 'No recent posts matching your hashtags.';
    container.innerHTML = `<div class="feed-status"><div class="status-icon">📭</div><p>${msg}</p></div>`;
    return;
  }

  let maxId = state.homeMaxId;
  if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
    maxId = state.hashtagMaxId;
  }

  const html = displayPosts.map(p => renderPost(p, { tags: p._sourceTags || [] })).join('');
  const loadMoreBtn = maxId ? '<button class="load-more-btn" data-feed="feed">Load More</button>' : '';
  container.innerHTML = html + loadMoreBtn;
  setTimeout(checkInfiniteScroll, 100);
}

/* ── Following filter ──────────────────────────────────────────────── */

export async function filterForFollowing(page) {
  if (state.account && state.account.id) {
    state.knownFollowing.add(state.account.id);
  }
  const idsToCheck = new Set();
  page.forEach(p => {
    const authorId = (p.reblog || p).account.id;
    if (!state.knownFollowing.has(authorId) && !state.knownNotFollowing.has(authorId)) {
      idsToCheck.add(authorId);
    }
  });

  // Removed errant overlayPillDismissed declaration
  const idsArr = Array.from(idsToCheck);
  if (idsArr.length > 0) {
    for (let i = 0; i < idsArr.length; i += 40) {
      const chunk = idsArr.slice(i, i + 40);
      const relPath = '/api/v1/accounts/relationships?' + chunk.map(id => `id[]=${id}`).join('&');
      try {
        const rels = await apiGet(relPath, state.token);
        rels.forEach(r => {
          if (r.following) state.knownFollowing.add(r.id);
          else state.knownNotFollowing.add(r.id);
        });
      } catch {
        chunk.forEach(id => state.knownFollowing.add(id)); // fail open
      }
    }
  }
  return page.filter(p => {
    const inner = p.reblog || p;
    return state.knownFollowing.has(inner.account.id);
  });
}

/* ── Ensure home feed is fetched ───────────────────────────────────── */

export async function ensureHomeFeedLoaded() {
  if (state.demoMode) {
    if (!state.homeFeed) state.homeFeed = getDemoHomePosts();
    if (!state.followedHashtags) state.followedHashtags = getDemoHashtagData().tags;
    return;
  }
  if (!state.homeFeed) {
    const posts = await apiGet('/api/v1/timelines/home?limit=40', state.token);
    const tags = await apiGet('/api/v1/followed_tags?limit=100', state.token).catch(() => []);
    state.followedHashtags = tags;
    const followedTagNames = new Set(tags.map(t => t.name.toLowerCase()));

    posts.forEach(p => {
      p._sourceTags = [];
      const inner = p.reblog || p;
      if (inner.tags && Array.isArray(inner.tags)) {
        inner.tags.forEach(t => {
          if (followedTagNames.has(t.name.toLowerCase())) {
            p._sourceTags.push(t.name.toLowerCase());
          }
        });
      }
    });

    state.homeFeed = posts;
    state.homeMaxId = posts.length ? posts[posts.length - 1].id : null;
  }
}

/* ── Hashtag feed ──────────────────────────────────────────────────── */

async function loadHashtagsFeed() {
  $('feed-posts').innerHTML = '';

  if (!state.demoMode) {
    const tags = await apiGet('/api/v1/followed_tags?limit=100', state.token).catch(() => []);
    state.followedHashtags = tags;
  }
  await ensureHomeFeedLoaded();
  const tags = state.followedHashtags || [];

  // Build filter dropdown
  const filterSelect = $('hashtag-filter-select');
  filterSelect.innerHTML = '<option value="all">All Followed Hashtags</option>';
  const sortedTags = [...tags].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  let found = state.selectedHashtagFilter === 'all';
  sortedTags.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.name.toLowerCase();
    opt.textContent = '#' + t.name;
    if (state.selectedHashtagFilter === t.name.toLowerCase()) { opt.selected = true; found = true; }
    filterSelect.appendChild(opt);
  });

  // Add searched tag if not following
  if (!found && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
    const opt = document.createElement('option');
    opt.value = state.selectedHashtagFilter;
    opt.textContent = '#' + state.selectedHashtagFilter;
    opt.selected = true;
    filterSelect.appendChild(opt);
  }

  // ── Follow suggestion strip ──────────────────────────────────────
  const followRow = document.getElementById('hashtag-follow-row');
  const followStripName = document.getElementById('hashtag-follow-strip-name');
  const followStripBtn = document.getElementById('hashtag-follow-strip-btn');
  const selectedTag = state.selectedHashtagFilter;
  const isAlreadyFollowed = !selectedTag || selectedTag === 'all' ||
    tags.some(t => t.name.toLowerCase() === selectedTag.toLowerCase());

  if (followRow) {
    if (!isAlreadyFollowed && selectedTag && selectedTag !== 'all') {
      // Show strip with tag name
      if (followStripName) followStripName.textContent = '#' + selectedTag;
      followRow.style.display = '';

      // Wire Follow button (replace any previous listener cleanly)
      if (followStripBtn) {
        const newBtn = followStripBtn.cloneNode(true); // remove old listeners
        followStripBtn.replaceWith(newBtn);
        newBtn.addEventListener('click', async () => {
          newBtn.disabled = true;
          newBtn.textContent = 'Following…';
          try {
            const res = await fetch(`https://${state.server}/api/v1/tags/${encodeURIComponent(selectedTag)}/follow`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
              cache: 'no-store',
            });
            if (!res.ok) throw new Error('Failed to follow hashtag');
            const tagInfo = await res.json();
            // Update local state
            if (!state.followedHashtags) state.followedHashtags = [];
            if (!state.followedHashtags.some(t => t.name.toLowerCase() === selectedTag.toLowerCase())) {
              state.followedHashtags.push(tagInfo);
            }
            const { showToast } = await import('./ui.js');
            showToast(`Following #${selectedTag}`);
            // Hide strip and rebuild dropdown to include new tag
            followRow.style.display = 'none';
            loadHashtagsFeed();
          } catch (err) {
            newBtn.disabled = false;
            newBtn.textContent = '+ Follow';
            const { showToast } = await import('./ui.js');
            showToast('Failed to follow: ' + err.message);
          }
        });
      }
    } else {
      followRow.style.display = 'none';
    }
  }

  let display = [];
  if (state.demoMode) {
    display = state.homeFeed.filter(p => p._sourceTags && p._sourceTags.length > 0);
    if (state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
      display = display.filter(p => p._sourceTags.includes(state.selectedHashtagFilter));
    }
  } else {
    if (state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
      const tag = encodeURIComponent(state.selectedHashtagFilter);
      const tagPosts = await apiGet(`/api/v1/timelines/tag/${tag}?limit=40`, state.token);
      tagPosts.forEach(p => p._sourceTags = [state.selectedHashtagFilter]);
      state.hashtagFeed = tagPosts;
      state.hashtagMaxId = tagPosts.length ? tagPosts[tagPosts.length - 1].id : null;
      display = tagPosts;
    } else {
      display = state.homeFeed.filter(p => p._sourceTags && p._sourceTags.length > 0);
      state.hashtagMaxId = state.homeMaxId;
    }
  }

  renderFilteredPosts(display);
}

/* ── Main feed tab loader ──────────────────────────────────────────── */

export async function loadFeedTab(scrollTop = true) {
  if (scrollTop) window.scrollTo({ top: 0, behavior: 'instant' });
  const filter = state.feedFilter;
  const feedKey = activeFeedKey();

  // Merge pending posts into appropriate timeline on tab switch
  if (state.pendingPosts[feedKey] && state.pendingPosts[feedKey].length > 0) {
    if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
      state.hashtagFeed = [...state.pendingPosts[feedKey], ...(state.hashtagFeed || [])];
    } else {
      state.homeFeed = [...state.pendingPosts[feedKey], ...(state.homeFeed || [])];
    }
    state.pendingPosts[feedKey] = [];
    overlayPillDismissed = false;
  }
  updateTabPill(feedKey);

  // Setup overlay pill handlers
  setupOverlayPill();
  setupOverlayPillScroll();

  setLoading('feed', true);
  setError('feed', null);

  try {
    if (filter === 'all') {
      await ensureHomeFeedLoaded();
      renderFilteredPosts(state.homeFeed);
    } else if (filter === 'following') {
      await ensureHomeFeedLoaded();
      const display = state.demoMode
        ? state.homeFeed.filter(p => !p.reblog)
        : await filterForFollowing(state.homeFeed);
      renderFilteredPosts(display);
    } else if (filter === 'hashtags') {
      await loadHashtagsFeed();
    }
  } catch (err) {
    setError('feed', 'Failed to load feed: ' + err.message);
  }
  setLoading('feed', false);
}

/* ── Polling ───────────────────────────────────────────────────────── */

let pollInterval = null;
let notifPollInterval = null;
let _pollNotifications = null;

/** Provide the notifications poll fn to avoid circular import. */
export function registerNotifPoller(fn) { _pollNotifications = fn; }

export function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(pollForNewPosts, 20_000);
  if (!notifPollInterval && _pollNotifications) {
    notifPollInterval = setInterval(_pollNotifications, 30_000);
  }
}

export function stopPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
  if (notifPollInterval) clearInterval(notifPollInterval);
  notifPollInterval = null;
}

async function pollForNewPosts() {
  if (!state.token || state.demoMode || state.activeTab !== 'feed') return;
  const filter = state.feedFilter;

  let minIdToUse = state.homeFeed && state.homeFeed.length > 0 ? state.homeFeed[0].id : null;
  if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
    minIdToUse = state.hashtagFeed && state.hashtagFeed.length > 0 ? state.hashtagFeed[0].id : null;
  }
  if (!minIdToUse) return;

  try {
    let newPosts = [];
    if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
      const tag = encodeURIComponent(state.selectedHashtagFilter);
      newPosts = await apiGet(`/api/v1/timelines/tag/${tag}?limit=40&min_id=${minIdToUse}`, state.token);
      newPosts.forEach(p => p._sourceTags = [state.selectedHashtagFilter]);
      newPosts.sort((a, b) => (a.id.length !== b.id.length ? b.id.length - a.id.length : (b.id > a.id ? 1 : b.id < a.id ? -1 : 0)));
      if (newPosts.length > 0) state.hashtagFeed = [...newPosts, ...state.hashtagFeed];
    } else {
      newPosts = await apiGet(`/api/v1/timelines/home?limit=40&min_id=${minIdToUse}`, state.token);
      const followedTagNames = new Set((state.followedHashtags || []).map(t => t.name.toLowerCase()));
      newPosts.forEach(p => {
        p._sourceTags = [];
        const inner = p.reblog || p;
        if (inner.tags && Array.isArray(inner.tags)) {
          inner.tags.forEach(t => {
            if (followedTagNames.has(t.name.toLowerCase())) p._sourceTags.push(t.name.toLowerCase());
          });
        }
      });
      newPosts.sort((a, b) => (a.id.length !== b.id.length ? b.id.length - a.id.length : (b.id > a.id ? 1 : b.id < a.id ? -1 : 0)));
      if (newPosts.length > 0) state.homeFeed = [...newPosts, ...state.homeFeed];
    }

    if (!newPosts.length) return;

    let display = newPosts;
    if (filter === 'following') display = await filterForFollowing(newPosts);
    else if (filter === 'hashtags') {
      if (state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') display = newPosts;
      else display = newPosts.filter(p => p._sourceTags && p._sourceTags.length > 0);
    }
    if (!display.length) return;

    const feedKey = activeFeedKey();
    state.pendingPosts[feedKey] = [...display, ...(state.pendingPosts[feedKey] || [])];
    overlayPillDismissed = false;
    updateTabPill(feedKey);
  } catch (err) {
    console.warn('Silent polling failed:', err.message);
  }
}

/* ── Pending post flushing ─────────────────────────────────────────── */

export function flushPendingPosts(feedKey, scrollToTop) {
  const posts = state.pendingPosts[feedKey] || [];
  if (!posts.length) return;

  const container = $('feed-posts');
  if (!container) return;

  const html = posts.map(p => renderPost(p, { tags: p._sourceTags || [] })).join('');
  state.pendingPosts[feedKey] = [];
  updateTabPill(feedKey);

  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const frag = document.createDocumentFragment();
  while (tmp.firstChild) frag.appendChild(tmp.firstChild);

  if (scrollToTop) {
    container.insertBefore(frag, container.firstChild);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    document.documentElement.style.overflowAnchor = 'none';
    const currentScroll = window.scrollY || document.documentElement.scrollTop;
    const originalHeight = document.documentElement.scrollHeight;
    container.insertBefore(frag, container.firstChild);
    const newHeight = document.documentElement.scrollHeight;
    window.scrollTo(0, currentScroll + (newHeight - originalHeight));
    document.documentElement.style.overflowAnchor = '';
  }
}

/* ── Scroll / infinite scroll ──────────────────────────────────────── */

export function checkInfiniteScroll() {
  const activePanel = document.querySelector('.tab-panel.active');
  if (!activePanel) return;
  const btn = activePanel.querySelector('.load-more-btn');
  if (btn && !btn.disabled) {
    const rect = btn.getBoundingClientRect();
    if (rect.top > 0 && rect.top <= window.innerHeight + 800) {
      handleLoadMore(btn);
    }
  }
}

let lastScrollY = 0;
let scrollingUp = false;

export function handleScrollDirection() {
  const currentY = window.scrollY || document.documentElement.scrollTop;
  scrollingUp = currentY < lastScrollY;

  if (state.activeTab === 'feed') {
    const feedKey = activeFeedKey();
    const pending = state.pendingPosts[feedKey] || [];
    if (scrollingUp && currentY < 200 && pending.length > 0) {
      flushPendingPosts(feedKey, false);
    }
  }
  lastScrollY = currentY;
}

/* ── Load more (pagination) ────────────────────────────────────────── */

export async function handleLoadMore(btn) {
  const filter = state.feedFilter;
  let maxIdToUse = state.homeMaxId;
  if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
    maxIdToUse = state.hashtagMaxId;
  }
  if (!maxIdToUse) return;

  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    let newPosts = [];
    if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
      const tag = encodeURIComponent(state.selectedHashtagFilter);
      newPosts = await apiGet(`/api/v1/timelines/tag/${tag}?limit=40&max_id=${maxIdToUse}`, state.token);
      newPosts.forEach(p => p._sourceTags = [state.selectedHashtagFilter]);
      state.hashtagFeed = [...(state.hashtagFeed || []), ...newPosts];
      state.hashtagMaxId = newPosts.length ? newPosts[newPosts.length - 1].id : null;
      maxIdToUse = state.hashtagMaxId;
    } else {
      newPosts = await apiGet(`/api/v1/timelines/home?limit=40&max_id=${state.homeMaxId}`, state.token);
      const followedTagNames = new Set((state.followedHashtags || []).map(t => t.name.toLowerCase()));
      newPosts.forEach(p => {
        p._sourceTags = [];
        const inner = p.reblog || p;
        if (inner.tags && Array.isArray(inner.tags)) {
          inner.tags.forEach(t => {
            if (followedTagNames.has(t.name.toLowerCase())) p._sourceTags.push(t.name.toLowerCase());
          });
        }
      });
      state.homeFeed = [...(state.homeFeed || []), ...newPosts];
      state.homeMaxId = newPosts.length ? newPosts[newPosts.length - 1].id : null;
      maxIdToUse = state.homeMaxId;
    }

    let display = newPosts;
    if (filter === 'following' && !state.demoMode) display = await filterForFollowing(newPosts);
    else if (filter === 'hashtags' && (!state.selectedHashtagFilter || state.selectedHashtagFilter === 'all')) {
      display = newPosts.filter(p => p._sourceTags && p._sourceTags.length > 0);
    }

    const html = display.map(p => renderPost(p, { tags: p._sourceTags || [] })).join('');
    const container = $('feed-posts');
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) container.insertBefore(tmp.firstChild, btn);

    btn.disabled = false;
    btn.textContent = 'Load More';
    if (!maxIdToUse) btn.remove();
    else setTimeout(checkInfiniteScroll, 100);
  } catch (err) {
    showToast('Failed to load more: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Load More';
  }
}
