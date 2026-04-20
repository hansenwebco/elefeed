/**
 * @module filters
 * Mastodon V2 Filter Management logic.
 */

import { $, state, store } from './state.js';
import { getFiltersV2, createFilterV2, updateFilterV2, deleteFilterV2, addFilterKeywordV2, removeFilterKeywordV2 } from './api.js';
import { showToast, showConfirm } from './ui.js';
import { escapeHTML } from './utils.js';

let currentFilters = [];

/**
 * Open the Manage Filters drawer and load data.
 */
export async function openFiltersDrawer() {
  const drawer = $('manage-filters-drawer');
  const backdrop = $('manage-filters-backdrop');
  if (!drawer || !backdrop) return;

  drawer.classList.add('open');
  backdrop.classList.add('open');
  
  // Update URL for history
  const url = new URL(window.location);
  url.searchParams.set('manage_filters', 'true');
  window.history.pushState({}, '', url);

  await loadFilters();
}

/**
 * Close the Manage Filters drawer.
 */
export function closeFiltersDrawer() {
  const drawer = $('manage-filters-drawer');
  const backdrop = $('manage-filters-backdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');

  const url = new URL(window.location);
  url.searchParams.delete('manage_filters');
  window.history.pushState({}, '', url);
}

/**
 * Fetch and populate filters into the global state.
 */
export async function loadFilters() {
  if (!state.token || state.demoMode) return;
  const container = $('filters-list-container');
  if (container && container.innerHTML === '') {
    container.innerHTML = '<div class="spinner" style="margin:20px auto;"></div>';
  }

  try {
    const filters = await getFiltersV2();
    state.filters = filters;
    updateFilterRegexes();
    if (container) renderFiltersList();
  } catch (err) {
    console.error('Failed to load filters:', err);
    if (container) container.innerHTML = `<div class="error">Failed to load filters: ${err.message}</div>`;
  }
}

/**
 * Build combined regexes for each context and action.
 */
export function updateFilterRegexes() {
  const filters = state.filters || [];
  const contexts = ['home', 'notifications', 'public', 'thread', 'account'];
  
  state.filterRegexes = {};

  contexts.forEach(ctx => {
    state.filterRegexes[ctx] = {
      hide: buildRegexForContext(filters, ctx, 'hide'),
      warn: buildRegexForContext(filters, ctx, 'warn'),
    };
  });
}

function buildRegexForContext(filters, context, action) {
  const keywords = [];
  filters.forEach(f => {
    // Check if filter is active in this context and has the right action
    if (f.context.includes(context) && f.filter_action === action) {
      (f.keywords || []).forEach(kw => {
        let pattern = kw.keyword;
        pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (kw.whole_word) pattern = `\\b${pattern}\\b`;
        keywords.push(pattern);
      });
    }
  });
  
  if (keywords.length === 0) return null;
  return new RegExp(keywords.join('|'), 'gi');
}

/**
 * Render the full filter list into the drawer.
 */
function renderFiltersList() {
  const container = $('filters-list-container');
  if (!container) return;
  
  const filters = state.filters || [];

  if (filters.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:40px 20px; color:var(--text-dim); font-size:13px;">No filters created yet.</div>';
    return;
  }

  container.innerHTML = filters.map(filter => `
    <div class="filter-item" data-id="${filter.id}" style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:12px; display:flex; flex-direction:column; gap:12px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
        <div style="display:flex; flex-direction:column; gap:4px; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-weight:600; color:var(--text); font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(filter.title)}</span>
            <span style="font-size:10px; background:var(--surface2); color:var(--text-muted); padding:2px 6px; border-radius:4px; text-transform:uppercase; font-weight:600; letter-spacing:0.02em;">${filter.filter_action}</span>
          </div>
          <div style="font-size:11px; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            Context: ${filter.context.join(', ')}
          </div>
        </div>
        <div style="display:flex; gap:4px; flex-shrink:0;">
          <button class="icon-btn filter-edit-btn" title="Edit Filter" onclick="window.handleEditFilter('${filter.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="icon-btn filter-delete-btn" title="Delete Filter" style="color:var(--danger);" onclick="window.handleDeleteFilter('${filter.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>

      <div class="filter-keywords" style="display:flex; flex-wrap:wrap; gap:6px;">
        ${/* Initial render handled by helper to keep logic in one place */ ''}
      </div>
    </div>
  `).join('');

  // Perform initial render of keyword sections
  filters.forEach(filter => {
    const kwContainer = container.querySelector(`.filter-item[data-id="${filter.id}"] .filter-keywords`);
    if (kwContainer) renderFilterKeywords(kwContainer, filter);
  });
}

/**
 * Handle editing a filter.
 */
window.handleEditFilter = function(filterId) {
  const filter = state.filters.find(f => f.id === filterId);
  if (!filter) return;

  const modal = $('filter-edit-modal');
  $('filter-modal-title').textContent = 'Edit Filter';
  $('filter-title-input').value = filter.title;
  $('filter-action-select').value = filter.filter_action;
  
  const ctxCheckboxes = document.querySelectorAll('.filter-context-checkbox');
  ctxCheckboxes.forEach(cb => {
    cb.checked = filter.context.includes(cb.value);
  });

  $('filter-save-btn').onclick = async () => saveFilter(filterId);
  modal.style.display = 'flex';
};

/**
 * Handle creating a new filter.
 */
export function initFiltersUI() {
  const addBtn = $('add-filter-btn');
  if (addBtn) {
    addBtn.onclick = () => {
      const modal = $('filter-edit-modal');
      $('filter-modal-title').textContent = 'Create Filter';
      $('filter-title-input').value = '';
      $('filter-action-select').value = 'warn';
      
      const ctxCheckboxes = document.querySelectorAll('.filter-context-checkbox');
      ctxCheckboxes.forEach(cb => cb.checked = true);

      $('filter-save-btn').onclick = async () => saveFilter();
      modal.style.display = 'flex';
    };
  }
}

/**
 * Save filter (Create or Update).
 */
async function saveFilter(filterId = null) {
  const title = $('filter-title-input').value.trim();
  if (!title) {
    showToast('Filter title is required');
    return;
  }

  const action = $('filter-action-select').value;
  const selectedContexts = Array.from(document.querySelectorAll('.filter-context-checkbox'))
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  if (selectedContexts.length === 0) {
    showToast('Select at least one context');
    return;
  }

  try {
    const params = { title, context: selectedContexts, filter_action: action };
    if (filterId) {
      await updateFilterV2(filterId, params);
      showToast('Filter updated');
      loadFilters();
      $('filter-edit-modal').style.display = 'none';
    } else {
      await createFilterV2(params);
      showToast('Filter created');
      loadFilters();
      $('filter-edit-modal').style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to save filter:', err);
    showToast(`Error: ${err.message}`);
  }
}

/**
 * Delete a filter.
 */
window.handleDeleteFilter = async function(filterId) {
  const filter = state.filters.find(f => f.id === filterId);
  const title = filter?.title || 'this filter';

  const confirmed = await showConfirm(
    `Are you sure you want to permanently delete "${title}"? This cannot be undone.`,
    'Delete Filter'
  );
  if (!confirmed) return;

  try {
    await deleteFilterV2(filterId);
    showToast('Filter deleted');
    loadFilters();
  } catch (err) {
    console.error('Failed to delete filter:', err);
    showToast(`Error: ${err.message}`);
  }
};

/**
 * Add a keyword to a filter (Inline UX).
 */
window.handleAddKeywordPrompt = function(filterId) {
  const container = document.querySelector(`.filter-item[data-id="${filterId}"] .filter-keywords`);
  if (!container) return;

  const addBtn = container.querySelector('.filter-keyword-add-pill');
  if (!addBtn) return;

  // Check if we're already adding
  if (container.querySelector('.filter-kw-inline-input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'filter-kw-inline-input';
  input.placeholder = 'Keyword...';
  
  addBtn.style.display = 'none';
  container.insertBefore(input, addBtn);
  input.focus();

  const finish = async (save = true) => {
    const val = input.value.trim();
    input.disabled = true;
    
    if (save && val) {
      try {
        const newKeyword = await addFilterKeywordV2(filterId, val);
        showToast('Keyword added');
        
        // Targeted update to avoid full list reload
        const filter = state.filters.find(f => f.id === filterId);
        if (filter) {
          filter.keywords.push(newKeyword);
          updateFilterRegexes();
          renderFilterKeywords(container, filter);
        }
      } catch (err) {
        console.error('Failed to add keyword:', err);
        showToast(`Error: ${err.message}`);
        input.remove();
        addBtn.style.display = 'flex';
      }
    } else {
      input.remove();
      addBtn.style.display = 'flex';
    }
  };

  input.onblur = () => finish(true);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };
};

/**
 * Remove a keyword.
 */
window.handleRemoveKeyword = async function(keywordId, filterId) {
  try {
    await removeFilterKeywordV2(keywordId);
    showToast('Keyword removed');
    
    // Targeted update to avoid full list reload
    const filter = state.filters.find(f => f.id === filterId);
    if (filter) {
      filter.keywords = filter.keywords.filter(kw => kw.id !== keywordId);
      updateFilterRegexes();
      const container = document.querySelector(`.filter-item[data-id="${filterId}"] .filter-keywords`);
      if (container) renderFilterKeywords(container, filter);
    }
  } catch (err) {
    console.error('Failed to remove keyword:', err);
    showToast(`Error: ${err.message}`);
  }
};

/**
 * Helper to render just the keywords section of a filter.
 */
function renderFilterKeywords(container, filter) {
  container.innerHTML = `
    ${filter.keywords.map(kw => `
      <div class="filter-keyword-pill" style="background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:4px 8px; font-size:12px; display:flex; align-items:center; gap:6px;">
        <span>${escapeHTML(kw.keyword)}</span>
        <button class="filter-kw-remove" style="background:none; border:none; color:var(--text-dim); cursor:pointer; padding:2px; display:flex; align-items:center;" onclick="window.handleRemoveKeyword('${kw.id}', '${filter.id}')">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `).join('')}
    <button class="filter-keyword-add-pill" style="background:none; border:1px dashed var(--border); border-radius:6px; padding:4px 8px; font-size:12px; color:var(--accent); cursor:pointer; display:flex; align-items:center; gap:4px;" onclick="window.handleAddKeywordPrompt('${filter.id}')">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      Add Keyword
    </button>
  `;
}

// Global exports
window.closeFiltersDrawer = closeFiltersDrawer;
