import { formatDuration } from '../common/hosts.js';

export const NOTIFICATION_ID = 'fn:reminder';

function buildMessage(host, accruedMs, count) {
  const spent = formatDuration(accruedMs);
  if (count <= 1) return `You've spent ${spent} on ${host}. Still worth it?`;
  if (count === 2) return `${spent} on ${host} — that's your second nudge.`;
  return `${spent} and counting on ${host}. Nudge #${count}. Time to move on.`;
}

export async function fireReminder({ host, accruedMs, count, tabId, settings }) {
  const message = buildMessage(host, accruedMs, count);
  const insistent = settings.escalate && count >= 3;

  if (settings.showNotification) {
    try {
      await chrome.notifications.create(NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: insistent ? 'Focus Nudge — seriously, time to move on' : 'Focus Nudge',
        message,
        priority: 2,
        requireInteraction: insistent,
        buttons: [{ title: 'Dismiss' }, { title: 'Close tab' }]
      });
    } catch (error) {
      console.warn('[FocusNudge] notification failed', error);
    }
  }

  if (settings.showOverlay && typeof tabId === 'number') {
    await sendToTab(tabId, {
      type: 'fn:show-overlay',
      payload: {
        host,
        message,
        accruedMs,
        count,
        insistent
      }
    });
  }
}

export async function hideOverlay(tabId) {
  if (typeof tabId !== 'number') return;
  await sendToTab(tabId, { type: 'fn:hide-overlay' });
}

export async function clearNotification() {
  try {
    await chrome.notifications.clear(NOTIFICATION_ID);
  } catch {
    /* already gone */
  }
}

/** Tabs loaded before install have no content script; a failed send is expected. */
async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    /* no receiver in that tab */
  }
}
