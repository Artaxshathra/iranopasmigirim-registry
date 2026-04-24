'use strict';

const STREAM_URL = 'https://hls.irannrtv.live/hls/stream.m3u8';

// Tunables — keep behavior together so it's easy to read and adjust.
const MAX_FATAL_RETRIES = 5;
const RETRY_DELAY_MS = 2000;
const IDLE_TIMEOUT_MS = 3000;
const BRANDING_FADE_DELAY_MS = 5000;

const video = document.getElementById('video');
const btnPlay = document.getElementById('btn-play');
const btnMute = document.getElementById('btn-mute');
const volumeSlider = document.getElementById('volume');
const btnPip = document.getElementById('btn-pip');
const btnFs = document.getElementById('btn-fs');
const btnRadio = document.getElementById('btn-radio');
const overlayError = document.getElementById('overlay-error');
const errorMsg = document.getElementById('error-msg');
const overlayLoading = document.getElementById('overlay-loading');
const overlayPlay = document.getElementById('overlay-play');
const overlayHelp = document.getElementById('overlay-help');
const playerContainer = document.getElementById('player-container');
const statsEl = document.getElementById('stats');
const brandingEl = document.getElementById('branding');

let hls = null;
let statsInterval = null;
let retryTimer = null;
let idleTimer = null;
let fatalRetries = 0;

// --- Init ---

function init() {
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    loadHls(STREAM_URL);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    loadNative(STREAM_URL);
  } else {
    showError('Your browser does not support HLS playback.');
    return;
  }
  setupControls();
  setupKeyboard();
  setupMessaging();
  if (new URLSearchParams(location.search).get('radio') === '1') setRadio(true);
}

function setupMessaging() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (msg && msg.type === 'set-radio') {
      setRadio(!!msg.on);
      sendResponse({ ok: true });
    }
  });
}

// --- Stream loading ---

function loadHls(url) {
  hls = new Hls({
    // Worker disabled: MV3 CSP forbids "blob:" in worker-src, and hls.js spawns
    // its worker from a blob URL. Main-thread demuxing is fine for a single 720p stream.
    enableWorker: false,
    lowLatencyMode: true,
    fragLoadingMaxRetry: 30,
    fragLoadingMaxRetryTimeout: 15000,
    manifestLoadingMaxRetry: 30,
    manifestLoadingMaxRetryTimeout: 15000,
    levelLoadingMaxRetry: 30,
    levelLoadingMaxRetryTimeout: 15000,
    startFragPrefetch: true,
    backBufferLength: 8,
    maxBufferLength: 10,
    liveSyncDurationCount: 3,
    maxLiveSyncPlaybackRate: 1.5,
  });

  hls.loadSource(url);
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, function () {
    video.play().catch(showPlayPrompt);
    hideLoading();
    startStats();
  });

  hls.on(Hls.Events.ERROR, function (_event, data) {
    if (!data.fatal) return;
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        if (fatalRetries >= MAX_FATAL_RETRIES) {
          showError('Network unavailable. Try refreshing (F5).');
          return;
        }
        fatalRetries++;
        showError('Network error. Retrying...');
        // Track the timer so destroy() can cancel it; guard the callback in case
        // hls was torn down between the schedule and the fire.
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(function () {
          retryTimer = null;
          if (!hls) return;
          hls.startLoad();
        }, RETRY_DELAY_MS);
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        showError('Media error. Recovering...');
        hls.recoverMediaError();
        break;
      default:
        showError('Playback failed. Try refreshing (F5).');
        break;
    }
  });

  hls.on(Hls.Events.FRAG_LOADED, function () {
    hideError();
    hideLoading();
    fatalRetries = 0;
  });
}

function loadNative(url) {
  video.src = url;
  video.addEventListener('canplay', function () {
    hideError();
    hideLoading();
    video.play().catch(showPlayPrompt);
  }, { once: true });
  video.addEventListener('error', function () {
    showError('Playback error. Check the stream URL.');
  });
}

// --- Stats ---

function startStats() {
  statsInterval = setInterval(updateStats, 2000);
  updateStats();
}

function updateStats() {
  if (!hls) return;
  const level = hls.levels && hls.levels[hls.currentLevel];
  const parts = [];
  const radioOn = document.body.classList.contains('radio');
  if (level) {
    if (!radioOn && level.width && level.height) parts.push(level.width + 'x' + level.height);
    if (level.bitrate) parts.push(Math.round(level.bitrate / 1000) + ' kbps');
  }
  const buf = getBufferHealth();
  if (buf !== null) parts.push(buf.toFixed(1) + 's buf');
  statsEl.textContent = parts.join(' · ');
}

function getBufferHealth() {
  if (!video.buffered || video.buffered.length === 0) return null;
  const end = video.buffered.end(video.buffered.length - 1);
  return end - video.currentTime;
}

// --- Controls ---

function setupControls() {
  btnPlay.addEventListener('click', togglePlay);
  btnMute.addEventListener('click', toggleMute);

  volumeSlider.addEventListener('input', function () {
    video.volume = parseFloat(volumeSlider.value);
    video.muted = false;
    updateMuteIcon();
  });

  video.addEventListener('volumechange', function () {
    volumeSlider.value = video.muted ? 0 : video.volume;
    updateMuteIcon();
  });

  btnPip.addEventListener('click', togglePip);
  btnFs.addEventListener('click', toggleFullscreen);
  btnRadio.addEventListener('click', toggleRadio);
  playerContainer.addEventListener('dblclick', function (e) {
    if (e.target.closest('#controls')) return;
    toggleFullscreen();
  });

  video.addEventListener('play', function () {
    btnPlay.setAttribute('data-state', 'playing');
    btnPlay.setAttribute('aria-label', 'Pause');
    hidePlayPrompt();
  });
  video.addEventListener('pause', function () {
    btnPlay.setAttribute('data-state', 'paused');
    btnPlay.setAttribute('aria-label', 'Play');
  });

  if (!document.pictureInPictureEnabled) btnPip.hidden = true;

  video.addEventListener('playing', function () {
    setTimeout(function () { brandingEl.classList.add('fade'); }, BRANDING_FADE_DELAY_MS);
  }, { once: true });
}

function setupKeyboard() {
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (!overlayHelp.hidden && e.key !== '?') { hideHelp(); return; }

    switch (e.key) {
      case ' ': case 'k': e.preventDefault(); togglePlay(); break;
      case 'm': toggleMute(); break;
      case 'f': toggleFullscreen(); break;
      case 'p': togglePip(); break;
      case 'r': toggleRadio(); break;
      case '?': e.preventDefault(); toggleHelp(); break;
      case 'ArrowUp':
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.1);
        volumeSlider.value = video.volume;
        if (video.muted) { video.muted = false; updateMuteIcon(); }
        break;
      case 'ArrowDown':
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        volumeSlider.value = video.volume;
        if (video.muted) { video.muted = false; updateMuteIcon(); }
        break;
    }
  });
}

function showHelp() { overlayHelp.hidden = false; }
function hideHelp() { overlayHelp.hidden = true; }
function toggleHelp() { overlayHelp.hidden ? showHelp() : hideHelp(); }

function safePlay() { video.play().catch(function () {}); }

function togglePlay() {
  if (video.paused) safePlay();
  else video.pause();
}

function toggleMute() {
  video.muted = !video.muted;
  updateMuteIcon();
}

function updateMuteIcon() {
  btnMute.setAttribute('data-state', video.muted ? 'muted' : 'unmuted');
  btnMute.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
}

function isRadioOn() { return document.body.classList.contains('radio'); }

function togglePip() {
  if (isRadioOn()) return;
  if (document.pictureInPictureElement) document.exitPictureInPicture();
  else video.requestPictureInPicture().catch(function () {});
}

function toggleFullscreen() {
  if (isRadioOn()) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else playerContainer.requestFullscreen();
}

function setRadio(on) {
  document.body.classList.toggle('radio', on);
  btnRadio.setAttribute('data-state', on ? 'on' : 'off');
  const nextAction = on ? 'Switch to video' : 'Switch to radio';
  btnRadio.setAttribute('aria-label', nextAction);
  btnRadio.setAttribute('title', nextAction + ' (r)');
  video.setAttribute('aria-label', on ? 'INRTV live audio' : 'INRTV live stream');
  if (on && document.fullscreenElement) document.exitFullscreen();
  setWindowState(on ? 'minimized' : 'normal');
}

function toggleRadio() { setRadio(!isRadioOn()); }

function isFirefox() {
  return typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent);
}

// Minimize the popup window so "radio mode" feels like a radio (no floating
// video window). Uses chrome.windows on the extension's own window — no
// permission required. On Firefox we open the player as a tab (see popup.js),
// and tabs don't minimize — so skip this path cleanly.
function setWindowState(state) {
  if (isFirefox()) return;
  if (typeof chrome === 'undefined' || !chrome.windows) return;
  chrome.windows.getCurrent(function (win) {
    if (!win || chrome.runtime.lastError) return;
    const update = state === 'minimized'
      ? { state: 'minimized' }
      : { state: 'normal', focused: true };
    chrome.windows.update(win.id, update, function () { void chrome.runtime.lastError; });
  });
}

// --- Overlays ---
// Mutually exclusive: showing one hides the others so the user never sees a
// stacked spinner-behind-error or a play-prompt over a loading state.

function showError(msg) {
  hideLoading();
  hidePlayPrompt();
  errorMsg.textContent = msg;
  overlayError.hidden = false;
}

function hideError() { overlayError.hidden = true; }
function hideLoading() { overlayLoading.hidden = true; }

function showPlayPrompt() {
  hideLoading();
  hideError();
  overlayPlay.hidden = false;
}

function hidePlayPrompt() { overlayPlay.hidden = true; }

overlayPlay.addEventListener('click', safePlay);

overlayPlay.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    safePlay();
  }
});

overlayHelp.addEventListener('click', hideHelp);

// --- Idle auto-hide (controls + branding fade after inactivity) ---

function wake() {
  document.body.classList.remove('idle');
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(function () {
    if (!video.paused) document.body.classList.add('idle');
  }, IDLE_TIMEOUT_MS);
}
playerContainer.addEventListener('mousemove', wake);
playerContainer.addEventListener('mouseleave', function () {
  if (idleTimer) clearTimeout(idleTimer);
  if (!video.paused) document.body.classList.add('idle');
});
video.addEventListener('pause', function () {
  document.body.classList.remove('idle');
  if (idleTimer) clearTimeout(idleTimer);
});
wake();

// --- Cleanup ---
// Single source of truth for teardown. Anything that schedules async work or
// holds a native resource must be released here.

function destroy() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  if (hls) { hls.destroy(); hls = null; }
}

window.addEventListener('pagehide', destroy);

init();
