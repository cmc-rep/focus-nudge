import { DEFAULT_SETTINGS } from '../common/defaults.js';
import { isLockedHost, normalizeHost } from '../common/hosts.js';
import { getSettings, setSettings } from '../common/storage.js';

const NUMBERS = [
  'thresholdMinutes',
  'dismissMinutes',
  'heuristicCutoff',
  'debugThresholdSeconds'
];
const FLAGS = ['showNotification', 'showOverlay', 'escalate', 'heuristicsEnabled', 'debugMode'];
const LISTS = ['blocklist', 'allowlist'];

const el = (id) => document.getElementById(id);

/** Everything except the two site lists is hidden unless debug mode is on. */
function applyDebugVisibility() {
  const show = el('debugMode').checked;
  for (const node of document.querySelectorAll('[data-debug-only]')) {
    node.hidden = !show;
  }
}

function fill(settings) {
  for (const key of NUMBERS) el(key).value = settings[key];
  for (const key of FLAGS) el(key).checked = Boolean(settings[key]);
  for (const key of LISTS) el(key).value = settings[key].join('\n');
  applyDebugVisibility();
}

function collect() {
  const patch = {};
  for (const key of NUMBERS) {
    const input = el(key);
    const value = Number(input.value);
    patch[key] = Number.isFinite(value)
      ? Math.min(Number(input.max), Math.max(Number(input.min), value))
      : DEFAULT_SETTINGS[key];
    input.value = patch[key];
  }
  for (const key of FLAGS) patch[key] = el(key).checked;
  for (const key of LISTS) {
    patch[key] = el(key)
      .value.split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  patch.allowlist = patch.allowlist.filter((entry) => !isLockedHost(normalizeHost(entry)));
  return patch;
}

function flash(text) {
  el('status').textContent = text;
  setTimeout(() => {
    el('status').textContent = '';
  }, 2000);
}

el('save').addEventListener('click', async () => {
  await setSettings(collect());
  fill(await getSettings());
  flash('Saved.');
});

el('restore').addEventListener('click', async () => {
  await setSettings(DEFAULT_SETTINGS);
  fill(await getSettings());
  flash('Defaults restored.');
});

el('debugMode').addEventListener('change', applyDebugVisibility);

fill(await getSettings());
