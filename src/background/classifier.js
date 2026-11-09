import { BUILT_IN_DOMAINS, NEWSY_HOST_FRAGMENTS, PRODUCTIVE_HOST_FRAGMENTS } from '../common/defaults.js';
import { hostFromUrl, hostMatches, isLockedHost, isTrackableUrl } from '../common/hosts.js';

/**
 * Turns raw DOM signals collected by the content script into a distraction score.
 * Weights live here so the content script stays a dumb collector.
 */
export function scoreSignals(signals, host) {
  if (!signals) return 0;
  let score = 0;

  if (signals.ogType === 'article') score += 3;
  if (typeof signals.ogType === 'string' && signals.ogType.startsWith('video')) score += 3;

  if (signals.schemaNews) score += 4;
  if (signals.schemaVideo) score += 3;
  if (signals.schemaSocial) score += 4;

  if (signals.newsKeywords) score += 3;
  if (signals.publishedTime) score += 2;
  if (signals.feedRole) score += 3;
  if (signals.bigVideo) score += 2;

  if (signals.articleCount >= 3) score += 2;
  else if (signals.articleCount >= 1) score += 1;

  if (signals.codeBlocks >= 3) score -= 2;
  if (signals.formFields >= 3) score -= 1;

  if (NEWSY_HOST_FRAGMENTS.some((fragment) => host.includes(fragment))) score += 2;
  if (PRODUCTIVE_HOST_FRAGMENTS.some((fragment) => host.includes(fragment))) score -= 5;

  return score;
}

/**
 * Precedence: the locked list wins, then the user allowlist, then the user blocklist,
 * then the built-in list, then the content heuristic score reported by the page.
 */
export function classify(url, score, settings) {
  const host = hostFromUrl(url);

  if (!isTrackableUrl(url) || !host) {
    return { distracting: false, host, reason: 'not-a-web-page' };
  }
  if (isLockedHost(host)) {
    return { distracting: true, host, reason: 'locked-distraction' };
  }
  if (hostMatches(host, settings.allowlist)) {
    return { distracting: false, host, reason: 'allowlisted' };
  }
  if (hostMatches(host, settings.blocklist)) {
    return { distracting: true, host, reason: 'blocklisted' };
  }
  if (hostMatches(host, BUILT_IN_DOMAINS)) {
    return { distracting: true, host, reason: 'known-distraction' };
  }
  if (settings.heuristicsEnabled && typeof score === 'number' && score >= settings.heuristicCutoff) {
    return { distracting: true, host, reason: 'content-heuristic', score };
  }
  return { distracting: false, host, reason: 'neutral', score };
}
