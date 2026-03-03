/**
 * @module state
 * Global constants, persistent storage helpers, and application state.
 *
 * Every other module imports from here — this file has zero internal imports
 * to guarantee it can never participate in a circular dependency.
 */

/* ── OAuth / App constants ─────────────────────────────────────────── */

export const CLIENT_NAME = 'Elefeed';
export const CLIENT_WEBSITE = location.origin;

/** Normalized redirect URI — must match exactly between registration and authorization. */
export const REDIRECT_URI = (() => {
  const path = location.pathname;
  if (path === '/' || path.endsWith('/')) {
    return location.origin + path.replace(/\/$/, '');
  }
  return location.origin + path;
})();

export const SCOPES = 'read write write:statuses write:media write:favourites write:bookmarks';

/* ── localStorage wrapper ──────────────────────────────────────────── */

/** Silently swallows quota / private-mode errors. */
export const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { } },
  del: k => { try { localStorage.removeItem(k); } catch { } },
};

/* ── Central application state (singleton) ─────────────────────────── */

export const urlParams = new URLSearchParams(window.location.search);

export const state = {
  server: null,
  token: null,
  clientId: null,
  clientSecret: null,
  account: null,
  maxTootChars: 500,

  /* Feed data */
  homeFeed: null,
  homeMaxId: null,
  followingFeed: null,
  hashtagFeed: null,
  hashtagMaxId: null,
  followedHashtags: [],
  selectedHashtagFilter: 'all',
  knownFollowing: new Set(),
  knownNotFollowing: new Set(),

  /* UI state */
  activeTab: urlParams.get('tab') || 'feed',
  feedFilter: urlParams.get('feed') || 'all',
  exploreSubtab: urlParams.get('explore') || 'posts',
  pendingPosts: { feed: [] },
  demoMode: false,

  /* Trending flags */
  trendingPostsLoaded: false,
  trendingHashtagsLoaded: false,
  trendingPeopleLoaded: false,
  trendingNewsLoaded: false,

  /* Notifications */
  notifications: [],
  notifByType: {},
  notifFilter: 'all',
  notifMaxId: {},
  notifUnreadCount: 0,
  lastSeenNotifId: null,
  notifDrawerOpen: false,
  /** Tracks the newest notif ID for which we've already fired a foreground OS alert. */
  _lastFiredNotifId: null,
  /** Latest notif ID seen by the SW (may be ahead of lastSeenNotifId). */
  _swLastKnownId: null,
};

/* ── Compose form state (shared between drawer & sidebar) ──────────── */

export const composeState = {
  mediaFiles: [],
  mediaUrls: [],
  mediaDescriptions: [],
  mediaIds: [],
  sidebarMediaFiles: [],
  sidebarMediaUrls: [],
  sidebarMediaDescriptions: [],
  sidebarMediaIds: [],
  replyToId: null,
  replyToAcct: null,
  quoteId: null,
  editPostId: null,
  activeAltIndex: -1,
  activeAltSuffix: '',
};

/* ── DOM helpers ───────────────────────────────────────────────────── */

export const $ = id => document.getElementById(id);
export const qs = sel => document.querySelector(sel);
