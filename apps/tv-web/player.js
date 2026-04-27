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
const MAX_FATAL_RETRIES = 8;
const RETRY_DELAY_MS = 2000;
// After exhausting fast retries, slow-poll the origin so a viewer who left
// the TV on overnight wakes up to a reconnected stream. Capped to spare the
// origin from a fleet of TVs hammering it during an outage.
const COLD_RETRY_DELAY_MS = 30000;
const BRANDING_FADE_DELAY_MS = 5000;
const NATIVE_TIMEOUT_MS = 20000;
// Idle-hide for the control bar. Longer than a mouse cursor would warrant
// because remote presses are slower and viewers expect the chrome to linger.
const IDLE_HIDE_MS = 8000;
// Splash stays on screen until first frame, but cap the wait so a broken
// stream still surfaces the loading/error overlay instead of black.
const SPLASH_MAX_MS = 8000;
// LIVE badge fades to dim once the viewer has settled in (mirrors branding).
const LIVE_BADGE_DIM_DELAY_MS = 12000;

const video = document.getElementById('video');
const overlayError = document.getElementById('overlay-error');
const errorMsg = document.getElementById('error-msg');
const overlayLoading = document.getElementById('overlay-loading');
const brandingEl = document.getElementById('branding');
const liveBadge = document.getElementById('live-badge');
const splashEl = document.getElementById('splash');
const controlBar = document.getElementById('control-bar');
const btnPlay = document.getElementById('btn-play');
const btnAudio = document.getElementById('btn-audio');

let hls = null;
let retryTimer = null;
let coldRetryTimer = null;
let brandingTimer = null;
let liveDimTimer = null;
let splashTimer = null;
let nativeTimeout = null;
let idleTimer = null;
let fatalRetries = 0;
let mediaRetries = 0;
let coldRetrying = false;

// --- i18n ---
//
// Tiny localization layer: load _locales/<lang>/messages.json (the same
// schema we use in the extension), apply translations to every element with
// a data-i18n key, and set <html lang/dir> so RTL flips correctly. Falls
// back to English silently — the page is fully usable without translations.

const I18N = {
  current: 'en',
  messages: {},
};

function pickLocale() {
  // Prefer Tizen's per-app preference when available (set in TV settings),
  // then the browser's navigator.language. Strip region (fa-IR → fa).
  let lang = 'en';
  try {
    if (typeof tizen !== 'undefined' && tizen.systeminfo) {
      // Synchronous locale read isn't exposed; fall back to navigator.
    }
  } catch (_) { /* not on Tizen */ }
  const nav = (navigator.language || 'en').toLowerCase();
  if (nav.startsWith('fa')) lang = 'fa';
  return lang;
}

function applyTranslations() {
  const els = document.querySelectorAll('[data-i18n]');
  for (const el of els) {
    const key = el.getAttribute('data-i18n');
    const msg = I18N.messages[key];
    if (msg && msg.message) el.textContent = msg.message;
  }
}

function loadLocale(lang, done) {
  // Same-origin XHR: avoids the fetch() polyfill question on older Tizen
  // firmware and keeps the CSP surface to script-src 'self' only.
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '_locales/' + lang + '/messages.json', true);
  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      try { I18N.messages = JSON.parse(xhr.responseText); } catch (_) {}
    }
    done();
  };
  xhr.onerror = done;
  xhr.send();
}

function setupI18n(done) {
  const lang = pickLocale();
  I18N.current = lang;
  document.documentElement.setAttribute('lang', lang);
  if (lang === 'fa') document.documentElement.setAttribute('dir', 'rtl');
  loadLocale(lang, function () {
    applyTranslations();
    done();
  });
}

// --- Init ---

function init() {
  setupI18n(function () {
    setupSplash();
    setupBadge();
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      loadHls(STREAM_URL);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      loadNative(STREAM_URL);
    } else {
      hideSplash();
      showError(t('errNoHls', 'This TV does not support HLS playback.'));
      return;
    }
    setupKeyboard();
    setupControlBar();
    setupBrandingFade();
    registerPlatformKeys();
  });
}

function t(key, fallback) {
  const m = I18N.messages[key];
  return (m && m.message) || fallback;
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
          enterColdRetry();
          return;
        }
        fatalRetries++;
        showError(t('errNetwork', 'Reconnecting…'));
        scheduleRetry(RETRY_DELAY_MS);
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        // Cap recovery attempts — without it, a wedged decoder on a weak TV
        // chip would loop forever and leave "Recovering..." on screen with
        // no exit. Counter resets on FRAG_LOADED so a transient glitch
        // doesn't poison the budget for the rest of the session.
        if (mediaRetries >= MAX_FATAL_RETRIES) {
          showError(t('errMedia', 'Playback failed. Please restart the app.'));
          return;
        }
        mediaRetries++;
        showError(t('errRecovering', 'Recovering…'));
        hls.recoverMediaError();
        break;
      default:
        showError(t('errFatal', 'Playback failed. Please restart the app.'));
        break;
    }
  });

  hls.on(Hls.Events.FRAG_LOADED, function () {
    hideError();
    hideLoading();
    fatalRetries = 0;
    mediaRetries = 0;
    coldRetrying = false;
    if (coldRetryTimer) { clearTimeout(coldRetryTimer); coldRetryTimer = null; }
  });
}

function scheduleRetry(delay) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(function () {
    retryTimer = null;
    if (!hls) return;
    hls.startLoad();
  }, delay);
}

// "Cold retry" — fast retries are exhausted (origin is genuinely down or the
// TV is offline). Show a "Stream offline" state and slow-poll. Reentrant:
// each tick re-checks; FRAG_LOADED clears the timer when the stream returns.
function enterColdRetry() {
  coldRetrying = true;
  showError(t('errOffline', 'Stream is offline. Retrying…'));
  scheduleColdRetry();
}

function scheduleColdRetry() {
  if (coldRetryTimer) clearTimeout(coldRetryTimer);
  coldRetryTimer = setTimeout(function () {
    coldRetryTimer = null;
    if (!hls) return;
    fatalRetries = 0;
    hls.startLoad();
    // If this attempt also fails, ERROR handler will re-enter cold retry.
    scheduleColdRetry();
  }, COLD_RETRY_DELAY_MS);
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
    if (video.readyState < 2) showError(t('errStuck', 'Stream did not start. Please restart the app.'));
  }, NATIVE_TIMEOUT_MS);
  video.addEventListener('canplay', function () {
    clearNativeTimeout();
    hideError();
    hideLoading();
    safePlay();
  }, { once: true });
  video.addEventListener('error', function () {
    clearNativeTimeout();
    showError(t('errPlayback', 'Playback error. Please restart the app.'));
  }, { once: true });
}

function safePlay() { video.play().catch(function () {}); }

// --- Splash ---
//
// Bridges the gap between Tizen's platform splash (gone the moment the
// WebView paints) and the first decoded frame. Hidden on first 'playing',
// or after SPLASH_MAX_MS so a broken stream still surfaces the error UI.

function setupSplash() {
  if (!splashEl) return;
  splashTimer = setTimeout(hideSplash, SPLASH_MAX_MS);
  video.addEventListener('playing', hideSplash, { once: true });
}

function hideSplash() {
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  if (splashEl && !splashEl.classList.contains('fade')) {
    splashEl.classList.add('fade');
  }
}

// --- LIVE badge ---
// Visible on first frame, then dims so it doesn't compete with the picture.

function setupBadge() {
  if (!liveBadge) return;
  video.addEventListener('playing', function () {
    if (liveDimTimer) clearTimeout(liveDimTimer);
    liveDimTimer = setTimeout(function () {
      liveDimTimer = null;
      liveBadge.classList.add('dim');
    }, LIVE_BADGE_DIM_DELAY_MS);
  }, { once: true });
}

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
    const label = playing ? t('btnPause', 'Pause') : t('btnPlay', 'Play');
    btnPlay.querySelector('.ctrl-label').textContent = label;
    btnPlay.setAttribute('aria-label', label);
  }
  // Localize the audio-only button label too (initial render is English).
  btnAudio.querySelector('.ctrl-label').textContent = t('btnAudioOnly', 'Audio only');
  btnAudio.setAttribute('aria-label', t('btnAudioOnly', 'Audio only'));
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
  if (retryTimer)     { clearTimeout(retryTimer);     retryTimer = null; }
  if (coldRetryTimer) { clearTimeout(coldRetryTimer); coldRetryTimer = null; }
  if (brandingTimer)  { clearTimeout(brandingTimer);  brandingTimer = null; }
  if (liveDimTimer)   { clearTimeout(liveDimTimer);   liveDimTimer = null; }
  if (splashTimer)    { clearTimeout(splashTimer);    splashTimer = null; }
  if (nativeTimeout)  { clearTimeout(nativeTimeout);  nativeTimeout = null; }
  if (idleTimer)      { clearTimeout(idleTimer);      idleTimer = null; }
  if (hls)            { hls.destroy(); hls = null; }
}

window.addEventListener('pagehide', destroy);

init();
