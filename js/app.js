/**
 * @module app
 * Application entry point – wires all event listeners, handles
 * the OAuth flow, and bootstraps the app.
 */

import {
  $, state, store, REDIRECT_URI, SCOPES, urlParams,
  getStoredAccounts, saveStoredAccounts, getActiveAccountId, setActiveAccountId,
  getSyncAccountId, setSyncAccountId
} from './state.js';
import { delay, updateURLParam, escapeHTML, renderCustomEmojis, formatNum, getLanguageLabel } from './utils.js';
import { apiGet, getApiUrl, registerApp, exchangeCode } from './api.js';
import {
  showScreen, showToast, showLoginError, clearLoginError,
  updateTabLabel, closeAllTabDropdowns, initVersion, openAboutModal, openPrivacyModal,
  showConfirm, showSwitchingOverlay, hideSwitchingOverlay
} from './ui.js';
import { renderPost } from './render.js';
import {
  loadFeedTab, startPolling, stopPolling,
  updateTabPill, flushPendingPosts, handleScrollDirection,
  checkInfiniteScroll, handleLoadMore, activeFeedKey,
  registerNotifPoller, getScrollContainer, getScrollTop, scrollContainerTo,
  getScrollAnchor, restoreScrollAnchor,
  getFilteredPendingPosts, resetOverlayPillDismissed,
  stopFederatedStream,
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
  showLatestNotifToast, pollBackgroundAccounts, resetNotifMarkers,
} from './notifications.js';
import { initCompose, openComposeDrawer, closeComposeDrawer, handleReply, updateCharCount, updateSidebarCharCount, resetReplyState, refreshComposeDefaults } from './compose.js';
import { openSearchDrawer, closeSearchDrawer, initSearch } from './search.js';
import { openPostAnalyticsDrawer, closePostAnalyticsDrawer, appendMoreAnalyticsUsers } from './analytics.js';
import { startCountPolling, stopCountPolling, applyCountsFromStatus } from './counts.js';
import { initTitleBar, updateTitleBar } from './titlebar.js';
import { openFiltersDrawer, closeFiltersDrawer, initFiltersUI, loadFilters } from './filters.js';
import { initUsageTracking, startTracking, stopTracking, renderUsageUI } from './usage.js';
import { initSettingsSync, handleSyncToggle, triggerPush, clearAccountSettings } from './settingsSync.js';
import { getAccountNote, extractBlock } from './sync.js';


// Expose drawer openers needed by render.js and ui.js toasts
window.openThreadDrawer = openThreadDrawer;
window.openProfileDrawer = openProfileDrawer;
window.openNotifDrawer = openNotifDrawer;
window.handleReply = handleReply;
window.getFilteredPendingPosts = getFilteredPendingPosts;
window.activeFeedKey = activeFeedKey;
window.openFiltersDrawer = openFiltersDrawer;
window.closeFiltersDrawer = closeFiltersDrawer;
window.openBookmarksDrawer = openBookmarksDrawer;
window.switchAccount = switchAccount;
window.removeAccount = removeAccount;
window.renderAccountSwitcher = renderAccountSwitcher;

// Expose apply functions for real-time cloud sync
window.applyTheme = applyTheme;
window.applyPalette = applyPalette;
window.applyFont = applyFont;
window.applyFontSize = applyFontSize;
window.applyZenMode = applyZenMode;
window.updateSidebarNav = updateSidebarNav;
window.refreshNotifSettingsUI = refreshNotifSettingsUI;
window.refreshComposeDefaults = refreshComposeDefaults;
window.openPrivacyModal = openPrivacyModal;
window.loadFeedTab = loadFeedTab;

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
    $('post-analytics-drawer') && $('post-analytics-drawer').classList.contains('open') ||
    $('manage-filters-drawer') && $('manage-filters-drawer').classList.contains('open')
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
  if ($('manage-filters-drawer') && $('manage-filters-drawer').classList.contains('open')) closeFiltersDrawer();
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
    if (currentParams.get('manage_filters')) {
      openFiltersDrawer();
    }

    // Restore or clear hashtag filter state based on URL params
    const feedParam = currentParams.get('feed');
    const tagParam = currentParams.get('tag');
    const prevFeedFilter = state.feedFilter;

    if (feedParam === 'hashtags' && tagParam) {
      // Navigating forward into a hashtag view
      state.selectedHashtagFilter = tagParam;
      state.feedFilter = 'hashtags';
      document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === 'hashtags'));
      $('hashtag-filter-bar').style.display = '';
    } else if (state.feedFilter === 'hashtags') {
      // Navigating back out of a hashtag view - reset filter
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
      // Same tab but filter changed - reload the feed
      updateTabLabel('feed');
      const anchor = prevFeedFilter === 'hashtags' ? e.state?.scrollAnchor : null;
      await loadFeedTab(!anchor);
      if (anchor) {
        requestAnimationFrame(() => requestAnimationFrame(() => restoreScrollAnchor(anchor)));
      }
    }

    setTimeout(setOverlayPillVisibility, 10);
    updateSidebarNav();
  } finally {
    window._isRouting = false;
  }
});

const loadExploreTab = loadTrendingTab;

/* ══════════════════════════════════════════════════════════════════════
   INIT APP (after successful auth or stored session)
   ══════════════════════════════════════════════════════════════════════ */

async function initApp(server, token, demo = false) {
  console.log(`[Init] Initializing app for server: ${server}, demo: ${demo}`);
  
  if (!server && !demo) {
    console.error('[Init] Cannot initialize app: server is missing.');
    showScreen('login-screen');
    showLoginError('Error: Server information is missing. Please log in again.');
    return;
  }

  // Stop all active polling/streams before switching context
  if (typeof stopPolling === 'function') stopPolling();
  if (typeof stopCountPolling === 'function') stopCountPolling();
  if (typeof stopSwPolling === 'function') stopSwPolling();
  if (typeof stopFederatedStream === 'function') stopFederatedStream();
  state.server = server;
  state.token = token;
  state.demoMode = demo;
  showScreen('app-screen');
  $('login-back-btn').style.display = 'none'; // Hide if we're in the app
  initVersion();
  initTitleBar();

  // Reset feeds to prevent data leakage from previous sessions/accounts
  if (typeof resetFeeds === 'function') resetFeeds();

  if (demo) {
    $('demo-notice').style.display = 'block';
    loadFeedTab();
    return;
  }

  // Notify Android App if running in WebView
  if (typeof saveMastodonToken === 'function') {
    saveMastodonToken(token, server);
  }

  // Load core data in parallel for faster startup
  console.log('[Init] Fetching core data...');
  const [accountRes, tagsRes, instanceV1Res, _filtersRes] = await Promise.allSettled([
    apiGet('/api/v1/accounts/verify_credentials', token, server),
    apiGet('/api/v1/followed_tags?limit=200', token, server),
    apiGet('/api/v1/instance', token, server),
    loadFilters()
  ]);

  if (accountRes.status === 'fulfilled') {
    state.account = accountRes.value;
    const avatarEl = $('user-avatar');
    if (avatarEl) {
      avatarEl.onerror = () => { avatarEl.onerror = null; avatarEl.src = window._AVATAR_PLACEHOLDER; };
      avatarEl.src = state.account.avatar_static || state.account.avatar;
      avatarEl.alt = state.account.display_name || state.account.username;
    }
    applyFollowingFeedFlag();
  } else {
    console.warn('Could not load account info:', accountRes.reason);
  }

  if (tagsRes.status === 'fulfilled') {
    state.followedHashtags = tagsRes.value || [];
  } else {
    console.warn('Could not load followed hashtags at startup:', tagsRes.reason);
    state.followedHashtags = state.followedHashtags || [];
  }

  if (instanceV1Res.status === 'fulfilled') {
    const v1Data = instanceV1Res.value;
    state.serverVersion = v1Data.version;

    let chars = 500;
    let languages = [];
    if (v1Data.configuration?.statuses?.max_characters) {
      chars = v1Data.configuration.statuses.max_characters;
    } else if (v1Data.max_toot_chars) {
      chars = v1Data.max_toot_chars;
    }

    // Try V2 instance info for more details
    try {
      const v2Data = await apiGet('/api/v2/instance', token, server);
      if (v2Data.version) state.serverVersion = v2Data.version;
      if (v2Data.configuration?.statuses?.max_characters) chars = v2Data.configuration.statuses.max_characters;
      if (v2Data.languages) languages = v2Data.languages;
    } catch (v2Err) { }

    state.maxTootChars = chars;
    state.instanceLanguages = languages;
    updateCharCount();
    updateSidebarCharCount();
    resetReplyState();
  } else {
    console.warn('Could not load instance info:', instanceV1Res.reason);
  }

  // Probe public timelines
  state.localSupported = true;
  state.federatedSupported = true;

  try {
    const localUrl = getApiUrl(server, '/api/v1/timelines/public?local=true&limit=1');
    const fedUrl = getApiUrl(server, '/api/v1/timelines/public?limit=1');
    
    console.log(`[Init] Probing public timelines: ${localUrl}, ${fedUrl}`);

    const [localRes, fedRes] = await Promise.all([
      fetch(localUrl, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(fedUrl, { headers: { 'Authorization': `Bearer ${token}` } })
    ]);
    if (!localRes.ok) state.localSupported = false;
    else { const localData = await localRes.json(); state.localSupported = Array.isArray(localData) && localData.length > 0; }
    if (!fedRes.ok) state.federatedSupported = false;
    else { const fedData = await fedRes.json(); state.federatedSupported = Array.isArray(fedData) && fedData.length > 0; }
    updatePublicFeedFlags();
  } catch (e) {
    state.localSupported = false;
    state.federatedSupported = false;
    updatePublicFeedFlags();
  }

  // Language setup
  const populateLangDropdown = (selectEl, includeAll = true, includeBrowser = false) => {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = '';
    if (includeAll) { const opt = document.createElement('option'); opt.value = 'all'; opt.textContent = 'Show All'; selectEl.appendChild(opt); }
    if (includeBrowser) { const opt = document.createElement('option'); opt.value = 'browser'; opt.textContent = 'Browser default'; selectEl.appendChild(opt); }
    
    // Official Mastodon supports a wide range of ISO 639-1 and 639-3 codes (~180+).
    // We include the full list here to match official parity.
    const defaultCodes = "en,aa,ab,ae,af,ak,am,an,ar,as,av,ay,az,ba,be,bg,bh,bi,bm,bn,bo,br,bs,ca,ce,ch,co,cr,cs,cu,cv,cy,da,de,dv,dz,ee,el,eo,es,et,eu,fa,ff,fi,fj,fo,fr,fy,ga,gd,gl,gu,gv,ha,he,hi,ho,hr,ht,hu,hy,hz,ia,id,ie,ig,ii,ik,io,is,it,iu,ja,jv,ka,kg,ki,kj,kk,kl,km,kn,ko,kr,ks,ku,kv,kw,ky,la,lb,lg,li,ln,lo,lt,lu,lv,mg,mh,mi,mk,ml,mn,mn-Mong,mr,ms,ms-Arab,mt,my,na,nb,nd,ne,ng,nl,nn,no,nr,nv,ny,oc,oj,om,or,os,pa,pi,pl,ps,pt,qu,rm,rn,ro,ru,rw,sa,sc,sd,se,sg,si,sk,sl,sn,so,sq,sr,ss,st,su,sv,sw,ta,te,tg,th,ti,tk,tl,tn,to,tr,ts,tt,tw,ty,ug,uk,ur,uz,ve,vi,vo,wa,wo,xh,yi,yo,za,zh,zu,zh-CN,zh-HK,zh-TW,zh-YUE,ast,chr,ckb,cnr,csb,gsw,jbo,kab,ldn,lfn,moh,nds,pdc,sco,sma,smj,szl,tok,vai,xal,zba,zgh".split(',');
    const allLangs = new Set([...defaultCodes, ...(state.instanceLanguages || [])]);
    
    Array.from(allLangs).sort().forEach(code => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = getLanguageLabel(code);
      selectEl.appendChild(opt);
    });
    selectEl.value = current;
  };

  ['settings-feed-lang', 'settings-post-lang', 'settings-translate-lang', 'modal-lang-select'].forEach(id => {
    const el = document.getElementById(id);
    if (el) populateLangDropdown(el, id === 'settings-feed-lang', id !== 'settings-feed-lang');
  });

  // Update footer
  document.querySelectorAll('.footer-account-name').forEach(el => {
    if (state.account) {
      el.innerHTML = `@${state.account.username}<span style="opacity:0.6;">@${server}</span>`;
      el.parentElement.style.display = 'flex';
    } else { el.parentElement.style.display = 'none'; }
  });
  document.querySelectorAll('.footer-server-version').forEach(el => {
    if (state.serverVersion) {
      el.title = `Server Version: ${state.serverVersion}`;
      el.style.display = 'inline-block';
    } else {
      el.style.display = 'none';
    }
  });

  // Ensure this account is in our registry and set as ACTIVE before loading feeds
  if (state.account && !demo) {
    const accounts = getStoredAccounts();
    const acctId = `${state.account.username}@${server}`;
    let existing = accounts.find(a => a.id === acctId);
    if (existing) {
      existing.token = token;
      existing.server = server;
      existing.accountData = state.account;
    } else {
      accounts.push({ id: acctId, server, token, accountData: state.account, unreadCount: 0 });
    }
    saveStoredAccounts(accounts);
    setActiveAccountId(acctId);
    state.accounts = accounts;
    state.activeAccountId = acctId;
    store.set('token', token);
    store.set('server', server);
    syncAccountsToAndroid();
  }

  // Initialize UI components
  initFiltersUI();
  initUsageTracking();
  initSettingsSync();
  refreshNotifSettingsUI();

  // Load Feeds
  updateTabLabel('feed');
  updateTabLabel('explore');
  updateSidebarNav();

  // Sync tab visibility classes to match state.activeTab
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === state.activeTab);
    b.setAttribute('aria-selected', b.dataset.tab === state.activeTab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${state.activeTab}`);
  });

  if (state.activeTab === 'explore') {
    const isFeedContext = state.exploreSubtab === 'live' || state.exploreSubtab === 'federated';
    if (isFeedContext) {
      console.log(`[Init] Loading Explore feed: ${state.exploreSubtab}`);
      state.feedFilter = state.exploreSubtab;
      loadFeedTab();
    } else {
      console.log(`[Init] Loading Explore tab: ${state.exploreSubtab}`);
      loadExploreTab();
    }
  } else {
    console.log('[Init] Calling loadFeedTab()...');
    loadFeedTab();
    console.log('[Init] loadFeedTab() call returned (async).');
  }

  startPolling();
  startCountPolling();
  await pollNotifications();
  await pollBackgroundAccounts();
  startSwPolling();

  // Restore drawer states
  const threadId = urlParams.get('thread'); if (threadId) setTimeout(() => openThreadDrawer(threadId), 300);
  const profileId = urlParams.get('profile'); if (profileId) setTimeout(() => openProfileDrawer(profileId, state.server), 300);
  const bookmarks = urlParams.get('bookmarks'); if (bookmarks) setTimeout(() => openBookmarksDrawer(), 300);
  const notifications = urlParams.get('notifications'); if (notifications) setTimeout(() => openNotifDrawer(), 300);
}



/** Switches to a different account. */
export async function switchAccount(accountId) {
  const accounts = getStoredAccounts();
  const target = accounts.find(a => a.id === accountId);
  if (!target) return;

  // Optimistic UI: Close menu and show switching overlay immediately
  closeAllTabDropdowns();
  const profileDropdown = $('profile-dropdown');
  if (profileDropdown) profileDropdown.classList.remove('show');
  
  showSwitchingOverlay(target);

  // Stop polling for current account
  stopPolling();
  stopCountPolling();
  stopSwPolling();
  stopFederatedStream();

  // Switch active state
  setActiveAccountId(accountId);
  state.activeAccountId = accountId;

  // Reset feeds to prevent data leakage
  resetFeeds();

  // Re-init app with new credentials
  try {
    await initApp(target.server, target.token);
  } finally {
    // Small delay to ensure smooth exit
    setTimeout(hideSwitchingOverlay, 400);
  }
}

function resetFeeds() {
  state.homeFeed = null;
  state.homeMaxId = null;
  state.followingFeed = null;
  state.hashtagFeed = null;
  state.hashtagMaxId = null;
  state.localFeed = null;
  state.localMaxId = null;
  state.federatedFeed = null;
  state.federatedMaxId = null;
  state.followedHashtags = [];
  state.notifications = [];
  state.notifByType = {};
  state.notifMaxId = {};
  state.pendingPosts = { feed: [] };
  state.trendingPostsLoaded = false;
  state.trendingHashtagsLoaded = false;
  state.trendingPeopleLoaded = false;
  state.trendingNewsLoaded = false;
  state.trendingFollowingLoaded = false;
  state.lastSeenNotifId = null;
  state._lastFiredNotifId = null;
  resetNotifMarkers();
}

/** Removes an account from the registry. */
export async function removeAccount(accountId) {
  let accounts = getStoredAccounts();
  accounts = accounts.filter(a => a.id !== accountId);
  saveStoredAccounts(accounts);
  state.accounts = accounts;

  if (state.activeAccountId === accountId) {
    if (accounts.length > 0) {
      await switchAccount(accounts[0].id);
    } else {
      // Last account removed - log out
      store.del('token');
      store.del('server');
      store.del('active_account_id');
      store.del('token_scopes');
      store.del('pref_sync_onboarding_dismissed');
      sessionStorage.removeItem('notified_sync_available');
      location.reload();
    }
  } else {
    // If we're on the mobile/sidebar menu, we might need to refresh it
    if (window.updateSidebarNav) window.updateSidebarNav();
  }

  // Sync updated account list to Android
  syncAccountsToAndroid();
}


/* ══════════════════════════════════════════════════════════════════════
   OAUTH CALLBACK
   ══════════════════════════════════════════════════════════════════════ */

function saveMastodonToken(token, server) {
  if (window.AndroidBridge && typeof window.AndroidBridge.postMessage === 'function') {
    // New protocol using postMessage with JSON payload
    window.AndroidBridge.postMessage(JSON.stringify({
      type: 'saveToken',
      token: token
    }));
    console.log('[Elefeed] Sent saveToken message to AndroidBridge.');

    if (server) {
      window.AndroidBridge.postMessage(JSON.stringify({
        type: 'saveInstance',
        instance: server
      }));
      console.log('[Elefeed] Sent saveInstance message to AndroidBridge.');
    }
  } else if (window.AndroidBridge && typeof window.AndroidBridge.saveToken === 'function') {
    // Fallback for older versions using direct method call
    window.AndroidBridge.saveToken(token);
  } else {
    // console.log("Android bridge not available");
  }
}

function syncAccountsToAndroid() {
  if (window.AndroidBridge && typeof window.AndroidBridge.postMessage === 'function') {
    const storedAccounts = getStoredAccounts();
    const accounts = storedAccounts.map(a => ({
      id: a.accountData?.id || a.id,
      server: a.server,
      token: a.token,
      username: a.accountData?.username || (typeof a.id === 'string' ? a.id.split('@')[0] : '')
    }));

    // Find numeric ID for the active account
    const activeAccount = storedAccounts.find(a => a.id === state.activeAccountId);
    const activeId = activeAccount ? (activeAccount.accountData?.id || state.activeAccountId) : state.activeAccountId;

    window.AndroidBridge.postMessage(JSON.stringify({
      type: 'saveAccounts',
      activeAccountId: activeId,
      accounts: accounts
    }));
    console.log('[Elefeed] Sent saveAccounts message to AndroidBridge.');
  }
}

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
      // Note: initApp will handle adding to registry and setting activeId
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

    const authParams = {
      client_id: app.client_id,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
    };
    if (state.forceLogin) {
      authParams.force_login = 'true';
    }

    const authUrl = `https://${server}/oauth/authorize?` + new URLSearchParams(authParams);

    // On mobile, window.open() either gets blocked or opens in a separate browser
    // process (Android WebView → Chrome Custom Tab, iOS → SFSafariViewController)
    // whose localStorage is completely isolated. Use a full-page redirect instead,
    // which stays in the same context so pending_* values are always available.
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || typeof window.AndroidBridge !== 'undefined';
    if (isMobile) {
      location.href = authUrl;
      return;
    }

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

        $('login-btn').textContent = 'Log in with Mastodon →';
        $('login-btn').disabled = false;
        // Note: initApp will handle adding to registry and setting activeId
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

$('login-back-btn')?.addEventListener('click', () => {
  showScreen('app-screen');
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

// Prevent pinch-to-zoom globally; allow it only when the lightbox is open.
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 && !window._lightboxOpen) {
    e.preventDefault();
  }
}, { passive: false });

/* ══════════════════════════════════════════════════════════════════════
   TAB SWITCHING & DROPDOWNS
   ══════════════════════════════════════════════════════════════════════ */

let tabSwitchTimeout = null;

function switchToTab(tab) {
  const tabChanged = tab !== state.activeTab;

  if (tabChanged) {
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
  }

  // Ensure dropdown selection classes match state
  document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(i => {
    i.classList.toggle('active', i.dataset.filter === state.feedFilter);
  });
  document.querySelectorAll('#tab-dropdown-explore .tab-dropdown-item').forEach(i => {
    i.classList.toggle('active', i.dataset.subtab === state.exploreSubtab);
  });

  updateTabLabel('feed');
  updateTabLabel('explore');
  updateSidebarNav();

  clearTimeout(tabSwitchTimeout);
  tabSwitchTimeout = setTimeout(() => {
    if (tab === 'feed') {
      // If returning to the feed tab while the filter was set to an explore-controlled feed,
      // revert back to 'all' so that it renders into the visible panel.
      if (state.feedFilter === 'live' || state.feedFilter === 'federated') {
        state.feedFilter = 'all';
      }
      loadFeedTab();
    }
    else if (tab === 'explore') {
      const isFeedContext = state.exploreSubtab === 'live' || state.exploreSubtab === 'federated';
      if (isFeedContext) {
        state.feedFilter = state.exploreSubtab;
        import('./feed.js').then(m => m.loadFeedTab());
      } else {
        stopFederatedStream(); // SSE must stop when leaving the feed tab for standard explore
        loadExploreTab();
      }
    }
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
    if (filter === state.feedFilter && state.activeTab === 'feed') { closeAllTabDropdowns(); return; }

    state.feedFilter = filter;
    updateURLParam('feed', filter);

    const filterBar = $('hashtag-filter-bar');
    if (filterBar) filterBar.style.display = (filter === 'hashtags') ? '' : 'none';

    closeAllTabDropdowns();
    switchToTab('feed');
  });
});

/* Feed Filter Settings */
$('about-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  openAboutModal();
  $('profile-dropdown').classList.remove('show');
  $('avatar-btn').classList.remove('active');
});

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
    const isFeedContext = subtab === 'live' || subtab === 'federated';

    if (subtab === state.exploreSubtab && state.activeTab === 'explore') { closeAllTabDropdowns(); return; }

    state.exploreSubtab = subtab;
    updateURLParam('explore', subtab);

    closeAllTabDropdowns();
    switchToTab('explore');
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

const doRefresh = async () => {
  const refreshBtn = $('refresh-btn');
  if (refreshBtn) refreshBtn.classList.add('refresh-btn-spinning');

  const tab = state.activeTab;
  const feedKey = activeFeedKey();
  // If there are buffered new posts, act like clicking the pill
  if (tab === 'feed' && getFilteredPendingPosts(feedKey).length > 0) {
    flushPendingPosts(feedKey, true);
    if (refreshBtn) refreshBtn.classList.remove('refresh-btn-spinning');
    return;
  }
  state.pendingPosts[feedKey] = [];
  updateTabPill(feedKey);

  try {
    if (tab === 'feed') {
      state.homeFeed = null;
      state.hashtagFeed = null;
      await loadFeedTab();
    } else if (tab === 'explore') {
      const isFeedContext = state.exploreSubtab === 'live' || state.exploreSubtab === 'federated';
      if (isFeedContext) {
        if (state.exploreSubtab === 'live') state.localFeed = null;
        if (state.exploreSubtab === 'federated') state.federatedFeed = null;
        await loadFeedTab();
      } else {
        state.trendingPostsLoaded = false;
        state.trendingHashtagsLoaded = false;
        state.trendingPeopleLoaded = false;
        state.trendingNewsLoaded = false;
        state.trendingFollowingLoaded = false;
        await loadExploreTab();
      }
    }

    // Ensure usage tracker reappears on refresh
    try {
      const { resetUsageDismissal } = await import('./usage.js');
      resetUsageDismissal(false);
    } catch (e) { }
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('refresh-btn-spinning');
  }

  showToast('Refreshing…');
};
$('refresh-btn').addEventListener('click', doRefresh);
$('header-wordmark-btn').addEventListener('click', doRefresh);

const fedDismissBtn = $('federated-info-dismiss');
if (fedDismissBtn) {
  fedDismissBtn.addEventListener('click', () => {
    state.federatedBannerDismissed = true;
    const fedBar = $('federated-info-bar');
    if (fedBar) fedBar.style.display = 'none';
  });
}

/* Avatar menu */
function renderAccountSwitcher() {
  const container = $('profile-account-list');
  if (!container) return;

  const accounts = getStoredAccounts();
  
  container.innerHTML = `
    <div class="account-switcher-strip">
      ${accounts.map(acct => {
        const isActive = acct.id === state.activeAccountId;
        const displayName = acct.accountData.display_name || acct.accountData.username;
        const avatarUrl = acct.accountData.avatar_static || acct.accountData.avatar;
        const handle = acct.id.split('@')[0];
        
        // Use live state count for the active account to ensure it's never stale
        const unreadCount = isActive ? (state.notifUnreadCount || 0) : (acct.unreadCount || 0);

        return `
          <div class="account-pill ${isActive ? 'active' : ''}" 
               onclick="window.switchAccount('${acct.id}')" 
               title="${escapeHTML(displayName)} (@${escapeHTML(acct.id)})">
            <div class="account-pill-avatar-wrap">
              <img class="account-pill-avatar" src="${escapeHTML(avatarUrl)}" alt="" onerror="this.src=window._AVATAR_PLACEHOLDER" />
              ${unreadCount > 0 ? `<div class="account-pill-badge">${unreadCount > 99 ? '99+' : unreadCount}</div>` : ''}
            </div>
            <span class="account-pill-handle">${escapeHTML(handle)}</span>
          </div>
        `;
      }).join('')}
      
      <div class="account-pill account-pill--add" id="add-account-pill" title="Add another account">
        <div class="account-pill-avatar-wrap">
          <iconify-icon icon="ph:plus-bold"></iconify-icon>
        </div>
        <span class="account-pill-handle">Add</span>
      </div>
    </div>
  `;

  // Bind the add account click
  $('add-account-pill')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('profile-dropdown').classList.remove('show');
    state.forceLogin = true;
    showScreen('login-screen');
    clearLoginError();
  });
}

window.handleRemoveAccount = async (id) => {
  const isSyncHost = id === getSyncAccountId();
  let msg = `This will log you out of @${id} on this device.`;
  if (isSyncHost) {
    msg += "\n\n⚠️ This is your current Settings Sync account. Removing it will disable cross-device sync.";
  }

  const confirmed = await showConfirm(msg, 'Remove account?', 'ph:sign-out-bold');
  if (confirmed) {
    if (isSyncHost) {
      setSyncAccountId(null);
      store.set('pref_sync_settings', 'false');
    }
    await removeAccount(id);
    renderAccountSwitcher();
  }
};

$('avatar-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeAllTabDropdowns();
  document.querySelectorAll('.boost-dropdown').forEach(m => {
    if (m.id !== 'profile-dropdown') m.classList.remove('show');
  });

  renderAccountSwitcher();
  $('profile-dropdown').classList.toggle('show');
});

$('add-account-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('profile-dropdown').classList.remove('show');
  state.forceLogin = true;
  showScreen('login-screen');
  clearLoginError();
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

const manageFiltersMenuBtn = $('manage-filters-menu-btn');
if (manageFiltersMenuBtn) {
  manageFiltersMenuBtn.addEventListener('click', () => {
    $('profile-dropdown').classList.remove('show');
    openFiltersDrawer();
  });
}

const settingsMenuBtn = $('settings-menu-btn');
if (settingsMenuBtn) {
  settingsMenuBtn.addEventListener('click', () => {
    $('profile-dropdown').classList.remove('show');

    // Set active button
    const currentTheme = store.get('theme') || 'system';
    document.querySelectorAll('#settings-theme-group .theme-segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === currentTheme);
    });

    const currentPalette = store.get('pref_palette') || 'classic';
    const paletteSel = $('settings-palette-select');
    if (paletteSel) paletteSel.value = currentPalette;



    // Sync notification permission status and toggles
    refreshNotifSettingsUI();

    const hashtagPillsToggle = $('settings-hashtag-pills-toggle');
    if (hashtagPillsToggle) {
      hashtagPillsToggle.checked = store.get('pref_hashtag_pills') !== 'false';
    }

    const newpostStyleCurrent = store.get('pref_newpost_style') || 'badge'; // default: Refresh Notification
    document.querySelectorAll('#settings-newpost-style-group .theme-segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === newpostStyleCurrent);
    });

    const currentFont = store.get('pref_font_family') || 'sans';
    const fontSel = $('settings-font-family');
    if (fontSel) fontSel.value = currentFont;

    const currentFontSize = store.get('pref_font_size') || '14px';
    const fontSizeSel = $('settings-font-size');
    if (fontSizeSel) fontSizeSel.value = currentFontSize;
    const fontSizeVal = $('settings-font-size-value');
    if (fontSizeVal) fontSizeVal.textContent = currentFontSize;

    const hideCardsToggle = $('settings-hide-cards-toggle');
    if (hideCardsToggle) {
      hideCardsToggle.checked = store.get('pref_hide_cards') === 'true';
    }

    const clearUrlsToggle = $('settings-clear-urls-toggle');
    if (clearUrlsToggle) {
      clearUrlsToggle.checked = store.get('pref_clear_urls') === 'true';
    }

    const usageTrackingToggle = $('settings-usage-tracking-toggle');
    if (usageTrackingToggle) {
      usageTrackingToggle.checked = store.get('pref_usage_tracking') === 'true';
    }

    const settingsSyncToggle = $('settings-sync-toggle');
    if (settingsSyncToggle) {
      settingsSyncToggle.checked = store.get('pref_sync_settings') === 'true';
    }

    // Populate Sync Account Select
    const syncSel = $('settings-sync-account-select');
    const syncRow = $('settings-sync-account-row');
    if (syncSel && syncRow) {
      const isSyncEnabled = store.get('pref_sync_settings') === 'true';
      syncRow.style.display = isSyncEnabled ? 'flex' : 'none';

      const accounts = getStoredAccounts();
      const syncId = getSyncAccountId() || state.activeAccountId;
      syncSel.innerHTML = accounts.map(a => `<option value="${a.id}" ${a.id === syncId ? 'selected' : ''}>@${a.id}</option>`).join('');
    }

    const zenModeToggle = $('settings-zen-mode-toggle');
    if (zenModeToggle) {
      zenModeToggle.checked = state.zenMode;
    }

    const countPollingToggle = $('settings-count-polling-toggle');
    if (countPollingToggle) {
      countPollingToggle.checked = store.get('pref_count_polling') !== 'false';
    }

    const showInlineThreadToggle = $('settings-show-inline-thread-toggle');
    if (showInlineThreadToggle) {
      showInlineThreadToggle.checked = state.showInlineThread;
    }

    const autoOpenSensitiveToggle = $('settings-auto-open-sensitive-toggle');
    if (autoOpenSensitiveToggle) {
      autoOpenSensitiveToggle.checked = store.get('pref_auto_open_sensitive') === 'true';
    }

    const separateBoostQuoteToggle = $('settings-separate-boost-quote-toggle');
    if (separateBoostQuoteToggle) {
      separateBoostQuoteToggle.checked = store.get('pref_combine_boost_quote') === 'true';
    }

    const desktopMenuToggle = $('settings-desktop-menu-toggle');
    if (desktopMenuToggle) {
      desktopMenuToggle.checked = state.desktopMenu;
    }

    let mediaWarningMode = store.get('pref_media_warning_mode');
    if (!mediaWarningMode) {
      const hideSensitive = store.get('pref_hide_sensitive_media');
      // Migration: if hide_sensitive was 'true', it means "Sensitive Only"
      // Otherwise (if 'false' or null), default to 'none' (Show all)
      mediaWarningMode = (hideSensitive === 'true') ? 'sensitive' : 'none';
      store.set('pref_media_warning_mode', mediaWarningMode);
    }
    const radio = document.querySelector(`#settings-media-warning-group input[value="${mediaWarningMode}"]`);
    if (radio) radio.checked = true;

    const confirmInteractionsToggle = $('settings-confirm-interactions-toggle');
    if (confirmInteractionsToggle) {
      confirmInteractionsToggle.checked = store.get('pref_confirm_interactions') === 'true';
    }

    const translateLangSel = $('settings-translate-lang');
    if (translateLangSel) {
      translateLangSel.value = store.get('pref_translate_lang') || 'browser';
    }

    // Posting Defaults
    const postVisSel = $('settings-post-visibility');
    if (postVisSel) {
      postVisSel.value = store.get('pref_post_visibility') || 'public';
    }
    const currentQuote = store.get('pref_post_quote') || 'public';
    const postQuoteSel = $('settings-post-quote');
    if (postQuoteSel) postQuoteSel.value = currentQuote;
    document.querySelectorAll('#settings-post-quote-group .theme-segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === currentQuote);
    });
    const alwaysSensitiveToggle = $('settings-always-sensitive-toggle');
    if (alwaysSensitiveToggle) {
      alwaysSensitiveToggle.checked = store.get('pref_always_sensitive') === 'true';
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

$('settings-sync-account-select')?.addEventListener('change', (e) => {
  const newId = e.target.value;
  setSyncAccountId(newId);
  showToast(`Sync host changed to @${newId}`, 'success');
  // Re-init sync with the new account
  import('./settingsSync.js').then(m => m.initSettingsSync());
});

function applyTheme(t) {
  if (t) {
    store.set('theme', t);
    triggerPush();
  }
  const mode = store.get('theme') || 'system';
  const palette = store.get('pref_palette') || 'classic';

  let actualMode = mode;
  if (mode === 'system') {
    actualMode = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  document.documentElement.setAttribute('data-mode', actualMode);
  document.documentElement.setAttribute('data-palette', palette);

  // Backward compatibility for existing CSS [data-theme="light"]
  if (actualMode === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function applyPalette(p) {
  store.set('pref_palette', p);
  triggerPush();
  applyTheme();
}

document.querySelectorAll('#settings-theme-group .theme-segment-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const value = e.currentTarget.dataset.value;
    document.querySelectorAll('#settings-theme-group .theme-segment-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    applyTheme(value);
  });
});


$('settings-palette-select')?.addEventListener('change', (e) => {
  applyPalette(e.target.value);
});




window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
  const t = store.get('theme') || 'system';
  if (t === 'system') applyTheme('system');
});

function applyFont(f) {
  store.set('pref_font_family', f);
  triggerPush();
  const fontMap = {
    'sans': "'DM Sans', system-ui, -apple-system, sans-serif",
    'outfit': "'Outfit', sans-serif",
    'plex': "'IBM Plex Sans', sans-serif",
    'atkinson': "'Atkinson Hyperlegible', sans-serif",
    'lexend': "'Lexend', sans-serif",
    'serif': "Charter, Georgia, 'Times New Roman', serif",
    'literata': "'Literata', serif",
    'lora': "'Lora', serif",
    'bitter': "'Bitter', serif",
    'mono': "'DM Mono', monospace"
  };
  document.documentElement.style.setProperty('--font-body', fontMap[f] || fontMap['sans']);
}

$('settings-font-family')?.addEventListener('change', (e) => {
  applyFont(e.target.value);
});

function applyFontSize(s) {
  store.set('pref_font_size', s);
  triggerPush();
  document.documentElement.style.setProperty('--app-font-size', s);
  const valDisp = $('settings-font-size-value');
  if (valDisp) valDisp.textContent = s;
}

$('settings-font-size')?.addEventListener('change', (e) => {
  applyFontSize(e.target.value);
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
    denied: '🚫 Blocked - enable in browser/OS settings',
    default: '⬜ Permission not yet requested',
    unsupported: '⚠️ Not supported in this browser',
  };
  if (permStatus) permStatus.textContent = permLabels[perm] || perm;
  permBtn.textContent = perm === 'granted' ? 'Permission granted' : 'Enable Notifications';
  permBtn.disabled = perm === 'granted' || perm === 'denied' || perm === 'unsupported';

  // Hide push notification settings on mobile devices (where OS handles them)
  const isAndroidBridge = !!window.AndroidBridge;
  const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent) || isAndroidBridge;
  const pushSection = $('settings-push-notifs-section');
  if (pushSection) {
    // Show the push section on desktop OR on Android app (where we need the alarm permission setting)
    pushSection.style.display = (isMobile && !isAndroidBridge) ? 'none' : 'flex';
  }

  // Show web push options only if permission is granted
  const pushOptions = $('settings-web-push-options');
  if (pushOptions) {
    // Hide standard web push options on Android app, since it uses the bridge/alarm instead
    pushOptions.style.display = (perm === 'granted' && !isAndroidBridge) ? 'flex' : 'none';
  }

  // Show Android-specific alarm section
  const alarmSection = $('settings-android-alarm-section');
  const webPermRow = $('settings-web-notif-perm-row');
  if (alarmSection) {
    alarmSection.style.display = isAndroidBridge ? 'flex' : 'none';
  }
  if (webPermRow) {
    // Hide the web permission row on the Android app to avoid confusion
    webPermRow.style.display = isAndroidBridge ? 'none' : 'flex';
  }

  if (bgToggle) {
    const bgEnabled = store.get('pref_bg_notifications') !== 'false';
    bgToggle.checked = bgEnabled;

    // Hide sub-options if background notifications are disabled
    const showSubOptions = bgEnabled;
    const intervalRow = $('settings-notif-interval-row');
    const alertsRow = $('settings-notif-alerts-row');
    if (intervalRow) intervalRow.style.display = showSubOptions ? 'flex' : 'none';
    if (alertsRow) alertsRow.style.display = showSubOptions ? 'flex' : 'none';
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

  // Show debug panel (includes feature flags) only for the developer account
  const debugSection = $('settings-debug-section');
  const acct = state.account?.acct || '';
  const server = state.server || '';
  const isDev = acct === 'TheStoneDonkey' && server === 'beige.party';

  if (debugSection) debugSection.style.display = isDev ? '' : 'none';

  // Sync the feature flag toggle state
  const followingToggle = $('debug-following-feed-toggle');
  if (followingToggle) {
    followingToggle.checked = store.get('pref_following_feed') === 'true';
  }
}

// Leave public feeds dropdown items visible even if disabled,
// so users can click them and see the explanation message.
function updatePublicFeedFlags() {
  // No-op
}

// Apply the "From Following" feature flag to the tab button visibility
function applyFollowingFeedFlag() {
  const btn = document.querySelector('#tab-dropdown-explore .tab-dropdown-item[data-subtab="following"]');
  if (!btn) return;
  const acct = state.account?.acct || '';
  const srv = state.server || '';
  const isDev = acct === 'TheStoneDonkey' && srv === 'beige.party';
  const enabled = isDev && store.get('pref_following_feed') === 'true';
  btn.style.display = enabled ? '' : 'none';
}
applyFollowingFeedFlag();

// Wire the debug toggle
const _followingFeedToggle = $('debug-following-feed-toggle');
if (_followingFeedToggle) {
  _followingFeedToggle.addEventListener('change', () => {
    store.set('pref_following_feed', _followingFeedToggle.checked ? 'true' : 'false');
    triggerPush();
    applyFollowingFeedFlag();
    showToast(_followingFeedToggle.checked ? '"From Following" tab enabled' : '"From Following" tab hidden');
  });
}

// Wire notification settings controls (elements exist in DOM at load time)
// In-app notifications
const _inAppNotifToggle = $('settings-in-app-notif-toggle');
if (_inAppNotifToggle) {
  _inAppNotifToggle.checked = store.get('pref_in_app_notifs') !== 'false';
  _inAppNotifToggle.addEventListener('change', () => {
    store.set('pref_in_app_notifs', _inAppNotifToggle.checked ? 'true' : 'false');
    triggerPush();
  });
}

// Inline thread option
const _showInlineThreadToggle = $('settings-show-inline-thread-toggle');
if (_showInlineThreadToggle) {
  _showInlineThreadToggle.addEventListener('change', () => {
    state.showInlineThread = _showInlineThreadToggle.checked;
    store.set('pref_show_inline_thread', state.showInlineThread ? 'true' : 'false');
    triggerPush();
  });
}

// Clear URLs
const _clearUrlsToggle = $('settings-clear-urls-toggle');
if (_clearUrlsToggle) {
  _clearUrlsToggle.addEventListener('change', () => {
    store.set('pref_clear_urls', _clearUrlsToggle.checked ? 'true' : 'false');
    triggerPush();
    if (window.loadFeedTab) window.loadFeedTab(false);
  });
}

// Usage tracking
const _usageTrackingToggle = $('settings-usage-tracking-toggle');
if (_usageTrackingToggle) {
  _usageTrackingToggle.addEventListener('change', () => {
    const enabled = _usageTrackingToggle.checked;
    store.set('pref_usage_tracking', enabled ? 'true' : 'false');
    if (enabled) {
      startTracking();
      showToast('Usage tracking enabled');
    } else {
      stopTracking();
      showToast('Usage tracking disabled');
    }
  });
}

// Settings sync
const _settingsSyncToggle = $('settings-sync-toggle');
if (_settingsSyncToggle) {
  _settingsSyncToggle.addEventListener('change', () => {
    handleSyncToggle(_settingsSyncToggle.checked);
  });
}

// Background notifications toggle
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
      showToast('Permission denied - check your browser/OS settings.');
    }
  });
}

if (_bgToggle) {
  _bgToggle.addEventListener('change', () => {
    store.set('pref_bg_notifications', _bgToggle.checked ? 'true' : 'false');
    triggerPush();
    updateSwConfig();
    refreshNotifSettingsUI();
    showToast(_bgToggle.checked ? 'Background notifications on' : 'Background notifications off');
  });
}

if (_intervalSel) {
  _intervalSel.value = store.get('pref_bg_poll_interval') || '600000';
  _intervalSel.addEventListener('change', () => {
    store.set('pref_bg_poll_interval', _intervalSel.value);
    triggerPush();
    updateSwConfig();
    showToast('Check interval updated');
  });
}

// Alert type checkboxes
['mention', 'follow', 'reblog', 'favourite', 'follow-request', 'poll', 'status', 'update'].forEach(type => {
  const cb = $(`settings-alert-${type}`);
  if (cb) {
    cb.checked = store.get(`pref_alert_${type}`) !== 'false';
    cb.addEventListener('change', () => {
      store.set(`pref_alert_${type}`, cb.checked);
      triggerPush();
      updateSwConfig();
    });
  }
});

// Alert types collapsible toggle
const _alertToggle = $('settings-alert-types-toggle');
const _alertContent = $('settings-alert-types-content');
if (_alertToggle && _alertContent) {
  _alertToggle.addEventListener('click', () => {
    const isExpanded = _alertContent.style.display === 'flex';
    _alertContent.style.display = isExpanded ? 'none' : 'flex';
    const chevron = $('alert-types-chevron');
    if (chevron) {
      chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
    }
  });
}

// Alert type toggles - changing them forces a push subscription update
const _alertTypes = ['mention', 'follow', 'reblog', 'favourite', 'follow_request', 'poll', 'status', 'update'];
for (const type of _alertTypes) {
  const elId = type === 'follow_request' ? 'settings-alert-follow-request' : `settings-alert-${type}`;
  const el = $(elId);
  if (!el) continue;
  el.addEventListener('change', () => {
    store.set('pref_alert_' + type, el.checked ? 'true' : 'false');
    triggerPush();
    // Force push re-registration so Mastodon receives the updated alert list
    store.del('push_endpoint_' + state.server);
    updateSwConfig();
  });
}

/* ── Developer Debug Panel ──────────────────────────────────────────── */

// Wire up collapsible debug toggle
const _debugToggle = $('settings-debug-toggle');
const _debugContent = $('settings-debug-content');
if (_debugToggle && _debugContent) {
  _debugToggle.addEventListener('click', () => {
    const isExpanded = _debugToggle.getAttribute('aria-expanded') === 'true';
    _debugToggle.setAttribute('aria-expanded', !isExpanded);
    _debugContent.style.display = isExpanded ? 'none' : 'flex';
    const chevron = _debugToggle.querySelector('.debug-chevron');
    if (chevron) {
      chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
    }
  });
}

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
      debugUpdateStatus('startSwPolling() complete - check console for [Elefeed] logs.');
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
      debugUpdateStatus('Force re-register complete - check console for [Elefeed] logs.');
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
        debugUpdateStatus('⚠️ No permission - grant notification permission first.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Elefeed - Test Notification 🔔', {
        body: 'If you see this, your SW and OS notifications are working correctly.',
        icon: '/icon512x512.png',
        badge: '/icon512x512.png',
        tag: 'elefeed-debug-test',
        data: { url: '/?notifications=true' }
      });
      debugUpdateStatus('✅ Test notification fired - did it appear as an OS alert?');
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
    triggerPush();
    document.querySelectorAll('#settings-newpost-style-group .theme-segment-btn').forEach(b => b.classList.toggle('active', b === btn));
    // Re-apply to current feed; reset dismissed flag so pill can show immediately
    if (value === 'pill') {
      resetOverlayPillDismissed();
    }
    updateTabPill(activeFeedKey());
  });
});

// Hashtag pills (enabled by default; opt-out via settings)
if (store.get('pref_hashtag_pills') !== 'false') {
  document.body.classList.add('hashtag-pills-enabled');
}
const _hashtagPillsToggle = $('settings-hashtag-pills-toggle');
if (_hashtagPillsToggle) {
  _hashtagPillsToggle.addEventListener('change', () => {
    store.set('pref_hashtag_pills', _hashtagPillsToggle.checked ? 'true' : 'false');
    triggerPush();
    if (_hashtagPillsToggle.checked) {
      document.body.classList.add('hashtag-pills-enabled');
    } else {
      document.body.classList.remove('hashtag-pills-enabled');
    }
  });
}

// Zen Mode
function applyZenMode() {
  const btn = $('profile-zen-btn');
  const toggle = $('settings-zen-mode-toggle');
  if (state.zenMode) {
    document.body.classList.add('zen-mode');
    btn?.classList.add('profile-dropdown-zen-active');
    if (toggle) toggle.checked = true;
  } else {
    document.body.classList.remove('zen-mode');
    btn?.classList.remove('profile-dropdown-zen-active');
    if (toggle) toggle.checked = false;
  }
  updateSidebarNav();
}

$('profile-zen-btn')?.addEventListener('click', () => {
  state.zenMode = !state.zenMode;
  store.set('zen_mode', state.zenMode);
  triggerPush();
  applyZenMode();
  showToast(state.zenMode ? 'Zen Mode enabled' : 'Zen Mode disabled');
  $('profile-dropdown')?.classList.remove('show');
});

const _zenModeToggle = $('settings-zen-mode-toggle');
if (_zenModeToggle) {
  _zenModeToggle.addEventListener('change', () => {
    state.zenMode = _zenModeToggle.checked;
    store.set('zen_mode', state.zenMode);
    triggerPush();
    applyZenMode();
    showToast(state.zenMode ? 'Zen Mode enabled' : 'Zen Mode disabled');
  });
}
applyZenMode();

// Hide Cards
if (store.get('pref_hide_cards') === 'true') {
  document.body.classList.add('hide-cards-enabled');
}
const _hideCardsToggle = $('settings-hide-cards-toggle');
if (_hideCardsToggle) {
  _hideCardsToggle.addEventListener('change', () => {
    store.set('pref_hide_cards', _hideCardsToggle.checked ? 'true' : 'false');
    triggerPush();
    if (_hideCardsToggle.checked) {
      document.body.classList.add('hide-cards-enabled');
    } else {
      document.body.classList.remove('hide-cards-enabled');
    }
  });
}

// Live count updates
const _countPollingToggle = $('settings-count-polling-toggle');
if (_countPollingToggle) {
  _countPollingToggle.addEventListener('change', () => {
    store.set('pref_count_polling', _countPollingToggle.checked ? 'true' : 'false');
    triggerPush();
    if (_countPollingToggle.checked) {
      if (window.startCountPolling) startCountPolling();
    } else {
      if (window.stopCountPolling) stopCountPolling();
    }
  });
}

// Auto-open sensitive content
const _autoOpenSensitiveToggle = $('settings-auto-open-sensitive-toggle');
if (_autoOpenSensitiveToggle) {
  _autoOpenSensitiveToggle.addEventListener('change', () => {
    store.set('pref_auto_open_sensitive', _autoOpenSensitiveToggle.checked ? 'true' : 'false');
    triggerPush();
  });
}

// Combine boost/quote
const _separateBoostQuoteToggle = $('settings-separate-boost-quote-toggle');
if (_separateBoostQuoteToggle) {
  _separateBoostQuoteToggle.addEventListener('change', () => {
    store.set('pref_combine_boost_quote', _separateBoostQuoteToggle.checked ? 'true' : 'false');
    triggerPush();
    import('./ui.js').then(m => m.showToast(_separateBoostQuoteToggle.checked ? 'Boost and Quote combined' : 'Boost and Quote separated'));
    import('./feed.js').then(m => m.loadFeedTab(false));
  });
}

// Media warning mode
document.querySelectorAll('#settings-media-warning-group input').forEach(radio => {
  radio.addEventListener('change', () => {
    const value = radio.value;
    store.set('pref_media_warning_mode', value);
    store.set('pref_hide_sensitive_media', value === 'none' ? 'false' : 'true');
    triggerPush();
    
    let msg = 'Media warning: ';
    if (value === 'all') msg += 'Warn all';
    else if (value === 'sensitive') msg += 'Sensitive only';
    else msg += 'None';
    import('./ui.js').then(m => m.showToast(msg));
  });
});

const _confirmInteractionsToggle = $('settings-confirm-interactions-toggle');
if (_confirmInteractionsToggle) {
  _confirmInteractionsToggle.addEventListener('change', () => {
    store.set('pref_confirm_interactions', _confirmInteractionsToggle.checked ? 'true' : 'false');
    triggerPush();
  });
}

// Giphy Integration toggle
const _giphyToggle = $('settings-giphy-toggle');
if (_giphyToggle) {
  _giphyToggle.checked = state.giphyEnabled;
  _giphyToggle.addEventListener('change', () => {
    state.giphyEnabled = _giphyToggle.checked;
    store.set('pref_giphy_enabled', state.giphyEnabled ? 'true' : 'false');
    triggerPush();
    import('./giphy.js').then(m => m.updateGiphyVisibility());
    import('./ui.js').then(m => m.showToast(state.giphyEnabled ? 'Giphy integration enabled' : 'Giphy integration disabled'));
  });
}

// Sidebar Navigation
function updateSidebarNav() {
  const nav = $('sidebar-nav');
  if (!nav) return;

  if (!state.desktopMenu || window.innerWidth <= 900) {
    nav.style.display = 'none';
    return;
  }

  nav.style.display = 'flex';

  const primaryItems = [
    { action: 'home', label: 'Home', icon: 'ph:house-bold', active: state.activeTab === 'feed' && state.feedFilter === 'all' },
    { action: 'following', label: 'Followed Profiles', icon: 'ph:users-bold', active: state.activeTab === 'feed' && state.feedFilter === 'following' },
    { action: 'followed-hashtags', label: 'Followed Hashtags', icon: 'ph:hash-bold', active: state.activeTab === 'feed' && state.feedFilter === 'hashtags' },
    { action: 'trending', label: 'Trending', icon: 'ph:chart-line-up-bold', active: state.activeTab === 'explore' && state.exploreSubtab === 'posts' },
    { action: 'notifications', label: 'Notifications', icon: 'ph:bell-bold', active: state.notifDrawerOpen },
    { action: 'search', label: 'Search', icon: 'ph:magnifying-glass-bold' }
  ];

  const secondaryItems = [
    { action: 'local', label: 'Local Feed', icon: 'ph:broadcast-bold', active: state.activeTab === 'explore' && state.exploreSubtab === 'live' },
    { action: 'federated', label: 'Federated Feed', icon: 'ph:globe-bold', active: state.activeTab === 'explore' && state.exploreSubtab === 'federated' },
    { action: 'bookmarks', label: 'Bookmarks', icon: 'ph:bookmark-simple-bold', active: state.bookmarksActive },
    { action: 'hashtags', label: 'Manage Hashtags', icon: 'ph:hash-bold' },
    { action: 'zen', label: 'Zen Mode', icon: 'ri:flower-line', active: state.zenMode }
  ];

  const renderItem = (item) => {
    let badgeHtml = '';
    if (item.action === 'notifications' && state.notifUnreadCount > 0) {
      const displayCount = state.notifUnreadCount > 99 ? '99+' : state.notifUnreadCount;
      badgeHtml = `<span class="sidebar-notif-badge">${displayCount}</span>`;
    }

    return `
      <button class="sidebar-nav-item${item.active ? ' active' : ''}" data-action="${item.action}">
        <iconify-icon icon="${item.icon}" style="font-size: 18px;"></iconify-icon>
        <span>${item.label}</span>
        ${badgeHtml}
      </button>
    `;
  };

  const container = $('compose-sidebar');
  const composeBody = container?.querySelector('.compose-sidebar-body');
  const bottomFooter = container?.querySelector('.sidebar-footer');

  // Measure available room with more conservative buffers
  const sidebarHeight = container?.clientHeight || window.innerHeight;
  // Header "Feeds" + Primary Items + Extra Padding
  const navTopHeight = 40 + (primaryItems.length * 36);
  const fixedHeight = (composeBody?.clientHeight || 300) + (bottomFooter?.clientHeight || 40) + navTopHeight + 80;
  let remainingHeight = sidebarHeight - fixedHeight;

  // Render top group
  let html = `<div class="sidebar-nav-header">Feeds</div>`;
  html += primaryItems.map(renderItem).join('');

  // Render explore group
  const totalSecondaryHeight = secondaryItems.length * 36 + 30; // 30 for Explore header

  if (remainingHeight >= totalSecondaryHeight) {
    // Everything fits comfortably
    html += `<div class="sidebar-nav-header" style="margin-top:10px;">Explore</div>`;
    html += secondaryItems.map(renderItem).join('');
  } else {
    // Need to split into list + dots menu
    remainingHeight -= 50; // Reserve space for the dots button and its margin

    let headerShown = false;
    const overflowingSecondary = [];

    secondaryItems.forEach(item => {
      // Check if we can fit the header and this item
      const needed = headerShown ? 36 : (36 + 26);
      if (remainingHeight >= needed) {
        if (!headerShown) {
          html += `<div class="sidebar-nav-header" style="margin-top:10px;">Explore</div>`;
          remainingHeight -= 26;
          headerShown = true;
        }
        html += renderItem(item);
        remainingHeight -= 36;
      } else {
        overflowingSecondary.push(item);
      }
    });

    if (overflowingSecondary.length > 0) {
      html += `
        <div class="sidebar-more-wrapper">
          <button class="sidebar-nav-more-btn" id="sidebar-more-btn" title="More Actions" onclick="event.stopPropagation(); window.toggleSidebarMoreMenu(this)">
            <iconify-icon icon="ph:dots-three-bold" style="font-size: 18px;"></iconify-icon>
          </button>
          <div class="sidebar-more-dropdown" id="sidebar-more-menu">
            ${overflowingSecondary.map(renderItem).join('')}
          </div>
        </div>
      `;
    }
  }

  nav.innerHTML = html;
}

window.toggleSidebarMoreMenu = function (btn) {
  const menu = document.getElementById('sidebar-more-menu');
  if (menu) {
    document.querySelectorAll('.boost-dropdown, .footer-more-dropdown').forEach(m => m.classList.remove('show'));
    menu.classList.toggle('show');
  }
};

window.updateSidebarNav = updateSidebarNav;

document.addEventListener('click', e => {
  if (!e.target.closest('.sidebar-more-wrapper')) {
    document.querySelectorAll('.sidebar-more-dropdown').forEach(m => m.classList.remove('show'));
  }
});

if (window.ResizeObserver) {
  const sidebarEl = $('compose-sidebar');
  if (sidebarEl) {
    new ResizeObserver(() => updateSidebarNav()).observe(sidebarEl);
  }
}

$('sidebar-nav')?.addEventListener('click', e => {
  const item = e.target.closest('.sidebar-nav-item');
  if (!item) return;

  const action = item.dataset.action;

  // Close the menu if an item was clicked
  document.querySelectorAll('.sidebar-more-dropdown').forEach(m => m.classList.remove('show'));

  if (action === 'home') {
    state.feedFilter = 'all';
    updateURLParam('feed', 'all');
  } else if (action === 'following') {
    state.feedFilter = 'following';
    updateURLParam('feed', 'following');
  } else if (action === 'followed-hashtags') {
    state.feedFilter = 'hashtags';
    state.selectedHashtagFilter = 'all';
    updateURLParam('feed', 'hashtags');
  } else if (action === 'local') {
    state.feedFilter = 'live';
    state.exploreSubtab = 'live';
    updateURLParam('explore', 'live');
  } else if (action === 'federated') {
    state.feedFilter = 'federated';
    state.exploreSubtab = 'federated';
    updateURLParam('explore', 'federated');
  } else if (action === 'profile' && state.account) {
    if (window.openProfileDrawer) openProfileDrawer(state.account.id, state.server);
    return;
  } else if (action === 'notifications') {
    if (window.openNotifDrawer) window.openNotifDrawer();
    return;
  } else if (action === 'trending') {
    state.exploreSubtab = 'posts';
    updateURLParam('explore', 'posts');
  } else if (action === 'search') {
    $('search-btn')?.click();
    return;
  } else if (action === 'bookmarks') {
    openBookmarksDrawer();
    return;
  } else if (action === 'hashtags') {
    if (window.openManageHashtagsPanel) window.openManageHashtagsPanel();
    else {
      $('manage-hashtag-drawer')?.classList.add('visible');
      $('manage-hashtag-backdrop')?.classList.add('visible');
    }
    return;
  } else if (action === 'zen') {
    state.zenMode = !state.zenMode;
    store.set('zen_mode', state.zenMode);
    applyZenMode();
    import('./ui.js').then(m => m.showToast(state.zenMode ? 'Zen Mode enabled' : 'Zen Mode disabled'));
    return;
  }

  // Determine target tab
  const feedActions = ['home', 'following', 'followed-hashtags'];
  const targetTab = feedActions.includes(action) ? 'feed' : 'explore';

  // Hashtag filter bar visibility
  const filterBar = $('hashtag-filter-bar');
  if (filterBar) filterBar.style.display = (state.feedFilter === 'hashtags') ? '' : 'none';

  switchToTab(targetTab);
});

const _desktopMenuToggle = $('settings-desktop-menu-toggle');
if (_desktopMenuToggle) {
  _desktopMenuToggle.checked = state.desktopMenu;
  _desktopMenuToggle.addEventListener('change', () => {
    state.desktopMenu = _desktopMenuToggle.checked;
    store.set('pref_desktop_menu', state.desktopMenu ? 'true' : 'false');
    triggerPush();
    updateSidebarNav();
    showToast(state.desktopMenu ? 'Sidebar navigation enabled' : 'Sidebar navigation disabled');
  });
}
updateSidebarNav();

// Translation language wrapper
const _translateLangSel = $('settings-translate-lang');
if (_translateLangSel) {
  _translateLangSel.addEventListener('change', () => {
    store.set('pref_translate_lang', _translateLangSel.value);
  });
}

// Feed language filter
const _feedLangSel = $('settings-feed-lang');
if (_feedLangSel) {
  _feedLangSel.addEventListener('change', () => {
    const val = _feedLangSel.value;
    store.set('pref_feed_lang', val);
    state.preferredLanguage = val;
    // Reload feed to apply new filter
    loadFeedTab();
    showToast.success(val === 'all' ? 'Showing all languages' : `Filtering by: ${val.toUpperCase()}`);
  });
}

// Posting Defaults
const _postVisSel = $('settings-post-visibility');
const _postQuoteSel = $('settings-post-quote');

const updatePostQuoteEnabled = () => {
  if (!_postVisSel || !_postQuoteSel) return;
  const vis = _postVisSel.value;
  const quoteGroup = $('settings-post-quote-group');
  if (vis === 'private' || vis === 'direct') {
    _postQuoteSel.value = 'nobody';
    if (quoteGroup) {
      quoteGroup.classList.add('disabled');
      quoteGroup.querySelectorAll('.theme-segment-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === 'nobody');
      });
    }
  } else {
    if (quoteGroup) quoteGroup.classList.remove('disabled');
  }
};

if (_postVisSel) {
  _postVisSel.addEventListener('change', () => {
    store.set('pref_post_visibility', _postVisSel.value);
    updatePostQuoteEnabled();
    store.set('pref_post_quote', _postQuoteSel.value); // Re-save quote since it might have changed
    showToast.success('Default visibility updated');
    refreshComposeDefaults();
  });
}

if (_postQuoteSel) {
  document.querySelectorAll('#settings-post-quote-group .theme-segment-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const quoteGroup = $('settings-post-quote-group');
      if (quoteGroup && quoteGroup.classList.contains('disabled')) return;

      const val = e.currentTarget.dataset.value;
      _postQuoteSel.value = val;
      document.querySelectorAll('#settings-post-quote-group .theme-segment-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');

      store.set('pref_post_quote', val);
      showToast.success('Default quote permission updated');
      refreshComposeDefaults();
    });
  });
}

// Ensure initial state is correct when opening settings
if ($('settings-menu-btn')) {
  $('settings-menu-btn').addEventListener('click', () => {
    setTimeout(updatePostQuoteEnabled, 0);
  });
}

const _postLangSel = $('settings-post-lang');
if (_postLangSel) {
  _postLangSel.addEventListener('change', () => {
    store.set('pref_post_lang', _postLangSel.value);
    triggerPush();
    showToast.success('Default posting language updated');
    refreshComposeDefaults();
  });
}

const _alwaysSensitiveToggle = $('settings-always-sensitive-toggle');
if (_alwaysSensitiveToggle) {
  _alwaysSensitiveToggle.addEventListener('change', () => {
    store.set('pref_always_sensitive', _alwaysSensitiveToggle.checked ? 'true' : 'false');
    triggerPush();
    showToast.success(_alwaysSensitiveToggle.checked ? 'Always mark media as sensitive' : 'Media sensitivity reset to default');
    refreshComposeDefaults();
  });
}

// Debug: Clear Account Settings
$('debug-clear-sync')?.addEventListener('click', () => {
  clearAccountSettings();
});

// Debug: View Raw Account Note
$('debug-view-note')?.addEventListener('click', async () => {
  try {
    const note = await getAccountNote();
    if (!note) {
      alert('Note is empty');
      return;
    }

    const usage = extractBlock(note, '--- ELEFEED USAGE START ---', '--- ELEFEED USAGE END ---');
    const settings = extractBlock(note, '--- ELEFEED SETTINGS START ---', '--- ELEFEED SETTINGS END ---');

    let displayStr = '';

    if (usage) {
      displayStr += '--- USAGE DATA ---\n' + JSON.stringify(usage, null, 2) + '\n\n';
    }
    if (settings) {
      displayStr += '--- SETTINGS DATA ---\n' + JSON.stringify(settings, null, 2) + '\n\n';
    }

    if (!displayStr) displayStr = 'No Elefeed data blocks found in note.';

    console.log('[Debug] Account Note Content:', { raw: note, usage, settings });
    alert(displayStr);
  } catch (err) {
    alert('Failed to fetch note: ' + err.message);
  }
});

// Android Alarm Permission handling
const alarmBtn = $('settings-android-alarm-btn');
if (alarmBtn) {
  alarmBtn.addEventListener('click', () => {
    if (window.AndroidBridge) {
      window.AndroidBridge.postMessage(JSON.stringify({
        type: "requestAlarmPermission"
      }));
      store.set('pref_android_alarm_seen', 'true');
    }
  });
}

/* Logout */
$('logout-btn').addEventListener('click', () => {
  if (state.activeAccountId) {
    window.handleRemoveAccount(state.activeAccountId);
  } else {
    // Fallback for cases where no account is active
    store.del('token');
    store.del('server');
    location.reload();
  }
});

/* ══════════════════════════════════════════════════════════════════════
   SCROLL / WHEEL / TOUCH
   ══════════════════════════════════════════════════════════════════════ */

/* ── Shortcut Keys ──────────────────────────────────────────────────── */

document.addEventListener('keydown', e => {
  // Ctrl+Alt+N → Trigger latest notification preview
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    showLatestNotifToast();
  }
});

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
  updateSidebarNav();
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

$('thread-close-btn').addEventListener('click', wrapDrawerClose(closeThreadDrawer));
$('thread-backdrop').addEventListener('click', wrapDrawerClose(closeThreadDrawer));
$('thread-back-btn').addEventListener('click', wrapDrawerClose(closeThreadDrawer));

import { closeFollowingDrawer } from './profile.js';
$('following-close').addEventListener('click', wrapDrawerClose(closeFollowingDrawer));
$('following-backdrop').addEventListener('click', wrapDrawerClose(closeFollowingDrawer));

$('post-analytics-close')?.addEventListener('click', wrapDrawerClose(closePostAnalyticsDrawer));
$('post-analytics-backdrop')?.addEventListener('click', wrapDrawerClose(closePostAnalyticsDrawer));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.body.classList.contains('thread-inline-active') || $('thread-drawer').classList.contains('open')) {
      closeThreadDrawer();
    } else if ($('following-drawer').classList.contains('open')) {
      closeFollowingDrawer();
    } else {
      closeProfileDrawer();
      closeComposeDrawer();
    }
    setTimeout(setOverlayPillVisibility, 10);
  }
});
// Hide pill when any drawer opens (immediate, no delay)
['notif-drawer', 'thread-drawer', 'profile-drawer', 'compose-drawer', 'search-drawer', 'post-analytics-drawer', 'following-drawer'].forEach(id => {
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
  /* 0. Special handling for standard links to avoid catch-all interactions */
  const link = e.target.closest('a');
  if (link && !link.hasAttribute('data-profile-id') && !link.hasAttribute('data-trending-tag') && !link.classList.contains('hashtag') && !link.classList.contains('show-more-btn')) {
    // If it's a standard link, let the browser handle it (nav to href).
    // We return early so we don't accidentally preventDefault() it later.
    return;
  }

  /* Follow / unfollow */
  const followBtn = e.target.closest('.profile-follow-btn[data-account-id]');
  if (followBtn) { e.preventDefault(); closeAllProfileMoreMenus(); handleFollowToggle(followBtn); return; }


  /* Notify toggle */
  const notifyBtn = e.target.closest('.profile-notify-btn');
  if (notifyBtn) { e.preventDefault(); closeAllProfileMoreMenus(); handleNotifyToggle(notifyBtn); return; }

  /* Following button click */
  const followingBtn = e.target.closest('#profile-following-btn');
  if (followingBtn) { 
    e.preventDefault(); 
    import('./profile.js').then(m => m.openFollowingDrawer(followingBtn.dataset.accountId, followingBtn.dataset.server)); 
    return; 
  }

  /* Followers button click */
  const followersBtn = e.target.closest('#profile-followers-btn');
  if (followersBtn) {
    e.preventDefault();
    import('./profile.js').then(m => m.openFollowersDrawer(followersBtn.dataset.accountId, followersBtn.dataset.server));
    return;
  }

  /* Profile avatar / name → open profile drawer */
  const trigger = e.target.closest('[data-profile-id]');
  if (trigger) {
    if (e.target.closest('.profile-follow-btn') || e.target.closest('.profile-notify-btn')) return;
    e.preventDefault();
    closeComposeDrawer();
    import('./profile.js').then(m => m.closeFollowingDrawer());
    const profileDrawer = $('profile-drawer');
    openProfileDrawer(trigger.dataset.profileId, trigger.dataset.profileServer);
    return;
  }

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

  /* Boost button (opens dropdown or boosts directly) */
  const boostBtn = e.target.closest('.post-boost-btn');
  if (boostBtn) {
    e.preventDefault();
    e.stopPropagation();
    if (store.get('pref_combine_boost_quote') !== 'true') {
      const postId = boostBtn.dataset.postId;
      const isBoosted = boostBtn.classList.contains('boosted');
      window.handleBoostSubmit(postId, isBoosted, boostBtn);
    } else {
      window.toggleBoostMenu(boostBtn.dataset.postId, boostBtn);
    }
    return;
  }

  /* Quote button (only when separate) */
  const quoteBtn = e.target.closest('.post-quote-btn');
  if (quoteBtn) {
    e.preventDefault();
    e.stopPropagation();
    window.handleQuoteInit(quoteBtn.dataset.postId, quoteBtn.dataset.acct, quoteBtn);
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
    document.querySelectorAll('.boost-dropdown').forEach(m => m.classList.remove('show'));
    if (boostItem.dataset.action === 'boost') {
      window.handleBoostSubmit(boostItem.dataset.postId, boostItem.dataset.isBoosted === 'true', boostItem);
    } else if (boostItem.dataset.action === 'quote') {
      window.handleQuoteInit(boostItem.dataset.postId, boostItem.dataset.acct, boostItem);
    } else if (boostItem.dataset.action === 'edit') {
      window.handleEditInit(boostItem.dataset.postId);
    } else if (boostItem.dataset.action === 'delete') {
      window.handleDeleteInit(boostItem.dataset.postId, boostItem);
    } else if (boostItem.dataset.action === 'delete-redraft') {
      window.handleDeleteRedraftInit(boostItem.dataset.postId, boostItem);
    } else if (boostItem.dataset.action === 'mute-conversation') {
      window.handleMuteConversationToggle(boostItem.dataset.postId, boostItem.dataset.muted === 'true', boostItem);
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
    history.replaceState({ scrollAnchor: getScrollAnchor() }, '');
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
    history.replaceState({ scrollAnchor: getScrollAnchor() }, '');
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
    loadFeedTab();
    return; // ← added so we don't fall through to the article handler
  }

  /* Post article click → open thread */
  // List of selectors that should NOT trigger opening the full thread.
  const INTERACTIVE = 'a, a *, button, button *, input, select, textarea, [data-profile-id], [data-profile-id] *, .post-footer, .post-footer *, .cw-wrapper, .cw-wrapper *, .post-quote, .post-quote *, .media-item, .media-item *, .post-poll, .post-poll *, .boost-dropdown, .tab-dropdown-item, video, .sensitive-overlay, .sensitive-pill, .hashtag, .hashtag *, [onclick]';
  const postArticle = e.target.closest('article.post');
  if (postArticle && !e.target.closest(INTERACTIVE) && !e.target.closest('.thread-drawer, .thread-inline-panel, .post-analytics-drawer')) {
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
   USER HOVER CARD (desktop only)
   ══════════════════════════════════════════════════════════════════════ */

const _hoverCardCache = new Map(); // accountId → { account, relationship, ts }
const HOVER_CARD_TTL = 2 * 60 * 1000;

let _hoverShowTimer = null;
let _hoverHideTimer = null;
let _hoverCurrentId = null;
let _hoverCurrentServer = null;

function _hoverIsDesktop() {
  return window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 768px)').matches;
}

function _positionHoverCard(card, triggerRect) {
  const W = 300;
  const margin = 10;
  let left = triggerRect.left + triggerRect.width / 2 - W / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - W - margin));
  const cardH = card.offsetHeight || 180;
  let top = triggerRect.bottom + 6;
  if (top + cardH > window.innerHeight - margin) {
    top = triggerRect.top - cardH - 6;
  }
  card.style.left = left + 'px';
  card.style.top = top + 'px';
}

async function _showHoverCard(accountId, server, triggerRect) {
  const card = document.getElementById('user-hover-card');
  if (!card) return;

  // Don't show card for the logged-in user's own posts
  if (state.account && accountId === state.account.id) return;

  _hoverCurrentId = accountId;
  _hoverCurrentServer = server;

  // Show skeleton immediately
  card.innerHTML = `
    <div class="hover-card-inner hover-card-loading">
      <div class="hover-card-skel-avatar"></div>
      <div class="hover-card-skel-lines">
        <div class="hover-card-skel-line w-60"></div>
        <div class="hover-card-skel-line w-40"></div>
      </div>
    </div>`;
  _positionHoverCard(card, triggerRect);
  card.setAttribute('aria-hidden', 'false');
  card.classList.add('visible');

  // Use cache or fetch fresh
  let cached = _hoverCardCache.get(accountId);
  if (!cached || (Date.now() - cached.ts) > HOVER_CARD_TTL) {
    try {
      const [account, relationships] = await Promise.all([
        apiGet(`/api/v1/accounts/${accountId}`, state.token, server),
        apiGet(`/api/v1/accounts/relationships?id[]=${accountId}`, state.token, server).catch(() => []),
      ]);
      cached = { account, relationship: relationships[0] || null, ts: Date.now() };
      _hoverCardCache.set(accountId, cached);
    } catch {
      if (_hoverCurrentId !== accountId) return;
      card.innerHTML = `<div class="hover-card-inner" style="padding:16px;font-size:13px;color:var(--text-muted);">Could not load profile.</div>`;
      return;
    }
  }

  if (_hoverCurrentId !== accountId) return;

  const { account, relationship } = cached;
  const isFollowing = !!(relationship && relationship.following);
  const isFollowedBy = !!(relationship && relationship.followed_by);
  const isRequested = !!(relationship && relationship.requested);
  const isBlocked = !!(relationship && relationship.blocking);
  const isMuted = !!(relationship && relationship.muting);

  const displayName = renderCustomEmojis(account.display_name || account.username, account.emojis);
  const bioText = account.note ? account.note.replace(/<[^>]+>/g, '').trim() : '';

  const followBtnClass = `profile-follow-btn hover-card-follow-btn${isFollowing ? ' following' : ''}${isRequested ? ' requested' : ''}`;
  const followBtnText = isBlocked ? 'Blocked' : isMuted ? 'Muted' : isFollowing ? 'Following' : (isRequested ? 'Requested' : 'Follow');

  card.innerHTML = `
    <div class="hover-card-inner">
      <div class="hover-card-header">
        <img class="hover-card-avatar"
          src="${escapeHTML(account.avatar_static || account.avatar)}"
          alt=""
          onerror="this.onerror=null;this.src=window._AVATAR_PLACEHOLDER" />
        <button class="${followBtnClass}"
          data-account-id="${escapeHTML(accountId)}"
          data-following="${isFollowing ? 'true' : 'false'}"
          ${isBlocked || isMuted ? 'disabled' : ''}>
          <iconify-icon icon="${isFollowing ? 'ph:user-check-bold' : 'ph:user-plus-bold'}" style="font-size: 13px; margin-right: 4px; vertical-align: -2px;"></iconify-icon>
          <span>${escapeHTML(followBtnText)}</span>
        </button>
      </div>
      <div class="hover-card-name">${displayName}</div>
      <div class="hover-card-acct">@${escapeHTML(account.acct)}</div>
      ${isFollowedBy ? '<div class="hover-card-follows-you">Follows you</div>' : ''}
      ${bioText ? `<div class="hover-card-bio">${escapeHTML(bioText)}</div>` : ''}
      <div class="hover-card-stats">
        <div class="hover-card-stat">
          <span class="hover-card-stat-num">${formatNum(account.statuses_count)}</span>
          <span class="hover-card-stat-label"> Posts</span>
        </div>
        <div class="hover-card-stat">
          <span class="hover-card-stat-num">${formatNum(account.following_count)}</span>
          <span class="hover-card-stat-label"> Following</span>
        </div>
        <div class="hover-card-stat">
          <span class="hover-card-stat-num">${formatNum(account.followers_count)}</span>
          <span class="hover-card-stat-label"> Followers</span>
        </div>
      </div>
    </div>`;

  // Re-position now that we have real dimensions
  _positionHoverCard(card, triggerRect);
}

function _dismissHoverCard() {
  _hoverCurrentId = null;
  const card = document.getElementById('user-hover-card');
  if (card) {
    card.classList.remove('visible');
    card.setAttribute('aria-hidden', 'true');
  }
}

// Mouseover delegation - start show timer when entering a name/avatar trigger
document.addEventListener('mouseover', e => {
  if (!_hoverIsDesktop()) return;
  const trigger = e.target.closest('[data-profile-id]');
  if (!trigger) return;

  // Disable user profile popups in certain contexts where they are redundant or intrusive
  if (trigger.closest('.trending-person-card') || trigger.closest('.following-drawer') || trigger.closest('.condensed-reply-wrapper') || trigger.closest('.full-reply-card')) return;

  const accountId = trigger.dataset.profileId;
  const server = trigger.dataset.profileServer || state.server;

  // Already showing this card - cancel any pending hide
  if (_hoverCurrentId === accountId) {
    clearTimeout(_hoverHideTimer);
    return;
  }

  clearTimeout(_hoverHideTimer);
  clearTimeout(_hoverShowTimer);

  _hoverShowTimer = setTimeout(() => {
    const rect = trigger.getBoundingClientRect();
    _showHoverCard(accountId, server, rect);
  }, 350);
});

// Mouseout delegation - start hide timer when leaving a trigger
document.addEventListener('mouseout', e => {
  if (!_hoverIsDesktop()) return;
  const trigger = e.target.closest('[data-profile-id]');
  if (!trigger) return;
  // Ignore if still within the same trigger element
  if (trigger.contains(e.relatedTarget)) return;
  // Ignore if moving into the card
  const card = document.getElementById('user-hover-card');
  if (card && card.contains(e.relatedTarget)) return;

  clearTimeout(_hoverShowTimer);
  _hoverHideTimer = setTimeout(_dismissHoverCard, 250);
});

// Keep card alive while cursor is on it
const _hoverCardEl = document.getElementById('user-hover-card');
if (_hoverCardEl) {
  _hoverCardEl.addEventListener('mouseenter', () => {
    clearTimeout(_hoverHideTimer);
    clearTimeout(_hoverShowTimer);
  });
  _hoverCardEl.addEventListener('mouseleave', () => {
    _hoverHideTimer = setTimeout(_dismissHoverCard, 250);
  });
  // Click on card body (not follow btn) → open profile drawer
  _hoverCardEl.addEventListener('click', e => {
    if (e.target.closest('.profile-follow-btn')) return;
    if (!_hoverCurrentId) return;
    const id = _hoverCurrentId;
    const server = _hoverCurrentServer || state.server;
    _dismissHoverCard();
    openProfileDrawer(id, server);
  });
}

// Dismiss hover card when any drawer opens
document.addEventListener('click', e => {
  if (e.target.closest('.profile-follow-btn.hover-card-follow-btn')) {
    // Invalidate cache for this account so next hover re-fetches updated relationship
    const btn = e.target.closest('.profile-follow-btn.hover-card-follow-btn');
    if (btn) _hoverCardCache.delete(btn.dataset.accountId);
  }
}, true);

/* ══════════════════════════════════════════════════════════════════════
   NETWORK STATUS
   ══════════════════════════════════════════════════════════════════════ */

window.addEventListener('offline', () => $('offline-bar').classList.add('visible'));
window.addEventListener('online', () => $('offline-bar').classList.remove('visible'));

/* ══════════════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════════════ */


async function boot() {

  // Wire up component init functions
  registerNotifPoller(pollNotifications, pollBackgroundAccounts);
  initCompose();
  initNotifications();
  initSearch();

  // Apply saved font preferences (safety call in case index.html script was bypassed)
  applyFont(store.get('pref_font_family') || 'sans');
  applyFontSize(store.get('pref_font_size') || '14px');

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
    history.replaceState({ scrollAnchor: getScrollAnchor() }, '');
    history.pushState({}, '', _searchNext);

    state.selectedHashtagFilter = tag;
    state.feedFilter = 'hashtags';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'feed'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-feed'));
    document.querySelectorAll('#tab-dropdown-feed .tab-dropdown-item').forEach(b => b.classList.toggle('active', b.dataset.filter === 'hashtags'));
    $('hashtag-filter-bar').style.display = '';
    state.activeTab = 'feed';
    updateTabLabel('feed');
    updateSidebarNav();
    closeProfileDrawer();
    closeThreadDrawer();
    closeComposeDrawer();
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

  // Detect file:// - OAuth popups need a real HTTP origin
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

  // Load account registry
  let accounts = getStoredAccounts();
  let activeId = getActiveAccountId();

  // Migration: If no accounts but legacy token exists, migrate it
  const legacyToken = store.get('token');
  const legacyServer = store.get('server');
  if (accounts.length === 0 && legacyToken && legacyServer) {
    console.log('[Elefeed] Migrating legacy account to registry...');
    // We don't have accountData yet, initApp will fetch it and save to registry
    await initApp(legacyServer, legacyToken);
    return;
  }

  if (accounts.length > 0) {
    state.accounts = accounts;
    let target = accounts.find(a => a.id === activeId) || accounts[0];
    state.activeAccountId = target.id;
    setActiveAccountId(target.id);
    await initApp(target.server, target.token);
    return;
  }

  if (accounts.length === 0) {
    $('login-back-btn').style.display = 'none';
  } else {
    $('login-back-btn').style.display = 'block';
  }
  showScreen('login-screen');
}

boot().catch(err => {
  console.error('Boot error:', err);
  showScreen('login-screen');
});
