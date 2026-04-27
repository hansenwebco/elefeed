import { state } from './state.js';
import { apiGet, apiPost } from './api.js';

/**
 * @module sync
 * Low-level utility for reading and writing data blocks within the Mastodon account note.
 */

export async function getAccountNote() {
  if (!state.account || !state.token) return '';
  try {
    const rels = await apiGet(`/api/v1/accounts/relationships?id[]=${state.account.id}`);
    const rel = rels && rels.find(r => String(r.id) === String(state.account.id));
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
  if (!state.account || !state.token) return;
  return apiPost(`/api/v1/accounts/${state.account.id}/note`, { comment: note });
}
