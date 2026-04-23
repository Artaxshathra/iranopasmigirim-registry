'use strict';

// Stream URL — single source of truth (also in manifest.json host_permissions)
const STREAM_URL = 'https://hls.irannrtv.live/hls/stream.m3u8';

const video = document.getElementById('video');
const btnPlay = document.getElementById('btn-play');
const btnMute = document.getElementById('btn-mute');
const volumeSlider = document.getElementById('volume');
const btnPip = document.getElementById('btn-pip');
const btnFs = document.getElementById('btn-fs');
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
let fatalRetries = 0;
const MAX_FATAL_RETRIES = 5;

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
        setTimeout(function () { hls.startLoad(); }, 2000);
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
  if (level) {
    if (level.width && level.height) parts.push(level.width + 'x' + level.height);
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

  // Hide branding after 5 seconds of playback
  video.addEventListener('playing', function () {
    setTimeout(function () { brandingEl.classList.add('fade'); }, 5000);
  }, { once: true });
}

function setupKeyboard() {
  document.addEventListener('keydown', function (e) {
    // Don't hijack browser shortcuts (Ctrl+F find, Cmd+P print, etc.)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Help overlay dismisses on any key
    if (!overlayHelp.hidden && e.key !== '?') { hideHelp(); return; }

    switch (e.key) {
      case ' ': case 'k': e.preventDefault(); togglePlay(); break;
      case 'm': toggleMute(); break;
      case 'f': toggleFullscreen(); break;
      case 'p': togglePip(); break;
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

function togglePip() {
  if (document.pictureInPictureElement) document.exitPictureInPicture();
  else video.requestPictureInPicture().catch(function () {});
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else playerContainer.requestFullscreen();
}

// --- Overlays ---

function showError(msg) {
  errorMsg.textContent = msg;
  overlayError.hidden = false;
}

function hideError() { overlayError.hidden = true; }
function hideLoading() { overlayLoading.hidden = true; }

function showPlayPrompt() {
  hideLoading();
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

// --- Idle auto-hide (controls + branding fade after 3s of inactivity) ---

let idleTimer = null;
function wake() {
  document.body.classList.remove('idle');
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(function () {
    if (!video.paused) document.body.classList.add('idle');
  }, 3000);
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

window.addEventListener('pagehide', function () {
  if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  if (hls) { hls.destroy(); hls = null; }
});

init();
