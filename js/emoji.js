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
      .map(e => ({
        type: 'standard',
        char: e.unicode,
        name: e.label.toLowerCase(),
        group: e.group !== undefined ? e.group : 8,
      }));
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
    const all = [...customEmojis, ...standardEmojis];
    const searchPhrase = filter.toLowerCase().trim();
    const filtered = searchPhrase
      ? all.filter(e => e.name.includes(searchPhrase)).slice(0, 140)
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
      btn.title = e.type === 'custom' ? `:${e.shortcode}:` : e.name;

      if (e.type === 'custom') {
        const img = document.createElement('img');
        img.src = e.url;
        img.style.cssText = 'width:24px;height:24px;object-fit:contain';
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
        if (e.type === 'custom') {
          document.execCommand('insertHTML', false, `&nbsp;<img src="${e.url}" alt=":${e.shortcode}:" class="compose-custom-emoji"/>&nbsp;`);
        } else {
          document.execCommand('insertText', false, e.char);
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
