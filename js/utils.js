/**
 * @module utils
 * Pure utility functions — no DOM mutations, no state dependencies.
 */

/** HTML-escape a string for safe insertion into markup. */
export function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sanitize user-generated HTML: mark hashtag/mention links
 * and force all links to open in a new tab.
 */
export function sanitizeHTML(html, context = null) {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('a').forEach(a => {
    const text = a.textContent.trim();
    let isMention = false;
    if (text.startsWith('#')) a.classList.add('hashtag');
    else if (text.startsWith('@')) {
      a.classList.add('mention');
      isMention = true;
    } else {
      a.classList.add('ext-link');
      // Mark links that duplicate an attached link card so CSS can hide them
      if (context && context.cardUrl) {
        const href = a.getAttribute('href') || '';
        const norm = s => s.replace(/\/$/, '');
        if (href && norm(href) === norm(context.cardUrl)) {
          a.classList.add('card-url-link');
        }
      }
    }

    if (isMention && context && context.mentions) {
      const username = text.replace(/^@/, '');
      const found = context.mentions.find(m =>
        m.username === username ||
        m.acct === username ||
        m.acct.split('@')[0] === username
      );
      if (found) {
        a.setAttribute('data-profile-id', found.id);
        if (context.server) {
          a.setAttribute('data-profile-server', context.server);
        }
      }
    }

    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  return div.innerHTML;
}

/** Process post content HTML before rendering. */
export function processContent(html) {
  return html;
}

/**
 * Replace `:shortcode:` placeholders with `<img>` custom emoji tags.
 * Text is HTML-escaped first to prevent injection.
 */
export function renderCustomEmojis(text, emojis = []) {
  if (!text) return '';
  let escaped = escapeHTML(text);
  if (emojis && emojis.length > 0) {
    emojis.forEach(e => {
      const regex = new RegExp(`:${e.shortcode}:`, 'g');
      escaped = escaped.replace(
        regex,
        `<img src="${e.url}" alt=":${e.shortcode}:" title=":${e.shortcode}:" class="custom-emoji" />`
      );
    });
  }
  return escaped;
}

/** Human-friendly relative timestamp (e.g. "3m", "2h", "Jan 5", "Jan 5, 2023"). */
export function relativeTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;

  if (date.getFullYear() !== now.getFullYear()) {
    return date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

/** Format large numbers compactly (e.g. 1234 → "1.2K"). Hides trailing .0 */
export function formatNum(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

/** Format large numbers compactly (keeps trailing .0). */
export function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/** Promise-based delay. */
export function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Places the textual cursor at the very end of a contenteditable element */
export function placeCursorAtEnd(el) {
  if (!el) return;
  el.focus();
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { }
}

/** 
 * History API URL state manager.
 * Adds, updates, or removes a query parameter and pushes/replaces state.
 */
export function updateURLParam(key, value, push = false) {
  const url = new URL(window.location);
  if (value === null || value === undefined) {
    url.searchParams.delete(key);
  } else {
    url.searchParams.set(key, value);
  }

  if (key === 'tab' || key === 'feed' || key === 'explore') {
    url.searchParams.delete('thread');
    url.searchParams.delete('profile');
    url.searchParams.delete('bookmarks');
    url.searchParams.delete('notifications');
  }

  if (window._isRouting) return; // Ignore push/replace if we are in the middle of a popstate navigation

  if (push) {
    window.history.pushState({}, '', url);
  } else {
    window.history.replaceState({}, '', url);
  }
}
