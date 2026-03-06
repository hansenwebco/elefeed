/**
 * @module compose
 * Compose form for both the mobile drawer and the desktop sidebar.
 * Handles media upload, content warnings, alt text modal, mentions,
 * reply/quote context, and posting.
 */

import { $, state, composeState } from './state.js';
import { apiGet } from './api.js';
import { showToast } from './ui.js';
import { escapeHTML, renderCustomEmojis, placeCursorAtEnd } from './utils.js';
import { loadFeedTab } from './feed.js';
import { updateCurrentThread } from './thread.js';
import { openEmojiPicker, closeEmojiPicker, initEmojiPicker, initEmojiAutocomplete } from './emoji.js';

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
  const maxChars = state.maxTootChars || 500;
  const remaining = maxChars - textLength - cwLength;
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
  const maxChars = state.maxTootChars || 500;
  const remaining = maxChars - textLength - cwLength;
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
    const visBtn = $('compose-visibility-btn' + suffix);
    const mediaPreview = $('compose-media-preview' + suffix);

    if (bar) bar.style.display = 'none';
    if (nameNode) nameNode.textContent = '';
    if (typeNode) typeNode.textContent = 'Replying to';
    if (textarea) textarea.innerText = '';
    if (postBtn) postBtn.textContent = 'Post';

    if (cwInput) cwInput.value = '';
    if (cwSection) cwSection.style.display = 'none';
    if (cwBtn) cwBtn.classList.remove('active');

    if (visBtn) {
      visBtn.dataset.visibility = 'public';
      visBtn.dataset.quote = 'public';
      visBtn.disabled = false;
      visBtn.title = "";
      visBtn.style.opacity = '1';
      const icon = $('compose-visibility-icon' + suffix);
      const text = $('compose-visibility-text' + suffix);
      if (icon) icon.textContent = '🌐';
      if (text) text.textContent = 'Public, quotes allowed';
    }

    if (mediaPreview) mediaPreview.innerHTML = '';
  });
  if (window.innerWidth > 900) updateSidebarCharCount(); else updateCharCount();
}

// Expose on window so inline onclick="resetReplyState()" on cancel buttons works
window.resetReplyState = resetReplyState;

/* ══════════════════════════════════════════════════════════════════════
   VISIBILITY MODAL
   ══════════════════════════════════════════════════════════════════════ */

window.openVisibilityModal = function (suffix) {
  composeState.activeVisibilitySuffix = suffix;
  const visBtn = $('compose-visibility-btn' + suffix);
  if (visBtn) {
    $('modal-visibility-select').value = visBtn.dataset.visibility || 'public';
    $('modal-quote-select').value = visBtn.dataset.quote || 'public';
  }
  window.handleModalVisibilityChange(); // init disabled state
  $('visibility-modal').style.display = 'flex';
};

window.closeVisibilityModal = function () {
  $('visibility-modal').style.display = 'none';
  composeState.activeVisibilitySuffix = '';
};

window.saveVisibilityModal = function () {
  const suffix = composeState.activeVisibilitySuffix || '';
  const visBtn = $('compose-visibility-btn' + suffix);
  if (visBtn) {
    const vis = $('modal-visibility-select').value;
    const quote = $('modal-quote-select').value;
    visBtn.dataset.visibility = vis;
    visBtn.dataset.quote = quote;

    const icons = { 'public': '🌐', 'unlisted': '🔓', 'private': '🔒', 'direct': '✉️' };
    const visLabels = { 'public': 'Public', 'unlisted': 'Unlisted', 'private': 'Followers', 'direct': 'Direct' };
    const quoteLabels = { 'public': 'quotes allowed', 'followers': 'quotes limited', 'nobody': 'quotes disabled' };
    const iconNode = $('compose-visibility-icon' + suffix);
    const textNode = $('compose-visibility-text' + suffix);
    if (iconNode) iconNode.textContent = icons[vis] || '🌐';
    if (textNode) textNode.textContent = `${visLabels[vis] || 'Public'}, ${quoteLabels[quote] || 'quotes allowed'}`;
  }
  window.closeVisibilityModal();
};

window.handleModalVisibilityChange = function () {
  const vis = $('modal-visibility-select').value;
  const quote = $('modal-quote-select');
  if (vis === 'private' || vis === 'direct') {
    quote.value = 'nobody';
    quote.disabled = true;
  } else {
    quote.disabled = false;
  }
};

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

  const mentionText = `@${acct}\u00A0`;
  if (!textarea.innerText.includes(mentionText.trim())) {
    textarea.innerText = mentionText + textarea.innerText;
  }

  if (!isDesktop) {
    openComposeDrawer();
  } else {
    placeCursorAtEnd(textarea);
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
  else placeCursorAtEnd(textarea);
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
    textarea.innerText = (sourceResponse.text || '') + '\u00A0';

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

    const visBtn = $('compose-visibility-btn' + suffix);
    if (visBtn) {
      const vis = statusResponse.visibility || 'public';
      visBtn.dataset.visibility = vis;

      const icons = { 'public': '🌐', 'unlisted': '🔓', 'private': '🔒', 'direct': '✉️' };
      const visLabels = { 'public': 'Public', 'unlisted': 'Unlisted', 'private': 'Followers', 'direct': 'Direct' };
      const quoteLabels = { 'public': 'quotes allowed', 'followers': 'quotes limited', 'nobody': 'quotes disabled' };

      let finalQuote = 'public';
      if (vis === 'private' || vis === 'direct') {
        finalQuote = 'nobody';
      } else {
        let policy = statusResponse.quote_approval_policy || sourceResponse.quote_approval_policy;
        if (!policy && statusResponse.quote_approval && statusResponse.quote_approval.automatic) {
          const autoList = statusResponse.quote_approval.automatic;
          if (autoList.includes('public')) policy = 'public';
          else if (autoList.includes('followers')) policy = 'followers';
          else policy = 'nobody';
        }
        finalQuote = policy || 'public';
      }
      visBtn.dataset.quote = finalQuote;
      visBtn.disabled = true;
      visBtn.title = "Visibility cannot be changed while editing";
      visBtn.style.opacity = '0.5';

      const iconNode = $('compose-visibility-icon' + suffix);
      const textNode = $('compose-visibility-text' + suffix);
      if (iconNode) iconNode.textContent = icons[vis] || '🌐';
      if (textNode) textNode.textContent = `${visLabels[vis] || 'Public'}, ${quoteLabels[finalQuote] || 'quotes allowed'}`;
    }

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
      placeCursorAtEnd(textarea);
    }
    if (isDesktop) updateSidebarCharCount(); else updateCharCount();
  } catch (err) {
    showToast('Could not fetch post source: ' + err.message);
  }
};

/* ══════════════════════════════════════════════════════════════════════
   CONFIRM DIALOG
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Show a styled confirm dialog.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} opts.confirmLabel
 * @param {string} [opts.confirmClass]  extra CSS class on the confirm button
 * @returns {Promise<boolean>}  resolves true if confirmed, false if cancelled
 */
function showConfirmDialog({ title, message, confirmLabel, confirmClass = '' }) {
  return new Promise(resolve => {
    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    dialog.innerHTML = `
      <div class="confirm-dialog-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <div class="confirm-dialog-body">
        <div class="confirm-dialog-title">${title}</div>
        <div class="confirm-dialog-message">${message}</div>
        <div class="confirm-dialog-actions">
          <button class="confirm-dialog-btn confirm-dialog-btn--cancel" id="confirm-cancel-btn">Cancel</button>
          <button class="confirm-dialog-btn confirm-dialog-btn--confirm ${confirmClass}" id="confirm-ok-btn">${confirmLabel}</button>
        </div>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('confirm-overlay--open'));
    });

    const cleanup = (result) => {
      overlay.classList.remove('confirm-overlay--open');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
      setTimeout(() => overlay.remove(), 300);
      resolve(result);
    };

    dialog.querySelector('#confirm-ok-btn').addEventListener('click', () => cleanup(true));
    dialog.querySelector('#confirm-cancel-btn').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    const handleEsc = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', handleEsc); cleanup(false); } };
    document.addEventListener('keydown', handleEsc);
  });
}

/* ══════════════════════════════════════════════════════════════════════
   DELETE  /  DELETE & REDRAFT
   ══════════════════════════════════════════════════════════════════════ */

window.handleDeleteInit = async function (postId) {
  document.querySelectorAll('.post-dropdown').forEach(m => m.classList.remove('show'));
  if (!state.token) { showToast('Please sign in to delete posts.'); return; }

  const confirmed = await showConfirmDialog({
    title: 'Delete post?',
    message: 'This will permanently delete the post. This action cannot be undone.',
    confirmLabel: 'Delete',
    confirmClass: 'confirm-dialog-btn--danger',
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`https://${state.server}/api/v1/statuses/${postId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` },
    });
    if (!res.ok) throw new Error('Failed to delete post');

    // Remove from DOM — data-id lives on <article>, data-status-id on thread wrappers
    document.querySelectorAll(`[data-id="${postId}"]`).forEach(el => {
      // Feed article: remove the article itself (or its parent .post wrapper if any)
      el.remove();
    });
    document.querySelectorAll(`[data-status-id="${postId}"]`).forEach(el => {
      // Thread wrapper div — remove it
      el.remove();
    });

    showToast('Post deleted.', 'success');
  } catch (err) {
    showToast('Could not delete post: ' + err.message, 'error');
  }
};

window.handleDeleteRedraftInit = async function (postId) {
  document.querySelectorAll('.post-dropdown').forEach(m => m.classList.remove('show'));
  if (!state.token) { showToast('Please sign in to delete posts.'); return; }

  // Fetch source AND full status so we can prefill the compose box (including media)
  let sourceText = '';
  let spoilerText = '';
  let deletedPostMedia = [];
  try {
    const [sourceResponse, statusResponse] = await Promise.all([
      apiGet(`/api/v1/statuses/${postId}/source`, state.token),
      apiGet(`/api/v1/statuses/${postId}`, state.token),
    ]);
    sourceText = sourceResponse.text || '';
    spoilerText = sourceResponse.spoiler_text || '';
    // Unwrap reblogs — the media lives on the inner reblog object if it's a boost
    const actualStatus = statusResponse.reblog || statusResponse;
    deletedPostMedia = actualStatus.media_attachments || [];
  } catch (err) {
    showToast('Could not fetch post source: ' + err.message, 'error');
    return;
  }

  const confirmed = await showConfirmDialog({
    title: 'Delete & Redraft?',
    message: 'The post will be deleted and its text placed in the compose box for you to edit and re-post.',
    confirmLabel: 'Delete & Redraft',
    confirmClass: 'confirm-dialog-btn--danger',
  });
  if (!confirmed) return;

  // Snapshot whatever is currently in the compose box BEFORE resetting
  const isDesktop = window.innerWidth > 900;
  const suffix = isDesktop ? '-sidebar' : '';
  const mediaFilesKey = suffix === '-sidebar' ? 'sidebarMediaFiles' : 'mediaFiles';
  const mediaUrlsKey = suffix === '-sidebar' ? 'sidebarMediaUrls' : 'mediaUrls';
  const mediaDescsKey = suffix === '-sidebar' ? 'sidebarMediaDescriptions' : 'mediaDescriptions';
  const mediaIdsKey = suffix === '-sidebar' ? 'sidebarMediaIds' : 'mediaIds';

  const savedMediaFiles = [...(composeState[mediaFilesKey] || [])];
  const savedMediaUrls = [...(composeState[mediaUrlsKey] || [])];
  const savedMediaDescs = [...(composeState[mediaDescsKey] || [])];
  const savedMediaIds = [...(composeState[mediaIdsKey] || [])];
  const savedCw = ($('compose-cw-input' + suffix) || {}).value || '';

  try {
    const res = await fetch(`https://${state.server}/api/v1/statuses/${postId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` },
    });
    if (!res.ok) throw new Error('Failed to delete post');

    // Remove from DOM — data-id lives on <article>, data-status-id on thread wrappers
    document.querySelectorAll(`[data-id="${postId}"]`).forEach(el => el.remove());
    document.querySelectorAll(`[data-status-id="${postId}"]`).forEach(el => el.remove());

    // resetReplyState wipes & revokes blob URLs — do it before rebuilding media
    resetReplyState();

    const textarea = $('compose-textarea' + suffix);
    textarea.innerText = sourceText + '\u00A0';

    // Restore CW: prefer the deleted post's CW; fall back to whatever was in the box
    const effectiveCw = spoilerText || savedCw;
    if (effectiveCw) {
      const cwInput = $('compose-cw-input' + suffix);
      const cwSection = $('compose-cw-section' + suffix);
      const cwBtn = $('compose-cw-btn' + suffix);
      if (cwInput) cwInput.value = effectiveCw;
      if (cwSection) cwSection.style.display = 'block';
      if (cwBtn) cwBtn.classList.add('active');
    }

    // Rebuild media preview: start with whatever was in the compose box, then add
    // the deleted post's own attachments. Capped at 4 total.
    const preview = $('compose-media-preview' + suffix);

    /** Build a standard compose-media-item div and wire up remove/alt buttons. */
    const addMediaItem = (file, url, displayUrl, desc, id, type) => {
      // Don't add if we're full
      if (composeState[mediaFilesKey].length >= 4) return;

      composeState[mediaFilesKey].push(file);
      composeState[mediaUrlsKey].push(url);
      composeState[mediaDescsKey].push(desc);
      composeState[mediaIdsKey].push(id);

      const item = document.createElement('div');
      item.className = 'compose-media-item';

      const isVideo = type === 'video' || type === 'gifv';
      const mediaEl = isVideo ? document.createElement('video') : document.createElement('img');
      mediaEl.src = displayUrl;
      if (isVideo) mediaEl.muted = true;

      // Ensure the media doesn't display as broken if cached differently
      mediaEl.onerror = () => { mediaEl.style.display = 'none'; };

      if (!isVideo) {
        const altBtn = document.createElement('button');
        altBtn.className = 'compose-media-item-alt-btn' + (!desc ? ' missing' : '');
        altBtn.textContent = 'ALT';
        altBtn.onclick = () => {
          const idx = composeState[mediaUrlsKey].indexOf(url);
          openAltModal(url, idx, suffix, composeState[mediaDescsKey][idx]);
        };
        item.appendChild(mediaEl);
        item.appendChild(altBtn);
      } else {
        item.appendChild(mediaEl);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'compose-media-remove';
      removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      removeBtn.onclick = () => {
        const idx = composeState[mediaUrlsKey].indexOf(url);
        if (idx > -1) {
          if (composeState[mediaFilesKey][idx]) URL.revokeObjectURL(url);
          composeState[mediaFilesKey].splice(idx, 1);
          composeState[mediaUrlsKey].splice(idx, 1);
          composeState[mediaDescsKey].splice(idx, 1);
          composeState[mediaIdsKey].splice(idx, 1);
        }
        item.remove();
        if (isDesktop) updateSidebarCharCount(); else updateCharCount();
      };

      item.appendChild(removeBtn);
      preview.appendChild(item);
    };

    // 1) Restore previously-drafted media from the compose box.
    //    For local file uploads, file is a File object — create a fresh blob URL.
    //    For server-hosted media already in the compose box (e.g. from an edit), file is null.
    savedMediaFiles.forEach((file, i) => {
      const freshUrl = file ? URL.createObjectURL(file) : savedMediaUrls[i];
      addMediaItem(file, freshUrl, freshUrl, savedMediaDescs[i], savedMediaIds[i], null); // type null is fine for saved
    });

    // 2) Add the deleted post's own media attachments (server-hosted, id already exists).
    deletedPostMedia.forEach(m => {
      addMediaItem(null, m.url, m.preview_url || m.url, m.description || '', m.id, m.type);
    });

    if (!isDesktop) openComposeDrawer();
    else placeCursorAtEnd(textarea);

    if (isDesktop) updateSidebarCharCount(); else updateCharCount();

    showToast('Post deleted — edit and re-post below.', 'success');
  } catch (err) {
    showToast('Could not delete post: ' + err.message, 'error');
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
  setTimeout(() => {
    const textarea = $('compose-textarea');
    if (!textarea.innerText.endsWith('\u00A0') && !textarea.innerText.endsWith(' ')) {
      textarea.innerText += '\u00A0';
    }
    placeCursorAtEnd(textarea);
  }, 300);
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
  const visBtn = $('compose-visibility-btn' + suffix);
  const visibility = visBtn ? (visBtn.dataset.visibility || 'public') : 'public';
  const quote_approval_policy = visBtn ? (visBtn.dataset.quote || 'public') : 'public';
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

    const postData = { status, visibility, quote_approval_policy };
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
    updateCurrentThread();
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

function positionSuggestionsStrip(strip, textarea) {
  if (window.innerWidth <= 900) {
    strip.style.position = '';
    strip.style.top = '';
    strip.style.left = '';
    strip.style.width = '';
    return;
  }
  const rect = textarea.getBoundingClientRect();
  strip.style.position = 'fixed';
  strip.style.top = rect.bottom + 'px';
  strip.style.left = rect.left + 'px';
  strip.style.width = rect.width + 'px';
}

function getSuggestionsStrip(textarea) {
  if (!textarea) return null;
  if (textarea.id === 'compose-textarea') return $('compose-suggestions-strip');
  if (textarea.id === 'compose-textarea-sidebar') return $('compose-suggestions-strip-sidebar');
  return null;
}

function initMentionAutocomplete() {
  const t1 = $('compose-textarea');
  const t2 = $('compose-textarea-sidebar');

  [t1, t2].forEach(textarea => {
    if (!textarea) return;
    textarea.addEventListener('input', (e) => handleMentionInput(e, textarea));
    textarea.addEventListener('keydown', (e) => handleMentionKeydown(e, textarea));
    textarea.addEventListener('scroll', closeMentionSuggestions);
  });

  document.addEventListener('click', (e) => { if (!e.target.closest('.compose-suggestions-strip')) closeMentionSuggestions(); });
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
  const strip = getSuggestionsStrip(mentionTargetTextarea);
  if (!strip || !users.length) { closeMentionSuggestions(); return; }

  const track = strip.querySelector('.suggestions-strip-track');
  track.innerHTML = users.map((u, i) => `
    <div class="suggestion-chip ${i === 0 ? 'selected' : ''}" data-index="${i}" data-acct="${escapeHTML(u.acct)}">
      <img src="${u.avatar_static || u.avatar}" class="suggestion-chip-avatar" loading="lazy" />
      <span class="suggestion-chip-label">${renderCustomEmojis(u.display_name || u.username, u.emojis)}</span>
      <span class="suggestion-chip-sub">@${escapeHTML(u.acct)}</span>
    </div>
  `).join('');

  strip.style.display = 'block';
  positionSuggestionsStrip(strip, mentionTargetTextarea);
  mentionSelectedIndex = 0;

  track.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.onmousedown = (e) => e.preventDefault();
    chip.onclick = (e) => { e.preventDefault(); e.stopPropagation(); insertMention(chip.dataset.acct); };
  });
}

function handleMentionKeydown(e, textarea) {
  const strip = getSuggestionsStrip(textarea);
  if (!strip || strip.style.display === 'none') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveMentionSelection(1, textarea); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveMentionSelection(-1, textarea); }
  else if (e.key === 'Enter' || e.key === 'Tab') {
    if (mentionSelectedIndex > -1) { e.preventDefault(); insertMention(mentionSuggestions[mentionSelectedIndex].acct); }
  } else if (e.key === 'Escape') closeMentionSuggestions();
}

function moveMentionSelection(dir, textarea) {
  const strip = getSuggestionsStrip(textarea);
  if (!strip) return;
  const items = strip.querySelectorAll('.suggestion-chip');
  if (!items.length) return;
  items[mentionSelectedIndex]?.classList.remove('selected');
  mentionSelectedIndex = (mentionSelectedIndex + dir + items.length) % items.length;
  items[mentionSelectedIndex].classList.add('selected');
  items[mentionSelectedIndex].scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
  [$('compose-suggestions-strip'), $('compose-suggestions-strip-sidebar')].forEach(s => { if (s) s.style.display = 'none'; });
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

  [t1, t2].forEach(textarea => {
    if (!textarea) return;
    textarea.addEventListener('input', (e) => handleHashtagInput(e, textarea));
    textarea.addEventListener('keydown', (e) => handleHashtagKeydown(e, textarea));
    textarea.addEventListener('scroll', closeHashtagSuggestions);
  });

  document.addEventListener('click', (e) => { if (!e.target.closest('.compose-suggestions-strip')) closeHashtagSuggestions(); });
  window.addEventListener('scroll', closeHashtagSuggestions, { passive: true });
}

function handleHashtagInput(e, textarea) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.startContainer.nodeType !== Node.TEXT_NODE) { closeHashtagSuggestions(); return; }
  const textBefore = range.startContainer.textContent.substring(0, range.startOffset);
  const match = textBefore.match(/(?:^|\s)#([a-zA-Z0-9_]+)$/);

  clearTimeout(hashtagDebounceTimer);

  if (match) {
    hashtagCurrentQuery = match[1];
    hashtagTargetTextarea = textarea;
    hashtagDebounceTimer = setTimeout(() => {
      fetchHashtags(hashtagCurrentQuery);
    }, 150);
  } else {
    closeHashtagSuggestions();
  }
}

async function fetchHashtags(q) {
  if (!q) return;
  if (hashtagActiveRequest) hashtagActiveRequest.abort();
  const controller = new AbortController();
  hashtagActiveRequest = controller;
  try {
    const results = await apiGet(`/api/v2/search?q=${encodeURIComponent(q)}&type=hashtags&limit=10&resolve=false`, state.token, null, controller.signal);
    const tags = (results.hashtags || []).sort((a, b) => {
      const scoreA = a.history ? a.history.reduce((s, d) => s + parseInt(d.uses || 0), 0) : 0;
      const scoreB = b.history ? b.history.reduce((s, d) => s + parseInt(d.uses || 0), 0) : 0;
      return scoreB - scoreA;
    }).slice(0, 6);
    hashtagSuggestions = tags;
    renderHashtagSuggestions(tags);
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('Hashtag search failed:', err);
  }
}

function renderHashtagSuggestions(tags) {
  const strip = getSuggestionsStrip(hashtagTargetTextarea);
  if (!strip || !tags.length) { closeHashtagSuggestions(); return; }

  const track = strip.querySelector('.suggestions-strip-track');
  track.innerHTML = tags.map((t, i) => {
    const weeklyUses = t.history ? t.history.reduce((sum, day) => sum + parseInt(day.uses || 0), 0) : null;
    return `
    <div class="suggestion-chip ${i === 0 ? 'selected' : ''}" data-index="${i}" data-tag="${escapeHTML(t.name)}">
      <span class="suggestion-chip-icon">#</span>
      <span class="suggestion-chip-label">#${escapeHTML(t.name)}</span>
      ${weeklyUses !== null ? `<span class="suggestion-chip-sub">${weeklyUses.toLocaleString()}</span>` : ''}
    </div>`;
  }).join('');

  strip.style.display = 'block';
  positionSuggestionsStrip(strip, hashtagTargetTextarea);
  hashtagSelectedIndex = 0;

  track.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.onmousedown = (e) => e.preventDefault();
    chip.onclick = (e) => { e.preventDefault(); e.stopPropagation(); insertHashtag(chip.dataset.tag); };
  });
}

function handleHashtagKeydown(e, textarea) {
  const strip = getSuggestionsStrip(textarea);
  if (!strip || strip.style.display === 'none') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveHashtagSelection(1, textarea); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveHashtagSelection(-1, textarea); }
  else if (e.key === 'Enter' || e.key === 'Tab') {
    if (hashtagSelectedIndex > -1) { e.preventDefault(); insertHashtag(hashtagSuggestions[hashtagSelectedIndex].name); }
  } else if (e.key === 'Escape') closeHashtagSuggestions();
}

function moveHashtagSelection(dir, textarea) {
  const strip = getSuggestionsStrip(textarea);
  if (!strip) return;
  const items = strip.querySelectorAll('.suggestion-chip');
  if (!items.length) return;
  items[hashtagSelectedIndex]?.classList.remove('selected');
  hashtagSelectedIndex = (hashtagSelectedIndex + dir + items.length) % items.length;
  items[hashtagSelectedIndex].classList.add('selected');
  items[hashtagSelectedIndex].scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
  [$('compose-suggestions-strip'), $('compose-suggestions-strip-sidebar')].forEach(s => { if (s) s.style.display = 'none'; });
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
   HASHTAG TAB / MANAGE MODAL
   ══════════════════════════════════════════════════════════════════════ */

let manageHashtagDebounceTimer = null;
let manageHashtagActiveRequest = null;

function setupHashtagTab() {
  const btn = $('manage-hashtags-btn');
  const panel = $('manage-inline-panel');
  const closeBtn = $('manage-hashtags-close');
  const searchInput = $('manage-hashtag-search-input');

  const viewInput = $('hashtag-search-input');
  const searchBtn = $('hashtag-search-btn');

  let lookupHashtagDebounceTimer = null;
  let lookupHashtagActiveRequest = null;
  const lookupDropdown = $('hashtag-lookup-results');
  let selectedLookupIndex = -1;

  function doHashtagSearch(val) {
    if (!viewInput) return;
    const explicitVal = typeof val === 'string' ? val : null;
    val = (explicitVal || viewInput.value.trim()).replace(/^#/, '');
    if (val) {
      if (lookupDropdown) lookupDropdown.style.display = 'none';
      state.selectedHashtagFilter = val.toLowerCase();
      loadFeedTab();
      if (explicitVal) {
        viewInput.value = '#' + val;
      }
    }
  }

  function updateLookupSelection(items) {
    items.forEach((item, idx) => {
      if (idx === selectedLookupIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  if (viewInput) {
    viewInput.addEventListener('keydown', (e) => {
      const isVisible = lookupDropdown && lookupDropdown.style.display !== 'none';
      const items = isVisible ? lookupDropdown.querySelectorAll('.hashtag-item') : [];

      if (isVisible && items.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedLookupIndex = (selectedLookupIndex + 1) % items.length;
          updateLookupSelection(items);
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedLookupIndex = (selectedLookupIndex - 1 + items.length) % items.length;
          updateLookupSelection(items);
          return;
        } else if (e.key === 'Enter') {
          if (selectedLookupIndex >= 0 && selectedLookupIndex < items.length) {
            e.preventDefault();
            items[selectedLookupIndex].click();
            return;
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          lookupDropdown.style.display = 'none';
          selectedLookupIndex = -1;
          return;
        }
      }

      if (e.key === 'Enter') doHashtagSearch();
    });

    viewInput.addEventListener('input', () => {
      selectedLookupIndex = -1;
      clearTimeout(lookupHashtagDebounceTimer);
      const q = viewInput.value.trim().replace(/^#/, '');
      if (!q) {
        if (lookupDropdown) lookupDropdown.style.display = 'none';
        return;
      }
      lookupHashtagDebounceTimer = setTimeout(() => {
        fetchLookupHashtags(q);
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (lookupDropdown && !e.target.closest('.hashtag-search-wrap')) {
        lookupDropdown.style.display = 'none';
      }
    });

    viewInput.addEventListener('focus', () => {
      if (viewInput.value.trim().length > 0 && lookupDropdown.innerHTML !== '') {
        lookupDropdown.style.display = 'flex';
      }
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', () => doHashtagSearch());
  }

  async function fetchLookupHashtags(q) {
    if (lookupHashtagActiveRequest) lookupHashtagActiveRequest.abort();
    const controller = new AbortController();
    lookupHashtagActiveRequest = controller;
    if (lookupDropdown) {
      lookupDropdown.style.display = 'flex';
      lookupDropdown.innerHTML = '<div style="padding:10px;text-align:center;"><div class="spinner" style="margin: 0 auto;"></div></div>';
    }
    try {
      const { apiGet } = await import('./api.js');
      const results = await apiGet(`/api/v2/search?q=${encodeURIComponent(q)}&type=hashtags&limit=5`, state.token, null, controller.signal);
      renderLookupResults(results.hashtags || []);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('Hashtag lookup search failed:', err);
    }
  }

  function renderLookupResults(tags) {
    selectedLookupIndex = -1;
    if (!lookupDropdown) return;
    if (!tags.length) {
      lookupDropdown.innerHTML = '<div style="padding:10px 12px; font-size:13px; color:var(--text-muted); text-align:center;">No matching hashtags found</div>';
      return;
    }

    lookupDropdown.innerHTML = tags.map(t => {
      const uses = t.history ? t.history.reduce((sum, day) => sum + parseInt(day.uses || 0), 0) : 0;
      return `
      <div class="hashtag-item" data-tag="${escapeHTML(t.name)}">
        <div class="hashtag-icon">#</div>
        <div class="hashtag-info">
          <div class="hashtag-name">${escapeHTML(t.name)}</div>
          <div class="hashtag-uses">${uses} uses this week</div>
        </div>
      </div>
    `}).join('');

    lookupDropdown.querySelectorAll('.hashtag-item').forEach(item => {
      item.addEventListener('click', () => {
        const tag = item.dataset.tag;
        doHashtagSearch(tag);
      });
    });
  }

  const drawer = $('manage-hashtag-drawer');
  const backdrop = $('manage-hashtag-backdrop');

  if (!btn || !drawer) return;

  function openManageHashtagsPanel() {
    history.pushState({ drawer: 'manage-hashtag-drawer' }, '', '');
    drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    renderCurrentlyFollowing();
    searchInput.value = '';
    $('manage-hashtag-search-results').innerHTML = '';
    setTimeout(() => searchInput.focus(), 100);
  }

  function closeManageHashtagsPanel() {
    drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    loadFeedTab(); // refresh the dropdown list in the feed bar
  }

  btn.addEventListener('click', openManageHashtagsPanel);
  if (closeBtn) closeBtn.addEventListener('click', closeManageHashtagsPanel);
  if (backdrop) backdrop.addEventListener('click', closeManageHashtagsPanel);

  // Also close with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) {
      closeManageHashtagsPanel();
    }
  });

  // Expose so the profile menu button in app.js can open it too
  window.openManageHashtagsPanel = openManageHashtagsPanel;

  function renderCurrentlyFollowing() {
    const list = $('manage-hashtags-list');
    const tags = state.followedHashtags || [];
    if (!tags.length) {
      list.innerHTML = '<div style="font-size:13px; color:var(--text-muted); padding: 8px 0;">You are not following any hashtags yet.</div>';
      return;
    }

    // sort alphabetically
    const sorted = [...tags].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    list.innerHTML = sorted.map(t => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--bg); border:1px solid var(--border); border-radius:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:28px; height:28px; border-radius:6px; background:var(--surface); display:flex; align-items:center; justify-content:center; color:var(--accent); font-weight:bold; font-size:14px;">#</div>
          <span style="font-weight:500; font-size:14px;">${escapeHTML(t.name)}</span>
        </div>
        <button class="profile-follow-btn following outline" data-tag="${escapeHTML(t.name)}" data-following="true" style="padding:6px 12px; height:auto; min-width:80px; font-size:13px;">Unfollow</button>
      </div>
    `).join('');

    // Attach event listeners for unfollow
    list.querySelectorAll('.profile-follow-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const { handleHashtagFollowToggle } = await import('./profile.js');
        await handleHashtagFollowToggle(b);
        // re-render list after toggle
        renderCurrentlyFollowing();
      });
    });
  }

  // Search autocomplete
  searchInput.addEventListener('input', () => {
    clearTimeout(manageHashtagDebounceTimer);
    const q = searchInput.value.trim().replace(/^#/, '');
    if (!q) {
      $('manage-hashtag-search-results').innerHTML = '';
      return;
    }
    manageHashtagDebounceTimer = setTimeout(() => {
      fetchManageHashtags(q);
    }, 300);
  });

  async function fetchManageHashtags(q) {
    if (manageHashtagActiveRequest) manageHashtagActiveRequest.abort();
    const controller = new AbortController();
    manageHashtagActiveRequest = controller;
    try {
      $('manage-hashtag-search-results').innerHTML = '<div class="spinner" style="margin: 10px auto;"></div>';
      const { apiGet } = await import('./api.js');
      const results = await apiGet(`/api/v2/search?q=${encodeURIComponent(q)}&type=hashtags&limit=5`, state.token, null, controller.signal);
      const tags = results.hashtags || [];
      renderSearchResults(tags);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('Hashtag search failed:', err);
    }
  }

  function renderSearchResults(tags) {
    const list = $('manage-hashtag-search-results');
    if (!tags.length) {
      list.innerHTML = '<div style="font-size:13px; color:var(--text-muted); text-align:center; padding:8px 0;">No matching hashtags found</div>';
      return;
    }

    list.innerHTML = tags.map(t => {
      const isFollowing = (state.followedHashtags || []).some(ft => ft.name.toLowerCase() === t.name.toLowerCase());
      const uses = t.history ? t.history.reduce((sum, day) => sum + parseInt(day.uses || 0), 0) : 0;
      return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--bg); border:1px solid var(--border); border-radius:8px;">
        <div style="display:flex; flex-direction:column;">
          <span style="font-weight:500; font-size:14px; color:var(--text); margin-bottom:2px;">#${escapeHTML(t.name)}</span>
          <span style="font-size:12px; color:var(--text-muted);">${uses} uses this week</span>
        </div>
        <button class="profile-follow-btn ${isFollowing ? 'following outline' : ''}" data-tag="${escapeHTML(t.name)}" data-following="${isFollowing ? 'true' : 'false'}" style="padding:6px 12px; height:auto; min-width:80px; font-size:13px;">${isFollowing ? 'Unfollow' : 'Follow'}</button>
      </div>
    `}).join('');

    list.querySelectorAll('.profile-follow-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const { handleHashtagFollowToggle } = await import('./profile.js');
        await handleHashtagFollowToggle(b);
        // Toggle the button style
        const isFollowing = b.dataset.following === 'true';
        if (isFollowing) {
          b.classList.add('following', 'outline');
          b.textContent = 'Unfollow';
        } else {
          b.classList.remove('following', 'outline');
          b.textContent = 'Follow';
        }
        renderCurrentlyFollowing(); // Update the lower list
      });
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

  // --- Mention / Hashtag autocomplete (must register before emoji so emoji fires last) ---
  initMentionAutocomplete();
  initHashtagAutocomplete();

  // --- Emoji autocomplete (registered last so it has the final say on the strip) ---
  initEmojiAutocomplete();
}
