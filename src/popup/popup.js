import { formatDuration, hostMatches, isLockedHost } from '../common/hosts.js';

const REASONS = {
  'not-a-web-page': 'Not a trackable page.',
  allowlisted: 'You marked this site as safe.',
  blocklisted: 'You marked this site as a distraction.',
  'locked-distraction': 'Always a distraction — this site cannot be exempted.',
  'known-distraction': 'On the built-in distraction list.',
  'content-heuristic': 'Page content looks like news, video, or a feed.',
  neutral: 'Looks like ordinary browsing.'
};

const el = (id) => document.getElementById(id);

async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error ?? 'request failed');
  return response.result;
}

function render(state) {
  const { verdict, settings } = state;
  const host = verdict?.host ?? '';
  const distracting = Boolean(verdict?.distracting);

  el('verdict').textContent = distracting ? 'Distraction' : 'All clear';
  el('verdict').className = `verdict ${distracting ? 'distracting' : 'safe'}`;
  el('host').textContent = host || 'No page in focus';

  let reason = REASONS[verdict?.reason] ?? '';
  if (verdict?.reason === 'content-heuristic' || verdict?.reason === 'neutral') {
    if (typeof verdict.score === 'number') {
      reason += ` (score ${verdict.score} / cutoff ${settings.heuristicCutoff})`;
    }
  }
  el('reason').textContent = reason;

  const ratio = Math.min(1, state.elapsedMs / state.thresholdMs);
  el('fill').style.width = `${ratio * 100}%`;
  el('elapsed').textContent = formatDuration(state.elapsedMs);
  el('threshold').textContent = `limit ${formatDuration(state.thresholdMs)}`;

  const dismissedFor = state.dismissedUntil ? state.dismissedUntil - Date.now() : 0;
  if (dismissedFor > 0) {
    el('nudges').textContent = `Dismissed for ${formatDuration(dismissedFor)}.`;
  } else if (state.remindersSent > 0) {
    el('nudges').textContent = `${state.remindersSent} nudge${state.remindersSent > 1 ? 's' : ''} so far.`;
  } else {
    el('nudges').textContent = state.running ? 'Timer running.' : 'Timer paused.';
  }

  el('today').textContent = formatDuration(state.todayMs);

  const locked = isLockedHost(host);
  const blocked = locked || hostMatches(host, settings.blocklist);
  const allowed = hostMatches(host, settings.allowlist);
  el('block').classList.toggle('active', blocked);
  el('allow').classList.toggle('active', allowed);

  for (const id of ['block', 'allow', 'clear']) {
    el(id).dataset.host = host;
    el(id).disabled = !host || locked;
  }
  el('clear').disabled = !host || locked || (!blocked && !allowed);
}

async function refresh() {
  render(await send('fn:get-state'));
}

function wireRule(id, rule) {
  el(id).addEventListener('click', async (event) => {
    const host = event.currentTarget.dataset.host;
    if (!host) return;
    await send('fn:set-rule', { host, rule });
    await refresh();
  });
}

wireRule('block', 'block');
wireRule('allow', 'allow');
wireRule('clear', 'clear');

el('reset').addEventListener('click', async () => {
  await send('fn:reset');
  await refresh();
});

el('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

refresh().catch((error) => {
  el('verdict').textContent = 'Error';
  el('reason').textContent = String(error);
});
setInterval(() => refresh().catch(() => {}), 1000);
