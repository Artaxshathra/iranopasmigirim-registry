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
// Splash stays on screen until first frame, but cap the wait so a broken
// stream still surfaces the loading/error overlay instead of black.
const SPLASH_MAX_MS = 8000;
// LIVE badge fades to dim once the viewer has settled in (mirrors branding).
const LIVE_BADGE_DIM_DELAY_MS = 12000;
// Buffering overlay debounce: brief stalls (a single dropped fragment) self-
// recover in <500 ms; only show the spinner if the stall persists. Without
// this, the overlay flickers on every minor jitter and feels broken.
const BUFFERING_DEBOUNCE_MS = 600;
// Manual retry rate-limit: keeps a viewer mashing OK from hammering the
// origin during an outage. One real retry per window; intermediate presses
// are no-ops with no visible change (already showing "Retrying…").
const MANUAL_RETRY_COOLDOWN_MS = 3000;
// Transient state pill: visible for this long after a play/pause toggle.
// Long enough to register, short enough to clear the picture quickly.
const STATE_PILL_HIDE_MS = 1400;
// Resume-on-return: when the TV wakes from sleep or the user comes back from
// another app, hls.js's internal recovery is sloppy — the viewer sees ~10s of
// black, then catch-up at low quality. If we haven't seen a fragment in this
// long, force startLoad() and snap to live edge on the next pageshow/visible.
const RESUME_STALENESS_MS = 30000;
// pageshow + visibilitychange occasionally both fire on the same wake event;
// don't run a second stopLoad/startLoad inside this window.
const RESUME_DEBOUNCE_MS = 60000;
// Slow-connection subtitle: the LIVE badge whispers "slow connection" if
// hls.js stays pinned to the lowest quality level for this long. Quiet,
// truthful status — never an alert.
const SLOW_CONNECTION_DEBOUNCE_MS = 30000;

const video = document.getElementById('video');
const overlayError = document.getElementById('overlay-error');
const errorMsg = document.getElementById('error-msg');
const overlayLoading = document.getElementById('overlay-loading');
const brandingEl = document.getElementById('branding');
const liveBadge = document.getElementById('live-badge');
const splashEl = document.getElementById('splash');
const statePill = document.getElementById('state-pill');
const statePillIconPlay = document.getElementById('state-pill-icon-play');
const statePillIconPause = document.getElementById('state-pill-icon-pause');

let hls = null;
let retryTimer = null;
let coldRetryTimer = null;
let brandingTimer = null;
let liveDimTimer = null;
let splashTimer = null;
let nativeTimeout = null;
let bufferingTimer = null;
let statePillTimer = null;
let statePillFadeTimer = null;
let prewarmXhr = null;
let fatalRetries = 0;
let mediaRetries = 0;
let lastManualRetryAt = 0;
let lastResumeAt = 0;
// Wall-clock timestamp of the last loaded fragment. Resume logic uses this
// to decide whether the player has gone stale during a sleep/background.
let lastFragLoadedAt = 0;
let slowConnectionTimer = null;
// Suppress the very first play event's pill — autoplay-on-first-frame is
// not a state change the viewer initiated; flashing "▶" at startup is noise.
let firstPlayHandled = false;

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
  // Tizen's SystemInfo.locale is async-only; we'd have to defer the whole
  // init() chain to honor it. Stick with navigator.language (which Tizen
  // populates from the TV's language setting on app launch). Strip region
  // (fa-IR / fa-AF → fa).
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('fa') ? 'fa' : 'en';
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

// Pre-warm the stream connection in parallel with i18n locale loading.
// The TLS handshake + manifest fetch typically takes 200-600ms on a TV;
// firing this XHR before setupI18n lets hls.js's later request hit the
// HTTP cache and skip both the handshake and the manifest round-trip.
// If anything throws (e.g. older Tizen with quirky XHR), we silently fall
// back to the normal cold-start path — no behavioral regression possible.
function prewarmStream() {
  try {
    prewarmXhr = new XMLHttpRequest();
    prewarmXhr.open('GET', STREAM_URL, true);
    // Drop the reference once it finishes so destroy() doesn't bother
    // aborting an already-completed request.
    prewarmXhr.onloadend = function () { prewarmXhr = null; };
    // No event handlers needed: the value is in the connection pool +
    // HTTP cache as a side effect of the request completing. We don't
    // care about the response body here.
    prewarmXhr.send();
  } catch (_) { prewarmXhr = null; /* prewarm is best-effort */ }
}

function init() {
  prewarmStream();
  setupI18n(function () {
    setupSplash();
    setupBadge();
    setupBuffering();
    setupStatePill();
    setupResume();
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
    // No lowLatencyMode: this is a TV channel, not a sportsbook. LL mode
    // starts close to the live edge and rate-ramps to catch up, which
    // produced an audible audio judder during the first ~3 s on Tizen.
    // Conservative segment-based timing eliminates the glitch.
    fragLoadingMaxRetry: 6,
    fragLoadingMaxRetryTimeout: 8000,
    manifestLoadingMaxRetry: 6,
    manifestLoadingMaxRetryTimeout: 8000,
    levelLoadingMaxRetry: 6,
    levelLoadingMaxRetryTimeout: 8000,
    startFragPrefetch: true,
    backBufferLength: 8,
    maxBufferLength: 12,
    // 4 segments of headroom: weak TV SoCs occasionally hiccup on a single
    // fragment; 3 was enough to start but left no slack for recovery.
    liveSyncDurationCount: 4,
    // Soft catch-up: 1.1× is inaudible to viewers but still corrects drift.
    maxLiveSyncPlaybackRate: 1.1,
  });

  hls.loadSource(url);
  hls.attachMedia(video);

  // Listeners are kept as named functions so destroy() can hls.off() them.
  // Without explicit unsubscribes, a stray late event firing into a half-
  // destroyed hls instance throws — rare but ugly when it happens during
  // app shutdown.
  hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
  hls.on(Hls.Events.LEVEL_LOADED, onLevelLoaded);
  hls.on(Hls.Events.ERROR, onHlsError);
  hls.on(Hls.Events.FRAG_LOADED, onFragLoaded);
  hls.on(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);
}

function onManifestParsed() {
  safePlay();
  hideLoading();
}

// Force live edge on first level load. Without this, hls.js can start a few
// segments back from live (the manifest's EXT-X-START or the head of the
// live window), which surfaced as "showing yesterday's content for a few
// seconds before catching up" on cold start.
function onLevelLoaded(_e, data) {
  if (!hls || !data || !data.details || !data.details.live) return;
  const edge = hls.liveSyncPosition;
  if (typeof edge === 'number' && isFinite(edge) &&
      Math.abs(video.currentTime - edge) > 4) {
    try { video.currentTime = edge; } catch (_) {}
  }
}

function onHlsError(_event, data) {
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
      if (hls) hls.recoverMediaError();
      break;
    default:
      showError(t('errFatal', 'Playback failed. Please restart the app.'));
      break;
  }
}

function onFragLoaded() {
  hideError();
  hideLoading();
  fatalRetries = 0;
  mediaRetries = 0;
  lastFragLoadedAt = Date.now();
  if (coldRetryTimer) { clearTimeout(coldRetryTimer); coldRetryTimer = null; }
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

function safePlay() {
  // Swallow the rejection so an autoplay-blocked attempt doesn't bubble
  // an uncaught promise — but still log it. On a TV the console isn't
  // visible to the viewer, but it's the only signal we get when the
  // platform refuses to start playback (rare; usually decoder startup).
  const p = video.play();
  if (p && typeof p.catch === 'function') {
    p.catch(function (err) {
      try { console.warn('[player] video.play() rejected:', err && err.message || err); } catch (_) {}
    });
  }
}

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
//
// Hidden until we have proof we're actually live: 'playing' has fired AND
// hls.js has loaded a fragment. Goes .stale on 'waiting' / errors so the
// pulsing red dot is never on screen while the picture is frozen — that
// would lie to the viewer. Returns to live state on the next 'playing'.
// After a settle delay, the badge dims to ambient so it doesn't compete
// with the picture (still visible, just no longer attention-grabbing).

function showLiveBadge() {
  if (!liveBadge) return;
  liveBadge.hidden = false;
  liveBadge.classList.remove('stale');
}

function markBadgeStale() {
  if (!liveBadge || liveBadge.hidden) return;
  liveBadge.classList.add('stale');
}

function setupBadge() {
  if (!liveBadge) return;
  // Reveal on first 'playing' AND tighten dim after a settle delay.
  video.addEventListener('playing', function () {
    showLiveBadge();
    if (liveDimTimer) clearTimeout(liveDimTimer);
    liveDimTimer = setTimeout(function () {
      liveDimTimer = null;
      liveBadge.classList.add('dim');
    }, LIVE_BADGE_DIM_DELAY_MS);
  });
  // 'waiting' = mid-stream stall. Don't fire dot while frozen.
  video.addEventListener('waiting', markBadgeStale);
}

// --- Slow-connection subtitle ---
//
// When hls.js stays pinned to the lowest quality level for SLOW_CONNECTION
// _DEBOUNCE_MS, whisper "Slow connection" under the LIVE badge. Quiet,
// truthful — no alert, no red. The subtitle is appended/removed in the
// existing badge so we don't introduce a new positioned element.
//
// NOTE: the production stream at STREAM_URL is currently a single-rendition
// media playlist (one bitrate, no master), so hls.levels.length === 1 and
// this code path is dormant. It's kept warm so the moment the origin adds
// a second rendition the behavior lights up without any client change.

function getSlowSubtitle() {
  return liveBadge ? liveBadge.querySelector('.live-slow') : null;
}

function showSlowConnection() {
  if (!liveBadge) return;
  let sub = getSlowSubtitle();
  if (!sub) {
    sub = document.createElement('span');
    sub.className = 'live-slow';
    sub.textContent = t('slowConnection', 'Slow connection');
    liveBadge.appendChild(sub);
  }
}

function hideSlowConnection() {
  if (slowConnectionTimer) { clearTimeout(slowConnectionTimer); slowConnectionTimer = null; }
  const sub = getSlowSubtitle();
  if (sub && sub.parentNode) sub.parentNode.removeChild(sub);
}

function onLevelSwitched(_e, data) {
  // hls.js levels are sorted by bitrate ascending. data.level === 0 is the
  // lowest available rendition. If we drop to 0 and stay there long enough,
  // the connection is genuinely slow — not a single bad fragment.
  if (!hls || !hls.levels || hls.levels.length <= 1) return;
  if (data.level === 0) {
    if (slowConnectionTimer) return; // already counting down
    slowConnectionTimer = setTimeout(function () {
      slowConnectionTimer = null;
      // Re-check at fire-time: hls.js may have switched up while we waited.
      if (hls && hls.currentLevel === 0) showSlowConnection();
    }, SLOW_CONNECTION_DEBOUNCE_MS);
  } else {
    hideSlowConnection();
  }
}

// --- Resume on return ---
//
// When the TV wakes from sleep or the user comes back from another app, the
// app is alive but the stream is N hours behind live. hls.js's internal
// recovery is sloppy (low quality, slow catch-up). A pageshow / visibility
// handler that detects staleness and forces startLoad + snap-to-live makes
// wake-from-sleep feel instantaneous instead of "10s of buffering".

function maybeResume() {
  if (!hls) return;
  // No fragment yet → init is still in flight; nothing to resume.
  if (!lastFragLoadedAt) return;
  const now = Date.now();
  const stale = now - lastFragLoadedAt;
  if (stale < RESUME_STALENESS_MS) return;
  // Debounce: pageshow + visibilitychange occasionally both fire on the same
  // wake event. Without this guard we'd issue stopLoad/startLoad twice in
  // quick succession, which hls.js handles but produces a visible re-buffer.
  if (now - lastResumeAt < RESUME_DEBOUNCE_MS) return;
  lastResumeAt = now;
  // Force a clean reload from the live edge. startLoad(-1) tells hls.js to
  // pick liveSyncPosition; the LEVEL_LOADED handler then snaps currentTime
  // if we're still drifted.
  try {
    hls.stopLoad();
    hls.startLoad(-1);
  } catch (_) { /* hls in a weird state; let normal recovery handle it */ }
}

function setupResume() {
  // pageshow fires when the page is restored from BFCache or wake-from-sleep
  // on TV WebViews. visibilitychange fires when the user switches apps.
  window.addEventListener('pageshow', maybeResume);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') maybeResume();
  });
}

// --- Buffering indicator ---
//
// Mid-stream stalls (a TV briefly losing Wi-Fi, a single fragment that takes
// longer than the buffer to arrive) fire a 'waiting' event. Show the loading
// overlay so the viewer knows the picture isn't broken — but debounce it so
// sub-second hiccups don't flicker the spinner. 'playing' clears it.

function setupBuffering() {
  video.addEventListener('waiting', function () {
    // Don't show buffering UI while an error overlay is up — the error
    // takes precedence and showing both is confusing.
    if (!overlayError.hidden) return;
    if (bufferingTimer) clearTimeout(bufferingTimer);
    bufferingTimer = setTimeout(function () {
      bufferingTimer = null;
      overlayLoading.hidden = false;
    }, BUFFERING_DEBOUNCE_MS);
  });
  video.addEventListener('playing', function () {
    if (bufferingTimer) { clearTimeout(bufferingTimer); bufferingTimer = null; }
    overlayLoading.hidden = true;
  });
}

function togglePlay() {
  if (video.paused) safePlay();
  else video.pause();
}

// Manual retry from the error overlay. Rate-limited so a viewer mashing OK
// during an outage doesn't translate to a flood of startLoad() calls.
function manualRetry() {
  const now = Date.now();
  if (now - lastManualRetryAt < MANUAL_RETRY_COOLDOWN_MS) return;
  lastManualRetryAt = now;
  fatalRetries = 0;
  mediaRetries = 0;
  if (coldRetryTimer) { clearTimeout(coldRetryTimer); coldRetryTimer = null; }
  if (retryTimer)     { clearTimeout(retryTimer);     retryTimer = null; }
  showError(t('errNetwork', 'Reconnecting…'));
  if (hls) hls.startLoad();
  else if (video.canPlayType('application/vnd.apple.mpegurl')) loadNative(STREAM_URL);
}

// --- Transient state pill ---
//
// A glassy badge that flashes for ~1.4 s when play/pause toggles via the
// remote's hardware key. There is no docked control bar; the pill is pure
// feedback that the viewer's press registered. The first 'play' event
// (autoplay on cold start) is suppressed — that's not a viewer-initiated
// state change, just the app coming up.

function setupStatePill() {
  if (!statePill || !statePillIconPlay || !statePillIconPause) return;
  video.addEventListener('play', function () {
    if (!firstPlayHandled) { firstPlayHandled = true; return; }
    flashStatePill('play');
  });
  video.addEventListener('pause', function () {
    if (!firstPlayHandled) return;
    flashStatePill('pause');
  });
}

function flashStatePill(which) {
  if (!statePill || !statePillIconPlay || !statePillIconPause) return;
  // Swap which SVG is visible — vector glyphs stay crisp at any TV scale,
  // unlike font-glyph play/pause characters which render fuzzy on Tizen.
  // Use style.display rather than the [hidden] attribute: older Tizen
  // WebViews don't apply the UA's `[hidden]{display:none}` rule to inline
  // SVG elements, so both icons would render on top of each other.
  const showPlay = which === 'play';
  statePillIconPlay.style.display = showPlay ? '' : 'none';
  statePillIconPause.style.display = showPlay ? 'none' : '';
  // Re-trigger the entry animation by toggling the class off-then-on across
  // a frame boundary; without the reflow the browser collapses both writes.
  statePill.classList.remove('show');
  statePill.hidden = false;
  // eslint-disable-next-line no-void
  void statePill.offsetWidth; // force reflow so the next class add re-plays the transition
  statePill.classList.add('show');
  if (statePillTimer) clearTimeout(statePillTimer);
  if (statePillFadeTimer) { clearTimeout(statePillFadeTimer); statePillFadeTimer = null; }
  statePillTimer = setTimeout(function () {
    statePillTimer = null;
    statePill.classList.remove('show');
    // Wait for the fade-out transition to finish before fully hiding so
    // [hidden]{display:none} doesn't snap the pill out of view mid-fade.
    statePillFadeTimer = setTimeout(function () {
      statePillFadeTimer = null;
      if (statePill) statePill.hidden = true;
    }, 300);
  }, STATE_PILL_HIDE_MS);
}

// --- Keyboard / D-pad ---
//
// Minimal input model — there is no docked control bar, so the keyboard
// handler is a thin map from keys/remote-codes to actions. The TV platform
// owns volume and channel; we only handle play/pause, back/exit, and
// Enter-to-retry on the error overlay.
//
// Two layers: named keys (browser/dev keyboards) and numeric Tizen/webOS
// remote codes whose e.key is not meaningful.
// https://developer.samsung.com/smarttv/develop/guides/user-interaction/keyboardime.html
// https://webostv.developer.lge.com/develop/references/magic-remote
const REMOTE_KEYCODES = {
  415: 'playpause',    // VK_PLAY → treat play and play/pause as one toggle
  19:  'playpause',    // VK_PAUSE → same toggle (TV remotes vary)
  10252: 'playpause',  // combined play/pause on some Tizen remotes
  413: 'stop',         // VK_STOP (live stream → exit)
  461:   'back',       // Tizen VK_BACK
  10009: 'back',       // webOS Back
  8:     'back',       // Backspace fallback for dev
};

function dispatchAction(action, e) {
  switch (action) {
    case 'playpause':
      togglePlay();
      break;
    case 'enter':
      // Error overlay takes precedence: Enter is the documented retry key.
      // Without this, a stuck viewer has no escape from "Stream is offline"
      // besides power-cycling the TV or restarting the app. With no chrome
      // to activate elsewhere, Enter on a normal screen is a no-op.
      if (!overlayError.hidden) manualRetry();
      break;
    case 'back':
      // Always consume Back: otherwise on Tizen the platform's own Back
      // handler also fires and the app exits twice (once via platformExit,
      // once via the platform navigation). With no chrome to dismiss, Back
      // always means "leave the app."
      if (e) e.preventDefault();
      platformExit();
      break;
    case 'stop':
      platformExit();
      break;
  }
}

function setupKeyboard() {
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Layer 2: numeric remote codes. Check first so a Tizen/webOS Back press
    // doesn't accidentally fall through the e.key switch as ''.
    const remoteAction = REMOTE_KEYCODES[e.keyCode];
    if (remoteAction) {
      dispatchAction(remoteAction, e);
      return;
    }

    // Layer 1: named keys for browser/dev keyboards.
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        dispatchAction('playpause', e);
        break;
      case 'Enter':
        e.preventDefault();
        dispatchAction('enter', e);
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
  // Any error means we're not actually live anymore — stop pulsing red.
  markBadgeStale();
}

function hideError() { overlayError.hidden = true; }
function hideLoading() { overlayLoading.hidden = true; }

// --- Cleanup ---
// Single source of truth for teardown. Anything that schedules async work or
// holds a native resource must be released here.

function destroy() {
  if (retryTimer)      { clearTimeout(retryTimer);      retryTimer = null; }
  if (coldRetryTimer)  { clearTimeout(coldRetryTimer);  coldRetryTimer = null; }
  if (brandingTimer)   { clearTimeout(brandingTimer);   brandingTimer = null; }
  if (liveDimTimer)    { clearTimeout(liveDimTimer);    liveDimTimer = null; }
  if (splashTimer)     { clearTimeout(splashTimer);     splashTimer = null; }
  if (nativeTimeout)   { clearTimeout(nativeTimeout);   nativeTimeout = null; }
  if (bufferingTimer)  { clearTimeout(bufferingTimer);  bufferingTimer = null; }
  if (statePillTimer)  { clearTimeout(statePillTimer);  statePillTimer = null; }
  if (statePillFadeTimer) { clearTimeout(statePillFadeTimer); statePillFadeTimer = null; }
  if (slowConnectionTimer) { clearTimeout(slowConnectionTimer); slowConnectionTimer = null; }
  // Best-effort abort: a still-pending prewarm fetch shouldn't outlive the
  // page. If it already finished, abort() is a no-op.
  if (prewarmXhr) { try { prewarmXhr.abort(); } catch (_) {} prewarmXhr = null; }
  if (hls) {
    // Unsubscribe before destroy so a late-firing event into a half-torn-down
    // instance can't throw. Mirrors the on() registrations above.
    try {
      hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
      hls.off(Hls.Events.LEVEL_LOADED, onLevelLoaded);
      hls.off(Hls.Events.ERROR, onHlsError);
      hls.off(Hls.Events.FRAG_LOADED, onFragLoaded);
      hls.off(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);
    } catch (_) { /* hls already partially destroyed */ }
    hls.destroy();
    hls = null;
  }
}

window.addEventListener('pagehide', destroy);

init();
