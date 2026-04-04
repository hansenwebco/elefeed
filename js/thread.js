/**
 * @module thread
 * Thread drawer — loading, rendering, and reply-tree building.
 */

import { $, state } from './state.js';
import { apiGet } from './api.js';
import { renderThreadPost } from './render.js';
import { fetchRelationships } from './feed.js';
import { escapeHTML, updateURLParam } from './utils.js';

/* ── Open / close ──────────────────────────────────────────────────── */

let _savedScrollY = 0;
export let currentThreadId = null;

export function openThreadDrawer(statusId) {
  currentThreadId = statusId;
  const isDesktop = window.innerWidth > 900;

  if (isDesktop) {
    _savedScrollY = window.scrollY;
    const inlineContent = $('thread-inline-content');
    inlineContent.innerHTML = '<div class="thread-status"><div class="spinner"></div></div>';
    document.body.classList.add('thread-inline-active');
    window.scrollTo({ top: 0, behavior: 'instant' });
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
  updateURLParam('thread', statusId, true);
}

export function closeThreadDrawer() {
  currentThreadId = null;
  updateURLParam('thread', null);
  const wasInline = document.body.classList.contains('thread-inline-active');
  document.body.classList.remove('thread-inline-active');
  const drawer = $('thread-drawer');
  const backdrop = $('thread-backdrop');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('open');

  if (!wasInline) {
    document.body.style.overflow = '';
  }

  if (wasInline) {
    requestAnimationFrame(() => window.scrollTo(0, _savedScrollY));
  }
  // Reset scroll position in both containers
  const inlineContent = $('thread-inline-content');
  if (inlineContent) inlineContent.scrollTop = 0;
  const drawerContent = $('thread-content');
  if (drawerContent) drawerContent.scrollTop = 0;
}

export function updateCurrentThread(delay = 1000) {
  if (!currentThreadId) return;
  setTimeout(() => {
    const isDesktop = window.innerWidth > 900;
    if (isDesktop && document.body.classList.contains('thread-inline-active')) {
      loadThread(currentThreadId, $('thread-inline-content'), true);
    } else if (!isDesktop && $('thread-drawer').classList.contains('open')) {
      loadThread(currentThreadId, $('thread-content'), true);
    }
  }, delay);
}

/* ── Load thread data ──────────────────────────────────────────────── */

async function loadThread(statusId, container, preserveScroll = false) {
  const currentScroll = container.scrollTop;
  try {
    const [focalStatus, context] = await Promise.all([
      apiGet(`/api/v1/statuses/${statusId}`, state.token),
      apiGet(`/api/v1/statuses/${statusId}/context`, state.token),
    ]);
    const ancestors = context.ancestors || [];
    const descendants = context.descendants || [];
    await fetchRelationships([focalStatus, ...ancestors, ...descendants]);
    renderThread(focalStatus, ancestors, descendants, container, preserveScroll ? currentScroll : 0);
  } catch (err) {
    container.innerHTML = `
      <div class="thread-status">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>Could not load thread: ${escapeHTML(err.message)}</span>
      </div>`;
  }
}

/* ── Tree building ─────────────────────────────────────────────────── */

function buildFullTree(ancestors, focalStatus, descendants) {
  const allPosts = [...ancestors, focalStatus, ...descendants];
  const map = {};
  const roots = [];

  const focalId = focalStatus.reblog ? focalStatus.reblog.id : focalStatus.id;
  const ancestorIds = new Set(ancestors.map(a => a.reblog ? a.reblog.id : a.id));

  allPosts.forEach(s => {
    const id = s.reblog ? s.reblog.id : s.id;
    let variant = 'reply';
    if (id === focalId) variant = 'focal';
    else if (ancestorIds.has(id)) variant = 'ancestor';

    map[id] = { status: s, variant, children: [] };
  });

  allPosts.forEach(s => {
    const id = s.reblog ? s.reblog.id : s.id;
    const parentId = s.reblog ? s.reblog.in_reply_to_id : s.in_reply_to_id;

    if (parentId && map[parentId]) {
      map[parentId].children.push(map[id]);
    } else {
      roots.push(map[id]);
    }
  });

  return roots;
}

function renderTree(nodes, depth) {
  return nodes.map(node => {
    const s = node.status.reblog ? node.status.reblog : node.status;

    const postHTML = renderThreadPost(node.status, node.variant);
    const childrenHTML = node.children.length > 0
      ? `<div class="thread-reply-children">${renderTree(node.children, depth + 1)}</div>`
      : '';

    return postHTML + childrenHTML;
  }).join('');
}

/* ── Full thread render ────────────────────────────────────────────── */

function renderThread(focalStatus, ancestors, descendants, container, prevScroll = 0) {
  const treeNodes = buildFullTree(ancestors, focalStatus, descendants);

  const parts = [];

  console.log('[Thread] Rendering:', { focalStatus, ancestorsCount: ancestors.length, in_reply_to_account_id: focalStatus.in_reply_to_account_id });
  if (ancestors.length > 0) {
    const topAncestorId = ancestors[0].reblog ? ancestors[0].reblog.id : ancestors[0].id;
    parts.push(`<div class="thread-section-label context-jump-btn" data-status-id="${topAncestorId}" title="View full context">
      <span>View full context </span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    </div>`);
  } else {
    // If no ancestors were returned, but the post is a reply (technically or in spirit),
    // show a help banner so the user knows why it looks like an orphan.
    const s = focalStatus.reblog ? focalStatus.reblog : focalStatus;
    if (s.in_reply_to_id || s.in_reply_to_account_id) {
      console.log('[Thread] Missing parent detected for reply:', { in_reply_to_id: s.in_reply_to_id, in_reply_to_account_id: s.in_reply_to_account_id });
      const mentions = s.mentions || [];
      const recipient = mentions.find(m => m.id === s.in_reply_to_account_id) || mentions[0];
      const nameText = recipient ? `<strong style="color:var(--text); font-weight:600;">@${escapeHTML(recipient.acct)}</strong>` : 'another user';
      
      parts.push(`
        <div class="thread-status" style="border-bottom:1px solid var(--border); padding:16px 20px; background:var(--surface2); margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:10px; color:var(--text-muted); font-size:13px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            <span style="line-height: 1.4;">This post is a reply to ${nameText}, but the parent post was not found on this server.</span>
          </div>
        </div>
      `);
    }
  }

  parts.push(renderTree(treeNodes, 1));

  if (descendants.length === 0) {
    parts.push('<div class="thread-status" style="padding:24px;"><span style="font-size:12px;font-family:var(--font-mono);opacity:0.6;">No replies yet</span></div>');
  }

  container.innerHTML = parts.join('');
  if (prevScroll > 0) {
    container.scrollTop = prevScroll;
  } else {
    requestAnimationFrame(() => {
      const focalPost = container.querySelector('.thread-post-focal');
      if (focalPost) {
        if (window.innerWidth > 900) {
          const y = focalPost.getBoundingClientRect().top + window.scrollY - 120;
          window.scrollTo({ top: y, behavior: 'auto' });
        } else {
          const containerRect = container.getBoundingClientRect();
          const focalRect = focalPost.getBoundingClientRect();
          container.scrollTop += (focalRect.top - containerRect.top - 16);
        }
      } else {
        if (window.innerWidth > 900) window.scrollTo(0, 0);
        else container.scrollTop = 0;
      }
    });
  }
}
