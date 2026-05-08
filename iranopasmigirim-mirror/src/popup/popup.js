// Popup UI. The popup is short-lived (closes on any blur, refreshed every
// time the icon is clicked) so we don't need any state machine — fetch
// status once on open, listen for live updates while open, and re-render
// from the latest snapshot.

import { TARGET_HOST, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, SERVE_PATH } from '../config.js';

const $ = (id) => document.getElementById(id);

const els = {
  statusValue: $('status-value'),
  lastSync:    $('last-sync'),
  fileCount:   $('file-count'),
  size:        $('size'),
  progress:    $('progress'),
  progressBar: $('progress-bar'),
  progressText:$('progress-text'),
  error:       $('error'),
  syncBtn:     $('sync-now'),
  openSite:    $('open-site'),
  targetHost:  $('target-host'),
  repoSource:  $('repo-source'),
};

// Static labels — these come from config and never change at runtime.
els.targetHost.textContent = TARGET_HOST;
els.repoSource.textContent = `${GITHUB_OWNER}/${GITHUB_REPO}@${GITHUB_BRANCH}`;
// "Open mirror" — direct link into the extension origin so the user can
// confirm content is being served. Anchored at SERVE_PATH so the SW
// fetch handler is in scope.
els.openSite.href = chrome.runtime.getURL(SERVE_PATH);

// Render status into the DOM. Pure function of the snapshot; called both
// on initial load and on every status-update broadcast.
function render(s) {
  if (!s) return;
  const state = s.storageFull ? 'warn' : (s.state || 'idle');
  els.statusValue.className = 'status-value ' + classForState(state);
  els.statusValue.textContent = labelForState(state);

  els.lastSync.textContent = formatLastSync(s.lastSyncAt);
  els.fileCount.textContent = (s.fileCount || 0).toLocaleString();
  els.size.textContent = formatBytes(s.bytes || 0);

  if (s.progress && s.progress.total > 0) {
    els.progress.hidden = false;
    const pct = Math.min(100, Math.round((s.progress.done / s.progress.total) * 100));
    els.progressBar.style.width = pct + '%';
    els.progressText.textContent = `${s.progress.done} / ${s.progress.total}`;
  } else {
    els.progress.hidden = true;
  }

  if (s.storageFull) {
    els.error.hidden = false;
    els.error.textContent = 'Local storage is full. Free space and sync again.';
  } else if (state === 'error' && s.lastError) {
    els.error.hidden = false;
    els.error.textContent = s.lastError;
  } else {
    els.error.hidden = true;
  }

  els.syncBtn.disabled = state === 'syncing';
}

function classForState(state) {
  switch (state) {
    case 'ok':      return 'ok';
    case 'syncing': return 'busy';
    case 'error':   return 'err';
    case 'warn':    return 'warn';
    default:        return '';
  }
}
function labelForState(state) {
  switch (state) {
    case 'ok':      return 'up to date';
    case 'syncing': return 'syncing…';
    case 'error':   return 'error';
    case 'warn':    return 'storage full';
    default:        return 'idle';
  }
}

function formatLastSync(ts) {
  if (!ts) return 'never';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000)        return 'just now';
  if (diff < 3_600_000)     return Math.floor(diff / 60_000) + ' min ago';
  if (diff < 86_400_000)    return Math.floor(diff / 3_600_000) + ' h ago';
  return new Date(ts).toLocaleDateString();
}

function formatBytes(b) {
  if (b < 1024)            return b + ' B';
  if (b < 1024 * 1024)     return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 ** 3)       return (b / 1024 / 1024).toFixed(1) + ' MB';
  if (b < 1024 ** 4)       return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  return (b / 1024 / 1024 / 1024 / 1024).toFixed(2) + ' TB';
}

// Wire up the manual sync button. We don't render optimistically — the SW
// will broadcast a 'syncing' status update within milliseconds of receiving
// the message, and that's what flips the UI. If sendMessage rejects (rare),
// the catch path surfaces it.
els.syncBtn.addEventListener('click', () => {
  els.syncBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'sync-now' }, (resp) => {
    if (chrome.runtime.lastError) {
      els.error.hidden = false;
      els.error.textContent = chrome.runtime.lastError.message;
      els.syncBtn.disabled = false;
      return;
    }
    if (resp && !resp.ok) {
      els.error.hidden = false;
      els.error.textContent = resp.error || 'sync failed';
    }
    // No `else` — the status broadcast will re-enable the button.
  });
});

// Live updates from the SW.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'status-update' && msg.status) {
    render(extendStats(msg.status));
  }
});

// Initial fetch. The SW message handler returns the full snapshot
// (including aggregated cache stats) in one round trip.
chrome.runtime.sendMessage({ type: 'status' }, (resp) => {
  if (chrome.runtime.lastError) {
    render({ state: 'error', lastError: chrome.runtime.lastError.message });
    return;
  }
  render(resp);
});

// Status broadcasts from sync.js do NOT include cache stats (cheaper to
// emit) — fold the most recent stats we know about into incoming updates
// so the UI doesn't briefly show "—" mid-sync.
let lastFullStats = { fileCount: 0, bytes: 0 };
function extendStats(s) {
  if (typeof s.fileCount === 'number') lastFullStats.fileCount = s.fileCount;
  if (typeof s.bytes === 'number')     lastFullStats.bytes = s.bytes;
  return { ...lastFullStats, ...s };
}
