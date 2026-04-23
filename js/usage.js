import { $, state, store } from './state.js';
import { apiGet, apiPost } from './api.js';
import { showToast } from './ui.js';

let _activeStartTime = null;
let _saveInterval = null;
let _uiInterval = null;
let _sessionMsAccumulator = 0; // Tracks milliseconds between focus/blur to prevent data loss
const MARKER_START = '--- ELEFEED USAGE START ---';
const MARKER_END = '--- ELEFEED USAGE END ---';
let _isDismissed = false; // Local flag to allow reappearance on refresh

/**
 * Initializes usage tracking if enabled in settings.
 */
export async function initUsageTracking() {
  const enabled = store.get('pref_usage_tracking') === 'true';
  if (enabled) {
    startTracking();
    await pullUsageData();
  }
}

/**
 * Pulls usage data from the server and merges it with local data.
 */
export async function pullUsageData() {
  if (state.demoMode || !state.account || !state.token) return;

  try {
    const rels = await apiGet(`/api/v1/accounts/relationships?id[]=${state.account.id}`);
    const currentNote = (rels && rels[0]) ? (rels[0].note || '') : '';

    if (currentNote.includes(MARKER_START)) {
      const startIdx = currentNote.indexOf(MARKER_START);
      const endIdx = currentNote.indexOf(MARKER_END);
      if (endIdx !== -1) {
        const jsonStr = currentNote.substring(startIdx + MARKER_START.length, endIdx);
        try {
          const remoteStats = JSON.parse(jsonStr);
          const localStatsRaw = store.get('usage_stats');
          let localStats = {};
          try { localStats = JSON.parse(localStatsRaw) || {}; } catch (e) {}

          // Merge: server wins for past days, but we keep today's local progress
          const merged = { ...remoteStats, ...localStats };
          const today = new Date().toISOString().split('T')[0];
          if (remoteStats[today] && localStats[today]) {
             merged[today] = Math.max(remoteStats[today], localStats[today]);
          }
          
          store.set('usage_stats', JSON.stringify(merged));
          renderUsageUI();
        } catch (e) {
          console.error('[Usage] Failed to parse remote stats:', e);
        }
      }
    }
  } catch (err) {
    console.error('[Usage] Pull failed:', err);
  }
}

/**
 * Starts the tracking timers and listeners.
 */
export function startTracking() {
  if (_activeStartTime) return;
  _activeStartTime = Date.now();

  window.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', stopTimer);
  window.addEventListener('focus', startTimer);

  // Sync every 5 minutes to server
  _saveInterval = setInterval(syncUsage, 5 * 60 * 1000);
  
  // Update the UI display every 5 seconds so it feels "live"
  _uiInterval = setInterval(renderUsageUI, 5 * 1000);
  
  renderUsageUI();
}

/**
 * Stops tracking and cleans up.
 */
export function stopTracking() {
  stopTimer();
  window.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('blur', stopTimer);
  window.removeEventListener('focus', startTimer);
  if (_saveInterval) clearInterval(_saveInterval);
  if (_uiInterval) clearInterval(_uiInterval);
  _saveInterval = null;
  _uiInterval = null;
  removeUsageUI();
}

function startTimer() {
  if (!_activeStartTime && document.visibilityState === 'visible') {
    _activeStartTime = Date.now();
  }
}

function stopTimer() {
  if (_activeStartTime) {
    const elapsed = Date.now() - _activeStartTime;
    updateLocalUsage(elapsed);
    _activeStartTime = null;
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    startTimer();
  } else {
    stopTimer();
    syncUsage();
  }
}

/**
 * Updates the daily total in localStorage.
 */
function updateLocalUsage(ms) {
  if (ms <= 0) return;
  const today = new Date().toISOString().split('T')[0];
  const statsRaw = store.get('usage_stats');
  let stats = {};
  try { stats = JSON.parse(statsRaw) || {}; } catch (e) { stats = {}; }

  stats[today] = (stats[today] || 0) + ms;
  store.set('usage_stats', JSON.stringify(stats));
  renderUsageUI();
}

/**
 * Synchronizes local usage data with the Mastodon account note.
 * Uses the private relationship note on the user's own account.
 */
export async function syncUsage() {
  if (state.demoMode || !state.account || !state.token) return;
  
  // If currently active, add the current session's time before syncing
  let msToSync = 0;
  if (_activeStartTime) {
    msToSync = Date.now() - _activeStartTime;
    updateLocalUsage(msToSync);
    _activeStartTime = Date.now(); // Reset start for next slice
  }

  const statsRaw = store.get('usage_stats');
  if (!statsRaw) return;

  try {
    const rels = await apiGet(`/api/v1/accounts/relationships?id[]=${state.account.id}`);
    const currentNote = (rels && rels[0]) ? (rels[0].note || '') : '';

    const statsData = JSON.parse(statsRaw);
    const keys = Object.keys(statsData).sort().reverse();
    const prunedStats = {};
    keys.slice(0, 7).forEach(k => prunedStats[k] = statsData[k]);
    
    const jsonStr = JSON.stringify(prunedStats);
    const usageBlock = `${MARKER_START}${jsonStr}${MARKER_END}`;

    let newNote = '';
    if (currentNote.includes(MARKER_START)) {
      const startIdx = currentNote.indexOf(MARKER_START);
      const endIdx = currentNote.indexOf(MARKER_END);
      if (endIdx !== -1) {
        newNote = currentNote.substring(0, startIdx) + usageBlock + currentNote.substring(endIdx + MARKER_END.length);
      } else {
        newNote = currentNote.trim() + '\n' + usageBlock;
      }
    } else {
      newNote = (currentNote.trim() + '\n' + usageBlock).trim();
    }

    await apiPost(`/api/v1/accounts/${state.account.id}/note`, { comment: newNote });
  } catch (err) {
    console.error('[Usage] Sync failed:', err);
  }
}

/**
 * Renders the usage reminder at the top of the feed.
 */
export function renderUsageUI() {
  const enabled = store.get('pref_usage_tracking') === 'true';
  if (!enabled) return;

  let container = $('usage-note-container');
  if (!container) {
    // If user dismissed it this session, don't recreate it until a refresh
    if (_isDismissed) return;

    const feedCont = $('feed-container');
    if (!feedCont) return;
    container = document.createElement('article');
    container.id = 'usage-note-container';
    container.className = 'post usage-note-banner';
    feedCont.prepend(container);
  }

  const today = new Date().toISOString().split('T')[0];
  const statsRaw = store.get('usage_stats');
  let stats = {};
  try { stats = JSON.parse(statsRaw) || {}; } catch (e) { stats = {}; }
  
  let ms = stats[today] || 0;
  if (_activeStartTime) {
    ms += (Date.now() - _activeStartTime);
  }

  // Don't show if less than 1 second (prevents flash on empty state but gives immediate feedback)
  if (ms < 1000) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;

  let timeStr = '';
  if (hrs > 0) timeStr += `${hrs}h `;
  timeStr += `${remainingMins}m`;

  container.innerHTML = `
    <div class="post-content">
      <div class="usage-note-text">
        Logged in today for: ${timeStr}
      </div>
    </div>
    <button class="usage-note-close" aria-label="Dismiss" onclick="import('./js/usage.js').then(m => m.resetUsageDismissal(true)); this.closest('.usage-note-banner').remove();">
      <iconify-icon icon="ph:x-bold" style="font-size: 10px;"></iconify-icon>
    </button>
  `;
}







export function resetUsageDismissal(val = false) {
  _isDismissed = val;
  if (!val) renderUsageUI();
}

export function removeUsageUI() {
  const container = $('usage-note-container');
  if (container) container.remove();
}
