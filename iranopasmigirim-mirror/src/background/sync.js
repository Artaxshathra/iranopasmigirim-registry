// Sync engine for request-response protocol.
//
// Flow:
//   1. Get user's configured repo URL from storage
//   2. Poll user's repo on CONTENT_BRANCH
//   3. Fetch tip commit + tree SHA
//   4. Verify signature against producer's public key
//   5. If unchanged, exit (tree-SHA short-circuit)
//   6. Recursive tree listing and diff against IndexedDB
//   7. Fetch new/changed files, delete removed files
//   8. Cache everything, emit status updates
//
// Backoff: tracked in meta so it survives SW restarts. Doubles on failure,
// resets to POLL_INTERVAL_MINUTES on success.
//
// User must configure repo URL before sync can run. Repo must exist and have
// content/ branch with signed commits from producer.

import {
  resolvePointer, getTree, fetchRaw, verifyCommit,
} from './github.js';
import {
  listPaths, getFile, putFile, deleteFile, getMeta, putMeta, putMetaBatch, stats, compactFiles,
  clearAll, evictFilesForQuota, listFileEntries,
} from './db.js';
import {
  POLL_INTERVAL_MINUTES, MAX_BACKOFF_MINUTES,
  MAX_FILE_SIZE_BYTES, MAX_FILES_PER_SYNC, MAINTENANCE_INTERVAL_HOURS,
  MIRROR_MANIFEST_PATH, DEFAULT_ENTRY_PATH,
  STORAGE_RECOVERY_TARGET_BYTES, STALE_FILE_TTL_DAYS,
} from '../config.js';

// Single in-flight sync at a time. The alarm can fire while a previous
// sync is still running (slow network); without this guard we'd duplicate
// every fetch and likely run into IndexedDB write contention.
let inFlight = null;

// Public status — popup.js reads this via runtime messaging.
let status = {
  state: 'idle',         // 'idle' | 'syncing' | 'ok' | 'error'
  lastSyncAt: 0,         // epoch ms of last successful sync
  lastError: null,       // string message if state === 'error'
  progress: null,        // {done, total} during 'syncing'
  treeSha: null,
  newContentArrived: false,  // true if latest sync brought new writes
};

const MAINTENANCE_INTERVAL_MS = MAINTENANCE_INTERVAL_HOURS * 60 * 60 * 1000;
const MAX_MANIFEST_SIZE_BYTES = 1024 * 1024;

export function getStatus() { return status; }

export function shouldRunMaintenance(lastMaintenanceAt, now = Date.now()) {
  const last = Number(lastMaintenanceAt || 0);
  if (!Number.isFinite(last) || last <= 0) return true;
  return (now - last) >= MAINTENANCE_INTERVAL_MS;
}

// Listeners are notified on every status change so the popup can re-render
// without polling. We support a small fixed array of listeners — the popup
// is the only consumer in practice.
const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() {
  for (const fn of listeners) {
    try { fn(status); } catch (_) {}
  }
}

function setStatus(patch) {
  status = { ...status, ...patch };
  emit();
}

// Get the user's configured mirror repo URL from storage.
// Returns null if not configured.
async function getUserRepoUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get('userRepoUrl', (result) => {
      resolve(result && result.userRepoUrl ? String(result.userRepoUrl).trim() : null);
    });
  });
}

export async function syncOnce({ force = false } = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    setStatus({ state: 'syncing', lastError: null, progress: { done: 0, total: 0 } });
    try {
      const userRepoUrl = await getUserRepoUrl();
      if (!userRepoUrl) {
        throw new Error('Mirror repo URL not configured. Set it in the extension popup.');
      }

      const registrationDraft = await getRegistrationDraft();
      const commit = await resolvePointer(userRepoUrl);
      const lastSha = await getMeta('treeSha');
      if (!force && commit.treeSha === lastSha) {
        // Nothing changed since last poll. Tree-SHA short-circuit saves bandwidth.
        setStatus({
          state: 'ok',
          lastSyncAt: Date.now(),
          treeSha: commit.treeSha,
          progress: null,
        });
        await putMeta('lastSyncAt', Date.now());
        await runMaintenanceIfDue();
        await resetBackoff();
        return { skipped: true };
      }

      // Verify signature. If verification fails, keep existing cache untouched
      // — a hijacked GitHub account or MitM is exactly the threat model.
      const verdict = await verifyCommit(commit);
      if (!verdict.ok) {
        throw new Error(`signature verification failed: ${verdict.reason}`);
      }

      const expectedSigner = normalizeFingerprint(
        registrationDraft && registrationDraft.delivery
          ? registrationDraft.delivery.producerFingerprint
          : ''
      );
      const actualSigner = normalizeFingerprint(verdict.signerFingerprint || '');
      if (expectedSigner && (!actualSigner || expectedSigner !== actualSigner)) {
        throw new Error('signature verification failed: producer fingerprint mismatch');
      }
      if (!expectedSigner && actualSigner) {
        throw new Error('signature verification failed: producer fingerprint not configured in registration');
      }

      const tree = await getTree(userRepoUrl, commit.treeSha);
      if (tree.length > MAX_FILES_PER_SYNC) {
        throw new Error(`tree has ${tree.length} files, exceeds MAX_FILES_PER_SYNC`);
      }

      const preloadedContent = new Map();
      const manifestMeta = await loadAndValidateSnapshotManifest({
        tree,
        userRepoUrl,
        commitSha: commit.sha,
        preloadedContent,
      });

      const incoming = new Map(tree.map((b) => [b.path, b]));
      const existing = new Set(await listPaths());

      // Categorize: writes (new + sha-changed) and deletes (in DB but not in tree).
      const writes = [];
      for (const blob of tree) {
        if (blob.size > MAX_FILE_SIZE_BYTES) continue;
        const have = await getFile(blob.path);
        if (!have || have.sha !== blob.sha) writes.push(blob);
      }
      const deletes = [];
      for (const path of existing) {
        if (!incoming.has(path)) deletes.push(path);
      }

      setStatus({ progress: { done: 0, total: writes.length } });
      const failedWrites = [];
      let sawQuotaError = false;
      const recoverySummary = { removed: 0, reclaimedBytes: 0 };

      // Sequential download — concurrent fetches would overrun the CDN's
      // rate-limiter (rare but real) and clog the SW's event loop. The
      // sequential cost is fine: the tree-SHA short-circuit means we only
      // hit this path on actual changes. Any write failure keeps treeSha
      // unchanged so the next sync retries missing paths.
      for (let i = 0; i < writes.length; i++) {
        const blob = writes[i];
        let done = false;
        let attemptedRecovery = false;
        try {
          while (!done) {
            const buf = preloadedContent.has(blob.path)
              ? preloadedContent.get(blob.path)
              : await fetchRaw(userRepoUrl, blob.path, commit.sha);
            if (buf.byteLength > MAX_FILE_SIZE_BYTES) {
              throw new Error(`downloaded size exceeds MAX_FILE_SIZE_BYTES for ${blob.path}`);
            }
            const digest = await gitBlobShaHex(buf);
            if (digest !== String(blob.sha || '').toLowerCase()) {
              throw new Error(`blob sha mismatch for ${blob.path}`);
            }
            try {
              await putFile(blob.path, {
                content: buf,
                sha: blob.sha,
                siteHost: manifestMeta.siteHost,
              });
              done = true;
            } catch (e) {
              if (!isQuotaError(e) || attemptedRecovery) {
                throw e;
              }
              attemptedRecovery = true;
              sawQuotaError = true;
              const recovered = await recoverStoragePressure({
                siteHost: manifestMeta.siteHost,
                targetBytes: Math.max(STORAGE_RECOVERY_TARGET_BYTES, Math.ceil(blob.size * 1.5)),
              });
              recoverySummary.removed += recovered.removed;
              recoverySummary.reclaimedBytes += recovered.reclaimedBytes;
              if (recovered.removed <= 0) {
                throw e;
              }
            }
          }
        } catch (e) {
          if (isQuotaError(e)) sawQuotaError = true;
          failedWrites.push(blob.path);
          console.warn('[sync] write failed', blob.path, e && e.message);
        }
        setStatus({ progress: { done: i + 1, total: writes.length } });
      }

      if (failedWrites.length > 0) {
        if (sawQuotaError) await putMeta('storageFull', true);
        throw new Error(`sync incomplete: ${failedWrites.length} file(s) failed`);
      }

      if (recoverySummary.removed > 0) {
        await putMeta('lastRecovery', {
          mode: 'auto-evict',
          removed: recoverySummary.removed,
          reclaimedBytes: recoverySummary.reclaimedBytes,
          at: Date.now(),
        });
      }

      const failedDeletes = [];
      for (const path of deletes) {
        try { await deleteFile(path); }
        catch (e) {
          failedDeletes.push(path);
          console.warn('[sync] delete failed', path, e && e.message);
        }
      }
      if (failedDeletes.length > 0) {
        throw new Error(`delete incomplete: ${failedDeletes.length} file(s) failed`);
      }

      const now = Date.now();
      const hadNewWrites = writes.length > 0;
      await persistActiveSnapshot(manifestMeta, commit.sha);
      await putMetaBatch([
        ['treeSha', commit.treeSha],
        ['lastSyncAt', now],
        ['storageFull', false],
      ]);
      await runMaintenanceIfDue(now);
      await resetBackoff();

      setStatus({
        state: 'ok',
        lastSyncAt: now,
        treeSha: commit.treeSha,
        progress: null,
        newContentArrived: hadNewWrites,
      });
      return { writes: writes.length, deletes: deletes.length, newContentArrived: hadNewWrites };
    } catch (e) {
      const msg = (e && e.message) || String(e);
      setStatus({ state: 'error', lastError: msg, progress: null });
      await bumpBackoff();
      throw e;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function runMaintenanceIfDue(now = Date.now()) {
  const lastMaintenanceAt = await getMeta('lastMaintenanceAt');
  if (!shouldRunMaintenance(lastMaintenanceAt, now)) return;
  try {
    const { removed } = await compactFiles(MAX_FILE_SIZE_BYTES);
    const staleRemoved = await evictStaleFiles(now);
    await putMeta('lastMaintenanceAt', now);
    if (removed > 0) {
      console.warn(`[sync] maintenance removed ${removed} stale file(s)`);
    }
    if (staleRemoved > 0) {
      console.warn(`[sync] maintenance evicted ${staleRemoved} expired file(s)`);
    }
  } catch (e) {
    // Hygiene should never block content availability.
    console.warn('[sync] maintenance failed', e && e.message);
  }
}

// Backoff is stored in meta so it survives SW restarts. Returns the next
// allowed sync interval in minutes — the alarm consults this when picking
// the next firing time.
export async function nextDelayMinutes() {
  const cooldown = (await getMeta('cooldownMin')) || POLL_INTERVAL_MINUTES;
  return cooldown;
}

async function bumpBackoff() {
  const current = (await getMeta('cooldownMin')) || POLL_INTERVAL_MINUTES;
  const next = Math.min(current * 2, MAX_BACKOFF_MINUTES);
  await putMeta('cooldownMin', next);
}

async function resetBackoff() {
  await putMeta('cooldownMin', POLL_INTERVAL_MINUTES);
}

// Convenience for the popup: combine sync status + cache stats into one
// shape so the UI doesn't have to do two awaits.
export async function fullStatus() {
  const s = await stats();
  const last = (await getMeta('lastSyncAt')) || 0;
  const storageFull = Boolean(await getMeta('storageFull'));
  const activeSnapshot = (await getMeta('activeSnapshot')) || {};
  const lastRecovery = (await getMeta('lastRecovery')) || null;
  return {
    ...status,
    lastSyncAt: status.lastSyncAt || last,
    fileCount: s.count,
    bytes: s.bytes,
    storageFull,
    siteHost: activeSnapshot.siteHost || null,
    entryPath: activeSnapshot.entryPath || DEFAULT_ENTRY_PATH,
    requestId: activeSnapshot.requestId || null,
    commitSha: activeSnapshot.commitSha || null,
    lastRecovery,
  };
}

export function validateSnapshotManifest(manifest) {
  const siteHost = manifest && typeof manifest.siteHost === 'string'
    ? manifest.siteHost.trim().toLowerCase()
    : '';
  if (!siteHost) {
    throw new Error('snapshot manifest missing siteHost');
  }

  const entryPath = sanitizeEntryPath(
    manifest && typeof manifest.entryPath === 'string' ? manifest.entryPath : DEFAULT_ENTRY_PATH
  );

  const requestId = manifest && typeof manifest.requestId === 'string'
    ? manifest.requestId.trim()
    : null;

  return {
    siteHost,
    entryPath,
    requestId,
  };
}

export async function recoverStoragePressure({ siteHost = '', targetBytes = STORAGE_RECOVERY_TARGET_BYTES } = {}) {
  const result = await evictFilesForQuota({
    siteHost,
    targetBytes,
    protectedPaths: [MIRROR_MANIFEST_PATH],
  });
  if (result.removed > 0) {
    await putMeta('storageFull', false);
  }
  return result;
}

export async function runUserRecovery({ mode = 'evict' } = {}) {
  const now = Date.now();
  if (mode === 'reset') {
    await clearAll();
    await putMetaBatch([
      ['storageFull', false],
      ['lastRecovery', { mode: 'reset', removed: null, reclaimedBytes: null, at: now }],
    ]);
    setStatus({
      state: 'idle',
      lastError: null,
      progress: null,
      treeSha: null,
      newContentArrived: false,
      lastSyncAt: 0,
    });
    return { mode: 'reset', removed: null, reclaimedBytes: null, at: now };
  }

  const activeSnapshot = (await getMeta('activeSnapshot')) || {};
  const outcome = await recoverStoragePressure({
    siteHost: activeSnapshot.siteHost || '',
    targetBytes: STORAGE_RECOVERY_TARGET_BYTES,
  });
  const payload = {
    mode: 'evict',
    removed: outcome.removed,
    reclaimedBytes: outcome.reclaimedBytes,
    at: now,
  };
  await putMeta('lastRecovery', payload);
  return payload;
}

export function isQuotaError(err) {
  const name = err && err.name ? String(err.name) : '';
  const msg = err && err.message ? String(err.message).toLowerCase() : '';
  return name === 'QuotaExceededError' || msg.includes('quota');
}

export async function gitBlobShaHex(arrayBuffer) {
  const body = new Uint8Array(arrayBuffer);
  const prefix = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const joined = new Uint8Array(prefix.length + body.length);
  joined.set(prefix, 0);
  joined.set(body, prefix.length);
  const digest = await crypto.subtle.digest('SHA-1', joined);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function persistActiveSnapshot(manifestMeta, commitSha) {
  const siteHost = manifestMeta && manifestMeta.siteHost ? manifestMeta.siteHost : null;
  const entryPath = manifestMeta && manifestMeta.entryPath ? manifestMeta.entryPath : DEFAULT_ENTRY_PATH;
  const requestId = manifestMeta && manifestMeta.requestId ? manifestMeta.requestId : null;

  await putMeta('activeSnapshot', {
    siteHost,
    entryPath,
    requestId,
    commitSha,
    updatedAt: Date.now(),
  });
}

function sanitizeEntryPath(value) {
  const trimmed = String(value || '').trim().replace(/^\/+/, '');
  if (!trimmed) return DEFAULT_ENTRY_PATH;
  if (trimmed.includes('..')) return DEFAULT_ENTRY_PATH;
  return trimmed;
}

async function loadAndValidateSnapshotManifest({ tree, userRepoUrl, commitSha, preloadedContent }) {
  const manifestBlob = tree.find((b) => b.path === MIRROR_MANIFEST_PATH);
  if (!manifestBlob) {
    throw new Error(`required manifest missing from snapshot: ${MIRROR_MANIFEST_PATH}`);
  }

  let manifestBuffer = null;
  const existing = await getFile(MIRROR_MANIFEST_PATH);
  if (existing && existing.sha === manifestBlob.sha && existing.content) {
    manifestBuffer = existing.content;
  }
  if (!manifestBuffer) {
    manifestBuffer = await fetchRaw(userRepoUrl, MIRROR_MANIFEST_PATH, commitSha);
  }
  preloadedContent.set(MIRROR_MANIFEST_PATH, manifestBuffer);

  const manifest = parseSnapshotManifestBuffer(manifestBuffer);
  return validateSnapshotManifest(manifest);
}

export function parseSnapshotManifestBuffer(manifestBuffer) {
  if (!manifestBuffer || typeof manifestBuffer.byteLength !== 'number') {
    throw new Error('snapshot manifest buffer missing');
  }
  if (manifestBuffer.byteLength > MAX_MANIFEST_SIZE_BYTES) {
    throw new Error(`snapshot manifest exceeds MAX_MANIFEST_SIZE_BYTES (${MAX_MANIFEST_SIZE_BYTES})`);
  }
  try {
    const text = new TextDecoder('utf-8').decode(manifestBuffer);
    return JSON.parse(text);
  } catch (_) {
    throw new Error('snapshot manifest is not valid JSON');
  }
}



async function getRegistrationDraft() {
  return new Promise((resolve) => {
    chrome.storage.local.get('registrationDraft', (result) => {
      resolve(result && result.registrationDraft ? result.registrationDraft : null);
    });
  });
}

async function persistRegistrationSigner(registrationDraft, signerFingerprint) {
  if (!registrationDraft || !registrationDraft.delivery) return;
  const next = {
    ...registrationDraft,
    delivery: {
      ...registrationDraft.delivery,
      producerFingerprint: signerFingerprint,
    },
  };
  return new Promise((resolve) => {
    chrome.storage.local.set({ registrationDraft: next }, resolve);
  });
}

function normalizeFingerprint(value) {
  return String(value || '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

export async function evictStaleFiles(now = Date.now()) {
  const ttlMs = STALE_FILE_TTL_DAYS * 24 * 60 * 60 * 1000;
  const entries = await listFileEntries();
  let removed = 0;
  for (const entry of entries) {
    const freshness = Math.max(entry.lastAccessAt || 0, entry.updatedAt || 0);
    if (!freshness || (now - freshness) < ttlMs) continue;
    await deleteFile(entry.path);
    removed++;
  }
  return removed;
}
