import { $, state, store } from './state.js';
import { getAccountNote, extractBlock, updateBlockInNote, removeBlockFromNote, saveAccountNote } from './sync.js';
import { showToast, showConfirm } from './ui.js';

const MARKER_START = '--- ELEFEED SETTINGS START ---';
const MARKER_END = '--- ELEFEED SETTINGS END ---';

let _initialized = false;
let _isSyncing = false;
let _pushTimeout = null;
let _hasPrompted = false;

export async function initSettingsSync() {
  const enabled = store.get('pref_sync_settings') === 'true';
  
  if (!_initialized) {
    _initialized = true;
    window.addEventListener('focus', () => {
      if (store.get('pref_sync_settings') === 'true') {
        initSettingsSync();
      }
    });
  }

  console.log('[SettingsSync] Checking for updates...');
  const note = await getAccountNote();
  const remoteData = extractBlock(note, MARKER_START, MARKER_END);
  
  console.log('[SettingsSync] Status - Enabled:', enabled, 'Has Prompted:', _hasPrompted);
  if (remoteData) {
    console.log('[SettingsSync] Remote settings found. Updated at:', new Date(remoteData.updatedAt).toLocaleString());
  }

  if (enabled) {
    if (remoteData) {
      await mergeSettings(remoteData);
    } else {
      await pushSettings();
    }
  } else if (remoteData) {
    // Sync is OFF but data exists on server - ask the user if they want to enable it
    const alreadyDismissed = store.get('pref_sync_onboarding_dismissed') === 'true';
    if (!_hasPrompted && !alreadyDismissed) {
      console.log('[SettingsSync] Remote settings available. Preparing prompt...');
      _hasPrompted = true; 
      
      setTimeout(async () => {
        const modal = $('sync-conflict-modal');
        if (!modal) {
          console.error('[SettingsSync] Cannot prompt: sync-conflict-modal not found in DOM');
          return;
        }

        console.log('[SettingsSync] Showing sync conflict dialog...');
        const confirmed = await showSyncConflictDialog(remoteData);
        
        if (confirmed) {
          if (confirmed === 'server') {
            applySettings(remoteData.prefs);
            store.set('pref_sync_settings', 'true');
            store.set('pref_sync_last_at', remoteData.updatedAt);
            showToast('Sync enabled', 'success');
          } else if (confirmed === 'local') {
            store.set('pref_sync_settings', 'true');
            await pushSettings();
            showToast('Sync enabled', 'success');
          }
        } else {
          // Configure later: Save dismissal to localStorage so we don't prompt again on this device
          store.set('pref_sync_onboarding_dismissed', 'true');
          console.log('[SettingsSync] User chose to configure later. Silencing prompt.');
        }
      }, 1500);
    }
  }
}

export async function pushSettings() {
  if (state.demoMode || !state.account || _isSyncing) return;
  try {
    _isSyncing = true;
    const prefs = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('pref_') || key === 'theme' || key === 'zen_mode') {
        prefs[key] = localStorage.getItem(key);
      }
    }
    const data = { updatedAt: Date.now(), prefs };
    const note = await getAccountNote();
    const newNote = updateBlockInNote(note, MARKER_START, MARKER_END, data);
    await saveAccountNote(newNote);
    store.set('pref_sync_last_at', data.updatedAt);
  } catch (err) {
    console.error('[SettingsSync] Push failed:', err);
  } finally {
    _isSyncing = false;
  }
}

export function triggerPush() {
  const enabled = store.get('pref_sync_settings') === 'true';
  if (!enabled) return;
  if (_pushTimeout) clearTimeout(_pushTimeout);
  _pushTimeout = setTimeout(() => pushSettings(), 2000);
}

async function mergeSettings(remoteData) {
  const localLastAt = parseInt(store.get('pref_sync_last_at') || '0');
  const remoteLastAt = remoteData.updatedAt || 0;
  console.log(`[SettingsSync] Merging - Remote: ${remoteLastAt}, Local: ${localLastAt}`);
  if (remoteLastAt > localLastAt) {
    applySettings(remoteData.prefs);
    store.set('pref_sync_last_at', remoteLastAt);
  } else if (remoteLastAt < localLastAt) {
    await pushSettings();
  }
}

function applySettings(prefs) {
  if (!prefs) return;
  const changedKeys = [];
  Object.keys(prefs).forEach(key => {
    if (store.get(key) !== prefs[key]) {
      store.set(key, prefs[key]);
      changedKeys.push(key);
    }
  });

  if (changedKeys.length === 0) {
    console.log('[SettingsSync] No changes detected in remote settings.');
    return;
  }

  console.log('[SettingsSync] Applying changed keys:', changedKeys);

  changedKeys.forEach(key => {
    switch (key) {
      case 'theme':
        if (window.applyTheme) window.applyTheme(prefs[key]);
        break;
      case 'pref_palette':
        if (window.applyPalette) window.applyPalette(prefs[key]);
        break;
      case 'pref_font_family':
        if (window.applyFont) window.applyFont(prefs[key]);
        break;
      case 'pref_font_size':
        if (window.applyFontSize) window.applyFontSize(prefs[key]);
        break;
      case 'zen_mode':
        state.zenMode = (prefs[key] === 'true');
        if (window.applyZenMode) window.applyZenMode();
        break;
      case 'pref_hide_cards':
        document.body.classList.toggle('hide-cards-enabled', prefs[key] === 'true');
        break;
      case 'pref_hashtag_pills':
        document.body.classList.toggle('hashtag-pills-enabled', prefs[key] === 'true');
        break;
      case 'pref_desktop_menu':
        state.desktopMenu = (prefs[key] === 'true');
        if (window.updateSidebarNav) window.updateSidebarNav();
        break;
      case 'pref_giphy_enabled':
        state.giphyEnabled = (prefs[key] === 'true');
        import('./giphy.js').then(m => m.updateGiphyVisibility());
        break;
      case 'pref_feed_lang':
        state.preferredLanguage = prefs[key];
        if (window.loadFeedTab) window.loadFeedTab();
        break;
      case 'pref_post_visibility':
      case 'pref_post_quote':
      case 'pref_post_lang':
      case 'pref_always_sensitive':
        if (window.refreshComposeDefaults) window.refreshComposeDefaults();
        break;
      case 'pref_clear_urls':
        if (window.loadFeedTab) window.loadFeedTab(false);
        break;
      case 'pref_show_inline_thread':
        state.showInlineThread = (prefs[key] !== 'false');
        break;
    }
  });

  if ($('settings-drawer')?.classList.contains('open')) {
    if (window.refreshNotifSettingsUI) window.refreshNotifSettingsUI();
  }
  showToast('Settings synced from your account', 'success');
}

/**
 * Removes all settings from the server.
 */
export async function clearAccountSettings() {
  const confirmed = await showConfirm(
    'This will remove the settings block from your account note. Your local settings will remain untouched.',
    'Delete stored account settings?',
    'ph:trash-bold'
  );
  if (!confirmed) return;

  try {
    const note = await getAccountNote();
    const newNote = removeBlockFromNote(note, MARKER_START, MARKER_END);
    await saveAccountNote(newNote);
    
    // Disable sync locally to avoid re-uploading
    store.set('pref_sync_settings', 'false');
    store.del('pref_sync_last_at');
    store.del('pref_sync_onboarding_dismissed');
    
    const toggle = $('settings-sync-toggle');
    if (toggle) toggle.checked = false;

    showToast('Account settings cleared.', 'success');
  } catch (err) {
    console.error('[SettingsSync] Clear failed:', err);
    showToast('Failed to clear settings.', 'error');
  }
}

export async function handleSyncToggle(enabled) {
  const syncRow = $('settings-sync-account-row');
  if (!enabled) {
    store.set('pref_sync_settings', 'false');
    if (syncRow) syncRow.style.display = 'none';
    showToast('Settings sync disabled');
    return;
  }
  if (syncRow) syncRow.style.display = 'flex';
  const note = await getAccountNote();
  const remoteData = extractBlock(note, MARKER_START, MARKER_END);
  if (remoteData) {
    const confirmed = await showSyncConflictDialog(remoteData);
    if (confirmed === 'server') {
      applySettings(remoteData.prefs);
      store.set('pref_sync_settings', 'true');
      store.set('pref_sync_last_at', remoteData.updatedAt);
    } else if (confirmed === 'local') {
      store.set('pref_sync_settings', 'true');
      await pushSettings();
    } else {
      const toggle = $('settings-sync-toggle');
      if (toggle) toggle.checked = false;
    }
  } else {
    store.set('pref_sync_settings', 'true');
    await pushSettings();
    showToast('Settings sync enabled');
  }
}

async function showSyncConflictDialog(remoteData) {
  const modal = $('sync-conflict-modal');
  if (!modal) return 'server';
  const serverDate = new Date(remoteData.updatedAt).toLocaleString();
  $('sync-conflict-server-info').textContent = `Saved on: ${serverDate}`;
  modal.style.display = 'flex';
  return new Promise((resolve) => {
    $('sync-conflict-use-server').onclick = () => { modal.style.display = 'none'; resolve('server'); };
    $('sync-conflict-use-local').onclick = () => { modal.style.display = 'none'; resolve('local'); };
    $('sync-conflict-cancel').onclick = () => { modal.style.display = 'none'; resolve(null); };
  });
}
