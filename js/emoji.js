/**
 * @module emoji
 * Emoji picker — loads standard (emojibase CDN) and custom (instance) emojis.
 */

import { $, state } from './state.js';
import { renderCustomEmojis } from './utils.js';

let emojiPickerTarget = null;
let updateCountCallback = null;
let standardEmojis = [];
let customEmojis = [];
let standardEmojisLoaded = false;
let customEmojisLoadedForServer = null;
let savedSelectionRange = null;

document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const Math = window.Math; // To not confuse standard lint
  const range = sel.getRangeAt(0);
  const t1 = $('compose-textarea');
  const t2 = $('compose-textarea-sidebar');
  if ((t1 && t1.contains(range.commonAncestorContainer)) ||
    (t2 && t2.contains(range.commonAncestorContainer))) {
    savedSelectionRange = range.cloneRange();
  }
});

const emojiGroupNames = {
  0: 'Smileys & Emotion',
  1: 'People & Body',
  3: 'Animals & Nature',
  4: 'Food & Drink',
  5: 'Travel & Places',
  6: 'Activities',
  7: 'Objects',
  8: 'Symbols',
  9: 'Flags',
};

async function loadStandardEmojis() {
  if (standardEmojisLoaded) return;
  standardEmojisLoaded = true;
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/emojibase-data@7.0.1/en/compact.json');
    const standard = await res.json();
    standardEmojis = standard
      .filter(e => e.unicode && e.group !== 2)
      .map(e => {
        // shortcodes is an array like ["smile", "happy"] — use first as display name
        const codes = Array.isArray(e.shortcodes) && e.shortcodes.length ? e.shortcodes : null;
        const primaryName = codes ? codes[0] : e.label.toLowerCase();
        // searchable string includes all shortcodes + the label
        const searchableName = codes
          ? (codes.join(' ') + ' ' + e.label).toLowerCase()
          : e.label.toLowerCase();
        return {
          type: 'standard',
          char: e.unicode,
          name: primaryName,          // shown in autocomplete & picker tooltip
          searchName: searchableName, // searched against in autocomplete
          group: e.group !== undefined ? e.group : 8,
        };
      });
  } catch (e) {
    console.error('Failed to load standard emojis', e);
  }
}

async function loadCustomEmojis() {
  if (!state.server) return;
  if (customEmojisLoadedForServer === state.server) return;
  try {
    const headers = {};
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const cres = await fetch(`https://${state.server}/api/v1/custom_emojis`, { headers });
    if (cres.ok) {
      const custom = await cres.json();
      customEmojis = custom
        .filter(c => c.visible_in_picker)
        .map(c => ({
          type: 'custom',
          shortcode: c.shortcode,
          url: c.url,
          name: c.shortcode.toLowerCase(),
          group: c.category || 'Custom',
        }))
        .sort((a, b) => {
          if (a.group !== b.group) return a.group.localeCompare(b.group);
          return a.name.localeCompare(b.name);
        });
      customEmojisLoadedForServer = state.server;
    }
  } catch (e) {
    console.error('Failed to load custom emojis', e);
  }
}

/** Call once at boot to wire up search and close behaviour. */
export function initEmojiPicker() {
  const picker = $('emoji-picker');
  const search = $('emoji-search');
  const body = $('emoji-picker-body');

  function renderEmojis(filter = '') {
    body.innerHTML = '';
    const smileys = standardEmojis.filter(e => e.group === 0);
    const otherStandard = standardEmojis.filter(e => e.group !== 0);
    const all = [...smileys, ...customEmojis, ...otherStandard];
    const searchPhrase = filter.toLowerCase().trim();
    const filtered = searchPhrase
      ? all.filter(e => (e.searchName || e.name).includes(searchPhrase)).slice(0, 140)
      : all;

    if (filtered.length === 0) {
      body.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-dim);padding:10px;">No emojis found</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    let currentGroup = null;

    filtered.forEach(e => {
      if (!searchPhrase) {
        let catName = e.type === 'custom' ? e.group : (emojiGroupNames[e.group] || 'Other');
        if (currentGroup !== catName) {
          currentGroup = catName;
          const header = document.createElement('div');
          header.className = 'emoji-category-title';
          header.textContent = catName;
          fragment.appendChild(header);
        }
      }

      const btn = document.createElement('button');
      btn.className = 'emoji-btn';
      btn.title = e.type === 'custom' ? `:${e.shortcode}:` : `:${e.name}:`;

      if (e.type === 'custom') {
        const img = document.createElement('img');
        img.src = e.url;
        img.className = 'emoji-picker-custom-img';
        img.loading = 'lazy';
        btn.appendChild(img);
      } else {
        btn.textContent = e.char;
      }

      btn.onmousedown = (ev) => ev.preventDefault();
      btn.onclick = (ev) => {
        ev.preventDefault();
        if (!emojiPickerTarget) return;
        emojiPickerTarget.focus();

        if (savedSelectionRange) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedSelectionRange);
        }

        if (e.type === 'custom') {
          document.execCommand('insertHTML', false, `&nbsp;<img src="${e.url}" alt=":${e.shortcode}:" class="compose-custom-emoji"/>&nbsp;`);
        } else {
          document.execCommand('insertText', false, e.char);
        }

        const selAfter = window.getSelection();
        if (selAfter.rangeCount > 0) {
          savedSelectionRange = selAfter.getRangeAt(0).cloneRange();
        }

        if (updateCountCallback) updateCountCallback();
        closeEmojiPicker();
      };
      fragment.appendChild(btn);
    });

    body.appendChild(fragment);
  }

  search.addEventListener('input', (e) => renderEmojis(e.target.value));

  document.addEventListener('click', (e) => {
    if (picker.style.display === 'flex' &&
      !picker.contains(e.target) &&
      !e.target.closest('#compose-emoji-btn') &&
      !e.target.closest('#compose-emoji-btn-sidebar')) {
      closeEmojiPicker();
    }
  });

  picker._renderEmojis = renderEmojis;
}

export async function openEmojiPicker(btn, textarea, updateCb) {
  const picker = $('emoji-picker');
  emojiPickerTarget = textarea;
  updateCountCallback = updateCb;

  const rect = btn.getBoundingClientRect();
  picker.style.display = 'flex';
  picker.style.top = (rect.bottom + 250 > window.innerHeight)
    ? (rect.top - 280) + 'px'
    : (rect.bottom + 10) + 'px';
  picker.style.left = Math.max(10, rect.left - 100) + 'px';

  $('emoji-search').value = '';

  if (!standardEmojisLoaded) {
    $('emoji-picker-body').innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-dim);padding:20px;">Loading emojis...</div>';
  }

  await loadStandardEmojis();
  await loadCustomEmojis();
  picker._renderEmojis();
  $('emoji-search').focus();
}

export function closeEmojiPicker() {
  $('emoji-picker').style.display = 'none';
  emojiPickerTarget = null;
  updateCountCallback = null;
}

/* ═══════════════════════════════════════════════════════════════
   EMOJI SHORTCODE AUTOCOMPLETE  (:smile: style inline trigger)
   ═══════════════════════════════════════════════════════════════ */

let emojiAutoSelectedIndex = -1;
let emojiAutoResults = [];
let emojiAutoCurrentTextarea = null;
let emojiAutoCurrentQuery = '';

function getEmojiAllList() {
  const smileys = standardEmojis.filter(e => e.group === 0);
  const otherStd = standardEmojis.filter(e => e.group !== 0);
  return [...smileys, ...customEmojis, ...otherStd];
}

function closeEmojiSuggestions() {
  const el = $('emoji-suggestions');
  if (el) el.style.display = 'none';
  emojiAutoSelectedIndex = -1;
  emojiAutoResults = [];
  emojiAutoCurrentQuery = '';
}

function positionEmojiSuggestions(list) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects();
  if (!rects.length) return;
  const rect = rects[0];
  let top = rect.bottom + 8;
  let left = rect.left;
  const listH = Math.min(300, emojiAutoResults.length * 45);
  if (top + listH > window.innerHeight) top = rect.top - listH - 8;
  if (left + 280 > window.innerWidth) left = window.innerWidth - 290;
  list.style.top = Math.max(8, top) + 'px';
  list.style.left = Math.max(8, left) + 'px';
}

function renderEmojiSuggestions() {
  const list = $('emoji-suggestions');
  if (!list || !emojiAutoResults.length) { closeEmojiSuggestions(); return; }

  list.innerHTML = emojiAutoResults.map((e, i) => {
    const swatch = e.type === 'custom'
      ? `<img src="${e.url}" loading="lazy" />`
      : e.char;
    const label = e.type === 'custom' ? `:${e.shortcode}:` : `:${e.name}:`;
    return `<div class="emoji-suggestion-item${i === 0 ? ' selected' : ''}" data-index="${i}">
      <div class="emoji-suggestion-swatch">${swatch}</div>
      <div class="emoji-suggestion-info">
        <span class="emoji-suggestion-name">${label}</span>
      </div>
    </div>`;
  }).join('');

  list.style.display = 'flex';
  emojiAutoSelectedIndex = 0;
  positionEmojiSuggestions(list);

  list.querySelectorAll('.emoji-suggestion-item').forEach(item => {
    item.onmousedown = ev => ev.preventDefault();
    item.onclick = ev => {
      ev.preventDefault();
      ev.stopPropagation();
      insertEmojiFromSuggestion(parseInt(item.dataset.index));
    };
  });
}

function updateEmojiAutoSelection() {
  const list = $('emoji-suggestions');
  if (!list) return;
  list.querySelectorAll('.emoji-suggestion-item').forEach((item, idx) => {
    item.classList.toggle('selected', idx === emojiAutoSelectedIndex);
    if (idx === emojiAutoSelectedIndex) item.scrollIntoView({ block: 'nearest' });
  });
}

function insertEmojiFromSuggestion(index) {
  const e = emojiAutoResults[index];
  if (!e || !emojiAutoCurrentTextarea) return;

  emojiAutoCurrentTextarea.focus();

  // Restore selection to just before the :query trigger
  if (savedSelectionRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedSelectionRange);
  }

  // Delete the typed `:query` text
  const triggerLen = emojiAutoCurrentQuery.length + 1; // include leading `:`
  for (let i = 0; i < triggerLen; i++) {
    document.execCommand('delete', false);
  }

  // Insert the emoji
  if (e.type === 'custom') {
    document.execCommand('insertHTML', false, `<img src="${e.url}" alt=":${e.shortcode}:" class="compose-custom-emoji"/>`);
  } else {
    document.execCommand('insertText', false, e.char);
  }

  // Update saved range after insertion
  const selAfter = window.getSelection();
  if (selAfter.rangeCount > 0) {
    savedSelectionRange = selAfter.getRangeAt(0).cloneRange();
  }

  closeEmojiSuggestions();
}

async function handleEmojiAutocompleteInput(textarea) {
  const sel = window.getSelection();
  if (!sel.rangeCount) { closeEmojiSuggestions(); return; }
  const range = sel.getRangeAt(0);

  // Get text before cursor — handle both text nodes and element nodes
  let textBefore = '';
  const node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    textBefore = node.textContent.substring(0, range.startOffset);
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    // Collect all text from previous siblings inside the contenteditable
    let combined = '';
    const children = Array.from(node.childNodes).slice(0, range.startOffset);
    children.forEach(child => { combined += child.textContent || ''; });
    textBefore = combined;
  }

  // Match `:` preceded by start-of-string or any non-word char (emoji, space, punctuation…)
  const match = textBefore.match(/(?:^|[^a-zA-Z0-9_]):([a-zA-Z0-9_]{2,})$/);

  if (!match) { closeEmojiSuggestions(); return; }

  const query = match[1].toLowerCase();
  if (query === emojiAutoCurrentQuery) return; // no change
  emojiAutoCurrentQuery = query;
  emojiAutoCurrentTextarea = textarea;

  // Lazily load emoji data if not yet available
  if (!standardEmojisLoaded) await loadStandardEmojis();
  if (state.server && customEmojisLoadedForServer !== state.server) await loadCustomEmojis();

  const all = getEmojiAllList();
  emojiAutoResults = all.filter(e => (e.searchName || e.name).includes(query)).slice(0, 8);
  renderEmojiSuggestions();
}

function handleEmojiAutocompleteKeydown(e) {
  const list = $('emoji-suggestions');
  if (!list || list.style.display === 'none') return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    emojiAutoSelectedIndex = (emojiAutoSelectedIndex + 1) % emojiAutoResults.length;
    updateEmojiAutoSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    emojiAutoSelectedIndex = (emojiAutoSelectedIndex - 1 + emojiAutoResults.length) % emojiAutoResults.length;
    updateEmojiAutoSelection();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (emojiAutoSelectedIndex > -1) {
      e.preventDefault();
      insertEmojiFromSuggestion(emojiAutoSelectedIndex);
    }
  } else if (e.key === 'Escape') {
    closeEmojiSuggestions();
  }
}

export function initEmojiAutocomplete() {
  // Pre-load emoji data so autocomplete is snappy on first use
  loadStandardEmojis();
  if (state.server) loadCustomEmojis();

  const textareas = [$('compose-textarea'), $('compose-textarea-sidebar')];
  textareas.forEach(ta => {
    if (!ta) return;
    ta.addEventListener('input', () => handleEmojiAutocompleteInput(ta));
    ta.addEventListener('keydown', handleEmojiAutocompleteKeydown);
    ta.addEventListener('scroll', closeEmojiSuggestions);
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#emoji-suggestions')) closeEmojiSuggestions();
  });
}

