import { $, state, store } from './state.js';
import { apiGet, apiPost } from './api.js';

let _activeStartTime = null;
let _saveInterval = null;
let _uiInterval = null;

const MARKER_START = '--- ELEFEED USAGE START ---';
const MARKER_END = '--- ELEFEED USAGE END ---';
let _isDismissed = false; // Local flag to allow reappearance on refresh

/**
 * Returns the current date as a YYYY-MM-DD string in the user's local timezone.
 */
function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
          try {
            localStats = JSON.parse(localStatsRaw) || {};
          } catch (e) {
            localStats = {};
          }

          // Filter out any garbage from the parse
          if (typeof remoteStats !== 'object' || remoteStats === null) return;

          // Merge: for every date, the higher value wins to prevent regressions
          const merged = { ...remoteStats, ...localStats };
          Object.keys(remoteStats).forEach(date => {
            if (localStats[date]) {
              merged[date] = Math.max(remoteStats[date], localStats[date]);
            }
          });

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

  // Pull latest from server immediately when enabled
  pullUsageData().then(() => renderUsageUI());

  window.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', stopTimer);
  window.addEventListener('focus', startTimer);

  // Sync every 1 minute to server
  _saveInterval = setInterval(syncUsage, 60 * 1000);

  // Update the UI display every 55 seconds (since sync is every 1 min)
  _uiInterval = setInterval(renderUsageUI, 55 * 1000);

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
    // Pull latest data when coming back to the app to ensure times match other devices
    pullUsageData();
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
  const today = getLocalDateString();
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

  // 1. Accumulate current session slice into local storage
  if (_activeStartTime) {
    const msToSync = Date.now() - _activeStartTime;
    updateLocalUsage(msToSync);
    _activeStartTime = Date.now(); // Reset start for next slice
  }

  try {
    // 2. Fetch remote note to merge before pushing
    const rels = await apiGet(`/api/v1/accounts/relationships?id[]=${state.account.id}`);
    const currentNote = (rels && rels[0]) ? (rels[0].note || '') : '';

    let statsData = {};
    const localStatsRaw = store.get('usage_stats');
    try { statsData = JSON.parse(localStatsRaw) || {}; } catch (e) { statsData = {}; }

    // 3. Extract and merge remote data
    if (currentNote.includes(MARKER_START)) {
      const startIdx = currentNote.indexOf(MARKER_START);
      const endIdx = currentNote.indexOf(MARKER_END);
      if (endIdx !== -1) {
        const jsonStr = currentNote.substring(startIdx + MARKER_START.length, endIdx);
        try {
          const remoteStats = JSON.parse(jsonStr);
          if (typeof remoteStats === 'object' && remoteStats !== null) {
            // Merge: Max wins for all dates to prevent one device overwriting another
            Object.keys(remoteStats).forEach(date => {
              statsData[date] = Math.max(statsData[date] || 0, remoteStats[date]);
            });
            // Save merged back to local storage
            store.set('usage_stats', JSON.stringify(statsData));
            renderUsageUI();
          }
        } catch (e) {
          console.error('[Usage] Failed to parse remote stats during sync:', e);
        }
      }
    }

    // 4. Prune and prepare for server storage (keep last 7 days)
    const keys = Object.keys(statsData).sort().reverse();
    const prunedStats = {};
    keys.slice(0, 7).forEach(k => prunedStats[k] = statsData[k]);

    const usageBlock = `${MARKER_START}${JSON.stringify(prunedStats)}${MARKER_END}`;

    // 5. Construct new note and push
    let newNote = '';
    if (currentNote.includes(MARKER_START)) {
      const startIdx = currentNote.indexOf(MARKER_START);
      const endIdx = currentNote.indexOf(MARKER_END);
      newNote = currentNote.substring(0, startIdx) + usageBlock + currentNote.substring(endIdx + MARKER_END.length);
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

  const today = getLocalDateString();
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
    <div class="usage-note-content">
      <iconify-icon icon="ph:clock-bold" class="usage-note-icon"></iconify-icon>
      <div class="usage-note-text">
        Used Elefeed for ${timeStr} today.
      </div>
    </div>
    <button class="usage-note-close" aria-label="Dismiss" onclick="import('./js/usage.js').then(m => m.resetUsageDismissal(true)); this.closest('.usage-note-banner').remove();">
      <iconify-icon icon="ph:x-bold"></iconify-icon>
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
