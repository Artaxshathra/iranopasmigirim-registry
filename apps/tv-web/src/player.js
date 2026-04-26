'use strict';

// ============================================================================
// INRTV TV web app — playback core
//
// Forked from extensions/inrtv/src/player.js with extension-specific bits
// stripped (chrome.runtime messaging, popup-window minimize, mouse-driven
// idle, PiP, fullscreen). Smart-TV apps run fullscreen by definition and are
// driven entirely from a remote, so the input model is keyboard/D-pad only.
//
// When the playback logic changes here OR in the extension, diff both files —
// they share an origin and should stay in sync until we extract a shared core.
// ============================================================================

const STREAM_URL = 'https://hls.irannrtv.live/hls/stream.m3u8';

// Tunables — keep behavior together so it's easy to read and adjust.
const MAX_FATAL_RETRIES = 5;
const RETRY_DELAY_MS = 2000;
const BRANDING_FADE_DELAY_MS = 5000;
const NATIVE_TIMEOUT_MS = 20000;

const video = document.getElementById('video');
const overlayError = document.getElementById('overlay-error');
const errorMsg = document.getElementById('error-msg');
const overlayLoading = document.getElementById('overlay-loading');
const brandingEl = document.getElementById('branding');

let hls = null;
let retryTimer = null;
let brandingTimer = null;
let nativeTimeout = null;
let fatalRetries = 0;
let mediaRetries = 0;

// --- Init ---

function init() {
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    loadHls(STREAM_URL);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    loadNative(STREAM_URL);
  } else {
    showError('This TV does not support HLS playback.');
    return;
  }
  setupKeyboard();
  setupBrandingFade();
}

// --- Stream loading ---

function loadHls(url) {
  hls = new Hls({
    // Worker disabled to mirror the extension's CSP-pinned posture: keeps
    // a single audited execution path for hls.js across both surfaces.
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
    safePlay();
    hideLoading();
  });

  hls.on(Hls.Events.ERROR, function (_event, data) {
    if (!data.fatal) return;
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        if (fatalRetries >= MAX_FATAL_RETRIES) {
          showError('Network unavailable. Please check your connection.');
          return;
        }
        fatalRetries++;
        showError('Network error. Retrying...');
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(function () {
          retryTimer = null;
          if (!hls) return;
          hls.startLoad();
        }, RETRY_DELAY_MS);
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        // Cap recovery attempts — without it, a wedged decoder on a weak TV
        // chip would loop forever and leave "Recovering..." on screen with
        // no exit. Counter resets on FRAG_LOADED so a transient glitch
        // doesn't poison the budget for the rest of the session.
        if (mediaRetries >= MAX_FATAL_RETRIES) {
          showError('Playback failed. Please restart the app.');
          return;
        }
        mediaRetries++;
        showError('Media error. Recovering...');
        hls.recoverMediaError();
        break;
      default:
        showError('Playback failed. Please restart the app.');
        break;
    }
  });

  hls.on(Hls.Events.FRAG_LOADED, function () {
    hideError();
    hideLoading();
    fatalRetries = 0;
    mediaRetries = 0;
  });
}

function loadNative(url) {
  video.src = url;
  // Some TV browsers stall silently on manifest fetch — neither 'canplay' nor
  // 'error' fires. Without this guard the spinner sits forever.
  function clearNativeTimeout() {
    if (nativeTimeout) { clearTimeout(nativeTimeout); nativeTimeout = null; }
  }
  nativeTimeout = setTimeout(function () {
    nativeTimeout = null;
    if (video.readyState < 2) showError('Stream did not start. Please restart the app.');
  }, NATIVE_TIMEOUT_MS);
  video.addEventListener('canplay', function () {
    clearNativeTimeout();
    hideError();
    hideLoading();
    safePlay();
  }, { once: true });
  video.addEventListener('error', function () {
    clearNativeTimeout();
    showError('Playback error. Please restart the app.');
  }, { once: true });
}

function safePlay() { video.play().catch(function () {}); }

// --- Audio-only mode (TV equivalent of the extension's "radio mode") ---

function isAudioOnly() { return document.body.classList.contains('audio-only'); }

function setAudioOnly(on) {
  document.body.classList.toggle('audio-only', on);
  video.setAttribute('aria-label', on ? 'INRTV live audio' : 'INRTV live stream');
}

function toggleAudioOnly() { setAudioOnly(!isAudioOnly()); }

function togglePlay() {
  if (video.paused) safePlay();
  else video.pause();
}

function adjustVolume(delta) {
  video.volume = Math.max(0, Math.min(1, video.volume + delta));
  if (video.muted) video.muted = false;
}

// --- Keyboard / D-pad ---
//
// Step 1 maps the bare-minimum keyboard set so the app is testable in a
// browser. Step 2 will add the platform key codes for Tizen/webOS remotes
// (Back, Play, Pause, FF, Rewind, etc.) and the visible focus model.

function setupKeyboard() {
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case ' ':
      case 'Enter':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'a':
        toggleAudioOnly();
        break;
      case 'ArrowUp':
        e.preventDefault();
        adjustVolume(0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        adjustVolume(-0.1);
        break;
    }
  });
}

// --- Branding fade ---

function setupBrandingFade() {
  video.addEventListener('playing', function () {
    brandingTimer = setTimeout(function () {
      brandingTimer = null;
      brandingEl.classList.add('fade');
    }, BRANDING_FADE_DELAY_MS);
  }, { once: true });
}

// --- Overlays ---
// Mutually exclusive: showing one hides the others.

function showError(msg) {
  hideLoading();
  errorMsg.textContent = msg;
  overlayError.hidden = false;
}

function hideError() { overlayError.hidden = true; }
function hideLoading() { overlayLoading.hidden = true; }

// --- Cleanup ---
// Single source of truth for teardown. Anything that schedules async work or
// holds a native resource must be released here.

function destroy() {
  if (retryTimer)    { clearTimeout(retryTimer);     retryTimer = null; }
  if (brandingTimer) { clearTimeout(brandingTimer);  brandingTimer = null; }
  if (nativeTimeout) { clearTimeout(nativeTimeout);  nativeTimeout = null; }
  if (hls)           { hls.destroy(); hls = null; }
}

window.addEventListener('pagehide', destroy);

init();
