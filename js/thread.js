/**
 * @module thread
 * Thread drawer — loading, rendering, and reply-tree building.
 */

import { $, state } from './state.js';
import { apiGet } from './api.js';
import { renderThreadPost } from './render.js';
import { escapeHTML } from './utils.js';

/* ── Open / close ──────────────────────────────────────────────────── */

export function openThreadDrawer(statusId) {
  const isDesktop = window.innerWidth > 900;

  if (isDesktop) {
    const inlineContent = $('thread-inline-content');
    inlineContent.innerHTML = '<div class="thread-status"><div class="spinner"></div></div>';
    document.body.classList.add('thread-inline-active');
    loadThread(statusId, inlineContent);
  } else {
    const drawer = $('thread-drawer');
    const backdrop = $('thread-backdrop');
    const content = $('thread-content');
    content.innerHTML = '<div class="thread-status"><div class="spinner"></div></div>';
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    loadThread(statusId, content);
  }
}

export function closeThreadDrawer() {
  document.body.classList.remove('thread-inline-active');
  const drawer = $('thread-drawer');
  const backdrop = $('thread-backdrop');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
}

/* ── Load thread data ──────────────────────────────────────────────── */

async function loadThread(statusId, container) {
  try {
    const [focalStatus, context] = await Promise.all([
      apiGet(`/api/v1/statuses/${statusId}`, state.token),
      apiGet(`/api/v1/statuses/${statusId}/context`, state.token),
    ]);
    renderThread(focalStatus, context.ancestors || [], context.descendants || [], container);
  } catch (err) {
    container.innerHTML = `
      <div class="thread-status">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>Could not load thread: ${escapeHTML(err.message)}</span>
      </div>`;
  }
}

/* ── Tree building ─────────────────────────────────────────────────── */

function buildReplyTree(descendants, rootId) {
  const map = {};
  const roots = [];
  descendants.forEach(s => { map[s.id] = { status: s, children: [] }; });
  descendants.forEach(s => {
    if (s.in_reply_to_id === rootId) roots.push(map[s.id]);
    else if (map[s.in_reply_to_id]) map[s.in_reply_to_id].children.push(map[s.id]);
    else roots.push(map[s.id]);
  });
  return roots;
}

function renderReplyTree(nodes, depth, parentAcct) {
  return nodes.map(node => {
    const s = node.status.reblog ? node.status.reblog : node.status;
    const replyToTag = (depth > 1 && parentAcct)
      ? `<div class="thread-reply-to">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 10l5-5v3c8 0 13 4 13 11-3-4-7-5-13-5v3l-5-5z"/></svg>
           Replying to <span class="thread-reply-to-acct">@${escapeHTML(parentAcct)}</span>
         </div>`
      : '';

    const postHTML = replyToTag + renderThreadPost(node.status, 'reply');
    const childrenHTML = node.children.length > 0
      ? `<div class="thread-reply-children">${renderReplyTree(node.children, depth + 1, s.account.acct)}</div>`
      : '';

    return postHTML + childrenHTML;
  }).join('');
}

/* ── Full thread render ────────────────────────────────────────────── */

function renderThread(focalStatus, ancestors, descendants, container) {
  const parts = [];

  if (ancestors.length > 0) {
    parts.push(`<div class="thread-section-label">Context (${ancestors.length})</div>`);
    ancestors.forEach(s => parts.push(renderThreadPost(s, 'ancestor')));
  }

  parts.push(renderThreadPost(focalStatus, 'focal'));

  if (descendants.length > 0) {
    parts.push(`<div class="thread-section-label">Replies (${descendants.length})</div>`);
    const focalId = focalStatus.reblog ? focalStatus.reblog.id : focalStatus.id;
    parts.push(renderReplyTree(buildReplyTree(descendants, focalId), 1, null));
  } else {
    parts.push('<div class="thread-status" style="padding:24px;"><span style="font-size:12px;font-family:var(--font-mono);opacity:0.6;">No replies yet</span></div>');
  }

  container.innerHTML = parts.join('');

  const focalEl = container.querySelector('.thread-post-focal');
  if (focalEl) {
    requestAnimationFrame(() => {
      focalEl.scrollIntoView({ block: 'start', behavior: 'instant' });
      container.scrollTop = Math.max(0, container.scrollTop - 60);
    });
  }
}
