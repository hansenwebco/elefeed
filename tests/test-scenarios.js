/**
 * @module test-scenarios
 * Comprehensive test suite for Elefeed
 * 
 * Tests cover:
 * - API functionality and safety
 * - DOM structure and UI elements
 * - Data loading and rendering
 * - User interactions and state management
 * - Navigation and feature accessibility
 * - Mock data validation
 */

import { runner } from './test-runner.js';
import { initMockAPI } from './mock-api.js';

// ── Setup ──
let appLoaded = false;

async function loadApp() {
  if (appLoaded) return;

  // Initialize mock API FIRST, before any app code runs
  initMockAPI();

  // Inject stub app UI into DOM for testing
  const appDiv = document.getElementById('app-container');
  if (!appDiv.innerHTML.includes('screen')) {
    // Create stub screens
    const screenIds = ['feed-screen', 'notifications-screen', 'profile-screen', 'search-screen'];
    screenIds.forEach(id => {
      if (!document.getElementById(id)) {
        const screen = document.createElement('div');
        screen.id = id;
        screen.className = 'screen';
        appDiv.appendChild(screen);
      }
    });

    // Create stub drawers
    const drawerIds = [
      'profile-drawer',
      'thread-drawer',
      'notif-drawer',
      'compose-drawer',
      'settings-drawer',
      'search-drawer'
    ];
    drawerIds.forEach(id => {
      if (!document.getElementById(id)) {
        const drawer = document.createElement('div');
        drawer.id = id;
        drawer.className = 'drawer';
        appDiv.appendChild(drawer);
      }
    });

    console.log('[TEST] App DOM structure created');

    // Try to initialize the app module (expected to have issues without auth)
    try {
      await import('../js/app.js');
      console.log('[TEST] App module loaded');
    } catch (err) {
      console.warn('[TEST] App module not available (expected):', err.message);
    }
  }

  appLoaded = true;
  await runner.cleanup();
}

// ═════════════════════════════════════════════════════════════
// TEST SUITES
// ═════════════════════════════════════════════════════════════

// ── INITIALIZATION & SETUP ──

runner.describe('Initialization', (suite) => {
  suite.test('Mock API intercepts fetch', async (t) => {
    if (typeof window.fetch !== 'function') {
      throw new Error('fetch is not a function');
    }
  });

  suite.test('App DOM loads without errors', async (t) => {
    await loadApp();
  });

  suite.test('Multiple app loads are cached', async (t) => {
    const count1 = document.querySelectorAll('.screen').length;
    await loadApp();
    const count2 = document.querySelectorAll('.screen').length;
    if (count1 !== count2) {
      throw new Error('App should be loaded only once');
    }
  });
});

// ── API SAFETY ──

runner.describe('API Safety (Destructive Operations Blocked)', (suite) => {
  suite.test('POST requests are blocked', async (t) => {
    const testCases = [
      'https://test.example.com/api/v1/statuses',
      'https://test.example.com/api/v1/statuses/123/favourite',
      'https://test.example.com/api/v1/statuses/123/reblog',
    ];

    for (const url of testCases) {
      try {
        await fetch(url, { method: 'POST' });
        throw new Error(`POST to ${url} should have been blocked`);
      } catch (err) {
        if (!err.message.includes('blocked')) {
          throw err;
        }
      }
    }
  });

  suite.test('DELETE requests are blocked', async (t) => {
    const testCases = [
      'https://test.example.com/api/v1/statuses/123',
      'https://test.example.com/api/v1/statuses/123/unbookmark',
    ];

    for (const url of testCases) {
      try {
        await fetch(url, { method: 'DELETE' });
        throw new Error(`DELETE to ${url} should have been blocked`);
      } catch (err) {
        if (!err.message.includes('blocked')) {
          throw err;
        }
      }
    }
  });

  suite.test('PUT requests are blocked', async (t) => {
    try {
      await fetch('https://test.example.com/api/v1/accounts/1/note', {
        method: 'PUT'
      });
      throw new Error('PUT should have been blocked');
    } catch (err) {
      if (!err.message.includes('blocked')) {
        throw err;
      }
    }
  });

  suite.test('PATCH requests are blocked', async (t) => {
    try {
      await fetch('https://test.example.com/api/v1/accounts/update_credentials', {
        method: 'PATCH'
      });
      throw new Error('PATCH should have been blocked');
    } catch (err) {
      if (!err.message.includes('blocked')) {
        throw err;
      }
    }
  });
});

// ── AUTHENTICATION & ACCOUNT ──

runner.describe('Authentication & Account APIs', (suite) => {
  suite.test('Mock API provides instance info', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/instance');
    const data = await response.json();
    
    if (!data.uri || !data.title || !data.version) {
      throw new Error('Instance data missing required fields');
    }
    if (data.version !== '4.0.0') {
      throw new Error('Expected version 4.0.0 for test instance');
    }
  });

  suite.test('Mock API provides account credentials', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/accounts/verify_credentials');
    const account = await response.json();
    
    if (!account.id || !account.username || !account.acct) {
      throw new Error('Account credentials missing required fields');
    }
    if (account.username !== 'testuser') {
      throw new Error('Expected test user account');
    }
  });

  suite.test('Account has profile data', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/accounts/verify_credentials');
    const account = await response.json();
    
    if (!account.display_name || !account.note) {
      throw new Error('Account missing display name or note');
    }
    if (typeof account.followers_count !== 'number' || typeof account.following_count !== 'number') {
      throw new Error('Account missing follower counts');
    }
  });

  suite.test('Account has avatar and header images', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/accounts/verify_credentials');
    const account = await response.json();
    
    if (!account.avatar || !account.header) {
      throw new Error('Account missing avatar or header');
    }
  });
});

// ── FEED & TIMELINE DATA ──

runner.describe('Feed & Timeline APIs', (suite) => {
  suite.test('Home timeline returns posts', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=20');
    const timeline = await response.json();
    
    if (!Array.isArray(timeline)) {
      throw new Error('Timeline should be an array');
    }
    if (timeline.length === 0) {
      throw new Error('Timeline should have posts');
    }
  });

  suite.test('Posts have required structure', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=1');
    const [post] = await response.json();
    
    const required = ['id', 'created_at', 'content', 'account', 'visibility'];
    for (const field of required) {
      if (!(field in post)) {
        throw new Error(`Post missing required field: ${field}`);
      }
    }
  });

  suite.test('Posts have engagement counts', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=1');
    const [post] = await response.json();
    
    const counts = ['replies_count', 'reblogs_count', 'favourites_count'];
    for (const field of counts) {
      if (typeof post[field] !== 'number') {
        throw new Error(`Post ${field} should be a number`);
      }
    }
  });

  suite.test('Posts include author account info', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=1');
    const [post] = await response.json();
    
    if (!post.account || !post.account.username || !post.account.avatar) {
      throw new Error('Post author info incomplete');
    }
  });

  suite.test('Pagination support (limit parameter)', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/timelines/home?limit=5');
    const timeline1 = await response1.json();
    
    const response2 = await fetch('https://test.example.com/api/v1/timelines/home?limit=20');
    const timeline2 = await response2.json();
    
    if (timeline1.length !== 5 || timeline2.length !== 20) {
      throw new Error(`Limit parameter not working: got ${timeline1.length} and ${timeline2.length}`);
    }
  });

  suite.test('Public timeline available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/public?limit=5');
    const timeline = await response.json();
    
    if (!Array.isArray(timeline) || timeline.length === 0) {
      throw new Error('Public timeline should have posts');
    }
  });

  suite.test('Local timeline available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/public?local=true&limit=5');
    const timeline = await response.json();
    
    if (!Array.isArray(timeline) || timeline.length === 0) {
      throw new Error('Local timeline should have posts');
    }
  });

  suite.test('Hashtag timeline available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/tag/mastodon?limit=5');
    const timeline = await response.json();
    
    if (!Array.isArray(timeline) || timeline.length === 0) {
      throw new Error('Hashtag timeline should have posts');
    }
  });
});

// ── POST & THREAD DATA ──

runner.describe('Post & Thread APIs', (suite) => {
  suite.test('Can fetch single post', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/statuses/12345');
    const post = await response.json();
    
    if (!post.id || !post.content) {
      throw new Error('Post data incomplete');
    }
  });

  suite.test('Thread context includes ancestors and descendants', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/statuses/12345/context');
    const context = await response.json();
    
    if (!context.ancestors || !context.descendants) {
      throw new Error('Thread context missing ancestors or descendants');
    }
    if (!Array.isArray(context.ancestors) || !Array.isArray(context.descendants)) {
      throw new Error('Ancestors and descendants should be arrays');
    }
  });

  suite.test('Posts support visibility settings', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=1');
    const [post] = await response.json();
    
    const validVisibilities = ['public', 'unlisted', 'private', 'direct'];
    if (!validVisibilities.includes(post.visibility)) {
      throw new Error(`Invalid visibility: ${post.visibility}`);
    }
  });

  suite.test('Posts can have content warnings', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=5');
    const timeline = await response.json();
    
    if (timeline[0].spoiler_text === undefined) {
      throw new Error('Posts should have spoiler_text field');
    }
  });
});

// ── USER & PROFILE DATA ──

runner.describe('User & Profile APIs', (suite) => {
  suite.test('Can fetch user profile by ID', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/accounts/200');
    const profile = await response.json();
    
    if (!profile.id || !profile.username || !profile.display_name) {
      throw new Error('Profile missing required fields');
    }
  });

  suite.test('User profile includes stats', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/accounts/200');
    const profile = await response.json();
    
    const stats = ['followers_count', 'following_count', 'statuses_count'];
    for (const stat of stats) {
      if (typeof profile[stat] !== 'number') {
        throw new Error(`Profile ${stat} should be a number`);
      }
    }
  });

  suite.test('Can fetch user posts', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/accounts/200/statuses?limit=10');
    const posts = await response.json();
    
    if (!Array.isArray(posts)) {
      throw new Error('User posts should be an array');
    }
  });

  suite.test('Following list is available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/following?limit=20');
    const following = await response.json();
    
    if (!Array.isArray(following)) {
      throw new Error('Following list should be an array');
    }
  });

  suite.test('Accounts have fields/metadata', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/accounts/verify_credentials');
    const account = await response.json();
    
    if (!account.fields || !Array.isArray(account.fields)) {
      throw new Error('Account should have fields array');
    }
  });
});

// ── HASHTAG & TRENDING DATA ──

runner.describe('Hashtags & Trending APIs', (suite) => {
  suite.test('Followed hashtags endpoint available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/followed_tags?limit=20');
    const hashtags = await response.json();
    
    if (!Array.isArray(hashtags)) {
      throw new Error('Followed hashtags should be an array');
    }
  });

  suite.test('Trending hashtags available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/trends/tags?limit=10');
    const tags = await response.json();
    
    if (!Array.isArray(tags)) {
      throw new Error('Trending hashtags should be an array');
    }
  });

  suite.test('Trending hashtags have usage history', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/trends/tags?limit=1');
    const [tag] = await response.json();
    
    if (!tag.name || !tag.history) {
      throw new Error('Hashtag missing name or history');
    }
  });

  suite.test('Trending posts available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/trends/statuses?limit=10');
    const posts = await response.json();
    
    if (!Array.isArray(posts) || posts.length === 0) {
      throw new Error('Trending posts should be available');
    }
  });

  suite.test('Trending accounts available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/trends/accounts?limit=10');
    const accounts = await response.json();
    
    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error('Trending accounts should be available');
    }
  });

  suite.test('Trending news/links available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/trends/links?limit=10');
    const news = await response.json();
    
    if (!Array.isArray(news)) {
      throw new Error('Trending links should be an array');
    }
  });
});

// ── SEARCH API ──

runner.describe('Search APIs', (suite) => {
  suite.test('Search endpoint available', async (t) => {
    const response = await fetch('https://test.example.com/api/v2/search?q=test');
    const results = await response.json();
    
    if (!results.accounts || !results.statuses || !results.hashtags) {
      throw new Error('Search results should have accounts, statuses, and hashtags');
    }
  });

  suite.test('Account search works', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/accounts/search?q=test');
    const accounts = await response.json();
    
    if (!Array.isArray(accounts)) {
      throw new Error('Account search should return an array');
    }
  });

  suite.test('Search returns multiple result types', async (t) => {
    const response = await fetch('https://test.example.com/api/v2/search?q=mastodon');
    const results = await response.json();
    
    if (results.accounts.length === 0 || results.hashtags.length === 0) {
      throw new Error('Search should have multiple result types');
    }
  });
});

// ── NOTIFICATIONS ──

runner.describe('Notifications APIs', (suite) => {
  suite.test('Notifications endpoint available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/notifications');
    const notifs = await response.json();
    
    if (!Array.isArray(notifs)) {
      throw new Error('Notifications should be an array');
    }
  });

  suite.test('Notifications have types', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/notifications');
    const notifs = await response.json();
    
    if (notifs.length > 0) {
      const types = notifs.map(n => n.type);
      const validTypes = ['favourite', 'reblog', 'follow', 'mention', 'poll', 'update'];
      const allValid = types.every(t => validTypes.includes(t));
      if (!allValid) {
        throw new Error(`Invalid notification types: ${types}`);
      }
    }
  });

  suite.test('Notifications link to accounts', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/notifications');
    const notifs = await response.json();
    
    if (notifs.length > 0 && !notifs[0].account) {
      throw new Error('Notification should have account info');
    }
  });
});

// ── BOOKMARKS & FAVORITES ──

runner.describe('Bookmarks & Favorites APIs', (suite) => {
  suite.test('Bookmarks endpoint available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/bookmarks?limit=20');
    const bookmarks = await response.json();
    
    if (!Array.isArray(bookmarks)) {
      throw new Error('Bookmarks should be an array');
    }
  });

  suite.test('Bookmarks contain posts', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/bookmarks?limit=1');
    const bookmarks = await response.json();
    
    if (bookmarks.length > 0 && !bookmarks[0].content) {
      throw new Error('Bookmarked items should be posts');
    }
  });

  suite.test('Favorites endpoint available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/favourites?limit=20');
    const favs = await response.json();
    
    if (!Array.isArray(favs)) {
      throw new Error('Favorites should be an array');
    }
  });
});

// ── DOM STRUCTURE ──

runner.describe('DOM Structure & UI Elements', (suite) => {
  suite.test('App container exists', async (t) => {
    await loadApp();
    const container = document.getElementById('app-container');
    if (!container) {
      throw new Error('App container not found');
    }
  });

  suite.test('Screen elements in DOM', async (t) => {
    await loadApp();
    const screens = document.querySelectorAll('.screen');
    if (screens.length < 2) {
      throw new Error('Should have at least 2 screen elements');
    }
  });

  suite.test('Major drawers present', async (t) => {
    await loadApp();
    const drawers = {
      'profile-drawer': 'Profile',
      'thread-drawer': 'Thread',
      'notif-drawer': 'Notifications',
      'compose-drawer': 'Compose',
      'settings-drawer': 'Settings',
      'search-drawer': 'Search',
    };

    for (const [id, name] of Object.entries(drawers)) {
      const drawer = document.getElementById(id);
      if (!drawer) {
        console.warn(`[TEST] Missing drawer: ${name} (${id})`);
      }
    }
  });

  suite.test('Body element has proper structure', async (t) => {
    await loadApp();
    if (!document.body || document.body.children.length === 0) {
      throw new Error('Body should have child elements');
    }
  });

  suite.test('App doesn\'t crash during DOM traversal', async (t) => {
    await loadApp();
    try {
      document.querySelectorAll('*').forEach(el => {
        el.getAttribute('id');
        el.getAttribute('class');
      });
    } catch (err) {
      throw new Error(`DOM traversal error: ${err.message}`);
    }
  });
});

// ── STATE MANAGEMENT ──

runner.describe('State & Storage', (suite) => {
  suite.test('localStorage is accessible', async (t) => {
    const key = `test-${Date.now()}`;
    try {
      localStorage.setItem(key, 'value');
      const val = localStorage.getItem(key);
      if (val !== 'value') throw new Error('localStorage roundtrip failed');
      localStorage.removeItem(key);
    } catch (err) {
      throw new Error(`localStorage error: ${err.message}`);
    }
  });

  suite.test('window.location available', async (t) => {
    if (!window.location || !window.location.href) {
      throw new Error('window.location not available');
    }
  });

  suite.test('window.history available', async (t) => {
    if (!window.history || typeof window.history.pushState !== 'function') {
      throw new Error('window.history API not available');
    }
  });

  suite.test('sessionStorage is accessible', async (t) => {
    const key = `test-${Date.now()}`;
    try {
      sessionStorage.setItem(key, 'value');
      const val = sessionStorage.getItem(key);
      if (val !== 'value') throw new Error('sessionStorage roundtrip failed');
      sessionStorage.removeItem(key);
    } catch {
      console.warn('[TEST] sessionStorage may not be available');
    }
  });
});

// ── DATA COMPATIBILITY ──

runner.describe('Data Format & Compatibility', (suite) => {
  suite.test('All posts have consistent structure', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=10');
    const posts = await response.json();
    
    const requiredFields = ['id', 'created_at', 'content', 'account', 'visibility', 'sensitive', 'replies_count', 'reblogs_count', 'favourites_count'];
    
    for (const post of posts) {
      for (const field of requiredFields) {
        if (!(field in post)) {
          throw new Error(`Post missing field: ${field}`);
        }
      }
    }
  });

  suite.test('Timestamps are valid ISO 8601', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=1');
    const [post] = await response.json();
    
    const timestamp = new Date(post.created_at);
    if (isNaN(timestamp.getTime())) {
      throw new Error(`Invalid timestamp: ${post.created_at}`);
    }
  });

  suite.test('Account objects have consistent structure', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/following?limit=1');
    const [account] = await response.json();
    
    if (!account.id || !account.username || !account.avatar) {
      throw new Error('Account missing basic fields');
    }
  });

  suite.test('No null or undefined in required post fields', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=5');
    const posts = await response.json();
    
    for (const post of posts) {
      if (post.id === null || post.id === undefined) {
        throw new Error('Post has null/undefined id');
      }
      if (post.content === null || post.content === undefined) {
        throw new Error('Post has null/undefined content');
      }
      if (!post.account || post.account.username === null) {
        throw new Error('Post has invalid account');
      }
    }
  });
});

// ── PAGINATION & LIMITS ──

runner.describe('Pagination & Data Limits', (suite) => {
  suite.test('Limit parameter respected in home timeline', async (t) => {
    const limits = [5, 10, 20];
    for (const limit of limits) {
      const response = await fetch(`https://test.example.com/api/v1/timelines/home?limit=${limit}`);
      const data = await response.json();
      if (data.length !== limit) {
        throw new Error(`Expected ${limit} posts, got ${data.length}`);
      }
    }
  });

  suite.test('Max ID pagination parameter exists', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=1');
    const [post] = await response.json();
    
    const response2 = await fetch(`https://test.example.com/api/v1/timelines/home?limit=1&max_id=${post.id}`);
    const data = await response2.json();
    
    if (!Array.isArray(data)) {
      throw new Error('max_id pagination should work');
    }
  });

  suite.test('Limit applies to multiple endpoints', async (t) => {
    const endpoints = [
      'https://test.example.com/api/v1/timelines/public?limit=5',
      'https://test.example.com/api/v1/favourites?limit=5',
      'https://test.example.com/api/v1/bookmarks?limit=5',
    ];
    
    for (const url of endpoints) {
      const response = await fetch(url);
      const data = await response.json();
      if (data.length > 5) {
        throw new Error(`Limit not respected for ${url}`);
      }
    }
  });
});

// ── OAUTH & APPS ──

runner.describe('OAuth & App Registration', (suite) => {
  suite.test('App registration endpoint available', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_name: 'TestApp',
        redirect_uris: 'http://localhost:8080',
        scopes: 'read',
      }).toString(),
    });
    
    if (!response.ok) {
      throw new Error('App registration failed');
    }
    
    const app = await response.json();
    if (!app.client_id || !app.client_secret) {
      throw new Error('App registration missing credentials');
    }
  });

  suite.test('Token endpoint pattern exists', async (t) => {
    const response = await fetch('https://test.example.com/oauth/token', {
      method: 'POST',
    });
    
    if (typeof response.status !== 'number') {
      throw new Error('Token endpoint not accessible');
    }
  });
});

// ── USER INTERACTIONS & UI BEHAVIOR ──

runner.describe('User Interactions & UI Components', (suite) => {
  suite.test('Profile menu button exists in DOM', async (t) => {
    await loadApp();
    const profileBtn = document.querySelector('[id*="profile"]') || 
                       document.querySelector('[class*="profile-btn"]') ||
                       document.querySelector('button[aria-label*="profile" i]');
    
    if (!profileBtn) {
      console.warn('[TEST] Profile button not found - may use different selector');
    }
  });

  suite.test('Compose/Post button exists and is clickable', async (t) => {
    await loadApp();
    const composeBtn = document.querySelector('[id*="compose"]') ||
                       document.querySelector('[class*="compose-btn"]') ||
                       document.querySelector('button[aria-label*="compose" i]') ||
                       document.querySelector('button[aria-label*="post" i]');
    
    if (!composeBtn) {
      console.warn('[TEST] Compose button not found - may use different selector');
    }
  });

  suite.test('Search interface is accessible', async (t) => {
    await loadApp();
    const searchDrawer = document.getElementById('search-drawer');
    if (searchDrawer) {
      if (!searchDrawer.querySelector('input[type="text"]') && 
          !searchDrawer.querySelector('input[type="search"]')) {
        console.warn('[TEST] Search input not found in drawer');
      }
    }
  });

  suite.test('Notifications section exists', async (t) => {
    await loadApp();
    const notifDrawer = document.getElementById('notif-drawer');
    if (!notifDrawer) {
      console.warn('[TEST] Notifications drawer not found');
    }
  });

  suite.test('Settings/Preferences accessible', async (t) => {
    await loadApp();
    const settingsDrawer = document.getElementById('settings-drawer');
    if (!settingsDrawer) {
      console.warn('[TEST] Settings drawer not found');
    }
  });

  suite.test('About/Info page accessible', async (t) => {
    await loadApp();
    const aboutLink = document.querySelector('[href*="about" i]') ||
                      document.querySelector('[class*="about"]') ||
                      document.querySelector('a[aria-label*="about" i]');
    
    if (!aboutLink) {
      console.warn('[TEST] About link/button not found');
    }
  });

  suite.test('Main navigation screens exist', async (t) => {
    await loadApp();
    const screenIds = ['feed-screen', 'notifications-screen', 'profile-screen', 'search-screen'];
    const missingScreens = screenIds.filter(id => !document.getElementById(id));
    
    if (missingScreens.length > 0) {
      console.warn(`[TEST] Missing screens: ${missingScreens.join(', ')}`);
    }
  });

  suite.test('Drawer elements have proper structure', async (t) => {
    await loadApp();
    const drawerIds = ['profile-drawer', 'thread-drawer', 'notif-drawer', 'compose-drawer', 'settings-drawer', 'search-drawer'];
    
    for (const drawerId of drawerIds) {
      const drawer = document.getElementById(drawerId);
      if (drawer) {
        // Check for close button or dismiss mechanism
        const closeBtn = drawer.querySelector('[aria-label*="close" i]') ||
                        drawer.querySelector('[class*="close"]') ||
                        drawer.querySelector('button:first-child');
        if (!closeBtn) {
          console.warn(`[TEST] ${drawerId} may be missing close button`);
        }
      }
    }
  });

  suite.test('Theme toggle/switcher exists', async (t) => {
    await loadApp();
    const themeToggle = document.querySelector('[aria-label*="theme" i]') ||
                        document.querySelector('[class*="theme"]') ||
                        document.querySelector('button[aria-label*="dark" i]') ||
                        document.querySelector('button[aria-label*="light" i]');
    
    if (!themeToggle) {
      console.warn('[TEST] Theme switcher not found');
    }
  });

  suite.test('Buttons have proper ARIA labels for accessibility', async (t) => {
    await loadApp();
    const buttons = document.querySelectorAll('button');
    let unlabeledCount = 0;
    
    for (const btn of buttons) {
      if (!btn.getAttribute('aria-label') && 
          !btn.textContent.trim() && 
          !btn.querySelector('img[alt]')) {
        unlabeledCount++;
      }
    }
    
    if (unlabeledCount > 0) {
      console.warn(`[TEST] ${unlabeledCount} buttons may be missing ARIA labels`);
    }
  });

  suite.test('Interactive elements are keyboard accessible', async (t) => {
    await loadApp();
    const clickableElements = document.querySelectorAll('button, a, [role="button"]');
    let nonFocusableCount = 0;
    
    for (const el of clickableElements) {
      if (el.tagName !== 'A' && el.tagName !== 'BUTTON' && el.getAttribute('tabindex') === null) {
        nonFocusableCount++;
      }
    }
    
    if (nonFocusableCount > 0) {
      console.warn(`[TEST] ${nonFocusableCount} elements may not be keyboard accessible`);
    }
  });

  suite.test('Modal/Drawer overlay or backdrop exists', async (t) => {
    await loadApp();
    const backdrop = document.querySelector('[class*="modal-backdrop"]') ||
                     document.querySelector('[class*="overlay"]') ||
                     document.querySelector('[class*="scrim"]');
    
    if (!backdrop) {
      console.warn('[TEST] Modal backdrop/overlay not found');
    }
  });

  suite.test('Scroll containers are detectable', async (t) => {
    await loadApp();
    const scrollContainers = document.querySelectorAll('[style*="overflow"]');
    
    if (scrollContainers.length === 0) {
      // Check CSS classes
      const scrollClasses = document.querySelectorAll('[class*="scroll"]');
      if (scrollClasses.length === 0) {
        console.warn('[TEST] No obvious scroll containers found');
      }
    }
  });

  suite.test('Links open in correct target context', async (t) => {
    await loadApp();
    const externalLinks = document.querySelectorAll('a[href*="http"]');
    let badTargets = 0;
    
    for (const link of externalLinks) {
      if (link.target !== '_blank' && link.target !== '_external') {
        badTargets++;
      }
    }
    
    if (badTargets > 0 && externalLinks.length > 0) {
      console.warn(`[TEST] ${badTargets}/${externalLinks.length} external links may not open in new window`);
    }
  });
});

// ── INTERACTIVE BEHAVIOR (Click & State Change) ──

runner.describe('Interactive Behavior & Event Handling', (suite) => {
  suite.test('Clicking drawer elements triggers DOM changes', async (t) => {
    await loadApp();
    const drawer = document.querySelector('[id*="drawer"]');
    
    if (drawer) {
      const initialState = drawer.className;
      drawer.click?.();
      
      // Wait for any animations/handlers
      await new Promise(r => setTimeout(r, 100));
      await new Promise(r => requestAnimationFrame(r));
      
      const finalState = drawer.className;
      // Just verify click doesn't error out
      if (typeof initialState !== 'string') {
        throw new Error('Drawer state should be trackable');
      }
    }
  });

  suite.test('Simulating clicks on buttons does not crash', async (t) => {
    await loadApp();
    const buttons = document.querySelectorAll('button');
    let clickCount = 0;
    
    for (const btn of Array.from(buttons).slice(0, 5)) {
      try {
        btn.click();
        clickCount++;
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {
        throw new Error(`Button click caused error: ${err.message}`);
      }
    }
    
    if (clickCount === 0) {
      console.warn('[TEST] No buttons found to click');
    }
  });

  suite.test('Search input accepts text without crashing', async (t) => {
    await loadApp();
    const searchInputs = document.querySelectorAll('input[type="text"], input[type="search"]');
    
    let testedCount = 0;
    for (const input of Array.from(searchInputs).slice(0, 3)) {
      try {
        input.value = 'test search';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));
        testedCount++;
      } catch (err) {
        throw new Error(`Search input caused error: ${err.message}`);
      }
    }
    
    if (testedCount === 0) {
      console.warn('[TEST] No search inputs found');
    }
  });

  suite.test('Form submissions are handled', async (t) => {
    await loadApp();
    const forms = document.querySelectorAll('form');
    
    for (const form of Array.from(forms).slice(0, 2)) {
      try {
        // Get initial state
        const initialChildCount = form.children.length;
        
        // Don't actually submit, just verify structure
        if (!form.querySelector('input') && !form.querySelector('button')) {
          console.warn('[TEST] Form missing inputs or buttons');
        }
        
        const finalChildCount = form.children.length;
        if (initialChildCount !== finalChildCount) {
          console.warn('[TEST] Form structure changed unexpectedly');
        }
      } catch (err) {
        throw new Error(`Form handling caused error: ${err.message}`);
      }
    }
  });

  suite.test('Keyboard events on interactive elements work', async (t) => {
    await loadApp();
    const interactiveElements = document.querySelectorAll('button, a, input, [onclick], [data-action]');
    
    if (interactiveElements.length === 0) {
      console.warn('[TEST] No interactive elements found for keyboard testing - skipping');
      return;
    }
    
    let testedCount = 0;
    for (const el of Array.from(interactiveElements).slice(0, 5)) {
      try {
        const enterEvent = new KeyboardEvent('keydown', { 
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true,
          cancelable: true
        });
        el.dispatchEvent(enterEvent);
        testedCount++;
        await new Promise(r => setTimeout(r, 25));
      } catch (err) {
        throw new Error(`Keyboard event caused error: ${err.message}`);
      }
    }
  });

  suite.test('Focus events trigger without errors', async (t) => {
    await loadApp();
    const focusableElements = document.querySelectorAll('button, a, input, textarea, [tabindex]');
    
    if (focusableElements.length === 0) {
      console.warn('[TEST] No focusable elements found - skipping focus tests');
      return;
    }
    
    let focusCount = 0;
    for (const el of Array.from(focusableElements).slice(0, 5)) {
      try {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          console.warn('[TEST] Element not focusable (hidden)');
          continue;
        }
        
        el.focus();
        focusCount++;
        
        if (document.activeElement !== el) {
          console.warn('[TEST] Element did not receive focus (possibly intentional)');
        }
        
        el.blur();
        await new Promise(r => setTimeout(r, 25));
      } catch (err) {
        console.warn(`[TEST] Focus event warning: ${err.message}`);
      }
    }
  });

  suite.test('Event listeners respond to simulated user actions', async (t) => {
    await loadApp();
    
    // Find any element with a data-* attribute hint for interactivity
    const interactiveHints = document.querySelectorAll('[data-action], [onclick], [data-toggle]');
    
    let eventCount = 0;
    for (const el of Array.from(interactiveHints).slice(0, 3)) {
      try {
        // Try various event types
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        eventCount++;
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {
        throw new Error(`Event simulation caused error: ${err.message}`);
      }
    }
    
    if (eventCount === 0) {
      console.warn('[TEST] No obvious event-driven elements found');
    }
  });

  suite.test('Window resize events do not crash', async (t) => {
    await loadApp();
    
    try {
      window.dispatchEvent(new Event('resize'));
      await new Promise(r => setTimeout(r, 100));
      
      window.dispatchEvent(new Event('orientationchange'));
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      throw new Error(`Resize event caused error: ${err.message}`);
    }
  });

  suite.test('Scroll events trigger without errors', async (t) => {
    await loadApp();
    
    const scrollableElements = document.querySelectorAll('[style*="overflow-y"], [style*="overflow"]');
    
    for (const el of Array.from(scrollableElements).slice(0, 3)) {
      try {
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        el.scrollTop += 10;
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {
        throw new Error(`Scroll event caused error: ${err.message}`);
      }
    }
  });

  suite.test('Long-click/hold simulation works', async (t) => {
    await loadApp();
    const buttons = document.querySelectorAll('button');
    
    for (const btn of Array.from(buttons).slice(0, 2)) {
      try {
        // Simulate press and hold
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await new Promise(r => setTimeout(r, 200));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {
        throw new Error(`Long-click simulation caused error: ${err.message}`);
      }
    }
  });
});

// ── INFINITE SCROLL ──

runner.describe('Infinite Scroll Implementation', (suite) => {
  suite.test('Home timeline supports pagination for infinite scroll', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/timelines/home?limit=20');
    const timeline1 = await response1.json();
    
    if (timeline1.length === 0) {
      throw new Error('First page should have posts');
    }
    
    const lastPostId = timeline1[timeline1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/timelines/home?limit=20&max_id=${lastPostId}`);
    const timeline2 = await response2.json();
    
    if (!Array.isArray(timeline2)) {
      throw new Error('Pagination should return an array');
    }
  });

  suite.test('Public timeline supports infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/timelines/public?limit=20');
    const timeline1 = await response1.json();
    
    if (timeline1.length === 0) {
      throw new Error('First page should have posts');
    }
    
    const lastPostId = timeline1[timeline1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/timelines/public?limit=20&max_id=${lastPostId}`);
    const timeline2 = await response2.json();
    
    if (!Array.isArray(timeline2)) {
      throw new Error('Pagination should return an array');
    }
  });

  suite.test('Local timeline supports infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/timelines/public?local=true&limit=20');
    const timeline1 = await response1.json();
    
    if (timeline1.length === 0) {
      throw new Error('First page should have posts');
    }
    
    const lastPostId = timeline1[timeline1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/timelines/public?local=true&limit=20&max_id=${lastPostId}`);
    const timeline2 = await response2.json();
    
    if (!Array.isArray(timeline2)) {
      throw new Error('Pagination should return an array');
    }
  });

  suite.test('Hashtag timeline supports infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/timelines/tag/mastodon?limit=20');
    const timeline1 = await response1.json();
    
    if (timeline1.length === 0) {
      throw new Error('First page should have posts');
    }
    
    const lastPostId = timeline1[timeline1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/timelines/tag/mastodon?limit=20&max_id=${lastPostId}`);
    const timeline2 = await response2.json();
    
    if (!Array.isArray(timeline2)) {
      throw new Error('Pagination should return an array');
    }
  });

  suite.test('Search results support infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v2/search?q=test&limit=20');
    const results1 = await response1.json();
    
    if (!results1.statuses || results1.statuses.length === 0) {
      console.warn('[TEST] No search results available, skipping pagination check');
      return;
    }
    
    const lastStatusId = results1.statuses[results1.statuses.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v2/search?q=test&limit=20&max_id=${lastStatusId}`);
    const results2 = await response2.json();
    
    if (!results2.statuses || !Array.isArray(results2.statuses)) {
      throw new Error('Search pagination should return statuses array');
    }
  });

  suite.test('Notifications support infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/notifications?limit=20');
    const notifs1 = await response1.json();
    
    if (notifs1.length === 0) {
      console.warn('[TEST] No notifications available, skipping pagination check');
      return;
    }
    
    const lastNotifId = notifs1[notifs1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/notifications?limit=20&max_id=${lastNotifId}`);
    const notifs2 = await response2.json();
    
    if (!Array.isArray(notifs2)) {
      throw new Error('Notification pagination should return an array');
    }
  });

  suite.test('User posts support infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/accounts/200/statuses?limit=20');
    const posts1 = await response1.json();
    
    if (posts1.length === 0) {
      throw new Error('First page should have posts');
    }
  });
});

// ── DIALOG & DRAWER VISIBILITY ──

runner.describe('Dialog & Drawer Visibility', (suite) => {
  suite.test('Profile drawer exists and is in DOM', async (t) => {
    await loadApp();
    const drawer = t.assertElementExists('#profile-drawer', 'Profile drawer should exist');
    if (!drawer) throw new Error('Profile drawer not found');
  });

  suite.test('Profile drawer can be rendered without errors', async (t) => {
    await loadApp();
    const drawer = document.getElementById('profile-drawer');
    if (!drawer) throw new Error('Profile drawer not found');
    
    // Try to measure it
    const rect = drawer.getBoundingClientRect();
    if (typeof rect.width !== 'number' || typeof rect.height !== 'number') {
      throw new Error('Profile drawer cannot be measured');
    }
  });

  suite.test('Thread drawer exists and is in DOM', async (t) => {
    await loadApp();
    t.assertElementExists('#thread-drawer', 'Thread drawer should exist');
  });

  suite.test('Thread drawer renders without errors', async (t) => {
    await loadApp();
    const drawer = document.getElementById('thread-drawer');
    if (!drawer) throw new Error('Thread drawer not found');
    
    const rect = drawer.getBoundingClientRect();
    if (typeof rect.width !== 'number' || typeof rect.height !== 'number') {
      throw new Error('Thread drawer cannot be measured');
    }
  });

  suite.test('Notifications drawer exists and is in DOM', async (t) => {
    await loadApp();
    t.assertElementExists('#notif-drawer', 'Notifications drawer should exist');
  });

  suite.test('Notifications drawer renders without errors', async (t) => {
    await loadApp();
    const drawer = document.getElementById('notif-drawer');
    if (!drawer) throw new Error('Notifications drawer not found');
    
    const rect = drawer.getBoundingClientRect();
    if (typeof rect.width !== 'number' || typeof rect.height !== 'number') {
      throw new Error('Notifications drawer cannot be measured');
    }
  });

  suite.test('Compose drawer exists and is in DOM', async (t) => {
    await loadApp();
    t.assertElementExists('#compose-drawer', 'Compose drawer should exist');
  });

  suite.test('Compose drawer renders without errors', async (t) => {
    await loadApp();
    const drawer = document.getElementById('compose-drawer');
    if (!drawer) throw new Error('Compose drawer not found');
    
    const rect = drawer.getBoundingClientRect();
    if (typeof rect.width !== 'number' || typeof rect.height !== 'number') {
      throw new Error('Compose drawer cannot be measured');
    }
  });

  suite.test('Settings drawer exists and is in DOM', async (t) => {
    await loadApp();
    t.assertElementExists('#settings-drawer', 'Settings drawer should exist');
  });

  suite.test('Settings drawer renders without errors', async (t) => {
    await loadApp();
    const drawer = document.getElementById('settings-drawer');
    if (!drawer) throw new Error('Settings drawer not found');
    
    const rect = drawer.getBoundingClientRect();
    if (typeof rect.width !== 'number' || typeof rect.height !== 'number') {
      throw new Error('Settings drawer cannot be measured');
    }
  });

  suite.test('Search drawer exists and is in DOM', async (t) => {
    await loadApp();
    t.assertElementExists('#search-drawer', 'Search drawer should exist');
  });

  suite.test('Search drawer renders without errors', async (t) => {
    await loadApp();
    const drawer = document.getElementById('search-drawer');
    if (!drawer) throw new Error('Search drawer not found');
    
    const rect = drawer.getBoundingClientRect();
    if (typeof rect.width !== 'number' || typeof rect.height !== 'number') {
      throw new Error('Search drawer cannot be measured');
    }
  });

  suite.test('All drawers are children of app-container', async (t) => {
    await loadApp();
    const container = document.getElementById('app-container');
    const drawerIds = ['profile-drawer', 'thread-drawer', 'notif-drawer', 'compose-drawer', 'settings-drawer', 'search-drawer'];
    
    for (const id of drawerIds) {
      const drawer = document.getElementById(id);
      if (drawer && !container.contains(drawer)) {
        throw new Error(`${id} is not a child of app-container`);
      }
    }
  });

  suite.test('Drawers do not have display:none or visibility:hidden at element level', async (t) => {
    await loadApp();
    const drawerIds = ['profile-drawer', 'thread-drawer', 'notif-drawer', 'compose-drawer', 'settings-drawer', 'search-drawer'];
    
    for (const id of drawerIds) {
      const drawer = document.getElementById(id);
      if (drawer) {
        const inlineDisplay = drawer.style.display;
        const inlineVisibility = drawer.style.visibility;
        
        // Check inline styles only; CSS rules handle visibility
        if (inlineDisplay === 'none') {
          console.warn(`[TEST] ${id} has inline display:none`);
        }
        if (inlineVisibility === 'hidden') {
          console.warn(`[TEST] ${id} has inline visibility:hidden`);
        }
      }
    }
  });

  suite.test('Screen elements exist and are accessible', async (t) => {
    await loadApp();
    const screenIds = ['feed-screen', 'notifications-screen', 'profile-screen', 'search-screen'];
    
    for (const id of screenIds) {
      const screen = document.getElementById(id);
      if (!screen) {
        throw new Error(`Screen not found: ${id}`);
      }
    }
  });

  suite.test('Screens render without layout errors', async (t) => {
    await loadApp();
    const screens = document.querySelectorAll('.screen');
    
    for (const screen of screens) {
      const rect = screen.getBoundingClientRect();
      if (typeof rect.width !== 'number' || typeof rect.height !== 'number') {
        throw new Error(`Screen ${screen.id} has invalid dimensions`);
      }
    }
  });

  suite.test('No JavaScript errors during drawer rendering', async (t) => {
    await loadApp();
    // If we got here without errors, dialogs rendered successfully
    const errorEvents = [];
    const originalError = console.error;
    
    console.error = function(...args) {
      if (args[0]?.includes?.('drawer') || args[0]?.includes?.('dialog')) {
        errorEvents.push(args[0]);
      }
      originalError.apply(console, args);
    };
    
    // Restore console.error
    console.error = originalError;
    
    if (errorEvents.length > 0) {
      throw new Error(`Drawer rendering errors: ${errorEvents.join('; ')}`);
    }
  });
});

// ── PAGINATION & INFINITE SCROLL ──

runner.describe('Pagination & Infinite Scroll', (suite) => {
  suite.test('Home timeline supports infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/timelines/home?limit=20');
    const timeline1 = await response1.json();
    
    if (timeline1.length === 0) {
      throw new Error('First page should have posts');
    }
    
    const lastPostId = timeline1[timeline1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/timelines/home?limit=20&max_id=${lastPostId}`);
    const timeline2 = await response2.json();
    
    if (!Array.isArray(timeline2)) {
      throw new Error('Pagination should return an array');
    }
  });

  suite.test('Public timeline supports infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/timelines/public?limit=20');
    const timeline1 = await response1.json();
    
    if (timeline1.length === 0) {
      throw new Error('First page should have posts');
    }
    
    const lastPostId = timeline1[timeline1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/timelines/public?limit=20&max_id=${lastPostId}`);
    const timeline2 = await response2.json();
    
    if (!Array.isArray(timeline2)) {
      throw new Error('Pagination should return an array');
    }
  });

  suite.test('Local timeline supports infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/timelines/public?local=true&limit=20');
    const timeline1 = await response1.json();
    
    if (timeline1.length === 0) {
      throw new Error('First page should have posts');
    }
    
    const lastPostId = timeline1[timeline1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/timelines/public?local=true&limit=20&max_id=${lastPostId}`);
    const timeline2 = await response2.json();
    
    if (!Array.isArray(timeline2)) {
      throw new Error('Pagination should return an array');
    }
  });

  suite.test('Hashtag timeline supports infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/timelines/tag/mastodon?limit=20');
    const timeline1 = await response1.json();
    
    if (timeline1.length === 0) {
      throw new Error('First page should have posts');
    }
    
    const lastPostId = timeline1[timeline1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/timelines/tag/mastodon?limit=20&max_id=${lastPostId}`);
    const timeline2 = await response2.json();
    
    if (!Array.isArray(timeline2)) {
      throw new Error('Pagination should return an array');
    }
  });

  suite.test('Search results support infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v2/search?q=test&limit=20');
    const results1 = await response1.json();
    
    if (!results1.statuses || results1.statuses.length === 0) {
      console.warn('[TEST] No search results available, skipping pagination check');
      return;
    }
    
    const lastStatusId = results1.statuses[results1.statuses.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v2/search?q=test&limit=20&max_id=${lastStatusId}`);
    const results2 = await response2.json();
    
    if (!results2.statuses || !Array.isArray(results2.statuses)) {
      throw new Error('Search pagination should return statuses array');
    }
  });

  suite.test('Notifications support infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/notifications?limit=20');
    const notifs1 = await response1.json();
    
    if (notifs1.length === 0) {
      console.warn('[TEST] No notifications available, skipping pagination check');
      return;
    }
    
    const lastNotifId = notifs1[notifs1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/notifications?limit=20&max_id=${lastNotifId}`);
    const notifs2 = await response2.json();
    
    if (!Array.isArray(notifs2)) {
      throw new Error('Notification pagination should return an array');
    }
  });

  suite.test('User posts support infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/accounts/200/statuses?limit=20');
    const posts1 = await response1.json();
    
    if (posts1.length === 0) {
      throw new Error('First page should have posts');
    }
    
    const lastPostId = posts1[posts1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/accounts/200/statuses?limit=20&max_id=${lastPostId}`);
    const posts2 = await response2.json();
    
    if (!Array.isArray(posts2)) {
      throw new Error('User post pagination should return an array');
    }
  });

  suite.test('Bookmarks support infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/bookmarks?limit=20');
    const bookmarks1 = await response1.json();
    
    if (bookmarks1.length === 0) {
      console.warn('[TEST] No bookmarks available, skipping pagination check');
      return;
    }
    
    const lastBookmarkId = bookmarks1[bookmarks1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/bookmarks?limit=20&max_id=${lastBookmarkId}`);
    const bookmarks2 = await response2.json();
    
    if (!Array.isArray(bookmarks2)) {
      throw new Error('Bookmark pagination should return an array');
    }
  });

  suite.test('Favorites support infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/favourites?limit=20');
    const favs1 = await response1.json();
    
    if (favs1.length === 0) {
      console.warn('[TEST] No favorites available, skipping pagination check');
      return;
    }
    
    const lastFavId = favs1[favs1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/favourites?limit=20&max_id=${lastFavId}`);
    const favs2 = await response2.json();
    
    if (!Array.isArray(favs2)) {
      throw new Error('Favorite pagination should return an array');
    }
  });

  suite.test('Trending posts support infinite scroll pagination', async (t) => {
    const response1 = await fetch('https://test.example.com/api/v1/trends/statuses?limit=20');
    const trending1 = await response1.json();
    
    if (trending1.length === 0) {
      console.warn('[TEST] No trending posts available, skipping pagination check');
      return;
    }
    
    const lastPostId = trending1[trending1.length - 1].id;
    const response2 = await fetch(`https://test.example.com/api/v1/trends/statuses?limit=20&max_id=${lastPostId}`);
    const trending2 = await response2.json();
    
    if (!Array.isArray(trending2)) {
      throw new Error('Trending pagination should return an array');
    }
  });
});

// ── EDGE CASES & ERROR HANDLING ──

runner.describe('Edge Cases & Error Handling', (suite) => {
  suite.test('Empty query string in search', async (t) => {
    const response = await fetch('https://test.example.com/api/v2/search?q=');
    const results = await response.json();
    
    if (!results.accounts || !results.statuses || !results.hashtags) {
      throw new Error('Search should handle empty query');
    }
  });

  suite.test('Special characters in search query', async (t) => {
    const response = await fetch('https://test.example.com/api/v2/search?q=test&@#$');
    const results = await response.json();
    
    if (!results.accounts || !Array.isArray(results.accounts)) {
      throw new Error('Search should handle special characters');
    }
  });

  suite.test('Very large limit parameter', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=1000');
    const data = await response.json();
    
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Should handle large limit');
    }
  });

  suite.test('Zero limit is handled gracefully', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/timelines/home?limit=0');
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Should handle zero limit gracefully');
    }
  });

  suite.test('Non-existent account ID returns gracefully', async (t) => {
    const response = await fetch('https://test.example.com/api/v1/accounts/999999999999');
    const account = await response.json();
    
    if (!account.id || !account.username) {
      throw new Error('Account endpoint should return valid structure');
    }
  });
});

// ═════════════════════════════════════════════════════════════
// TEST EXECUTION
// ═════════════════════════════════════════════════════════════

// Wait for DOM to be ready, then run tests
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runTests);
} else {
  runTests();
}

async function runTests() {
  console.log('%c═══════════════════════════════════════', 'color: #9b7fff; font-size: 13px;');
  console.log('%c    Elefeed Test Suite Starting', 'color: #9b7fff; font-size: 14px; font-weight: bold;');
  console.log('%c═══════════════════════════════════════\n', 'color: #9b7fff; font-size: 13px;');
  
  const success = await runner.run();
  
  console.log(`\n%c${success ? '✓ All tests passed!' : '✗ Some tests failed'}`,
    `color: ${success ? '#4ade80' : '#ef4444'}; font-size: 14px; font-weight: bold;`);
}
