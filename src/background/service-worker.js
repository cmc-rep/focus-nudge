import { getSettings, setSettings } from '../common/storage.js';
import { hostFromUrl, isLockedHost, normalizeHost } from '../common/hosts.js';
import { clearNotification } from './reminders.js';
import {
  closeCurrentTab,
  dismiss,
  ensureHeartbeat,
  evaluate,
  focusCurrentTab,
  forgetTab,
  getState,
  recordSignals,
  resetTimer
} from './tracker.js';

// Listeners must be registered synchronously at top level so the evicted worker can revive.

async function boot(reason) {
  await ensureHeartbeat();
  await evaluate(reason);
}

chrome.runtime.onStartup.addListener(() => boot('startup'));

chrome.alarms.onAlarm.addListener((alarm) => {
  evaluate(`alarm:${alarm.name}`);
});

chrome.tabs.onActivated.addListener(() => evaluate('tab-activated'));

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Fires on SPA history changes too, which is how YouTube/Reddit navigation is caught.
  if (changeInfo.url) {
    forgetTab(tabId).then(() => evaluate('tab-url'));
  } else if (changeInfo.status === 'complete') {
    evaluate('tab-complete');
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId).then(() => evaluate('tab-removed'));
});

chrome.windows.onFocusChanged.addListener(() => evaluate('window-focus'));

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'sync') return;
  evaluate('settings-changed');
});

chrome.notifications.onButtonClicked.addListener(async (_id, buttonIndex) => {
  if (buttonIndex === 0) {
    const settings = await getSettings();
    await dismiss(settings.dismissMinutes);
  } else {
    await closeCurrentTab();
  }
});

chrome.notifications.onClicked.addListener(async () => {
  await clearNotification();
  await focusCurrentTab();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      console.error('[FocusNudge] message failed', message?.type, error);
      sendResponse({ ok: false, error: String(error) });
    });
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'fn:signals': {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') return null;
      return recordSignals(tabId, message.url, message.signals, hostFromUrl(message.url));
    }
    case 'fn:get-state':
      return getState();
    case 'fn:dismiss': {
      const settings = await getSettings();
      return dismiss(message.minutes ?? settings.dismissMinutes);
    }
    case 'fn:close-tab':
      return closeCurrentTab();
    case 'fn:reset':
      return resetTimer();
    case 'fn:set-rule':
      return setSiteRule(message.host, message.rule);
    default:
      return null;
  }
}

/** rule: 'block' | 'allow' | 'clear'. A host never sits in both lists. */
async function setSiteRule(rawHost, rule) {
  const host = normalizeHost(rawHost);
  if (!host) return null;

  const settings = await getSettings();
  if (isLockedHost(host)) return { blocklist: settings.blocklist, allowlist: settings.allowlist };

  const blocklist = settings.blocklist.filter((entry) => entry !== host);
  const allowlist = settings.allowlist.filter((entry) => entry !== host);

  if (rule === 'block') blocklist.push(host);
  if (rule === 'allow') allowlist.push(host);

  await setSettings({ blocklist, allowlist });
  await resetTimer();
  return { blocklist, allowlist };
}

// The worker is evicted constantly and revived by any event above, so re-assert state here
// rather than relying on onInstalled/onStartup having fired in this worker generation.
boot('wake');
