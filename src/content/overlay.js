// In-page reminder banner. Rendered in a shadow root so host page CSS can't touch it.
(() => {
  const HOST_TAG = 'focus-nudge-root';
  const AUTO_HIDE_MS = 30_000;
  const INSISTENT_UNLOCK_MS = 5_000;

  let shadow = null;
  let refs = null;
  let tickTimer = null;
  let hideTimer = null;
  let unlockTimer = null;
  let elapsedMs = 0;

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  function build() {
    const host = document.createElement(HOST_TAG);
    host.style.cssText = 'all: initial; position: static;';
    shadow = host.attachShadow({ mode: 'closed' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('src/content/overlay.css');
    shadow.append(link);

    const card = document.createElement('div');
    card.className = 'card';

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = '\u23F1';

    const body = document.createElement('div');
    body.className = 'body';
    const title = document.createElement('div');
    title.className = 'title';
    const sub = document.createElement('div');
    sub.className = 'sub';
    body.append(title, sub);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const closeButton = document.createElement('button');
    closeButton.className = 'primary';
    closeButton.textContent = 'Close tab';
    const dismissButton = document.createElement('button');
    dismissButton.textContent = 'Dismiss';
    actions.append(closeButton, dismissButton);

    card.append(badge, body, actions);
    shadow.append(card);
    mount();

    closeButton.addEventListener('click', () => send('fn:close-tab'));
    dismissButton.addEventListener('click', () => {
      send('fn:dismiss');
      hide();
    });

    refs = { host, card, title, sub, dismissButton };
  }

  function send(type) {
    chrome.runtime.sendMessage({ type }).catch(() => {});
  }

  // Only the fullscreen element's subtree renders, so the banner has to live inside it.
  function mount() {
    const node = shadow?.host;
    if (!node) return;
    const parent = document.fullscreenElement ?? document.body ?? document.documentElement;
    if (node.parentNode !== parent) parent.append(node);
  }

  function renderElapsed(hostName) {
    refs.sub.textContent = `${formatDuration(elapsedMs)} on ${hostName}`;
  }

  function show(payload) {
    if (!refs) build();
    clearTimers();
    mount();

    elapsedMs = payload.accruedMs;
    refs.title.textContent = payload.message;
    refs.card.classList.toggle('insistent', Boolean(payload.insistent));
    renderElapsed(payload.host);

    requestAnimationFrame(() => refs.card.classList.add('visible'));

    tickTimer = setInterval(() => {
      elapsedMs += 1000;
      renderElapsed(payload.host);
    }, 1000);

    if (payload.insistent) {
      // Force a beat of attention before the nudge can be waved away.
      refs.dismissButton.disabled = true;
      let remaining = INSISTENT_UNLOCK_MS / 1000;
      refs.dismissButton.textContent = `Dismiss (${remaining})`;
      unlockTimer = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          refs.dismissButton.textContent = `Dismiss (${remaining})`;
          return;
        }
        clearInterval(unlockTimer);
        unlockTimer = null;
        refs.dismissButton.disabled = false;
        refs.dismissButton.textContent = 'Dismiss';
      }, 1000);
    } else {
      refs.dismissButton.disabled = false;
      refs.dismissButton.textContent = 'Dismiss';
      hideTimer = setTimeout(hide, AUTO_HIDE_MS);
    }
  }

  function clearTimers() {
    clearInterval(tickTimer);
    clearTimeout(hideTimer);
    clearInterval(unlockTimer);
    tickTimer = hideTimer = unlockTimer = null;
  }

  function hide() {
    clearTimers();
    if (refs) refs.card.classList.remove('visible');
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'fn:show-overlay') show(message.payload);
    else if (message?.type === 'fn:hide-overlay') hide();
  });

  document.addEventListener('fullscreenchange', mount, true);
})();
