'use strict';

var STREAM_URL = 'https://hls.irannrtv.live/hls/stream.m3u8';
var SITE_URL = 'https://iranopasmigirim.com/en/iran-national-revolution-tv';

var statusEl = document.getElementById('status');
var btnWatch = document.getElementById('btn-watch');
var btnM3u = document.getElementById('btn-m3u');
var btnCopy = document.getElementById('btn-copy');
var btnSite = document.getElementById('btn-site');
var detectedEl = document.getElementById('detected');
var detectedLabel = document.getElementById('detected-label');
var btnToggle = document.getElementById('btn-toggle');
var streamList = document.getElementById('stream-list');

var detectedStreams = [];

async function init() {
  statusEl.textContent = 'Ready';

  // Check for detected streams on the active tab
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab = tabs[0];
  if (tab && tab.id != null) {
    var key = 'tab_' + tab.id;
    var data = await chrome.storage.session.get(key);
    var raw = Object.values(data[key] || {});
    detectedStreams = StreamUtils.sortStreams(StreamUtils.deduplicateStreams(raw));

    var manifests = detectedStreams.filter(function (s) { return s.isManifest; });
    var segments = detectedStreams.filter(function (s) { return !s.isManifest && s.type !== 'blob'; });

    if (manifests.length > 0 || segments.length > 0) {
      detectedEl.hidden = false;
      var parts = [];
      if (manifests.length > 0) parts.push(manifests.length + ' stream' + (manifests.length > 1 ? 's' : ''));
      if (segments.length > 0) parts.push(segments.length + ' segment' + (segments.length > 1 ? 's' : ''));
      detectedLabel.textContent = 'Detected: ' + parts.join(', ');
      statusEl.textContent = manifests.length > 0 ? 'Stream detected' : 'Ready';

      // Build list (manifests only, segments are noise)
      if (manifests.length > 0) {
        streamList.innerHTML = '';
        for (var i = 0; i < manifests.length; i++) {
          streamList.appendChild(createCard(manifests[i]));
        }
      }
    }
  }
}

function createCard(stream) {
  var card = document.createElement('div');
  card.className = 'stream-card';
  var cdnLabel = stream.cdn || 'Self-hosted';
  card.innerHTML =
    '<div class="stream-meta">' +
      '<span class="stream-type">' + (stream.type || '?').toUpperCase() + '</span>' +
      '<span class="stream-cdn">' + cdnLabel + '</span>' +
    '</div>' +
    '<div class="stream-url" title="' + escapeAttr(stream.url) + '">' + truncate(stream.url, 50) + '</div>' +
    '<div class="stream-actions">' +
      '<button class="btn btn-primary btn-sm btn-card-watch">▶ Watch</button>' +
      '<button class="btn btn-secondary btn-sm btn-card-copy">Copy</button>' +
    '</div>';

  card.querySelector('.btn-card-watch').addEventListener('click', function () {
    openPlayer(stream);
  });
  card.querySelector('.btn-card-copy').addEventListener('click', function () {
    copyText(stream.url, card.querySelector('.btn-card-copy'));
  });
  return card;
}

// --- Actions ---

btnWatch.addEventListener('click', function () {
  // Use detected manifest if available, otherwise use known URL
  var manifests = detectedStreams.filter(function (s) { return s.isManifest; });
  if (manifests.length > 0) {
    openPlayer(manifests[0]);
  } else {
    openPlayer(StreamUtils.buildStreamInfo(STREAM_URL));
  }
});

btnM3u.addEventListener('click', function () {
  var manifests = detectedStreams.filter(function (s) { return s.isManifest; });
  var url = manifests.length > 0 ? manifests[0].url : STREAM_URL;
  copyText(StreamUtils.formatM3u('INRTV Live', url), btnM3u);
});

btnCopy.addEventListener('click', function () {
  var manifests = detectedStreams.filter(function (s) { return s.isManifest; });
  var url = manifests.length > 0 ? manifests[0].url : STREAM_URL;
  copyText(url, btnCopy);
});

btnSite.addEventListener('click', function () {
  chrome.tabs.create({ url: SITE_URL });
});

btnToggle.addEventListener('click', function () {
  var show = streamList.hidden;
  streamList.hidden = !show;
  btnToggle.textContent = show ? 'Hide ▴' : 'Show ▾';
});

// --- Helpers ---

async function openPlayer(stream) {
  await chrome.storage.session.set({ playerStream: stream });
  chrome.windows.create({ url: 'player.html', type: 'popup', width: 960, height: 560 });
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(function () {
    var orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = orig; }, 1500);
  });
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function truncate(s, max) {
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}

init();
