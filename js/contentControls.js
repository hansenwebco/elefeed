/**
 * @module contentControls
 * Unified Drawer for managing Blocked Users, Muted Users, and Blocked Domains.
 */

import { $, state } from './state.js';
import { apiGet, apiPost, apiDelete } from './api.js';
import { showToast } from './ui.js';
import { escapeHTML, renderCustomEmojis } from './utils.js';

let activeTab = 'blocked'; // 'blocked', 'muted', 'domains'
let loading = false;

/**
 * Open the Blocks & Mutes drawer.
 */
export async function openBlocksMutesDrawer() {
  const drawer = $('manage-blocks-mutes-drawer');
  const backdrop = $('manage-blocks-mutes-backdrop');
  if (!drawer || !backdrop) return;

  const alreadyOpen = drawer.classList.contains('open');

  drawer.classList.add('open');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (alreadyOpen) return;

  // Update browser history
  const url = new URL(window.location);
  url.searchParams.set('manage_blocks_mutes', 'true');
  window.history.pushState({}, '', url);

  // Default to blocked tab
  await switchBlocksMutesTab('blocked');
}

/**
 * Close the Blocks & Mutes drawer.
 */
export function closeBlocksMutesDrawer() {
  const drawer = $('manage-blocks-mutes-drawer');
  const backdrop = $('manage-blocks-mutes-backdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
  document.body.style.overflow = '';

  const url = new URL(window.location);
  url.searchParams.delete('manage_blocks_mutes');
  window.history.pushState({}, '', url);

  // Reload feed tab so that filtered posts are correctly re-rendered / updated if follows or blocks changed
  if (window.loadFeedTab) {
    window.loadFeedTab(false);
  }
}

/**
 * Switch tabs within the Content Controls drawer.
 */
export async function switchBlocksMutesTab(tabName) {
  activeTab = tabName;

  // Toggle active class on tab buttons
  document.querySelectorAll('.content-controls-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Toggle active panel
  document.querySelectorAll('.content-controls-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === tabName);
  });

  // Load appropriate data
  if (tabName === 'blocked') {
    await loadBlockedUsers();
  } else if (tabName === 'muted') {
    await loadMutedUsers();
  } else if (tabName === 'domains') {
    await loadBlockedDomains();
  }
}

/**
 * Load Blocked Users list from Mastodon API.
 */
async function loadBlockedUsers() {
  if (!state.token) return;
  const container = $('blocked-users-list');
  if (!container) return;

  container.innerHTML = '<div class="control-empty"><div class="spinner"></div><span>Loading blocked users…</span></div>';

  try {
    const blocks = await apiGet('/api/v1/blocks?limit=80');
    
    // Sync to global state
    state.knownBlocking = new Set(blocks.map(u => u.id));

    if (blocks.length === 0) {
      container.innerHTML = `
        <div class="control-empty">
          <iconify-icon icon="ph:prohibit-bold" class="control-empty-icon"></iconify-icon>
          <span>No blocked users yet.</span>
        </div>`;
      return;
    }

    container.innerHTML = blocks.map(u => {
      const displayName = renderCustomEmojis(u.display_name || u.username, u.emojis);
      const serverVal = escapeHTML(state.server || '');
      return `
        <div class="control-item-row" data-user-id="${u.id}">
          <img class="control-avatar" src="${escapeHTML(u.avatar_static || u.avatar)}" alt="" onerror="this.onerror=null;this.src=window._AVATAR_PLACEHOLDER" data-profile-id="${u.id}" data-profile-server="${serverVal}" style="cursor:pointer;" />
          <div class="control-info" data-profile-id="${u.id}" data-profile-server="${serverVal}" style="cursor:pointer;">
            <div class="control-name-wrap">
              <span class="control-display-name">${displayName}</span>
            </div>
            <span class="control-handle">@${escapeHTML(u.acct)}</span>
          </div>
          <button class="control-action-btn" onclick="window.unblockUserFromDrawer('${u.id}', this.closest('.control-item-row'))">
            Unblock
          </button>
        </div>`;
    }).join('');

  } catch (err) {
    console.error('Failed to load blocked users:', err);
    container.innerHTML = `<div class="control-empty" style="color:var(--danger)">Error loading blocked users: ${escapeHTML(err.message)}</div>`;
  }
}

/**
 * Load Muted Users list from Mastodon API.
 */
async function loadMutedUsers() {
  if (!state.token) return;
  const container = $('muted-users-list');
  if (!container) return;

  container.innerHTML = '<div class="control-empty"><div class="spinner"></div><span>Loading muted users…</span></div>';

  try {
    const mutes = await apiGet('/api/v1/mutes?limit=80');

    // Sync to global state
    state.knownMuting = new Set(mutes.map(u => u.id));

    if (mutes.length === 0) {
      container.innerHTML = `
        <div class="control-empty">
          <iconify-icon icon="ph:speaker-slash-bold" class="control-empty-icon"></iconify-icon>
          <span>No muted users yet.</span>
        </div>`;
      return;
    }

    container.innerHTML = mutes.map(u => {
      const displayName = renderCustomEmojis(u.display_name || u.username, u.emojis);
      const serverVal = escapeHTML(state.server || '');
      return `
        <div class="control-item-row" data-user-id="${u.id}">
          <img class="control-avatar" src="${escapeHTML(u.avatar_static || u.avatar)}" alt="" onerror="this.onerror=null;this.src=window._AVATAR_PLACEHOLDER" data-profile-id="${u.id}" data-profile-server="${serverVal}" style="cursor:pointer;" />
          <div class="control-info" data-profile-id="${u.id}" data-profile-server="${serverVal}" style="cursor:pointer;">
            <div class="control-name-wrap">
              <span class="control-display-name">${displayName}</span>
            </div>
            <span class="control-handle">@${escapeHTML(u.acct)}</span>
          </div>
          <button class="control-action-btn" onclick="window.unmuteUserFromDrawer('${u.id}', this.closest('.control-item-row'))">
            Unmute
          </button>
        </div>`;
    }).join('');

  } catch (err) {
    console.error('Failed to load muted users:', err);
    container.innerHTML = `<div class="control-empty" style="color:var(--danger)">Error loading muted users: ${escapeHTML(err.message)}</div>`;
  }
}

/**
 * Load Blocked Domains list from Mastodon API.
 */
async function loadBlockedDomains() {
  if (!state.token) return;
  const container = $('blocked-domains-list');
  if (!container) return;

  container.innerHTML = '<div class="control-empty"><div class="spinner"></div><span>Loading blocked domains…</span></div>';

  try {
    const domains = await apiGet('/api/v1/domain_blocks?limit=100');

    // Sync to global state
    state.knownBlockedDomains = new Set(domains.map(d => d.toLowerCase()));

    if (domains.length === 0) {
      container.innerHTML = `
        <div class="control-empty">
          <iconify-icon icon="ph:globe-stand-bold" class="control-empty-icon"></iconify-icon>
          <span>No blocked domains yet.</span>
        </div>`;
      return;
    }

    container.innerHTML = domains.map(d => {
      return `
        <div class="control-item-row" data-domain="${escapeHTML(d)}">
          <div class="control-info" style="padding-left: 4px;">
            <span class="control-domain-name">${escapeHTML(d)}</span>
          </div>
          <button class="control-action-btn" onclick="window.unblockDomainFromDrawer('${escapeHTML(d)}', this.closest('.control-item-row'))">
            Unblock
          </button>
        </div>`;
    }).join('');

  } catch (err) {
    console.error('Failed to load blocked domains:', err);
    container.innerHTML = `<div class="control-empty" style="color:var(--danger)">Error loading blocked domains: ${escapeHTML(err.message)}</div>`;
  }
}

/**
 * Add Block / Mute Account by looking up handle first.
 */
export async function addAccountAction(type = 'block') {
  if (loading) return;

  const inputEl = $(type === 'block' ? 'block-user-input' : 'mute-user-input');
  const btnEl = $(type === 'block' ? 'block-user-btn' : 'mute-user-btn');
  if (!inputEl || !inputEl.value.trim()) return;

  const query = inputEl.value.trim();
  loading = true;
  if (btnEl) btnEl.disabled = true;

  try {
    showToast(`Searching for account: ${query}…`);
    
    // Resolve user handle using search API
    const searchRes = await apiGet(`/api/v1/accounts/search?q=${encodeURIComponent(query)}&resolve=true&limit=1`);
    if (!searchRes || searchRes.length === 0) {
      throw new Error('Account could not be resolved. Please verify the handle or URL.');
    }

    const account = searchRes[0];
    const accountId = account.id;

    // Call block / mute API
    const endpoint = type === 'block'
      ? `/api/v1/accounts/${accountId}/block`
      : `/api/v1/accounts/${accountId}/mute`;

    await apiPost(endpoint, {});

    // Update state
    if (type === 'block') {
      state.knownBlocking.add(accountId);
      state.knownMuting.delete(accountId); // Muting and blocking are exclusive in state update
      showToast(`Blocked @${account.acct}`);
      await loadBlockedUsers();
    } else {
      state.knownMuting.add(accountId);
      state.knownBlocking.delete(accountId);
      showToast(`Muted @${account.acct}`);
      await loadMutedUsers();
    }

    inputEl.value = '';
  } catch (err) {
    console.error(`Failed to ${type} user:`, err);
    showToast(`Action failed: ${err.message}`);
  } finally {
    loading = false;
    if (btnEl) btnEl.disabled = false;
  }
}

/**
 * Add Block Domain action.
 */
export async function addDomainBlockAction() {
  if (loading) return;

  const inputEl = $('block-domain-input');
  const btnEl = $('block-domain-btn');
  if (!inputEl || !inputEl.value.trim()) return;

  const domain = inputEl.value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!domain) {
    showToast('Invalid domain name');
    return;
  }

  loading = true;
  if (btnEl) btnEl.disabled = true;

  try {
    showToast(`Blocking domain: ${domain}…`);
    await apiPost('/api/v1/domain_blocks', { domain });

    // Update state
    if (!state.knownBlockedDomains) state.knownBlockedDomains = new Set();
    state.knownBlockedDomains.add(domain);

    showToast(`Blocked domain: ${domain}`);
    inputEl.value = '';
    await loadBlockedDomains();
  } catch (err) {
    console.error('Failed to block domain:', err);
    showToast(`Action failed: ${err.message}`);
  } finally {
    loading = false;
    if (btnEl) btnEl.disabled = false;
  }
}

/**
 * Unblock user action from drawer.
 */
window.unblockUserFromDrawer = async function(accountId, rowEl) {
  try {
    await apiPost(`/api/v1/accounts/${accountId}/unblock`);
    state.knownBlocking.delete(accountId);
    showToast('User unblocked');
    
    // Animate row removal
    if (rowEl) {
      rowEl.classList.add('removing');
      setTimeout(() => rowEl.remove(), 300);
    }
  } catch (err) {
    console.error('Failed to unblock user:', err);
    showToast(`Unblock failed: ${err.message}`);
  }
};

/**
 * Unmute user action from drawer.
 */
window.unmuteUserFromDrawer = async function(accountId, rowEl) {
  try {
    await apiPost(`/api/v1/accounts/${accountId}/unmute`);
    state.knownMuting.delete(accountId);
    showToast('User unmuted');

    // Animate row removal
    if (rowEl) {
      rowEl.classList.add('removing');
      setTimeout(() => rowEl.remove(), 300);
    }
  } catch (err) {
    console.error('Failed to unmute user:', err);
    showToast(`Unmute failed: ${err.message}`);
  }
};

/**
 * Unblock domain action from drawer.
 */
window.unblockDomainFromDrawer = async function(domain, rowEl) {
  try {
    await apiDelete(`/api/v1/domain_blocks?domain=${encodeURIComponent(domain)}`);
    if (state.knownBlockedDomains) state.knownBlockedDomains.delete(domain.toLowerCase());
    showToast(`Unblocked domain: ${domain}`);

    // Animate row removal
    if (rowEl) {
      rowEl.classList.add('removing');
      setTimeout(() => rowEl.remove(), 300);
    }
  } catch (err) {
    console.error('Failed to unblock domain:', err);
    showToast(`Action failed: ${err.message}`);
  }
};

// Global exports for inline HTML selectors
window.closeBlocksMutesDrawer = closeBlocksMutesDrawer;
window.switchBlocksMutesTab = switchBlocksMutesTab;
window.addAccountAction = addAccountAction;
window.addDomainBlockAction = addDomainBlockAction;
