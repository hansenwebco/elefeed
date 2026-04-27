import { state, getSyncAccountId, getStoredAccounts } from './state.js';
import { apiGet, apiPost } from './api.js';

/**
 * @module sync
 * Low-level utility for reading and writing data blocks within the Mastodon account note.
 */

function getSyncCredentials() {
  const accounts = getStoredAccounts();
  const syncId = getSyncAccountId();
  const target = accounts.find(a => a.id === syncId) || accounts.find(a => a.id === state.activeAccountId) || accounts[0];
  return target;
}

export async function getAccountNote() {
  const creds = getSyncCredentials();
  if (!creds) return '';
  try {
    const rels = await apiGet(`/api/v1/accounts/relationships?id[]=${creds.accountData.id}`, creds.token, creds.server);
    const rel = rels && rels.find(r => String(r.id) === String(creds.accountData.id));
    return rel ? (rel.note || '') : '';
  } catch (err) {
    console.error('[Sync] Failed to fetch account note:', err);
    return '';
  }
}

export function extractBlock(note, startMarker, endMarker) {
  if (!note || !note.includes(startMarker)) return null;
  const startIdx = note.indexOf(startMarker);
  const endIdx = note.indexOf(endMarker);
  if (endIdx === -1) return null;

  const jsonStr = note.substring(startIdx + startMarker.length, endIdx);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`[Sync] Failed to parse block between ${startMarker} and ${endMarker}`);
    return null;
  }
}

export function updateBlockInNote(note, startMarker, endMarker, data) {
  const block = `${startMarker}${JSON.stringify(data)}${endMarker}`;
  if (note.includes(startMarker)) {
    const startIdx = note.indexOf(startMarker);
    const endIdx = note.indexOf(endMarker);
    if (endIdx !== -1) {
      return note.substring(0, startIdx) + block + note.substring(endIdx + endMarker.length);
    }
  }
  return (note.trim() + '\n' + block).trim();
}

export function removeBlockFromNote(note, startMarker, endMarker) {
  if (!note || !note.includes(startMarker)) return note;
  const startIdx = note.indexOf(startMarker);
  const endIdx = note.indexOf(endMarker);
  if (endIdx === -1) return note;
  
  return (note.substring(0, startIdx).trim() + '\n' + note.substring(endIdx + endMarker.length).trim()).trim();
}

export async function saveAccountNote(note) {
  const creds = getSyncCredentials();
  if (!creds) return;
  return apiPost(`/api/v1/accounts/${creds.accountData.id}/note`, { comment: note }, creds.token, creds.server);
}
