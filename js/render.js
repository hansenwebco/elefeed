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

import { state, store } from './state.js';
import {
  escapeHTML, sanitizeHTML, processContent, extractTrailingHashtags,
  renderCustomEmojis, relativeTime,
} from './utils.js';

/**
 * Returns the HTML for a small "following" badge if the account is followed.
 * @param {string} accountId
 * @returns {string}
 */
export function renderFollowingBadge(accountId) {
  if (state.knownFollowing.has(accountId)) {
    return `<div class="following-badge" title="Following">
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
    </div>`;
  }
  return '';
}

/* ══════════════════════════════════════════════════════════════════════
   SHARED INNER BODY
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Build the inner content of a post: media grid, poll, quote, CW wrapper,
 * post footer (reply, boost, fav, bookmark, external link).
 *
 * Returns { contentHTML, footerHTML }
 */
function _buildPostBody(status, s, idPrefix = '', analyticsHTML = '', isOwnPost = false) {
  let hideSensitiveMedia = true;
  try { hideSensitiveMedia = localStorage.getItem('pref_hide_sensitive_media') !== 'false'; } catch { }

  /* ── Media ── */
  let mediaHTML = '';
  if (s.media_attachments && s.media_attachments.length > 0) {
    const count = Math.min(s.media_attachments.length, 4);
    const sensitive = s.sensitive;
    const startBlurred = sensitive && hideSensitiveMedia;
    const pill = sensitive ? `
      <button class="sensitive-pill${startBlurred ? '' : ' sp-revealed'}" onclick="event.stopPropagation(); toggleSensitiveMedia(this)" aria-label="Toggle sensitive media">
        <div class="sp-card">
          <span class="sp-card-title">Sensitive content</span>
          <span class="sp-card-sub">Click to show</span>
        </div>
        <svg class="sp-icon sp-icon-eye" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <span class="sp-revealed-label">hide</span>
      </button>` : '';

    const items = s.media_attachments.slice(0, 4).map(m => {
      const blurClass = startBlurred ? 'media-sensitive-blur' : '';

      // Single-image post: set the true aspect ratio and natural width from
      // metadata so the container matches the image's real shape exactly.
      // CSS caps the height at 500 px and shrinks the border to fit.
      let itemStyle = '';
      if (count === 1) {
        const origW = m.meta?.original?.width || m.meta?.small?.width;
        const origH = m.meta?.original?.height || m.meta?.small?.height;
        if (origW > 0 && origH > 0) {
          itemStyle = ` style="aspect-ratio: ${origW} / ${origH}; max-width: ${origW}px"`;
        }
      }

      if (m.type === 'image') {
        return `<div class="media-item" data-full-url="${m.url}" data-type="image" data-alt="${(m.description || '').replace(/"/g, '&quot;')}" onclick="expandMedia(this)"${itemStyle}>
          <img src="${m.preview_url || m.url}" alt="${(m.description || '').replace(/"/g, '&quot;')}" class="${blurClass}" loading="lazy"/>
        </div>`;
      } else if (m.type === 'gifv') {
        // GIFV: use <video> with no controls; don't autoplay while hidden behind a sensitive warning
        return `<div class="media-item" data-full-url="${m.url}" data-type="gifv" data-alt="${(m.description || '').replace(/"/g, '&quot;')}" onclick="expandMedia(this)"${itemStyle}>
          <video src="${m.url}" poster="${m.preview_url || ''}" ${startBlurred ? '' : 'autoplay '}loop muted playsinline class="${blurClass}"></video>
        </div>`;
      } else if (m.type === 'video') {
        // Video: custom minimal player (consistent across all browsers)
        return `<div class="media-item video-player-wrap vp-muted" data-full-url="${m.url}" data-type="video" data-alt="${(m.description || '').replace(/"/g, '&quot;')}" onclick="vpWrapperClick(event,this)"${itemStyle}>
          <video src="${m.url}" poster="${m.preview_url || ''}" muted playsinline class="${blurClass}"></video>
          <div class="vid-overlay-play" onclick="event.stopPropagation();vpTogglePlay(this.closest('.video-player-wrap'))">
            <div class="vid-overlay-btn"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg></div>
          </div>
          <div class="vid-controls" onclick="event.stopPropagation()">
            <button class="vid-btn" onclick="vpTogglePlay(this.closest('.video-player-wrap'))">
              <svg class="vp-icon-play" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg>
              <svg class="vp-icon-pause" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            </button>
            <div class="vid-progress" onclick="vpSeek(event,this.closest('.video-player-wrap'))"><div class="vid-progress-fill"></div></div>
            <span class="vid-time">0:00</span>
            <button class="vid-btn" onclick="vpToggleMute(this.closest('.video-player-wrap'))">
              <svg class="vp-icon-sound" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
              <svg class="vp-icon-mute" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>`;
      }
      return '';
    }).join('');

    mediaHTML = `<div class="post-media${count === 1 ? ' post-media--single' : ''}"><div class="post-media-grid count-${count}">${items}</div>${pill}</div>`;
  }

  /* ── Poll ── */
  let pollHTML = '';
  if (s.poll) {
    pollHTML = renderPoll(s.poll);
  }

  /* ── Quote ── */
  let quoteHTML = '';
  // Exhaustive search for quoted status across official and fork API formats
  let qRaw = s.quoted_status ||
    (s.quote && (s.quote.quoted_status || s.quote)) ||
    status.quoted_status ||
    (status.quote && (status.quote.quoted_status || status.quote));

  // Also check if the 's' itself is the quote (happens in some fork boost handling)
  if (qRaw && (qRaw.id === s.id || qRaw.id === status.id)) qRaw = null;

  // Final check for a valid status object with an account
  const qStatus = (qRaw && typeof qRaw === 'object' && qRaw.account && qRaw.content !== undefined) ? qRaw : null;

  if (qStatus) {
    let autoOpenSensitive = false;
    try { autoOpenSensitive = localStorage.getItem('pref_auto_open_sensitive') === 'true'; } catch { }
    const qHasCW = (qStatus.spoiler_text && qStatus.spoiler_text.length > 0);
    const qCwText = qStatus.spoiler_text ? escapeHTML(qStatus.spoiler_text) : 'Sensitive content';
    const qCwId = `qcw-${idPrefix}${qStatus.id}-${status.id}`;
    const qIsExpanded = autoOpenSensitive || !qHasCW;

    let qContentHTML = '';
    if (qHasCW) {
      qContentHTML = `
          <div class="cw-wrapper" style="margin:4px 0 0;">
            <div class="cw-summary" style="cursor:pointer; font-size:12px;" onclick="event.stopPropagation(); window.toggleCW('${qCwId}', this.querySelector('.cw-toggle'))">
              <span>CW: ${qCwText}</span>
              <button class="cw-toggle" style="padding:3px 8px; font-size:11px;" onclick="event.stopPropagation(); window.toggleCW('${qCwId}', this)">${qIsExpanded ? 'hide' : 'show'}</button>
            </div>
            <div class="cw-body${qIsExpanded ? ' expanded' : ''}" id="${qCwId}">
              <div class="post-content" style="font-size:12.5px; opacity:0.9;">${processContent(sanitizeHTML(qStatus.content, { mentions: qStatus.mentions, emojis: qStatus.emojis, server: state.server }))}</div>
            </div>
          </div>`;
    } else {
      qContentHTML = `<div class="post-content" style="font-size:12.5px; opacity:0.9; margin-bottom:0; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;">${processContent(sanitizeHTML(qStatus.content, { mentions: qStatus.mentions, emojis: qStatus.emojis, server: state.server }))}</div>`;
    }

    let qMediaHTML = '';
    if (qStatus.media_attachments && qStatus.media_attachments.length > 0) {
      const m = qStatus.media_attachments[0];
      const purl = m.preview_url || m.url;
      if (purl) {
        const qSensitive = qStatus.sensitive;
        const startBlurred = qSensitive && hideSensitiveMedia;
        const blurClass = startBlurred ? ' media-sensitive-blur' : '';

        const qPill = qSensitive ? `
            <button class="sensitive-pill${startBlurred ? '' : ' sp-revealed'}" onclick="event.stopPropagation(); window.toggleSensitiveMedia(this)" aria-label="Toggle sensitive media">
              <div class="sp-card" style="padding:8px 12px; border-radius:10px;">
                <span class="sp-card-title" style="font-size:12px;">Sensitive content</span>
                <span class="sp-card-sub" style="font-size:10px;">Click to show</span>
              </div>
              <svg class="sp-icon sp-icon-eye" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <span class="sp-revealed-label" style="font-size:10px;">hide</span>
            </button>` : '';

        qMediaHTML = `<div class="post-media" style="margin-top:8px; border-radius:6px; overflow:hidden; position:relative; background:var(--bg); border:1px solid var(--border); line-height:0;">
            <img src="${purl}" class="${blurClass}" style="width:100%; height:auto; max-height:300px; object-fit:contain; display:block;" loading="lazy">
            ${m.type === 'video' || m.type === 'gifv' ? '<div style="position:absolute; bottom:6px; right:6px; background:rgba(0,0,0,0.6); color:#fff; font-size:9px; font-weight:700; padding:2px 5px; border-radius:3px; letter-spacing:0.5px;">VIDEO</div>' : ''}
            ${qPill}
          </div>`;
      }
    }

    quoteHTML = `
        <div class="post-quote" style="padding:10px; margin-top:8px;" onclick="event.stopPropagation(); if (window.openThreadDrawer) window.openThreadDrawer('${qStatus.id}'); else window.open('${qStatus.url}', '_blank')">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
          <div style="position:relative; width:20px; height:20px; flex-shrink:0;">
            <img src="${qStatus.account.avatar_static || qStatus.account.avatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover; background:var(--surface); display:block;" onerror="this.onerror=null;this.src=window._AVATAR_PLACEHOLDER">
            ${renderFollowingBadge(qStatus.account.id)}
          </div>
            <div style="display:flex; flex-direction:column; line-height:1.2; overflow:hidden;">
              <span style="font-weight:600; font-size:12.5px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${renderCustomEmojis(qStatus.account.display_name || qStatus.account.username, qStatus.account.emojis)}</span>
              <span style="color:var(--text-dim); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">@${escapeHTML(qStatus.account.acct)}</span>
            </div>
          </div>
          ${qContentHTML}
          ${qMediaHTML}
          <div class="quote-footer" style="display:flex; align-items:center; gap:10px; margin-top:8px; opacity:0.6; font-size:11px; font-family:var(--font-mono);">
            <div style="display:flex; align-items:center; gap:3px;"><span style="font-weight:600;">${qStatus.replies_count || 0}</span> replies</div>
            <div style="display:flex; align-items:center; gap:3px;"><span style="font-weight:600;">${(qStatus.reblogs_count || 0) + (qStatus.quotes_count || 0)}</span> boosts</div>
            <div style="display:flex; align-items:center; gap:3px;"><span style="font-weight:600;">${qStatus.favourites_count || 0}</span> favs</div>
          </div>
        </div>`;
  } else if (s.quote_id || s.quoted_status_id || (s.quote && typeof s.quote === 'string')) {
    // Fallback: we know it's a quote but we don't have the status object
    const qid = s.quote_id || s.quoted_status_id || (typeof s.quote === 'string' ? s.quote : '');
    if (qid) {
      quoteHTML = `<div class="post-quote" style="padding:10px; margin-top:8px; border-style:dashed; opacity:0.7;" onclick="event.stopPropagation(); if (window.openThreadDrawer) window.openThreadDrawer('${qid}');">
          <div style="font-size:12px; color:var(--text-dim); display:flex; align-items:center; gap:6px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 11h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2zm10 0h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2z"/></svg>
            Quoted post (click to load)
          </div>
        </div>`;
    }
  }

  /* ── Card (Link Preview) ── */
  let cardHTML = '';
  // Suppress card if it's the same URL as the quoted status to avoid redundancy
  const isDuplicateCard = qStatus && s.card && (s.card.url === qStatus.url || s.card.url === qStatus.uri);

  if (s.card && !isDuplicateCard && (!s.media_attachments || s.media_attachments.length === 0)) {
    const isVideo = (s.card.type === 'video' || s.card.type === 'rich') && s.card.html;
    const cardSensitive = s.sensitive && hideSensitiveMedia;

    let cardMediaHTML = s.card.image ? `<img src="${s.card.image}" alt="" class="post-card-image${cardSensitive ? ' media-sensitive-blur' : ''}" loading="lazy" ${s.card.width && s.card.height ? `style="aspect-ratio: ${s.card.width} / ${s.card.height}"` : ''} />` : '';

    if (isVideo && cardMediaHTML) {
      const encodedHtml = encodeURIComponent(s.card.html);
      const ratio = s.card.width && s.card.height ? `${s.card.width} / ${s.card.height}` : '16 / 9';
      cardMediaHTML = `
        <div class="post-card-video-wrapper" onclick="event.preventDefault(); event.stopPropagation(); window.playCardVideo(this, '${encodedHtml}', '${ratio}')">
          ${cardMediaHTML}
          <div class="post-card-play-overlay">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="8 5 19 12 8 19"></polygon></svg>
          </div>
        </div>`;
    }

    // Sensitive link cards with media are rendered as <div> (not <a>) so the
    // browser can never auto-navigate. Navigation is handled via window.open.
    let sensitiveCardLocked = false;
    if (cardSensitive && cardMediaHTML) {
      const cardPill = `<button class="sensitive-pill" onclick="event.stopPropagation(); toggleSensitiveMedia(this)" aria-label="Toggle sensitive media">
        <div class="sp-card"><span class="sp-card-title">Sensitive content</span><span class="sp-card-sub">Click to show</span></div>
        <svg class="sp-icon sp-icon-eye" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <span class="sp-revealed-label">hide</span>
      </button>`;
      cardMediaHTML = `<div class="post-card-img-wrap">${cardMediaHTML}${cardPill}</div>`;
      sensitiveCardLocked = true;
    }

    const tag = (isVideo || sensitiveCardLocked) ? 'div' : 'a';
    const hrefAttr = isVideo
      ? ''
      : (sensitiveCardLocked
        ? `data-card-url="${s.card.url}"`
        : `href="${s.card.url}" target="_blank" rel="noopener"`);
    const titleText = escapeHTML(s.card.title || '');
    const titleHTML = s.card.title ? `<div class="post-card-title">${isVideo ? `<a href="${s.card.url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;" onclick="event.stopPropagation()">${titleText}</a>` : titleText}</div>` : '';
    const cardOnclick = sensitiveCardLocked
      ? 'handleSensitiveCardClick(event, this)'
      : 'event.stopPropagation()';

    cardHTML = `
      <${tag} ${hrefAttr} class="post-card" onclick="${cardOnclick}">
        ${cardMediaHTML}
        <div class="post-card-content">
          ${titleHTML}
          ${s.card.description ? `<div class="post-card-description">${escapeHTML(s.card.description)}</div>` : ''}
          ${(() => {
        const providerName = s.card.provider_name || '';
        let faviconHTML = '';
        let domain = '';
        try {
          domain = new URL(s.card.url).hostname;
          faviconHTML = `<img class="post-card-favicon" src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" alt="" loading="lazy" onerror="this.style.display='none'">`;
        } catch (e) { }
        const domainHTML = domain ? `<span class="post-card-provider-domain"> — ${escapeHTML(domain)}</span>` : '';
        return providerName
          ? `<div class="post-card-provider">${faviconHTML}<span class="post-card-provider-name">${escapeHTML(providerName)}</span>${domainHTML}</div>`
          : '';
      })()}
        </div>
      </${tag}>`;
  }

  /* ── Content warning wrapper ── */
  let autoOpenSensitive = false;
  try { autoOpenSensitive = localStorage.getItem('pref_auto_open_sensitive') === 'true'; } catch { }
  
  const hasSpoiler = s.spoiler_text && s.spoiler_text.length > 0;
  const cwText = hasSpoiler ? renderCustomEmojis(s.spoiler_text, s.emojis) : 'Sensitive content';
  const cwId = `cw-${idPrefix}${status.id}`;
  const isExpanded = autoOpenSensitive;
  const { content: rawContent, tags: postTags } = extractTrailingHashtags(
    sanitizeHTML(s.content, { mentions: s.mentions, emojis: s.emojis, server: state.server })
  );
  const postBody = processContent(rawContent);

  let tagLineHTML = '';
  if (postTags && postTags.length > 0) {
    if (postTags.length > 4) {
      const visible = postTags.slice(0, 4).join(' ');
      const extra = postTags.slice(4).join(' ');

      // Extract plantext for the tooltip
      const extraText = postTags.slice(4).map(tagHTML => {
        const tmp = document.createElement('div');
        tmp.innerHTML = tagHTML;
        return tmp.textContent.trim();
      }).join(' ');

      tagLineHTML = `
        <div class="post-tags">
          ${visible}
          <span class="post-tags-extra">${extra}</span>
          <button class="post-tags-toggle" 
                  title="${extraText.replace(/"/g, '&quot;')}"
                  onclick="window.toggleShowMoreTags(event, this)">+${postTags.length - 4} more</button>
          <button class="post-tags-less-toggle" onclick="window.toggleShowLessTags(event, this)">show less</button>
        </div>`;
    } else {
      tagLineHTML = `<div class="post-tags">${postTags.join(' ')}</div>`;
    }
  }
  const plainText = (s.content || '').replace(/<[^>]+>/g, '');
  const isLong = plainText.length > 800 || (s.content || '').split(/<p|<br/i).length > 16;
  const wrapPostContent = (html) => {
    if (!isLong) return `<div class="post-content">${html}</div>`;
    return `
      <div class="post-content-wrap collapsed-active">
        <div class="post-content post-content--collapsed">${html}</div>
        <button class="show-more-btn" onclick="event.stopPropagation(); window.toggleShowMore(this)">Show more</button>
      </div>`;
  };

  let contentHTML = '';
  if (hasSpoiler) {
    contentHTML = `
      <div class="cw-wrapper">
        <div class="cw-summary" style="cursor:pointer;" onclick="event.stopPropagation(); window.toggleCW('${cwId}', this.querySelector('.cw-toggle'))">
          <span>CW: ${cwText}</span>
          <button class="cw-toggle" onclick="event.stopPropagation(); window.toggleCW('${cwId}', this)">${isExpanded ? 'hide' : 'show'}</button>
        </div>
        <div class="cw-body${isExpanded ? ' expanded' : ''}" id="${cwId}">
          ${wrapPostContent(postBody)}
          ${mediaHTML}${cardHTML}${pollHTML}${quoteHTML}${tagLineHTML}
        </div>
      </div>`;
  } else {
    contentHTML = `
      ${wrapPostContent(postBody)}
      ${mediaHTML}${cardHTML}${pollHTML}${quoteHTML}${tagLineHTML}`;
  }

  let targetLang = 'browser';
  try { targetLang = localStorage.getItem('pref_translate_lang') || 'browser'; } catch { }
  if (targetLang === 'browser') targetLang = (navigator.language || 'en').split('-')[0];

  const postLang = s.language && s.language !== 'und' ? s.language : null;
  const showTranslate = postLang && postLang !== targetLang;

  let postLangName = postLang;
  if (postLang) {
    try {
      postLangName = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(postLang);
    } catch (err) { }
  }

  /* ── Footer: reply, boost, favourite, bookmark, translate, external ── */
  const footerHTML = `
    <div class="post-footer">
      <button class="post-stat post-reply-btn" data-post-id="${s.id}" data-account-acct="${s.account.acct}" title="Reply">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
        <span class="post-reply-count">${s.replies_count || 0}</span>
      </button>
      <span style="position:relative;display:inline-flex;">
        ${store.get('pref_separate_boost_quote') === 'true' ? `
        ${(!s.quote_approval || s.quote_approval.current_user !== 'denied') && s.visibility !== 'private' && s.visibility !== 'direct' ? `
        <button class="post-stat post-quote-btn" data-post-id="${s.id}" data-acct="${escapeHTML(s.account.acct)}" title="Quote">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 2.5-2 4.5l-.5.5z"/><path d="M17 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 2.5-2 4.5l-.5.5z"/></svg>
          <span class="quote-count">${s.quotes_count || s.quote_count || 0}</span>
        </button>` : ''}
        <button class="post-stat post-boost-btn ${s.reblogged ? 'boosted' : ''}" data-post-id="${s.id}" title="${s.reblogged ? 'Undo Boost' : 'Boost'}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--boost)"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
          <span class="boost-count">${s.reblogs_count || 0}</span>
        </button>
        ` : `
        <button class="post-stat post-boost-btn ${s.reblogged ? 'boosted' : ''}" data-post-id="${s.id}" title="Boost or Quote">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--boost)"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
          <span class="boost-count">${(s.reblogs_count || 0) + (s.quotes_count || s.quote_count || 0)}</span>
        </button>
        <div class="boost-dropdown" id="boost-menu-${s.id}">
          ${(!s.quote_approval || s.quote_approval.current_user !== 'denied') && s.visibility !== 'private' && s.visibility !== 'direct' ? `
          <button class="boost-dropdown-item" data-action="quote" data-post-id="${s.id}" data-acct="${escapeHTML(s.account.acct)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 2.5-2 4.5l-.5.5z"/><path d="M17 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 2.5-2 4.5l-.5.5z"/></svg>
            <span>Quote</span>
            <span class="dropdown-stat-count" style="margin-left:auto;color:var(--text-muted);font-size:12.5px;font-family:var(--font-mono);">${s.quotes_count || s.quote_count || 0}</span>
          </button>` : ''}
          <button class="boost-dropdown-item" data-action="boost" data-post-id="${s.id}" data-is-boosted="${s.reblogged ? 'true' : 'false'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
            <span>${s.reblogged ? 'Undo Boost' : 'Boost'}</span>
            <span class="dropdown-stat-count" style="margin-left:auto;color:var(--text-muted);font-size:12.5px;font-family:var(--font-mono);">${s.reblogs_count || 0}</span>
          </button>
        </div>
        `}
      </span>
      <button class="post-stat post-fav-btn ${s.favourited ? 'favourited' : ''}" data-post-id="${s.id}" data-favourited="${s.favourited ? 'true' : 'false'}" title="${s.favourited ? 'Unfavorite' : 'Favorite'}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${s.favourited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" style="color:var(--fav)"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        <span class="post-fav-count">${s.favourites_count || 0}</span>
      </button>
      <button class="post-stat post-bookmark-btn ${s.bookmarked ? 'bookmarked' : ''}" data-post-id="${s.id}" data-bookmarked="${s.bookmarked ? 'true' : 'false'}" title="${s.bookmarked ? 'Remove bookmark' : 'Bookmark'}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${s.bookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
      </button>

      <div style="margin-left:auto;display:flex;align-items:center;gap:2px;">
        ${analyticsHTML}

        <div style="position:relative;display:inline-flex;">
          <button class="post-stat post-more-btn" data-post-id="${s.id}" title="More options" onclick="event.stopPropagation(); window.toggleFooterMoreMenu('${s.id}', this)" aria-haspopup="true" style="position:relative; margin-right: -8px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
            ${showTranslate ? '<span class="translate-indicator"><span>T</span></span>' : ''}
          </button>
          <div class="boost-dropdown footer-more-dropdown" id="footer-more-menu-${s.id}" style="right:-2px; left:auto; top:auto; bottom:100%; margin-bottom:8px; min-width:210px; transform-origin: bottom right;">
            <div class="boost-dropdown-item visibility-item" style="cursor:default; opacity:0.7; pointer-events:none;">
               ${getVisibilityIcon(status.visibility, postLangName, true)}
            </div>

            <button class="boost-dropdown-item" onclick="event.stopPropagation(); window.open('${escapeHTML(s.url || '')}', '_blank', 'noopener'); document.querySelectorAll('.footer-more-dropdown').forEach(m => m.classList.remove('show'));">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
               <span>View Original Post</span>
            </button>

            ${showTranslate ? `
            <button class="boost-dropdown-item post-translate-btn" onclick="event.preventDefault(); event.stopPropagation(); window.translatePost(this, '${s.id}', '${escapeHTML(postLang || '')}', '${escapeHTML(s.url || '')}'); document.querySelectorAll('.footer-more-dropdown').forEach(m => m.classList.remove('show'));" data-original-label="Translate">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="m14 18h6"/></svg>
              <span class="post-translate-btn-text">Translate</span>
            </button>
            ` : ''}

            ${isOwnPost ? `
              <div class="boost-dropdown-separator"></div>
              <button class="boost-dropdown-item" data-action="edit" data-post-id="${s.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                <span>Edit Post</span>
              </button>
              <button class="boost-dropdown-item boost-dropdown-item--danger" data-action="delete" data-post-id="${s.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                <span>Delete Post</span>
              </button>
              <button class="boost-dropdown-item boost-dropdown-item--redraft" data-action="delete-redraft" data-post-id="${s.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Delete &amp; Redraft</span>
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    </div>`;

  return { contentHTML, footerHTML };
}

/* ══════════════════════════════════════════════════════════════════════
   FEED POST
   ══════════════════════════════════════════════════════════════════════ */

function getVisibilityIcon(visibility, langName, forMenu = false) {
  const wrap = (title, svg) => {
    const fullTitle = langName ? `${title} - ${langName}` : title;
    if (forMenu) {
      // Let the parent's flex/gap handle it
      return `
        ${svg.replace(/width="11"/g, 'width="14"').replace(/height="11"/g, 'height="14"').replace(/stroke-width="2.5"/g, 'stroke-width="2"').replace(/viewBox/g, 'style="opacity:0.6;" viewBox')}
        <span class="vis-label-text">${fullTitle}</span>`;
    }
    return `<span class="post-stat post-vis-btn" title="${fullTitle}" style="cursor:default;">${svg}</span>`;
  };
  switch (visibility) {
    case 'public':
      return wrap('Public', `<svg class="post-vis-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`);
    case 'unlisted':
      return wrap('Unlisted', `<svg class="post-vis-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/></svg>`);
    case 'private':
      return wrap('Followers only', `<svg class="post-vis-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`);
    case 'direct':
      return wrap('Direct', `<svg class="post-vis-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>`);
    default:
      return '';
  }
}


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

  const isOwnPost = !!(state.account && s.account.id === state.account.id);
  const { contentHTML, footerHTML } = _buildPostBody(status, s, '', '', isOwnPost);

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
  if (boostBy) {
    if (state.knownFollowing.has(boostBy.id)) contextClass = ' post--boost';
  } else if (state.knownFollowing.has(s.account.id)) contextClass = ' post--following';
  else if (isHashtagPost) contextClass = ' post--hashtag';
  else if (s.in_reply_to_id) contextClass = ' post--reply';

  return `
    <article class="post${contextClass}" data-id="${s.id}">
      ${boostLabelHTML}
      ${hashtagBanner}
      <div class="post-header post-header--with-server">
        <div class="post-avatar" data-profile-id="${s.account.id}" data-profile-server="${profileServer}" style="cursor:pointer; align-self:center;">
          <img src="${s.account.avatar_static || s.account.avatar}" alt="${escapeHTML(s.account.display_name || s.account.username)}" loading="lazy" onerror="this.onerror=null;this.src=window._AVATAR_PLACEHOLDER"/>
          ${renderFollowingBadge(s.account.id)}
        </div>
        <div class="post-meta post-meta--with-server">
          <div class="post-author post-author--with-server">
            <span class="post-display-name" data-profile-id="${s.account.id}" data-profile-server="${profileServer}">${renderCustomEmojis(s.account.display_name || s.account.username, s.account.emojis)}</span>
            <span class="post-acct">@${escapeHTML(s.account.acct)}</span>
            <span class="post-time">${relativeTime(s.created_at)}</span>
          </div>
          <div class="post-server-address">${escapeHTML((s.account.url || '').split('/')[2] || '')}</div>
        </div>
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

  /* ── Analytics button + dropdown (focal posts only) ── */
  const isFocal = variant === 'focal';
  const isOwnPost = !!(state.account && s.account.id === state.account.id);

  const analyticsMenuHTML = isFocal ? `
    <div style="position:relative;display:inline-flex;">
      <button class="icon-btn post-analytics-btn"
        data-post-id="${s.id}"
        data-replies="${s.replies_count || 0}"
        data-boosts="${s.reblogs_count || 0}"
        data-quotes="${s.quotes_count || s.quote_count || 0}"
        data-favs="${s.favourites_count || 0}"
        title="Post insights"
        style="color:var(--text-dim);">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="20" x2="18" y2="10"/>
          <line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
      </button>
      <div class="boost-dropdown post-analytics-menu" id="post-analytics-menu-${s.id}"
        style="right:0;left:auto;top:auto;bottom:100%;margin-bottom:8px;min-width:188px;transform-origin:bottom right;">
        <button class="boost-dropdown-item post-analytics-item" data-action="replies" data-post-id="${s.id}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          <span>Replies</span>
          <span class="dropdown-stat-count" style="margin-left:auto;color:var(--text-muted);font-size:12.5px;font-family:var(--font-mono);">${s.replies_count || 0}</span>
        </button>
        <button class="boost-dropdown-item post-analytics-item" data-action="quotes" data-post-id="${s.id}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 2.5-2 4.5l-.5.5z"/><path d="M17 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 2.5-2 4.5l-.5.5z"/></svg>
          <span>Quotes</span>
          <span class="dropdown-stat-count" style="margin-left:auto;color:var(--text-muted);font-size:12.5px;font-family:var(--font-mono);">${s.quotes_count || s.quote_count || 0}</span>
        </button>
        <button class="boost-dropdown-item post-analytics-item" data-action="boosts" data-post-id="${s.id}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
          <span>Boosts</span>
          <span class="dropdown-stat-count" style="margin-left:auto;color:var(--text-muted);font-size:12.5px;font-family:var(--font-mono);">${s.reblogs_count || 0}</span>
        </button>
        <button class="boost-dropdown-item post-analytics-item" data-action="favs" data-post-id="${s.id}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          <span>Favorites</span>
          <span class="dropdown-stat-count" style="margin-left:auto;color:var(--text-muted);font-size:12.5px;font-family:var(--font-mono);">${s.favourites_count || 0}</span>
        </button>
      </div>
    </div>` : '';

  const { contentHTML, footerHTML } = _buildPostBody(status, s, 'thread-', analyticsMenuHTML, isOwnPost);

  const boostLabelHTML = boostBy ? `
    <div class="boost-divider">
      <div class="boost-text">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
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
  if (boostBy) {
    if (state.knownFollowing.has(boostBy.id)) contextClass = ' post--boost';
  } else if (state.knownFollowing.has(s.account.id)) contextClass = ' post--following';
  else if (s.in_reply_to_id) contextClass = ' post--reply';

  return `
    <div class="${variantClass}" data-status-id="${s.id}">
      <article class="post${contextClass}" data-id="${s.id}">
        ${boostLabelHTML}
        <div class="post-header post-header--with-server">
          <div class="post-avatar" data-profile-id="${s.account.id}" data-profile-server="${profileServer}" style="cursor:pointer">
            <img src="${s.account.avatar_static || s.account.avatar}" alt="${escapeHTML(s.account.display_name || s.account.username)}" loading="lazy" onerror="this.onerror=null;this.src=window._AVATAR_PLACEHOLDER"/>
            ${renderFollowingBadge(s.account.id)}
          </div>
          <div class="post-meta post-meta--with-server">
            <div class="post-author post-author--with-server">
              <span class="post-display-name" data-profile-id="${s.account.id}" data-profile-server="${profileServer}">${renderCustomEmojis(s.account.display_name || s.account.username, s.account.emojis)}</span>
              <span class="post-acct">@${escapeHTML(s.account.acct)}</span>
              <span class="post-time">${relativeTime(s.created_at)}</span>
            </div>
            <div class="post-server-address">${escapeHTML((s.account.url || '').split('/')[2] || '')}</div>
          </div>
          ${analyticsMenuHTML}
        </div>
        ${contentHTML}
        ${footerHTML}
      </article>
    </div>`;
}

/**
 * Render the poll container (called by _buildPostBody and handlePollVote).
 * @param {object} poll  Mastodon poll object
 * @returns {string}
 */
export function renderPoll(poll) {
  if (!poll) return '';
  const isVoted = poll.voted;
  const isClosed = poll.expired;
  const canVote = !isVoted && !isClosed;
  const total = poll.votes_count || 0;
  const multiple = poll.multiple;

  const options = poll.options.map((opt, idx) => {
    if (canVote) {
      const inputType = multiple ? 'checkbox' : 'radio';
      const inputName = `poll-${poll.id}`;
      return `
        <label class="poll-option poll-option--voting" onclick="event.stopPropagation()">
          <input type="${inputType}" name="${inputName}" value="${idx}" class="poll-input">
          <span class="poll-option-text">${renderCustomEmojis(opt.title, poll.emojis)}</span>
        </label>`;
    } else {
      const pct = total > 0 ? Math.round((opt.votes_count / total) * 100) : 0;
      const isOwnVote = isVoted && poll.own_votes && poll.own_votes.includes(idx);
      return `
        <div class="poll-option">
          <div class="poll-bar" style="width:${pct}%"></div>
          <span class="poll-option-text">
            ${isOwnVote ? '<span class="poll-own-vote-icon" title="You voted for this">✓</span> ' : ''}
            ${renderCustomEmojis(opt.title, poll.emojis)}
          </span>
          <span class="poll-pct">${pct}%</span>
        </div>`;
    }
  }).join('');

  const voteBtn = canVote ? `<button class="poll-vote-btn" onclick="event.stopPropagation(); window.handlePollVote('${poll.id}', this.closest('.post-poll'))">Vote</button>` : '';
  const pollMeta = `<div class="poll-meta">${total} votes · ${isClosed ? 'closed' : 'open'}</div>`;
  return `<div class="post-poll" data-poll-id="${poll.id}">${options}${voteBtn}${pollMeta}</div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   WINDOW GLOBALS (required by inline onclick/onload in rendered HTML)
   ══════════════════════════════════════════════════════════════════════ */

/** Open lightbox overlay for a media item. */
window.expandMedia = function expandMedia(mediaItem) {
  const postMediaGrid = mediaItem.closest('.post-media-grid');
  let mediaItems = [];
  let currentIndex = 0;

  if (postMediaGrid) {
    mediaItems = Array.from(postMediaGrid.querySelectorAll('.media-item')).filter(el => el.dataset.fullUrl);
    currentIndex = mediaItems.indexOf(mediaItem);
  }
  if (currentIndex === -1 || mediaItems.length === 0) {
    mediaItems = [mediaItem];
    currentIndex = 0;
  }

  // Capture post context for the action bar
  const article = mediaItem.closest('[data-id]');
  const postId = article ? article.dataset.id : (mediaItem.dataset.postId || null);

  // Build a lightweight proxy object for the standalone (profile grid) case
  // so the action-bar code below can read state from one consistent source.
  const _standalone = !article && postId ? mediaItem : null;

  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';

  // lbAltBtn / lbAltPanel are set by the action-bar block below.
  // When the action bar exists they handle ALT; otherwise updateSlideState
  // creates a standalone badge for the current slide.
  let lbAltBtn = null;
  let lbAltPanel = null;

  // ── Carousel: build a horizontal scroll track with one slide per media item ──
  const trackOuter = document.createElement('div');
  trackOuter.className = 'lb-track-outer';
  const track = document.createElement('div');
  track.className = 'lb-track';
  trackOuter.appendChild(track);

  const slideData = mediaItems.map((item, i) => {
    const slide = document.createElement('div');
    slide.className = 'lb-slide';

    const content = document.createElement('div');
    content.className = 'lightbox-content';

    const fullUrl = item.dataset.fullUrl;
    const type = item.dataset.type;
    let mediaEl;

    if (type === 'gifv') {
      mediaEl = document.createElement('video');
      mediaEl.src = fullUrl;
      mediaEl.autoplay = (i === currentIndex);
      mediaEl.loop = true;
      mediaEl.muted = true;
      mediaEl.playsInline = true;
      mediaEl.setAttribute('playsinline', '');
    } else if (type === 'image') {
      mediaEl = document.createElement('img');
      mediaEl.crossOrigin = 'anonymous';
      mediaEl.src = fullUrl;
    } else if (type === 'video') {
      // Custom minimal player in the lightbox
      const wrap = document.createElement('div');
      wrap.className = 'vid-lightbox-wrap video-player-wrap vp-muted';

      const vid = document.createElement('video');
      vid.src = fullUrl;
      vid.autoplay = (i === currentIndex);
      vid.muted = true;
      vid.playsInline = true;
      vid.setAttribute('playsinline', '');
      wrap.appendChild(vid);

      // Build controls via DOM to preserve vid's event listeners
      const overlayPlay = document.createElement('div');
      overlayPlay.className = 'vid-overlay-play';
      overlayPlay.innerHTML = '<div class="vid-overlay-btn"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg></div>';
      overlayPlay.onclick = (e) => { e.stopPropagation(); window.vpTogglePlay(wrap); };
      wrap.appendChild(overlayPlay);

      const controls = document.createElement('div');
      controls.className = 'vid-controls';
      controls.onclick = (e) => e.stopPropagation();
      controls.innerHTML = `
        <button class="vid-btn" onclick="vpTogglePlay(this.closest('.video-player-wrap'))">
          <svg class="vp-icon-play" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg>
          <svg class="vp-icon-pause" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
        </button>
        <div class="vid-progress" onclick="vpSeek(event,this.closest('.video-player-wrap'))"><div class="vid-progress-fill"></div></div>
        <span class="vid-time">0:00</span>
        <button class="vid-btn" onclick="vpToggleMute(this.closest('.video-player-wrap'))">
          <svg class="vp-icon-sound" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
          <svg class="vp-icon-mute" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>`;
      wrap.appendChild(controls);

      wrap.onclick = (e) => e.stopPropagation();
      mediaEl = wrap;
    } else {
      // fallback
      mediaEl = document.createElement('img');
      mediaEl.crossOrigin = 'anonymous';
      mediaEl.src = fullUrl;
    }

    content.appendChild(mediaEl);
    slide.appendChild(content);
    track.appendChild(slide);
    return { slide, content, mediaEl, item };
  });

  overlay.appendChild(trackOuter);

  // ── Dots ──
  const dotEls = [];
  if (mediaItems.length > 1) {
    const dotsEl = document.createElement('div');
    dotsEl.className = 'lightbox-dots';
    mediaItems.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'lightbox-dot' + (i === currentIndex ? ' active' : '');
      dotsEl.appendChild(dot);
      dotEls.push(dot);
    });
    overlay.appendChild(dotsEl);
  }

  // ── Slide state: sync dots, video play/pause, alt text, and tinted backdrop ──
  const updateSlideState = () => {
    dotEls.forEach((dot, i) => dot.classList.toggle('active', i === currentIndex));

    // Pause all videos; play only the active slide's video
    slideData.forEach(({ mediaEl }, i) => {
      const vid = (mediaEl instanceof HTMLVideoElement)
        ? mediaEl
        : mediaEl.querySelector?.('video');
      if (vid) {
        if (i === currentIndex) vid.play().catch(() => { });
        else vid.pause();
      }
    });

    // Alt text — integrated into action bar when available, standalone badge otherwise
    if (lbAltBtn && lbAltPanel) {
      const altText = (mediaItems[currentIndex].dataset.alt || '').trim();
      lbAltBtn.hidden = !altText;
      if (lbAltBtn._sep) lbAltBtn._sep.hidden = !altText;
      lbAltPanel.classList.remove('visible'); // collapse panel on slide change
    } else {
      // Remove any badge/panel left by a previous slide
      overlay.querySelectorAll('.lb-alt-standalone').forEach(el => el.remove());
      const altText = (mediaItems[currentIndex].dataset.alt || '').trim();
      if (altText) {
        const _panel = document.createElement('div');
        _panel.className = 'lightbox-alt-panel lb-alt-standalone';
        _panel.textContent = altText;
        _panel.onclick = (e) => e.stopPropagation();
        const _badge = document.createElement('button');
        _badge.className = 'lightbox-alt-badge lb-alt-standalone';
        _badge.textContent = 'ALT';
        _badge.onclick = (e) => { e.stopPropagation(); _panel.classList.toggle('visible'); };
        overlay.appendChild(_panel);
        overlay.appendChild(_badge);
      }
    }

    // Sample the dominant color from the active image's edge pixels and tint the backdrop.
    // Edges are used because that's where the image meets the overlay — matching those colours
    // makes the transition look seamless. Hue is resolved via a saturation-weighted circular
    // mean (HSL approach) so vivid edge tones win over neutral grey fringing.
    const { mediaEl } = slideData[currentIndex];
    const imgEl = (mediaEl instanceof HTMLImageElement) ? mediaEl : null;
    if (imgEl) {
      const doExtract = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const S = 64, BORDER = 10; // 64×64 canvas; sample outer 10 px strip
        canvas.width = S; canvas.height = S;
        try {
          ctx.drawImage(imgEl, 0, 0, S, S);
          const d = ctx.getImageData(0, 0, S, S).data;
          let sinSum = 0, cosSum = 0, satSum = 0, n = 0;
          for (let py = 0; py < S; py++) {
            for (let px = 0; px < S; px++) {
              // Only use the perimeter strip — these pixels sit at the image/backdrop boundary
              if (px >= BORDER && px < S - BORDER && py >= BORDER && py < S - BORDER) continue;
              const idx = (py * S + px) * 4;
              const r = d[idx] / 255, g = d[idx + 1] / 255, b = d[idx + 2] / 255;
              const max = Math.max(r, g, b), min = Math.min(r, g, b);
              const l = (max + min) / 2;
              if (l < 0.05 || l > 0.95) continue; // skip near-black / near-white
              const delta = max - min;
              if (delta < 0.05) continue; // skip near-grey
              const s = delta / (1 - Math.abs(2 * l - 1));
              let h = 0;
              if (max === r) h = 60 * (((g - b) / delta) % 6);
              else if (max === g) h = 60 * ((b - r) / delta + 2);
              else h = 60 * ((r - g) / delta + 4);
              if (h < 0) h += 360;
              const rad = h * Math.PI / 180;
              // Weight by saturation so the most vivid edge pixels steer the hue
              sinSum += Math.sin(rad) * s;
              cosSum += Math.cos(rad) * s;
              satSum += s;
              n++;
            }
          }
          if (n === 0 || satSum === 0) { overlay.style.backgroundColor = ''; return; }
          const avgHue = (Math.atan2(sinSum, cosSum) * 180 / Math.PI + 360) % 360;
          const avgSat = satSum / n; // 0–1
          // Power curve gives more presence at low saturations without washing out vivid images
          const bgSat = Math.round(Math.min(Math.pow(avgSat, 0.6) * 100, 80));
          overlay.style.backgroundColor = `hsl(${Math.round(avgHue)}, ${bgSat}%, 22%)`;
        } catch (_e) { /* cross-origin canvas taint — keep default dark background */ }
      };
      if (imgEl.complete && imgEl.naturalWidth > 0) doExtract();
      else imgEl.addEventListener('load', doExtract, { once: true });
    } else {
      overlay.style.backgroundColor = '';
    }
  };

  // Smooth-scroll the track to a target slide index
  const goTo = (index) => {
    currentIndex = index;
    trackOuter.scrollTo({ left: index * trackOuter.offsetWidth, behavior: 'smooth' });
    updateSlideState();
  };

  // Keep currentIndex in sync when the user swipes natively
  trackOuter.addEventListener('scroll', () => {
    if (!trackOuter.offsetWidth) return;
    const newIndex = Math.round(trackOuter.scrollLeft / trackOuter.offsetWidth);
    if (newIndex !== currentIndex) {
      currentIndex = newIndex;
      updateSlideState();
    }
  }, { passive: true });

  // ── Tap zones for prev/next (only when multiple slides) ──
  trackOuter.addEventListener('click', (e) => {
    if (e.target.closest('button, .vid-controls, .vid-overlay-play, .lightbox-alt-badge, .lightbox-action-bar')) {
      return;
    }

    let navigated = false;
    if (mediaItems.length > 1) {
      const rect = trackOuter.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < rect.width * 0.45 && currentIndex > 0) {
        goTo(currentIndex - 1);
        navigated = true;
      } else if (x > rect.width * 0.55 && currentIndex < mediaItems.length - 1) {
        goTo(currentIndex + 1);
        navigated = true;
      }
    }

    if (navigated || e.target.closest('.lightbox-content')) {
      e.stopPropagation();
    }
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'lightbox-close';
  closeBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  overlay.appendChild(closeBtn);

  // ── Lightbox action bar (reply / boost / fav / open post) ──
  if (postId) {
    // Article-backed context (feed / thread): read live state from DOM buttons.
    // Standalone context (profile media grid): read from data attributes on the media item.
    const postReplyBtn = article ? article.querySelector('.post-reply-btn') : null;
    const postQuoteBtn = article ? article.querySelector('.post-quote-btn') : null;
    const postBoostBtn = article ? article.querySelector('.post-boost-btn') : null;
    const postFavBtn = article ? article.querySelector('.post-fav-btn') : null;
    const canQuote = article
      ? (!!postQuoteBtn || !!article.querySelector('.boost-dropdown-item[data-action="quote"]'))
      : (_standalone && _standalone.dataset.canQuote === 'true');
    const acct = postReplyBtn
      ? postReplyBtn.dataset.accountAcct
      : (_standalone ? _standalone.dataset.accountAcct : '');

    let isBoosted = postBoostBtn
      ? postBoostBtn.classList.contains('boosted')
      : (_standalone ? _standalone.dataset.reblogged === 'true' : false);
    let isFavourited = postFavBtn
      ? postFavBtn.classList.contains('favourited')
      : (_standalone ? _standalone.dataset.favourited === 'true' : false);

    const getCount = (el, sel) => el ? (el.querySelector(sel)?.textContent || '0') : '0';
    const safeCount = (el, sel, fallback) => el ? getCount(el, sel) : String(fallback || 0);

    const separate = store.get('pref_separate_boost_quote') === 'true';

    const actionBar = document.createElement('article');
    actionBar.className = 'lightbox-action-bar';
    actionBar.dataset.id = postId;
    actionBar.onclick = (e) => e.stopPropagation();

    // ── Reply button ──
    const replyCount = safeCount(postReplyBtn, '.post-reply-count', _standalone ? _standalone.dataset.repliesCount : 0);
    const replyBtn = document.createElement('button');
    replyBtn.className = 'lightbox-action-btn lb-reply post-stat post-reply-btn';
    replyBtn.title = 'Reply';
    replyBtn.dataset.postId = postId;
    replyBtn.dataset.accountAcct = acct;
    replyBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg><span class="post-reply-count">${replyCount}</span>`;
    replyBtn.onclick = (e) => {
      e.stopPropagation();
      if (window.handleReply) window.handleReply(postId, acct);
      close();
    };
    actionBar.appendChild(replyBtn);

    // ── Boost / Quote actions ──
    if (separate) {
      if (canQuote) {
        const quoteCount = safeCount(postQuoteBtn, '.quote-count', _standalone ? _standalone.dataset.quotesCount : 0);
        const quoteBtn = document.createElement('button');
        quoteBtn.className = 'lightbox-action-btn lb-quote post-stat post-quote-btn';
        quoteBtn.title = 'Quote';
        quoteBtn.dataset.postId = postId;
        quoteBtn.dataset.acct = acct;
        quoteBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 2.5-2 4.5l-.5.5z"/><path d="M17 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 2.5-2 4.5l-.5.5z"/></svg><span class="quote-count">${quoteCount}</span>`;
        quoteBtn.onclick = (e) => {
          e.stopPropagation();
          if (window.handleQuoteInit) window.handleQuoteInit(postId, acct);
          close();
        };
        actionBar.appendChild(quoteBtn);
      }

      const boostCount = safeCount(postBoostBtn, '.boost-count', _standalone ? _standalone.dataset.reblogsCount : 0);
      const lbBoostBtn = document.createElement('button');
      lbBoostBtn.className = 'lightbox-action-btn lb-boost post-stat post-boost-btn' + (isBoosted ? ' boosted' : '');
      lbBoostBtn.title = isBoosted ? 'Undo Boost' : 'Boost';
      lbBoostBtn.dataset.postId = postId;
      lbBoostBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--boost)"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg><span class="boost-count">${boostCount}</span>`;
      lbBoostBtn.onclick = (e) => {
        e.stopPropagation();
        const currentIsBoosted = lbBoostBtn.classList.contains('boosted');
        window.handleBoostSubmit(postId, currentIsBoosted, lbBoostBtn);
      };
      actionBar.appendChild(lbBoostBtn);
    } else {
      const boostCount = safeCount(postBoostBtn, '.boost-count',
        _standalone ? (parseInt(_standalone.dataset.reblogsCount || 0) + parseInt(_standalone.dataset.quotesCount || 0)) : 0);
      const boostWrap = document.createElement('div');
      boostWrap.className = 'lightbox-action-boost-wrap post-stat-wrap';

      const boostBtn = document.createElement('button');
      boostBtn.className = 'lightbox-action-btn lb-boost post-stat post-boost-btn' + (isBoosted ? ' boosted' : '');
      boostBtn.title = 'Boost or Quote';
      boostBtn.dataset.postId = postId;
      boostBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--boost)"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg><span class="boost-count">${boostCount}</span>`;

      const boostDropdown = document.createElement('div');
      boostDropdown.className = 'lightbox-boost-dropdown boost-dropdown';

      const boostItem = document.createElement('button');
      boostItem.className = 'lightbox-boost-item boost-dropdown-item';
      boostItem.dataset.action = 'boost';
      boostItem.dataset.postId = postId;
      boostItem.dataset.isBoosted = isBoosted ? 'true' : 'false';
      boostItem.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg><span class="lb-boost-label">${isBoosted ? 'Undo Boost' : 'Boost'}</span><span class="dropdown-stat-count">${_standalone ? _standalone.dataset.reblogsCount : getCount(postBoostBtn, '.boost-count')}</span>`;
      boostItem.onclick = (e) => {
        e.stopPropagation();
        boostDropdown.classList.remove('show');
        const currentIsBoosted = boostBtn.classList.contains('boosted');
        window.handleBoostSubmit(postId, currentIsBoosted, boostBtn);
      };
      boostDropdown.appendChild(boostItem);

      if (canQuote) {
        const quoteItem = document.createElement('button');
        quoteItem.className = 'lightbox-boost-item boost-dropdown-item';
        quoteItem.dataset.action = 'quote';
        quoteItem.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 2.5-2 4.5l-.5.5z"/><path d="M17 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1 0 2.5 0 2.5-2 4.5l-.5.5z"/></svg><span>Quote</span><span class="dropdown-stat-count">${_standalone ? _standalone.dataset.quotesCount : getCount(postBoostBtn, '.quote-count')}</span>`;
        quoteItem.onclick = (e) => {
          e.stopPropagation();
          boostDropdown.classList.remove('show');
          window.handleQuoteInit(postId, acct);
          close();
        };
        boostDropdown.appendChild(quoteItem);
      }

      boostBtn.onclick = (e) => { e.stopPropagation(); boostDropdown.classList.toggle('show'); };
      boostWrap.appendChild(boostBtn);
      boostWrap.appendChild(boostDropdown);
      actionBar.appendChild(boostWrap);
      overlay.addEventListener('click', () => boostDropdown.classList.remove('show'));
    }

    // ── Favourite button ──
    const favCount = safeCount(postFavBtn, '.post-fav-count', _standalone ? _standalone.dataset.favouritesCount : 0);
    const lbFavBtn = document.createElement('button');
    lbFavBtn.className = 'lightbox-action-btn lb-fav post-stat post-fav-btn' + (isFavourited ? ' favourited' : '');
    lbFavBtn.title = isFavourited ? 'Unfavorite' : 'Favorite';
    lbFavBtn.dataset.postId = postId;
    lbFavBtn.dataset.favourited = isFavourited ? 'true' : 'false';
    lbFavBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="${isFavourited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" style="color:var(--fav)"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg><span class="post-fav-count">${favCount}</span>`;
    lbFavBtn.onclick = (e) => {
      e.stopPropagation();
      window.handleFavoriteToggle(lbFavBtn);
    };
    actionBar.appendChild(lbFavBtn);

    // ── Separator + Open post button ──
    if (postId) {
      const sep = document.createElement('div');
      sep.className = 'lightbox-action-sep';
      actionBar.appendChild(sep);

      const openBtn = document.createElement('button');
      openBtn.className = 'lightbox-action-btn lightbox-action-open';
      openBtn.title = 'Open post';
      openBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
      openBtn.onclick = (e) => { e.stopPropagation(); close(); if (window.openThreadDrawer) window.openThreadDrawer(postId); };
      actionBar.appendChild(openBtn);
    }

    // ── ALT text button (integrated into toolbar) ──
    lbAltPanel = document.createElement('div');
    lbAltPanel.className = 'lightbox-alt-panel';
    lbAltPanel.onclick = (e) => e.stopPropagation();
    overlay.appendChild(lbAltPanel);

    const altSep = document.createElement('div');
    altSep.className = 'lightbox-action-sep';
    altSep.hidden = true;
    actionBar.appendChild(altSep);

    lbAltBtn = document.createElement('button');
    lbAltBtn.className = 'lightbox-action-btn lb-alt';
    lbAltBtn.title = 'Alt text';
    lbAltBtn.hidden = true;
    lbAltBtn.textContent = 'ALT';
    lbAltBtn._sep = altSep; 
    lbAltBtn.onclick = (e) => {
      e.stopPropagation();
      const currentAlt = (mediaItems[currentIndex]?.dataset.alt || '').trim();
      lbAltPanel.textContent = currentAlt;
      lbAltPanel.classList.toggle('visible');
    };
    actionBar.appendChild(lbAltBtn);

    overlay.appendChild(actionBar);

  }

  document.body.appendChild(overlay);

  history.pushState({ mediaViewer: true }, '', '');

  // Jump to the starting slide instantly, then trigger the open animation.
  // Two rAFs ensure layout is calculated before scrollLeft is applied.
  requestAnimationFrame(() => {
    if (currentIndex > 0) {
      trackOuter.scrollLeft = currentIndex * trackOuter.offsetWidth;
    }
    updateSlideState();
    requestAnimationFrame(() => overlay.classList.add('open'));
  });

  // Signal to the global touchmove handler (iOS) and swap viewport meta (Android)
  // so pinch-to-zoom is allowed while the lightbox is open.
  window._lightboxOpen = true;
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) viewportMeta.content = 'width=device-width, initial-scale=1.0, user-scalable=yes, interactive-widget=resizes-visual';

  const close = () => {
    window._lightboxOpen = false;
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 250);
    document.removeEventListener('keydown', handleKeydown);
    if (viewportMeta) viewportMeta.content = 'width=device-width, initial-scale=1.0, user-scalable=no, interactive-widget=resizes-visual';
  };

  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation(); close();
    } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
      e.stopPropagation(); goTo(currentIndex - 1);
    } else if (e.key === 'ArrowRight' && currentIndex < mediaItems.length - 1) {
      e.stopPropagation(); goTo(currentIndex + 1);
    }
  };

  overlay.onclick = close;
  closeBtn.onclick = (e) => { e.stopPropagation(); close(); };
  document.addEventListener('keydown', handleKeydown);
};

// adjustImageAlignment removed — single-image containers now use CSS
// aspect-ratio set from attachment metadata at render time.

/* ── Custom Video Player helpers ───────────────────── */

function _vpFormatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

window.vpTogglePlay = function (wrap) {
  const vid = wrap && wrap.querySelector('video');
  if (!vid) return;
  vid.paused ? vid.play() : vid.pause();
};

window.vpToggleMute = function (wrap) {
  const vid = wrap && wrap.querySelector('video');
  if (!vid) return;
  vid.muted = !vid.muted;
  wrap.classList.toggle('vp-muted', vid.muted);
};

window.vpSeek = function (e, wrap) {
  const bar = wrap && wrap.querySelector('.vid-progress');
  const vid = wrap && wrap.querySelector('video');
  if (!bar || !vid || !vid.duration) return;
  const rect = bar.getBoundingClientRect();
  vid.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * vid.duration;
};

/** Wrapper click: if already playing — pause; if paused — open lightbox. */
window.vpWrapperClick = function (e, wrap) {
  const vid = wrap && wrap.querySelector('video');
  if (vid && !vid.paused) {
    vid.pause();
  } else {
    window.expandMedia(wrap);
  }
};

// Capture-phase listeners keep the progress bar & icons in sync
// across all players without requiring per-element setup.
document.addEventListener('timeupdate', (e) => {
  if (!(e.target instanceof HTMLVideoElement)) return;
  const wrap = e.target.closest('.video-player-wrap');
  if (!wrap) return;
  const fill = wrap.querySelector('.vid-progress-fill');
  const timeEl = wrap.querySelector('.vid-time');
  if (fill && e.target.duration) {
    fill.style.width = (e.target.currentTime / e.target.duration * 100) + '%';
  }
  if (timeEl) {
    timeEl.textContent = e.target.duration
      ? _vpFormatTime(e.target.currentTime) + ' / ' + _vpFormatTime(e.target.duration)
      : _vpFormatTime(e.target.currentTime);
  }
}, true);

document.addEventListener('play', (e) => {
  if (!(e.target instanceof HTMLVideoElement)) return;
  const wrap = e.target.closest('.video-player-wrap');
  if (wrap) wrap.classList.add('vp-playing');
}, true);

document.addEventListener('pause', (e) => {
  if (!(e.target instanceof HTMLVideoElement)) return;
  const wrap = e.target.closest('.video-player-wrap');
  if (wrap) wrap.classList.remove('vp-playing');
}, true);

/** Toggle blur on all sensitive media in the post on/off. */
window.toggleSensitiveMedia = function (btn) {
  const postMedia = btn.closest('.post-media, .post-card-img-wrap, .search-status-media');
  const allMedia = postMedia.querySelectorAll('img, video');
  const anyBlurred = [...allMedia].some(el => el.classList.contains('media-sensitive-blur'));
  allMedia.forEach(el => el.classList.toggle('media-sensitive-blur', !anyBlurred));
  btn.classList.toggle('sp-revealed', anyBlurred);
  // Play GIFVs when revealing, pause all videos when hiding
  postMedia.querySelectorAll('video').forEach(vid => {
    if (anyBlurred) {
      if (vid.closest('[data-type="gifv"]')) vid.play();
    } else {
      vid.pause();
    }
  });
};

/**
 * Click handler for sensitive link cards (rendered as <div data-card-url="...">).
 * The card is always a <div> while sensitive so the browser can never auto-navigate.
 * First click (while blurred): reveal the content. Subsequent clicks: open the URL.
 */
window.handleSensitiveCardClick = function (e, el) {
  e.stopPropagation();
  if (e.target.closest('.sensitive-pill')) return;
  const img = el.querySelector('img.post-card-image');
  if (img && img.classList.contains('media-sensitive-blur')) {
    const pill = el.querySelector('.sensitive-pill:not(.sp-revealed)');
    if (pill) toggleSensitiveMedia(pill);
  } else {
    const url = el.dataset.cardUrl;
    if (url) window.open(url, '_blank', 'noopener');
  }
};

/** Toggle a content-warning body open/closed. */
window.toggleCW = function toggleCW(id, btn) {
  const body = document.getElementById(id);
  const expanded = body.classList.toggle('expanded');
  btn.textContent = expanded ? 'hide' : 'show';
};

/** Toggle between summary and full text for long posts. */
window.toggleShowMore = function toggleShowMore(btn) {
  const wrap = btn.closest('.post-content-wrap');
  const content = wrap ? wrap.querySelector('.post-content') : null;
  if (!wrap || !content) return;

  const isCollapsed = wrap.classList.toggle('collapsed-active');
  content.classList.toggle('post-content--collapsed', isCollapsed);
  btn.textContent = isCollapsed ? 'Show more' : 'Show less';
};

/** Load the video iframe within a card */
window.playCardVideo = function playCardVideo(el, encodedHtml, aspectRatio) {
  const decoded = decodeURIComponent(encodedHtml);

  // We wrap it in an aspect-ratio preserving container so the layout doesn't jump drastically.
  const iframeContainer = document.createElement('div');
  iframeContainer.className = 'post-card-iframe-container';
  if (aspectRatio) {
    iframeContainer.style.aspectRatio = aspectRatio;
  }
  iframeContainer.innerHTML = decoded;

  const iframe = iframeContainer.querySelector('iframe');
  if (iframe) {
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.position = 'absolute';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.border = 'none';

    // Add autoplay if possible to avoid second click
    let src = iframe.getAttribute('src');
    if (src) {
      if (src.includes('youtube.com') || src.includes('youtu.be')) {
        src += (src.includes('?') ? '&' : '?') + 'autoplay=1';
        iframe.setAttribute('src', src);
      }
    }
  }

  el.replaceWith(iframeContainer);
};

/**
 * Translate a post in-place using the Mastodon native /translate API.
 * Falls back to a Google Translate link.
 */
window.translatePost = async function translatePost(btn, statusId, postLang, postUrl) {
  const post = btn.closest('.post, .thread-post');
  const contentEl = post ? post.querySelector('.post-content') : null;
  const label = btn.querySelector('.post-translate-btn-text');
  if (!contentEl) {
    console.error('[Translate] Could not find post content container.');
    return;
  }

  const originalLabelText = btn.dataset.originalLabel || 'Translate';

  // Toggle behavior
  if (btn.dataset.translated === 'true') {
    contentEl.innerHTML = btn.dataset.originalContent;
    btn.dataset.translated = 'false';
    label.textContent = originalLabelText;
    btn.classList.remove('active');
    return;
  }

  // Loading state
  label.textContent = '...';
  btn.disabled = true;
  contentEl.classList.add('translating');

  let targetLang = 'browser';
  try { targetLang = localStorage.getItem('pref_translate_lang') || 'browser'; } catch { }
  if (targetLang === 'browser') targetLang = (navigator.language || 'en').split('-')[0];

  try {
    const body = new URLSearchParams();
    body.append('lang', targetLang);

    const res = await fetch(
      `https://${state.server}/api/v1/statuses/${encodeURIComponent(statusId)}/translate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.token}`,
        },
        body: body,
        cache: 'no-store',
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const translated = data.content;
    if (!translated) throw new Error('Empty translation');

    // Store original and swap
    btn.dataset.originalContent = contentEl.innerHTML;
    btn.dataset.translated = 'true';

    contentEl.innerHTML = translated;

    label.textContent = 'Original';
    btn.disabled = false;
    btn.classList.add('active');

  } catch (err) {
    console.error('Translation failed:', err);
    label.textContent = `${originalLabelText} (failed)`;
    btn.disabled = false;
    btn.classList.remove('active');

    // Reset to 'Translate' after a delay
    setTimeout(() => {
      if (label.textContent === `${originalLabelText} (failed)`) {
        label.textContent = originalLabelText;
      }
    }, 4000);
  } finally {
    contentEl.classList.remove('translating');
  }
};

/**
 * Toggle visibility of extra trailing hashtags.
 */
window.toggleShowMoreTags = function toggleShowMoreTags(event, btn) {
  event.stopPropagation();
  // Find the closest container by checking for specific classes OR just the parent p/div
  // but we prefer specifically marked ones to be precise.
  const container = btn.parentElement;
  if (container) {
    container.classList.add('post-tags--expanded');
  }
};

window.toggleShowLessTags = function toggleShowLessTags(event, btn) {
  event.stopPropagation();
  const container = btn.closest('.post-tags--expanded');
  if (container) {
    container.classList.remove('post-tags--expanded');
  }
};

window.toggleFooterMoreMenu = function (postId, triggerBtn) {
  document.querySelectorAll('.footer-more-dropdown').forEach(m => {
    if (m.id !== `footer-more-menu-${postId}`) m.classList.remove('show');
  });
  const menu = triggerBtn.nextElementSibling;
  if (menu) menu.classList.toggle('show');
};

/** Handle voting in a poll. */
window.handlePollVote = async function (pollId, pollEl) {
  if (!state.token) {
    import('./ui.js').then(m => m.showToast('Please sign in to vote in polls.'));
    return;
  }

  const inputs = pollEl.querySelectorAll('input:checked');
  if (inputs.length === 0) {
    import('./ui.js').then(m => m.showToast('Please select at least one option.'));
    return;
  }

  const choices = Array.from(inputs).map(i => parseInt(i.value, 10));
  const voteBtn = pollEl.querySelector('.poll-vote-btn');
  
  if (voteBtn) {
    voteBtn.disabled = true;
    voteBtn.textContent = 'Voting...';
  }

  try {
    const res = await fetch(`https://${state.server}/api/v1/polls/${pollId}/votes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ choices })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    const updatedPoll = await res.json();
    
    // Re-render the poll container in place
    pollEl.outerHTML = renderPoll(updatedPoll);
    
  } catch (err) {
    console.error('Poll vote failed:', err);
    import('./ui.js').then(m => m.showToast('Failed to vote: ' + err.message));
    if (voteBtn) {
      voteBtn.disabled = false;
      voteBtn.textContent = 'Vote';
    }
  }
};
