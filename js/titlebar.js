/**
 * @module titlebar
 * Manages the browser tab title for new posts and notifications.
 */

import { state } from './state.js';

/**
 * Initializes the title bar module.
 */
export function initTitleBar() {
  // Listen for visibility changes to ensure title stays in sync
  document.addEventListener('visibilitychange', () => {
    updateTitleBar();
  });
}

/**
 * Updates the browser tab title based on unread counts.
 * Format: 🔔3 📰5 Elefeed
 */
export function updateTitleBar() {
  const isLoggedOut = !state.token && !state.demoMode;
  const baseTitle = 'Elefeed - A Tidy Mastodon Client';

  if (isLoggedOut) {
    document.title = baseTitle;
    return;
  }

  const notifCount = state.notifUnreadCount || 0;
  
  let postCount = 0;
  if (window.getFilteredPendingPosts && window.activeFeedKey) {
     postCount = window.getFilteredPendingPosts(window.activeFeedKey()).length;
  }

  // Build the specific format requested: Elefeed - 5🐘 · 3🔔
  let alerts = [];
  
  if (postCount > 0) {
    alerts.push(`${postCount}🐘`);
  }

  if (notifCount > 0) {
    alerts.push(`${notifCount}🔔`);
  }

  const suffix = alerts.length > 0 ? ` - ${alerts.join(' · ')}` : '';
  document.title = `Elefeed${suffix}`;


  const notifBell = document.querySelector('.notif-bell-wrap');
  if (notifBell) {
    notifBell.classList.toggle('has-new-notifications', notifCount > 0);
  }
}
