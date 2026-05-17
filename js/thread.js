/**
 * @module thread
 * Thread drawer - loading, rendering, and reply-tree building.
 */

import { $, state } from './state.js';
import { apiGet } from './api.js';
import { renderThreadPost, getFilterInfo } from './render.js';
import { fetchRelationships } from './feed.js';
import { escapeHTML, updateURLParam } from './utils.js';

/* ── Open / close ──────────────────────────────────────────────────── */


export let currentThreadId = null;
let activeThreadData = null;


export function openThreadDrawer(statusId) {
  currentThreadId = statusId;
  const isDesktop = window.innerWidth > 900;

  if (isDesktop) {
    const inlinePanel = $('thread-inline-panel');
    if (inlinePanel) inlinePanel.scrollTop = 0;
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
  updateURLParam('thread', statusId, true);
}

export function closeThreadDrawer() {
  // Pause any playing videos inside the thread before closing/clearing
  const containers = [$('thread-inline-content'), $('thread-content')];
  containers.forEach(container => {
    if (container) {
      container.querySelectorAll('video').forEach(vid => {
        try {
          vid.pause();
        } catch (e) {
          console.error('[Thread] Failed to pause video on close:', e);
        }
      });
    }
  });

  currentThreadId = null;
  activeThreadData = null;
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


  // Reset scroll position in both containers
  const inlineContent = $('thread-inline-content');
  if (inlineContent) inlineContent.scrollTop = 0;
  const drawerContent = $('thread-content');
  if (drawerContent) drawerContent.scrollTop = 0;
}

export function updateCurrentThread(delay = 1000, scrollToId = null) {
  if (!currentThreadId) {
    console.log('[Thread] updateCurrentThread: No currentThreadId, skipping.');
    return;
  }
  console.log('[Thread] updateCurrentThread: scheduled refresh in', delay, 'ms for ID:', currentThreadId, scrollToId ? `(scroll to ${scrollToId})` : '');
  setTimeout(() => {
    const isDesktop = window.innerWidth > 900;
    const isInline = document.body.classList.contains('thread-inline-active');
    const isDrawerOpen = $('thread-drawer').classList.contains('open');

    console.log('[Thread] updateCurrentThread: executing refresh.', { isDesktop, isInline, isDrawerOpen });

    if (isDesktop && isInline) {
      loadThread(currentThreadId, $('thread-inline-content'), true, scrollToId);
    } else if (!isDesktop && isDrawerOpen) {
      loadThread(currentThreadId, $('thread-content'), true, scrollToId);
    } else {
      console.log('[Thread] updateCurrentThread: No active thread container found for refresh.');
    }
  }, delay);
}



/* ── Load thread data ──────────────────────────────────────────────── */

async function loadThread(statusId, container, preserveScroll = false, scrollToId = null) {
  const currentScroll = container.scrollTop;
  console.log('[Thread] loadThread starting for ID:', statusId, { preserveScroll, scrollToId });
  try {
    // Fetch focal status first to see if it's a reblog
    const focalStatus = await apiGet(`/api/v1/statuses/${statusId}`, state.token);

    // Use original post ID for context if it's a boost
    const actualId = focalStatus.reblog ? focalStatus.reblog.id : focalStatus.id;
    console.log('[Thread] loadThread: fetching context for actualId:', actualId);

    const context = await apiGet(`/api/v1/statuses/${actualId}/context`, state.token);
    const ancestors = context.ancestors || [];
    const descendants = context.descendants || [];
    console.log(`[Thread] loadThread: received context. ancestors=${ancestors.length}, descendants=${descendants.length}`);

    await fetchRelationships([focalStatus, ...ancestors, ...descendants]);

    // Apply visibility and filter rules
    const filteredAncestors = ancestors.filter(s => {
      const { isFiltered, filterAction } = getFilterInfo(s, 'thread');
      return !(isFiltered && filterAction === 'hide');
    });
    const filteredDescendants = descendants.filter(s => {
      const { isFiltered, filterAction } = getFilterInfo(s, 'thread');
      return !(isFiltered && filterAction === 'hide');
    });

    console.log('[Thread] loadThread: rendering thread...');
    renderThread(focalStatus, filteredAncestors, filteredDescendants, container, preserveScroll ? currentScroll : 0, scrollToId);

    activeThreadData = {
      focalStatus,
      ancestors: filteredAncestors,
      descendants: filteredDescendants,
      container
    };
  } catch (err) {
    console.error('[Thread] loadThread error:', err);
    container.innerHTML = `
      <div class="thread-status">
        <iconify-icon icon="ph:warning-circle-bold" style="font-size: 20px;"></iconify-icon>
        <span>Could not load thread: ${escapeHTML(err.message)}</span>
      </div>`;
  }
}



/* ── Tree building ─────────────────────────────────────────────────── */

export function buildFullTree(ancestors, focalStatus, descendants) {
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

    return `<div class="thread-node">${postHTML}${childrenHTML}</div>`;
  }).join('');
}

/* ── Full thread render ────────────────────────────────────────────── */

function renderThread(focalStatus, ancestors, descendants, container, prevScroll = 0, scrollToId = null) {
  const treeNodes = buildFullTree(ancestors, focalStatus, descendants);

  const parts = [];

  console.log('[Thread] Rendering:', { focalStatus, ancestorsCount: ancestors.length, in_reply_to_account_id: focalStatus.in_reply_to_account_id, scrollToId });
  if (ancestors.length > 0) {
    const topAncestorId = ancestors[0].reblog ? ancestors[0].reblog.id : ancestors[0].id;
    parts.push(`<div class="thread-section-label context-jump-btn" data-status-id="${topAncestorId}" title="View full context">
      <span>View full context </span>
      <iconify-icon icon="ph:arrow-up-bold" style="font-size: 14px;"></iconify-icon>
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
            <iconify-icon icon="ph:arrow-bend-up-left-bold" style="font-size: 14px; flex-shrink:0;"></iconify-icon>
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

  requestAnimationFrame(() => {
    // If we have a specific target post (e.g. just posted)
    if (scrollToId) {
      const targetPost = container.querySelector(`article.post[data-post-id="${scrollToId}"]`);
      if (targetPost) {
        console.log('[Thread] Scrolling to targetPost:', scrollToId);
        targetPost.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetPost.classList.add('flash-highlight');
        targetPost.classList.add('selected');
        setTimeout(() => targetPost.classList.remove('flash-highlight'), 2000);
        return;
      }

    }

    // Default scroll behavior (focal post or preserved scroll)
    if (prevScroll > 0) {
      container.scrollTop = prevScroll;
    } else {
      const focalPost = container.querySelector('.thread-post-focal');
      const isDesktop = window.innerWidth > 900;
      
      if (focalPost) {
        if (isDesktop) {
          const panel = $('thread-inline-panel');
          if (panel) {
            const focalRect = focalPost.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            panel.scrollTop += (focalRect.top - panelRect.top - 80);
          }
        } else {
          const containerRect = container.getBoundingClientRect();
          const focalRect = focalPost.getBoundingClientRect();
          container.scrollTop += (focalRect.top - containerRect.top - 16);
        }
      } else {
        if (isDesktop) {
          const panel = $('thread-inline-panel');
          if (panel) panel.scrollTop = 0;
        } else {
          container.scrollTop = 0;
        }
      }
    }
  });
}

export function insertPostIntoActiveThread(newStatus) {
  if (!activeThreadData) {
    console.log('[Thread] No active thread open for local insertion.');
    return false;
  }

  const focalId = activeThreadData.focalStatus.reblog ? activeThreadData.focalStatus.reblog.id : activeThreadData.focalStatus.id;
  const isReplyToFocal = newStatus.in_reply_to_id === focalId;
  const isReplyToDescendant = activeThreadData.descendants.some(d => {
    const id = d.reblog ? d.reblog.id : d.id;
    return newStatus.in_reply_to_id === id;
  });

  if (isReplyToFocal || isReplyToDescendant) {
    console.log('[Thread] Instantly inserting new status into active thread:', newStatus.id);
    activeThreadData.descendants.push(newStatus);
    
    renderThread(
      activeThreadData.focalStatus,
      activeThreadData.ancestors,
      activeThreadData.descendants,
      activeThreadData.container,
      0,
      newStatus.id
    );
    return true;
  }
  
  return false;
}

window.insertPostIntoActiveThread = insertPostIntoActiveThread;


