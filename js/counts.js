/**
 * @module counts
 * Live post-count updates - replies, boosts (reblogs + quotes), and favourites.
 *
 * Strategy:
 *   1. A MutationObserver watches for new article[data-id] elements added
 *      anywhere in the DOM (feed, thread, profile, search, trending...).
 *      Each new article is immediately seeded with its rendered counts so
 *      subsequent polls can diff cleanly.
 *
 *   2. An IntersectionObserver tracks which articles are near the viewport.
 *      Only those IDs are polled.
 *
 *   3. Every POLL_INTERVAL ms the visible IDs are batched into efficient
 *      GET /api/v1/statuses?id[]=... requests (up to BATCH_SIZE per request).
 *
 *   4. When a count increases, the number is rewritten and a flash + spark
 *      animation fires so the eye is drawn to the change.
 */

import { state, store } from './state.js';
import { apiGet } from './api.js';
import { renderPoll } from './render.js';

/* -- Config ---------------------------------------------------------------- */

const POLL_INTERVAL = 5_000; // ms between polls
const BATCH_SIZE    = 20;     // statuses per API request
const LOG_PREFIX    = '[Counts]';

/** Only log when the developer debug panel is visible. */
function _log(...args) {
  if (document.getElementById('settings-debug-section')?.style.display !== 'none') {
    console.log(...args);
  }
}

/* -- State ----------------------------------------------------------------- */

/** id -> { replies, boosts, quotes, favs, name } */
const knownCounts = new Map();

let visibleIds       = new Set();
let intersectionObs  = null;
let mutationObs      = null;
let pollTimer        = null;
let pollCount        = 0;



/* -- Public API ------------------------------------------------------------ */

export function startCountPolling() {
  if (state.demoMode) { _log(LOG_PREFIX, 'demo mode - count polling disabled'); return; }
  if (store.get('pref_count_polling') === 'false') { _log(LOG_PREFIX, 'disabled by settings'); return; }
  _setupMutationObserver();
  _setupIntersectionObserver();
  // Seed any articles already in the DOM
  const existing = document.querySelectorAll('article[data-id]');
  existing.forEach(_registerArticle);
  _log(LOG_PREFIX, `started - seeded ${existing.length} existing articles`);

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(_poll, POLL_INTERVAL);

  // Fire an immediate first poll so we don't wait
  setTimeout(_poll, 3000);
}

export function stopCountPolling() {
  if (pollTimer)      { clearInterval(pollTimer); pollTimer = null; }
  if (intersectionObs) { intersectionObs.disconnect(); intersectionObs = null; }
  if (mutationObs)     { mutationObs.disconnect();     mutationObs     = null; }
  visibleIds.clear();
  _log(LOG_PREFIX, 'stopped');
}

/**
 * Called externally when we already have a fresh status object
 * (e.g. after a boost / fav action) so the counts update instantly.
 */
export function applyCountsFromStatus(status) {
  if (!status) return;
  _applyUpdate(status, /*fromUserAction=*/true);
  if (status.reblog) _applyUpdate(status.reblog, /*fromUserAction=*/true);
}

/**
 * Debug helpers - type in the browser console:
 *   debugCounts.status()  - print current tracking state
 *   debugCounts.poll()    - trigger an immediate poll
 *   debugCounts.dump()    - table of all known counts
 */
window.debugCounts = {
  status() {
    console.log(LOG_PREFIX, 'tracking', knownCounts.size, 'posts,',
      visibleIds.size, 'currently visible, poll #', pollCount);
    console.log(LOG_PREFIX, 'visible IDs:', [...visibleIds]);
  },
  poll() {
    console.log(LOG_PREFIX, 'manual poll triggered');
    return _poll();
  },
  dump() {
    console.table([...knownCounts.entries()].map(([id, c]) => ({ id, ...c })));
  },
};

/* -- Observer setup -------------------------------------------------------- */

function _setupMutationObserver() {
  if (mutationObs) mutationObs.disconnect();
  mutationObs = new MutationObserver(mutations => {
    let found = 0;
    mutations.forEach(mut => {
      mut.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches?.('article[data-id]')) {
          _registerArticle(node);
          found++;
        } else {
          const inner = node.querySelectorAll?.('article[data-id]');
          if (inner?.length) {
            inner.forEach(_registerArticle);
            found += inner.length;
          }
        }
      });
    });
    if (found > 0) _log(LOG_PREFIX, `registered ${found} new article(s) via MutationObserver`);
  });
  mutationObs.observe(document.body, { childList: true, subtree: true });
}

function _setupIntersectionObserver() {
  if (intersectionObs) intersectionObs.disconnect();
  visibleIds.clear();
  intersectionObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      const id = e.target.dataset.id;
      if (!id) return;
      if (e.isIntersecting) visibleIds.add(id);
      else visibleIds.delete(id);
    });
  }, { rootMargin: '300px' }); // poll posts slightly off-screen too
}

function _registerArticle(article) {
  const id = article.dataset.id;
  if (!id) return;
  // Seed from DOM so first poll diff is clean
  if (!knownCounts.has(id)) {
    const replyEl = article.querySelector('.post-reply-count');
    const boostEl = article.querySelector('.boost-count');
    const quoteEl = article.querySelector('.quote-count');
    const favEl   = article.querySelector('.post-fav-count');
    const nameEl  = article.querySelector('.post-display-name');
    const seed = {
      name:    nameEl  ? nameEl.textContent.trim() : id,
      replies: replyEl ? (parseInt(replyEl.textContent, 10) || 0) : 0,
      boosts:  boostEl ? (parseInt(boostEl.textContent, 10) || 0) : 0,
      quotes:  quoteEl ? (parseInt(quoteEl.textContent, 10) || 0) : 0,
      favs:    favEl   ? (parseInt(favEl.textContent,   10) || 0) : 0,
    };
    knownCounts.set(id, seed);
  }
  intersectionObs?.observe(article);
}

/* -- Polling --------------------------------------------------------------- */

async function _poll() {
  if (!state.token || state.demoMode) return;
  const ids = [...visibleIds];
  if (!ids.length) {
    _log(LOG_PREFIX, 'poll skipped - no visible posts tracked');
    return;
  }

  pollCount++;
  _log(LOG_PREFIX, `poll #${pollCount} - fetching counts for ${ids.length} visible post(s)`);

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    // Mastodon batch endpoint uses id[] (not ids[])
    const qs = chunk.map(id => `id[]=${encodeURIComponent(id)}`).join('&');
    try {
      const statuses = await apiGet(`/api/v1/statuses?${qs}`, state.token);
      if (!Array.isArray(statuses)) {
        console.warn(LOG_PREFIX, 'unexpected response from /api/v1/statuses:', statuses);
        continue;
      }
      _log(LOG_PREFIX, `poll #${pollCount} batch ${i / BATCH_SIZE + 1}: got ${statuses.length} status(es)`);
      statuses.forEach(s => _applyUpdate(s, false));
    } catch (err) {
      console.warn(LOG_PREFIX, 'poll failed:', err.message);
    }
  }
}

/* -- Diff + DOM update ----------------------------------------------------- */

function _applyUpdate(status, fromUserAction) {
  if (!status) return;

  // Use the reblog object for counts if it exists, as that's where the 
  // actual engagement statistics live in the Mastodon API.
  const source   = status.reblog || status;
  const id       = status.id;
  const prev     = knownCounts.get(id);

  const separate = store.get('pref_separate_boost_quote') === 'true';
  const next = {
    replies: source.replies_count    || 0,
    boosts:  separate ? (source.reblogs_count || 0) : ((source.reblogs_count || 0) + (source.quotes_count || source.quote_count || 0)),
    quotes:  source.quotes_count || source.quote_count || 0,
    favs:    source.favourites_count || 0,
  };

  // Carry the name forward; update it if the API response has a better one
  next.name = source.account?.display_name || source.account?.acct || prev?.name || id;
  knownCounts.set(id, next);
  const label = next.name || id;

  // Sync button highlighted states, SVG fills, and datasets ALWAYS
  // regardless of count change, to keep UI correct across different views.
  document.querySelectorAll(`article[data-id="${id}"]`).forEach(article => {
    const fb = article.querySelector('.post-fav-btn');
    if (fb) {
      fb.classList.toggle('favourited', !!source.favourited);
      fb.dataset.favourited = source.favourited ? 'true' : 'false';
      const svg = fb.querySelector('svg');
      if (svg) svg.setAttribute('fill', source.favourited ? 'currentColor' : 'none');
    }

    const bb = article.querySelector('.post-boost-btn');
    if (bb) {
      bb.classList.toggle('boosted', !!source.reblogged);
      bb.dataset.reblogged = source.reblogged ? 'true' : 'false';
      const isBoosted = !!source.reblogged;
      if (bb.title) {
        if (separate) bb.title = isBoosted ? 'Undo Boost' : 'Boost';
        else bb.title = isBoosted ? 'Undo Boost or Quote' : 'Boost or Quote';
      }
    }

    const bkb = article.querySelector('.post-bookmark-btn');
    if (bkb) {
      bkb.classList.toggle('bookmarked', !!source.bookmarked);
      bkb.dataset.bookmarked = source.bookmarked ? 'true' : 'false';
    }

    // Sync dropdown statistics and labels
    const dropdown = article.querySelector('.boost-dropdown');
    if (dropdown) {
      const bStat = dropdown.querySelector('[data-action="boost"] .dropdown-stat-count');
      if (bStat) bStat.textContent = source.reblogs_count || 0;
      const qStat = dropdown.querySelector('[data-action="quote"] .dropdown-stat-count');
      if (qStat) qStat.textContent = source.quotes_count || source.quote_count || 0;

      // Sync dropdown labels and datasets
      const boostItem = dropdown.querySelector('.boost-dropdown-item[data-action="boost"]');
      if (boostItem) {
        boostItem.dataset.isBoosted = source.reblogged ? 'true' : 'false';
        const labelSpan = boostItem.querySelector('span:not(.dropdown-stat-count)');
        if (labelSpan) labelSpan.textContent = source.reblogged ? 'Undo Boost' : 'Boost';
        // Also handle lb-boost-label in lightbox
        const lbLabelSpan = boostItem.querySelector('.lb-boost-label');
        if (lbLabelSpan) lbLabelSpan.textContent = source.reblogged ? 'Undo Boost' : 'Boost';
      }
    }

    // Sync poll if it exists
    if (source.poll) {
      const pollContainer = article.querySelector('.post-poll');
      if (pollContainer) {
        // Only update if the poll ID matches (sanity check)
        if (pollContainer.dataset.pollId === source.poll.id) {
          pollContainer.outerHTML = renderPoll(source.poll);
        }
      }
    }
  });

  // Recursively update the original status to keep all synchronized
  if (status.reblog) {
    _applyUpdate(status.reblog, fromUserAction);
  }

  if (!prev) return; // first time seeing this post - no animation

  const rd = next.replies - prev.replies;
  const bd = next.boosts  - prev.boosts;
  const qd = next.quotes  - prev.quotes;
  const fd = next.favs    - prev.favs;

  if (rd === 0 && bd === 0 && qd === 0 && fd === 0) return;

  _log(LOG_PREFIX, `count change on "${label}":`,  
    rd !== 0 ? `replies ${prev.replies}->${next.replies}` : '',
    bd !== 0 ? `boosts ${prev.boosts}->${next.boosts}`    : '',
    qd !== 0 ? `quotes ${prev.quotes}->${next.quotes}`    : '',
    fd !== 0 ? `favs ${prev.favs}->${next.favs}`          : '',
  );

  document.querySelectorAll(`article[data-id="${id}"]`).forEach(article => {
    if (rd !== 0) {
      const el = article.querySelector('.post-reply-count');
      if (el) _animateCount(el, next.replies, (!fromUserAction && rd > 0) ? 'reply' : null);
    }
    if (bd !== 0) {
      const el = article.querySelector('.boost-count');
      if (el) _animateCount(el, next.boosts, (!fromUserAction && bd > 0) ? 'boost' : null);
    }
    if (qd !== 0) {
      const el = article.querySelector('.quote-count');
      if (el) _animateCount(el, next.quotes, (!fromUserAction && qd > 0) ? 'quote' : null);
    }
    if (fd !== 0) {
      const el = article.querySelector('.post-fav-count');
      if (el) _animateCount(el, next.favs, (!fromUserAction && fd > 0) ? 'fav' : null);
    }
  });
}

/* -- Animation ------------------------------------------------------------- */

const TYPE_CLASS = {
  reply: 'count-pop-reply',
  boost: 'count-pop-boost',
  quote: 'count-pop-reply', // reuse reply animation for quote
  fav:   'count-pop-fav',
};

const SPARK_COLORS = {
  reply: ['#7b9cff', '#a0b8ff', '#5b80ff'],
  boost: ['var(--boost,#40c97e)', '#5de09b', '#2db36b'],
  quote: ['var(--accent,#9b7fff)', '#c4b0ff', '#b499ff'],
  fav:   ['var(--fav,#ffb035)', '#ffd060', '#ff8c00'],
};

function _animateCount(el, newValue, type) {
  el.textContent = newValue;
  if (!type) return; // count went down or user-triggered - just update silently

  // Strip any ongoing animation class then force reflow
  const cls = TYPE_CLASS[type];
  el.classList.remove(...Object.values(TYPE_CLASS));
  void el.offsetWidth; // reflow
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });

  _spawnSparks(el, type);
}

function _spawnSparks(el, type) {
  const rect   = el.getBoundingClientRect();
  const cx     = rect.left + rect.width  / 2;
  const cy     = rect.top  + rect.height / 2;
  const colors = SPARK_COLORS[type];
  const NUM    = 6;

  const wrap = document.createElement('div');
  wrap.className = 'count-sparks-wrap';
  wrap.style.cssText = `
    position:fixed;
    left:${cx}px;
    top:${cy}px;
    width:0;height:0;
    pointer-events:none;
    z-index:9999;
    overflow:visible;
  `;

  for (let i = 0; i < NUM; i++) {
    const angle = (i / NUM) * 360 + (Math.random() * 25 - 12);
    const dist  = 16 + Math.random() * 14;
    const size  = 2.5 + Math.random() * 1.5;
    const color = colors[i % colors.length];
    const delay = i * 18;

    const dot = document.createElement('div');
    dot.style.cssText = `
      position:absolute;
      width:${size}px;
      height:${size}px;
      border-radius:50%;
      background:${color};
      --sdx:${(Math.cos(angle * Math.PI / 180) * dist).toFixed(1)}px;
      --sdy:${(Math.sin(angle * Math.PI / 180) * dist).toFixed(1)}px;
      animation:count-spark 0.52s ease-out ${delay}ms both;
    `;
    wrap.appendChild(dot);
  }

  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 700);
}
