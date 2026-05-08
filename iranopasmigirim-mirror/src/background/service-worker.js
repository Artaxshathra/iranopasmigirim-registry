// Top-level entry. The MV3 service worker is event-driven: it spins up on
// install, on alarm, on fetch, on message — runs briefly — and is killed.
// Module-level state does not survive between activations, so any state
// the next activation needs has to go through IndexedDB or chrome.storage.
//
// We keep this file thin: routing only. All real work lives in the modules
// it imports, where it can be tested independently.

import { syncOnce, fullStatus, onStatus, nextDelayMinutes } from './sync.js';
import { serve } from './serve.js';
import { POLL_INTERVAL_MINUTES, TARGET_HOST, SERVE_PATH } from '../config.js';

const ALARM_NAME = 'mirror-poll';

// On install: run sync immediately so the user sees content on first open
// instead of an empty cache. Also schedule the alarm — chrome.alarms
// survives SW restarts, so this only needs to run once per install. Also
// install the dynamic DNR rule that turns top-level navigation to the real
// host into a redirect to chrome-extension://<id>/site/...
chrome.runtime.onInstalled.addListener(async () => {
  try { await installRedirectRule(); }
  catch (e) { console.warn('[mirror] DNR rule install failed', e && e.message); }
  try { await schedule(POLL_INTERVAL_MINUTES); } catch (_) {}
  // Kick off the first sync but don't wait on it — onInstalled has a
  // limited budget and the SW will be torn down regardless.
  syncOnce().catch((e) => console.warn('[mirror] initial sync failed', e && e.message));
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
    await syncOnce();
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

// Install (or refresh) a single dynamic DNR rule that redirects top-level
// navigation to TARGET_HOST into the extension origin. Static rules can't
// know the extension ID at build time, so we register dynamically.
//
// We blow away rule id 1 first to ensure idempotency: re-installing the
// extension or upgrading the version must not leave duplicate rules.
const REDIRECT_RULE_ID = 1;
async function installRedirectRule() {
  const extOrigin = chrome.runtime.getURL('').replace(/\/$/, ''); // chrome-extension://<id>
  const rule = {
    id: REDIRECT_RULE_ID,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        // \1 captures everything after the host so /a/b?q=1 ends up at
        // <ext>/site/a/b?q=1 — the SW fetch handler then resolves that
        // path against IndexedDB.
        regexSubstitution: `${extOrigin}${SERVE_PATH}\\1`,
      },
    },
    condition: {
      regexFilter: `^https?://(?:www\\.)?${escapeReHost(TARGET_HOST)}/(.*)$`,
      // main_frame catches typed URLs and bookmarks; sub_frame catches
      // iframes that might embed the site. We deliberately do NOT redirect
      // resourceTypes like image/script/xhr — those would only originate
      // from a page already on TARGET_HOST, which can't happen because
      // top-level navigation is always intercepted first.
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  };
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [REDIRECT_RULE_ID],
    addRules: [rule],
  });
}

function escapeReHost(host) {
  return host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Popup ↔ SW message channel. We deliberately use sendMessage rather than
// a long-lived port: the SW is killable at any moment, and a short
// request/response is reliable across restarts.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  switch (msg.type) {
    case 'status': {
      fullStatus().then(sendResponse).catch((e) =>
        sendResponse({ state: 'error', lastError: e && e.message }));
      return true; // async response
    }
    case 'sync-now': {
      syncOnce({ force: true })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e && e.message }));
      return true;
    }
    default:
      return false;
  }
});

// Fetch interception — only fires for requests to our own extension origin.
// declarativeNetRequest (configured in the manifest) is what redirects
// top-level navigation to TARGET_HOST into chrome-extension://<id>/site/...,
// at which point this handler takes over.
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  // Quick string check before the URL parse to keep the hot path fast on
  // every popup asset, every page resource, every nav.
  if (!url.includes('/site/')) return;
  event.respondWith(serveOrPassThrough(url));
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
