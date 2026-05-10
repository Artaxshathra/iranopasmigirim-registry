// Sync engine.
//
// Plan of one tick:
//   1. Get tip commit + tree SHA (1 API call).
//   2. If tree SHA matches what we cached, exit. Zero further bandwidth.
//   3. Verify the commit's signature against TRUSTED_SIGNERS.
//      If verification fails, abort — keep the existing cache untouched.
//   4. Recursive tree listing (1 API call).
//   5. Diff against IndexedDB:
//        a. blobs whose sha matches what we have   -> skip
//        b. blobs whose sha differs (or are new)   -> fetch from raw CDN
//        c. paths in DB not in tree                -> delete
//   6. Write the new tree SHA + sync timestamp to meta.
//
// Backoff: tracked in `meta` so it survives SW restarts. On any failure we
// double the cooldown up to MAX_BACKOFF_MINUTES, on success we reset to
// the configured POLL_INTERVAL_MINUTES.

import {
  resolvePointer, getTree, fetchRaw, verifyCommit,
} from './github.js';
import {
  listPaths, getFile, putFile, deleteFile, getMeta, putMeta, putMetaBatch, stats, compactFiles,
} from './db.js';
import {
  POLL_INTERVAL_MINUTES, MAX_BACKOFF_MINUTES,
  MAX_FILE_SIZE_BYTES, MAX_FILES_PER_SYNC, MAINTENANCE_INTERVAL_HOURS,
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

export async function syncOnce({ force = false } = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    setStatus({ state: 'syncing', lastError: null, progress: { done: 0, total: 0 } });
    try {
      const commit = await resolvePointer();
      const lastSha = await getMeta('treeSha');
      if (!force && commit.treeSha === lastSha) {
        // Nothing changed since last poll. This is the common case and the
        // whole point of the tree-SHA short-circuit: we paid one API call.
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

      // Verify before we ingest a single byte. If verification fails, we
      // intentionally leave the existing cache alone — a hijacked GitHub
      // account or man-in-the-middle is exactly the threat model here.
      const verdict = await verifyCommit(commit);
      if (!verdict.ok) {
        throw new Error(`signature: ${verdict.reason}`);
      }

      const tree = await getTree(commit.treeSha);
      if (tree.length > MAX_FILES_PER_SYNC) {
        throw new Error(`tree has ${tree.length} files, exceeds MAX_FILES_PER_SYNC`);
      }

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

      // Sequential download — concurrent fetches would overrun the CDN's
      // rate-limiter (rare but real) and clog the SW's event loop. The
      // sequential cost is fine: the tree-SHA short-circuit means we only
      // hit this path on actual changes. Any write failure keeps treeSha
      // unchanged so the next sync retries missing paths.
      for (let i = 0; i < writes.length; i++) {
        const blob = writes[i];
        try {
          const buf = await fetchRaw(blob.path, commit.sha);
          if (buf.byteLength > MAX_FILE_SIZE_BYTES) {
            throw new Error(`downloaded size exceeds MAX_FILE_SIZE_BYTES for ${blob.path}`);
          }
          const digest = await gitBlobShaHex(buf);
          if (digest !== String(blob.sha || '').toLowerCase()) {
            throw new Error(`blob sha mismatch for ${blob.path}`);
          }
          await putFile(blob.path, {
            content: buf,
            sha: blob.sha,
          });
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
    await putMeta('lastMaintenanceAt', now);
    if (removed > 0) {
      console.warn(`[sync] maintenance removed ${removed} stale file(s)`);
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
  return {
    ...status,
    lastSyncAt: status.lastSyncAt || last,
    fileCount: s.count,
    bytes: s.bytes,
    storageFull,
  };
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
