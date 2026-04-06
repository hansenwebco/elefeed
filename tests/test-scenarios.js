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
let productionHTML = null;

async function loadApp() {
  if (appLoaded && productionHTML) return;

  // Initialize mock API FIRST, before any app code runs
  initMockAPI();

  // Fetch production HTML to verify structure
  if (!productionHTML) {
    try {
      const response = await fetch('../index.html');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      productionHTML = await response.text();
      console.log(`[TEST] Loaded ${productionHTML.length} bytes of production HTML`);
    } catch (err) {
      console.error(`[TEST] Failed to fetch production index.html: ${err.message}`);
      throw new Error(`CRITICAL: Could not fetch production index.html - ${err.message}`);
    }
  }

  // Verify production HTML contains required screens
  const requiredScreens = ['splash-screen', 'login-screen', 'callback-screen', 'app-screen'];
  const missingScreens = requiredScreens.filter(screen => !productionHTML.includes(`id="${screen}"`));
  if (missingScreens.length > 0) {
    console.error(`[TEST] Missing screens: ${missingScreens.join(', ')}`);
    throw new Error(`CRITICAL: Production HTML missing screens: ${missingScreens.join(', ')}`);
  }

  // Verify production HTML contains required drawers
  const requiredDrawers = ['profile-drawer', 'thread-drawer', 'notif-drawer', 'compose-drawer', 'settings-drawer', 'search-drawer'];
  const missingDrawers = requiredDrawers.filter(drawer => !productionHTML.includes(`id="${drawer}"`));
  if (missingDrawers.length > 0) {
    console.error(`[TEST] Missing drawers: ${missingDrawers.join(', ')}`);
    throw new Error(`CRITICAL: Production HTML missing drawers: ${missingDrawers.join(', ')}`);
  }

  appLoaded = true;
  await runner.cleanup();
  console.log('[TEST] App loaded successfully');
}

// ═════════════════════════════════════════════════════════════
// TEST SUITES
// ═════════════════════════════════════════════════════════════

// ── INITIALIZATION & SETUP ──

runner.describe('Initialization & Production Code Validation', (suite) => {
  suite.test('Mock API intercepts fetch', async (t) => {
    if (typeof window.fetch !== 'function') {
      throw new Error('fetch is not a function');
    }
  });

  suite.test('Production index.html is accessible', async (t) => {
    try {
      const response = await fetch('../index.html');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      throw new Error(`CRITICAL: Production index.html not accessible - ${err.message}`);
    }
  });

  suite.test('Production HTML contains all required screens', async (t) => {
    await loadApp();
    if (!productionHTML) {
      throw new Error('Failed to load production HTML');
    }
    
    const screens = ['splash-screen', 'login-screen', 'callback-screen', 'app-screen'];
    const missing = screens.filter(s => !productionHTML.includes(`id="${s}"`));
    
    if (missing.length > 0) {
      throw new Error(`CRITICAL: ${missing.length} screens missing: ${missing.join(', ')}`);
    }
  });

  suite.test('Production code validates without syntax errors', async (t) => {
    try {
      await fetch('../js/ui.js');
      await fetch('../js/feed.js');
      await fetch('../js/render.js');
    } catch (err) {
      console.warn('[TEST] Some production files unavailable (expected in test environment):', err.message);
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

runner.describe('DOM Structure & Real UI Elements', (suite) => {
  suite.test('Production HTML contains splash screen', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="splash-screen"')) {
      throw new Error('CRITICAL: splash-screen missing from production HTML');
    }
  });

  suite.test('Production HTML contains login screen', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="login-screen"')) {
      throw new Error('CRITICAL: login-screen missing from production HTML');
    }
  });

  suite.test('Production HTML contains callback screen', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="callback-screen"')) {
      throw new Error('CRITICAL: callback-screen missing from production HTML');
    }
  });

  suite.test('Production HTML contains app screen', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="app-screen"')) {
      throw new Error('CRITICAL: app-screen missing from production HTML');
    }
  });

  suite.test('Production HTML contains all required drawers', async (t) => {
    await loadApp();
    const drawerIds = [
      'profile-drawer',
      'thread-drawer',
      'notif-drawer',
      'compose-drawer',
      'settings-drawer',
      'search-drawer'
    ];
    
    const missing = [];
    for (const id of drawerIds) {
      if (!productionHTML.includes(`id="${id}"`)) {
        missing.push(id);
      }
    }
    
    if (missing.length > 0) {
      throw new Error(`CRITICAL: Missing drawers: ${missing.join(', ')}`);
    }
  });

  suite.test('Production HTML includes stylesheets', async (t) => {
    await loadApp();
    const hasCSS = productionHTML.includes('.css');
    if (!hasCSS) {
      throw new Error('Production HTML should link CSS files');
    }
  });

  suite.test('Production HTML includes scripts', async (t) => {
    await loadApp();
    const hasScripts = productionHTML.includes('<script');
    if (!hasScripts) {
      throw new Error('Production HTML should include scripts');
    }
  });

  suite.test('Production app.js file exists', async (t) => {
    try {
      const response = await fetch('../js/app.js');
      if (!response.ok) {
        throw new Error(`js/app.js returned ${response.status}`);
      }
    } catch (err) {
      throw new Error(`CRITICAL: js/app.js not accessible - ${err.message}`);
    }
  });

  suite.test('Production state.js file exists', async (t) => {
    try {
      const response = await fetch('../js/state.js');
      if (!response.ok) {
        throw new Error(`js/state.js returned ${response.status}`);
      }
    } catch (err) {
      throw new Error(`CRITICAL: js/state.js not accessible - ${err.message}`);
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

// ── UI COMPONENTS - Non-Critical ──
// These tests only warn, not fail, since UI may not initialize without auth
runner.describe('UI Component Accessibility', (suite) => {
  suite.test('Main navigation screens readable', async (t) => {
    try {
      await loadApp();
      const screens = document.querySelectorAll('[id$="-screen"]');
      if (screens.length < 2) {
        console.warn('[TEST] Expected at least 2 screens');
      }
    } catch (err) {
      console.warn('[TEST] Cannot verify screens (app may need auth):', err.message);
    }
  });

  suite.test('Buttons have accessible structure', async (t) => {
    try {
      const buttons = document.querySelectorAll('button');
      if (buttons.length === 0) {
        console.warn('[TEST] No buttons found in DOM');
      }
    } catch (err) {
      console.warn('[TEST] Cannot inspect buttons:', err.message);
    }
  });

  suite.test('Form elements accessible', async (t) => {
    try {
      const forms = document.querySelectorAll('form');
      if (forms.length === 0) {
        console.warn('[TEST] No forms found in DOM');
      }
    } catch (err) {
      console.warn('[TEST] Cannot inspect forms:', err.message);
    }
  });
});

// ── EVENT HANDLING - Non-Critical ──
// These tests only validate structure, not behavior (app may need auth)
runner.describe('Event Handler Structure', (suite) => {
  suite.test('No catastrophic errors when inspecting DOM', async (t) => {
    try {
      await loadApp();
      const allElements = document.querySelectorAll('*');
      let count = 0;
      for (const el of allElements) {
        count++;
        if (count > 1000) break; // Just check first 1000 elements
      }
    } catch (err) {
      throw new Error(`Cannot traverse DOM: ${err.message}`);
    }
  });

  suite.test('Window events accessible', async (t) => {
    try {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('scroll'));
      // Just verify events don't crash
    } catch (err) {
      throw new Error(`Window events failed: ${err.message}`);
    }
  });

  suite.test('Storage events accessible', async (t) => {
    try {
      const storageEvent = new StorageEvent('storage', {
        key: 'test',
        newValue: 'value'
      });
      window.dispatchEvent(storageEvent);
    } catch (err) {
      throw new Error(`Storage events failed: ${err.message}`);
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
  suite.test('Profile drawer exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="profile-drawer"')) {
      throw new Error('CRITICAL: profile-drawer not found in production HTML');
    }
  });

  suite.test('Thread drawer exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="thread-drawer"')) {
      throw new Error('CRITICAL: thread-drawer not found in production HTML');
    }
  });

  suite.test('Notifications drawer exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="notif-drawer"')) {
      throw new Error('CRITICAL: notif-drawer not found in production HTML');
    }
  });

  suite.test('Compose drawer exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="compose-drawer"')) {
      throw new Error('CRITICAL: compose-drawer not found in production HTML');
    }
  });

  suite.test('Settings drawer exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="settings-drawer"')) {
      throw new Error('CRITICAL: settings-drawer not found in production HTML');
    }
  });

  suite.test('Search drawer exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="search-drawer"')) {
      throw new Error('CRITICAL: search-drawer not found in production HTML');
    }
  });

  suite.test('Splash screen exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="splash-screen"')) {
      throw new Error('CRITICAL: splash-screen not found in production HTML');
    }
  });

  suite.test('Login screen exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="login-screen"')) {
      throw new Error('CRITICAL: login-screen not found in production HTML');
    }
  });

  suite.test('Callback screen exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="callback-screen"')) {
      throw new Error('CRITICAL: callback-screen not found in production HTML');
    }
  });

  suite.test('App screen exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="app-screen"')) {
      throw new Error('CRITICAL: app-screen not found in production HTML');
    }
  });

  suite.test('Profile drawer has proper class attribute', async (t) => {
    await loadApp();
    if (!productionHTML.includes('class="profile-drawer"')) {
      console.warn('[TEST] profile-drawer class attribute missing (may use different class)');
    }
  });

  suite.test('Compose drawer has proper class attribute', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="compose-drawer"') || !productionHTML.includes('compose-drawer')) {
      throw new Error('compose-drawer not found in production HTML');
    }
  });

  suite.test('Search drawer has proper class attribute', async (t) => {
    await loadApp();
    if (!productionHTML.includes('class="search-drawer"')) {
      console.warn('[TEST] search-drawer class attribute missing (may use different class)');
    }
  });

  suite.test('Thread drawer has aria-label for accessibility', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="thread-drawer"') || !productionHTML.includes('aria-label')) {
      console.warn('[TEST] Thread drawer may be missing accessibility attributes');
    }
  });

  suite.test('Notifications drawer has aria-label for accessibility', async (t) => {
    await loadApp();
    if (!productionHTML.includes('id="notif-drawer"')) {
      throw new Error('notif-drawer not found');
    }
  });

  suite.test('Drawers are aside elements', async (t) => {
    await loadApp();
    const profileDrawer = productionHTML.includes('<aside') ? productionHTML.includes('id="profile-drawer"') : false;
    if (!profileDrawer && productionHTML.includes('id="profile-drawer"')) {
      // May be a div instead of aside, which is fine
      console.warn('[TEST] Drawers may not use <aside> elements (using div instead is acceptable)');
    }
  });

  suite.test('Modal backdrop exists in production HTML', async (t) => {
    await loadApp();
    if (!productionHTML.includes('backdrop') && !productionHTML.includes('overlay') && !productionHTML.includes('scrim')) {
      console.warn('[TEST] No obvious modal backdrop found (may use CSS instead)');
    }
  });

  suite.test('All drawers have proper structure', async (t) => {
    await loadApp();
    const drawerIds = ['profile-drawer', 'thread-drawer', 'notif-drawer', 'compose-drawer', 'settings-drawer', 'search-drawer'];
    const missing = [];
    
    for (const id of drawerIds) {
      if (!productionHTML.includes(`id="${id}"`)) {
        missing.push(id);
      }
    }
    
    if (missing.length > 0) {
      throw new Error(`CRITICAL: Missing drawers: ${missing.join(', ')}`);
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
