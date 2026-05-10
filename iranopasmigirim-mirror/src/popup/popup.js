import { SERVE_PATH } from '../config.js';

const $ = (id) => document.getElementById(id);

const els = {
  configSection: $('config-section'),
  repoUrlInput: $('repo-url-input'),
  repoUrlSaveBtn: $('repo-url-save-btn'),
  configError: $('config-error'),
  configMessage: $('config-message'),

  statusSection: $('status-section'),
  statusValue: $('status-value'),
  lastSync: $('last-sync'),
  fileCount: $('file-count'),
  size: $('size'),
  progress: $('progress'),
  progressBar: $('progress-bar'),
  progressText: $('progress-text'),
  error: $('error'),
  syncBtn: $('sync-now'),
  openSite: $('open-site'),
  repoSource: $('repo-source'),
};

els.openSite.href = chrome.runtime.getURL(SERVE_PATH);

async function init() {
  const userRepoUrl = await getStoredRepoUrl();
  if (userRepoUrl) {
    els.configSection.hidden = true;
    els.statusSection.hidden = false;
    els.repoUrlInput.value = userRepoUrl;
    els.repoSource.textContent = userRepoUrl;
    requestStatusUpdate();
    return;
  }

  els.configSection.hidden = false;
  els.statusSection.hidden = true;
  els.repoSource.textContent = 'not configured';
}

function getStoredRepoUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get('userRepoUrl', (result) => {
      const value = result && result.userRepoUrl ? String(result.userRepoUrl).trim() : '';
      resolve(value || null);
    });
  });
}

function isValidGitHubUrl(url) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/i.test(url)
    || /^git@github\.com:[^/]+\/[^/]+(?:\.git)?$/i.test(url);
}

function hideConfigMessages() {
  els.configError.hidden = true;
  els.configError.textContent = '';
  els.configMessage.hidden = true;
  els.configMessage.textContent = '';
}

els.repoUrlSaveBtn.addEventListener('click', async () => {
  hideConfigMessages();
  const url = String(els.repoUrlInput.value || '').trim();

  if (!url) {
    els.configError.hidden = false;
    els.configError.textContent = 'Please enter a GitHub repository URL.';
    return;
  }
  if (!isValidGitHubUrl(url)) {
    els.configError.hidden = false;
    els.configError.textContent = 'Invalid URL. Use https://github.com/owner/repo or git@github.com:owner/repo.git';
    return;
  }

  try {
    await new Promise((resolve) => chrome.storage.local.set({ userRepoUrl: url }, resolve));
    els.configMessage.hidden = false;
    els.configMessage.textContent = 'Saved. Starting sync from this repository.';
    els.repoSource.textContent = url;
    els.configSection.hidden = true;
    els.statusSection.hidden = false;
    requestStatusUpdate();
  } catch (e) {
    els.configError.hidden = false;
    els.configError.textContent = `Failed to save: ${(e && e.message) || e}`;
  }
});

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
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'status-update' && msg.status) {
    render(extendStats(msg.status));
  }
});

let lastFullStats = { fileCount: 0, bytes: 0 };
function extendStats(s) {
  if (typeof s.fileCount === 'number') lastFullStats.fileCount = s.fileCount;
  if (typeof s.bytes === 'number') lastFullStats.bytes = s.bytes;
  return { ...lastFullStats, ...s };
}

function requestStatusUpdate() {
  chrome.runtime.sendMessage({ type: 'status' }, (resp) => {
    if (chrome.runtime.lastError) {
      render({ state: 'error', lastError: chrome.runtime.lastError.message });
      return;
    }
    render(resp);
  });
}

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
    case 'ok': return 'ok';
    case 'syncing': return 'busy';
    case 'error': return 'err';
    case 'warn': return 'warn';
    default: return '';
  }
}

function labelForState(state) {
  switch (state) {
    case 'ok': return 'up to date';
    case 'syncing': return 'syncing...';
    case 'error': return 'error';
    case 'warn': return 'storage full';
    default: return 'idle';
  }
}

function formatLastSync(ts) {
  if (!ts) return 'never';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return new Date(ts).toLocaleDateString();
}

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b < 1024 ** 4) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(b / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`;
}

init().catch((e) => {
  console.error('[popup] init failed', e && e.message);
});
