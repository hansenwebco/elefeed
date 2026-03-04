/**
 * @module thread
 * Thread drawer — loading, rendering, and reply-tree building.
 */

import { $, state } from './state.js';
import { apiGet } from './api.js';
import { renderThreadPost } from './render.js';
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
    document.body.style.overflow = 'hidden';
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
  document.body.style.overflow = '';
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
    renderThread(focalStatus, context.ancestors || [], context.descendants || [], container, preserveScroll ? currentScroll : 0);
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

  if (ancestors.length > 0) {
    parts.push(`<div class="thread-section-label">Context (${ancestors.length})</div>`);
  }

  parts.push(renderTree(treeNodes, 1));

  if (descendants.length === 0) {
    parts.push('<div class="thread-status" style="padding:24px;"><span style="font-size:12px;font-family:var(--font-mono);opacity:0.6;">No replies yet</span></div>');
  }

  container.innerHTML = parts.join('');
  if (prevScroll > 0) {
    container.scrollTop = prevScroll;
  } else {
    container.scrollTop = 0;
  }
}
