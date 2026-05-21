/**
 * @module lists
 * Mastodon list management and rendering.
 */

import { $, state } from './state.js';
import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { showToast, showConfirm } from './ui.js';
import { escapeHTML } from './utils.js';

// --- MOCK DATA FOR DEMO MODE ---
let mockLists = [
  { id: 'mock-1', title: 'Design Inspiration', replies_policy: 'followed' },
  { id: 'mock-2', title: 'Tech & Dev', replies_policy: 'followed' }
];

let mockAccounts = {
  'mock-1': [
    { id: 'm-a1', username: 'design_daily', display_name: 'Design Daily', avatar: '', acct: 'design_daily@mastodon.art' },
    { id: 'm-a2', username: 'uicraft', display_name: 'UI Craft', avatar: '', acct: 'uicraft@ux.social' }
  ],
  'mock-2': [
    { id: 'm-a3', username: 'webdev_news', display_name: 'WebDev News', avatar: '', acct: 'webdev_news@tech.social' }
  ]
};

/**
 * Fetch all lists created by the user.
 */
export async function fetchUserLists() {
  if (state.demoMode) {
    state.lists = [...mockLists];
    return state.lists;
  }
  if (!state.token) return [];
  try {
    const lists = await apiGet('/api/v1/lists', state.token);
    state.lists = lists || [];
    return state.lists;
  } catch (err) {
    console.error('Failed to fetch user lists:', err);
    throw err;
  }
}

/**
 * Create a new list.
 */
export async function createUserList(title, repliesPolicy = 'followed') {
  if (state.demoMode) {
    const newList = {
      id: `mock-${Date.now()}`,
      title,
      replies_policy: repliesPolicy
    };
    mockLists.push(newList);
    mockAccounts[newList.id] = [];
    state.lists = [...mockLists];
    showToast(`List "${title}" created successfully!`, 'success');
    return newList;
  }

  try {
    const res = await apiPost('/api/v1/lists', {
      title,
      replies_policy: repliesPolicy
    }, state.token);
    await fetchUserLists();
    showToast(`List "${title}" created successfully!`, 'success');
    return res;
  } catch (err) {
    showToast(`Failed to create list: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Delete a list.
 */
export async function deleteUserList(listId) {
  const list = state.lists.find(l => l.id === listId);
  const title = list ? list.title : 'List';

  const confirmed = await showConfirm(
    `Are you sure you want to permanently delete the list "${title}"? This cannot be undone.`,
    'Delete List'
  );
  if (!confirmed) return false;

  if (state.demoMode) {
    mockLists = mockLists.filter(l => l.id !== listId);
    delete mockAccounts[listId];
    state.lists = [...mockLists];
    if (state.selectedListId === listId) {
      state.selectedListId = 'landing';
    }
    showToast(`List "${title}" deleted.`, 'success');
    return true;
  }

  try {
    await apiDelete(`/api/v1/lists/${listId}`, state.token);
    await fetchUserLists();
    if (state.selectedListId === listId) {
      state.selectedListId = 'landing';
    }
    showToast(`List "${title}" deleted.`, 'success');
    return true;
  } catch (err) {
    showToast(`Failed to delete list: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Rename a list.
 */
export async function renameUserList(listId, newTitle) {
  if (state.demoMode) {
    const list = mockLists.find(l => l.id === listId);
    if (list) list.title = newTitle;
    state.lists = [...mockLists];
    showToast(`List renamed to "${newTitle}".`, 'success');
    return list;
  }

  try {
    const res = await apiPut(`/api/v1/lists/${listId}`, { title: newTitle }, state.token);
    
    // Dynamically update local state.lists to ensure immediate, cache-proof synchronization
    if (state.lists) {
      const list = state.lists.find(l => l.id === listId);
      if (list) list.title = newTitle;
    }
    
    showToast(`List renamed to "${newTitle}".`, 'success');
    return res;
  } catch (err) {
    showToast(`Failed to rename list: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Update list replies policy.
 */
export async function updateUserListRepliesPolicy(listId, repliesPolicy) {
  if (state.demoMode) {
    const list = mockLists.find(l => l.id === listId);
    if (list) list.replies_policy = repliesPolicy;
    state.lists = [...mockLists];
    showToast(`Replies policy updated.`, 'success');
    return list;
  }

  try {
    const res = await apiPut(`/api/v1/lists/${listId}`, { replies_policy: repliesPolicy }, state.token);
    
    // Dynamically update local state.lists to ensure immediate, cache-proof synchronization
    if (state.lists) {
      const list = state.lists.find(l => l.id === listId);
      if (list) list.replies_policy = repliesPolicy;
    }
    
    showToast(`Replies policy updated successfully!`, 'success');
    return res;
  } catch (err) {
    showToast(`Failed to update replies policy: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Fetch accounts belonging to a list.
 */
export async function fetchListAccounts(listId) {
  if (state.demoMode) {
    return mockAccounts[listId] || [];
  }
  try {
    return await apiGet(`/api/v1/lists/${listId}/accounts?limit=80`, state.token);
  } catch (err) {
    console.error(`Failed to fetch accounts for list ${listId}:`, err);
    return [];
  }
}

/**
 * Add an account to a list.
 */
export async function addAccountToList(listId, accountId, accountData = null) {
  if (state.demoMode) {
    if (!mockAccounts[listId]) mockAccounts[listId] = [];
    if (!mockAccounts[listId].some(a => a.id === accountId)) {
      const mockAcc = accountData || {
        id: accountId,
        username: 'profile',
        display_name: 'Followed Profile',
        avatar: '',
        acct: 'profile@example.com'
      };
      mockAccounts[listId].push(mockAcc);
    }
    showToast('Profile added to list.', 'success');
    return true;
  }

  try {
    await apiPost(`/api/v1/lists/${listId}/accounts`, {
      account_ids: [accountId]
    }, state.token);
    showToast('Profile added to list.', 'success');
    return true;
  } catch (err) {
    showToast(`Failed to add member: ${err.message}`, 'error');
    return false;
  }
}

/**
 * Remove an account from a list.
 */
export async function removeAccountFromList(listId, accountId) {
  if (state.demoMode) {
    if (mockAccounts[listId]) {
      mockAccounts[listId] = mockAccounts[listId].filter(a => a.id !== accountId);
    }
    showToast('Profile removed from list.', 'success');
    return true;
  }

  try {
    await apiDelete(`/api/v1/lists/${listId}/accounts?account_ids[]=${accountId}`, state.token);
    showToast('Profile removed from list.', 'success');
    return true;
  } catch (err) {
    showToast(`Failed to remove member: ${err.message}`, 'error');
    return false;
  }
}

/**
 * Fetch lists containing a specific account.
 */
export async function fetchAccountListMemberships(accountId) {
  if (state.demoMode) {
    const listIds = [];
    for (const listId in mockAccounts) {
      if (mockAccounts[listId].some(a => a.id === accountId)) {
        listIds.push(listId);
      }
    }
    return state.lists.filter(l => listIds.includes(l.id));
  }
  try {
    return await apiGet(`/api/v1/accounts/${accountId}/lists`, state.token);
  } catch (err) {
    console.error('Failed to fetch account list memberships:', err);
    return [];
  }
}

// ─── UI MANAGEMENT BINDINGS ───

export let activeListDetailId = null;
let currentListMembers = [];

/**
 * Open the Manage Lists drawer.
 */
export async function openListsManager() {
  const backdrop = $('manage-lists-backdrop');
  const drawer = $('manage-lists-drawer');
  if (!backdrop || !drawer) return;

  history.pushState({ drawer: 'manage-lists-drawer' }, '', '');
  drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('open');

  // Fetch fresh lists
  try {
    await fetchUserLists();
  } catch (e) {
    showToast('Failed to fetch lists.', 'error');
  }

  renderListsOverview();
  closeListDetail(); // Start at overview
}

/**
 * Close the Manage Lists drawer.
 */
export function closeListsManager() {
  const backdrop = $('manage-lists-backdrop');
  const drawer = $('manage-lists-drawer');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
  
  // Refresh landing grid if lists are visible in background
  if (state.feedFilter === 'lists' && (!state.selectedListId || state.selectedListId === 'landing')) {
    renderListsGrid();
  }
}

/**
 * Render lists in the Overview panel of the drawer.
 */
export function renderListsOverview() {
  const container = $('manage-lists-list-container');
  if (!container) return;

  if (!state.lists || state.lists.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:32px 16px; color:var(--text-muted); font-size:13px;">
        <iconify-icon icon="ph:list-bullets-bold" style="font-size:32px; opacity:0.3; margin-bottom:8px; display:block; margin-inline:auto;"></iconify-icon>
        No lists created yet.
      </div>
    `;
    return;
  }

  container.innerHTML = state.lists.map(list => `
    <div class="lists-edit-item" data-id="${list.id}">
      <span class="lists-edit-item-title">${escapeHTML(list.title)}</span>
      <div class="lists-edit-item-actions">
        <button class="list-icon-btn btn-edit" title="Edit list members and details" aria-label="Edit list">
          <iconify-icon icon="ph:pencil-simple-bold" style="font-size:16px;"></iconify-icon>
        </button>
        <button class="list-icon-btn btn-danger" title="Delete list" aria-label="Delete list">
          <iconify-icon icon="ph:trash-bold" style="font-size:16px;"></iconify-icon>
        </button>
      </div>
    </div>
  `).join('');

  // Wire events
  container.querySelectorAll('.lists-edit-item').forEach(item => {
    const id = item.dataset.id;
    const editBtn = item.querySelector('.btn-edit');
    const deleteBtn = item.querySelector('.btn-danger');

    editBtn.onclick = () => openListDetail(id);
    deleteBtn.onclick = async () => {
      const success = await deleteUserList(id);
      if (success) {
        renderListsOverview();
        // If we deleted the active list timeline, reload the feed
        if (state.feedFilter === 'lists') {
          import('./feed.js').then(m => m.loadFeedTab(true));
        }
      }
    };
  });
}

/**
 * Open detail edit panel for a specific list.
 */
export async function openListDetail(listId) {
  activeListDetailId = listId;
  const list = state.lists.find(l => l.id === listId);
  if (!list) return;

  const overview = $('manage-lists-overview');
  const detail = $('manage-list-detail');
  const detailTitle = $('manage-list-detail-title');
  const renameInput = $('list-rename-input');
  const repliesPolicySelect = $('list-replies-policy-select');
  const memberSearchInput = $('list-member-search-input');
  const memberSearchResults = $('list-member-search-results');

  if (!overview || !detail) return;

  overview.style.display = 'none';
  detail.style.display = 'block';

  detailTitle.textContent = `Manage: ${list.title}`;
  renameInput.value = list.title;
  if (repliesPolicySelect) {
    repliesPolicySelect.value = list.replies_policy || 'followed';
  }
  memberSearchInput.value = '';
  memberSearchResults.innerHTML = '';

  const keywordInput = $('list-suggestions-keyword-input');
  if (keywordInput) keywordInput.value = '';

  const suggestionsSection = $('list-suggestions-section');
  const suggestionsContainer = $('list-suggestions-container');
  if (suggestionsSection) suggestionsSection.style.display = 'none';
  if (suggestionsContainer) suggestionsContainer.innerHTML = '';

  // Load current members
  const countEl = $('list-member-count');
  const listContainer = $('list-members-container');
  if (countEl) countEl.textContent = '...';
  if (listContainer) {
    listContainer.innerHTML = `
      <div style="display:flex; justify-content:center; padding:20px;">
        <div style="width:20px; height:20px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      </div>
    `;
  }

  try {
    currentListMembers = await fetchListAccounts(listId);
    renderListMembers();
    loadSmartSuggestions(listId, list.title);
  } catch (err) {
    showToast('Failed to load list members.', 'error');
  }
}

/**
 * Close detail view, back to overview.
 */
export function closeListDetail() {
  activeListDetailId = null;
  currentListMembers = [];
  const overview = $('manage-lists-overview');
  const detail = $('manage-list-detail');
  if (overview && detail) {
    overview.style.display = 'block';
    detail.style.display = 'none';
    renderListsOverview();
  }
}

/**
 * Render the member cards inside list details.
 */
function renderListMembers() {
  const countEl = $('list-member-count');
  const container = $('list-members-container');
  if (!container) return;

  if (countEl) countEl.textContent = currentListMembers.length;

  if (currentListMembers.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:12px;">
        No members in this list. Use search above to add followed profiles!
      </div>
    `;
    return;
  }

  container.innerHTML = currentListMembers.map(member => {
    const avatar = member.avatar || member.avatar_static || window._AVATAR_PLACEHOLDER;
    const name = member.display_name || member.username;
    const handle = '@' + (member.acct.includes('@') ? member.acct : `${member.acct}@${state.server || 'server'}`);

    return `
      <div class="lists-member-item" data-account-id="${member.id}">
        <div class="member-item-info">
          <img class="member-item-avatar" src="${escapeHTML(avatar)}" alt="" onerror="this.src=window._AVATAR_PLACEHOLDER" />
          <div class="member-item-text">
            <span class="member-item-name">${escapeHTML(name)}</span>
            <span class="member-item-handle">${escapeHTML(handle)}</span>
          </div>
        </div>
        <button class="member-remove-btn">Remove</button>
      </div>
    `;
  }).join('');

  // Wire remove events
  container.querySelectorAll('.lists-member-item').forEach(item => {
    const accountId = item.dataset.accountId;
    const removeBtn = item.querySelector('.member-remove-btn');
    removeBtn.onclick = async () => {
      const success = await removeAccountFromList(activeListDetailId, accountId);
      if (success) {
        currentListMembers = currentListMembers.filter(m => m.id !== accountId);
        renderListMembers();
      }
    };
  });
}

/**
 * Search followed profiles to add to the active list.
 */
let searchDebounceTimeout = null;
export function handleListMemberSearch(query) {
  clearTimeout(searchDebounceTimeout);
  const container = $('list-member-search-results');
  if (!container) return;

  if (!query || query.trim().length < 2) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div style="display:flex; justify-content:center; padding:10px;">
      <div style="width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
    </div>
  `;

  searchDebounceTimeout = setTimeout(async () => {
    try {
      let results = [];
      if (state.demoMode) {
        // Mock followed profiles search
        results = [
          { id: 'm-p1', username: 'kevin', display_name: 'Kevin Rose', avatar: '', acct: 'kevin@mastodon.social' },
          { id: 'm-p2', username: 'taylor', display_name: 'Taylor Swift', avatar: '', acct: 'taylor@pop.music' },
          { id: 'm-p3', username: 'elizabeth', display_name: 'Elizabeth', avatar: '', acct: 'elizabeth@history.org' }
        ].filter(p => p.username.toLowerCase().includes(query.toLowerCase()) || p.display_name.toLowerCase().includes(query.toLowerCase()));
      } else {
        results = await apiGet(`/api/v1/accounts/search?q=${encodeURIComponent(query)}&limit=10&following=true`, state.token);
      }

      if (results.length === 0) {
        container.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:6px;">No matching followed profiles.</div>`;
        return;
      }

      container.innerHTML = results.map(account => {
        const avatar = account.avatar || account.avatar_static || window._AVATAR_PLACEHOLDER;
        const name = account.display_name || account.username;
        const handle = '@' + (account.acct.includes('@') ? account.acct : `${account.acct}@${state.server || 'server'}`);
        const isMember = currentListMembers.some(m => m.id === account.id);

        return `
          <div class="lists-member-item" data-search-id="${account.id}">
            <div class="member-item-info">
              <img class="member-item-avatar" src="${escapeHTML(avatar)}" alt="" onerror="this.src=window._AVATAR_PLACEHOLDER" />
              <div class="member-item-text">
                <span class="member-item-name">${escapeHTML(name)}</span>
                <span class="member-item-handle">${escapeHTML(handle)}</span>
              </div>
            </div>
            ${isMember ? `
              <button class="member-add-btn added" disabled>Added</button>
            ` : `
              <button class="member-add-btn">Add</button>
            `}
          </div>
        `;
      }).join('');

      // Wire add events
      container.querySelectorAll('.lists-member-item').forEach(item => {
        const accountId = item.dataset.searchId;
        const addBtn = item.querySelector('.member-add-btn');
        if (addBtn && !addBtn.classList.contains('added')) {
          addBtn.onclick = async () => {
            const accountData = results.find(a => a.id === accountId);
            const success = await addAccountToList(activeListDetailId, accountId, accountData);
            if (success) {
              addBtn.textContent = 'Added';
              addBtn.classList.add('added');
              addBtn.disabled = true;
              if (accountData) {
                currentListMembers.push(accountData);
                renderListMembers();
              }
            }
          };
        }
      });

    } catch (err) {
      container.innerHTML = `<div style="font-size:12px; color:#ff8080; text-align:center; padding:6px;">Search failed.</div>`;
    }
  }, 400);
}

/**
 * Render the lists landing grid in the main Feed Tab.
 */
export function renderListsGrid() {
  const grid = $('user-lists-grid');
  const countLabel = $('user-lists-count-label');
  if (!grid) return;

  const searchInput = $('list-search-input');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  let filteredLists = state.lists || [];
  if (query) {
    filteredLists = filteredLists.filter(list => list.title.toLowerCase().includes(query));
  }

  if (countLabel) {
    countLabel.textContent = query 
      ? `Search Results (${filteredLists.length})` 
      : `My Lists (${state.lists ? state.lists.length : 0})`;
  }

  // Generate hero card for adding/creating a list
  const addCardHTML = `
    <div class="list-card" id="list-card-create-hero" style="border: 2px dashed var(--border); background: transparent;">
      <iconify-icon icon="ph:plus-circle-bold" style="font-size: 32px; color: var(--accent); opacity: 0.8; margin-bottom: 4px;"></iconify-icon>
      <div class="list-card-name" style="color: var(--accent);">Create List</div>
      <div class="list-card-stats">Custom timelines</div>
    </div>
  `;

  if (filteredLists.length === 0) {
    grid.innerHTML = query
      ? `<div class="list-empty-state" style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">No matching lists found.</div>` + addCardHTML
      : addCardHTML;
    
    // Wire hero click
    const hero = $('list-card-create-hero');
    if (hero) hero.onclick = () => openListsManager();
    return;
  }

  grid.innerHTML = filteredLists.map(list => `
    <div class="list-card" data-id="${list.id}">
      <iconify-icon icon="ph:list-bullets-bold" style="font-size: 24px; color: var(--accent); opacity: 0.8; margin-bottom: 4px;"></iconify-icon>
      <div class="list-card-name">${escapeHTML(list.title)}</div>
      <div class="list-card-stats">View Timeline</div>
    </div>
  `).join('') + addCardHTML;

  // Wire click events
  grid.querySelectorAll('.list-card').forEach(card => {
    const id = card.dataset.id;
    if (id) {
      card.onclick = () => selectList(id);
    }
  });

  const hero = $('list-card-create-hero');
  if (hero) hero.onclick = () => openListsManager();
}

/**
 * Select a specific list timeline to display.
 */
export async function selectList(listId) {
  state.selectedListId = listId;
  state.listFeed = null;
  state.listMaxId = null;

  if (listId && listId !== 'landing') {
    const list = state.lists.find(l => l.id === listId);
    state.feedFilter = 'lists';
    import('./feed.js').then(m => m.loadFeedTab(true));
  } else {
    // Show grid landing
    state.selectedListId = 'landing';
    import('./feed.js').then(m => m.loadFeedTab(true));
  }
}

/**
 * Loads and renders smart suggested list members based on followed hashtags & title keywords.
 */
export async function loadSmartSuggestions(listId, listTitle, customKeyword = null) {
  const container = $('list-suggestions-container');
  const section = $('list-suggestions-section');
  if (!container || !section) return;

  // Clear suggestions list
  container.innerHTML = '';

  // Show suggestions section
  section.style.display = 'block';
  // Ensure the body wrapper is visible (expanded by default) and caret rotated down
  const body = $('list-suggestions-body');
  if (body) {
    body.style.display = 'block';
  }
  const toggleIcon = $('list-suggestions-toggle-icon');
  if (toggleIcon) {
    toggleIcon.style.transform = 'rotate(0deg)';
  }

  // Wire header toggle click listener once
  const header = $('list-suggestions-header');
  if (header && !header.dataset.listenerWired) {
    header.dataset.listenerWired = 'true';
    header.onclick = () => {
      const isCollapsed = body ? body.style.display === 'none' : false;
      if (body) {
        body.style.display = isCollapsed ? 'block' : 'none';
      }
      const toggleIcon = $('list-suggestions-toggle-icon');
      if (toggleIcon) {
        toggleIcon.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
      }
    };
  }

  // Wire custom keyword search elements
  const keywordInput = $('list-suggestions-keyword-input');
  const keywordBtn = $('list-suggestions-keyword-btn');
  if (keywordInput && keywordBtn && !keywordInput.dataset.listenerWired) {
    keywordInput.dataset.listenerWired = 'true';

    const triggerSearch = () => {
      const val = keywordInput.value.trim();
      loadSmartSuggestions(listId, listTitle, val);
    };

    keywordBtn.onclick = triggerSearch;
    keywordInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerSearch();
      }
    };
  }

  // Identify all search tags
  const searchTags = [];
  if (customKeyword && customKeyword.trim()) {
    customKeyword
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0)
      .forEach(w => {
        if (!searchTags.includes(w)) searchTags.push(w);
      });
  } else {
    // 1. Clean list title into matching words
    const cleanWords = listTitle
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2);

    // 2. Identify all matching followed hashtags (or fall back to clean words)
    if (state.followedHashtags && state.followedHashtags.length > 0) {
      for (const tag of state.followedHashtags) {
        const tagNameLower = tag.name.toLowerCase();
        if (cleanWords.some(w => tagNameLower.includes(w) || w.includes(tagNameLower))) {
          if (!searchTags.includes(tag.name)) {
            searchTags.push(tag.name);
          }
        }
      }
    }

    // Fallback if no matching followed hashtags are found
    if (searchTags.length === 0) {
      cleanWords.forEach(word => {
        if (!searchTags.includes(word)) {
          searchTags.push(word);
        }
      });
    }
    // Ensure we at least have the lowercased full list title if cleanWords was empty
    if (searchTags.length === 0) {
      searchTags.push(listTitle.toLowerCase());
    }
  }

  let suggestions = [];

  if (state.demoMode) {
    // --- DEMO MODE MOCK SUGGESTIONS ---
    const allMockFollowed = [
      { id: 'm-a1', username: 'design_daily', display_name: 'Design Daily', avatar: '', acct: 'design_daily@mastodon.art', bio: 'Daily design inspiration.', tag: 'design', last_status_at: '2026-05-21', statuses_count: 1200 },
      { id: 'm-a2', username: 'uicraft', display_name: 'UI Craft', avatar: '', acct: 'uicraft@ux.social', bio: 'Handcrafted UI designs and CSS.', tag: 'design', last_status_at: '2026-05-20', statuses_count: 850 },
      { id: 'm-a3', username: 'webdev_news', display_name: 'WebDev News', avatar: '', acct: 'webdev_news@tech.social', bio: 'Latest news in web dev.', tag: 'webdev', last_status_at: '2026-05-19', statuses_count: 2300 },
      { id: 'm-p1', username: 'kevin', display_name: 'Kevin Rose', avatar: '', acct: 'kevin@mastodon.social', bio: 'Tech entrepreneur, investor.', tag: 'webdev', last_status_at: '2026-05-15', statuses_count: 140 },
      { id: 'm-p2', username: 'taylor', display_name: 'Taylor Swift', avatar: '', acct: 'taylor@pop.music', bio: 'Musician. Songwriter.', tag: 'music', last_status_at: '2026-05-10', statuses_count: 45 },
      { id: 'm-p3', username: 'elizabeth', display_name: 'Elizabeth', avatar: '', acct: 'elizabeth@history.org', bio: 'Historian, archivist.', tag: 'history', last_status_at: '2026-04-01', statuses_count: 900 }
    ];

    const memberIds = new Set(currentListMembers.map(m => m.id));
    let candidates = allMockFollowed.filter(a => !memberIds.has(a.id));

    if (customKeyword && customKeyword.trim()) {
      const kw = customKeyword.trim().toLowerCase();
      candidates = candidates.filter(c => 
        c.tag.toLowerCase().includes(kw) || 
        c.username.toLowerCase().includes(kw) || 
        c.display_name.toLowerCase().includes(kw) ||
        (c.bio && c.bio.toLowerCase().includes(kw))
      );
      candidates.sort((a, b) => {
        const timeA = a.last_status_at ? new Date(a.last_status_at).getTime() : 0;
        const timeB = b.last_status_at ? new Date(b.last_status_at).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return (b.statuses_count || 0) - (a.statuses_count || 0);
      });
      suggestions = candidates.slice(0, 15).map(c => ({
        ...c,
        reason: `Matched "${customKeyword}"`
      }));
    } else {
      // Find all target tags matched by the cleanWords
      const targetTags = [];
      const cleanWords = listTitle
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2);

      if (cleanWords.some(w => w.includes('design') || w.includes('art') || w.includes('inspire'))) targetTags.push('design');
      if (cleanWords.some(w => w.includes('tech') || w.includes('dev') || w.includes('web') || w.includes('code'))) targetTags.push('webdev');
      if (cleanWords.some(w => w.includes('music') || w.includes('song'))) targetTags.push('music');
      if (cleanWords.some(w => w.includes('history') || w.includes('archive') || w.includes('past'))) targetTags.push('history');

      candidates = candidates.sort((a, b) => {
        const aMatch = targetTags.length > 0 && targetTags.includes(a.tag);
        const bMatch = targetTags.length > 0 && targetTags.includes(b.tag);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;

        const timeA = a.last_status_at ? new Date(a.last_status_at).getTime() : 0;
        const timeB = b.last_status_at ? new Date(b.last_status_at).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return (b.statuses_count || 0) - (a.statuses_count || 0);
      });

      suggestions = candidates.slice(0, 15).map(c => ({
        ...c,
        reason: targetTags.includes(c.tag) ? `Active in #${c.tag}` : 'Followed Profile'
      }));
    }

  } else {
    // --- PRODUCTION API PIPELINE ---
    if (!state.token) return;
    try {
      // Fetch concurrent search requests for each search tag
      const fetchPromises = searchTags.map(tag => 
        apiGet(`/api/v2/search?q=${encodeURIComponent(tag)}&type=accounts&following=true&limit=20`, state.token)
          .catch(err => {
            console.error(`Failed to fetch search suggestions for tag #${tag}:`, err);
            return null;
          })
      );
      const responses = await Promise.all(fetchPromises);
      
      const memberIds = new Set(currentListMembers.map(m => m.id));
      const seenAccountIds = new Set();
      const uniqueCandidates = [];

      responses.forEach((results, index) => {
        const tag = searchTags[index];
        if (results && results.accounts && results.accounts.length > 0) {
          results.accounts.forEach(account => {
            if (!memberIds.has(account.id) && !seenAccountIds.has(account.id)) {
              seenAccountIds.add(account.id);
              uniqueCandidates.push({
                ...account,
                reason: customKeyword ? `Matched "${customKeyword}"` : `Active in #${tag}`
              });
            }
          });
        }
      });

      // Sort unique candidates by activity (last_status_at descending, statuses_count descending)
      uniqueCandidates.sort((a, b) => {
        const timeA = a.last_status_at ? new Date(a.last_status_at).getTime() : 0;
        const timeB = b.last_status_at ? new Date(b.last_status_at).getTime() : 0;
        if (timeA !== timeB) {
          return timeB - timeA;
        }
        return (b.statuses_count || 0) - (a.statuses_count || 0);
      });

      suggestions = uniqueCandidates.slice(0, 15);
    } catch (err) {
      console.error('Failed to load smart suggestions:', err);
      return;
    }
  }

  if (suggestions.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:12px;">
        ${customKeyword ? `No suggestions found matching "${escapeHTML(customKeyword)}".` : 'No default suggestions found based on list title.'}<br/>
        Try entering custom keywords/tags above!
      </div>
    `;
    return;
  }

  container.innerHTML = suggestions.map(account => {
    const avatar = account.avatar || account.avatar_static || window._AVATAR_PLACEHOLDER;
    const name = account.display_name || account.username;
    const handle = '@' + (account.acct.includes('@') ? account.acct : `${account.acct}@${state.server || 'server'}`);
    const reason = account.reason || `Interests: #${searchTags.join(', #')}`;

    return `
      <div class="list-suggestion-item" data-account-id="${account.id}">
        <div class="member-item-info">
          <img class="list-suggestion-avatar" src="${escapeHTML(avatar)}" alt="" onerror="this.src=window._AVATAR_PLACEHOLDER" />
          <div class="member-item-text">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="list-suggestion-name">${escapeHTML(name)}</span>
              <span class="list-suggestion-reason-badge" title="${escapeHTML(reason)}">${escapeHTML(reason)}</span>
            </div>
            <span class="list-suggestion-handle" title="${escapeHTML(handle)}">${escapeHTML(handle)}</span>
          </div>
        </div>
        <button class="list-suggestion-add-btn">Add</button>
      </div>
    `;
  }).join('');

  // Wire events
  container.querySelectorAll('.list-suggestion-item').forEach(card => {
    const accountId = card.dataset.accountId;
    const avatarImg = card.querySelector('.list-suggestion-avatar');
    const nameSpan = card.querySelector('.list-suggestion-name');
    const addBtn = card.querySelector('.list-suggestion-add-btn');

    // Click avatar or name to open the standard Profile Drawer
    if (avatarImg) {
      avatarImg.onclick = () => {
        if (window.openProfileDrawer) {
          window.openProfileDrawer(accountId, state.server);
        }
      };
    }
    if (nameSpan) {
      nameSpan.onclick = () => {
        if (window.openProfileDrawer) {
          window.openProfileDrawer(accountId, state.server);
        }
      };
    }

    if (addBtn) {
      addBtn.onclick = async () => {
        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';

        const accountData = suggestions.find(a => a.id === accountId);
        const success = await addAccountToList(activeListDetailId, accountId, accountData);

        if (success) {
          addBtn.textContent = 'Added';
          addBtn.classList.add('added');
          addBtn.disabled = true;

          if (accountData) {
            if (!currentListMembers.some(m => m.id === accountId)) {
              currentListMembers.push(accountData);
              renderListMembers();
            }
          }

          setTimeout(() => {
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            card.style.transition = 'all 0.3s ease';
            setTimeout(() => {
              card.remove();
              if (container.querySelectorAll('.list-suggestion-item').length === 0) {
                container.innerHTML = `
                  <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:12px;">
                    All suggestions added! Try entering new custom keywords/tags above.
                  </div>
                `;
              }
            }, 300);
          }, 600);

        } else {
          addBtn.textContent = 'Add';
          addBtn.disabled = false;
        }
      };
    }
  });
}
