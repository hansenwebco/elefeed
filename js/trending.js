/**
 * @module trending
 * Explore tab — loads and renders trending posts, hashtags, people, and news.
 */

import { $, state } from './state.js';
import { apiGet } from './api.js';
import { makeSkeleton, updateTabLabel } from './ui.js';
import { renderPost } from './render.js';
import { escapeHTML, renderCustomEmojis, formatCount } from './utils.js';

/* ── Sparkline builder ─────────────────────────────────────────────── */

function buildSparkline(history) {
  if (!Array.isArray(history) || history.length === 0) return '';
  const values = history.slice(0, 7).reverse().map(h => parseInt(h.uses, 10) || 0);
  const maxVal = Math.max(...values, 1);
  const bars = values.map(v => {
    const pct = Math.round((v / maxVal) * 100);
    return `<div class="sparkline-bar" style="height:${Math.max(pct, 5)}%"></div>`;
  }).join('');
  return `<div class="trending-tag-sparkline">${bars}</div>`;
}

/* ── Individual loaders ────────────────────────────────────────────── */

export async function loadTrendingPosts() {
  const container = $('trending-posts-list');
  const loading = $('trending-posts-loading');
  const errEl = $('trending-posts-error');

  errEl.classList.remove('visible');
  $('trending-posts-skeleton').innerHTML = makeSkeleton(5);
  loading.style.display = 'flex';
  container.innerHTML = '';

  try {
    const posts = await apiGet('/api/v1/trends/statuses?limit=20', state.token);
    loading.style.display = 'none';

    if (!Array.isArray(posts) || posts.length === 0) {
      container.innerHTML = `<div class="feed-status"><div class="status-icon">📈</div><p>No trending posts right now.</p></div>`;
      return;
    }
    container.innerHTML = posts.map(p => renderPost(p, { tags: [] })).join('');
    state.trendingPostsLoaded = true;
  } catch (err) {
    loading.style.display = 'none';
    errEl.textContent = 'Could not load trending posts: ' + err.message;
    errEl.classList.add('visible');
  }
}

export async function loadTrendingHashtags() {
  const container = $('trending-hashtags-list');
  const loading = $('trending-hashtags-loading');
  const errEl = $('trending-hashtags-error');

  errEl.classList.remove('visible');
  $('trending-hashtags-skeleton').innerHTML = makeSkeleton(3);
  loading.style.display = 'flex';
  container.innerHTML = '';

  try {
    const tags = await apiGet('/api/v1/trends/tags?limit=20', state.token);
    loading.style.display = 'none';

    if (!Array.isArray(tags) || tags.length === 0) {
      container.innerHTML = `<div class="feed-status"><div class="status-icon">#️⃣</div><p>No trending hashtags right now.</p></div>`;
      return;
    }
    container.innerHTML = tags.map((tag, i) => {
      const totalUses = (tag.history || []).reduce((s, h) => s + (parseInt(h.uses, 10) || 0), 0);
      const todayAccounts = tag.history && tag.history[0] ? parseInt(tag.history[0].accounts, 10) || 0 : 0;
      return `
        <a class="trending-tag-row" href="#" data-trending-tag="${escapeHTML(tag.name)}">
          <span class="trending-tag-rank">${i + 1}</span>
          <div class="trending-tag-main">
            <div class="trending-tag-name">#${escapeHTML(tag.name)}</div>
            <div class="trending-tag-meta">
              <span class="trending-tag-stat">${formatCount(totalUses)} uses</span>
              <span class="trending-tag-stat">&middot; ${formatCount(todayAccounts)} people today</span>
            </div>
          </div>
          ${buildSparkline(tag.history)}
        </a>`;
    }).join('');
    state.trendingHashtagsLoaded = true;
  } catch (err) {
    loading.style.display = 'none';
    errEl.textContent = 'Could not load trending hashtags: ' + err.message;
    errEl.classList.add('visible');
  }
}

export async function loadTrendingPeople() {
  const container = $('trending-people-list');
  const loading = $('trending-people-loading');
  const errEl = $('trending-people-error');

  errEl.classList.remove('visible');
  $('trending-people-skeleton').innerHTML = makeSkeleton(3);
  loading.style.display = 'flex';
  container.innerHTML = '';

  try {
    const people = await apiGet('/api/v1/directory?order=active&limit=12&local=true', state.token);
    loading.style.display = 'none';

    if (!Array.isArray(people) || people.length === 0) {
      container.innerHTML = `<div class="feed-status"><div class="status-icon">👥</div><p>No accounts found.</p></div>`;
      return;
    }
    container.innerHTML = people.map(acct => `
      <div class="trending-person-card" data-profile-id="${escapeHTML(acct.id)}" data-profile-server="">
        <div class="trending-person-avatar">
          <img src="${escapeHTML(acct.avatar_static || acct.avatar)}" alt="" loading="lazy" />
        </div>
        <div class="trending-person-name">${renderCustomEmojis(acct.display_name || acct.username, acct.emojis || [])}</div>
        <div class="trending-person-acct">@${escapeHTML(acct.acct)}</div>
        <div class="trending-person-stats">
          <div class="trending-person-stat">
            <span class="trending-person-stat-val">${formatCount(acct.followers_count || 0)}</span>
            <span class="trending-person-stat-label">followers</span>
          </div>
          <div class="trending-person-stat">
            <span class="trending-person-stat-val">${formatCount(acct.statuses_count || 0)}</span>
            <span class="trending-person-stat-label">posts</span>
          </div>
        </div>
      </div>`).join('');
    state.trendingPeopleLoaded = true;
  } catch (err) {
    loading.style.display = 'none';
    errEl.textContent = 'Could not load people: ' + err.message;
    errEl.classList.add('visible');
  }
}

export async function loadTrendingNews() {
  const container = $('trending-news-list');
  const loading = $('trending-news-loading');
  const errEl = $('trending-news-error');

  errEl.classList.remove('visible');
  $('trending-news-skeleton').innerHTML = makeSkeleton(4);
  loading.style.display = 'flex';
  container.innerHTML = '';

  try {
    const links = await apiGet('/api/v1/trends/links?limit=20', state.token);
    loading.style.display = 'none';

    if (!Array.isArray(links) || links.length === 0) {
      container.innerHTML = `<div class="feed-status"><div class="status-icon">📰</div><p>No trending links right now.</p></div>`;
      return;
    }
    container.innerHTML = links.map(link => {
      const totalUses = (link.history || []).reduce((s, h) => s + (parseInt(h.uses, 10) || 0), 0);
      const provider = link.provider_name || link.author_name || (link.url ? new URL(link.url).hostname.replace('www.', '') : '');
      const thumb = link.image
        ? `<div class="trending-link-thumb"><img src="${escapeHTML(link.image)}" alt="" loading="lazy" /></div>`
        : `<div class="trending-link-thumb"><div class="trending-link-thumb-placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/></svg></div></div>`;
      return `
        <a class="trending-link-card" href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer">
          ${thumb}
          <div class="trending-link-body">
            ${provider ? `<div class="trending-link-provider">${escapeHTML(provider)}</div>` : ''}
            <div class="trending-link-title">${escapeHTML(link.title || link.url)}</div>
            ${link.description ? `<div class="trending-link-desc">${escapeHTML(link.description)}</div>` : ''}
            <div class="trending-link-stat">${formatCount(totalUses)} shares</div>
          </div>
        </a>`;
    }).join('');
    state.trendingNewsLoaded = true;
  } catch (err) {
    loading.style.display = 'none';
    errEl.textContent = 'Could not load trending news: ' + err.message;
    errEl.classList.add('visible');
  }
}

/* ── Tab-level loader (resets sub-panels and kicks off all fetches) ── */

export async function loadTrendingTab() {
  window.scrollTo({ top: 0, behavior: 'instant' });

  document.querySelectorAll('#tab-dropdown-explore .tab-dropdown-item').forEach((b, i) => b.classList.toggle('active', i === 0));
  document.querySelectorAll('.trending-subpanel').forEach((p, i) => p.classList.toggle('active', i === 0));
  updateTabLabel('explore');

  state.trendingPostsLoaded = false;
  state.trendingHashtagsLoaded = false;
  state.trendingPeopleLoaded = false;
  state.trendingNewsLoaded = false;

  loadTrendingPosts();
  loadTrendingHashtags();
  loadTrendingPeople();
  loadTrendingNews();
}
