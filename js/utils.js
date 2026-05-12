/**
 * @module utils
 * Pure utility functions - no DOM mutations, no state dependencies.
 */

import { store } from './state.js';

/** HTML-escape a string for safe insertion into markup. */
export function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape a string for use in a regular expression. */
export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize user-generated HTML: mark hashtag/mention links,
 * force links to open in a new tab, and render custom emojis.
 */
export function sanitizeHTML(html, context = null) {
  const div = document.createElement('div');
  div.innerHTML = html;

  const clearUrls = store.get('pref_clear_urls') === 'true';

  // 1. Process links (mentions, hashtags, external)
  div.querySelectorAll('a').forEach(a => {
    const text = a.textContent.trim();
    let isMention = false;
    if (text.startsWith('#')) a.classList.add('hashtag');
    else if (text.startsWith('@')) {
      a.classList.add('mention');
      isMention = true;
    } else {
      a.classList.add('ext-link');

      if (clearUrls && text.includes('?')) {
        // Remove query parameters from the display text
        a.textContent = text.split('?')[0];
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

  // 2. Process custom emojis in text nodes
  if (context && context.emojis && context.emojis.length > 0) {
    const emojis = context.emojis;
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, null, false);
    const nodesToReplace = [];
    let node;
    while (node = walker.nextNode()) {
      if (node.parentElement.tagName === 'A' || node.parentElement.tagName === 'CODE') continue;
      // Check if text matches any emoji shortcode
      const text = node.textContent;
      if (text.includes(':')) {
        nodesToReplace.push(node);
      }
    }

    nodesToReplace.forEach(textNode => {
      let content = textNode.textContent;
      let hasEmoji = false;
      const fragment = document.createDocumentFragment();
      
      // Basic approach: regex replace shortcodes with placeholders, then split and build fragment
      // More robust: sort emojis by length descending to avoid partial matches if that's a thing
      let currentText = content;
      
      // Construct a single regex for all emojis
      const pattern = emojis.map(e => escapeRegExp(`:${e.shortcode}:`)).join('|');
      const regex = new RegExp(`(${pattern})`, 'g');
      const parts = currentText.split(regex);
      
      parts.forEach(part => {
        if (!part) return;
        const matchingEmoji = emojis.find(e => `:${e.shortcode}:` === part);
        if (matchingEmoji) {
          const img = document.createElement('img');
          const prefersStatic = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          img.src = (prefersStatic && matchingEmoji.static_url) ? matchingEmoji.static_url : matchingEmoji.url;
          img.alt = part;
          img.title = part;
          img.className = 'custom-emoji';
          img.loading = 'lazy';
          fragment.appendChild(img);
          hasEmoji = true;
        } else {
          fragment.appendChild(document.createTextNode(part));
        }
      });
      
      if (hasEmoji) {
        textNode.parentNode.replaceChild(fragment, textNode);
      }
    });
  }

  return div.innerHTML;
}

/** Process post content HTML before rendering. */
export function processContent(html) {
  return foldHashtagsInHTML(html);
}

/**
 * Detect lists of hashtags (> 4) within any element and fold them.
 */
export function foldHashtagsInHTML(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  
  const allTags = Array.from(div.querySelectorAll('.hashtag'));
  if (allTags.length === 0) return html;

  // Group tags by their direct parent element to ensure we only fold siblings
  const parentMap = new Map();
  allTags.forEach(tag => {
    const parent = tag.parentElement;
    if (!parentMap.has(parent)) parentMap.set(parent, []);
    parentMap.get(parent).push(tag);
  });

  for (const [container, tags] of parentMap.entries()) {
    if (tags.length <= 4) continue;
    
    // Find the fifth tag in this specific container
    const fifthTag = tags[4];
    
    const extraWrapper = document.createElement('span');
    extraWrapper.className = 'post-tags-extra';
    
    // Capture nodes from the fifth tag until the LAST tag in this parent.
    // This ensures we keep subsequent content (like URLs or ending text) visible.
    const lastTag = tags[tags.length - 1];
    let current = fifthTag;
    const nodesToMove = [];
    while (current) {
      nodesToMove.push(current);
      if (current === lastTag) break;
      current = current.nextSibling;
    }
    
    const toggle = document.createElement('button');
    toggle.className = 'post-tags-toggle';
    toggle.textContent = `+${tags.length - 4} more`;
    toggle.setAttribute('onclick', 'window.toggleShowMoreTags(event, this)');
    
    const extraTags = tags.slice(4);
    toggle.setAttribute('title', extraTags.map(t => t.textContent.trim()).join(' '));
    
    // Insert toggle and wrapper
    container.insertBefore(toggle, fifthTag);
    container.insertBefore(extraWrapper, fifthTag);
    
    // Move nodes
    nodesToMove.forEach(node => extraWrapper.appendChild(node));
    
    // Add a space and the 'less' button inside the wrapper
    extraWrapper.appendChild(document.createTextNode(' '));
    const lessToggle = document.createElement('button');
    lessToggle.className = 'post-tags-less-toggle';
    lessToggle.textContent = 'show less';
    lessToggle.setAttribute('onclick', 'window.toggleShowLessTags(event, this)');
    extraWrapper.appendChild(lessToggle);
  }
  
  return div.innerHTML;
}

/**
 * Remove trailing paragraphs that contain only hashtag links (and whitespace)
 * from post HTML, returning an array of their HTML strings so they can be 
 * rendered after media / cards. Posts where hashtags appear mid-content are unaffected.
 * Returns { content: string, tags: string[] }.
 */
export function extractTrailingHashtags(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const paras = Array.from(div.querySelectorAll('p'));
  const trailingParas = [];
  
  for (let i = paras.length - 1; i >= 0; i--) {
    const p = paras[i];
    const onlyHashtags = Array.from(p.childNodes).every(n => {
      if (n.nodeType === 3 /* TEXT_NODE */) return n.textContent.trim() === '';
      if (n.nodeType === 1 /* ELEMENT_NODE */)
        return n.classList.contains('hashtag') || n.tagName === 'BR';
      return false;
    });
    if (!onlyHashtags || p.querySelectorAll('.hashtag').length === 0) break;
    trailingParas.unshift(p);
  }

  if (trailingParas.length === 0) return { content: html, tags: [] };
  
  const tags = [];
  trailingParas.forEach(p => {
    // Collect all hashtag elements from this paragraph
    p.querySelectorAll('.hashtag').forEach(a => tags.push(a.outerHTML));
    p.remove();
  });

  return {
    content: div.innerHTML,
    tags: tags,
  };
}

/**
 * Replace `:shortcode:` placeholders with `<img>` custom emoji tags.
 * Text is HTML-escaped first to prevent injection.
 */
export function renderCustomEmojis(text, emojis = []) {
  if (!text) return '';
  let escaped = escapeHTML(text);
  if (emojis && emojis.length > 0) {
    const prefersStatic = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    emojis.forEach(e => {
      const regex = new RegExp(escapeRegExp(`:${e.shortcode}:`), 'g');
      const emojiUrl = (prefersStatic && e.static_url) ? e.static_url : e.url;
      escaped = escaped.replace(
        regex,
        `<img src="${emojiUrl}" alt=":${e.shortcode}:" title=":${e.shortcode}:" class="custom-emoji" />`
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
 * Safely serialize contenteditable HTML to plain text, preserving 
 * emoji shortcodes from <img> alt attributes.
 */
export function getEditorText(el) {
  if (!el) return '';
  // Clone to avoid mutations
  const clone = el.cloneNode(true);
  
  // Replace custom emoji images with their alt text
  clone.querySelectorAll('.compose-custom-emoji').forEach(img => {
    img.parentNode.replaceChild(document.createTextNode(img.alt || ''), img);
  });
  
  // To get reliable newlines for block elements (div, p, etc.) in contenteditable,
  // innerText must be called on a node that is ATTACHED to the document's layout.
  // Otherwise, browsers often return a flattened string (similar to textContent).
  const temp = document.createElement('div');
  temp.style.cssText = 'position:fixed; pointer-events:none; opacity:0; left:-9999px; white-space:pre-wrap;';
  document.body.appendChild(temp);
  temp.appendChild(clone);
  const text = clone.innerText || clone.textContent || '';
  document.body.removeChild(temp);

  return text.trim();
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

  if (key === 'tab' || key === 'explore' || (key === 'feed' && value !== 'hashtags')) {
    url.searchParams.delete('thread');
    url.searchParams.delete('profile');
    url.searchParams.delete('bookmarks');
    url.searchParams.delete('notifications');
    url.searchParams.delete('tag');
  }

  if (window._isRouting) return; // Ignore push/replace if we are in the middle of a popstate navigation

  if (push) {
    window.history.pushState({}, '', url);
  } else {
    window.history.replaceState({}, '', url);
  }
}

/**
 * Checks if a post's language matches the preferred filter.
 * Strict: if a filter is set (not 'all'), the language MUST be present and match.
 * Flexible: matches 'en' to 'en-US', etc.
 */
export function matchesLanguage(postLang, filter) {
  if (!filter || filter === 'all') return true;
  
  // Normalize post language: treat undefined, null, or "und" as unknown
  const normalized = (typeof postLang === 'string') ? postLang.trim().toLowerCase() : null;
  if (!normalized || normalized === 'und') return false; 
  
  const f = filter.trim().toLowerCase();
  
  // Exact match (e.g., 'en' === 'en')
  if (normalized === f) return true;
  
  // Prefix match (e.g., 'en-US' matches 'en')
  if (normalized.startsWith(f + '-')) return true;
  
  // Reverse prefix match: if filter is 'en-US' and post is 'en', show it?
  // Usually better to be inclusive: if user wants 'en-US', they probably want general 'en' too.
  if (f.startsWith(normalized + '-')) return true;
  
  return false;
}

/**
 * Generates a localized language name for a given ISO code.
 * Replicates the "Common Name (Native Name)" pattern.
 * Example: "fr" -> "French (français)"
 */
export function getLanguageLabel(code) {
  if (!code || code === 'all' || code === 'browser') return code;
  try {
    const userLocale = navigator.language || 'en';
    const commonName = new Intl.DisplayNames([userLocale], { type: 'language' }).of(code);
    const nativeName = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    
    if (commonName.toLowerCase() === nativeName.toLowerCase()) return commonName;
    return `${commonName} (${nativeName})`;
  } catch (e) {
    return code.toUpperCase();
  }
}
