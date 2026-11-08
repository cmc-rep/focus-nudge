# Focus Nudge

A Manifest V3 browser extension for **Google Chrome and Microsoft Edge** (both Chromium, one
codebase) that watches how long you actively linger on news, sports, video, and social feeds —
and nudges you once you overstay your limit.

Default limit is **3 minutes**, and the nudge repeats every 3 minutes until you leave the
distraction set.

Everything runs locally. No page content, URL, or timing data ever leaves the browser.

---

## Behavior

### What the timer measures

Only time spent with a distracting page as the active tab:

| Situation | Effect on the timer |
| --- | --- |
| Reading Reddit in the active tab | Accruing |
| Switch to another app / minimize the browser | **Keeps accruing** |
| No keyboard or mouse for 60s | **Keeps accruing** |
| Watching a video with no input (muted or not) | Accruing |
| Switch to a background tab | **Paused** (progress kept) |
| Focus an ordinary web page (docs, email, GitHub) | **Reset to zero** |
| Switch Reddit → YouTube → CNN | **Keeps accruing** |

That last row is deliberate: the clock tracks the distraction *set*, not a single site, so
tab-hopping between distractions doesn't buy you a fresh 3 minutes.

### The nudge

At the threshold you get **both** reminders at once:

1. **System notification** (`chrome.notifications`) — visible even if the browser is minimized.
   Buttons: *Dismiss* and *Close tab*.
2. **In-page banner** — a top-center card rendered in a closed Shadow DOM so the host page's
   CSS cannot restyle or hide it. Shows a live counter. Buttons: *Close tab* and *Dismiss*.

Nudges escalate. #1 and #2 are polite and auto-hide after 30 seconds. **#3 onward** sets
`requireInteraction` on the notification (it won't auto-dismiss) and disables the banner's
Dismiss button for 5 seconds, forcing a beat of attention. Escalation can be turned off.

### How a page is judged distracting

Strict precedence, first match wins:

1. **Locked list** → always a distraction, cannot be overridden (Reddit, X/Twitter, Facebook,
   Instagram, YouTube, TikTok, Netflix, Hulu, Twitch, Quora)
2. **User allowlist** → never a distraction
3. **User blocklist** → always a distraction
4. **Built-in domain list** → ~70 known sites (CNN, BBC, NYT, ESPN, Bleacher Report, …)
5. **Content heuristics** → catches unknown news/video/feed pages

The heuristic collects DOM signals in the page and scores them in the background worker:

| Signal | Weight |
| --- | --- |
| JSON-LD `NewsArticle` / `SocialMediaPosting` / `DiscussionForumPosting` | +4 |
| `og:type` = `article` or `video.*` | +3 |
| JSON-LD `VideoObject` | +3 |
| `<meta name="news_keywords">` | +3 |
| `[role="feed"]` (infinite scroll) | +3 |
| Hostname contains *news*, *sport*, *daily*, *times*, … | +2 |
| `article:published_time` / `<time datetime>` | +2 |
| Video element ≥ 320×180 | +2 |
| 3+ `<article>` elements | +2 |
| 3+ code blocks | −2 |
| Hostname looks like docs/dev/work (`docs.`, `github.com`, `stackoverflow.com`, …) | −5 |

Default cutoff is **3**. Lower catches more sites; higher means fewer false alarms.

---

## Architecture

### Core constraint: the MV3 service worker is disposable

Chrome evicts the background worker after ~30 seconds idle, so:

- **No state lives in worker memory.** Hot timer state goes in `chrome.storage.session`,
  settings in `chrome.storage.sync`, daily stats in `chrome.storage.local`.
- **All listeners are registered synchronously at the top level**, so an evicted worker can be
  revived by any event.
- `boot()` is called at the top level of the worker, not just from `onInstalled`/`onStartup`, so
  every worker generation re-asserts the heartbeat alarm.

### Time accounting: timestamp deltas, not tick counting

The session record holds `{ startedAt, accruedMs, remindersSent, thresholdsHandled, dismissedUntil,
currentHost, currentTabId, hosts }`. Every relevant event flushes `now - startedAt` into `accruedMs`
and clears `startedAt`, then re-decides what to do.

`remindersSent` drives escalation and `thresholdsHandled` is the watermark of threshold multiples
already nudged for. They are separate so a dismissed nudge can return after `dismissMinutes`
without consuming the next scheduled nudge.

Deltas are capped at **150 seconds** against a 1-minute heartbeat. This is what stops a sleeping
laptop or hibernated machine from being billed as screen time.

Evaluations are **serialized through a promise chain**, because events arrive in bursts
(`onActivated` + `onUpdated` + `onFocusChanged` can fire together) and two concurrent runs would
double-count the same span.

### Alarms: heartbeat + deadline

- `fn-heartbeat` — repeating, 1 minute. Bounds the flush delta and acts as a safety net.
- `fn-deadline` — one-shot, recomputed on every event to fire exactly when the next nudge is due.

Chrome clamps alarms to a ~30 second minimum, so worst-case nudge error is about 30 seconds on a
3-minute threshold. Precision comes from the timestamps, not the alarm.

### Events that trigger a re-evaluation

`tabs.onActivated`, `tabs.onUpdated` (URL change — this is how SPA navigation on YouTube and
Reddit is caught), `tabs.onRemoved`, `windows.onFocusChanged`,
`alarms.onAlarm`, `storage.onChanged`, and `runtime.onStartup`.

---

## File layout

```
focus-nudge/
  manifest.json                    MV3, Chrome/Edge 120+
  icons/                           16 / 32 / 48 / 128 px
  src/
    common/
      defaults.js                  default settings + built-in domain and fragment lists
      hosts.js                     host normalization, subdomain matching, duration formatting
      storage.js                   typed wrappers over sync / session / local storage
    background/
      service-worker.js            event wiring, message router, notification buttons
      classifier.js                signal weights + verdict precedence
      tracker.js                   accrual, active-tab gating, alarm scheduling  <- the core
      reminders.js                 notification creation + overlay dispatch
    content/
      heuristics.js                DOM signal collector
      overlay.js                   Shadow DOM banner with live counter
      overlay.css                  banner styles (loaded into the shadow root)
    options/                       full settings page
    popup/                         live status, quick per-site rules
```

### A note on content scripts

Content scripts declared in the manifest are **classic scripts, not ES modules** — they cannot
`import`. Both content files are wrapped in IIFEs and use string literals for message types
rather than sharing constants with the background modules. This is the one place where a small
amount of duplication is intentional; removing it would require a bundler, and the project has
no build step by design.

---

## Permissions and why each is needed

| Permission | Reason |
| --- | --- |
| `storage` | Settings, timer state, daily stats |
| `alarms` | Heartbeat and deadline scheduling |
| `notifications` | The system toast reminder |
| `tabs` | Read the active tab's URL to classify it |
| `http://*/*`, `https://*/*` | Inject the heuristic collector and the banner |

No `webRequest`, no remote endpoints, no analytics.

---

## Installing

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `focus-nudge` folder.

## Testing the full loop quickly

1. Open the extension's **Settings** and click the invisible 22×22 hotspot immediately to the
   right of the "Focus Nudge" title, then hit **Save**, to turn on debug mode (15-second
   threshold).
2. Visit YouTube and wait — both reminders should fire within ~15 seconds, then repeat.
3. Click the hotspot again and save when you're done.

Worth exercising manually:

- Switch to a docs page → the popup's counter resets to zero.
- Minimize the window or switch to another app → the counter keeps running.
- Sit with no keyboard or mouse input → the counter keeps running.
- Hit Dismiss → no reminders for 1 minute, then a catch-up nudge when it expires.
- Open the service worker inspector from the extensions page, click **terminate**, return to the
  tab → accrued time survives, because it was in session storage rather than worker memory.
- Visit `chrome://settings` → no banner, no console errors.

---

## Settings reference

In regular mode the options page only exposes the two site lists. Everything below is hidden
until debug mode is switched on via the unlabeled hotspot just right of the "Focus Nudge" title.

| Setting | Default | Notes |
| --- | --- | --- |
| Always / never a distraction | empty | One domain per line; subdomains included |
| Debug mode | off | Hidden toggle; reveals the settings below |
| Remind me after | 3 min | Time with the distraction set as the active tab |
| Dismiss length | 1 min | How long a dismissed nudge stays away |
| System notification | on | |
| In-page banner | on | |
| Escalate after 3rd nudge | on | Sticky toast + delayed Dismiss |
| Content heuristics | on | Detect unknown news/video/feed pages |
| Sensitivity cutoff | 3 | |

The popup also offers one-click **Always remind here** / **Never remind here** for the current
site, which is the fast escape hatch when a heuristic gets it wrong. Both buttons are disabled on
locked sites, which can never be exempted.

---

## Known trade-offs

- **Settings use `chrome.storage.sync`**, which carries your lists across signed-in devices but
  has an 8 KB per-item quota. A blocklist of a few hundred domains would need to move to `local`.
- **The heuristic cutoff of 3 is an initial guess**, not a tuned value. Watch for false positives
  in the first few days and adjust.
- **Time accrues whenever a distracting page is the active tab**, even if you have walked away
  from the machine. The 150-second flush cap keeps a sleeping laptop from being billed, but an
  awake machine left on Reddit will keep counting.
- **YouTube is treated as distracting wholesale**, including tutorials. The popup's
  "Never remind here" is the intended workaround rather than per-video classification.
- **Firefox is out of scope** — it would need a `browser.*` polyfill and has MV3 divergences.
