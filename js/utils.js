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
export function sanitizeHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('a').forEach(a => {
    const text = a.textContent;
    if (text.startsWith('#')) a.classList.add('hashtag');
    else if (text.startsWith('@')) a.classList.add('mention');
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  return div.innerHTML;
}

/** Inline YouTube embeds for YouTube links found in post content. */
export function processContent(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const m = href.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (m) {
      a.outerHTML = `
        <div class="youtube-embed" style="margin:10px 0;max-width:100%;position:relative;padding-bottom:56.25%;height:0;overflow:hidden;">
          <iframe src="https://www.youtube.com/embed/${m[1]}"
                  style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;"
                  allowfullscreen></iframe>
        </div>`;
    }
  });
  return div.innerHTML;
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

/** Human-friendly relative timestamp (e.g. "3m", "2h", "Jan 5"). */
export function relativeTime(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(dateStr).toLocaleDateString('en', { month: 'short', day: 'numeric' });
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
