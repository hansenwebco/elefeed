// Position overlay pill relative to #feed-posts horizontally
function positionOverlayPill() {
  const pill = document.getElementById('new-posts-pill');
  const feed = document.getElementById('feed-posts');
  if (!pill || !feed) return;
  const rect = feed.getBoundingClientRect();
  pill.style.left = (rect.left + rect.width / 2) + 'px';
  // Use CSS for vertical 'top' position to ensure it stays in same place across views
}

window.addEventListener('resize', positionOverlayPill);
// Call once on load to position initially
positionOverlayPill();

/**
 * @module feed
 * Home feed: loading, filtering, polling, pagination, pending-post buffering.
 */

import { $, state, store } from './state.js';
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

export function getFilteredPendingPosts(feedKey) {
  let posts = state.pendingPosts[feedKey] || [];
  if (!posts.length) return [];
  const showBoosts = store.get('pref_show_boosts') !== 'false';
  const showReplies = store.get('pref_show_replies') !== 'false';
  const showQuotes = store.get('pref_show_quotes') !== 'false';

  return posts.filter(p => {
    if (!showBoosts && p.reblog) return false;
    const inner = p.reblog || p;
    if (!showReplies && inner.in_reply_to_id) return false;
    if (!showQuotes && inner.quote) return false;
    return true;
  });
}

export function updateTabPill(feedKey) {
  // Overlay pill logic
  const overlayPill = document.getElementById('new-posts-pill');
  const count = getFilteredPendingPosts(feedKey).length;
  if (!overlayPill) return;
  if (count === 0) {
    overlayPill.style.display = 'none';
    overlayPill.textContent = 'New posts';
    document.title = 'Elefeed — A Tidy Mastodon Client';
    return;
  }
  overlayPill.textContent = count > 99 ? '99+ new posts' : `${count} new post${count > 1 ? 's' : ''}`;
  overlayPill.style.display = '';
  document.title = `Elefeed (${count > 99 ? '99+' : count}) — A Tidy Mastodon Client`;
  positionOverlayPill();
}

// ...existing code...
// Overlay pill click handler
function setupOverlayPill() {
  const overlayPill = document.getElementById('new-posts-pill');
  if (!overlayPill) return;

  // Clean up any old listener using replaceWith
  const newPill = overlayPill.cloneNode(true);
  overlayPill.parentNode.replaceChild(newPill, overlayPill);

  newPill.addEventListener('click', (e) => {
    e.preventDefault();
    flushPendingPosts(activeFeedKey(), true);
  });
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
    const pending = getFilteredPendingPosts(feedKey);
    if (pending.length === 0) {
      overlayPill.style.display = 'none';
      document.title = 'Elefeed — A Tidy Mastodon Client';
      return;
    }
    // If the user scrolls to the top of the feed (where new posts would be), dismiss the pill
    const feed = document.getElementById('feed-posts');
    if (feed) {
      const rect = feed.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < 150 && scrollingUp) {
        overlayPillDismissed = true;
        overlayPill.style.display = 'none';
        document.title = 'Elefeed — A Tidy Mastodon Client';
        return;
      }
    }
    overlayPill.style.display = pending.length > 0 && !overlayPillDismissed ? '' : 'none';
    if (overlayPill.style.display === 'none') {
      document.title = 'Elefeed — A Tidy Mastodon Client';
    } else {
      const count = pending.length;
      document.title = `Elefeed (${count > 99 ? '99+' : count}) — A Tidy Mastodon Client`;
    }
    positionOverlayPill();
  });
}

/* ── Rendering ─────────────────────────────────────────────────────── */

function renderFilteredPosts(displayPosts) {
  const container = $('feed-posts');
  const filter = state.feedFilter;

  // Apply feed filters (Boosts, Replies, Quotes)
  const showBoosts = store.get('pref_show_boosts') !== 'false';
  const showReplies = store.get('pref_show_replies') !== 'false';
  const showQuotes = store.get('pref_show_quotes') !== 'false';

  displayPosts = displayPosts.filter(p => {
    if (!showBoosts && p.reblog) return false;
    const inner = p.reblog || p;
    if (!showReplies && inner.in_reply_to_id) return false;
    if (!showQuotes && inner.quote) return false;
    return true;
  });

  if (!displayPosts.length) {
    let msg = 'Nothing here yet.';
    if (filter === 'following') msg = 'No recent posts from people you follow.';
    if (filter === 'hashtags') msg = 'No recent posts matching your hashtags.';
    if (filter === 'live') msg = 'No recent posts on this server.';
    container.innerHTML = `<div class="feed-status"><div class="status-icon">📭</div><p>${msg}</p></div>`;
    return;
  }

  let maxId = state.homeMaxId;
  if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
    maxId = state.hashtagMaxId;
  } else if (filter === 'live') {
    maxId = state.localMaxId;
  }

  const html = displayPosts.map(p => renderPost(p, { tags: p._sourceTags || [] })).join('');
  const loadMoreBtn = maxId ? '<button class="load-more-btn" data-feed="feed">Load More</button>' : '';
  container.innerHTML = html + loadMoreBtn;
  setTimeout(checkInfiniteScroll, 100);
}

/* ── Following filter ──────────────────────────────────────────────── */

export async function fetchRelationships(page) {
  if (state.account && state.account.id) {
    state.knownFollowing.add(state.account.id);
  }
  const idsToCheck = new Set();
  page.forEach(p => {
    // Add top-level account inherently if this came from home timeline? 
    // We'll just check what's given.
    const accountId = p.account.id;
    const authorId = (p.reblog || p).account.id;
    const quoteAuthorId = (p.reblog || p).quote?.account?.id;

    if (!state.knownFollowing.has(accountId) && !state.knownNotFollowing.has(accountId)) {
      idsToCheck.add(accountId);
    }
    if (!state.knownFollowing.has(authorId) && !state.knownNotFollowing.has(authorId)) {
      idsToCheck.add(authorId);
    }
    if (quoteAuthorId && !state.knownFollowing.has(quoteAuthorId) && !state.knownNotFollowing.has(quoteAuthorId)) {
      idsToCheck.add(quoteAuthorId);
    }
  });

  const idsArr = Array.from(idsToCheck);
  if (idsArr.length > 0) {
    const promises = [];
    for (let i = 0; i < idsArr.length; i += 40) {
      const chunk = idsArr.slice(i, i + 40);
      const relPath = '/api/v1/accounts/relationships?' + chunk.map(id => `id[]=${id}`).join('&');
      promises.push(
        apiGet(relPath, state.token).then(rels => {
          rels.forEach(r => {
            if (r.following) state.knownFollowing.add(r.id);
            else state.knownNotFollowing.add(r.id);
          });
        }).catch(() => { })
      );
    }
    await Promise.all(promises);
  }
}

export async function filterForFollowing(page) {
  await fetchRelationships(page);
  return page.filter(p => {
    const inner = p.reblog || p;
    return state.knownFollowing.has(inner.account.id);
  });
}

/* ── Ensure local feed is fetched ─────────────────────────────────── */

async function ensureLocalFeedLoaded() {
  if (!state.localFeed) {
    const posts = await apiGet('/api/v1/timelines/public?local=true&limit=40', state.token);
    state.localFeed = posts;
    state.localMaxId = posts.length ? posts[posts.length - 1].id : null;
  }
}

/* ── Ensure home feed is fetched ───────────────────────────────────── */

export async function ensureHomeFeedLoaded() {
  if (state.demoMode) {
    if (!state.homeFeed) state.homeFeed = getDemoHomePosts();
    if (!state.followedHashtags) state.followedHashtags = getDemoHashtagData().tags;
    return;
  }
  if (!state.homeFeed) {
    const [posts, tags] = await Promise.all([
      apiGet('/api/v1/timelines/home?limit=40', state.token),
      apiGet('/api/v1/followed_tags?limit=100', state.token).catch(() => [])
    ]);

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

  // 1. OPTIMISTIC UI UPDATE
  const filterSelect = $('hashtag-filter-select');
  if (filterSelect) {
    // Temporarily set the dropdown to the active tag so it displays instantly
    filterSelect.innerHTML = '';
    if (state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
      const opt = document.createElement('option');
      opt.value = state.selectedHashtagFilter;
      opt.textContent = '#' + state.selectedHashtagFilter;
      opt.selected = true;
      filterSelect.appendChild(opt);
    } else {
      filterSelect.innerHTML = '<option value="all">All Followed Hashtags</option>';
    }
  }

  const followRow = document.getElementById('hashtag-follow-row');
  const followStripName = document.getElementById('hashtag-follow-strip-name');
  if (followRow && followStripName && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
    const isFollowed = state.followedHashtags && state.followedHashtags.some(t => t.name.toLowerCase() === state.selectedHashtagFilter.toLowerCase());
    if (!isFollowed) {
      followStripName.textContent = '#' + state.selectedHashtagFilter;
      followRow.style.display = '';
    } else {
      followRow.style.display = 'none';
    }
  } else if (followRow) {
    followRow.style.display = 'none';
  }

  // 2. DATA FETCHING (Parallelized and deferred where possible)
  let tagPostsPromise = null;
  const isSpecificTag = state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all';

  if (!state.demoMode) {
    if (!state.followedHashtags) {
      // Background fetch followed tags if we don't have them
      state.followedHashtags = await apiGet('/api/v1/followed_tags?limit=100', state.token).catch(() => []);
    }

    if (isSpecificTag) {
      // If a specific tag is selected, we only need that tag's posts
      const tag = encodeURIComponent(state.selectedHashtagFilter);
      tagPostsPromise = apiGet(`/api/v1/timelines/tag/${tag}?limit=40`, state.token);
    } else {
      // If "all" followed tags is selected, we need the home feed
      await ensureHomeFeedLoaded();
    }
  } else if (!isSpecificTag) {
    await ensureHomeFeedLoaded();
  }

  const tags = state.followedHashtags || [];

  // Update filter dropdown properly now that we have tags
  if (filterSelect) {
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

    if (!found && isSpecificTag) {
      const opt = document.createElement('option');
      opt.value = state.selectedHashtagFilter;
      opt.textContent = '#' + state.selectedHashtagFilter;
      opt.selected = true;
      filterSelect.appendChild(opt);
    }
  }

  // ── Follow suggestion strip ──────────────────────────────────────
  const selectedTag = state.selectedHashtagFilter;
  const isAlreadyFollowed = !selectedTag || selectedTag === 'all' ||
    tags.some(t => t.name.toLowerCase() === selectedTag.toLowerCase());

  if (followRow) {
    if (!isAlreadyFollowed && isSpecificTag) {
      if (followStripName) followStripName.textContent = '#' + selectedTag;
      followRow.style.display = '';

      const followStripBtn = document.getElementById('hashtag-follow-strip-btn');
      if (followStripBtn) {
        const newBtn = followStripBtn.cloneNode(true);
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
            if (!state.followedHashtags) state.followedHashtags = [];
            if (!state.followedHashtags.some(t => t.name.toLowerCase() === selectedTag.toLowerCase())) {
              state.followedHashtags.push(tagInfo);
            }
            const { showToast } = await import('./ui.js');
            showToast(`Following #${selectedTag}`);
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
    if (isSpecificTag) {
      display = display.filter(p => p._sourceTags.includes(state.selectedHashtagFilter));
    }
  } else {
    if (isSpecificTag) {
      const tagPosts = await tagPostsPromise;
      tagPosts.forEach(p => p._sourceTags = [state.selectedHashtagFilter]);
      state.hashtagFeed = tagPosts;
      state.hashtagMaxId = tagPosts.length ? tagPosts[tagPosts.length - 1].id : null;
      display = tagPosts;
    } else {
      display = state.homeFeed.filter(p => p._sourceTags && p._sourceTags.length > 0);
      state.hashtagMaxId = state.homeMaxId;
    }
  }

  if (!state.demoMode) {
    await fetchRelationships(display);
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
    } else if (filter === 'live') {
      state.localFeed = [...state.pendingPosts[feedKey], ...(state.localFeed || [])];
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
      if (!state.demoMode) await fetchRelationships(state.homeFeed);
      renderFilteredPosts(state.homeFeed);
    } else if (filter === 'following') {
      await ensureHomeFeedLoaded();
      const display = state.demoMode
        ? state.homeFeed.filter(p => !p.reblog)
        : await filterForFollowing(state.homeFeed);
      renderFilteredPosts(display);
    } else if (filter === 'hashtags') {
      await loadHashtagsFeed();
    } else if (filter === 'live') {
      await ensureLocalFeedLoaded();
      if (!state.demoMode) await fetchRelationships(state.localFeed);
      renderFilteredPosts(state.localFeed);
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
  } else if (filter === 'live') {
    minIdToUse = state.localFeed && state.localFeed.length > 0 ? state.localFeed[0].id : null;
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
      if (filter === 'live') {
        newPosts = await apiGet(`/api/v1/timelines/public?local=true&limit=40&min_id=${minIdToUse}`, state.token);
        newPosts.sort((a, b) => (a.id.length !== b.id.length ? b.id.length - a.id.length : (b.id > a.id ? 1 : b.id < a.id ? -1 : 0)));
        if (newPosts.length > 0) state.localFeed = [...newPosts, ...state.localFeed];
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
    }

    if (!newPosts.length) return;

    let display = newPosts;
    if (filter === 'following') display = await filterForFollowing(newPosts);
    else if (filter === 'hashtags') {
      if (state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') display = newPosts;
      else display = newPosts.filter(p => p._sourceTags && p._sourceTags.length > 0);
    }
    if (!display.length) return;

    if (!state.demoMode && filter !== 'following') {
      await fetchRelationships(display);
    }

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
  let posts = state.pendingPosts[feedKey] || [];
  if (!posts.length) return;

  const container = $('feed-posts');
  if (!container) return;

  posts = getFilteredPendingPosts(feedKey);

  const html = posts.map(p => renderPost(p, { tags: p._sourceTags || [] })).join('');
  state.pendingPosts[feedKey] = [];
  updateTabPill(feedKey);

  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const frag = document.createDocumentFragment();
  while (tmp.firstChild) frag.appendChild(tmp.firstChild);

  if (scrollToTop) {
    container.insertBefore(frag, container.firstChild);
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      window.scrollTo(0, 0); // fallback for older browsers
    }
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

let loadMoreObserver = null;

export function checkInfiniteScroll() {
  const activePanel = document.querySelector('.tab-panel.active');
  if (!activePanel) return;
  const btn = activePanel.querySelector('.load-more-btn');
  
  if (!loadMoreObserver) {
    loadMoreObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.disabled) {
          handleLoadMore(entry.target);
        }
      });
    }, {
      rootMargin: '800px'
    });
  }
  
  // Disconnect old button and observe new one
  const buttons = document.querySelectorAll('.load-more-btn');
  buttons.forEach(b => loadMoreObserver.observe(b));
}

let lastScrollY = 0;
let scrollingUp = false;

export function handleScrollDirection() {
  const currentY = window.scrollY || document.documentElement.scrollTop;
  scrollingUp = currentY < lastScrollY;

  if (state.activeTab === 'feed') {
    const feedKey = activeFeedKey();
    const pending = getFilteredPendingPosts(feedKey);
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
  } else if (filter === 'live') {
    maxIdToUse = state.localMaxId;
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
    } else if (filter === 'live') {
      newPosts = await apiGet(`/api/v1/timelines/public?local=true&limit=40&max_id=${maxIdToUse}`, state.token);
      state.localFeed = [...(state.localFeed || []), ...newPosts];
      state.localMaxId = newPosts.length ? newPosts[newPosts.length - 1].id : null;
      maxIdToUse = state.localMaxId;
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

    if (!state.demoMode && filter !== 'following') {
      await fetchRelationships(display);
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
