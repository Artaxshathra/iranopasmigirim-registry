// Top-level entry. The MV3 service worker is event-driven: it spins up on
// install, on alarm, on fetch, on message — runs briefly — and is killed.
// Module-level state does not survive between activations, so any state
// the next activation needs has to go through IndexedDB or chrome.storage.
//
// We keep this file thin: routing only. All real work lives in the modules
// it imports, where it can be tested independently.

import {
  syncOnce,
  fullStatus,
  onStatus,
  nextDelayMinutes,
  runUserRecovery,
} from './sync.js';
import { serve } from './serve.js';
import { fetchJsonFromBranch, fetchTextFromBranch } from './github.js';
import {
  buildCommitInstructions,
  createRegistrationDraft,
  mergeRegistrationRemoteState,
} from './registration.js';
import { POLL_INTERVAL_MINUTES, SERVE_PATH } from '../config.js';

const ALARM_NAME = 'mirror-poll';
const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('/')).origin;
const POPUP_PREFIX = chrome.runtime.getURL('popup/');
const REGISTRATION_KEY = 'registrationDraft';

// On install: run sync immediately so the user sees content on first open
// instead of an empty cache. Also schedule the alarm — chrome.alarms
// survives SW restarts, so this only needs to run once per install.
chrome.runtime.onInstalled.addListener(async () => {
  try { await schedule(POLL_INTERVAL_MINUTES); } catch (_) {}
  // Kick off the first sync but don't wait on it — onInstalled has a
  // limited budget and the SW will be torn down regardless.
  try {
    const result = await syncOnce();
    if (result && result.newContentArrived) {
      await openMirroredSite();
    }
  } catch (e) {
    console.warn('[mirror] initial sync failed', e && e.message);
  }
});

// On startup (browser launch / SW wake): make sure an alarm is registered.
// chrome.alarms persists, but if the user disabled+enabled the extension
// it can get cleared.
chrome.runtime.onStartup.addListener(async () => {
  try { await schedule(POLL_INTERVAL_MINUTES); } catch (_) {}
});

// Alarm tick. Reads the current cooldown (which may have been bumped by
// recent failures) and reschedules afterwards so the cadence reflects
// the latest backoff.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  try {
    const result = await syncOnce();
    if (result && result.newContentArrived) {
      await openMirroredSite();
    }
  } catch (_) {
    // syncOnce already updated status + backoff; nothing further to do.
  }
  try {
    const next = await nextDelayMinutes();
    await schedule(next);
  } catch (_) {}
});

async function schedule(minutes) {
  // chrome.alarms minimum is 1 minute on stable channels. We round up.
  const periodInMinutes = Math.max(1, Math.round(minutes));
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes });
}

// Open a new tab to the mirrored site served in the extension origin.
// Called after a successful sync brings new content.
async function openMirroredSite() {
  try {
    const status = await fullStatus();
    const entryPath = String(status.entryPath || '').replace(/^\/+/, '');
    const tail = entryPath || 'index.html';
    const url = chrome.runtime.getURL(`${SERVE_PATH}${tail}`);
    await chrome.tabs.create({ url, active: true });
  } catch (e) {
    console.warn('[mirror] failed to open mirrored site', e && e.message);
  }
}

// Popup ↔ SW message channel. We deliberately use sendMessage rather than
// a long-lived port: the SW is killable at any moment, and a short
// request/response is reliable across restarts.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  if (sender && sender.id && sender.id !== chrome.runtime.id) return false;
  switch (msg.type) {
    case 'status': {
      fullStatus()
        .then((data) => { try { sendResponse(data); } catch (_) {} })
        .catch((e) => {
          try { sendResponse({ state: 'error', lastError: e && e.message }); }
          catch (_) {}
        });
      return true; // async response
    }
    case 'sync-now': {
      if (!isTrustedSyncSender(sender)) {
        try { sendResponse({ ok: false, error: 'forbidden sender' }); } catch (_) {}
        return false;
      }
      syncOnce({ force: true })
        .then(() => { try { sendResponse({ ok: true }); } catch (_) {} })
        .catch((e) => {
          try { sendResponse({ ok: false, error: e && e.message }); }
          catch (_) {}
        });
      return true;
    }
    case 'storage-recover': {
      if (!isTrustedSyncSender(sender)) {
        try { sendResponse({ ok: false, error: 'forbidden sender' }); } catch (_) {}
        return false;
      }
      Promise.resolve()
        .then(async () => {
          const mode = msg && msg.mode === 'reset' ? 'reset' : 'evict';
          const recovery = await runUserRecovery({ mode });
          return { ok: true, recovery };
        })
        .then((result) => { try { sendResponse(result); } catch (_) {} })
        .catch((e) => {
          try { sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }); }
          catch (_) {}
        });
      return true;
    }
    case 'registration-create': {
      if (!isTrustedSyncSender(sender)) {
        try { sendResponse({ ok: false, error: 'forbidden sender' }); } catch (_) {}
        return false;
      }
      const payload = msg && msg.payload ? msg.payload : {};
      Promise.resolve()
        .then(async () => {
          const draft = createRegistrationDraft({
            userRepoUrl: payload.userRepoUrl,
            requestedUrl: payload.requestedUrl,
          });
          await setLocal({ registrationDraft: draft, userRepoUrl: draft.userRepoUrl });
          return {
            ok: true,
            draft,
            instructions: buildCommitInstructions(draft),
          };
        })
        .then((result) => { try { sendResponse(result); } catch (_) {} })
        .catch((e) => {
          try { sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }); }
          catch (_) {}
        });
      return true;
    }
    case 'registration-get': {
      Promise.resolve()
        .then(async () => {
          const draft = await getLocal(REGISTRATION_KEY);
          if (!draft) return { ok: true, draft: null, instructions: null };
          return { ok: true, draft, instructions: buildCommitInstructions(draft) };
        })
        .then((result) => { try { sendResponse(result); } catch (_) {} })
        .catch((e) => {
          try { sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }); }
          catch (_) {}
        });
      return true;
    }
    case 'registration-refresh': {
      if (!isTrustedSyncSender(sender)) {
        try { sendResponse({ ok: false, error: 'forbidden sender' }); } catch (_) {}
        return false;
      }
      Promise.resolve()
        .then(async () => {
          const draft = await getLocal(REGISTRATION_KEY);
          if (!draft) return { ok: false, error: 'No registration draft found' };

          const registryStatus = await fetchJsonFromBranch(
            draft.registry.repoUrl,
            draft.registry.statusPath,
            draft.registry.branch,
          );

          let proofText = null;
          try {
            proofText = await fetchTextFromBranch(
              draft.userRepoUrl,
              draft.ownership.challengePath,
              draft.ownership.branch,
            );
          } catch (e) {
            if (!(e && e.status === 404)) throw e;
          }

          const nextDraft = mergeRegistrationRemoteState(draft, registryStatus, proofText);
          await setLocal({ registrationDraft: nextDraft, userRepoUrl: nextDraft.userRepoUrl });
          return {
            ok: true,
            draft: nextDraft,
            instructions: buildCommitInstructions(nextDraft),
          };
        })
        .then((result) => { try { sendResponse(result); } catch (_) {} })
        .catch((e) => {
          try { sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }); }
          catch (_) {}
        });
      return true;
    }
    default:
      return false;
  }
});

function isTrustedSyncSender(sender) {
  const url = sender && typeof sender.url === 'string' ? sender.url : '';
  return url.startsWith(POPUP_PREFIX);
}

function getLocal(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result ? result[key] : null);
    });
  });
}

function setLocal(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

// Fetch interception — only fires for requests to our own extension origin.
// The popup and auto-open flow navigate users to chrome-extension://<id>/site/...,
// at which point this handler serves files from IndexedDB.
self.addEventListener('fetch', (event) => {
  let url;
  try { url = new URL(event.request.url); }
  catch (_) { return; }
  if (url.origin !== EXTENSION_ORIGIN) return;
  if (!url.pathname.startsWith(SERVE_PATH)) return;
  event.respondWith(serveOrPassThrough(url.href));
});

async function serveOrPassThrough(url) {
  try {
    const r = await serve(url);
    if (r) return r;
  } catch (e) {
    console.warn('[mirror] serve error', e && e.message);
  }
  return new Response('Not found', { status: 404 });
}

// Status broadcast: when sync.js changes status, push a runtime message so
// any open popup updates without polling. The popup tolerates the message
// not arriving (the SW may be torn down between syncs), but when it does
// arrive the UI animates progress smoothly.
onStatus((s) => {
  try { chrome.runtime.sendMessage({ type: 'status-update', status: s }); }
  catch (_) {} // popup not open — fine.
});
