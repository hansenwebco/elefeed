/**
 * @module app
 * Application entry point – wires all event listeners, handles
 * the OAuth flow, and bootstraps the app.
 */

import { $, state, store, REDIRECT_URI, SCOPES } from './state.js';
import { delay } from './utils.js';
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
  registerNotifPoller,
} from './feed.js';
import {
  loadTrendingTab, loadTrendingHashtags,
  loadTrendingPeople, loadTrendingNews,
} from './trending.js';
import { openThreadDrawer, closeThreadDrawer } from './thread.js';
import {
  openProfileDrawer, closeProfileDrawer, openBookmarksDrawer,
  handleFollowToggle, handleNotifyToggle,
  handleFavoriteToggle, handleBookmarkToggle,
} from './profile.js';
import {
  openNotifDrawer, closeNotifDrawer, pollNotifications,
  initNotifications,
} from './notifications.js';
import { initCompose, openComposeDrawer, closeComposeDrawer, handleReply } from './compose.js';

// Drawer state tracking for history
function isAnyDrawerOpen() {
  return (
    $('notif-drawer') && $('notif-drawer').classList.contains('open') ||
    $('thread-drawer') && $('thread-drawer').classList.contains('open') ||
    $('profile-drawer') && $('profile-drawer').classList.contains('open') ||
    $('compose-drawer') && $('compose-drawer').classList.contains('open')
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
}

// Listen for popstate to close drawers
window.addEventListener('popstate', e => {
  const lightboxBtn = document.querySelector('.lightbox-close');
  if (lightboxBtn) {
    lightboxBtn.click();
    return;
  }

  if (isAnyDrawerOpen()) {
    closeAnyDrawer();
    setTimeout(setOverlayPillVisibility, 10);
    // Optionally, push state again to prevent further navigation
    // history.pushState(null, '', '');
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
  } catch (err) {
    console.warn('Could not load account info:', err);
  }

  loadFeedTab();
  startPolling();
  pollNotifications();
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
    $('hashtag-filter-bar').style.display = (filter === 'hashtags') ? '' : 'none';
    updateTabLabel('feed');
    closeAllTabDropdowns();
    loadFeedTab();
  });
});

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

    updateTabLabel('explore');
    closeAllTabDropdowns();

    if (subtab === 'hashtags' && !state.trendingHashtagsLoaded) loadTrendingHashtags();
    else if (subtab === 'people' && !state.trendingPeopleLoaded) loadTrendingPeople();
    else if (subtab === 'news' && !state.trendingNewsLoaded) loadTrendingNews();
  });
});

/* Close dropdown when clicking outside */
document.addEventListener('click', () => closeAllTabDropdowns());

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
  state.pendingPosts[feedKey] = [];
  updateTabPill(feedKey);
  if (tab === 'feed') {
    state.homeFeed = null;
    state.hashtagFeed = null;
    loadFeedTab();
  } else if (tab === 'explore') {
    state.trendingPostsLoaded = false;
    state.trendingHashtagsLoaded = false;
    state.trendingPeopleLoaded = false;
    state.trendingNewsLoaded = false;
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
    $('profile-dropdown').classList.toggle('show');
    const manageBtn = $('manage-hashtags-btn');
    if (manageBtn) manageBtn.click();
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
});

/* ══════════════════════════════════════════════════════════════════════
   SCROLL / WHEEL / TOUCH
   ══════════════════════════════════════════════════════════════════════ */

let scrollTimeout = null;
window.addEventListener('scroll', () => {
  if (!scrollTimeout) {
    scrollTimeout = requestAnimationFrame(() => {
      checkInfiniteScroll();
      handleScrollDirection();
      scrollTimeout = null;
    });
  }
}, { passive: true });

window.addEventListener('wheel', (e) => {
  if (state.activeTab !== 'feed') return;
  const currentY = window.scrollY || document.documentElement.scrollTop;
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
  const currentY = window.scrollY || document.documentElement.scrollTop;
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

$('thread-close-btn').addEventListener('click', wrapDrawerClose(closeThreadDrawer));
$('thread-backdrop').addEventListener('click', wrapDrawerClose(closeThreadDrawer));
$('thread-back-btn').addEventListener('click', wrapDrawerClose(closeThreadDrawer));

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
['notif-drawer', 'thread-drawer', 'profile-drawer', 'compose-drawer'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('transitionstart', setOverlayPillVisibility);
    el.addEventListener('transitionend', setOverlayPillVisibility);
  }
});
setTimeout(setOverlayPillVisibility, 100);

/* ══════════════════════════════════════════════════════════════════════
   DELEGATION (clicks on dynamic content)
   ══════════════════════════════════════════════════════════════════════ */

document.addEventListener('click', e => {
  /* Profile avatar / name → open profile drawer */
  const trigger = e.target.closest('[data-profile-id]');
  if (trigger) {
    e.preventDefault();
    closeThreadDrawer();
    closeComposeDrawer();
    openProfileDrawer(trigger.dataset.profileId, trigger.dataset.profileServer);
    return;
  }

  /* Follow / unfollow */
  const followBtn = e.target.closest('.profile-follow-btn:not(#hashtag-follow-btn)');
  if (followBtn) { e.preventDefault(); handleFollowToggle(followBtn); return; }

  /* Notify toggle */
  const notifyBtn = e.target.closest('.profile-notify-btn');
  if (notifyBtn) { e.preventDefault(); handleNotifyToggle(notifyBtn); return; }

  /* Favorite */
  const favBtn = e.target.closest('.post-fav-btn');
  if (favBtn) { e.preventDefault(); handleFavoriteToggle(favBtn); return; }

  /* Bookmark */
  const bookmarkBtn = e.target.closest('.post-bookmark-btn');
  if (bookmarkBtn) { e.preventDefault(); handleBookmarkToggle(bookmarkBtn); return; }

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
    }
    return;
  }

  /* Load More */
  const loadMoreBtn = e.target.closest('.load-more-btn');
  if (loadMoreBtn) { e.preventDefault(); handleLoadMore(loadMoreBtn); return; }

  /* Hashtag clicks */
  const hashtagLink = e.target.closest('a.hashtag');
  if (hashtagLink) {
    e.preventDefault();
    const tagSourceEl = hashtagLink.querySelector('.trending-tag');
    const rawText = tagSourceEl ? tagSourceEl.textContent : hashtagLink.textContent;
    const tag = rawText.replace(/^#/, '').split(/\s+/)[0].toLowerCase();

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
  if (postArticle && !e.target.closest(INTERACTIVE) && !e.target.closest('.thread-drawer')) {
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
