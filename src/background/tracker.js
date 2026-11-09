import {
  bumpDailyStat,
  clearSession,
  dropScore,
  getSettings,
  getStats,
  readScores,
  readSession,
  writeScore,
  writeSession
} from '../common/storage.js';
import { isTrackableUrl } from '../common/hosts.js';
import { classify, scoreSignals } from './classifier.js';
import { clearNotification, fireReminder, hideOverlay } from './reminders.js';

export const HEARTBEAT_ALARM = 'fn-heartbeat';
export const DEADLINE_ALARM = 'fn-deadline';

// Heartbeat is 1 min, so a longer gap means the device slept — don't bill that time.
const MAX_FLUSH_MS = 150_000;

function emptySession() {
  return {
    startedAt: null,
    accruedMs: 0,
    remindersSent: 0,
    thresholdsHandled: 0,
    dismissedUntil: null,
    currentHost: null,
    currentTabId: null,
    hosts: {}
  };
}

export function thresholdMs(settings) {
  return settings.debugMode
    ? Math.max(5, settings.debugThresholdSeconds) * 1000
    : Math.max(1, settings.thresholdMinutes) * 60_000;
}

export async function ensureHeartbeat() {
  const existing = await chrome.alarms.get(HEARTBEAT_ALARM);
  if (!existing) {
    await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1, delayInMinutes: 1 });
  }
}

/** The active tab of the most recently focused window, even while the browser is in the background. */
async function getActiveTab() {
  try {
    const window = await chrome.windows.getLastFocused();
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
    return tab ?? null;
  } catch {
    return null;
  }
}

async function getScore(tabId, url, { refetch = true } = {}) {
  const scores = await readScores();
  const entry = scores[tabId];
  if (entry && entry.url === url) return entry.score;
  // Stale or missing: ask the page to re-collect, this round falls back to domain rules.
  if (refetch) chrome.tabs.sendMessage(tabId, { type: 'fn:rescore' }).catch(() => {});
  return undefined;
}

// Events arrive in bursts; serialize so two evaluations can't double-count the same span.
let chain = Promise.resolve();
export function evaluate(reason) {
  chain = chain.then(() => runEvaluate(reason)).catch((error) => {
    console.error('[FocusNudge] evaluate failed', reason, error);
  });
  return chain;
}

async function runEvaluate(reason) {
  const settings = await getSettings();
  const now = Date.now();
  const session = (await readSession()) ?? emptySession();
  session.thresholdsHandled ??= session.remindersSent; // Sessions written before this field existed.

  await flush(session, now);

  const tab = await getActiveTab();

  let verdict = null;
  if (tab && isTrackableUrl(tab.url)) {
    const score = await getScore(tab.id, tab.url);
    verdict = classify(tab.url, score, settings);
  }

  if (!verdict?.distracting) {
    const leftTheSet = Boolean(tab && isTrackableUrl(tab.url));
    await chrome.alarms.clear(DEADLINE_ALARM);
    if (leftTheSet) {
      await clearSession();
      await clearNotification();
      if (session.currentTabId !== null) await hideOverlay(session.currentTabId);
    } else {
      // No active tab or a browser-internal page: pause without losing progress.
      await writeSession(session);
    }
    return;
  }

  session.currentHost = verdict.host;
  session.currentTabId = tab.id;
  session.startedAt = now;

  const span = thresholdMs(settings);
  const earned = Math.floor(session.accruedMs / span);
  const dismissActive = session.dismissedUntil !== null && now < session.dismissedUntil;
  const dismissExpired = session.dismissedUntil !== null && now >= session.dismissedUntil;

  if (!dismissActive && (earned > session.thresholdsHandled || dismissExpired)) {
    session.thresholdsHandled = Math.max(session.thresholdsHandled, earned);
    session.remindersSent += 1;
    session.dismissedUntil = null;
    await writeSession(session);
    await fireReminder({
      host: verdict.host,
      accruedMs: session.accruedMs,
      count: session.remindersSent,
      tabId: tab.id,
      settings
    });
  } else {
    await writeSession(session);
  }

  await scheduleDeadline(session, settings, now);
}

async function flush(session, now) {
  if (!session.startedAt || !session.currentHost) {
    session.startedAt = null;
    return;
  }
  const delta = Math.min(Math.max(0, now - session.startedAt), MAX_FLUSH_MS);
  session.startedAt = null;
  if (delta <= 0) return;

  session.accruedMs += delta;
  session.hosts[session.currentHost] = (session.hosts[session.currentHost] ?? 0) + delta;
  await bumpDailyStat(session.currentHost, delta);
}

async function scheduleDeadline(session, settings, now) {
  const span = thresholdMs(settings);
  const nextAt = (session.thresholdsHandled + 1) * span;
  let remaining = nextAt - session.accruedMs;
  // Wake when the dismiss window lapses so the nudge can return.
  if (session.dismissedUntil && session.dismissedUntil > now) {
    remaining = Math.min(remaining, session.dismissedUntil - now);
  }
  await chrome.alarms.create(DEADLINE_ALARM, { when: now + Math.max(remaining, 1000) });
}

export async function recordSignals(tabId, url, signals, host) {
  await writeScore(tabId, url, scoreSignals(signals, host));
  await evaluate('signals');
}

/** Hides the current nudge and holds off the next one for a short, fixed window. */
export async function dismiss(minutes) {
  const session = await readSession();
  if (!session) return;
  await flush(session, Date.now());
  session.dismissedUntil = Date.now() + Math.max(1, minutes) * 60_000;
  await writeSession(session);
  await clearNotification();
  if (session.currentTabId !== null) await hideOverlay(session.currentTabId);
  await evaluate('dismiss');
}

export async function resetTimer() {
  const session = await readSession();
  await chrome.alarms.clear(DEADLINE_ALARM);
  await clearSession();
  await clearNotification();
  if (session?.currentTabId !== null && session?.currentTabId !== undefined) {
    await hideOverlay(session.currentTabId);
  }
  await evaluate('reset');
}

export async function forgetTab(tabId) {
  await dropScore(tabId);
  const session = await readSession();
  if (session?.currentTabId !== tabId) return;
  // SPA navigations fire constantly; bank the elapsed span instead of dropping it.
  await flush(session, Date.now());
  session.currentTabId = null;
  await writeSession(session);
}

export async function closeCurrentTab() {
  const session = await readSession();
  const tabId = session?.currentTabId;
  await clearNotification();
  if (typeof tabId === 'number') {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      /* already closed */
    }
  }
  await resetTimer();
}

export async function focusCurrentTab() {
  const session = await readSession();
  const tabId = session?.currentTabId;
  if (typeof tabId !== 'number') return;
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    /* tab is gone */
  }
}

/** Snapshot for the popup: includes time accrued since the last flush. */
export async function getState() {
  const settings = await getSettings();
  const session = await readSession();
  const stats = await getStats();
  const tab = await getActiveTab();

  let verdict = null;
  if (tab && isTrackableUrl(tab.url)) {
    // The popup polls once a second; never let that trigger page re-scans.
    const score = await getScore(tab.id, tab.url, { refetch: false });
    verdict = classify(tab.url, score, settings);
  }

  let elapsedMs = session?.accruedMs ?? 0;
  if (session?.startedAt) {
    elapsedMs += Math.min(Math.max(0, Date.now() - session.startedAt), MAX_FLUSH_MS);
  }

  return {
    settings,
    verdict,
    url: tab?.url ?? '',
    elapsedMs,
    thresholdMs: thresholdMs(settings),
    remindersSent: session?.remindersSent ?? 0,
    dismissedUntil: session?.dismissedUntil ?? null,
    running: Boolean(session?.startedAt),
    todayMs: stats.totalMs,
    todayHosts: stats.hosts
  };
}
