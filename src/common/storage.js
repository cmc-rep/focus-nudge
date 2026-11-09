import { DEFAULT_SETTINGS } from './defaults.js';
import { isLockedHost, normalizeHost } from './hosts.js';

const SESSION_KEY = 'fn:session';
const SCORES_KEY = 'fn:scores';
const STATS_KEY = 'fn:stats';

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(normalizeHost).filter(Boolean))];
}

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    blocklist: normalizeList(stored.blocklist),
    // Locked hosts can never be exempted, so drop them if they ever landed in storage.
    allowlist: normalizeList(stored.allowlist).filter((host) => !isLockedHost(host))
  };
}

export async function setSettings(patch) {
  await chrome.storage.sync.set(patch);
}

/** Hot timer state. Lives in session storage because the MV3 worker is evicted constantly. */
export async function readSession() {
  const bag = await chrome.storage.session.get(SESSION_KEY);
  return bag[SESSION_KEY] ?? null;
}

export async function writeSession(session) {
  await chrome.storage.session.set({ [SESSION_KEY]: session });
}

export async function clearSession() {
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function readScores() {
  const bag = await chrome.storage.session.get(SCORES_KEY);
  return bag[SCORES_KEY] ?? {};
}

export async function writeScore(tabId, url, score) {
  const scores = await readScores();
  scores[tabId] = { url, score };
  await chrome.storage.session.set({ [SCORES_KEY]: scores });
}

export async function dropScore(tabId) {
  const scores = await readScores();
  if (!(tabId in scores)) return;
  delete scores[tabId];
  await chrome.storage.session.set({ [SCORES_KEY]: scores });
}

function localDateKey(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export async function getStats() {
  const bag = await chrome.storage.local.get(STATS_KEY);
  const today = localDateKey();
  const stats = bag[STATS_KEY];
  return stats && stats.date === today ? stats : { date: today, totalMs: 0, hosts: {} };
}

export async function bumpDailyStat(host, ms) {
  if (!host || !(ms > 0)) return;
  const stats = await getStats();
  stats.totalMs += ms;
  stats.hosts[host] = (stats.hosts[host] ?? 0) + ms;
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}
