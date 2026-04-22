import { $, qs, state, composeState, GIPHY_LAMBDA_URL } from './state.js';
import { updateCharCount, updateSidebarCharCount, openAltModal } from './compose.js';

let giphyActiveSuffix = '';
let giphyDebounceTimer = null;

export function initGiphy() {
  const btn = $('compose-giphy-btn');
  const sidebarBtn = $('compose-giphy-btn-sidebar');
  
  if (btn) btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openGiphyPicker('');
  });
  
  if (sidebarBtn) sidebarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openGiphyPicker('-sidebar');
  });

  const searchInput = $('giphy-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(giphyDebounceTimer);
      giphyDebounceTimer = setTimeout(() => {
        searchGifs(e.target.value);
      }, 400);
    });
  }

  // Close picker on outside click
  document.addEventListener('click', (e) => {
    const picker = $('giphy-picker');
    if (picker && !picker.contains(e.target) && picker.style.display === 'flex') {
      picker.style.display = 'none';
    }
  });

  updateGiphyVisibility();
}

export function updateGiphyVisibility() {
  const btn = $('compose-giphy-btn');
  const sidebarBtn = $('compose-giphy-btn-sidebar');
  const display = state.giphyEnabled ? 'flex' : 'none';
  
  if (btn) btn.style.display = display;
  if (sidebarBtn) sidebarBtn.style.display = display;
}

async function openGiphyPicker(suffix) {
  giphyActiveSuffix = suffix;
  const picker = $('giphy-picker');
  const anchor = suffix === '-sidebar' ? $('compose-giphy-btn-sidebar') : $('compose-giphy-btn');
  
  if (!picker || !anchor) return;

  // Position picker
  if (window.innerWidth > 900) {
    const rect = anchor.getBoundingClientRect();
    const pickerWidth = Math.min(350, window.innerWidth * 0.9);
    const pickerHeight = Math.min(450, window.innerHeight * 0.8);
    
    // Default: above the button
    let bottom = window.innerHeight - rect.top + 10;
    let left = rect.left;

    // Adjust if it goes off the right edge
    if (left + pickerWidth > window.innerWidth) {
      left = window.innerWidth - pickerWidth - 20;
    }

    // Adjust if it goes off the top edge
    if (rect.top - pickerHeight < 10) {
      // If it would go off top, show it below the button instead
      bottom = 'auto';
      picker.style.top = (rect.bottom + 10) + 'px';
      picker.style.bottom = 'auto';
    } else {
      picker.style.bottom = bottom + 'px';
      picker.style.top = 'auto';
    }

    picker.style.left = Math.max(10, left) + 'px';
    picker.style.display = 'flex';
  } else {
    // Mobile: fixed at bottom
    picker.style.bottom = '0px';
    picker.style.left = '0px';
    picker.style.top = 'auto';
    picker.style.width = '100%';
    picker.style.display = 'flex';
  }

  $('giphy-search').value = '';
  await searchGifs(''); // Load trending
}

async function searchGifs(query) {
  const body = $('giphy-picker-body');
  if (!body) return;

  body.innerHTML = '<div class="giphy-loading"><div class="spinner"></div></div>';

  try {
    const url = new URL(GIPHY_LAMBDA_URL);
    if (query) url.searchParams.append('q', query);
    url.searchParams.append('limit', 20);

    const res = await fetch(url.toString());
    const result = await res.json();
    
    renderGifs(result.data || []);
  } catch (err) {
    console.error('Giphy search failed:', err);
    body.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 20px; font-size:12px; color:var(--danger);">Search failed</div>';
  }
}

function renderGifs(gifs) {
  const body = $('giphy-picker-body');
  if (!body) return;

  if (gifs.length === 0) {
    body.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 20px; font-size:12px; color:var(--text-dim);">No GIFs found</div>';
    return;
  }

  body.innerHTML = '';
  gifs.forEach(gif => {
    const img = document.createElement('img');
    img.className = 'giphy-item';
    img.src = gif.images.fixed_width_small.url;
    img.alt = gif.title || 'GIF';
    img.loading = 'lazy';
    
    img.addEventListener('click', () => selectGif(gif));
    body.appendChild(img);
  });
}

async function selectGif(gif) {
  const suffix = giphyActiveSuffix;
  const picker = $('giphy-picker');
  if (picker) picker.style.display = 'none';

  const mediaFilesKey = suffix === '-sidebar' ? 'sidebarMediaFiles' : 'mediaFiles';
  const available = 4 - (composeState[mediaFilesKey] || []).length;
  
  if (available <= 0) {
    alert("You can only attach up to 4 items.");
    return;
  }

  // Get the higher quality GIF for the actual post
  // "downsized_large" is much crisper than "downsized" but still safe for Mastodon
  const gifUrl = gif.images.downsized_large.url;
  const title = gif.title || 'GIF from Giphy';

  try {
    // 1. Fetch the GIF as a Blob
    const response = await fetch(gifUrl);
    const blobData = await response.blob();
    
    // 2. Create a File object so it works with existing upload logic
    const file = new File([blobData], `${gif.id}.gif`, { type: 'image/gif' });
    
    // 3. Inject into compose state
    const mediaFilesKey = suffix === '-sidebar' ? 'sidebarMediaFiles' : 'mediaFiles';
    const mediaUrlsKey = suffix === '-sidebar' ? 'sidebarMediaUrls' : 'mediaUrls';
    const mediaDescsKey = suffix === '-sidebar' ? 'sidebarMediaDescriptions' : 'mediaDescriptions';
    const countFn = suffix === '-sidebar' ? updateSidebarCharCount : updateCharCount;

    composeState[mediaFilesKey].push(file);
    const blobUrl = URL.createObjectURL(file);
    composeState[mediaUrlsKey].push(blobUrl);
    composeState[mediaDescsKey].push(title);

    // 4. Update UI preview
    const preview = $('compose-media-preview' + suffix);
    const item = document.createElement('div');
    item.className = 'compose-media-item';

    const mediaEl = document.createElement('img');
    mediaEl.src = blobUrl;

    const altBtn = document.createElement('button');
    altBtn.className = 'compose-media-item-alt-btn';
    altBtn.textContent = 'ALT';
    altBtn.onclick = () => {
      const idx = composeState[mediaUrlsKey].indexOf(blobUrl);
      openAltModal(blobUrl, idx, suffix, composeState[mediaDescsKey][idx]);
    };

    const removeBtn = document.createElement('button');
    removeBtn.className = 'compose-media-remove';
    removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    removeBtn.onclick = () => {
      const index = composeState[mediaUrlsKey].indexOf(blobUrl);
      if (index > -1) {
        URL.revokeObjectURL(blobUrl);
        composeState[mediaFilesKey].splice(index, 1);
        composeState[mediaUrlsKey].splice(index, 1);
        composeState[mediaDescsKey].splice(index, 1);
      }
      item.remove();
      countFn();
    };

    item.appendChild(mediaEl);
    item.appendChild(altBtn);
    item.appendChild(removeBtn);
    preview.appendChild(item);

    countFn();

  } catch (err) {
    console.error('Failed to select GIF:', err);
    alert('Failed to attach GIF.');
  }
}

// Auto-init if this is loaded as a module
initGiphy();
