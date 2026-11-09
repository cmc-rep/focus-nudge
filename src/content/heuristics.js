// Collects raw DOM signals for the background classifier. Content scripts are classic
// scripts (no ES imports), so message names are string literals shared with the worker.
(() => {
  const SOCIAL_TYPES = ['socialmediaposting', 'discussionforumposting', 'comment'];
  const NEWS_TYPES = [
    'newsarticle',
    'reportagenewsarticle',
    'liveblogposting',
    'article',
    'sportsevent',
    'sportsorganization'
  ];

  function schemaTypes() {
    const found = new Set();
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed;
      try {
        parsed = JSON.parse(node.textContent || '');
      } catch {
        continue;
      }
      const stack = [parsed];
      while (stack.length) {
        const current = stack.pop();
        if (Array.isArray(current)) {
          stack.push(...current);
        } else if (current && typeof current === 'object') {
          const type = current['@type'];
          for (const value of Array.isArray(type) ? type : [type]) {
            if (typeof value === 'string') found.add(value.toLowerCase());
          }
          if (current['@graph']) stack.push(current['@graph']);
        }
      }
    }
    return found;
  }

  function hasBigVideo() {
    for (const video of document.querySelectorAll('video')) {
      const rect = video.getBoundingClientRect();
      if (rect.width >= 320 && rect.height >= 180) return true;
    }
    return false;
  }

  function meta(selector) {
    const node = document.querySelector(selector);
    return node ? (node.getAttribute('content') || '').trim().toLowerCase() : '';
  }

  function collect() {
    const types = schemaTypes();
    return {
      ogType: meta('meta[property="og:type"]'),
      schemaNews: NEWS_TYPES.some((type) => types.has(type)),
      schemaVideo: types.has('videoobject'),
      schemaSocial: SOCIAL_TYPES.some((type) => types.has(type)),
      newsKeywords: Boolean(document.querySelector('meta[name="news_keywords"]')),
      publishedTime: Boolean(
        document.querySelector('meta[property="article:published_time"], time[datetime]')
      ),
      feedRole: Boolean(document.querySelector('[role="feed"], [aria-label*="feed" i]')),
      bigVideo: hasBigVideo(),
      articleCount: document.querySelectorAll('article').length,
      codeBlocks: document.querySelectorAll('pre code, pre.highlight').length,
      formFields: document.querySelectorAll('input:not([type="hidden"]), textarea, select').length
    };
  }

  function report() {
    let signals;
    try {
      signals = collect();
    } catch {
      return;
    }
    // Worker may be mid-restart; a dropped report is re-requested on the next navigation.
    chrome.runtime
      .sendMessage({ type: 'fn:signals', url: location.href, signals })
      .catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'fn:rescore') report();
  });

  report();
})();
