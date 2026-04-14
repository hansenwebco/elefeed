// Position overlay pill relative to #feed-posts horizontally
function positionOverlayPill() {
  const pill = document.getElementById('new-posts-pill');
  const feed = document.getElementById('feed-posts');
  if (!pill || !feed) return;
  const rect = feed.getBoundingClientRect();
  pill.style.left = (rect.left + rect.width / 2) + 'px';
  // Use CSS for vertical 'top' position to ensure it stays in same place across views
}

// Returns the active scroll container: feed-container on mobile, window on desktop
export function getScrollContainer() {
  if (window.innerWidth <= 900) return document.getElementById('feed-container');
  return null; // null = use window
}

export function getScrollTop() {
  const sc = getScrollContainer();
  return sc ? sc.scrollTop : (window.scrollY || document.documentElement.scrollTop);
}

export function scrollContainerTo(top, behavior = 'smooth') {
  // Reset the feed container if it exists
  const feedCont = document.getElementById('feed-container');
  if (feedCont) {
    try {
      feedCont.scrollTo({ top, behavior });
    } catch (e) {
      feedCont.scrollTop = top;
    }
  }

  // Clear the window/document scroll
  try {
    document.documentElement.scrollTop = top;
    document.body.scrollTop = top;
    window.scrollTo({ top, behavior });
  } catch (e) {
    window.scrollTo(0, top);
  }
}

// Special "Nuclear" scroll-to-top specifically FOR the hashtag management controls
// This ignores containers and resets EVERY possible scroll layer to ensure 0.
export function hashtagScrollToTop() {
  const top = 0;
  const behavior = 'instant';
  
  const feedCont = document.getElementById('feed-container');
  if (feedCont) feedCont.scrollTop = top;

  document.documentElement.scrollTop = top;
  document.body.scrollTop = top;
  try {
    window.scrollTo({ top, behavior });
  } catch (e) {
    window.scrollTo(0, top);
  }
}

// Returns an anchor { id, offset } identifying the topmost visible post and
// how many pixels its top edge has been scrolled past the container top.
export function getScrollAnchor() {
  const sc = getScrollContainer();
  const containerTop = sc ? sc.getBoundingClientRect().top : 0;
  const articles = document.querySelectorAll('#feed-posts article[data-id]');
  for (const article of articles) {
    const rect = article.getBoundingClientRect();
    if (rect.bottom > containerTop) {
      return { id: article.dataset.id, offset: containerTop - rect.top };
    }
  }
  return null;
}

// Restores scroll to a previously saved anchor.
export function restoreScrollAnchor(anchor) {
  if (!anchor) return;
  const el = document.querySelector(`#feed-posts article[data-id="${anchor.id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'instant', block: 'start' });
  const sc = getScrollContainer();
  if (sc) {
    sc.scrollTop += anchor.offset;
  } else {
    window.scrollBy(0, anchor.offset);
  }
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
import { matchesLanguage, updateURLParam } from './utils.js';

/* ── Key helpers ───────────────────────────────────────────────────── */

export let overlayPillDismissed = false;
export function resetOverlayPillDismissed() { overlayPillDismissed = false; }

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
  const preferredLang = state.preferredLanguage || 'all';

  return posts.filter(p => {
    if (!showBoosts && p.reblog) return false;
    const inner = p.reblog || p;
    if (!showReplies && inner.in_reply_to_id) return false;
    if (!showQuotes && inner.quote) return false;

    const postLang = inner.language || p.language;
    if (!matchesLanguage(postLang, preferredLang)) return false;
    return true;
  });
}

export function updateTabPill(feedKey) {
  const overlayPill = document.getElementById('new-posts-pill');
  const refreshBadge = document.getElementById('refresh-badge');
  const count = getFilteredPendingPosts(feedKey).length;
  const style = store.get('pref_newpost_style') || 'badge'; // default: Refresh Notification
  if (!overlayPill) return;
  if (count === 0) {
    overlayPill.style.display = 'none';
    overlayPill.textContent = 'New posts';
    document.title = 'Elefeed - A Tidy Mastodon Client';
    if (refreshBadge) { refreshBadge.textContent = ''; refreshBadge.classList.remove('visible'); }
    return;
  }
  const label = count > 99 ? '99+' : String(count);
  document.title = `Elefeed (${label}) - A Tidy Mastodon Client`;
  if (style === 'pill') {
    overlayPill.textContent = count > 99 ? '99+ new posts' : `${count} new post${count > 1 ? 's' : ''}`;
    overlayPill.style.display = '';
    if (refreshBadge) { refreshBadge.textContent = ''; refreshBadge.classList.remove('visible'); }
    positionOverlayPill();
  } else {
    overlayPill.style.display = 'none';
    if (refreshBadge) { refreshBadge.textContent = label; refreshBadge.classList.add('visible'); }
  }
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

  const handler = () => {
    const overlayPill = document.getElementById('new-posts-pill');
    if (!overlayPill) return;
    // Only drive pill visibility when the pill style is active
    if ((store.get('pref_newpost_style') || 'badge') !== 'pill') {
      overlayPill.style.display = 'none';
      return;
    }
    const feedKey = activeFeedKey();
    const pending = getFilteredPendingPosts(feedKey);
    if (pending.length === 0) {
      overlayPill.style.display = 'none';
      document.title = 'Elefeed - A Tidy Mastodon Client';
      return;
    }
    const currentY = getScrollTop();
    if (currentY < 150 && scrollingUp) {
      overlayPillDismissed = true;
      overlayPill.style.display = 'none';
      document.title = 'Elefeed - A Tidy Mastodon Client';
      return;
    }
    overlayPill.style.display = pending.length > 0 && !overlayPillDismissed ? '' : 'none';
    if (overlayPill.style.display === 'none') {
      document.title = 'Elefeed - A Tidy Mastodon Client';
    } else {
      const count = pending.length;
      document.title = `Elefeed (${count > 99 ? '99+' : count}) - A Tidy Mastodon Client`;
    }
    positionOverlayPill();
  };

  window.addEventListener('scroll', handler);
  const fc = document.getElementById('feed-container');
  if (fc) fc.addEventListener('scroll', handler);
}

/* ── Rendering ─────────────────────────────────────────────────────── */

function renderFilteredPosts(displayPosts) {
  const container = $('feed-posts');
  const filter = state.feedFilter;

  // Apply feed filters (Boosts, Replies, Quotes)
  const showBoosts = store.get('pref_show_boosts') !== 'false';
  const showReplies = store.get('pref_show_replies') !== 'false';
  const showQuotes = store.get('pref_show_quotes') !== 'false';
  const preferredLang = state.preferredLanguage || 'all';

  displayPosts = displayPosts.filter(p => {
    if (!showBoosts && p.reblog) return false;
    const inner = p.reblog || p;
    if (!showReplies && inner.in_reply_to_id) return false;
    if (!showQuotes && inner.quote) return false;

    const postLang = inner.language || p.language;
    if (!matchesLanguage(postLang, preferredLang)) return false;
    return true;
  });

  if (!displayPosts || !displayPosts.length) {
    if (filter === 'live' && state.localSupported === false) {
      container.innerHTML = `<div class="feed-status"><div class="status-icon" style="color:var(--text-muted);">🛡️</div><p style="margin:8px 0 4px;font-size:16px;">Local Feed Disabled</p><p style="margin:0;font-size:13px;color:var(--text-muted);opacity:0.8;line-height:1.5;">Your server administrator has chosen to disable the public local timeline for this instance.</p></div>`;
      return;
    }
    if (filter === 'federated' && state.federatedSupported === false) {
      container.innerHTML = `<div class="feed-status"><div class="status-icon" style="color:var(--text-muted);">🛡️</div><p style="margin:8px 0 4px;font-size:16px;">Federated Feed Disabled</p><p style="margin:0;font-size:13px;color:var(--text-muted);opacity:0.8;line-height:1.5;">Your server administrator has chosen to disable the public federated timeline for this instance.</p></div>`;
      return;
    }

    let msg = 'Nothing here yet.';
    if (filter === 'following') msg = 'No recent posts from people you follow.';
    if (filter === 'hashtags') msg = 'No recent posts matching your hashtags.';
    if (filter === 'live') msg = 'No recent posts on this server.';
    if (filter === 'federated') msg = 'No recent posts from the federated timeline.';
    container.innerHTML = `<div class="feed-status"><div class="status-icon">📭</div><p>${msg}</p></div>`;
    return;
  }

  let maxId = state.homeMaxId;
  if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
    maxId = state.hashtagMaxId;
  } else if (filter === 'live') {
    maxId = state.localMaxId;
  } else if (filter === 'federated') {
    maxId = state.federatedMaxId;
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
    // page can contain statuses (with .account), accounts (with .username), or tags (with neither)
    const isStatus = !!p.account;
    const isAccount = !isStatus && !!p.username;
    
    if (isAccount) {
      if (!state.knownFollowing.has(p.id) && !state.knownNotFollowing.has(p.id)) {
        idsToCheck.add(p.id);
      }
    } else if (isStatus) {
      const s = p.reblog || p;
      const authorId = s.account.id;
      const boostAuthorId = p.reblog ? p.account.id : null;
      const quoteAuthorId = s.quote?.account?.id || s.quoted_status?.account?.id;

      [authorId, boostAuthorId, quoteAuthorId].forEach(id => {
        if (id && !state.knownFollowing.has(id) && !state.knownNotFollowing.has(id)) {
          idsToCheck.add(id);
        }
      });
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

/* ── Ensure federated feed is fetched ────────────────────────────── */

async function ensureFederatedFeedLoaded() {
  if (state.federatedSupported === false) {
    state.federatedFeed = [];
    return;
  }
  if (!state.federatedFeed) {
    const posts = await apiGet('/api/v1/timelines/public?limit=40', state.token);
    state.federatedFeed = posts;
    state.federatedMaxId = posts.length ? posts[posts.length - 1].id : null;
  }
}

/* ── Ensure local feed is fetched ─────────────────────────────────── */

async function ensureLocalFeedLoaded() {
  if (state.localSupported === false) {
    state.localFeed = [];
    return;
  }
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
      // Only fetch followed tags if we don't have them yet or they're empty
      (state.followedHashtags && state.followedHashtags.length > 0)
        ? Promise.resolve(state.followedHashtags)
        : apiGet('/api/v1/followed_tags?limit=200', state.token).catch(() => [])
    ]);

    state.followedHashtags = tags || state.followedHashtags || [];
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
  const container = $('feed-posts');
  const gridView = $('hashtag-landing-grid-view');
  const activeHeader = $('hashtag-active-view-header');
  const wrapper = $('feed-content-wrapper');

  // 0. Ensure followed hashtags are loaded BEFORE checking UI statuses
  // Only fetch if explicitly null or empty, AND if we haven't already marked it as loaded.
  if (state.token && (!state.followedHashtags || state.followedHashtags.length === 0)) {
    try {
      const fetchedTags = await apiGet('/api/v1/followed_tags?limit=200', state.token);
      if (fetchedTags && Array.isArray(fetchedTags)) {
        state.followedHashtags = fetchedTags;
      }
    } catch (e) {
      console.warn('Failed to fetch followed hashtags in feed tab:', e);
      state.followedHashtags = state.followedHashtags || [];
    }
  }

  // 1. Determine if we are in "Landing" mode or "Feed" mode
  const isLanding = !state.selectedHashtagFilter || state.selectedHashtagFilter === 'landing';
  const isSpecificTag = state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all' && state.selectedHashtagFilter !== 'landing';

  const filterBar = $('hashtag-filter-bar');
  if (filterBar) filterBar.style.display = 'block';

  // Toggle consolidated follow button in the active pill
  const followBtn = $('hashtag-header-follow-btn');
  if (followBtn) {
    if (isSpecificTag) {
      followBtn.style.display = 'flex';
      const tag = state.selectedHashtagFilter;
      const isFollowed = (state.followedHashtags || []).some(t => t.name.toLowerCase() === tag.toLowerCase());
      
      const freshBtn = followBtn.cloneNode(true);
      followBtn.replaceWith(freshBtn);
      
      // Set initial state matching profile.js requirements
      freshBtn.dataset.tag = tag;
      freshBtn.dataset.following = isFollowed ? 'true' : 'false';
      freshBtn.classList.toggle('following', isFollowed);
      // Initial text based on state (since we are removing ::after)
      freshBtn.textContent = isFollowed ? 'Following' : 'Follow';

      freshBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!state.token || state.demoMode) return;
        
        try {
          const { handleHashtagFollowToggle } = await import('./profile.js');
          await handleHashtagFollowToggle(freshBtn);
          // Wait a beat for state to update, then reload if needed (UI already updated by handleHashtagFollowToggle)
        } catch (err) {
          console.error('Hashtag toggle failed:', err);
        }
      };
    } else {
      followBtn.style.display = 'none';
    }
  }

  if (isLanding) {
    updateURLParam('tag', null); // Clear tag from URL in landing mode
    if (wrapper) wrapper.style.display = 'none';
    if (activeHeader) activeHeader.style.display = 'none';
    if (gridView) {
      gridView.style.display = 'block';
      // Signal to render the grid (defined in compose.js/hashtags.js)
      if (window.renderHashtagGrid) window.renderHashtagGrid();
    }
    // Only scroll to top on hashtag landing - using the hashtag-specific reset
    hashtagScrollToTop();
    return;
  }

  updateURLParam('tag', state.selectedHashtagFilter);

  // 2. Feed Mode
  if (gridView) gridView.style.display = 'none';
  if (wrapper) wrapper.style.display = 'block';
  if (activeHeader) {
    activeHeader.style.display = 'block';
    const titleEl = $('hashtag-active-title');
    if (titleEl) titleEl.textContent = state.selectedHashtagFilter;
  }
  container.innerHTML = '';
  // Only scroll to top on hashtag feed switch - using the hashtag-specific reset
  hashtagScrollToTop();

  // DATA FETCHING
  let tagPostsPromise = null;

  if (!state.demoMode) {
    if (isSpecificTag) {
      const tag = encodeURIComponent(state.selectedHashtagFilter);
      tagPostsPromise = apiGet(`/api/v1/timelines/tag/${tag}?limit=40`, state.token);
    } else {
      await ensureHomeFeedLoaded();
    }
  } else if (!isSpecificTag) {
    await ensureHomeFeedLoaded();
  }

  let display = [];
  if (state.demoMode) {
    display = (state.homeFeed || []).filter(p => p._sourceTags && p._sourceTags.length > 0);
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
      display = (state.homeFeed || []).filter(p => p._sourceTags && p._sourceTags.length > 0);
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
  // Safeguard: if clicking the Home tab while a public feed was active in Explore, revert to 'all'
  if (state.activeTab === 'feed' && (state.feedFilter === 'live' || state.feedFilter === 'federated')) {
    state.feedFilter = 'all';
    import('./ui.js').then(m => m.updateTabLabel('feed'));
    document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(i => {
      i.classList.toggle('active', i.dataset.filter === 'all');
    });
  }

  if (scrollTop) scrollContainerTo(0, 'instant');
  const filter = state.feedFilter;
  const feedKey = activeFeedKey();

  // Merge any buffered pending posts into the backing feed array before
  // re-rendering so they appear inline and the poller's min_id advances.
  // Always stop any active federated SSE stream first; a new one will be
  // started below if the selected filter is 'federated'.
  stopFederatedStream();

  if (state.pendingPosts[feedKey] && state.pendingPosts[feedKey].length > 0) {
    if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
      state.hashtagFeed = [...state.pendingPosts[feedKey], ...(state.hashtagFeed || [])];
    } else if (filter === 'live') {
      state.localFeed = [...state.pendingPosts[feedKey], ...(state.localFeed || [])];
    } else if (filter === 'federated') {
      state.federatedFeed = [...state.pendingPosts[feedKey], ...(state.federatedFeed || [])];
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

  const fedBar = $('federated-info-bar');
  if (fedBar) {
    fedBar.style.display = (filter === 'federated' && !state.federatedBannerDismissed) ? 'flex' : 'none';
  }

  // Move the feed wrapper into the appropriate tab relative to the filter
  const wrapper = $('feed-content-wrapper');
  if (wrapper) {
    if (filter === 'live' || filter === 'federated') {
      const subpanel = $(`trending-subpanel-${filter}`);
      if (subpanel) {
        document.querySelectorAll('.trending-subpanel').forEach(p => p.classList.remove('active'));
        subpanel.classList.add('active');
        subpanel.appendChild(wrapper);
      }
    } else {
      const parent = $('panel-feed');
      if (parent) parent.appendChild(wrapper);
    }
  }

  $('feed-posts').innerHTML = '';
  setLoading('feed', true);
  setError('feed', null);

  try {
    const wrapper = $('feed-content-wrapper');
    if (filter !== 'hashtags') {
      if (wrapper) wrapper.style.display = 'block';
      const gridView = $('hashtag-landing-grid-view');
      if (gridView) gridView.style.display = 'none';
      const activeHeader = $('hashtag-active-view-header');
      if (activeHeader) activeHeader.style.display = 'none';
      const filterBar = $('hashtag-filter-bar');
      if (filterBar) filterBar.style.display = 'none';
    }

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
    } else if (filter === 'federated') {
      await ensureFederatedFeedLoaded();
      if (!state.demoMode) await fetchRelationships(state.federatedFeed);
      renderFilteredPosts(state.federatedFeed);
      // Open the SSE stream for real-time updates (no polling for federated)
      if (!state.demoMode) startFederatedStream();
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

/* ── Federated Streaming (SSE) ────────────────────────────────────────── */

let _federatedStream = null;

export function stopFederatedStream() {
  if (_federatedStream) {
    _federatedStream.close();
    _federatedStream = null;
  }
}

/**
 * Opens a Mastodon SSE stream on /api/v1/streaming/public and auto-flushes
 * each incoming post directly to the top of the DOM (no pill/badge).
 * EventSource handles reconnection automatically on network blips.
 * Call stopFederatedStream() to tear it down when navigating away.
 */
export function startFederatedStream() {
  stopFederatedStream(); // close any stale connection first
  if (!state.token || !state.server || state.federatedSupported === false) return;

  // EventSource doesn't support Authorization headers; Mastodon accepts the
  // token as a query parameter specifically for this purpose.
  const url = `https://${state.server}/api/v1/streaming/public?access_token=${encodeURIComponent(state.token)}`;
  let es;
  try {
    es = new EventSource(url);
  } catch (e) {
    console.warn('[Federated stream] EventSource failed to open:', e);
    return;
  }
  _federatedStream = es;

  // Helper: scroll-position-preserving prepend of one post to feed + DOM
  function prependPost(post) {
    // If the user has navigated away, kill the stream rather than continue
    const isFeedActive = state.activeTab === 'feed' || (state.activeTab === 'explore' && ['live', 'federated'].includes(state.exploreSubtab));
    if (state.feedFilter !== 'federated' || !isFeedActive) {
      stopFederatedStream();
      return;
    }

    // Deduplicate
    const existingIds = new Set((state.federatedFeed || []).map(p => p.id));
    if (existingIds.has(post.id)) return;

    state.federatedFeed = [post, ...(state.federatedFeed || [])];

    const container = $('feed-posts');
    if (!container) return;

    const html = renderPost(post, { tags: [] });
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const frag = document.createDocumentFragment();
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);

    // Just insert - browser's native scroll anchoring keeps the viewport stable
    container.insertBefore(frag, container.firstChild);
  }

  es.addEventListener('update', (e) => {
    try { prependPost(JSON.parse(e.data)); }
    catch (err) { console.warn('[Federated stream] Failed to parse update:', err); }
  });

  // Remove deleted posts from the backing array and the DOM
  es.addEventListener('delete', (e) => {
    const deletedId = String(e.data).trim();
    if (state.federatedFeed) {
      state.federatedFeed = state.federatedFeed.filter(p => p.id !== deletedId);
    }
    const el = document.querySelector(`#feed-posts article[data-id="${deletedId}"]`);
    if (el) el.remove();
  });

  es.onerror = () => {
    // If navigated away during an error/reconnect window, clean up
    const isFeedActive = state.activeTab === 'feed' || (state.activeTab === 'explore' && ['live', 'federated'].includes(state.exploreSubtab));
    if (state.feedFilter !== 'federated' || !isFeedActive) {
      stopFederatedStream();
    }
    // Otherwise EventSource will auto-reconnect - no action needed
  };
}



async function pollForNewPosts() {
  const isFeedActive = state.activeTab === 'feed' || (state.activeTab === 'explore' && ['live', 'federated'].includes(state.exploreSubtab));
  if (!state.token || state.demoMode || !isFeedActive) return;
  const filter = state.feedFilter;

  // Federated is handled entirely by SSE streaming - poller does nothing for it
  if (filter === 'federated') return;

  let minIdToUse = state.homeFeed && state.homeFeed.length > 0 ? state.homeFeed[0].id : null;
  if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
    minIdToUse = state.hashtagFeed && state.hashtagFeed.length > 0 ? state.hashtagFeed[0].id : null;
  } else if (filter === 'live') {
    minIdToUse = state.localFeed && state.localFeed.length > 0 ? state.localFeed[0].id : null;
  }
  // Also factor in any posts already waiting in the pending queue - they are
  // newer than the feed's tip and must advance min_id so we don't re-fetch them.
  const _feedKey = activeFeedKey();
  const _pending = state.pendingPosts[_feedKey] || [];
  if (_pending.length > 0) {
    const pid = _pending[0].id;
    if (!minIdToUse || pid.length > minIdToUse.length || (pid.length === minIdToUse.length && pid > minIdToUse)) {
      minIdToUse = pid;
    }
  }
  if (!minIdToUse) return;

  try {
    let newPosts = [];
    if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
      const tag = encodeURIComponent(state.selectedHashtagFilter);
      newPosts = await apiGet(`/api/v1/timelines/tag/${tag}?limit=40&min_id=${minIdToUse}`, state.token);
      newPosts.forEach(p => p._sourceTags = [state.selectedHashtagFilter]);
      newPosts.sort((a, b) => (a.id.length !== b.id.length ? b.id.length - a.id.length : (b.id > a.id ? 1 : b.id < a.id ? -1 : 0)));
    } else {
      if (filter === 'live') {
        newPosts = await apiGet(`/api/v1/timelines/public?local=true&limit=40&min_id=${minIdToUse}`, state.token);
        newPosts.sort((a, b) => (a.id.length !== b.id.length ? b.id.length - a.id.length : (b.id > a.id ? 1 : b.id < a.id ? -1 : 0)));
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
    // Deduplicate: drop posts already sitting in the pending queue to prevent
    // accumulating the same post across consecutive poll cycles.
    const existingPendingIds = new Set((state.pendingPosts[feedKey] || []).map(p => p.id));
    const fresh = display.filter(p => !existingPendingIds.has(p.id));
    if (!fresh.length) return;
    state.pendingPosts[feedKey] = [...fresh, ...(state.pendingPosts[feedKey] || [])];
    overlayPillDismissed = false;
    updateTabPill(feedKey);
  } catch (err) {
    console.warn('Silent polling failed:', err.message);
  }
}

/* ── Pending post flushing ─────────────────────────────────────────── */

export function flushPendingPosts(feedKey, scrollToTop) {
  const allPending = state.pendingPosts[feedKey] || [];
  if (!allPending.length) return;

  const container = $('feed-posts');
  if (!container) return;

  const posts = getFilteredPendingPosts(feedKey);

  // Update the backing feed array BEFORE clearing pendingPosts so the poller's
  // min_id anchor advances and won't re-fetch these posts on the next cycle.
  if (feedKey.startsWith('feed_hashtags_') && feedKey !== 'feed_hashtags_all') {
    state.hashtagFeed = [...allPending, ...(state.hashtagFeed || [])];
  } else if (feedKey === 'feed_live') {
    state.localFeed = [...allPending, ...(state.localFeed || [])];
  } else if (feedKey === 'feed_federated') {
    state.federatedFeed = [...allPending, ...(state.federatedFeed || [])];
  } else {
    state.homeFeed = [...allPending, ...(state.homeFeed || [])];
  }

  state.pendingPosts[feedKey] = [];
  updateTabPill(feedKey);

  if (!posts.length) return;

  const html = posts.map(p => renderPost(p, { tags: p._sourceTags || [] })).join('');

  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const frag = document.createDocumentFragment();
  while (tmp.firstChild) frag.appendChild(tmp.firstChild);

  // Just insert - browser's native scroll anchoring keeps the viewport stable
  container.insertBefore(frag, container.firstChild);
  if (scrollToTop) {
    scrollContainerTo(0, 'smooth');
  }
}

/* ── Scroll / infinite scroll ──────────────────────────────────────── */

let loadMoreObserver = null;

export function checkInfiniteScroll() {
  const activePanel = document.querySelector('.tab-panel.active');
  if (!activePanel) return;

  // Recreate the observer each time so stale buttons are never re-fired
  if (loadMoreObserver) loadMoreObserver.disconnect();
  loadMoreObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.disabled) {
        handleLoadMore(entry.target);
      }
    });
  }, {
    rootMargin: '800px'
  });

  const buttons = activePanel.querySelectorAll('.load-more-btn');
  buttons.forEach(b => loadMoreObserver.observe(b));
}

let lastScrollY = 0;
let scrollingUp = false;

export function handleScrollDirection() {
  const currentY = getScrollTop();
  scrollingUp = currentY < lastScrollY;

  const isFeedActive = state.activeTab === 'feed' || (state.activeTab === 'explore' && ['live', 'federated'].includes(state.exploreSubtab));
  if (isFeedActive) {
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
  if (btn.dataset.type === 'trending-posts') {
    const { loadTrendingPosts } = await import('./trending.js');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    await loadTrendingPosts(true);
    return;
  }
  if (btn.dataset.type === 'trending-people') {
    const { loadTrendingPeople } = await import('./trending.js');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    await loadTrendingPeople(true);
    return;
  }
  if (btn.dataset.type === 'trending-news') {
    const { loadTrendingNews } = await import('./trending.js');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    await loadTrendingNews(true);
    return;
  }
  if (btn.dataset.type === 'trending-hashtags') {
    const { loadTrendingHashtags } = await import('./trending.js');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    await loadTrendingHashtags(true);
    return;
  }

  const filter = state.feedFilter;
  let maxIdToUse = state.homeMaxId;
  if (filter === 'hashtags' && state.selectedHashtagFilter && state.selectedHashtagFilter !== 'all') {
    maxIdToUse = state.hashtagMaxId;
  } else if (filter === 'live') {
    maxIdToUse = state.localMaxId;
  } else if (filter === 'federated') {
    maxIdToUse = state.federatedMaxId;
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
    } else if (filter === 'federated') {
      newPosts = await apiGet(`/api/v1/timelines/public?limit=40&max_id=${maxIdToUse}`, state.token);
      state.federatedFeed = [...(state.federatedFeed || []), ...newPosts];
      state.federatedMaxId = newPosts.length ? newPosts[newPosts.length - 1].id : null;
      maxIdToUse = state.federatedMaxId;
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

    const preferredLang = state.preferredLanguage || 'all';
    let display = newPosts.filter(p => {
      const inner = p.reblog || p;
      const postLang = inner.language || p.language;
      return matchesLanguage(postLang, preferredLang);
    });

    if (filter === 'following' && !state.demoMode) display = await filterForFollowing(display);
    else if (filter === 'hashtags' && (!state.selectedHashtagFilter || state.selectedHashtagFilter === 'all')) {
      display = display.filter(p => p._sourceTags && p._sourceTags.length > 0);
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
