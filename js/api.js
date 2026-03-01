/**
 * @module api
 * Mastodon API helpers — generic GET, app registration, OAuth token exchange.
 */

import { state, store, REDIRECT_URI, SCOPES, CLIENT_NAME, CLIENT_WEBSITE } from './state.js';

/**
 * Authenticated GET request against the user's Mastodon instance.
 * @param {string} path    API path (e.g. "/api/v1/timelines/home?limit=40")
 * @param {string} token   Bearer token (falls back to state.token)
 * @param {string} server  Server hostname (falls back to state.server)
 * @param {AbortSignal} signal  Optional abort signal
 */
export async function apiGet(path, token, server, signal) {
  const base = server || state.server;
  let res;
  try {
    res = await fetch(`https://${base}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
      signal,
    });
  } catch (networkErr) {
    if (networkErr.name === 'AbortError') throw networkErr;
    throw new Error(`Network error fetching ${path}. Are you online?`);
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || ''; } catch { }
    throw new Error(`API error ${res.status}${detail ? ': ' + detail : ` (${res.statusText})`}`);
  }
  return res.json();
}

/**
 * Register (or retrieve cached) OAuth application on the given server.
 * Validates cached redirect_uri and scopes to avoid stale registrations.
 */
export async function registerApp(server) {
  const stored = store.get(`app_${server}`);
  if (stored) {
    try {
      const app = JSON.parse(stored);
      if (app.redirect_uri === REDIRECT_URI && app.scopes === SCOPES) return app;
      store.del(`app_${server}`);
    } catch {
      store.del(`app_${server}`);
    }
  }

  const body = new URLSearchParams({
    client_name: CLIENT_NAME,
    redirect_uris: REDIRECT_URI,
    scopes: SCOPES,
    website: CLIENT_WEBSITE,
  });

  let res;
  try {
    res = await fetch(`https://${server}/api/v1/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (networkErr) {
    if (location.protocol === 'file:') {
      throw new Error(
        'Cannot connect from a file:// URL. ' +
        'Serve this file with a local web server:\n\n' +
        '  python3 -m http.server 8080\n\n' +
        'Then open http://localhost:8080'
      );
    }
    throw new Error(
      `Network error reaching ${server}. ` +
      'Check the server name, your connection, or whether the server is online.'
    );
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || JSON.stringify(j); } catch { }
    throw new Error(`Server rejected app registration (${res.status})${detail ? ': ' + detail : '.'}`);
  }

  const app = await res.json();
  if (!app.client_id || !app.client_secret) {
    throw new Error('Server returned invalid app credentials.');
  }

  store.set(`app_${server}`, JSON.stringify({ ...app, redirect_uri: REDIRECT_URI, scopes: SCOPES }));
  return app;
}

/**
 * Exchange an authorization code for an access token.
 */
export async function exchangeCode(server, clientId, clientSecret, code) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code,
    scope: SCOPES,
  });

  let res;
  try {
    res = await fetch(`https://${server}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (networkErr) {
    throw new Error(`Network error during token exchange with ${server}.`);
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error_description || j.error || ''; } catch { }
    throw new Error(`Token exchange failed (${res.status})${detail ? ': ' + detail : '.'}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('Server did not return an access token.');
  return data;
}
