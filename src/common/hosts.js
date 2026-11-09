import { LOCKED_DOMAINS } from './defaults.js';

/** Strips scheme, credentials, www, path and lowercases. Returns '' when unusable. */
export function normalizeHost(input) {
  if (typeof input !== 'string') return '';
  let value = input.trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^[a-z-]+:\/\//, '');
  value = value.split('/')[0].split('@').pop();
  value = value.split(':')[0];
  value = value.replace(/^www\./, '');
  return /^[a-z0-9.-]+$/.test(value) ? value : '';
}

export function hostFromUrl(url) {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return '';
  }
}

/** True when host equals an entry or is a subdomain of it. */
export function hostMatches(host, list) {
  if (!host || !Array.isArray(list)) return false;
  return list.some((entry) => entry && (host === entry || host.endsWith(`.${entry}`)));
}

/** True for hosts on the permanent distraction list, which users cannot override. */
export function isLockedHost(host) {
  return hostMatches(host, LOCKED_DOMAINS);
}

/** Only ordinary web pages can host a content script or be timed. */
export function isTrackableUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}
