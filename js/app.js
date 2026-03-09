/**
 * @module app
 * Application entry point – wires all event listeners, handles
 * the OAuth flow, and bootstraps the app.
 */

import { $, state, store, REDIRECT_URI, SCOPES, urlParams } from './state.js';
import { delay, updateURLParam } from './utils.js';
import { apiGet, registerApp, exchangeCode } from './api.js';
import {
  showScreen, showToast, showLoginError, clearLoginError,
  updateTabLabel, closeAllTabDropdowns,
} from './ui.js';
import { renderPost } from './render.js';
import {
  loadFeedTab, startPolling, stopPolling,
  updateTabPill, flushPendingPosts, handleScrollDirection,
  checkInfiniteScroll, handleLoadMore, activeFeedKey,
  registerNotifPoller, getScrollContainer, getScrollTop,
  getFilteredPendingPosts, resetOverlayPillDismissed,
} from './feed.js';
import {
  loadTrendingTab, loadTrendingPosts, loadTrendingHashtags,
  loadTrendingPeople, loadTrendingNews, loadTrendingFollowing,
} from './trending.js';
import { openThreadDrawer, closeThreadDrawer } from './thread.js';
import {
  openProfileDrawer, closeProfileDrawer, openBookmarksDrawer,
  handleFollowToggle, handleNotifyToggle, handleBlockToggle, handleMuteToggle,
  handleFavoriteToggle, handleBookmarkToggle,
  loadMoreProfilePosts, toggleProfileMoreMenu, closeAllProfileMoreMenus,
} from './profile.js';
import {
  openNotifDrawer, closeNotifDrawer, pollNotifications,
  initNotifications, startSwPolling, stopSwPolling,
  requestNotifPermission, getNotifPermission, updateSwConfig,
} from './notifications.js';
import { initCompose, openComposeDrawer, closeComposeDrawer, handleReply, updateCharCount, updateSidebarCharCount } from './compose.js';
import { openSearchDrawer, closeSearchDrawer, initSearch } from './search.js';
import { openPostAnalyticsDrawer, closePostAnalyticsDrawer, appendMoreAnalyticsUsers } from './analytics.js';

// Drawer state tracking for history
function isAnyDrawerOpen() {
  return (
    $('notif-drawer') && $('notif-drawer').classList.contains('open') ||
    $('thread-drawer') && $('thread-drawer').classList.contains('open') ||
    $('profile-drawer') && $('profile-drawer').classList.contains('open') ||
    $('compose-drawer') && $('compose-drawer').classList.contains('open') ||
    $('manage-hashtag-drawer') && $('manage-hashtag-drawer').classList.contains('open') ||
    $('settings-drawer') && $('settings-drawer').classList.contains('open') ||
    $('search-drawer') && $('search-drawer').classList.contains('open') ||
    $('post-analytics-drawer') && $('post-analytics-drawer').classList.contains('open')
  );
}

function setOverlayPillVisibility() {
  const pill = document.getElementById('new-posts-pill');
  if (!pill) return;
  if (isAnyDrawerOpen()) {
    pill.style.visibility = 'hidden';
    pill.style.transition = 'none';
  } else {
    pill.style.visibility = '';
    pill.style.transition = '';
  }
}

function closeAnyDrawer() {
  if ($('notif-drawer') && $('notif-drawer').classList.contains('open')) closeNotifDrawer();
  if ($('thread-drawer') && $('thread-drawer').classList.contains('open')) closeThreadDrawer();
  if ($('profile-drawer') && $('profile-drawer').classList.contains('open')) closeProfileDrawer();
  if ($('compose-drawer') && $('compose-drawer').classList.contains('open')) closeComposeDrawer();
  if ($('search-drawer') && $('search-drawer').classList.contains('open')) closeSearchDrawer();
  if ($('post-analytics-drawer') && $('post-analytics-drawer').classList.contains('open')) closePostAnalyticsDrawer();
  if ($('manage-hashtag-drawer') && $('manage-hashtag-drawer').classList.contains('open')) {
    $('manage-hashtag-drawer').classList.remove('open');
    const bd = $('manage-hashtag-backdrop');
    if (bd) bd.classList.remove('open');
    // reload hashtag dropdown in case follows changed
    if (typeof loadFeedTab === 'function') loadFeedTab();
  }
  if ($('settings-drawer') && $('settings-drawer').classList.contains('open')) {
    $('settings-drawer').classList.remove('open');
    const bd = $('settings-backdrop');
    if (bd) bd.classList.remove('open');
  }
}

// Listen for popstate to restore drawers or tabs properly via back/forward
window.addEventListener('popstate', async e => {
  const lightboxBtn = document.querySelector('.lightbox-close');
  if (lightboxBtn) {
    lightboxBtn.click();
    return;
  }

  window._isRouting = true;
  try {
    const currentParams = new URLSearchParams(window.location.search);

    // Close all current drawers first
    closeAnyDrawer();

    // Re-open appropriately based on URL
    const threadId = currentParams.get('thread');
    if (threadId) openThreadDrawer(threadId);

    const profileId = currentParams.get('profile');
    if (profileId) openProfileDrawer(profileId, state.server);

    if (currentParams.get('bookmarks')) openBookmarksDrawer();

    if (currentParams.get('notifications')) {
      openNotifDrawer();
    }

    // Restore or clear hashtag filter state based on URL params
    const feedParam = currentParams.get('feed');
    const tagParam  = currentParams.get('tag');
    const prevFeedFilter = state.feedFilter;

    if (feedParam === 'hashtags' && tagParam) {
      // Navigating forward into a hashtag view
      state.selectedHashtagFilter = tagParam;
      state.feedFilter = 'hashtags';
      document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === 'hashtags'));
      $('hashtag-filter-bar').style.display = '';
    } else if (state.feedFilter === 'hashtags') {
      // Navigating back out of a hashtag view — reset filter
      state.feedFilter = feedParam || 'all';
      state.selectedHashtagFilter = null;
      document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === state.feedFilter));
      $('hashtag-filter-bar').style.display = 'none';
    }

    // Restore tab if it changed
    const newTab = currentParams.get('tab') || 'feed';
    if (newTab !== state.activeTab) {
      // switchToTab (called by the click) will reload the appropriate tab
      document.getElementById(`tab-btn-${newTab}`)?.click();
    } else if (newTab === 'feed' && state.feedFilter !== prevFeedFilter) {
      // Same tab but filter changed — reload the feed
      updateTabLabel('feed');
      loadFeedTab();
    }

    setTimeout(setOverlayPillVisibility, 10);
  } finally {
    window._isRouting = false;
  }
});

const loadExploreTab = loadTrendingTab;

/* ══════════════════════════════════════════════════════════════════════
   INIT APP (after successful auth or stored session)
   ══════════════════════════════════════════════════════════════════════ */

async function initApp(server, token, demo = false) {
  state.server = server;
  state.token = token;
  state.demoMode = demo;
  showScreen('app-screen');

  if (demo) {
    $('demo-notice').style.display = 'block';
    loadFeedTab();
    return;
  }

  // Load account info
  try {
    state.account = await apiGet('/api/v1/accounts/verify_credentials', token, server);
    const avatarEl = $('user-avatar');
    avatarEl.src = state.account.avatar_static || state.account.avatar;
    avatarEl.alt = state.account.display_name || state.account.username;
    applyFollowingFeedFlag();
  } catch (err) {
    console.warn('Could not load account info:', err);
  }

  // Load instance limit and check streaming support
  try {
    const v1Data = await apiGet('/api/v1/instance', token, server);
    let chars = 500;
    if (v1Data.configuration?.statuses?.max_characters) {
      chars = v1Data.configuration.statuses.max_characters;
    } else if (v1Data.max_toot_chars) {
      chars = v1Data.max_toot_chars;
    } else {
      try {
        const v2Data = await apiGet('/api/v2/instance', token, server);
        if (v2Data.configuration?.statuses?.max_characters) {
          chars = v2Data.configuration.statuses.max_characters;
        }
      } catch (err2) { }
    }
    state.maxTootChars = chars;
    updateCharCount();
    updateSidebarCharCount();
  } catch (err) {
    console.warn('Could not load instance info:', err);
  }

  // Probe the local public timeline — some servers (e.g. mastodon.social) return
  // HTTP 200 with [] when the local timeline is intentionally disabled, so we
  // require at least one post in the response before enabling the option.
  fetch(`https://${server}/api/v1/timelines/public?local=true&limit=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  }).then(async res => {
    if (!res.ok) { applyLiveFeedFlag(false); return; }
    const data = await res.json();
    applyLiveFeedFlag(Array.isArray(data) && data.length > 0);
  }).catch(() => applyLiveFeedFlag(false));

  // Update footer server info display
  document.querySelectorAll('.footer-account-name').forEach(el => {
    if (state.account) {
      el.innerHTML = `@${state.account.username}<span style="opacity:0.6;">@${server}</span>`;
      el.parentElement.style.display = 'block';
    } else {
      el.parentElement.style.display = 'none';
    }
  });

  // Initial UI state setup from URL params
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === state.activeTab);
    b.setAttribute('aria-selected', b.dataset.tab === state.activeTab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${state.activeTab}`);
  });

  if (state.feedFilter !== 'all') {
    document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(i => {
      i.classList.toggle('active', i.dataset.filter === state.feedFilter);
    });
    $('hashtag-filter-bar').style.display = (state.feedFilter === 'hashtags') ? '' : 'none';
  }

  if (state.exploreSubtab !== 'posts') {
    document.querySelectorAll('#tab-dropdown-explore .tab-dropdown-item').forEach(i => {
      i.classList.toggle('active', i.dataset.subtab === state.exploreSubtab);
    });
    document.querySelectorAll('.trending-subpanel').forEach(p => {
      p.classList.toggle('active', p.id === `trending-subpanel-${state.exploreSubtab}`);
    });
  }

  updateTabLabel('feed');
  updateTabLabel('explore');

  if (state.activeTab === 'explore') {
    loadExploreTab();
  } else {
    loadFeedTab();
  }

  startPolling();
  pollNotifications();

  // Start background Service Worker polling
  startSwPolling();

  // Restore drawer states if query params are present
  const threadId = urlParams.get('thread');
  if (threadId) {
    setTimeout(() => openThreadDrawer(threadId), 300);
  }
  const profileId = urlParams.get('profile');
  if (profileId) {
    setTimeout(() => openProfileDrawer(profileId, state.server), 300);
  }
  const bookmarks = urlParams.get('bookmarks');
  if (bookmarks) {
    setTimeout(() => openBookmarksDrawer(), 300);
  }
  const notifications = urlParams.get('notifications');
  if (notifications) {
    setTimeout(() => openNotifDrawer(), 300);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   OAUTH CALLBACK
   ══════════════════════════════════════════════════════════════════════ */

async function handleCallback(code) {
  const server = store.get('pending_server');
  const clientId = store.get('pending_client_id');
  const clientSecret = store.get('pending_client_secret');
  const isPopup = !!(window.opener && window.opener !== window);

  if (!server || !clientId || !clientSecret) {
    if (isPopup) { window.close(); return; }
    showScreen('login-screen');
    showLoginError('Auth state lost. Please try again.');
    return;
  }

  // Show spinner in popup or callback screen
  if (isPopup) {
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0d0d0f;color:#8888a0;font-family:'DM Mono',monospace;font-size:13px;gap:16px;">
        <div style="width:28px;height:28px;border:2px solid #2a2a34;border-top-color:#9b7fff;border-radius:50%;animation:spin 700ms linear infinite;"></div>
        <p>Completing sign-in…</p>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      </div>`;
  } else {
    showScreen('callback-screen');
  }

  try {
    const tokenData = await exchangeCode(server, clientId, clientSecret, code);
    store.del('pending_server');
    store.del('pending_client_id');
    store.del('pending_client_secret');
    history.replaceState(null, '', location.pathname);

    if (isPopup) {
      store.set('oauth_done_token', tokenData.access_token);
      store.set('oauth_done_server', server);
      store.set('oauth_done_scopes', SCOPES);
      window.close();
    } else {
      store.set('token', tokenData.access_token);
      store.set('server', server);
      store.set('token_scopes', SCOPES);
      await initApp(server, tokenData.access_token);
    }
  } catch (err) {
    console.error('[Elefeed] Callback error:', err);
    if (isPopup) {
      document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0d0d0f;color:#ff8080;font-family:'DM Mono',monospace;font-size:12px;gap:12px;padding:24px;text-align:center;">
          <p>Sign-in failed.</p>
          <p style="color:#55556a;">${err.message}</p>
          <p style="color:#55556a;">You can close this window and try again.</p>
        </div>`;
    } else {
      showScreen('login-screen');
      showLoginError('Sign-in failed: ' + err.message + '\n\nPlease try again.');
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   LOGIN SCREEN
   ══════════════════════════════════════════════════════════════════════ */

$('login-btn').addEventListener('click', async () => {
  const serverRaw = $('server-input').value.trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  if (!serverRaw) { showLoginError('Please enter a server domain.'); return; }

  const server = serverRaw.toLowerCase();
  $('login-btn').textContent = 'Connecting…';
  $('login-btn').disabled = true;
  clearLoginError();

  try {
    const app = await registerApp(server);
    store.set('pending_server', server);
    store.set('pending_client_id', app.client_id);
    store.set('pending_client_secret', app.client_secret);

    const authUrl = `https://${server}/oauth/authorize?` + new URLSearchParams({
      client_id: app.client_id,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
    });

    // Open OAuth in a popup so the user never leaves this page
    const W = 520, H = 680;
    const left = Math.round(window.screenX + (window.outerWidth - W) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - H) / 2);
    const popup = window.open(
      authUrl, 'elefeed_oauth',
      `width=${W},height=${H},left=${left},top=${top},toolbar=no,menubar=no,location=yes,status=no`
    );

    if (!popup || popup.closed) {
      showLoginError('Popup was blocked. Redirecting in this tab instead…');
      await delay(1200);
      location.href = authUrl;
      return;
    }

    $('login-btn').textContent = 'Waiting for sign-in…';

    // Poll for the popup writing the token to localStorage, or for it closing
    const poll = setInterval(async () => {
      const token = store.get('oauth_done_token');
      const srv = store.get('oauth_done_server');
      const scopes = store.get('oauth_done_scopes');

      if (token && srv) {
        clearInterval(poll);
        store.del('oauth_done_token');
        store.del('oauth_done_server');
        store.del('oauth_done_scopes');
        try { popup.close(); } catch { }

        store.set('token', token);
        store.set('server', srv);
        store.set('token_scopes', scopes || SCOPES);

        $('login-btn').textContent = 'Log in with Mastodon →';
        $('login-btn').disabled = false;
        await initApp(srv, token);
        return;
      }

      if (popup.closed) {
        clearInterval(poll);
        const tabToken = store.get('token');
        const tabServer = store.get('server');
        if (tabToken && tabServer) {
          await initApp(tabServer, tabToken);
        } else {
          $('login-btn').textContent = 'Log in with Mastodon →';
          $('login-btn').disabled = false;
          showLoginError('Sign-in was cancelled or the window was closed.');
        }
      }
    }, 400);
  } catch (err) {
    $('login-btn').textContent = 'Log in with Mastodon →';
    $('login-btn').disabled = false;
    showLoginError(err.message);
    console.error('[Elefeed] Login error:', err);
  }
});

/* Server Autocomplete Logic */
let popularServers = [];
let selectedSuggestionIndex = -1;
const autocompleteDropdown = $('server-autocomplete');
const serverInput = $('server-input');
const quickServers = $('quick-servers');

async function fetchPopularServers() {
  try {
    const res = await fetch('https://api.joinmastodon.org/servers');
    if (res.ok) {
      const data = await res.json();
      // Sort primarily by active users
      popularServers = data.sort((a, b) => b.total_users - a.total_users);

      // Update quick servers with top 6 dynamically
      if (quickServers) {
        quickServers.innerHTML = popularServers.slice(0, 6).map(s =>
          `<button class="quick-server-btn" data-server="${s.domain}">${s.domain}</button>`
        ).join('');

        // Re-bind quick server buttons
        document.querySelectorAll('.quick-server-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            $('server-input').value = btn.dataset.server;
            $('server-input').focus();
          });
        });
      }
    }
  } catch (err) {
    console.warn('Failed to fetch popular Mastodon servers', err);
  }
}

// Bind statically rendered quick-server-btns on load
document.querySelectorAll('.quick-server-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $('server-input').value = btn.dataset.server;
    $('server-input').focus();
  });
});

function renderAutocomplete(query = '') {
  if (!popularServers.length) return;

  selectedSuggestionIndex = -1;
  query = query.toLowerCase().trim();

  if (!query) {
    if (autocompleteDropdown) autocompleteDropdown.classList.remove('active');
    return;
  }

  let matches = popularServers.filter(s =>
    s.domain.toLowerCase().includes(query) ||
    (s.description && s.description.toLowerCase().includes(query))
  );

  // Take top 30 to keep DOM light
  matches = matches.slice(0, 30);

  if (matches.length === 0) {
    if (autocompleteDropdown) autocompleteDropdown.classList.remove('active');
    return;
  }

  if (autocompleteDropdown) {
    autocompleteDropdown.innerHTML = matches.map((s, idx) => {
      const domain = s.domain;
      const users = s.total_users ? new Intl.NumberFormat().format(s.total_users) + ' users' : '';
      const thumbUrl = s.proxied_thumbnail || 'favicon.svg';
      return `
        <div class="server-suggestion-item" data-server="${domain}" data-index="${idx}">
          <img src="${thumbUrl}" class="server-suggestion-thumb" alt="" loading="lazy" onerror="this.src='favicon.svg'" />
          <div class="server-suggestion-info">
            <div class="server-suggestion-domain">${domain}</div>
            <div class="server-suggestion-users">${users}</div>
          </div>
        </div>
      `;
    }).join('');

    autocompleteDropdown.classList.add('active');
  }
}

function updateSuggestionSelection(items) {
  items.forEach((item, idx) => {
    if (idx === selectedSuggestionIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

if (serverInput) {
  serverInput.addEventListener('focus', () => renderAutocomplete(serverInput.value));
  serverInput.addEventListener('input', () => renderAutocomplete(serverInput.value));

  serverInput.addEventListener('keydown', e => {
    const isVisible = autocompleteDropdown && autocompleteDropdown.classList.contains('active');
    const items = isVisible ? autocompleteDropdown.querySelectorAll('.server-suggestion-item') : [];

    if (isVisible && items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedSuggestionIndex = (selectedSuggestionIndex + 1) % items.length;
        updateSuggestionSelection(items);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedSuggestionIndex = (selectedSuggestionIndex - 1 + items.length) % items.length;
        updateSuggestionSelection(items);
        return;
      } else if (e.key === 'Enter') {
        if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < items.length) {
          e.preventDefault();
          const item = items[selectedSuggestionIndex];
          serverInput.value = item.dataset.server;
          autocompleteDropdown.classList.remove('active');
          selectedSuggestionIndex = -1;
          return;
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        autocompleteDropdown.classList.remove('active');
        selectedSuggestionIndex = -1;
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (autocompleteDropdown) autocompleteDropdown.classList.remove('active');
      $('login-btn').click();
    }
  });
}

document.addEventListener('click', e => {
  const item = e.target.closest('.server-suggestion-item');
  if (item && serverInput) {
    serverInput.value = item.dataset.server;
    if (autocompleteDropdown) autocompleteDropdown.classList.remove('active');
    serverInput.focus();
    return;
  }

  const inputWrap = e.target.closest('.server-input-wrap');
  if (inputWrap && serverInput) {
    serverInput.focus();
  }

  if (!e.target.closest('#server-input-container')) {
    if (autocompleteDropdown) autocompleteDropdown.classList.remove('active');
  }
});

fetchPopularServers();

/* ══════════════════════════════════════════════════════════════════════
   TAB SWITCHING & DROPDOWNS
   ══════════════════════════════════════════════════════════════════════ */

let tabSwitchTimeout = null;

function switchToTab(tab) {
  if (tab === state.activeTab) return;
  closeAllTabDropdowns();

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${tab}`);
  });

  state.activeTab = tab;
  updateURLParam('tab', tab);
  updateTabLabel('feed');
  updateTabLabel('explore');

  clearTimeout(tabSwitchTimeout);
  tabSwitchTimeout = setTimeout(() => {
    if (tab === 'feed') loadFeedTab();
    else if (tab === 'explore') loadExploreTab();
  }, 100);
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const tab = btn.dataset.tab;
    const dropdown = $(`tab-dropdown-${tab}`);
    const isActive = tab === state.activeTab;

    // Close other dropdowns
    document.querySelectorAll('.tab-dropdown').forEach(d => {
      if (d.id !== `tab-dropdown-${tab}`) d.classList.remove('show');
    });
    document.querySelectorAll('.tab-btn').forEach(b => {
      if (b !== btn) b.classList.remove('dropdown-open');
    });

    if (isActive) {
      if (dropdown) {
        dropdown.classList.toggle('show');
        btn.classList.toggle('dropdown-open');
      }
    } else {
      switchToTab(tab);
    }
  });
});

/* Feed dropdown items */
document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const filter = item.dataset.filter;
    if (filter === state.feedFilter) { closeAllTabDropdowns(); return; }

    document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(i => {
      i.classList.toggle('active', i.dataset.filter === filter);
    });

    state.feedFilter = filter;
    updateURLParam('feed', filter);

    $('hashtag-filter-bar').style.display = (filter === 'hashtags') ? '' : 'none';
    updateTabLabel('feed');
    closeAllTabDropdowns();
    loadFeedTab();
  });
});

/* Feed Filter Settings */
const feedFilterBtn = $('feed-filter-btn');
const feedFilterDropdown = $('feed-filter-dropdown');

if (feedFilterBtn && feedFilterDropdown) {
  feedFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllTabDropdowns();
    document.querySelectorAll('.boost-dropdown').forEach(m => {
      if (m !== feedFilterDropdown) m.classList.remove('show');
    });
    feedFilterDropdown.classList.toggle('show');
  });

  ['boosts', 'replies', 'quotes'].forEach(type => {
    const cb = $(`filter-show-${type}`);
    if (cb) {
      if (store.get(`pref_show_${type}`) === 'false') cb.checked = false;
      cb.addEventListener('change', () => {
        store.set(`pref_show_${type}`, cb.checked);
        loadFeedTab(false); // Reload without scrolling to top
      });
    }
  });
}

/* Explore dropdown items */
document.querySelectorAll('#tab-dropdown-explore .tab-dropdown-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const subtab = item.dataset.subtab;

    document.querySelectorAll('#tab-dropdown-explore .tab-dropdown-item').forEach(i => {
      i.classList.toggle('active', i.dataset.subtab === subtab);
    });
    document.querySelectorAll('.trending-subpanel').forEach(p => {
      p.classList.toggle('active', p.id === `trending-subpanel-${subtab}`);
    });

    state.exploreSubtab = subtab;
    updateURLParam('explore', subtab);

    updateTabLabel('explore');
    closeAllTabDropdowns();

    if (subtab === 'posts' && !state.trendingPostsLoaded) loadTrendingPosts();
    else if (subtab === 'hashtags' && !state.trendingHashtagsLoaded) loadTrendingHashtags();
    else if (subtab === 'people' && !state.trendingPeopleLoaded) loadTrendingPeople();
    else if (subtab === 'news' && !state.trendingNewsLoaded) loadTrendingNews();
    else if (subtab === 'following' && !state.trendingFollowingLoaded) loadTrendingFollowing();
  });
});

/* Close dropdown when clicking outside */
document.addEventListener('click', (e) => {
  if (!e.target.closest('.boost-dropdown')) {
    document.querySelectorAll('.boost-dropdown').forEach(m => m.classList.remove('show'));
  }
  closeAllTabDropdowns();
});

/* Resize: recompute tab labels for mobile ↔ desktop */
window.addEventListener('resize', (() => {
  let raf;
  return () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { updateTabLabel('feed'); updateTabLabel('explore'); });
  };
})());

/* ══════════════════════════════════════════════════════════════════════
   REFRESH / AVATAR / BOOKMARKS / LOGOUT
   ══════════════════════════════════════════════════════════════════════ */

const doRefresh = () => {
  const tab = state.activeTab;
  const feedKey = activeFeedKey();
  // If there are buffered new posts, act like clicking the pill
  if (tab === 'feed' && getFilteredPendingPosts(feedKey).length > 0) {
    flushPendingPosts(feedKey, true);
    return;
  }
  state.pendingPosts[feedKey] = [];
  updateTabPill(feedKey);
  if (tab === 'feed') {
    state.homeFeed = null;
    state.hashtagFeed = null;
    state.localFeed = null;
    loadFeedTab();
  } else if (tab === 'explore') {
    state.trendingPostsLoaded = false;
    state.trendingHashtagsLoaded = false;
    state.trendingPeopleLoaded = false;
    state.trendingNewsLoaded = false;
    state.trendingFollowingLoaded = false;
    loadExploreTab();
  }
  showToast('Refreshing…');
};
$('refresh-btn').addEventListener('click', doRefresh);
$('header-wordmark-btn').addEventListener('click', doRefresh);

/* Avatar menu */
$('avatar-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeAllTabDropdowns();
  document.querySelectorAll('.boost-dropdown').forEach(m => {
    if (m.id !== 'profile-dropdown') m.classList.remove('show');
  });
  $('profile-dropdown').classList.toggle('show');
});

$('profile-view-btn').addEventListener('click', () => {
  if (state.account) openProfileDrawer(state.account.id, state.server);
  $('profile-dropdown').classList.toggle('show');
});

$('bookmarks-view-btn').addEventListener('click', () => {
  openBookmarksDrawer();
  $('profile-dropdown').classList.toggle('show');
});

const manageTagsMenuBtn = $('manage-hashtags-menu-btn');
if (manageTagsMenuBtn) {
  manageTagsMenuBtn.addEventListener('click', () => {
    $('profile-dropdown').classList.remove('show');
    if (window.openManageHashtagsPanel) window.openManageHashtagsPanel();
  });
}

const settingsMenuBtn = $('settings-menu-btn');
if (settingsMenuBtn) {
  settingsMenuBtn.addEventListener('click', () => {
    $('profile-dropdown').classList.remove('show');

    // Set active button
    const currentTheme = store.get('theme') || 'system';
    document.querySelectorAll('.theme-segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === currentTheme);
    });

    // Sync notification permission status and toggles
    refreshNotifSettingsUI();

    const hashtagPillsToggle = $('settings-hashtag-pills-toggle');
    if (hashtagPillsToggle) {
      hashtagPillsToggle.checked = store.get('pref_hashtag_pills') === 'true';
    }

    const newpostStyleCurrent = store.get('pref_newpost_style') || 'badge'; // default: Refresh Notification
    document.querySelectorAll('#settings-newpost-style-group .theme-segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === newpostStyleCurrent);
    });

    const hideCardsToggle = $('settings-hide-cards-toggle');
    if (hideCardsToggle) {
      hideCardsToggle.checked = store.get('pref_hide_cards') === 'true';
    }

    const translateLangSel = $('settings-translate-lang');
    if (translateLangSel) {
      translateLangSel.value = store.get('pref_translate_lang') || 'browser';
    }

    // Close other drawers
    closeAnyDrawer();

    // Push a history entry so the back button closes the settings drawer
    history.pushState({ drawer: 'settings-drawer' }, '', '');

    // Open settings drawer
    $('settings-backdrop').classList.add('open');
    $('settings-drawer').classList.add('open');
  });
}

const settingsModalClose = $('settings-close');
if (settingsModalClose) {
  settingsModalClose.addEventListener('click', () => {
    $('settings-backdrop').classList.remove('open');
    $('settings-drawer').classList.remove('open');
  });
}

$('settings-backdrop')?.addEventListener('click', () => {
  $('settings-backdrop').classList.remove('open');
  $('settings-drawer').classList.remove('open');
});

function applyTheme(t) {
  store.set('theme', t);
  if (t === 'light' || (t === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)) {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

document.querySelectorAll('#settings-theme-group .theme-segment-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const value = e.currentTarget.dataset.value;
    document.querySelectorAll('#settings-theme-group .theme-segment-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    applyTheme(value);
  });
});

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
  const t = store.get('theme') || 'system';
  if (t === 'system') applyTheme('system');
});

/* ── Notification settings ─────────────────────────────────────────── */

/**
 * Refreshes the notification settings section in the settings panel.
 * Called every time the panel opens so permission status is always current.
 */
function refreshNotifSettingsUI() {
  const permBtn = $('settings-notif-perm-btn');
  const permStatus = $('settings-notif-perm-status');
  const bgToggle = $('settings-bg-notif-toggle');
  const intervalSel = $('settings-notif-interval');

  if (!permBtn) return;

  const perm = getNotifPermission();

  const permLabels = {
    granted: '✅ Notifications allowed',
    denied: '🚫 Blocked — enable in browser/OS settings',
    default: '⬜ Permission not yet requested',
    unsupported: '⚠️ Not supported in this browser',
  };
  if (permStatus) permStatus.textContent = permLabels[perm] || perm;
  permBtn.textContent = perm === 'granted' ? 'Permission granted' : 'Enable Notifications';
  permBtn.disabled = perm === 'granted' || perm === 'denied' || perm === 'unsupported';

  if (bgToggle) {
    const bgEnabled = store.get('pref_bg_notifications') !== 'false';
    bgToggle.checked = bgEnabled;
    bgToggle.disabled = perm !== 'granted';
  }

  if (intervalSel) {
    intervalSel.value = store.get('pref_bg_poll_interval') || '600000';
    intervalSel.disabled = getNotifPermission() !== 'granted';
  }

  const alertTypes = ['mention', 'follow', 'reblog', 'favourite', 'follow_request', 'poll', 'status', 'update'];
  const alertGranted = getNotifPermission() === 'granted';
  for (const type of alertTypes) {
    const elId = type === 'follow_request' ? 'settings-alert-follow-request' : `settings-alert-${type}`;
    const el = $(elId);
    if (!el) continue;
    el.checked = store.get('pref_alert_' + type) !== 'false';
    el.disabled = !alertGranted;
  }

  // Show debug panel and feature flags section only for the developer account
  const debugSection = $('settings-debug-section');
  const featureFlagsSection = $('settings-feature-flags-section');
  const acct = state.account?.acct || '';
  const server = state.server || '';
  const isDev = acct === 'stonedonkey' && server === 'mastodon.social';
  if (debugSection) debugSection.style.display = isDev ? '' : 'none';
  if (featureFlagsSection) featureFlagsSection.style.display = isDev ? '' : 'none';

  // Sync the feature flag toggle state
  const followingToggle = $('debug-following-feed-toggle');
  if (followingToggle) {
    followingToggle.checked = store.get('pref_following_feed') === 'true';
  }
}

// Show or hide the Live Feeds dropdown item based on streaming availability
function applyLiveFeedFlag(supported) {
  const btn = document.querySelector('#tab-dropdown-feed .tab-dropdown-item[data-filter="live"]');
  if (!btn) return;
  btn.style.display = supported ? '' : 'none';
  // If the user was on the live feed but streaming is gone, fall back to all
  if (!supported && state.feedFilter === 'live') {
    state.feedFilter = 'all';
    document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
    });
    updateTabLabel('feed');
  }
}

// Apply the "From Following" feature flag to the tab button visibility
function applyFollowingFeedFlag() {
  const btn = document.querySelector('#tab-dropdown-explore .tab-dropdown-item[data-subtab="following"]');
  if (!btn) return;
  const acct = state.account?.acct || '';
  const srv = state.server || '';
  const isDev = acct === 'stonedonkey' && srv === 'mastodon.social';
  const enabled = isDev && store.get('pref_following_feed') === 'true';
  btn.style.display = enabled ? '' : 'none';
}
applyFollowingFeedFlag();

// Wire the debug toggle
const _followingFeedToggle = $('debug-following-feed-toggle');
if (_followingFeedToggle) {
  _followingFeedToggle.addEventListener('change', () => {
    store.set('pref_following_feed', _followingFeedToggle.checked ? 'true' : 'false');
    applyFollowingFeedFlag();
    showToast(_followingFeedToggle.checked ? '"From Following" tab enabled' : '"From Following" tab hidden');
  });
}

// Wire notification settings controls (elements exist in DOM at load time)
const _permBtn = $('settings-notif-perm-btn');
const _bgToggle = $('settings-bg-notif-toggle');
const _intervalSel = $('settings-notif-interval');

if (_permBtn) {
  _permBtn.addEventListener('click', async () => {
    _permBtn.disabled = true;
    _permBtn.textContent = 'Requesting…';
    const result = await requestNotifPermission();
    refreshNotifSettingsUI();
    if (result === 'granted') {
      showToast('Notifications enabled!');
      startSwPolling();
    } else if (result === 'denied') {
      showToast('Permission denied — check your browser/OS settings.');
    }
  });
}

if (_bgToggle) {
  _bgToggle.addEventListener('change', () => {
    store.set('pref_bg_notifications', _bgToggle.checked ? 'true' : 'false');
    updateSwConfig();
    showToast(_bgToggle.checked ? 'Background notifications on' : 'Background notifications off');
  });
}

if (_intervalSel) {
  _intervalSel.addEventListener('change', () => {
    store.set('pref_bg_poll_interval', _intervalSel.value);
    updateSwConfig();
    showToast('Poll interval updated');
  });
}

// Alert type toggles — changing them forces a push subscription update
const _alertTypes = ['mention', 'follow', 'reblog', 'favourite', 'follow_request', 'poll', 'status', 'update'];
for (const type of _alertTypes) {
  const elId = type === 'follow_request' ? 'settings-alert-follow-request' : `settings-alert-${type}`;
  const el = $(elId);
  if (!el) continue;
  el.addEventListener('change', () => {
    store.set('pref_alert_' + type, el.checked ? 'true' : 'false');
    // Force push re-registration so Mastodon receives the updated alert list
    store.del('push_endpoint_' + state.server);
    updateSwConfig();
  });
}

/* ── Developer Debug Panel ──────────────────────────────────────────── */

async function debugUpdateStatus(msg) {
  const el = $('debug-sub-status');
  if (el) el.innerHTML = msg;
}

const _debugCheckBtn = $('debug-check-sub-btn');
const _debugRegisterBtn = $('debug-register-push-btn');
const _debugForceBtn = $('debug-force-register-btn');
const _debugTestBtn = $('debug-test-notif-btn');
const _debugUnsubBtn = $('debug-unsub-btn');

if (_debugCheckBtn) {
  _debugCheckBtn.addEventListener('click', async () => {
    debugUpdateStatus('Checking…');
    try {
      const hasSW = 'serviceWorker' in navigator;
      const hasPush = 'PushManager' in window;
      const perm = Notification?.permission ?? 'unknown';
      const storedEndpoint = store.get('push_endpoint_' + state.server) || '(none)';

      let subInfo = 'No active subscription';
      if (hasSW && hasPush) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          subInfo = `<b>Endpoint:</b> ${sub.endpoint.slice(0, 60)}…`;
        }
      }

      debugUpdateStatus(
        `<b>SW:</b> ${hasSW} &nbsp; <b>PushManager:</b> ${hasPush}<br>` +
        `<b>Permission:</b> ${perm}<br>` +
        `<b>SW state:</b> ${(await navigator.serviceWorker.ready).active?.state ?? 'none'}<br>` +
        `<b>Subscription:</b> ${subInfo}<br>` +
        `<b>Cached endpoint:</b> ${storedEndpoint.slice(0, 60)}${storedEndpoint.length > 60 ? '…' : ''}`
      );
      console.log('[Debug] SW ready:', await navigator.serviceWorker.ready);
    } catch (err) {
      debugUpdateStatus('Error: ' + err.message);
      console.error('[Debug] Check failed:', err);
    }
  });
}

if (_debugRegisterBtn) {
  _debugRegisterBtn.addEventListener('click', async () => {
    debugUpdateStatus('Running startSwPolling()…');
    console.log('[Debug] Manually triggering startSwPolling…');
    try {
      await startSwPolling();
      debugUpdateStatus('startSwPolling() complete — check console for [Elefeed] logs.');
    } catch (err) {
      debugUpdateStatus('Error: ' + err.message);
      console.error('[Debug] startSwPolling failed:', err);
    }
  });
}

if (_debugForceBtn) {
  _debugForceBtn.addEventListener('click', async () => {
    debugUpdateStatus('Clearing cached endpoint…');
    console.log('[Debug] Force re-register: clearing cached endpoint and re-subscribing…');
    store.del('push_endpoint_' + state.server);
    // Also unsubscribe from the browser so a fresh subscription is created
    try {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          console.log('[Debug] Browser push subscription cleared.');
        }
      }
      await startSwPolling();
      debugUpdateStatus('Force re-register complete — check console for [Elefeed] logs.');
    } catch (err) {
      debugUpdateStatus('Error: ' + err.message);
      console.error('[Debug] Force re-register failed:', err);
    }
  });
}

if (_debugTestBtn) {
  _debugTestBtn.addEventListener('click', async () => {
    debugUpdateStatus('Firing test notification via SW…');
    console.log('[Debug] Firing local test notification…');
    try {
      if (Notification.permission !== 'granted') {
        debugUpdateStatus('⚠️ No permission — grant notification permission first.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Elefeed — Test Notification 🔔', {
        body: 'If you see this, your SW and OS notifications are working correctly.',
        icon: '/icon512x512.png',
        badge: '/icon512x512.png',
        tag: 'elefeed-debug-test',
        data: { url: '/?notifications=true' }
      });
      debugUpdateStatus('✅ Test notification fired — did it appear as an OS alert?');
      console.log('[Debug] Test notification fired.');
    } catch (err) {
      debugUpdateStatus('Error: ' + err.message);
      console.error('[Debug] Test notification failed:', err);
    }
  });
}

if (_debugUnsubBtn) {
  _debugUnsubBtn.addEventListener('click', async () => {
    debugUpdateStatus('Unsubscribing…');
    console.log('[Debug] Manually triggering stopSwPolling…');
    try {
      await stopSwPolling();
      debugUpdateStatus('Unsubscribed. Click "Force Re-register" to start fresh.');
    } catch (err) {
      debugUpdateStatus('Error: ' + err.message);
      console.error('[Debug] Unsubscribe failed:', err);
    }
  });
}

// New post indicator style
document.querySelectorAll('#settings-newpost-style-group .theme-segment-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const value = btn.dataset.value;
    store.set('pref_newpost_style', value);
    document.querySelectorAll('#settings-newpost-style-group .theme-segment-btn').forEach(b => b.classList.toggle('active', b === btn));
    // Re-apply to current feed; reset dismissed flag so pill can show immediately
    if (value === 'pill') {
      resetOverlayPillDismissed();
    }
    updateTabPill(activeFeedKey());
  });
});

// Hashtag pills
if (store.get('pref_hashtag_pills') === 'true') {
  document.body.classList.add('hashtag-pills-enabled');
}
const _hashtagPillsToggle = $('settings-hashtag-pills-toggle');
if (_hashtagPillsToggle) {
  _hashtagPillsToggle.addEventListener('change', () => {
    store.set('pref_hashtag_pills', _hashtagPillsToggle.checked ? 'true' : 'false');
    if (_hashtagPillsToggle.checked) {
      document.body.classList.add('hashtag-pills-enabled');
    } else {
      document.body.classList.remove('hashtag-pills-enabled');
    }
  });
}

// Hide Cards
if (store.get('pref_hide_cards') === 'true') {
  document.body.classList.add('hide-cards-enabled');
}
const _hideCardsToggle = $('settings-hide-cards-toggle');
if (_hideCardsToggle) {
  _hideCardsToggle.addEventListener('change', () => {
    store.set('pref_hide_cards', _hideCardsToggle.checked ? 'true' : 'false');
    if (_hideCardsToggle.checked) {
      document.body.classList.add('hide-cards-enabled');
    } else {
      document.body.classList.remove('hide-cards-enabled');
    }
  });
}

// Translation language wrapper
const _translateLangSel = $('settings-translate-lang');
if (_translateLangSel) {
  _translateLangSel.addEventListener('change', () => {
    store.set('pref_translate_lang', _translateLangSel.value);
  });
}

/* Logout */
$('logout-btn').addEventListener('click', () => {
  store.del('token');
  store.del('server');
  store.del('token_scopes');
  state.server = null;
  state.token = null;
  state.account = null;
  state.homeFeed = null;
  state.followingFeed = null;
  state.hashtagFeed = null;
  state.localFeed = null;
  state.followedHashtags = null;
  state.activeTab = 'feed';
  state.feedFilter = 'all';
  state.pendingPosts = {};
  state.trendingPostsLoaded = false;
  state.trendingHashtagsLoaded = false;
  state.trendingPeopleLoaded = false;
  state.trendingNewsLoaded = false;
  $('demo-notice').style.display = 'none';
  $('feed-posts').innerHTML = '';
  $('trending-posts-list').innerHTML = '';
  $('trending-hashtags-list').innerHTML = '';
  $('trending-people-list').innerHTML = '';
  $('trending-news-list').innerHTML = '';

  // Reset feed filter dropdown
  document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach((b, i) => b.classList.toggle('active', i === 0));
  $('hashtag-filter-bar').style.display = 'none';

  // Reset explore dropdown
  document.querySelectorAll('#tab-dropdown-explore .tab-dropdown-item').forEach((b, i) => b.classList.toggle('active', i === 0));

  // Reset tabs
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  document.querySelectorAll('.tab-panel').forEach((p, i) => p.classList.toggle('active', i === 0));
  updateTabLabel('feed');
  updateTabLabel('explore');

  showScreen('login-screen');
  showToast('Signed out.');
  stopPolling();
  stopSwPolling();
});

/* ══════════════════════════════════════════════════════════════════════
   SCROLL / WHEEL / TOUCH
   ══════════════════════════════════════════════════════════════════════ */

let scrollTimeout = null;
function attachScrollListener() {
  const sc = getScrollContainer();
  const target = sc || window;
  target.addEventListener('scroll', () => {
    if (!scrollTimeout) {
      scrollTimeout = requestAnimationFrame(() => {
        checkInfiniteScroll();
        handleScrollDirection();
        scrollTimeout = null;
      });
    }
  }, { passive: true });
}
attachScrollListener();
window.addEventListener('resize', () => {
  scrollTimeout = null;
  attachScrollListener();
});

window.addEventListener('wheel', (e) => {
  if (state.activeTab !== 'feed') return;
  const currentY = getScrollTop();
  if (currentY < 5 && e.deltaY < 0) {
    const feedKey = activeFeedKey();
    const pending = state.pendingPosts[feedKey] || [];
    if (pending.length > 0) flushPendingPosts(feedKey, false);
  }
}, { passive: true });

let touchStartY = 0;
window.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (state.activeTab !== 'feed') return;
  const currentY = getScrollTop();
  if (currentY < 5) {
    const touchDelta = e.touches[0].clientY - touchStartY;
    if (touchDelta > 30) {
      const feedKey = activeFeedKey();
      const pending = state.pendingPosts[feedKey] || [];
      if (pending.length > 0) {
        flushPendingPosts(feedKey, false);
        touchStartY = e.touches[0].clientY;
      }
    }
  }
}, { passive: true });

/* ══════════════════════════════════════════════════════════════════════
   CLOSE HANDLERS (profile / thread / compose drawers)
   ══════════════════════════════════════════════════════════════════════ */


function wrapDrawerClose(fn) {
  return function (...args) {
    fn.apply(this, args);
    setTimeout(setOverlayPillVisibility, 10);
  };
}

$('profile-close').addEventListener('click', wrapDrawerClose(closeProfileDrawer));
$('profile-backdrop').addEventListener('click', wrapDrawerClose(closeProfileDrawer));
$('profile-back-analytics')?.addEventListener('click', wrapDrawerClose(closeProfileDrawer));

$('thread-close-btn').addEventListener('click', wrapDrawerClose(closeThreadDrawer));
$('thread-backdrop').addEventListener('click', wrapDrawerClose(closeThreadDrawer));
$('thread-back-btn').addEventListener('click', wrapDrawerClose(closeThreadDrawer));

$('post-analytics-close')?.addEventListener('click', wrapDrawerClose(closePostAnalyticsDrawer));
$('post-analytics-backdrop')?.addEventListener('click', wrapDrawerClose(closePostAnalyticsDrawer));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.body.classList.contains('thread-inline-active') || $('thread-drawer').classList.contains('open')) {
      closeThreadDrawer();
    } else {
      closeProfileDrawer();
      closeComposeDrawer();
    }
    setTimeout(setOverlayPillVisibility, 10);
  }
});
// Hide pill when any drawer opens (immediate, no delay)
['notif-drawer', 'thread-drawer', 'profile-drawer', 'compose-drawer', 'search-drawer', 'post-analytics-drawer'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('transitionstart', setOverlayPillVisibility);
    el.addEventListener('transitionend', setOverlayPillVisibility);
  }
});
setTimeout(setOverlayPillVisibility, 100);

/* Close profile more menu when clicking outside */
document.addEventListener('click', e => {
  const menu = e.target.closest('.profile-more-menu, .profile-more-menu-btn');
  if (!menu) closeAllProfileMoreMenus();
});

/* ══════════════════════════════════════════════════════════════════════
   DELEGATION (clicks on dynamic content)
   ══════════════════════════════════════════════════════════════════════ */

document.addEventListener('click', e => {
  /* Profile avatar / name → open profile drawer */
  const trigger = e.target.closest('[data-profile-id]');
  if (trigger) {
    e.preventDefault();
    closeComposeDrawer();
    const profileDrawer = $('profile-drawer');
    if ($('post-analytics-drawer')?.classList.contains('open')) {
      profileDrawer.dataset.fromAnalytics = 'true';
    } else {
      delete profileDrawer.dataset.fromAnalytics;
    }
    openProfileDrawer(trigger.dataset.profileId, trigger.dataset.profileServer);
    return;
  }

  /* Follow / unfollow */
  const followBtn = e.target.closest('.profile-follow-btn[data-account-id]');
  if (followBtn) { e.preventDefault(); closeAllProfileMoreMenus(); handleFollowToggle(followBtn); return; }

  /* Notify toggle */
  const notifyBtn = e.target.closest('.profile-notify-btn');
  if (notifyBtn) { e.preventDefault(); closeAllProfileMoreMenus(); handleNotifyToggle(notifyBtn); return; }

  /* Profile more menu button */
  const profileMoreBtn = e.target.closest('.profile-more-menu-btn');
  if (profileMoreBtn) { e.preventDefault(); e.stopPropagation(); toggleProfileMoreMenu(profileMoreBtn); return; }

  /* Block toggle */
  const blockBtn = e.target.closest('.profile-block-btn');
  if (blockBtn) { e.preventDefault(); handleBlockToggle(blockBtn); closeAllProfileMoreMenus(); return; }

  /* Mute toggle */
  const muteBtn = e.target.closest('.profile-mute-btn');
  if (muteBtn) { e.preventDefault(); handleMuteToggle(muteBtn); closeAllProfileMoreMenus(); return; }

  /* Favorite */
  const favBtn = e.target.closest('.post-fav-btn');
  if (favBtn) { e.preventDefault(); handleFavoriteToggle(favBtn); return; }

  /* Bookmark */
  const bookmarkBtn = e.target.closest('.post-bookmark-btn');
  if (bookmarkBtn) { e.preventDefault(); handleBookmarkToggle(bookmarkBtn); return; }

  /* Analytics icon button → toggle the insights menu */
  const analyticsBtn = e.target.closest('.post-analytics-btn');
  if (analyticsBtn) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.boost-dropdown').forEach(m => m.classList.remove('show'));
    const menu = analyticsBtn.parentElement.querySelector('.post-analytics-menu');
    if (menu) menu.classList.toggle('show');
    return;
  }

  /* Analytics menu item → open the analytics drawer */
  const analyticsItem = e.target.closest('.post-analytics-item');
  if (analyticsItem) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.boost-dropdown').forEach(m => m.classList.remove('show'));
    openPostAnalyticsDrawer(analyticsItem.dataset.postId, analyticsItem.dataset.action);
    return;
  }

  /* Boost button (opens dropdown) */
  const boostBtn = e.target.closest('.post-boost-btn');
  if (boostBtn) {
    e.preventDefault();
    e.stopPropagation();
    window.toggleBoostMenu(boostBtn.dataset.postId, boostBtn);
    return;
  }

  /* Post menu button (opens dropdown) */
  const postMenuBtn = e.target.closest('.post-menu-btn');
  if (postMenuBtn) {
    e.preventDefault();
    e.stopPropagation();
    window.togglePostMenu(postMenuBtn.dataset.postId, postMenuBtn);
    return;
  }

  /* Reply */
  const replyBtn = e.target.closest('.post-reply-btn');
  if (replyBtn) { e.preventDefault(); handleReply(replyBtn.dataset.postId, replyBtn.dataset.accountAcct); return; }

  /* Dropdown item (Boost / Quote / Edit) */
  const boostItem = e.target.closest('.boost-dropdown-item');
  if (boostItem) {
    e.preventDefault();
    e.stopPropagation();
    if (boostItem.dataset.action === 'boost') {
      window.handleBoostSubmit(boostItem.dataset.postId, boostItem.dataset.isBoosted === 'true');
    } else if (boostItem.dataset.action === 'quote') {
      window.handleQuoteInit(boostItem.dataset.postId, boostItem.dataset.acct);
    } else if (boostItem.dataset.action === 'edit') {
      window.handleEditInit(boostItem.dataset.postId);
    } else if (boostItem.dataset.action === 'delete') {
      window.handleDeleteInit(boostItem.dataset.postId);
    } else if (boostItem.dataset.action === 'delete-redraft') {
      window.handleDeleteRedraftInit(boostItem.dataset.postId);
    }
    return;
  }

  /* Context Jump */
  const contextJump = e.target.closest('.context-jump-btn');
  if (contextJump) {
    e.preventDefault();
    e.stopPropagation();
    openThreadDrawer(contextJump.dataset.statusId);
    return;
  }

  /* Load More */
  const loadMoreBtn = e.target.closest('.load-more-btn');
  if (loadMoreBtn) {
    e.preventDefault();
    if (loadMoreBtn.classList.contains('analytics-load-more-btn')) {
      appendMoreAnalyticsUsers(loadMoreBtn);
    } else if (loadMoreBtn.dataset.feed === 'profile') {
      loadMoreProfilePosts(loadMoreBtn);
    } else {
      handleLoadMore(loadMoreBtn);
    }
    return;
  }

  /* Hashtag clicks */
  const hashtagLink = e.target.closest('a.hashtag');
  if (hashtagLink) {
    e.preventDefault();
    const tagSourceEl = hashtagLink.querySelector('.trending-tag');
    const rawText = tagSourceEl ? tagSourceEl.textContent : hashtagLink.textContent;
    const tag = rawText.replace(/^#/, '').split(/\s+/)[0].toLowerCase();

    // Push a history entry encoding the hashtag destination so the previous
    // location is preserved as a true back entry the popstate handler can restore.
    const _hashNext = new URL(window.location);
    _hashNext.searchParams.set('tab', 'feed');
    _hashNext.searchParams.set('feed', 'hashtags');
    _hashNext.searchParams.set('tag', tag);
    _hashNext.searchParams.delete('thread');
    _hashNext.searchParams.delete('profile');
    _hashNext.searchParams.delete('bookmarks');
    _hashNext.searchParams.delete('notifications');
    history.pushState({}, '', _hashNext);

    state.selectedHashtagFilter = tag;
    state.feedFilter = 'hashtags';

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'feed'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-feed'));
    document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(b => b.classList.toggle('active', b.dataset.filter === 'hashtags'));
    $('hashtag-filter-bar').style.display = '';
    state.activeTab = 'feed';
    updateTabLabel('feed');

    closeProfileDrawer();
    closeThreadDrawer();
    closeComposeDrawer();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadFeedTab();
    return;
  }

  /* Trending hashtag row */
  const trendingTagLink = e.target.closest('[data-trending-tag]');
  if (trendingTagLink) {
    e.preventDefault();
    const tag = trendingTagLink.dataset.trendingTag.toLowerCase();

    // Push a history entry encoding the hashtag destination (same pattern as a.hashtag)
    const _trendNext = new URL(window.location);
    _trendNext.searchParams.set('tab', 'feed');
    _trendNext.searchParams.set('feed', 'hashtags');
    _trendNext.searchParams.set('tag', tag);
    _trendNext.searchParams.delete('thread');
    _trendNext.searchParams.delete('profile');
    _trendNext.searchParams.delete('bookmarks');
    _trendNext.searchParams.delete('notifications');
    history.pushState({}, '', _trendNext);

    state.selectedHashtagFilter = tag;
    state.feedFilter = 'hashtags';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'feed'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-feed'));
    document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(b => b.classList.toggle('active', b.dataset.filter === 'hashtags'));
    $('hashtag-filter-bar').style.display = '';
    state.activeTab = 'feed';
    updateTabLabel('feed');

    closeProfileDrawer();
    closeThreadDrawer();
    closeComposeDrawer();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadFeedTab();
    return; // ← added so we don't fall through to the article handler
  }

  /* Post article click → open thread */
  const INTERACTIVE = 'a, button, input, select, textarea, [data-profile-id], .post-footer, .cw-wrapper, .post-quote, .media-item, .boost-dropdown, video, .sensitive-overlay';
  const postArticle = e.target.closest('article.post');
  if (postArticle && !e.target.closest(INTERACTIVE) && !e.target.closest('.thread-drawer, .thread-inline-panel')) {
    e.preventDefault();
    const statusId = postArticle.dataset.id;
    if (statusId) {
      closeProfileDrawer();
      closeComposeDrawer();
      openThreadDrawer(statusId);
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════
   NETWORK STATUS
   ══════════════════════════════════════════════════════════════════════ */

window.addEventListener('offline', () => $('offline-bar').classList.add('visible'));
window.addEventListener('online', () => $('offline-bar').classList.remove('visible'));

/* ══════════════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════════════ */

async function fetchAppVersion() {
  try {
    const res = await fetch('https://api.github.com/repos/hansenwebco/elefeed/releases/latest');
    if (!res.ok) return;
    const data = await res.json();
    if (data.tag_name) {
      document.querySelectorAll('.sidebar-footer-brand').forEach(el => {
        el.textContent = `Elefeed ${data.tag_name}`;
      });
    }
  } catch (err) {
    console.debug('Failed to fetch app version:', err);
  }
}

async function boot() {
  // Fetch latest version from GitHub automatically
  fetchAppVersion();

  // Wire up component init functions
  registerNotifPoller(pollNotifications);
  initCompose();
  initNotifications();
  initSearch();

  // Search button
  const searchBtn = $('search-btn');
  if (searchBtn) searchBtn.addEventListener('click', () => openSearchDrawer());

  // Expose helpers so search.js can trigger navigation without circular imports
  window.__searchHashtagClick = (tag) => {
    // Push a history entry so the user can return from the hashtag view
    const _searchNext = new URL(window.location);
    _searchNext.searchParams.set('tab', 'feed');
    _searchNext.searchParams.set('feed', 'hashtags');
    _searchNext.searchParams.set('tag', tag);
    _searchNext.searchParams.delete('thread');
    _searchNext.searchParams.delete('profile');
    _searchNext.searchParams.delete('bookmarks');
    _searchNext.searchParams.delete('notifications');
    history.pushState({}, '', _searchNext);

    state.selectedHashtagFilter = tag;
    state.feedFilter = 'hashtags';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'feed'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-feed'));
    document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(b => b.classList.toggle('active', b.dataset.filter === 'hashtags'));
    $('hashtag-filter-bar').style.display = '';
    state.activeTab = 'feed';
    updateTabLabel('feed');
    closeProfileDrawer();
    closeThreadDrawer();
    closeComposeDrawer();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadFeedTab();
  };

  window.__searchOpenThread = (statusId) => {
    closeProfileDrawer();
    closeComposeDrawer();
    openThreadDrawer(statusId);
  };

  // If we're a popup completing OAuth, run callback and close
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code) { await handleCallback(code); return; }

  // Detect file:// — OAuth popups need a real HTTP origin
  if (location.protocol === 'file:') {
    showScreen('login-screen');
    showLoginError(
      '⚠ Opened as a local file (file://).\n\n' +
      'OAuth requires a real HTTP origin. Serve it locally:\n\n' +
      '  python3 -m http.server 8080\n\n' +
      'Then open: http://localhost:8080/elefeed.html'
    );
    return;
  }

  // Check for stored session
  const token = store.get('token');
  const server = store.get('server');
  const tokenScopes = store.get('token_scopes');

  if (token && server) {
    if (tokenScopes === SCOPES) {
      await initApp(server, token);
      return;
    }
    store.del('token');
    store.del('server');
    store.del('token_scopes');
  }

  showScreen('login-screen');
}

boot().catch(err => {
  console.error('Boot error:', err);
  showScreen('login-screen');
});
