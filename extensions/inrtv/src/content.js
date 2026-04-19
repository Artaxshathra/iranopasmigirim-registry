/* Content script (ISOLATED world) — detects streams via DOM + PerformanceObserver */
'use strict';

var reported = {};

function reportStream(url, source) {
  if (reported[url]) return;

  // blob: → signal that a player exists (real URL comes from network interception)
  if (url.startsWith('blob:')) {
    reported[url] = true;
    chrome.runtime.sendMessage({
      type: 'STREAM_FOUND',
      data: {
        url: url,
        type: 'blob',
        cdn: null,
        origin: null,
        isManifest: false,
        source: source,
        detectedAt: Date.now(),
      },
    });
    return;
  }

  // StreamUtils is loaded before content.js via manifest js array
  if (!StreamUtils.isStreamUrl(url)) return;

  reported[url] = true;
  var info = StreamUtils.buildStreamInfo(url);
  info.source = source;
  chrome.runtime.sendMessage({ type: 'STREAM_FOUND', data: info });
}

// --- 1. PerformanceObserver for network requests ---

function scanPerfEntries(entries) {
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.initiatorType === 'xmlhttprequest' ||
        e.initiatorType === 'fetch' ||
        e.initiatorType === 'video' ||
        e.initiatorType === 'other') {
      reportStream(e.name, 'network');
    }
  }
}

try {
  scanPerfEntries(performance.getEntriesByType('resource'));
  var perfObserver = new PerformanceObserver(function (list) {
    scanPerfEntries(list.getEntries());
  });
  perfObserver.observe({ type: 'resource', buffered: false });
} catch (e) {
  // PerformanceObserver may not see page resources from isolated world — OK
}

// --- 2. DOM observer for <video> elements ---

function checkVideo(video) {
  var src = video.currentSrc || video.src;
  if (src) reportStream(src, 'video-element');

  var sources = video.querySelectorAll('source');
  for (var i = 0; i < sources.length; i++) {
    if (sources[i].src) reportStream(sources[i].src, 'source-element');
  }
}

function scanVideos() {
  var videos = document.querySelectorAll('video');
  for (var i = 0; i < videos.length; i++) checkVideo(videos[i]);
}

scanVideos();

var domObserver = new MutationObserver(function (mutations) {
  for (var m = 0; m < mutations.length; m++) {
    var added = mutations[m].addedNodes;
    for (var n = 0; n < added.length; n++) {
      var node = added[n];
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.tagName === 'VIDEO') checkVideo(node);
      else if (node.querySelectorAll) {
        var nested = node.querySelectorAll('video');
        for (var v = 0; v < nested.length; v++) checkVideo(nested[v]);
      }
    }
  }
});

domObserver.observe(document.documentElement, { childList: true, subtree: true });

// --- 3. Listen for messages from inject.js (MAIN world) ---

window.addEventListener('message', function (event) {
  if (event.source !== window) return;
  if (!event.data || !event.data.__inrtv) return;
  reportStream(event.data.url, 'intercepted');
});

// --- 4. Periodic re-scan (catches src changes after load) ---

setInterval(scanVideos, 3000);
