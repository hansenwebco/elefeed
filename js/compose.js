/**
 * @module compose
 * Compose form for both the mobile drawer and the desktop sidebar.
 * Handles media upload, content warnings, alt text modal, mentions,
 * reply/quote context, and posting.
 */

import { $, state, composeState, store } from './state.js';
import { apiGet } from './api.js';
import { showToast, showConfirm } from './ui.js';
import { applyCountsFromStatus } from './counts.js';
import { escapeHTML, renderCustomEmojis, placeCursorAtEnd, getEditorText } from './utils.js';
import { loadFeedTab } from './feed.js';
import { updateCurrentThread } from './thread.js';
import { openEmojiPicker, closeEmojiPicker, initEmojiPicker, initEmojiAutocomplete } from './emoji.js';

const ICON_REPLY = '<polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />';
const ICON_QUOTE = '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v3c0 1.25.75 2 2 2h3c0 4-2 6-3 6l1 3z" fill="currentColor" stroke="none"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v3c0 1.25.75 2 2 2h3c0 4-2 6-3 6l1 3z" fill="currentColor" stroke="none"></path>';

const VIS_ICONS = {
  'public': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  'unlisted': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`,
  'private': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  'direct': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`
};

const EXTRA_ICONS = {
  'quote_followers': `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  'quote_nobody': `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
  'lang': `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
  'sensitive': `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

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

  const nav = $('sidebar-nav');
  if (nav && state.desktopMenu && window.innerWidth > 900) {
    const hasContent = textLength > 0 || cwLength > 0 || composeState.sidebarMediaFiles.length > 0 || composeState.replyToId !== null || composeState.quoteId !== null || composeState.editPostId !== null;
    const isFocused = document.activeElement === textarea || document.activeElement === cwInput;
    if (hasContent || isFocused) {
      nav.classList.add('hidden-for-compose');
    } else {
      nav.classList.remove('hidden-for-compose');
    }
  }
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
    if (typeNode) typeNode.textContent = 'New post';
    const headerTitle = $('compose-header-title' + suffix);
    if (headerTitle) headerTitle.textContent = 'New message';
    if (textarea) textarea.innerText = '';
    if (postBtn) postBtn.textContent = 'Post';

    if (cwInput) cwInput.value = '';
    if (cwSection) cwSection.style.display = 'none';
    if (cwBtn) cwBtn.classList.remove('active');

    if (visBtn) {
      const defaultVis = store.get('pref_post_visibility') || 'public';
      const defaultQuote = store.get('pref_post_quote') || 'public';
      const defaultLang = store.get('pref_post_lang') || 'browser';
      const defaultSensitive = store.get('pref_always_sensitive') || 'false';

      visBtn.dataset.visibility = defaultVis;
      visBtn.dataset.quote = defaultQuote;
      visBtn.dataset.lang = defaultLang;
      visBtn.dataset.sensitive = defaultSensitive;
      visBtn.disabled = false;
      visBtn.title = "";
      visBtn.style.opacity = '1';

      const visLabels = { 'public': 'Public', 'unlisted': 'Unlisted', 'private': 'Followers', 'direct': 'Direct' };
      const quoteLabelsFull = { 'public': 'Anyone can quote', 'followers': 'Followers only can quote', 'nobody': 'No one can quote' };

      const icon = $('compose-visibility-icon' + suffix);
      const text = $('compose-visibility-text' + suffix);

      if (icon) icon.innerHTML = VIS_ICONS[defaultVis] || VIS_ICONS['public'];
      if (text) {
        const primaryLabel = visLabels[defaultVis] || 'Public';
        let extraHtml = '';
        if (defaultQuote === 'followers') extraHtml += EXTRA_ICONS['quote_followers'];
        if (defaultQuote === 'nobody') extraHtml += EXTRA_ICONS['quote_nobody'];
        if (defaultSensitive === 'true' || defaultSensitive === true) extraHtml += EXTRA_ICONS['sensitive'];

        text.innerHTML = `<span>${primaryLabel}</span>${extraHtml ? '<span style="opacity:0.3;margin:0 2px;">·</span>' + extraHtml : ''}`;

        // Tooltip
        let tooltip = primaryLabel;
        tooltip += ` · ${quoteLabelsFull[defaultQuote] || 'Anyone can quote'}`;
        if (defaultLang !== 'browser') tooltip += ` · Language: ${defaultLang.toUpperCase()}`;
        if (defaultSensitive === 'true' || defaultSensitive === true) tooltip += ' · Marked Sensitive';
        visBtn.title = tooltip;
      }

      const langText = $('compose-lang-text' + suffix);
      if (langText) langText.textContent = defaultLang === 'browser' ? 'EN' : defaultLang.toUpperCase();
    }

    const quotePreview = $('compose-quote-preview' + suffix);
    if (quotePreview) {
      quotePreview.style.display = 'none';
      quotePreview.innerHTML = '';
    }

    if (mediaPreview) mediaPreview.innerHTML = '';
  });
  if (window.innerWidth > 900) updateSidebarCharCount(); else updateCharCount();
}

// Expose on window so inline onclick="resetReplyState()" on cancel buttons works
window.resetReplyState = resetReplyState;

window.cancelReplyAndClose = function (isSidebar) {
  if (isSidebar) {
    resetReplyState();
  } else {
    closeComposeDrawer();
  }
};

export function refreshComposeDefaults() {
  ['', '-sidebar'].forEach(suffix => {
    const visBtn = $('compose-visibility-btn' + suffix);
    if (!visBtn) return;

    // Only update if it's not disabled (e.g. not in Edit mode)
    if (visBtn.disabled) return;

    const defaultVis = store.get('pref_post_visibility') || 'public';
    const defaultQuote = store.get('pref_post_quote') || 'public';
    const defaultLang = store.get('pref_post_lang') || 'browser';
    const defaultSensitive = store.get('pref_always_sensitive') || 'false';

    visBtn.dataset.visibility = defaultVis;
    visBtn.dataset.quote = defaultQuote;
    visBtn.dataset.lang = defaultLang;
    visBtn.dataset.sensitive = defaultSensitive;

    const visLabels = { 'public': 'Public', 'unlisted': 'Unlisted', 'private': 'Followers', 'direct': 'Direct' };
    const quoteLabelsFull = { 'public': 'Anyone can quote', 'followers': 'Followers only can quote', 'nobody': 'No one can quote' };

    const icon = $('compose-visibility-icon' + suffix);
    const text = $('compose-visibility-text' + suffix);
    if (icon) icon.innerHTML = VIS_ICONS[defaultVis] || VIS_ICONS['public'];
    if (text) {
      const primaryLabel = visLabels[defaultVis] || 'Public';
      let extraHtml = '';
      if (defaultQuote === 'followers') extraHtml += EXTRA_ICONS['quote_followers'];
      if (defaultQuote === 'nobody') extraHtml += EXTRA_ICONS['quote_nobody'];
      if (defaultSensitive === 'true' || defaultSensitive === true) extraHtml += EXTRA_ICONS['sensitive'];

      text.innerHTML = `<span>${primaryLabel}</span>${extraHtml ? '<span style="opacity:0.3;margin:0 2px;">·</span>' + extraHtml : ''}`;

      // Tooltip
      let tooltip = primaryLabel;
      tooltip += ` · ${quoteLabelsFull[defaultQuote] || 'Anyone can quote'}`;
      if (defaultLang !== 'browser') tooltip += ` · Language: ${defaultLang.toUpperCase()}`;
      if (defaultSensitive === 'true' || defaultSensitive === true) tooltip += ' · Marked Sensitive';
      visBtn.title = tooltip;
    }
    const langText = $('compose-lang-text' + suffix);
    if (langText) langText.textContent = defaultLang === 'browser' ? 'EN' : defaultLang.toUpperCase();
  });
}

/* ══════════════════════════════════════════════════════════════════════
   VISIBILITY MODAL
   ══════════════════════════════════════════════════════════════════════ */

window.openVisibilityModal = function (suffix) {
  composeState.activeVisibilitySuffix = suffix;
  const visBtn = $('compose-visibility-btn' + suffix);
  if (visBtn) {
    $('modal-visibility-select').value = visBtn.dataset.visibility || 'public';
    $('modal-quote-select').value = visBtn.dataset.quote || 'public';
    $('modal-lang-select').value = visBtn.dataset.lang || 'browser';
    $('modal-sensitive-toggle').checked = visBtn.dataset.sensitive === 'true';
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
    const lang = $('modal-lang-select').value;
    const sensitive = $('modal-sensitive-toggle').checked;
    visBtn.dataset.visibility = vis;
    visBtn.dataset.quote = quote;
    visBtn.dataset.lang = lang;
    visBtn.dataset.sensitive = sensitive ? 'true' : 'false';

    const visLabels = { 'public': 'Public', 'unlisted': 'Unlisted', 'private': 'Followers', 'direct': 'Direct' };
    const quoteLabelsFull = { 'public': 'Anyone can quote', 'followers': 'Followers only can quote', 'nobody': 'No one can quote' };
    const iconNode = $('compose-visibility-icon' + suffix);
    const textNode = $('compose-visibility-text' + suffix);
    if (iconNode) iconNode.innerHTML = VIS_ICONS[vis] || VIS_ICONS['public'];
    if (textNode) {
      const primaryLabel = visLabels[vis] || 'Public';
      let extraHtml = '';
      if (quote === 'followers') extraHtml += EXTRA_ICONS['quote_followers'];
      if (quote === 'nobody') extraHtml += EXTRA_ICONS['quote_nobody'];
      if (sensitive) extraHtml += EXTRA_ICONS['sensitive'];

      textNode.innerHTML = `<span>${primaryLabel}</span>${extraHtml ? '<span style="opacity:0.3;margin:0 2px;">·</span>' + extraHtml : ''}`;

      // Tooltip
      let tooltip = primaryLabel;
      tooltip += ` · ${quoteLabelsFull[quote] || 'Anyone can quote'}`;
      if (lang !== 'browser') tooltip += ` · Language: ${lang.toUpperCase()}`;
      if (sensitive) tooltip += ' · Marked Sensitive';
      visBtn.title = tooltip;
    }
    const langText = $('compose-lang-text' + suffix);
    if (langText) langText.textContent = lang === 'browser' ? 'EN' : lang.toUpperCase();
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

  if (to) {
    const typeNode = $('compose-context-type' + suffix);
    if (typeNode) typeNode.textContent = 'Replying to ';
    const headerTitle = $('compose-header-title' + suffix);
    if (headerTitle) headerTitle.textContent = 'Replying';
    const iconEl = $('compose-context-icon' + suffix);
    if (iconEl) iconEl.innerHTML = ICON_REPLY;
    if (bar) bar.style.display = 'flex';
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
  document.querySelectorAll('.boost-dropdown, .footer-more-dropdown').forEach(m => m.classList.remove('show'));
});

window.handleQuoteInit = async function (postId, acct, triggerEl) {
  if (store.get('pref_confirm_interactions') === 'true') {
    // Find preview content using the direct trigger element if available, fallback to query
    const btn = triggerEl || document.querySelector(`.post-quote-btn[data-post-id="${postId}"]`) || 
                document.querySelector(`.post-boost-btn[data-post-id="${postId}"]`) ||
                document.querySelector(`[data-id="${postId}"]`);
    const postEl = btn ? btn.closest('.feed-status, .post-item, .notification-item, .post-thread-item, article.post, .post') : null;
    
    let previewHTML = '';
    if (postEl) {
      const content = postEl.querySelector('.post-content, .status-content')?.outerHTML || '';
      const media = postEl.querySelector('.post-media, .post-media-grid')?.outerHTML || '';
      const quote = postEl.querySelector('.post-quote')?.outerHTML || '';
      const card = postEl.querySelector('.post-card')?.outerHTML || '';
      previewHTML = (content + media + quote + card).replace(/onclick="[^"]*"/g, ''); // Strip interactions
    }
    
    // Fallback: if no textFound, show author info
    if (!previewHTML && postEl) {
      const name = postEl.querySelector('.post-display-name, .profile-display-name')?.textContent || 'this post';
      const acctHandle = postEl.querySelector('.post-acct, .profile-acct')?.textContent || '';
      previewHTML = `<div style="font-weight:600;">Post by ${name}</div><div style="font-size:11px; opacity:0.7;">${acctHandle}</div>`;
    }

    const confirmed = await showConfirm('Are you sure you want to quote this post?', 'Confirm Quote', previewHTML);
    if (!confirmed) return;
  }
  document.querySelectorAll('.boost-dropdown').forEach(m => m.classList.remove('show'));
  composeState.quoteId = postId;
  composeState.replyToAcct = acct;
  const isDesktop = window.innerWidth > 900;
  const suffix = isDesktop ? '-sidebar' : '';
  const textarea = $('compose-textarea' + suffix);
  const bar = $('compose-reply-bar' + suffix);
  const to = $('compose-reply-to' + suffix);

  if (to) {
    const typeNode = $('compose-context-type' + suffix);
    if (typeNode) typeNode.textContent = 'Quoting ';
    const headerTitle = $('compose-header-title' + suffix);
    if (headerTitle) headerTitle.textContent = 'Quoting';
    const iconEl = $('compose-context-icon' + suffix);
    if (iconEl) iconEl.innerHTML = ICON_QUOTE;
    if (bar) bar.style.display = 'flex';
    to.textContent = '@' + acct;
  }

  const quotePreview = $('compose-quote-preview' + suffix);
  if (quotePreview) {
    quotePreview.innerHTML = '<div style="color:var(--text-dim);">Loading quote...</div>';
    quotePreview.style.display = 'block';
  }

      // Fetch the status to get its URL and build a preview
      apiGet(`/api/v1/statuses/${postId}`, state.token)
        .then(status => {
          // Append the URL to the textarea for backwards compatibility
          const url = status.url || status.uri;
          if (url && textarea) {
            // contenteditable: use innerHTML/innerText
            // Prepend a newline and set cursor at the top
            textarea.innerHTML = `<div><br></div><div><br></div><div>${url}</div>`;
            textarea.dispatchEvent(new Event('input'));
            
            // Move cursor to the very beginning using Selection/Range API
            setTimeout(() => {
              textarea.focus();
              try {
                const range = document.createRange();
                const sel = window.getSelection();
                range.setStart(textarea.childNodes[0], 0);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
              } catch (e) {
                // Fallback for empty or complex structures
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(textarea);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
              }
              textarea.scrollTop = 0;
            }, 100);
          }
          let contentHtml = status.content || '';
          let temp = document.createElement('div');
          temp.innerHTML = contentHtml;
      let textContent = temp.innerText || '';

      const avatarUrl = status.account && status.account.avatar ? status.account.avatar : '';
      const displayName = status.account && status.account.display_name ? status.account.display_name : acct;

      // Sanitize for basic XSS protection in preview
      const sanText = textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Detect attached media for preview
      let mediaHtml = '';
      if (status.media_attachments && status.media_attachments.length > 0) {
        const m = status.media_attachments[0];
        const purl = m.preview_url || m.url;
        if (purl) {
          let hideSensitive = true;
          try { hideSensitive = localStorage.getItem('pref_hide_sensitive_media') !== 'false'; } catch { }
          const isSensitive = status.sensitive;
          const startBlurred = isSensitive && hideSensitive;
          const blurClass = startBlurred ? ' media-sensitive-blur' : '';

          const qPill = isSensitive ? `
              <button class="sensitive-pill${startBlurred ? '' : ' sp-revealed'}" onclick="event.stopPropagation(); window.toggleSensitiveMedia(this)" aria-label="Toggle sensitive media">
                <div class="sp-card" style="padding:8px 12px; border-radius:10px;">
                  <span class="sp-card-title" style="font-size:12px;">Sensitive content</span>
                  <span class="sp-card-sub" style="font-size:10px;">Click to show</span>
                </div>
                <svg class="sp-icon sp-icon-eye" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <span class="sp-revealed-label" style="font-size:10px;">hide</span>
              </button>` : '';

          mediaHtml = `<div class="post-media" style="margin-top:6px; border-radius:4px; overflow:hidden; position:relative; background:var(--bg); border:1px solid var(--border); line-height:0;">
              <img src="${purl}" class="${blurClass}" style="width:100%; height:auto; max-height:300px; object-fit:contain; display:block;">
              ${m.type === 'video' || m.type === 'gifv' ? '<div style="position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,0.6); color:#fff; font-size:9px; font-weight:700; padding:2px 4px; border-radius:3px;">VIDEO</div>' : ''}
              ${qPill}
            </div>`;
        }
      }

      const cwText = status.spoiler_text ? status.spoiler_text.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Sensitive content';
      const hasCW = (status.sensitive || (status.spoiler_text && status.spoiler_text.length > 0));

      contentHtml = '';
      if (hasCW) {
        const cwBodyId = `compose-quote-cw${suffix}`;
        contentHtml = `
            <div class="cw-wrapper" style="margin:4px 0; background:rgba(255,107,107,0.04); border-left:2px solid var(--danger); padding:8px; border-radius:4px;">
              <div class="cw-summary" style="cursor:pointer; font-size:12px; display:flex; gap:8px; align-items:center;" onclick="event.stopPropagation(); window.toggleCW('${cwBodyId}', this.querySelector('.cw-toggle'))">
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${cwText}</span>
                <button class="cw-toggle" style="padding:2px 8px; font-size:11px; flex-shrink:0;">show</button>
              </div>
              <div class="cw-body" id="${cwBodyId}">
                <div style="opacity:0.9; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; font-family:var(--font-body); font-size:12.5px; line-height:1.4; margin-top:8px;">
                  ${sanText}
                </div>
                ${mediaHtml}
              </div>
            </div>`;
      } else {
        contentHtml = `
            <div style="opacity:0.9; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; font-family:var(--font-body); font-size:12.5px; line-height:1.4;">
              ${sanText}
            </div>
            ${mediaHtml}`;
      }

      if (quotePreview) {
        quotePreview.innerHTML = `
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
               <img src="${avatarUrl}" style="width:20px; height:20px; border-radius:50%; object-fit:cover; background:var(--surface); flex-shrink:0;">
               <div style="display:flex; flex-direction:column; line-height:1.2; overflow:hidden;">
                 <span style="font-weight:600; font-size:12.5px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayName}</span>
                 <span style="color:var(--text-dim); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">@${acct}</span>
               </div>
            </div>
            ${contentHtml}
          `;
      }
    })
    .catch(err => {
      console.error(err);
      if (quotePreview) {
        quotePreview.innerHTML = '<div style="color:var(--danger);">Failed to load quote</div>';
      }
    });

  if (!isDesktop) openComposeDrawer();
  else placeCursorAtEnd(textarea);
};

window.handleBoostSubmit = async function (postId, isBoosted, triggerEl) {
  document.querySelectorAll('.boost-dropdown').forEach(m => m.classList.remove('show'));
  if (!state.token) { showToast('Please sign in to boost posts.'); return; }

  const btnEl = triggerEl || document.querySelector(`.post-boost-btn[data-post-id="${postId}"]`);
  const willBeBoosted = !isBoosted;
  const originalBoosted = isBoosted;

  if (store.get('pref_confirm_interactions') === 'true') {
    const actionLabel = isBoosted ? 'unboost' : 'boost';
    const postEl = btnEl ? btnEl.closest('.feed-status, .post-item, .notification-item, .post-thread-item, article.post, .post') || 
                   document.querySelector(`article[data-id="${postId}"]`) : null;
    
    let previewHTML = '';
    if (postEl) {
      const content = postEl.querySelector('.post-content, .status-content')?.outerHTML || '';
      const media = postEl.querySelector('.post-media, .post-media-grid')?.outerHTML || '';
      const quote = postEl.querySelector('.post-quote')?.outerHTML || '';
      const card = postEl.querySelector('.post-card')?.outerHTML || '';
      previewHTML = (content + media + quote + card).replace(/onclick="[^"]*"/g, '');
    }

    if (!previewHTML && postEl) {
      const name = postEl.querySelector('.post-display-name, .profile-display-name')?.textContent || 'this post';
      const acctHandle = postEl.querySelector('.post-acct, .profile-acct')?.textContent || '';
      previewHTML = `<div style="font-weight:600;">Post by ${name}</div><div style="font-size:11px; opacity:0.7;">${acctHandle}</div>`;
    }

    const confirmed = await showConfirm(`Are you sure you want to ${actionLabel} this post?`, `Confirm ${actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)}`, previewHTML);
    if (!confirmed) return;
  }

  // ── Optimistic update ──
  const countSpan = btnEl?.querySelector('.boost-count, .dropdown-stat-count');
  const originalCount = countSpan ? parseInt(countSpan.textContent) || 0 : 0;
  
  if (btnEl) {
    btnEl.classList.toggle('boosted', willBeBoosted);
    if (willBeBoosted) {
      btnEl.classList.add('boosting');
      setTimeout(() => btnEl.classList.remove('boosting'), 500);
    } else {
      btnEl.classList.add('unboosting');
      setTimeout(() => btnEl.classList.remove('unboosting'), 500);
    }
    if (btnEl.dataset.isBoosted) btnEl.dataset.isBoosted = willBeBoosted ? 'true' : 'false';
    if (btnEl.dataset.reblogged) btnEl.dataset.reblogged = willBeBoosted ? 'true' : 'false';
    if (countSpan) countSpan.textContent = willBeBoosted ? originalCount + 1 : Math.max(0, originalCount - 1);
  }

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

    // Use our central sync engine to update everyone else correctly
    applyCountsFromStatus(actualStatus);
  } catch (e) {
    // ── Rollback ──
    if (btnEl) {
      btnEl.classList.toggle('boosted', originalBoosted);
      if (btnEl.dataset.isBoosted) btnEl.dataset.isBoosted = originalBoosted ? 'true' : 'false';
      if (btnEl.dataset.reblogged) btnEl.dataset.reblogged = originalBoosted ? 'true' : 'false';
      if (countSpan) countSpan.textContent = originalCount;
    }
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
  document.querySelectorAll('.post-dropdown, .footer-more-dropdown').forEach(m => m.classList.remove('show'));
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
    textarea.innerText = (sourceResponse.text || '');

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

      const visLabels = { 'public': 'Public', 'unlisted': 'Unlisted', 'private': 'Followers', 'direct': 'Direct' };
      const quoteLabelsFull = { 'public': 'Anyone can quote', 'followers': 'Followers only can quote', 'nobody': 'No one can quote' };

      const lang = statusResponse.language || 'browser';
      const sensitive = statusResponse.sensitive === true;
      const finalQuote = statusResponse.quote_approval_policy || statusResponse.quote_policy || 'public';
      const qRaw = statusResponse.quoted_status ||
        (statusResponse.quote && (statusResponse.quote.quoted_status || statusResponse.quote));
      const qStatus = (qRaw && typeof qRaw === 'object' && qRaw.account) ? qRaw : null;

      if (qStatus && qStatus.id) {
        composeState.quoteId = qStatus.id;
        handleQuoteInit(qStatus.id, qStatus.account?.acct || '');
      }

      visBtn.dataset.quote = finalQuote;
      visBtn.dataset.lang = lang;
      visBtn.dataset.sensitive = sensitive ? 'true' : 'false';
      visBtn.disabled = true;
      visBtn.title = "Visibility cannot be changed while editing";
      visBtn.style.opacity = '0.5';

      const iconNode = $('compose-visibility-icon' + suffix);
      const textNode = $('compose-visibility-text' + suffix);
      if (iconNode) iconNode.innerHTML = VIS_ICONS[vis] || VIS_ICONS['public'];
      if (textNode) {
        const primaryLabel = visLabels[vis] || 'Public';
        let extraHtml = '';
        if (finalQuote === 'followers') extraHtml += EXTRA_ICONS['quote_followers'];
        if (finalQuote === 'nobody') extraHtml += EXTRA_ICONS['quote_nobody'];
        if (sensitive) extraHtml += EXTRA_ICONS['sensitive'];

        textNode.innerHTML = `<span>${primaryLabel}</span>${extraHtml ? '<span style="opacity:0.3;margin:0 2px;">·</span>' + extraHtml : ''}`;

        // Tooltip (already set above, but let's make it consistent)
        let tooltip = `(Editing) ${primaryLabel}`;
        tooltip += ` · ${quoteLabelsFull[finalQuote] || 'Anyone can quote'}`;
        if (lang !== 'browser') tooltip += ` · Language: ${lang.toUpperCase()}`;
        if (sensitive) tooltip += ' · Marked Sensitive';
        visBtn.title = tooltip;
      }
      const langText = $('compose-lang-text' + suffix);
      if (langText) langText.textContent = lang === 'browser' ? 'EN' : lang.toUpperCase();
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
    if (to) {
      const typeNode = $('compose-context-type' + suffix);
      if (typeNode) typeNode.textContent = 'Editing post';
      if (bar) bar.style.display = 'flex';
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

window.handleDeleteInit = async function (postId, triggerEl) {
  document.querySelectorAll('.post-dropdown').forEach(m => m.classList.remove('show'));
  if (!state.token) { showToast('Please sign in to delete posts.'); return; }

  // Find preview content
  const btn = triggerEl || document.querySelector(`[data-post-id="${postId}"]`) || 
              document.querySelector(`[data-id="${postId}"]`);
  const postEl = btn ? btn.closest('.feed-status, .post-item, .notification-item, .post-thread-item') : null;
  let previewHTML = postEl ? postEl.querySelector('.post-content')?.innerHTML : '';
  
  if (!previewHTML && postEl) {
    const name = postEl.querySelector('.post-display-name, .profile-display-name')?.textContent || 'this post';
    const acctHandle = postEl.querySelector('.post-acct, .profile-acct')?.textContent || '';
    previewHTML = `<div style="font-weight:600;">Post by ${name}</div><div style="font-size:11px; opacity:0.7;">${acctHandle}</div>`;
  }

  const confirmed = await showConfirm(
    'This will permanently delete the post. This action cannot be undone.',
    'Delete post?',
    previewHTML
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`https://${state.server}/api/v1/statuses/${postId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` },
    });
    if (!res.ok) throw new Error('Failed to delete post');

    // Remove from DOM - data-id lives on <article>, data-status-id on thread wrappers
    document.querySelectorAll(`[data-id="${postId}"]`).forEach(el => {
      // Feed article: remove the article itself (or its parent .post wrapper if any)
      el.remove();
    });
    document.querySelectorAll(`[data-status-id="${postId}"]`).forEach(el => {
      // Thread wrapper div - remove it
      el.remove();
    });

    showToast('Post deleted.', 'success');
  } catch (err) {
    showToast('Could not delete post: ' + err.message, 'error');
  }
};

window.handleDeleteRedraftInit = async function (postId, triggerEl) {
  document.querySelectorAll('.post-dropdown').forEach(m => m.classList.remove('show'));
  if (!state.token) { showToast('Please sign in to delete posts.'); return; }

  // Fetch source AND full status so we can prefill the compose box (including media)
  let sourceText = '';
  let spoilerText = '';
  let deletedPostMedia = [];
  let actualStatus = null;
  try {
    const [sourceResponse, statusResponse] = await Promise.all([
      apiGet(`/api/v1/statuses/${postId}/source`, state.token),
      apiGet(`/api/v1/statuses/${postId}`, state.token),
    ]);
    sourceText = sourceResponse.text || '';
    spoilerText = sourceResponse.spoiler_text || '';
    // Unwrap reblogs - the media lives on the inner reblog object if it's a boost
    actualStatus = statusResponse.reblog || statusResponse;
    deletedPostMedia = actualStatus.media_attachments || [];
  } catch (err) {
    showToast('Could not fetch post source: ' + err.message, 'error');
    return;
  }

  // Find preview content
  const btn = triggerEl || document.querySelector(`[data-post-id="${postId}"]`) || 
              document.querySelector(`[data-id="${postId}"]`);
  const postEl = btn ? btn.closest('.feed-status, .post-item, .notification-item, .post-thread-item') : null;
  let previewHTML = postEl ? postEl.querySelector('.post-content')?.innerHTML : '';
  
  if (!previewHTML && postEl) {
    const name = postEl.querySelector('.post-display-name, .profile-display-name')?.textContent || 'this post';
    const acctHandle = postEl.querySelector('.post-acct, .profile-acct')?.textContent || '';
    previewHTML = `<div style="font-weight:600;">Post by ${name}</div><div style="font-size:11px; opacity:0.7;">${acctHandle}</div>`;
  }

  const confirmed = await showConfirm(
    'The post will be deleted and its text placed in the compose box for you to edit and re-post.',
    'Delete & Redraft?',
    previewHTML
  );
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

  const qRaw = actualStatus.quoted_status ||
    (actualStatus.quote && (actualStatus.quote.quoted_status || actualStatus.quote));
  const qStatus = (qRaw && typeof qRaw === 'object' && qRaw.account) ? qRaw : null;

  const savedQuoteId = qStatus && qStatus.id ? qStatus.id : null;
  const savedQuoteAcct = qStatus && qStatus.account ? qStatus.account.acct : '';

  try {
    const res = await fetch(`https://${state.server}/api/v1/statuses/${postId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` },
    });
    if (!res.ok) throw new Error('Failed to delete post');

    // Remove from DOM - data-id lives on <article>, data-status-id on thread wrappers
    document.querySelectorAll(`[data-id="${postId}"]`).forEach(el => el.remove());
    document.querySelectorAll(`[data-status-id="${postId}"]`).forEach(el => el.remove());

    // resetReplyState wipes & revokes blob URLs - do it before rebuilding media
    resetReplyState();

    const textarea = $('compose-textarea' + suffix);
    textarea.innerText = sourceText;

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
    //    For local file uploads, file is a File object - create a fresh blob URL.
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

    if (savedQuoteId) {
      handleQuoteInit(savedQuoteId, savedQuoteAcct);
    }

    showToast('Post deleted - edit and re-post below.', 'success');
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
    // Sync drawer size to the visual viewport so it stays above the soft keyboard
    if (window.visualViewport) {
      const syncToViewport = () => {
        drawer.style.height = window.visualViewport.height + 'px';
        drawer.style.top = window.visualViewport.offsetTop + 'px';
      };
      drawer._vpHandler = syncToViewport;
      window.visualViewport.addEventListener('resize', syncToViewport);
      window.visualViewport.addEventListener('scroll', syncToViewport);
      syncToViewport();
    }
    // Push history state for back button
    history.pushState({ drawer: 'compose-drawer' }, '', '');
  }
  setTimeout(() => {
    const textarea = $('compose-textarea');
    if (textarea.innerText.length > 0 && !textarea.innerText.endsWith('\u00A0') && !textarea.innerText.endsWith(' ')) {
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

  // Remove visualViewport listener and reset inline size overrides
  if (drawer._vpHandler && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', drawer._vpHandler);
    window.visualViewport.removeEventListener('scroll', drawer._vpHandler);
    delete drawer._vpHandler;
  }
  drawer.style.height = '';
  drawer.style.top = '';

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
  const language = visBtn ? (visBtn.dataset.lang || 'browser') : 'browser';
  const sensitive = visBtn ? (visBtn.dataset.sensitive === 'true') : false;
  const status = getEditorText(textarea);
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

    const postData = { status, visibility, quote_approval_policy, sensitive };
    if (language !== 'browser') postData.language = language;

    if (!composeState.editPostId) {
      if (composeState.replyToId) postData.in_reply_to_id = composeState.replyToId;
      if (composeState.quoteId) {
        postData.quoted_status_id = composeState.quoteId;
        postData.quote_id = composeState.quoteId; // Common in forks
      }
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
  void track.offsetWidth; // force reflow so scroll reset takes effect
  track.style.scrollBehavior = 'auto';
  track.scrollLeft = 0;
  track.scrollTop = 0;
  track.style.scrollBehavior = '';
  mentionSelectedIndex = 0;

  track.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.onmousedown = (e) => e.preventDefault();
    chip.onclick = (e) => { e.preventDefault(); e.stopPropagation(); insertMention(chip.dataset.acct); };
  });
}

function handleMentionKeydown(e, textarea) {
  const strip = getSuggestionsStrip(textarea);
  if (!strip || strip.style.display === 'none' || mentionSelectedIndex < 0) return;
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
  void track.offsetWidth; // force reflow so scroll reset takes effect
  track.style.scrollBehavior = 'auto';
  track.scrollLeft = 0;
  track.scrollTop = 0;
  track.style.scrollBehavior = '';
  hashtagSelectedIndex = 0;

  track.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.onmousedown = (e) => e.preventDefault();
    chip.onclick = (e) => { e.preventDefault(); e.stopPropagation(); insertHashtag(chip.dataset.tag); };
  });
}

function handleHashtagKeydown(e, textarea) {
  const strip = getSuggestionsStrip(textarea);
  if (!strip || strip.style.display === 'none' || hashtagSelectedIndex < 0) return;
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

/* ─── Hashtag Grid Rendering ─── */
window.renderHashtagGrid = function () {
  const grid = $('followed-hashtags-grid');
  if (!grid) return;

  const tags = state.followedHashtags || [];
  const countLabel = $('followed-hashtags-count-label');
  if (countLabel) countLabel.textContent = `Followed Hashtags (${tags.length})`;

  // Always start with "All Hashtags"
  let html = `
    <div class="hashtag-card" onclick="window.selectHashtag('all')">
      <div class="hashtag-card-name">All Hashtags</div>
      <div class="hashtag-card-stats">Unified Feed</div>
    </div>
  `;

  const sorted = [...tags].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  html += sorted.map(t => {
    const usage = t.history ? t.history.reduce((sum, day) => sum + parseInt(day.uses || 0), 0) : null;
    const usageText = usage !== null ? `${usage} uses/week` : 'Following';

    return `
      <div class="hashtag-card" onclick="window.selectHashtag('${escapeHTML(t.name.toLowerCase())}')">
        <div class="hashtag-card-name">${escapeHTML(t.name)}</div>
        <div class="hashtag-card-stats">${usageText}</div>
      </div>
    `;
  }).join('');

  grid.innerHTML = html;
};

window.selectHashtag = function (tag) {
  state.selectedHashtagFilter = tag;
  loadFeedTab();
};

window.unfollowHashtag = async function (tagName, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`https://${state.server}/api/v1/tags/${encodeURIComponent(tagName)}/unfollow`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('Unfollow failed');

    state.followedHashtags = (state.followedHashtags || []).filter(t => t.name.toLowerCase() !== tagName.toLowerCase());
    window.renderHashtagGrid();
    showToast(`Unfollowed #${tagName}`);
  } catch (err) {
    if (btn) btn.disabled = false;
    showToast('Failed to unfollow: ' + err.message);
  }
};

function setupHashtagTab() {
  const btn = $('manage-hashtags-btn');
  const searchInput = $('hashtag-search-input');
  const clearFilterBtn = $('hashtag-clear-filter');

  const lookupDropdown = $('hashtag-lookup-results');
  let selectedLookupIndex = -1;

  if (clearFilterBtn) {
    clearFilterBtn.addEventListener('click', () => {
      window.selectHashtag('landing');
    });
  }

  function doHashtagSearch(val) {
    if (!searchInput) return;
    const explicitVal = typeof val === 'string' ? val : null;
    val = (explicitVal || searchInput.value.trim()).replace(/^#/, '');
    if (val) {
      if (lookupDropdown) lookupDropdown.style.display = 'none';
      state.selectedHashtagFilter = val.toLowerCase();
      loadFeedTab();
      if (explicitVal) {
        searchInput.value = '#' + val;
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

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
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

    searchInput.addEventListener('input', () => {
      selectedLookupIndex = -1;
      clearTimeout(manageHashtagDebounceTimer);
      const q = searchInput.value.trim().replace(/^#/, '');
      if (!q) {
        if (lookupDropdown) lookupDropdown.style.display = 'none';
        return;
      }
      manageHashtagDebounceTimer = setTimeout(() => {
        fetchLookupHashtags(q);
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (lookupDropdown && !e.target.closest('.hashtag-search-wrap') && !e.target.closest('.hashtag-search-hero')) {
        lookupDropdown.style.display = 'none';
      }
    });

    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim().length > 0 && lookupDropdown.innerHTML !== '') {
        lookupDropdown.style.display = 'flex';
      }
    });
  }

  async function fetchLookupHashtags(q) {
    if (manageHashtagActiveRequest) manageHashtagActiveRequest.abort();
    const controller = new AbortController();
    manageHashtagActiveRequest = controller;
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

  // --- Manage Hashtags Drawer ---
  const drawer = $('manage-hashtag-drawer');
  const backdrop = $('manage-hashtag-backdrop');
  // Note: closeBtn and searchInput in drawer should have unique IDs if needed, but let's stick to what's in index.html
  const closeBtn = $('manage-hashtag-close');
  const drawerSearchInput = $('manage-hashtag-search-input');

  if (!btn || !drawer) return;

  function openManageHashtagsPanel() {
    history.pushState({ drawer: 'manage-hashtag-drawer' }, '', '');
    drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    renderCurrentlyFollowingInDrawer();
    if (drawerSearchInput) {
      drawerSearchInput.value = '';
      $('manage-hashtag-search-results').innerHTML = '';
      setTimeout(() => drawerSearchInput.focus(), 100);
    }
  }

  function closeManageHashtagsPanel() {
    drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    loadFeedTab();
    window.renderHashtagGrid(); // Ensure landing grid is fresh
  }

  btn.addEventListener('click', openManageHashtagsPanel);
  if (closeBtn) closeBtn.addEventListener('click', closeManageHashtagsPanel);
  if (backdrop) backdrop.addEventListener('click', closeManageHashtagsPanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) {
      closeManageHashtagsPanel();
    }
  });

  window.openManageHashtagsPanel = openManageHashtagsPanel;

  function renderCurrentlyFollowingInDrawer() {
    const list = $('manage-hashtags-list');
    const tags = state.followedHashtags || [];
    if (!list) return;
    if (!tags.length) {
      list.innerHTML = '<div style="font-size:13px; color:var(--text-muted); padding: 8px 0;">You are not following any hashtags yet.</div>';
      return;
    }

    const sorted = [...tags].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    list.innerHTML = sorted.map(t => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--bg); border:1px solid var(--border); border-radius:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:28px; height:28px; border-radius:6px; background:var(--surface); display:flex; align-items:center; justify-content:center; color:var(--accent); font-weight:bold; font-size:13px;">#</div>
          <span style="font-weight:500; font-size:13px;">${escapeHTML(t.name)}</span>
        </div>
        <button class="profile-follow-btn following outline" data-tag="${escapeHTML(t.name)}" data-following="true" style="padding:6px 12px; height:auto; min-width:80px; font-size:13px;">Unfollow</button>
      </div>
    `).join('');

    list.querySelectorAll('.profile-follow-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const { handleHashtagFollowToggle } = await import('./profile.js');
        await handleHashtagFollowToggle(b);
        renderCurrentlyFollowingInDrawer();
        window.renderHashtagGrid();
      });
    });
  }

  if (drawerSearchInput) {
    drawerSearchInput.addEventListener('input', () => {
      clearTimeout(manageHashtagDebounceTimer);
      const q = drawerSearchInput.value.trim().replace(/^#/, '');
      if (!q) {
        $('manage-hashtag-search-results').innerHTML = '';
        return;
      }
      manageHashtagDebounceTimer = setTimeout(() => {
        fetchManageHashtagsInDrawer(q);
      }, 300);
    });
  }

  async function fetchManageHashtagsInDrawer(q) {
    if (manageHashtagActiveRequest) manageHashtagActiveRequest.abort();
    const controller = new AbortController();
    manageHashtagActiveRequest = controller;
    try {
      $('manage-hashtag-search-results').innerHTML = '<div class="spinner" style="margin: 10px auto;"></div>';
      const { apiGet } = await import('./api.js');
      const results = await apiGet(`/api/v2/search?q=${encodeURIComponent(q)}&type=hashtags&limit=5`, state.token, null, controller.signal);
      renderSearchResultsInDrawer(results.hashtags || []);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('Hashtag search failed:', err);
    }
  }

  function renderSearchResultsInDrawer(tags) {
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
        const isFollowing = b.dataset.following === 'true';
        if (isFollowing) {
          b.classList.add('following', 'outline');
          b.textContent = 'Unfollow';
        } else {
          b.classList.remove('following', 'outline');
          b.textContent = 'Follow';
        }
        renderCurrentlyFollowingInDrawer();
        window.renderHashtagGrid();
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
  $('compose-textarea-sidebar').addEventListener('input', updateSidebarCharCount);
  $('compose-cw-input-sidebar').addEventListener('input', updateSidebarCharCount);
  $('compose-textarea-sidebar').addEventListener('focus', updateSidebarCharCount);
  $('compose-textarea-sidebar').addEventListener('blur', () => setTimeout(updateSidebarCharCount, 50));
  $('compose-cw-input-sidebar').addEventListener('focus', updateSidebarCharCount);
  $('compose-cw-input-sidebar').addEventListener('blur', () => setTimeout(updateSidebarCharCount, 50));
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
