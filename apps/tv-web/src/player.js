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
// Idle-hide for the control bar. Longer than a mouse cursor would warrant
// because remote presses are slower and viewers expect the chrome to linger.
const IDLE_HIDE_MS = 8000;

const video = document.getElementById('video');
const overlayError = document.getElementById('overlay-error');
const errorMsg = document.getElementById('error-msg');
const overlayLoading = document.getElementById('overlay-loading');
const brandingEl = document.getElementById('branding');
const controlBar = document.getElementById('control-bar');
const btnPlay = document.getElementById('btn-play');
const btnAudio = document.getElementById('btn-audio');

let hls = null;
let retryTimer = null;
let brandingTimer = null;
let nativeTimeout = null;
let idleTimer = null;
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
  setupControlBar();
  setupBrandingFade();
  registerPlatformKeys();
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
  btnAudio.setAttribute('aria-pressed', on ? 'true' : 'false');
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

// --- Control bar (D-pad navigable) ---
//
// Hidden by default. Any remote activity reveals it and resets the idle
// timer. Pressing Back while it's visible just hides it; pressing Back
// while it's already hidden falls through to the platform-exit handler.

function isBarVisible() { return !controlBar.hidden; }

function showBar() {
  if (controlBar.hidden) {
    controlBar.hidden = false;
    // First reveal needs an explicit focus so D-pad input lands somewhere.
    if (!controlBar.contains(document.activeElement)) btnPlay.focus();
  }
  resetIdle();
}

function hideBar() {
  controlBar.hidden = true;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  // Move focus off the now-hidden bar so the next D-pad press triggers
  // showBar() cleanly instead of activating an invisible button.
  if (controlBar.contains(document.activeElement)) document.activeElement.blur();
}

function resetIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(hideBar, IDLE_HIDE_MS);
}

function moveFocus(dir) {
  const buttons = [btnPlay, btnAudio];
  const i = buttons.indexOf(document.activeElement);
  const next = i < 0 ? 0 : (i + dir + buttons.length) % buttons.length;
  buttons[next].focus();
}

function activateFocused() {
  const el = document.activeElement;
  if (!controlBar.contains(el)) return;
  switch (el.dataset.action) {
    case 'play':  togglePlay(); break;
    case 'audio': toggleAudioOnly(); break;
  }
}

function setupControlBar() {
  // Reflect playing/paused state into the play button label so the chrome
  // doesn't lie about what pressing it will do.
  function syncPlayButton() {
    const playing = !video.paused && !video.ended;
    btnPlay.querySelector('.ctrl-icon').textContent = playing ? '⏸' : '▶';
    btnPlay.querySelector('.ctrl-label').textContent = playing ? 'Pause' : 'Play';
    btnPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  video.addEventListener('play', syncPlayButton);
  video.addEventListener('pause', syncPlayButton);
  syncPlayButton();
}

// --- Keyboard / D-pad ---
//
// Two-layer input handling:
//   1. Named keys (e.key)        — normal browsers, dev keyboards.
//   2. Numeric keyCode mapping   — Tizen/webOS remotes whose keys arrive
//                                  without a meaningful e.key.
// Both layers feed the same action handler, so the app behaves identically
// on a laptop and on a TV remote.

// Tizen and webOS share most W3C-standard remote codes; the Back key differs
// slightly across firmware revisions, so we accept every code reported in the
// wild. https://developer.samsung.com/smarttv/develop/guides/user-interaction/keyboardime.html
// https://webostv.developer.lge.com/develop/references/magic-remote
const REMOTE_KEYCODES = {
  // Media transport
  415: 'play',         // VK_PLAY
  19:  'pause',        // VK_PAUSE
  413: 'stop',         // VK_STOP (ignored — live stream, no stop concept)
  10252: 'playpause',  // some Tizen remotes report a combined play/pause
  // Back / exit. 461 = Tizen VK_BACK, 10009 = webOS Back, 8 = Backspace fallback.
  461:   'back',
  10009: 'back',
  8:     'back',
};

function dispatchAction(action, e) {
  switch (action) {
    case 'playpause':
    case 'play':
    case 'pause':
      togglePlay();
      showBar();
      break;
    case 'audio':
      toggleAudioOnly();
      showBar();
      break;
    case 'volup':
      adjustVolume(0.1);
      break;
    case 'voldown':
      adjustVolume(-0.1);
      break;
    case 'left':
      if (isBarVisible()) { moveFocus(-1); resetIdle(); }
      else showBar();
      break;
    case 'right':
      if (isBarVisible()) { moveFocus(1); resetIdle(); }
      else showBar();
      break;
    case 'up':
      if (isBarVisible()) resetIdle();
      else { adjustVolume(0.1); showBar(); }
      break;
    case 'down':
      if (isBarVisible()) resetIdle();
      else { adjustVolume(-0.1); showBar(); }
      break;
    case 'enter':
      if (isBarVisible()) { activateFocused(); resetIdle(); }
      else showBar();
      break;
    case 'back':
      // Bar visible: dismiss it (consume the event so the platform doesn't
      // exit). Bar hidden: fall through to the platform exit handler so the
      // user can leave the app from the player surface, the way TV viewers
      // expect Back to behave.
      if (isBarVisible()) {
        hideBar();
        if (e) e.preventDefault();
      } else {
        platformExit();
      }
      break;
    case 'stop':
      // Live stream — there is nothing to "stop", so treat it as exit.
      platformExit();
      break;
  }
}

function setupKeyboard() {
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Layer 2: numeric remote codes. Check first so a Tizen/webOS Back
    // press doesn't accidentally fall through the e.key switch as ''.
    const remoteAction = REMOTE_KEYCODES[e.keyCode];
    if (remoteAction) {
      dispatchAction(remoteAction, e);
      return;
    }

    // Layer 1: named keys for browser/dev keyboards.
    switch (e.key) {
      case ' ':
      case 'Enter':
      case 'k':
        e.preventDefault();
        dispatchAction('enter', e);
        break;
      case 'a':
        dispatchAction('audio', e);
        break;
      case 'ArrowUp':
        e.preventDefault();
        dispatchAction('up', e);
        break;
      case 'ArrowDown':
        e.preventDefault();
        dispatchAction('down', e);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        dispatchAction('left', e);
        break;
      case 'ArrowRight':
        e.preventDefault();
        dispatchAction('right', e);
        break;
      case 'Backspace':
      case 'Escape':
      case 'GoBack':
        dispatchAction('back', e);
        break;
    }
  });
}

// --- Platform integration ---
//
// Tizen and webOS expose a small set of globals that only exist when the app
// is running inside their respective WebView. Feature-detect at runtime so a
// single build works in a regular browser (where these globals are absent),
// on a Tizen TV, and on a webOS TV.

function registerPlatformKeys() {
  // Tizen requires the app to explicitly subscribe to the media transport
  // keys it cares about; otherwise they bubble to the system TV handler.
  // tizen.* is undefined in browsers and on webOS, so guard everything.
  try {
    if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
      ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop'].forEach(function (k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (_) { /* unsupported on this firmware */ }
      });
    }
  } catch (_) { /* not on Tizen */ }
}

function platformExit() {
  // Try Tizen first, then webOS, then fall back to closing the window
  // (which the platform may or may not honor — there's no universal exit).
  try {
    if (typeof tizen !== 'undefined' && tizen.application) {
      tizen.application.getCurrentApplication().exit();
      return;
    }
  } catch (_) { /* fall through */ }
  try {
    if (typeof webOS !== 'undefined' && webOS.platformBack) {
      webOS.platformBack();
      return;
    }
  } catch (_) { /* fall through */ }
  // Browser fallback: nothing to do. Closing the tab is the user's job.
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
  if (idleTimer)     { clearTimeout(idleTimer);      idleTimer = null; }
  if (hls)           { hls.destroy(); hls = null; }
}

window.addEventListener('pagehide', destroy);

init();
