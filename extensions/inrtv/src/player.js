'use strict';

// Stream URL — single source of truth (also in manifest.json host_permissions)
var STREAM_URL = 'https://hls.irannrtv.live/hls/stream.m3u8';

var video = document.getElementById('video');
var btnPlay = document.getElementById('btn-play');
var btnMute = document.getElementById('btn-mute');
var volumeSlider = document.getElementById('volume');
var btnPip = document.getElementById('btn-pip');
var btnFs = document.getElementById('btn-fs');
var overlayError = document.getElementById('overlay-error');
var errorMsg = document.getElementById('error-msg');
var overlayLoading = document.getElementById('overlay-loading');
var statsEl = document.getElementById('stats');
var brandingEl = document.getElementById('branding');

var hls = null;
var statsInterval = null;

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
    enableWorker: true,
    lowLatencyMode: true,
    fragLoadingMaxRetry: 30,
    fragLoadingMaxRetryTimeout: 15000,
    manifestLoadingMaxRetry: 30,
    manifestLoadingMaxRetryTimeout: 15000,
    levelLoadingMaxRetry: 30,
    levelLoadingMaxRetryTimeout: 15000,
    startFragPrefetch: true,
    backBufferLength: 30,
  });

  hls.loadSource(url);
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, function () {
    video.play().catch(function () {});
    hideLoading();
    startStats();
  });

  hls.on(Hls.Events.ERROR, function (_event, data) {
    if (!data.fatal) return;
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
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
  });
}

function loadNative(url) {
  video.src = url;
  video.addEventListener('canplay', function () {
    hideError();
    hideLoading();
  });
  video.addEventListener('canplay', function () {
    video.play().catch(function () {});
    hideLoading();
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
  var level = hls.levels && hls.levels[hls.currentLevel];
  var parts = [];
  if (level) {
    if (level.width && level.height) parts.push(level.width + 'x' + level.height);
    if (level.bitrate) parts.push(Math.round(level.bitrate / 1000) + ' kbps');
  }
  var buf = getBufferHealth();
  if (buf !== null) parts.push(buf.toFixed(1) + 's buf');
  statsEl.textContent = parts.join(' · ');
}

function getBufferHealth() {
  if (!video.buffered || video.buffered.length === 0) return null;
  var end = video.buffered.end(video.buffered.length - 1);
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

  btnPip.addEventListener('click', togglePip);
  btnFs.addEventListener('click', toggleFullscreen);

  video.addEventListener('play', function () {
    btnPlay.textContent = '⏸';
    btnPlay.setAttribute('aria-label', 'Pause');
  });
  video.addEventListener('pause', function () {
    btnPlay.textContent = '▶';
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
    switch (e.key) {
      case ' ': case 'k': e.preventDefault(); togglePlay(); break;
      case 'm': toggleMute(); break;
      case 'f': toggleFullscreen(); break;
      case 'p': togglePip(); break;
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

function togglePlay() {
  if (video.paused) video.play().catch(function () {});
  else video.pause();
}

function toggleMute() {
  video.muted = !video.muted;
  updateMuteIcon();
}

function updateMuteIcon() {
  btnMute.textContent = video.muted ? '🔇' : '🔊';
  btnMute.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
}

function togglePip() {
  if (document.pictureInPictureElement) document.exitPictureInPicture();
  else video.requestPictureInPicture().catch(function () {});
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
}

// --- Overlays ---

function showError(msg) {
  errorMsg.textContent = msg;
  overlayError.hidden = false;
}

function hideError() { overlayError.hidden = true; }
function hideLoading() { overlayLoading.hidden = true; }

// --- Cleanup ---

window.addEventListener('pagehide', function () {
  if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  if (hls) { hls.destroy(); hls = null; }
});

init();
