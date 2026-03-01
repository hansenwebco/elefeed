/**
 * @module render
 * Post rendering — builds the HTML for feed posts and thread posts.
 *
 * Both renderPost() and renderThreadPost() share identical media / poll /
 * quote / CW / footer logic.  The private _buildPostBody() helper handles
 * that shared core, while the two public functions add their own wrapper
 * (context badges for feed posts, variant divs for thread posts).
 *
 * Functions that need to be available from inline onclick handlers in
 * rendered HTML are assigned to `window` at the bottom of this file.
 */

import { state } from './state.js';
import {
  escapeHTML, sanitizeHTML, processContent,
  renderCustomEmojis, relativeTime,
} from './utils.js';

/* ══════════════════════════════════════════════════════════════════════
   SHARED INNER BODY
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Build the inner content of a post: media grid, poll, quote, CW wrapper,
 * post footer (reply, boost, fav, bookmark, external link).
 *
 * Returns { contentHTML, footerHTML }
 */
function _buildPostBody(status, s, idPrefix = '') {
  /* ── Media ── */
  let mediaHTML = '';
  if (s.media_attachments && s.media_attachments.length > 0) {
    const count = Math.min(s.media_attachments.length, 4);
    const items = s.media_attachments.slice(0, 4).map(m => {
      const sensitive = s.sensitive;
      const blurClass = sensitive ? 'media-sensitive-blur' : '';
      const overlay = sensitive ? `
        <div class="sensitive-overlay" onclick="event.stopPropagation(); this.parentElement.querySelector('img,video').classList.remove('media-sensitive-blur'); this.style.display='none'">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          <span>sensitive content</span>
        </div>` : '';

      if (m.type === 'image' || m.type === 'gifv') {
        return `<div class="media-item" data-full-url="${m.url}" data-type="image" onclick="expandMedia(this)">
          <img src="${m.preview_url || m.url}" alt="${(m.description || '').replace(/"/g, '&quot;')}" class="${blurClass}" loading="lazy" onload="adjustImageAlignment(this)"/>
          ${overlay}
        </div>`;
      } else if (m.type === 'video') {
        return `<div class="media-item" data-full-url="${m.url}" data-type="video" onclick="expandMedia(this)">
          <video src="${m.url}" poster="${m.preview_url || ''}" controls muted class="${blurClass}"></video>
          ${overlay}
        </div>`;
      }
      return '';
    }).join('');

    mediaHTML = `<div class="post-media"><div class="post-media-grid count-${count}">${items}</div></div>`;
  }

  /* ── Poll ── */
  let pollHTML = '';
  if (s.poll) {
    const total = s.poll.votes_count || 1;
    const options = s.poll.options.map(opt => {
      const pct = total > 0 ? Math.round((opt.votes_count / total) * 100) : 0;
      return `<div class="poll-option">
        <div class="poll-bar" style="width:${pct}%"></div>
        <span class="poll-option-text">${escapeHTML(opt.title)}</span>
        <span class="poll-pct">${pct}%</span>
      </div>`;
    }).join('');
    pollHTML = `<div class="post-poll">${options}<div class="poll-meta">${total} votes · ${s.poll.expired ? 'closed' : 'open'}</div></div>`;
  }

  /* ── Quote ── */
  let quoteHTML = '';
  const qStatus = s.quote && (s.quote.quoted_status || (s.quote.account ? s.quote : null));
  if (qStatus) {
    const qHasCW = (qStatus.spoiler_text && qStatus.spoiler_text.length > 0) || qStatus.sensitive;
    const qCwText = qStatus.spoiler_text ? escapeHTML(qStatus.spoiler_text) : 'Sensitive content';
    const qCwId = `qcw-${idPrefix}${qStatus.id}-${status.id}`;
    let qContentHTML = '';
    if (qHasCW) {
      qContentHTML = `
        <div class="cw-wrapper">
          <div class="cw-summary" style="cursor:pointer;" onclick="event.stopPropagation(); window.toggleCW('${qCwId}', this.querySelector('.cw-toggle'))">
            <span>${qCwText}</span>
            <button class="cw-toggle" onclick="event.stopPropagation(); window.toggleCW('${qCwId}', this)">show</button>
          </div>
          <div class="cw-body" id="${qCwId}">
            <div class="post-content">${processContent(sanitizeHTML(qStatus.content))}</div>
          </div>
        </div>`;
    } else {
      qContentHTML = `<div class="post-content" style="margin-bottom:0">${processContent(sanitizeHTML(qStatus.content))}</div>`;
    }

    quoteHTML = `
      <div class="post-quote" onclick="event.stopPropagation(); window.open('${qStatus.url}', '_blank')">
        <div class="post-header" style="margin-bottom:8px;">
          <div class="post-avatar" style="width:24px;height:24px;">
            <img src="${qStatus.account.avatar_static || qStatus.account.avatar}" alt="" loading="lazy"/>
            ${state.knownFollowing.has(qStatus.account.id) ? `<div class="following-badge" title="Following">
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </div>` : ''}
          </div>
          <div class="post-meta"><div class="post-author" style="font-size:13px;">
            <span class="post-display-name">${renderCustomEmojis(qStatus.account.display_name || qStatus.account.username, qStatus.account.emojis)}</span>
            <span class="post-acct">@${escapeHTML(qStatus.account.acct)}</span>
            <span class="post-time">${relativeTime(qStatus.created_at)}</span>
          </div></div>
        </div>
        ${qContentHTML}
      </div>`;
  }

  /* ── Content warning wrapper ── */
  const hasCW = (s.spoiler_text && s.spoiler_text.length > 0) || s.sensitive;
  const cwText = s.spoiler_text ? escapeHTML(s.spoiler_text) : 'Sensitive content';
  const cwId = `cw-${idPrefix}${status.id}`;
  let contentHTML = '';
  if (hasCW) {
    contentHTML = `
      <div class="cw-wrapper">
        <div class="cw-summary" style="cursor:pointer;" onclick="event.stopPropagation(); window.toggleCW('${cwId}', this.querySelector('.cw-toggle'))">
          <span>${cwText}</span>
          <button class="cw-toggle" onclick="event.stopPropagation(); window.toggleCW('${cwId}', this)">show</button>
        </div>
        <div class="cw-body" id="${cwId}">
          <div class="post-content">${processContent(sanitizeHTML(s.content))}</div>
          ${mediaHTML}${pollHTML}${quoteHTML}
        </div>
      </div>`;
  } else {
    contentHTML = `
      <div class="post-content">${processContent(sanitizeHTML(s.content))}</div>
      ${mediaHTML}${pollHTML}${quoteHTML}`;
  }

  /* ── Footer: reply, boost, favourite, bookmark, external ── */
  const footerHTML = `
    <div class="post-footer">
      <button class="post-stat post-reply-btn" data-post-id="${s.id}" data-account-acct="${s.account.acct}" title="Reply">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10l5-5v3c8 0 13 4 13 11-3-4-7-5-13-5v3l-5-5z"></path></svg>
        <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-dim);">${s.replies_count || 0}</span>
      </button>
      <div style="position:relative;display:inline-flex;">
        <button class="post-stat post-boost-btn ${s.reblogged ? 'boosted' : ''}" data-post-id="${s.id}" title="Boost or Quote">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--boost)"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          <span class="boost-count" style="font-family:var(--font-mono);font-size:12px;color:var(--text-dim);">${(s.reblogs_count || 0) + (s.quotes_count || 0)}</span>
        </button>
        <div class="boost-dropdown" id="boost-menu-${s.id}">
          <button class="boost-dropdown-item" data-action="boost" data-post-id="${s.id}" data-is-boosted="${s.reblogged ? 'true' : 'false'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            <span>${s.reblogged ? 'Undo Boost' : 'Boost'}</span>
            <span class="dropdown-stat-count" style="margin-left:auto;color:var(--text-muted);font-size:12.5px;font-family:var(--font-mono);">${s.reblogs_count || 0}</span>
          </button>
          ${(!s.quote_approval || s.quote_approval.current_user !== 'denied') && s.visibility !== 'private' && s.visibility !== 'direct' ? `
          <button class="boost-dropdown-item" data-action="quote" data-post-id="${s.id}" data-acct="${escapeHTML(s.account.acct)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 11h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2zm10 0h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2z"/></svg>
            <span>Quote</span>
            <span class="dropdown-stat-count" style="margin-left:auto;color:var(--text-muted);font-size:12.5px;font-family:var(--font-mono);">${s.quotes_count || 0}</span>
          </button>` : ''}
        </div>
      </div>
      <button class="post-stat post-fav-btn ${s.favourited ? 'favourited' : ''}" data-post-id="${s.id}" data-favourited="${s.favourited ? 'true' : 'false'}" title="${s.favourited ? 'Unfavorite' : 'Favorite'}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${s.favourited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" style="color:var(--fav)"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        <span class="post-fav-count">${s.favourites_count || 0}</span>
      </button>
      <button class="post-stat post-bookmark-btn ${s.bookmarked ? 'bookmarked' : ''}" data-post-id="${s.id}" data-bookmarked="${s.bookmarked ? 'true' : 'false'}" title="${s.bookmarked ? 'Remove bookmark' : 'Bookmark'}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${s.bookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
      </button>
      <a href="${s.url}" target="_blank" rel="noopener" style="margin-left:auto;color:var(--text-dim);font-family:var(--font-mono);font-size:11px;text-decoration:none;" title="Open original">↗</a>
    </div>`;

  return { contentHTML, footerHTML };
}

/* ══════════════════════════════════════════════════════════════════════
   FEED POST
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Render a post for the main feed.
 * @param {object} status  Mastodon status object
 * @param {object} opts    { tags: string[], tag: string }
 */
export function renderPost(status, opts = {}) {
  const isBoost = !!status.reblog;
  const boostBy = isBoost ? status.account : null;
  const s = isBoost ? status.reblog : status;
  const profileServer = escapeHTML(state.server || '');

  const { contentHTML, footerHTML } = _buildPostBody(status, s);

  /* ── Hashtag banner ── */
  const tagList = opts.tags && opts.tags.length ? opts.tags : (opts.tag ? [opts.tag] : []);
  const isHashtagPost = tagList.length > 0;
  const hashtagBanner = (isHashtagPost && !boostBy) ? `
    <div class="post-hashtag-banner">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
      via
      <div class="post-hashtag-banner-tags">${tagList.map(t =>
    `<a href="#" class="hashtag post-hashtag-banner-tag">#${escapeHTML(t)}</a>`
  ).join('')}</div>
    </div>` : '';

  /* ── Boost header ── */
  const boostLabelHTML = boostBy ? `
    <div class="boost-divider">
      <div class="boost-text">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        <span class="post-display-name" data-profile-id="${boostBy.id}" data-profile-server="${profileServer}">${renderCustomEmojis(boostBy.display_name || boostBy.username, boostBy.emojis)}</span> <span style="opacity:0.8;text-transform:uppercase;font-size:11px;font-weight:500;">boosted</span>
      </div>
      <div class="boost-divider-line"></div>
      <svg class="boost-divider-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
    </div>` : '';

  /* ── Context class ── */
  let contextClass = '';
  if (boostBy) contextClass = ' post--boost';
  else if (isHashtagPost) contextClass = ' post--hashtag';
  else if (s.in_reply_to_id) contextClass = ' post--reply';

  return `
    <article class="post${contextClass}" data-id="${s.id}">
      ${boostLabelHTML}
      ${hashtagBanner}
      <div class="post-header">
        <div class="post-avatar" data-profile-id="${s.account.id}" data-profile-server="${profileServer}" style="cursor:pointer">
          <img src="${s.account.avatar_static || s.account.avatar}" alt="${escapeHTML(s.account.display_name || s.account.username)}" loading="lazy"/>
          ${state.knownFollowing.has(s.account.id) ? `<div class="following-badge" title="Following">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </div>` : ''}
        </div>
        <div class="post-meta">
          <div class="post-author">
            <span class="post-display-name" data-profile-id="${s.account.id}" data-profile-server="${profileServer}">${renderCustomEmojis(s.account.display_name || s.account.username, s.account.emojis)}</span>
            <span class="post-acct">@${escapeHTML(s.account.acct)}</span>
            <span class="post-time">${relativeTime(s.created_at)}</span>
          </div>
        </div>
        ${state.account && s.account.id === state.account.id ? `
        <div style="position:relative; margin-left:auto; display:inline-flex;">
          <button class="icon-btn post-menu-btn" data-post-id="${s.id}" title="Post options" style="margin-right:-8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="opacity:0.6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="1"/>
              <circle cx="19" cy="12" r="1"/>
              <circle cx="5" cy="12" r="1"/>
            </svg>
          </button>
          <div class="boost-dropdown post-dropdown" id="post-menu-${s.id}" style="right:0; left:auto; top:100%; bottom:auto; margin-top:8px; min-width:150px; transform-origin: top right;">
            <button class="boost-dropdown-item" data-action="edit" data-post-id="${s.id}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
              <span>Edit</span>
            </button>
          </div>
        </div>
        ` : ''}
      </div>
      ${contentHTML}
      ${footerHTML}
    </article>`;
}

/* ══════════════════════════════════════════════════════════════════════
   THREAD POST
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Render a post for use inside the thread drawer/panel.
 * @param {object} status   Mastodon status object
 * @param {'ancestor'|'focal'|'reply'} variant
 */
export function renderThreadPost(status, variant) {
  const isBoost = !!status.reblog;
  const s = isBoost ? status.reblog : status;
  const boostBy = isBoost ? status.account : null;
  const profileServer = escapeHTML(state.server || '');

  const { contentHTML, footerHTML } = _buildPostBody(status, s, 'thread-');

  const boostLabelHTML = boostBy ? `
    <div class="boost-divider">
      <div class="boost-text">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        <span class="post-display-name" data-profile-id="${boostBy.id}" data-profile-server="${profileServer}">${renderCustomEmojis(boostBy.display_name || boostBy.username, boostBy.emojis)}</span> <span style="opacity:0.8;text-transform:uppercase;font-size:11px;font-weight:500;">boosted</span>
      </div>
      <div class="boost-divider-line"></div>
    </div>` : '';

  const variantClass =
    variant === 'focal' ? 'thread-post-focal' :
      variant === 'ancestor' ? 'thread-post-ancestor' :
        'thread-post-reply';

  /* Use the same context classes as feed posts */
  let contextClass = '';
  if (boostBy) contextClass = ' post--boost';
  else if (s.in_reply_to_id) contextClass = ' post--reply';

  return `
    <div class="${variantClass}" data-status-id="${s.id}">
      <article class="post${contextClass}" data-id="${status.id}">
        ${boostLabelHTML}
        <div class="post-header">
          <div class="post-avatar" data-profile-id="${s.account.id}" data-profile-server="${profileServer}" style="cursor:pointer">
            <img src="${s.account.avatar_static || s.account.avatar}" alt="${escapeHTML(s.account.display_name || s.account.username)}" loading="lazy"/>
            ${state.knownFollowing.has(s.account.id) ? `<div class="following-badge" title="Following">
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </div>` : ''}
          </div>
          <div class="post-meta">
            <div class="post-author">
              <span class="post-display-name" data-profile-id="${s.account.id}" data-profile-server="${profileServer}">${renderCustomEmojis(s.account.display_name || s.account.username, s.account.emojis)}</span>
              <span class="post-acct">@${escapeHTML(s.account.acct)}</span>
              <span class="post-time">${relativeTime(s.created_at)}</span>
            </div>
          </div>
          ${state.account && s.account.id === state.account.id ? `
          <div style="position:relative; margin-left:auto; display:inline-flex;">
            <button class="icon-btn post-menu-btn" data-post-id="${s.id}" title="Post options" style="margin-right:-8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="opacity:0.6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="1"/>
                <circle cx="19" cy="12" r="1"/>
                <circle cx="5" cy="12" r="1"/>
              </svg>
            </button>
            <div class="boost-dropdown post-dropdown" id="post-menu-${s.id}" style="right:0; left:auto; top:100%; bottom:auto; margin-top:8px; min-width:150px; transform-origin: top right;">
              <button class="boost-dropdown-item" data-action="edit" data-post-id="${s.id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                <span>Edit</span>
              </button>
            </div>
          </div>
          ` : ''}
        </div>
        ${contentHTML}
        ${footerHTML}
      </article>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   WINDOW GLOBALS (required by inline onclick/onload in rendered HTML)
   ══════════════════════════════════════════════════════════════════════ */

/** Open lightbox overlay for a media item. */
window.expandMedia = function expandMedia(mediaItem) {
  const fullUrl = mediaItem.dataset.fullUrl;
  const type = mediaItem.dataset.type;
  if (!fullUrl) return;

  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  const content = document.createElement('div');
  content.className = 'lightbox-content';

  let mediaEl;
  if (type === 'video') {
    mediaEl = document.createElement('video');
    mediaEl.src = fullUrl;
    mediaEl.controls = true;
    mediaEl.autoplay = true;
  } else {
    mediaEl = document.createElement('img');
    mediaEl.src = fullUrl;
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'lightbox-close';
  closeBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  content.appendChild(mediaEl);
  overlay.appendChild(content);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);

  history.pushState({ mediaViewer: true }, '', '');

  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 250);
    document.removeEventListener('keydown', handleEsc);
  };
  const handleEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

  overlay.onclick = close;
  closeBtn.onclick = (e) => { e.stopPropagation(); close(); };
  mediaEl.onclick = (e) => e.stopPropagation();
  document.addEventListener('keydown', handleEsc);
};

/** Classify an image as vertical or horizontal after it loads. */
window.adjustImageAlignment = function adjustImageAlignment(img) {
  if (img.complete) {
    const aspectRatio = img.naturalWidth / img.naturalHeight;
    img.classList.add(aspectRatio < 1 ? 'vertical-image' : 'horizontal-image');
  } else {
    img.onload = () => adjustImageAlignment(img);
  }
};

/** Toggle a content-warning body open/closed. */
window.toggleCW = function toggleCW(id, btn) {
  const body = document.getElementById(id);
  const expanded = body.classList.toggle('expanded');
  btn.textContent = expanded ? 'hide' : 'show';
};
