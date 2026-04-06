/**
 * @module mock-api
 * Mock Mastodon API server — intercepts global fetch() to return test data
 * and prevents destructive operations (POST, PUT, DELETE).
 * 
 * This module runs ONLY in test environment and is never included in production.
 */

// Prevent actual network requests during tests
const originalFetch = window.fetch;

/**
 * Initialize the mock API server.
 * Call this before loading the app.
 */
export function initMockAPI(testUser = null) {
  window.fetch = function(resource, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const url = new URL(resource, window.location.origin);
    const pathname = url.pathname;
    const search = url.search;

    // Log test requests for debugging
    console.log(`[MOCK API] ${method} ${pathname}${search}`);

    // Allow specific POST endpoints for testing
    if (method === 'POST') {
      if (pathname.includes('/api/v1/apps')) {
        return handleMockGET(pathname, search, url, init);
      }
      if (pathname.includes('/oauth/token')) {
        return handleMockGET(pathname, search, url, init);
      }
      // Block other POST operations
      console.warn(`[MOCK API] Blocked ${method} request to ${pathname}`);
      return Promise.reject(
        new Error(`Test mode: ${method} requests are blocked. Cannot post, delete, or modify data during testing.`)
      );
    }

    // Block destructive operations
    if (['PUT', 'DELETE', 'PATCH'].includes(method)) {
      console.warn(`[MOCK API] Blocked ${method} request to ${pathname}`);
      return Promise.reject(
        new Error(`Test mode: ${method} requests are blocked. Cannot post, delete, or modify data during testing.`)
      );
    }

    // Route GET requests to mock handlers
    return handleMockGET(pathname, search, url, init);
  };
}

/**
 * Handle GET requests by routing to appropriate mock responses.
 */
function handleMockGET(pathname, search, url, init) {
  // Instance info
  if (pathname.includes('/api/v1/instance')) {
    return mockResponse(getMockInstance());
  }

  // Verify credentials
  if (pathname.includes('/api/v1/accounts/verify_credentials')) {
    return mockResponse(getMockAccount());
  }

  // Home timeline/feed
  if (pathname.includes('/api/v1/timelines/home')) {
    return mockResponse(getMockTimeline('home', search));
  }

  // Public timelines
  if (pathname.includes('/api/v1/timelines/public')) {
    const isLocal = url.searchParams.has('local');
    return mockResponse(getMockTimeline(isLocal ? 'local' : 'federated', search));
  }

  // Hashtag timelines
  if (pathname.includes('/api/v1/timelines/tag/')) {
    const tag = pathname.split('/').pop();
    return mockResponse(getMockTimeline(`hashtag:${tag}`, search));
  }

  // Get single status
  if (pathname.match(/\/api\/v1\/statuses\/\d+$/)) {
    const statusId = pathname.match(/\/(\d+)$/)[1];
    return mockResponse(getMockStatus(statusId));
  }

  // Get status context (replies)
  if (pathname.match(/\/api\/v1\/statuses\/\d+\/context/)) {
    return mockResponse(getMockThreadContext());
  }

  // Get account by ID
  if (pathname.match(/\/api\/v1\/accounts\/\d+$/)) {
    const accountId = pathname.match(/\/(\d+)$/)[1];
    return mockResponse(getMockProfile(accountId));
  }

  // Get account's statuses
  if (pathname.match(/\/api\/v1\/accounts\/\d+\/statuses/)) {
    const accountId = pathname.match(/\/accounts\/(\d+)\//)[1];
    return mockResponse(getMockAccountPosts(accountId, search));
  }

  // Accounts search / mentions
  if (pathname.includes('/api/v1/accounts/search')) {
    const q = url.searchParams.get('q') || '';
    return mockResponse(getMockAccountSearch(q));
  }

  // Notifications
  if (pathname.includes('/api/v1/notifications')) {
    return mockResponse(getMockNotifications(search));
  }

  // Bookmarks
  if (pathname.includes('/api/v1/bookmarks')) {
    return mockResponse(getMockBookmarks(search));
  }

  // Trending posts
  if (pathname.includes('/api/v1/trends/statuses')) {
    return mockResponse(getMockTrendingPosts(search));
  }

  // Trending hashtags
  if (pathname.includes('/api/v1/trends/tags')) {
    return mockResponse(getMockTrendingHashtags(search));
  }

  // Trending accounts
  if (pathname.includes('/api/v1/trends/accounts')) {
    return mockResponse(getMockTrendingAccounts(search));
  }

  // News/links
  if (pathname.includes('/api/v1/trends/links')) {
    return mockResponse(getMockTrendingLinks(search));
  }

  // Search all
  if (pathname.includes('/api/v2/search')) {
    const q = url.searchParams.get('q') || '';
    return mockResponse(getMockSearchResults(q));
  }

  // Follow list
  if (pathname.includes('/api/v1/following')) {
    return mockResponse(getMockFollowing(search));
  }

  // Followed hashtags
  if (pathname.includes('/api/v1/followed_tags')) {
    return mockResponse(getMockFollowedHashtags(search));
  }

  // Favourites
  if (pathname.includes('/api/v1/favourites')) {
    return mockResponse(getMockFavourites(search));
  }

  // Filters
  if (pathname.includes('/api/v1/filters')) {
    return mockResponse([]);
  }

  // Apps (OAuth)
  if (pathname.includes('/api/v1/apps') && init.method === 'POST') {
    return mockResponse(getMockAppRegistration());
  }

  // OAuth token exchange
  if (pathname.includes('/oauth/token') && init.method === 'POST') {
    return mockResponse(getMockTokenResponse());
  }

  // Pass through static files (HTML, CSS, JS) to real fetch for actual validation
  if (pathname === '/index.html' || pathname.endsWith('.html') || pathname.endsWith('.css') || pathname.endsWith('.js')) {
    console.log(`[MOCK API] Passing through static file to real server: ${pathname}`);
    // Construct absolute URL and call real fetch
    const absoluteUrl = new URL(window.location.origin + pathname).href;
    return originalFetch(absoluteUrl, init).then(response => {
      // Important: return response as-is (including 404) so tests can validate
      return response;
    });
  }

  console.warn(`[MOCK API] No handler for ${init.method} ${pathname}${url.search}`);
  return Promise.reject(new Error(`Unhandled mock request: ${pathname}`));
}

/**
 * Helper to wrap a response in a Promise that resolves like fetch().
 */
function mockResponse(data) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'content-type': 'application/json' }),
  });
}

/**
 * Helper to return an error response.
 */
function mockErrorResponse(status, error) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Error',
    json: async () => ({ error }),
    text: async () => JSON.stringify({ error }),
    headers: new Headers({ 'content-type': 'application/json' }),
  });
}

// ────────────────────────────────────────────────────────────────────
// MOCK DATA GENERATORS
// ────────────────────────────────────────────────────────────────────

function getMockInstance() {
  return {
    uri: 'test.example.com',
    title: 'Test Mastodon Instance',
    short_description: 'A test Mastodon instance for testing Elefeed',
    description: 'A test Mastodon instance for testing Elefeed',
    version: '4.0.0',
    languages: ['en'],
    configuration: {
      statuses: {
        max_characters: 500,
      },
      urls: {
        streaming_api: 'wss://test.example.com',
      },
    },
    usage: {
      users: {
        active_month: 50,
      },
    },
    thumbnail: 'https://via.placeholder.com/1200x630',
    urls: {
      streaming_api: 'wss://test.example.com',
    },
  };
}

function getMockAccount(id = '1') {
  return {
    id,
    username: 'testuser',
    acct: 'testuser',
    display_name: 'Test User',
    locked: false,
    bot: false,
    discoverable: true,
    group: false,
    created_at: '2023-01-01T00:00:00.000Z',
    note: '<p>A test account for Elefeed testing.</p>',
    url: 'https://test.example.com/@testuser',
    avatar: 'https://via.placeholder.com/150',
    avatar_static: 'https://via.placeholder.com/150',
    header: 'https://via.placeholder.com/1500x500',
    header_static: 'https://via.placeholder.com/1500x500',
    followers_count: 123,
    following_count: 45,
    statuses_count: 678,
    last_status_at: new Date().toISOString().split('T')[0],
    emojis: [],
    fields: [
      { name: 'Website', value: 'https://example.com', verified_at: null },
    ],
  };
}

function getMockStatus(id = null) {
  const statusId = id || Math.floor(Math.random() * 1e10).toString();
  const now = new Date();
  const createdAt = new Date(now - Math.random() * 7 * 24 * 60 * 60 * 1000);

  return {
    id: statusId,
    created_at: createdAt.toISOString(),
    in_reply_to_id: null,
    in_reply_to_account_id: null,
    sensitive: false,
    spoiler_text: '',
    visibility: 'public',
    language: 'en',
    uri: `https://test.example.com/users/testuser/statuses/${statusId}`,
    url: `https://test.example.com/@testuser/${statusId}`,
    replies_count: Math.floor(Math.random() * 20),
    reblogs_count: Math.floor(Math.random() * 50),
    favourites_count: Math.floor(Math.random() * 30),
    edited_at: null,
    content: '<p>This is a test post about Mastodon and social media. #test #mastodon</p>',
    reblog: null,
    application: {
      name: 'Elefeed',
      website: 'https://elefeed.app',
    },
    account: getMockAccount('123'),
    media_attachments: [],
    mentions: [],
    tags: [
      { name: 'test', url: 'https://test.example.com/tags/test' },
      { name: 'mastodon', url: 'https://test.example.com/tags/mastodon' },
    ],
    emojis: [],
    card: null,
    poll: null,
    text: 'This is a test post about Mastodon and social media. #test #mastodon',
    favourited: false,
    reblogged: false,
    muted: false,
    bookmarked: false,
    pinned: false,
  };
}

function getMockTimeline(type = 'home', search = '') {
  const count = parseInt(new URLSearchParams(search).get('limit') || '40');
  const timeline = [];

  for (let i = 0; i < count; i++) {
    timeline.push(getMockStatus(`${Date.now()}-${i}`));
  }

  return timeline;
}

function getMockThreadContext() {
  return {
    ancestors: [
      getMockStatus('100'),
      getMockStatus('101'),
    ],
    descendants: [
      getMockStatus('103'),
      getMockStatus('104'),
    ],
  };
}

function getMockProfile(id) {
  return {
    ...getMockAccount(id),
    display_name: `User ${id}`,
    username: `user${id}`,
    followers_count: Math.floor(Math.random() * 1000),
    following_count: Math.floor(Math.random() * 500),
    statuses_count: Math.floor(Math.random() * 2000),
  };
}

function getMockAccountPosts(accountId, search = '') {
  const count = parseInt(new URLSearchParams(search).get('limit') || '20');
  const posts = [];

  for (let i = 0; i < count; i++) {
    const post = getMockStatus(`${accountId}-${i}`);
    post.account = getMockProfile(accountId);
    posts.push(post);
  }

  return posts;
}

function getMockAccountSearch(q = '') {
  if (!q) return [];

  return [
    {
      ...getMockAccount('200'),
      username: `${q.toLowerCase()}user`,
      display_name: `${q} User`,
    },
    {
      ...getMockAccount('201'),
      username: `search${q}`,
      display_name: `Search ${q}`,
    },
  ];
}

function getMockNotifications(search = '') {
  const notifications = [];

  const types = ['favourite', 'reblog', 'follow', 'mention'];

  types.forEach((type, idx) => {
    notifications.push({
      id: `notif-${idx}`,
      type,
      created_at: new Date(Date.now() - idx * 60000).toISOString(),
      account: getMockProfile(String(300 + idx)),
      status: type === 'mention' ? getMockStatus('500') : undefined,
    });
  });

  return notifications;
}

function getMockBookmarks(search = '') {
  const count = parseInt(new URLSearchParams(search).get('limit') || '20');
  const bookmarks = [];

  for (let i = 0; i < count; i++) {
    bookmarks.push(getMockStatus(`bookmark-${i}`));
  }

  return bookmarks;
}

function getMockTrendingPosts(search = '') {
  const count = parseInt(new URLSearchParams(search).get('limit') || '10');
  const posts = [];

  for (let i = 0; i < count; i++) {
    posts.push({
      ...getMockStatus(`trending-post-${i}`),
      content: `<p>This is a trending post! #trending #mastodon</p>`,
    });
  }

  return posts;
}

function getMockTrendingHashtags(search = '') {
  return [
    {
      name: 'mastodon',
      url: 'https://test.example.com/tags/mastodon',
      history: [
        { day: Math.floor(Date.now() / 1000), accounts: '100', uses: '500' },
      ],
      following: false,
    },
    {
      name: 'fediverse',
      url: 'https://test.example.com/tags/fediverse',
      history: [
        { day: Math.floor(Date.now() / 1000), accounts: '80', uses: '400' },
      ],
      following: false,
    },
  ];
}

function getMockTrendingAccounts(search = '') {
  return [
    getMockProfile('400'),
    getMockProfile('401'),
    getMockProfile('402'),
  ];
}

function getMockTrendingLinks(search = '') {
  return [
    {
      url: 'https://example.com/news1',
      title: 'Test Article 1',
      description: 'A trending article for testing',
      type: 'link',
      image: 'https://via.placeholder.com/300x300',
      image_description: 'Article preview',
      authors: [],
      provider_name: 'Test Provider',
      provider_url: 'https://example.com',
      html: '<a href="https://example.com/news1">Test Article</a>',
      embeddable: false,
      published_at: new Date().toISOString(),
      history: [
        { day: Math.floor(Date.now() / 1000), accounts: '50', uses: '200' },
      ],
    },
  ];
}

function getMockSearchResults(q) {
  return {
    accounts: getMockAccountSearch(q).slice(0, 5),
    statuses: getMockTimeline('search', '').slice(0, 5),
    hashtags: [
      {
        name: q,
        url: `https://test.example.com/tags/${q}`,
        history: [
          { day: Math.floor(Date.now() / 1000), accounts: '10', uses: '100' },
        ],
        following: false,
      },
    ],
  };
}

function getMockFollowing(search = '') {
  const count = parseInt(new URLSearchParams(search).get('limit') || '40');
  const following = [];

  for (let i = 0; i < count; i++) {
    following.push(getMockProfile(String(500 + i)));
  }

  return following;
}

function getMockFollowedHashtags(search = '') {
  return [
    {
      name: 'test',
      url: 'https://test.example.com/tags/test',
      history: [],
      following: true,
    },
    {
      name: 'mastodon',
      url: 'https://test.example.com/tags/mastodon',
      history: [],
      following: true,
    },
  ];
}

function getMockFavourites(search = '') {
  const count = parseInt(new URLSearchParams(search).get('limit') || '20');
  const favourites = [];

  for (let i = 0; i < count; i++) {
    favourites.push(getMockStatus(`fav-${i}`));
  }

  return favourites;
}

function getMockAppRegistration() {
  return {
    id: '1',
    name: 'Elefeed Test',
    website: `${window.location.origin}`,
    redirect_uri: `${window.location.origin}`,
    client_id: 'test-client-id-12345',
    client_secret: 'test-client-secret-67890',
    vapid_key: 'test-vapid-key',
  };
}

function getMockTokenResponse() {
  return {
    access_token: 'test-access-token-abc123def456',
    token_type: 'Bearer',
    scope: 'read write follow push',
    created_at: Math.floor(Date.now() / 1000),
  };
}
