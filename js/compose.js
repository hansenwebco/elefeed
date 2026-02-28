/**
 * @module compose
 * Compose form for both the mobile drawer and the desktop sidebar.
 * Handles media upload, content warnings, alt text modal, mentions,
 * reply/quote context, and posting.
 */

import { $, state, composeState } from './state.js';
import { apiGet } from './api.js';
import { showToast } from './ui.js';
import { escapeHTML, renderCustomEmojis } from './utils.js';
import { loadFeedTab } from './feed.js';
import { openEmojiPicker, closeEmojiPicker, initEmojiPicker } from './emoji.js';

/* ══════════════════════════════════════════════════════════════════════
   ALT-TEXT MODAL
   ══════════════════════════════════════════════════════════════════════ */

function openAltModal(url, index, suffix, currentDesc) {
  composeState.activeAltIndex = index;
  composeState.activeAltSuffix = suffix;
  $('alt-modal-img').src = url;
  $('alt-modal-input').value = currentDesc || '';
  $('alt-modal-count').textContent = 1500 - (currentDesc || '').length;
  $('alt-text-modal').style.display = 'flex';
  $('alt-modal-input').focus();
}

function closeAltModal() {
  $('alt-text-modal').style.display = 'none';
  composeState.activeAltIndex = -1;
  composeState.activeAltSuffix = '';
}

/* ══════════════════════════════════════════════════════════════════════
   CHARACTER COUNTING
   ══════════════════════════════════════════════════════════════════════ */

export function updateCharCount() {
  const textarea = $('compose-textarea');
  const cwInput = $('compose-cw-input');
  const counter = $('compose-char-count');
  const textLength = textarea.innerText.trim().length;
  const cwLength = cwInput.value.length;
  const remaining = 500 - textLength - cwLength;
  counter.textContent = remaining;
  counter.classList.toggle('warning', remaining <= 50 && remaining > 0);
  counter.classList.toggle('error', remaining < 0);
  $('compose-post-btn').disabled = remaining < 0 || (textLength === 0 && composeState.mediaFiles.length === 0);
}

export function updateSidebarCharCount() {
  const suffix = '-sidebar';
  const textarea = $('compose-textarea' + suffix);
  const cwInput = $('compose-cw-input' + suffix);
  const counter = $('compose-char-count' + suffix);
  const textLength = textarea.innerText.trim().length;
  const cwLength = cwInput.value.length;
  const remaining = 500 - textLength - cwLength;
  counter.textContent = remaining;
  counter.classList.toggle('warning', remaining <= 50 && remaining > 0);
  counter.classList.toggle('error', remaining < 0);
  $('compose-post-btn' + suffix).disabled = remaining < 0 || (textLength === 0 && composeState.sidebarMediaFiles.length === 0);
}

/* ══════════════════════════════════════════════════════════════════════
   REPLY / QUOTE STATE
   ══════════════════════════════════════════════════════════════════════ */

export function resetReplyState() {
  composeState.replyToId = null;
  composeState.replyToAcct = null;
  composeState.quoteId = null;
  composeState.editPostId = null;

  (composeState.mediaUrls || []).forEach(url => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });
  (composeState.sidebarMediaUrls || []).forEach(url => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); });

  composeState.mediaFiles = [];
  composeState.mediaUrls = [];
  composeState.mediaDescriptions = [];
  composeState.mediaIds = [];
  composeState.sidebarMediaFiles = [];
  composeState.sidebarMediaUrls = [];
  composeState.sidebarMediaDescriptions = [];
  composeState.sidebarMediaIds = [];

  ['', '-sidebar'].forEach(suffix => {
    const bar = $('compose-reply-bar' + suffix);
    const nameNode = $('compose-reply-to' + suffix);
    const typeNode = $('compose-context-type' + suffix);
    const textarea = $('compose-textarea' + suffix);
    const postBtn = $('compose-post-btn' + suffix);
    const cwInput = $('compose-cw-input' + suffix);
    const cwSection = $('compose-cw-section' + suffix);
    const cwBtn = $('compose-cw-btn' + suffix);
    const visibility = $('compose-visibility' + suffix);
    const mediaPreview = $('compose-media-preview' + suffix);

    if (bar) bar.style.display = 'none';
    if (nameNode) nameNode.textContent = '';
    if (typeNode) typeNode.textContent = 'Replying to';
    if (textarea) textarea.innerText = '';
    if (postBtn) postBtn.textContent = 'Post';

    if (cwInput) cwInput.value = '';
    if (cwSection) cwSection.style.display = 'none';
    if (cwBtn) cwBtn.classList.remove('active');
    if (visibility) visibility.value = 'public';
    if (mediaPreview) mediaPreview.innerHTML = '';
  });
  if (window.innerWidth > 900) updateSidebarCharCount(); else updateCharCount();
}

// Expose on window so inline onclick="resetReplyState()" on cancel buttons works
window.resetReplyState = resetReplyState;

/* ══════════════════════════════════════════════════════════════════════
   REPLY & QUOTE HANDLERS
   ══════════════════════════════════════════════════════════════════════ */

export function handleReply(postId, acct) {
  composeState.replyToId = postId;
  composeState.replyToAcct = acct;
  const isDesktop = window.innerWidth > 900;
  const suffix = isDesktop ? '-sidebar' : '';
  const textarea = $('compose-textarea' + suffix);
  const bar = $('compose-reply-bar' + suffix);
  const to = $('compose-reply-to' + suffix);

  if (bar && to) {
    const typeNode = $('compose-context-type' + suffix);
    if (typeNode) typeNode.textContent = 'Replying to';
    bar.style.display = 'block';
    to.textContent = '@' + acct;
  }

  const mentionText = `@${acct} `;
  if (!textarea.innerText.includes(mentionText)) {
    textarea.innerText = mentionText + textarea.innerText;
  }

  if (!isDesktop) {
    openComposeDrawer();
  } else {
    textarea.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textarea);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch { }
  }
  if (isDesktop) updateSidebarCharCount(); else updateCharCount();
}

window.toggleBoostMenu = function (postId, triggerBtn) {
  document.querySelectorAll('.boost-dropdown').forEach(m => m.classList.remove('show'));
  const menu = triggerBtn
    ? triggerBtn.parentElement.querySelector('.boost-dropdown')
    : $(`boost-menu-${postId}`);
  if (menu) menu.classList.toggle('show');
};

window.addEventListener('click', () => {
  document.querySelectorAll('.boost-dropdown').forEach(m => m.classList.remove('show'));
});

window.handleQuoteInit = function (postId, acct) {
  document.querySelectorAll('.boost-dropdown').forEach(m => m.classList.remove('show'));
  composeState.quoteId = postId;
  composeState.replyToAcct = acct;
  const isDesktop = window.innerWidth > 900;
  const suffix = isDesktop ? '-sidebar' : '';
  const textarea = $('compose-textarea' + suffix);
  const bar = $('compose-reply-bar' + suffix);
  const to = $('compose-reply-to' + suffix);

  if (bar && to) {
    const typeNode = $('compose-context-type' + suffix);
    if (typeNode) typeNode.textContent = 'Quoting';
    bar.style.display = 'block';
    to.textContent = '@' + acct;
  }

  if (!isDesktop) openComposeDrawer();
  else textarea.focus();
};

window.handleBoostSubmit = async function (postId, isBoosted) {
  document.querySelectorAll('.boost-dropdown').forEach(m => m.classList.remove('show'));
  if (!state.token) { showToast('Please sign in to boost posts.'); return; }

  const endpoint = isBoosted
    ? `/api/v1/statuses/${postId}/unreblog`
    : `/api/v1/statuses/${postId}/reblog`;

  try {
    const res = await fetch(`https://${state.server}${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
    });
    if (!res.ok) throw new Error('Failed to process boost');
    const statusResponse = await res.json();
    const actualStatus = statusResponse.reblog || statusResponse;

    const menuBtn = document.querySelector(`.post-boost-btn[data-post-id="${postId}"]`);
    if (menuBtn) {
      const countSpan = menuBtn.querySelector('.boost-count');
      const isNowBoosted = actualStatus.reblogged === true;
      menuBtn.classList.toggle('boosted', isNowBoosted);
      if (countSpan) countSpan.textContent = (actualStatus.reblogs_count || 0) + (actualStatus.quotes_count || 0);

      const dropdownItems = menuBtn.nextElementSibling.querySelectorAll('.boost-dropdown-item');
      if (dropdownItems.length > 0) {
        const boostDropdownBtn = dropdownItems[0];
        boostDropdownBtn.setAttribute('onclick', `event.stopPropagation(); window.handleBoostSubmit('${postId}', ${isNowBoosted})`);
        const textSpan = boostDropdownBtn.querySelector('span:not(.dropdown-stat-count)');
        if (textSpan) textSpan.textContent = isNowBoosted ? 'Undo Boost' : 'Boost';
        const countNode = boostDropdownBtn.querySelector('.dropdown-stat-count');
        if (countNode) countNode.textContent = actualStatus.reblogs_count || 0;
      }
    }
  } catch (e) {
    showToast('Error updating boost: ' + e.message);
  }
};

window.togglePostMenu = function (postId, triggerBtn) {
  document.querySelectorAll('.post-dropdown').forEach(m => m.classList.remove('show'));
  const menu = triggerBtn
    ? triggerBtn.parentElement.querySelector('.post-dropdown')
    : $(`post-menu-${postId}`);
  if (menu) menu.classList.toggle('show');
};

window.addEventListener('click', () => {
  document.querySelectorAll('.post-dropdown').forEach(m => m.classList.remove('show'));
});

window.handleEditInit = async function (postId) {
  document.querySelectorAll('.post-dropdown').forEach(m => m.classList.remove('show'));
  if (!state.token) { showToast('Please sign in to edit posts.'); return; }

  try {
    const [statusResponse, sourceResponse] = await Promise.all([
      apiGet(`/api/v1/statuses/${postId}`, state.token),
      apiGet(`/api/v1/statuses/${postId}/source`, state.token)
    ]);

    const isDesktop = window.innerWidth > 900;
    const suffix = isDesktop ? '-sidebar' : '';

    composeState.editPostId = postId;
    composeState.replyToId = null;
    composeState.replyToAcct = null;
    composeState.quoteId = null;

    const textarea = $('compose-textarea' + suffix);
    textarea.innerText = sourceResponse.text || '';

    const cwInput = $('compose-cw-input' + suffix);
    const cwSection = $('compose-cw-section' + suffix);
    const cwBtn = $('compose-cw-btn' + suffix);
    if (sourceResponse.spoiler_text) {
      cwInput.value = sourceResponse.spoiler_text;
      cwSection.style.display = 'block';
      cwBtn.classList.add('active');
    } else {
      cwInput.value = '';
      cwSection.style.display = 'none';
      cwBtn.classList.remove('active');
    }

    const visibilitySelect = $('compose-visibility' + suffix);
    if (statusResponse.visibility) visibilitySelect.value = statusResponse.visibility;

    const mediaFilesKey = suffix === '-sidebar' ? 'sidebarMediaFiles' : 'mediaFiles';
    const mediaUrlsKey = suffix === '-sidebar' ? 'sidebarMediaUrls' : 'mediaUrls';
    const mediaDescsKey = suffix === '-sidebar' ? 'sidebarMediaDescriptions' : 'mediaDescriptions';
    const mediaIdsKey = suffix === '-sidebar' ? 'sidebarMediaIds' : 'mediaIds';

    composeState[mediaFilesKey] = [];
    composeState[mediaUrlsKey] = [];
    composeState[mediaDescsKey] = [];
    composeState[mediaIdsKey] = [];
    const preview = $('compose-media-preview' + suffix);
    preview.innerHTML = '';

    if (statusResponse.media_attachments) {
      statusResponse.media_attachments.forEach(m => {
        composeState[mediaFilesKey].push(null);
        composeState[mediaUrlsKey].push(m.url);
        composeState[mediaDescsKey].push(m.description || '');
        composeState[mediaIdsKey].push(m.id);

        const item = document.createElement('div');
        item.className = 'compose-media-item';

        const isVideo = m.type === 'video' || m.type === 'gifv';
        const mediaEl = isVideo ? document.createElement('video') : document.createElement('img');
        mediaEl.src = m.preview_url || m.url;
        if (isVideo) mediaEl.muted = true;

        const altBtn = document.createElement('button');
        altBtn.className = 'compose-media-item-alt-btn' + (!m.description ? ' missing' : '');
        altBtn.textContent = 'ALT';
        altBtn.onclick = () => {
          const idx = composeState[mediaUrlsKey].indexOf(m.url);
          openAltModal(m.url, idx, suffix, composeState[mediaDescsKey][idx]);
        };

        const removeBtn = document.createElement('button');
        removeBtn.className = 'compose-media-remove';
        removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        removeBtn.onclick = () => {
          const index = composeState[mediaUrlsKey].indexOf(m.url);
          if (index > -1) {
            composeState[mediaFilesKey].splice(index, 1);
            composeState[mediaUrlsKey].splice(index, 1);
            composeState[mediaDescsKey].splice(index, 1);
            composeState[mediaIdsKey].splice(index, 1);
          }
          item.remove();
          if (isDesktop) updateSidebarCharCount(); else updateCharCount();
        };

        item.appendChild(mediaEl);
        if (!isVideo) item.appendChild(altBtn);
        item.appendChild(removeBtn);
        preview.appendChild(item);
      });
    }

    const bar = $('compose-reply-bar' + suffix);
    const to = $('compose-reply-to' + suffix);
    if (bar && to) {
      const typeNode = $('compose-context-type' + suffix);
      if (typeNode) typeNode.textContent = 'Editing post';
      bar.style.display = 'block';
      to.textContent = '';
    }
    const postBtn = $('compose-post-btn' + suffix);
    if (postBtn) postBtn.textContent = 'Edit';

    if (!isDesktop) openComposeDrawer();
    else {
      textarea.focus();
    }
    if (isDesktop) updateSidebarCharCount(); else updateCharCount();
  } catch (err) {
    showToast('Could not fetch post source: ' + err.message);
  }
};

/* ══════════════════════════════════════════════════════════════════════
   COMPOSE DRAWER (mobile)
   ══════════════════════════════════════════════════════════════════════ */

export function openComposeDrawer() {
  const drawer = $('compose-drawer');
  const backdrop = $('compose-backdrop');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  if (window.innerWidth <= 900) {
    document.body.style.overflow = 'hidden';
    // Push history state for back button
    history.pushState({ drawer: 'compose-drawer' }, '', '');
  }
  setTimeout(() => $('compose-textarea').focus(), 300);
}

export function closeComposeDrawer() {
  const drawer = $('compose-drawer');
  const backdrop = $('compose-backdrop');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
  $('compose-textarea').blur();

  resetReplyState();
}

/* ══════════════════════════════════════════════════════════════════════
   POSTING
   ══════════════════════════════════════════════════════════════════════ */

async function doPost(suffix = '') {
  const btn = $('compose-post-btn' + suffix);
  const textarea = $('compose-textarea' + suffix);
  const cwInput = $('compose-cw-input' + suffix);
  const visibility = $('compose-visibility' + suffix).value;
  const status = textarea.innerText.trim();
  const spoilerText = cwInput.value.trim();

  const isSidebar = suffix === '-sidebar';
  const mediaFiles = isSidebar ? composeState.sidebarMediaFiles : composeState.mediaFiles;
  const mediaDescriptions = isSidebar ? composeState.sidebarMediaDescriptions : composeState.mediaDescriptions;
  const existingMediaIds = isSidebar ? composeState.sidebarMediaIds : composeState.mediaIds;

  if (!status && mediaFiles.length === 0) return;

  btn.disabled = true;
  btn.textContent = 'Posting...';

  try {
    const finalMediaIds = [];
    const mediaAttributes = [];

    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      const desc = mediaDescriptions[i];

      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        if (desc) formData.append('description', desc);
        const res = await fetch(`https://${state.server}/api/v1/media`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` },
          body: formData,
        });
        if (!res.ok) throw new Error('Failed to upload media');
        const media = await res.json();
        finalMediaIds.push(media.id);
        mediaAttributes.push({ id: media.id, description: desc || '' });
      } else {
        const existingId = existingMediaIds[i];
        finalMediaIds.push(existingId);
        mediaAttributes.push({ id: existingId, description: desc || '' });
      }
    }

    const postData = { status, visibility };
    if (!composeState.editPostId) {
      if (composeState.replyToId) postData.in_reply_to_id = composeState.replyToId;
      if (composeState.quoteId) postData.quoted_status_id = composeState.quoteId;
    }
    if (spoilerText) postData.spoiler_text = spoilerText;
    if (finalMediaIds.length) {
      postData.media_ids = finalMediaIds;
      postData.media_attributes = mediaAttributes;
    }

    let method = 'POST';
    let endpoint = `/api/v1/statuses`;
    if (composeState.editPostId) {
      method = 'PUT';
      endpoint = `/api/v1/statuses/${composeState.editPostId}`;
    }

    const res = await fetch(`https://${state.server}${endpoint}`, {
      method,
      headers: { 'Authorization': `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(postData),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to post');
    }

    showToast('Posted successfully!');

    // Form reset happens largely via resetReplyState
    resetReplyState();

    if (!isSidebar) closeComposeDrawer();
    if (state.activeTab === 'feed') loadFeedTab(false);
  } catch (err) {
    showToast('Failed to post: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Post';
  }
}

/* ══════════════════════════════════════════════════════════════════════
   MENTION AUTOCOMPLETE
   ══════════════════════════════════════════════════════════════════════ */

let mentionActiveRequest = null;
let mentionCurrentQuery = '';
let mentionTargetTextarea = null;
let mentionSuggestions = [];
let mentionSelectedIndex = -1;
let mentionDebounceTimer = null;

function initMentionAutocomplete() {
  const t1 = $('compose-textarea');
  const t2 = $('compose-textarea-sidebar');
  const list = $('mention-suggestions');

  [t1, t2].forEach(textarea => {
    if (!textarea) return;
    textarea.addEventListener('input', (e) => handleMentionInput(e, textarea));
    textarea.addEventListener('keydown', (e) => handleMentionKeydown(e, textarea));
    textarea.addEventListener('scroll', closeMentionSuggestions);
  });

  document.addEventListener('click', (e) => { if (!list.contains(e.target)) closeMentionSuggestions(); });
  window.addEventListener('scroll', closeMentionSuggestions, { passive: true });
}

function handleMentionInput(e, textarea) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.startContainer.nodeType !== Node.TEXT_NODE) { closeMentionSuggestions(); return; }
  const textBefore = range.startContainer.textContent.substring(0, range.startOffset);
  const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);

  clearTimeout(mentionDebounceTimer);

  if (match) {
    mentionCurrentQuery = match[1];
    mentionTargetTextarea = textarea;
    mentionDebounceTimer = setTimeout(() => {
      fetchMentions(mentionCurrentQuery);
    }, 300);
  } else {
    closeMentionSuggestions();
  }
}

async function fetchMentions(q) {
  if (mentionActiveRequest) mentionActiveRequest.abort();
  const controller = new AbortController();
  mentionActiveRequest = controller;
  try {
    const results = await apiGet(`/api/v1/accounts/search?q=${encodeURIComponent(q)}&limit=5&following=true`, state.token, null, controller.signal);
    mentionSuggestions = results;
    renderMentionSuggestions(results);
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('Mention search failed:', err);
  }
}

function renderMentionSuggestions(users) {
  const list = $('mention-suggestions');
  if (!users.length) { closeMentionSuggestions(); return; }

  list.innerHTML = users.map((u, i) => `
    <div class="mention-item ${i === 0 ? 'selected' : ''}" data-index="${i}" data-acct="${escapeHTML(u.acct)}">
      <img src="${u.avatar_static || u.avatar}" class="mention-avatar" loading="lazy" />
      <div class="mention-info">
        <span class="mention-name">${renderCustomEmojis(u.display_name || u.username, u.emojis)}</span>
        <span class="mention-acct">@${escapeHTML(u.acct)}</span>
      </div>
    </div>
  `).join('');

  list.style.display = 'flex';
  mentionSelectedIndex = users.length > 0 ? 0 : -1;

  const sel = window.getSelection();
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    if (rects.length > 0) {
      const rect = rects[0];
      let top = rect.bottom + 10;
      let left = rect.left;
      if (left + 280 > window.innerWidth) left = window.innerWidth - 290;
      if (top + 300 > window.innerHeight) top = rect.top - (users.length * 52) - 10;
      list.style.top = top + 'px';
      list.style.left = Math.max(10, left) + 'px';
    }
  }

  list.querySelectorAll('.mention-item').forEach(item => {
    item.onmousedown = (e) => e.preventDefault();
    item.onclick = (e) => { e.preventDefault(); e.stopPropagation(); insertMention(item.dataset.acct); };
  });
}

function handleMentionKeydown(e) {
  const list = $('mention-suggestions');
  if (list.style.display === 'none') return;
  if (e.key === 'ArrowDown') { e.preventDefault(); moveMentionSelection(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveMentionSelection(-1); }
  else if (e.key === 'Enter' || e.key === 'Tab') {
    if (mentionSelectedIndex > -1) { e.preventDefault(); insertMention(mentionSuggestions[mentionSelectedIndex].acct); }
  } else if (e.key === 'Escape') closeMentionSuggestions();
}

function moveMentionSelection(dir) {
  const items = $('mention-suggestions').querySelectorAll('.mention-item');
  if (!items.length) return;
  items[mentionSelectedIndex]?.classList.remove('selected');
  mentionSelectedIndex = (mentionSelectedIndex + dir + items.length) % items.length;
  items[mentionSelectedIndex].classList.add('selected');
  items[mentionSelectedIndex].scrollIntoView({ block: 'nearest' });
}

function insertMention(acct) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const text = node.textContent;
  const textBefore = text.substring(0, range.startOffset);
  const match = textBefore.match(/@([a-zA-Z0-9_]*)$/);
  if (match) {
    const startPos = match.index + (match[0].startsWith('@') ? 0 : 1);
    const newRange = document.createRange();
    newRange.setStart(node, startPos);
    newRange.setEnd(node, range.startOffset);
    sel.removeAllRanges();
    sel.addRange(newRange);
    document.execCommand('insertText', false, `@${acct} `);
  }
  closeMentionSuggestions();
  if (mentionTargetTextarea === $('compose-textarea')) updateCharCount();
  else updateSidebarCharCount();
}

function closeMentionSuggestions() {
  $('mention-suggestions').style.display = 'none';
  mentionSelectedIndex = -1;
  if (mentionActiveRequest) mentionActiveRequest.abort();
  mentionActiveRequest = null;
}

/* ══════════════════════════════════════════════════════════════════════
   HASHTAG AUTOCOMPLETE
   ══════════════════════════════════════════════════════════════════════ */

let hashtagActiveRequest = null;
let hashtagCurrentQuery = '';
let hashtagTargetTextarea = null;
let hashtagSuggestions = [];
let hashtagSelectedIndex = -1;
let hashtagDebounceTimer = null;

function initHashtagAutocomplete() {
  const t1 = $('compose-textarea');
  const t2 = $('compose-textarea-sidebar');
  const list = $('hashtag-suggestions');

  [t1, t2].forEach(textarea => {
    if (!textarea) return;
    textarea.addEventListener('input', (e) => handleHashtagInput(e, textarea));
    textarea.addEventListener('keydown', (e) => handleHashtagKeydown(e, textarea));
    textarea.addEventListener('scroll', closeHashtagSuggestions);
  });

  document.addEventListener('click', (e) => { if (!list.contains(e.target)) closeHashtagSuggestions(); });
  window.addEventListener('scroll', closeHashtagSuggestions, { passive: true });
}

function handleHashtagInput(e, textarea) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.startContainer.nodeType !== Node.TEXT_NODE) { closeHashtagSuggestions(); return; }
  const textBefore = range.startContainer.textContent.substring(0, range.startOffset);
  const match = textBefore.match(/(?:^|\s)#([a-zA-Z0-9_]*)$/);

  clearTimeout(hashtagDebounceTimer);

  if (match) {
    hashtagCurrentQuery = match[1];
    hashtagTargetTextarea = textarea;
    hashtagDebounceTimer = setTimeout(() => {
      fetchHashtags(hashtagCurrentQuery);
    }, 300);
  } else {
    closeHashtagSuggestions();
  }
}

async function fetchHashtags(q) {
  if (hashtagActiveRequest) hashtagActiveRequest.abort();
  const controller = new AbortController();
  hashtagActiveRequest = controller;
  try {
    const results = await apiGet(`/api/v2/search?q=${encodeURIComponent(q)}&type=hashtags&limit=5`, state.token, null, controller.signal);
    const tags = results.hashtags || [];
    hashtagSuggestions = tags;
    renderHashtagSuggestions(tags);
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('Hashtag search failed:', err);
  }
}

function renderHashtagSuggestions(tags) {
  const list = $('hashtag-suggestions');
  if (!tags.length) { closeHashtagSuggestions(); return; }

  list.innerHTML = tags.map((t, i) => `
    <div class="hashtag-item ${i === 0 ? 'selected' : ''}" data-index="${i}" data-tag="${escapeHTML(t.name)}">
      <div class="hashtag-icon">#</div>
      <div class="hashtag-info">
        <span class="hashtag-name">#${escapeHTML(t.name)}</span>
        <span class="hashtag-uses">${t.history ? t.history.reduce((sum, day) => sum + parseInt(day.uses || 0), 0) : ''} uses this week</span>
      </div>
    </div>
  `).join('');

  list.style.display = 'flex';
  hashtagSelectedIndex = tags.length > 0 ? 0 : -1;

  const sel = window.getSelection();
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    if (rects.length > 0) {
      const rect = rects[0];
      let top = rect.bottom + 10;
      let left = rect.left;
      if (left + 280 > window.innerWidth) left = window.innerWidth - 290;
      if (top + 300 > window.innerHeight) top = rect.top - (tags.length * 52) - 10;
      list.style.top = top + 'px';
      list.style.left = Math.max(10, left) + 'px';
    }
  }

  list.querySelectorAll('.hashtag-item').forEach(item => {
    item.onmousedown = (e) => e.preventDefault();
    item.onclick = (e) => { e.preventDefault(); e.stopPropagation(); insertHashtag(item.dataset.tag); };
  });
}

function handleHashtagKeydown(e) {
  const list = $('hashtag-suggestions');
  if (list.style.display === 'none') return;
  if (e.key === 'ArrowDown') { e.preventDefault(); moveHashtagSelection(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveHashtagSelection(-1); }
  else if (e.key === 'Enter' || e.key === 'Tab') {
    if (hashtagSelectedIndex > -1) { e.preventDefault(); insertHashtag(hashtagSuggestions[hashtagSelectedIndex].name); }
  } else if (e.key === 'Escape') closeHashtagSuggestions();
}

function moveHashtagSelection(dir) {
  const items = $('hashtag-suggestions').querySelectorAll('.hashtag-item');
  if (!items.length) return;
  items[hashtagSelectedIndex]?.classList.remove('selected');
  hashtagSelectedIndex = (hashtagSelectedIndex + dir + items.length) % items.length;
  items[hashtagSelectedIndex].classList.add('selected');
  items[hashtagSelectedIndex].scrollIntoView({ block: 'nearest' });
}

function insertHashtag(tag) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const text = node.textContent;
  const textBefore = text.substring(0, range.startOffset);
  const match = textBefore.match(/#([a-zA-Z0-9_]*)$/);
  if (match) {
    const startPos = match.index + (match[0].startsWith('#') ? 0 : 1);
    const newRange = document.createRange();
    newRange.setStart(node, startPos);
    newRange.setEnd(node, range.startOffset);
    sel.removeAllRanges();
    sel.addRange(newRange);
    document.execCommand('insertText', false, `#${tag} `);
  }
  closeHashtagSuggestions();
  if (hashtagTargetTextarea === $('compose-textarea')) updateCharCount();
  else updateSidebarCharCount();
}

function closeHashtagSuggestions() {
  $('hashtag-suggestions').style.display = 'none';
  hashtagSelectedIndex = -1;
  if (hashtagActiveRequest) hashtagActiveRequest.abort();
  hashtagActiveRequest = null;
}

/* ══════════════════════════════════════════════════════════════════════
   MEDIA UPLOAD HELPER (used by both drawer and sidebar)
   ══════════════════════════════════════════════════════════════════════ */

function wireMediaUpload(suffix) {
  const mediaFilesKey = suffix === '-sidebar' ? 'sidebarMediaFiles' : 'mediaFiles';
  const mediaUrlsKey = suffix === '-sidebar' ? 'sidebarMediaUrls' : 'mediaUrls';
  const mediaDescsKey = suffix === '-sidebar' ? 'sidebarMediaDescriptions' : 'mediaDescriptions';
  const countFn = suffix === '-sidebar' ? updateSidebarCharCount : updateCharCount;

  $('compose-media-btn' + suffix).addEventListener('click', () => {
    $('compose-media-input' + suffix).click();
  });

  $('compose-media-input' + suffix).addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const available = 4 - composeState[mediaFilesKey].length;
    const toAdd = files.slice(0, available);

    toAdd.forEach(file => {
      composeState[mediaFilesKey].push(file);
      const url = URL.createObjectURL(file);
      composeState[mediaUrlsKey].push(url);
      composeState[mediaDescsKey].push('');

      const preview = $('compose-media-preview' + suffix);
      const item = document.createElement('div');
      item.className = 'compose-media-item';

      const isVideo = file.type.startsWith('video/');
      const mediaEl = isVideo ? document.createElement('video') : document.createElement('img');
      mediaEl.src = url;
      if (isVideo) mediaEl.muted = true;

      const altBtn = document.createElement('button');
      altBtn.className = 'compose-media-item-alt-btn missing';
      altBtn.textContent = 'ALT';
      altBtn.onclick = () => {
        const idx = composeState[mediaUrlsKey].indexOf(url);
        openAltModal(url, idx, suffix, composeState[mediaDescsKey][idx]);
      };

      const removeBtn = document.createElement('button');
      removeBtn.className = 'compose-media-remove';
      removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      removeBtn.onclick = () => {
        const index = composeState[mediaUrlsKey].indexOf(url);
        if (index > -1) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url);
          composeState[mediaFilesKey].splice(index, 1);
          composeState[mediaUrlsKey].splice(index, 1);
          composeState[mediaDescsKey].splice(index, 1);
          const idsList = composeState[mediaFilesKey === 'mediaFiles' ? 'mediaIds' : 'sidebarMediaIds'];
          if (idsList) idsList.splice(index, 1);
        }
        item.remove();
        countFn();
      };

      item.appendChild(mediaEl);
      if (!isVideo) item.appendChild(altBtn);
      item.appendChild(removeBtn);
      preview.appendChild(item);
    });

    countFn();
    e.target.value = '';
  });
}

/* ══════════════════════════════════════════════════════════════════════
   CONTENT-EDITABLE PASTE HANDLER
   ══════════════════════════════════════════════════════════════════════ */

function setupContentEditable(editor) {
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.originalEvent || e).clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });
}

/* ══════════════════════════════════════════════════════════════════════
   HASHTAG TAB
   ══════════════════════════════════════════════════════════════════════ */

function setupHashtagTab() {
  const input = $('hashtag-search-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = input.value.trim().replace(/^#/, '');
        if (val) {
          state.selectedHashtagFilter = val.toLowerCase();
          loadFeedTab();
          input.value = '';
        }
      }
    });
  }

  const followBtn = $('hashtag-follow-btn');
  if (followBtn) {
    // import handleHashtagFollowToggle at call time to avoid circular import
    followBtn.addEventListener('click', async () => {
      const { handleHashtagFollowToggle } = await import('./profile.js');
      handleHashtagFollowToggle(followBtn);
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   INIT (called once from app.js)
   ══════════════════════════════════════════════════════════════════════ */

export function initCompose() {
  // --- Alt text modal ---
  $('alt-modal-close').addEventListener('click', closeAltModal);
  $('alt-modal-cancel').addEventListener('click', closeAltModal);
  $('alt-modal-input').addEventListener('input', (e) => {
    let val = e.target.value;
    if (val.length > 1500) { e.target.value = val.slice(0, 1500); val = e.target.value; }
    $('alt-modal-count').textContent = 1500 - val.length;
  });
  $('alt-modal-save').addEventListener('click', () => {
    const idx = composeState.activeAltIndex;
    const sfx = composeState.activeAltSuffix;
    const desc = $('alt-modal-input').value.trim();
    if (idx > -1) {
      if (sfx === '-sidebar') composeState.sidebarMediaDescriptions[idx] = desc;
      else composeState.mediaDescriptions[idx] = desc;
      const preview = $('compose-media-preview' + sfx);
      if (preview && preview.children[idx]) {
        const btn = preview.children[idx].querySelector('.compose-media-item-alt-btn');
        if (btn) { btn.classList.toggle('missing', !desc); btn.textContent = 'ALT'; }
      }
    }
    closeAltModal();
  });

  // --- Drawer compose ---
  $('compose-btn').addEventListener('click', openComposeDrawer);
  $('compose-close').addEventListener('click', closeComposeDrawer);
  $('compose-backdrop').addEventListener('click', closeComposeDrawer);
  $('compose-backdrop').addEventListener('touchend', closeComposeDrawer);
  $('compose-textarea').addEventListener('input', updateCharCount);
  $('compose-cw-input').addEventListener('input', updateCharCount);
  $('compose-cw-btn').addEventListener('click', () => {
    const section = $('compose-cw-section');
    const btn = $('compose-cw-btn');
    const isVisible = section.style.display !== 'none';
    section.style.display = isVisible ? 'none' : 'block';
    btn.classList.toggle('active', !isVisible);
    if (!isVisible) $('compose-cw-input').focus();
    else { $('compose-cw-input').value = ''; updateCharCount(); }
  });
  wireMediaUpload('');
  $('compose-emoji-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openEmojiPicker(e.currentTarget, $('compose-textarea'), updateCharCount);
  });
  $('compose-post-btn').addEventListener('click', () => doPost(''));

  // --- Sidebar compose ---
  $('hashtag-filter-select').addEventListener('change', (e) => {
    state.selectedHashtagFilter = e.target.value;
    loadFeedTab();
  });
  $('compose-textarea-sidebar').addEventListener('input', updateSidebarCharCount);
  $('compose-cw-input-sidebar').addEventListener('input', updateSidebarCharCount);
  $('compose-cw-btn-sidebar').addEventListener('click', () => {
    const section = $('compose-cw-section-sidebar');
    const btn = $('compose-cw-btn-sidebar');
    const isVisible = section.style.display !== 'none';
    section.style.display = isVisible ? 'none' : 'block';
    btn.classList.toggle('active', !isVisible);
    if (!isVisible) $('compose-cw-input-sidebar').focus();
    else { $('compose-cw-input-sidebar').value = ''; updateSidebarCharCount(); }
  });
  wireMediaUpload('-sidebar');
  $('compose-emoji-btn-sidebar').addEventListener('click', (e) => {
    e.stopPropagation();
    openEmojiPicker(e.currentTarget, $('compose-textarea-sidebar'), updateSidebarCharCount);
  });
  $('compose-post-btn-sidebar').addEventListener('click', () => doPost('-sidebar'));

  // --- Content-editable paste ---
  setupContentEditable($('compose-textarea'));
  setupContentEditable($('compose-textarea-sidebar'));

  // --- Hashtag tab ---
  setupHashtagTab();

  // --- Emoji picker ---
  initEmojiPicker();

  // --- Mention autocomplete ---
  initMentionAutocomplete();
  initHashtagAutocomplete();
}
