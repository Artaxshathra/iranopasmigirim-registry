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

  registrationSection: $('registration-section'),
  requestedUrlInput: $('requested-url-input'),
  createRequestBtn: $('create-request-btn'),
  refreshRegistrationBtn: $('refresh-registration-btn'),
  registrationMessage: $('registration-message'),
  registrationError: $('registration-error'),
  registryState: $('registry-state'),
  ownershipState: $('ownership-state'),
  deliveryState: $('delivery-state'),
  step1Meta: $('step1-meta'),
  step1Content: $('step1-content'),
  step2Meta: $('step2-meta'),
  step2Content: $('step2-content'),
};

els.openSite.href = chrome.runtime.getURL(`${SERVE_PATH}index.html`);

let lastFullStats = { fileCount: 0, bytes: 0 };
let currentRepoUrl = null;
let currentRegistration = null;

init().catch((e) => {
  console.error('[popup] init failed', e && e.message);
  render({ state: 'error', lastError: (e && e.message) || String(e) });
});

async function init() {
  const userRepoUrl = await getStoredRepoUrl();
  currentRepoUrl = userRepoUrl;
  if (userRepoUrl) {
    showConfiguredUi(userRepoUrl);
    await loadRegistrationState();
    requestStatusUpdate();
    return;
  }

  showUnconfiguredUi();
}

function showConfiguredUi(repoUrl) {
  els.configSection.hidden = true;
  els.statusSection.hidden = false;
  els.registrationSection.hidden = false;
  els.repoUrlInput.value = repoUrl;
  els.repoSource.textContent = repoUrl;
}

function showUnconfiguredUi() {
  els.configSection.hidden = false;
  els.statusSection.hidden = true;
  els.registrationSection.hidden = true;
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

function hideRegistrationMessages() {
  els.registrationError.hidden = true;
  els.registrationError.textContent = '';
  els.registrationMessage.hidden = true;
  els.registrationMessage.textContent = '';
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
    await setStorage({ userRepoUrl: url });
    currentRepoUrl = url;
    showConfiguredUi(url);
    els.configMessage.hidden = false;
    els.configMessage.textContent = 'Saved. You can now create a registration request.';
    hideRegistrationMessages();
    await loadRegistrationState();
    requestStatusUpdate();
  } catch (e) {
    els.configError.hidden = false;
    els.configError.textContent = `Failed to save: ${(e && e.message) || e}`;
  }
});

els.createRequestBtn.addEventListener('click', async () => {
  hideRegistrationMessages();
  const requestedUrl = String(els.requestedUrlInput.value || '').trim();

  if (!currentRepoUrl) {
    els.registrationError.hidden = false;
    els.registrationError.textContent = 'Configure your GitHub repo first.';
    return;
  }
  if (!requestedUrl) {
    els.registrationError.hidden = false;
    els.registrationError.textContent = 'Enter a requested website URL.';
    return;
  }

  els.createRequestBtn.disabled = true;
  try {
    const resp = await sendMessage({
      type: 'registration-create',
      payload: {
        userRepoUrl: currentRepoUrl,
        requestedUrl,
      },
    });
    if (!resp || !resp.ok) {
      throw new Error(resp && resp.error ? resp.error : 'Failed to create registration request');
    }
    currentRegistration = resp.draft || null;
    renderRegistration(resp.draft, resp.instructions);
    els.registrationMessage.hidden = false;
    els.registrationMessage.textContent = 'Request package created. Complete both commits, then refresh state.';
  } catch (e) {
    els.registrationError.hidden = false;
    els.registrationError.textContent = (e && e.message) || String(e);
  } finally {
    els.createRequestBtn.disabled = false;
  }
});

els.refreshRegistrationBtn.addEventListener('click', async () => {
  hideRegistrationMessages();
  els.refreshRegistrationBtn.disabled = true;
  try {
    const resp = await sendMessage({ type: 'registration-refresh' });
    if (!resp || !resp.ok) {
      throw new Error(resp && resp.error ? resp.error : 'Failed to refresh registration state');
    }
    currentRegistration = resp.draft || null;
    renderRegistration(resp.draft, resp.instructions);
    els.registrationMessage.hidden = false;
    els.registrationMessage.textContent = 'Registration state refreshed from GitHub.';
  } catch (e) {
    els.registrationError.hidden = false;
    els.registrationError.textContent = (e && e.message) || String(e);
  } finally {
    els.refreshRegistrationBtn.disabled = false;
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

async function loadRegistrationState() {
  const resp = await sendMessage({ type: 'registration-get' });
  if (!resp || !resp.ok) {
    throw new Error(resp && resp.error ? resp.error : 'Unable to load registration state');
  }
  currentRegistration = resp.draft || null;
  renderRegistration(resp.draft, resp.instructions);
}

function renderRegistration(draft, instructions) {
  if (!draft) {
    els.registryState.textContent = 'not started';
    els.ownershipState.textContent = 'not verified';
    els.deliveryState.textContent = 'not ready';
    els.step1Meta.textContent = '-';
    els.step1Content.value = '';
    els.step2Meta.textContent = '-';
    els.step2Content.value = '';
    return;
  }

  if (!els.requestedUrlInput.value) {
    els.requestedUrlInput.value = draft.requestedUrl || '';
  }

  const regState = draft.registry && draft.registry.state ? draft.registry.state : 'pending';
  els.registryState.textContent = regState;
  els.ownershipState.textContent = draft.ownership && draft.ownership.verified ? 'verified' : 'not verified';

  if (draft.delivery && draft.delivery.ready) {
    const commitSha = draft.delivery.commitSha ? draft.delivery.commitSha.slice(0, 8) : 'ready';
    els.deliveryState.textContent = `ready (${commitSha})`;
  } else {
    els.deliveryState.textContent = 'not ready';
  }

  if (instructions && instructions.step1) {
    els.step1Meta.textContent = `${instructions.step1.repoUrl} @ ${instructions.step1.branch} → ${instructions.step1.path}`;
    els.step1Content.value = instructions.step1.content || '';
  }
  if (instructions && instructions.step2) {
    els.step2Meta.textContent = `${instructions.step2.repoUrl} @ ${instructions.step2.branch} → ${instructions.step2.path}`;
    els.step2Content.value = instructions.step2.content || '';
  }
}

function render(s) {
  if (!s) return;
  const state = s.storageFull ? 'warn' : (s.state || 'idle');
  els.statusValue.className = 'status-value ' + classForState(state);
  els.statusValue.textContent = labelForState(state);

  els.lastSync.textContent = formatLastSync(s.lastSyncAt);
  els.fileCount.textContent = (s.fileCount || 0).toLocaleString();
  els.size.textContent = formatBytes(s.bytes || 0);
  const entryPath = String(s.entryPath || '').replace(/^\/+/, '') || 'index.html';
  els.openSite.href = chrome.runtime.getURL(`${SERVE_PATH}${entryPath}`);

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

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}

function setStorage(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}
