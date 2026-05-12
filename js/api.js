/**
 * @module api
 * Mastodon API helpers - generic GET, app registration, OAuth token exchange.
 */

import { state, store, REDIRECT_URI, SCOPES, CLIENT_NAME, CLIENT_WEBSITE } from './state.js';

/**
 * Helper to construct a full Mastodon API URL, respecting protocol-relative paths
 * and local vs. secure environments.
 */
export function getApiUrl(base, path) {
  if (!base || base === 'null' || base === 'undefined') {
    // If no server is provided, check if path is already full
    if (path.includes('://')) return path;
    // Fallback to active state if available, else return path as-is (relative)
    if (state.server && state.server !== 'null') {
      base = state.server;
    } else {
      console.warn(`[API] getApiUrl called with no base and no state.server for path: ${path}`);
      return path;
    }
  }

  if (base.includes('://')) return `${base}${path}`;
  
  // Detect local/private IP or localhost
  const isLocal = base.includes('localhost') || 
                  base.includes('127.0.0.1') || 
                  /^192\.168\./.test(base) || 
                  /^10\./.test(base) || 
                  /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(base);
                  
  const protocol = (location.protocol === 'http:' && isLocal) ? 'http' : 'https';
  return `${protocol}://${base}${path}`;
}

/**
 * Authenticated GET request against the user's Mastodon instance.
 */
export async function apiGet(path, token, server, signal) {
  const url = getApiUrl(server || state.server, path);
  const bearer = token || state.token;

  console.log(`[API] GET ${url}`);

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 15000); // 15s timeout

  let res;
  try {
    res = await fetch(url, {
      headers: bearer ? { Authorization: `Bearer ${bearer}`, 'Accept': 'application/json' } : { 'Accept': 'application/json' },
      cache: 'no-store',
      signal: signal || controller.signal,
    });
    clearTimeout(id);
  } catch (networkErr) {
    if (networkErr.name === 'AbortError') throw networkErr;
    throw new Error(`Network error fetching ${url}: ${networkErr.message}. Are you online?`);
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || ''; } catch { }
    throw new Error(`API error ${res.status}${detail ? ': ' + detail : ` (${res.statusText})`}`);
  }
  return res.json();
}

/**
 * Generic POST request.
 */
export async function apiPost(path, body, token, server) {
  const url = getApiUrl(server || state.server, path);
  const bearer = token || state.token;

  console.log(`[API] POST ${url}`, body);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || ''; } catch { }
    throw new Error(`API error ${res.status}${detail ? ': ' + detail : ` (${res.statusText})`}`);
  }
  return res.json();
}

/**
 * Generic PUT request.
 */
export async function apiPut(path, body, token, server) {
  const url = getApiUrl(server || state.server, path);
  const bearer = token || state.token;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || ''; } catch { }
    throw new Error(`API error ${res.status}${detail ? ': ' + detail : ` (${res.statusText})`}`);
  }
  return res.json();
}

/**
 * Generic PATCH request.
 */
export async function apiPatch(path, body, token, server) {
  const url = getApiUrl(server || state.server, path);
  const bearer = token || state.token;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || ''; } catch { }
    throw new Error(`API error ${res.status}${detail ? ': ' + detail : ` (${res.statusText})`}`);
  }
  return res.json();
}

/**
 * Generic DELETE request.
 */
export async function apiDelete(path, token, server) {
  const url = getApiUrl(server || state.server, path);
  const bearer = token || state.token;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${bearer}`,
    },
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || ''; } catch { }
    throw new Error(`API error ${res.status}${detail ? ': ' + detail : ` (${res.statusText})`}`);
  }
  return res.ok;
}

/**
 * Mastodon V2 Filter Methods
 */
export async function getFiltersV2() {
  return apiGet('/api/v2/filters');
}

export async function createFilterV2(params) {
  return apiPost('/api/v2/filters', params);
}

export async function updateFilterV2(id, params) {
  return apiPut(`/api/v2/filters/${id}`, params);
}

export async function deleteFilterV2(id) {
  return apiDelete(`/api/v2/filters/${id}`);
}

export async function addFilterKeywordV2(filterId, keyword, wholeWord = true) {
  return apiPost(`/api/v2/filters/${filterId}/keywords`, { keyword, whole_word: wholeWord });
}

export async function removeFilterKeywordV2(keywordId) {
  return apiDelete(`/api/v2/filters/keywords/${keywordId}`);
}

/** Register this application with a Mastodon instance. */
export async function registerApp(server) {
  const url = getApiUrl(server, '/api/v1/apps');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: REDIRECT_URI,
      scopes: SCOPES,
      website: CLIENT_WEBSITE
    })
  });
  if (!res.ok) throw new Error(`Registration failed: ${res.status}`);
  return res.json();
}

/** Exchange an OAuth authorization code for an access token. */
export async function exchangeCode(server, clientId, clientSecret, code) {
  const url = getApiUrl(server, '/oauth/token');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code: code,
      scope: SCOPES
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Token exchange failed: ${err.error_description || err.error}`);
  }
  return res.json();
}

export async function muteConversation(id) {
  return apiPost(`/api/v1/statuses/${id}/mute`);
}

export async function unmuteConversation(id) {
  return apiPost(`/api/v1/statuses/${id}/unmute`);
}
