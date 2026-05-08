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
  getTipCommit, getTree, fetchRaw, verifyCommit,
} from './github.js';
import {
  listPaths, getFile, putFile, deleteFile, getMeta, putMeta, stats,
} from './db.js';
import {
  POLL_INTERVAL_MINUTES, MAX_BACKOFF_MINUTES,
  MAX_FILE_SIZE_BYTES, MAX_FILES_PER_SYNC,
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
};

export function getStatus() { return status; }

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
      const commit = await getTipCommit();
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
        await resetBackoff();
        return { skipped: true };
      }

      // Verify before we ingest a single byte. If verification fails, we
      // intentionally leave the existing cache alone — a hijacked GitHub
      // account or man-in-the-middle is exactly the threat model here.
      const verdict = verifyCommit(commit);
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

      // Sequential download — concurrent fetches would overrun the CDN's
      // rate-limiter (rare but real) and clog the SW's event loop. The
      // sequential cost is fine: the tree-SHA short-circuit means we only
      // hit this path on actual changes.
      for (let i = 0; i < writes.length; i++) {
        const blob = writes[i];
        try {
          const buf = await fetchRaw(blob.path);
          if (buf.byteLength > MAX_FILE_SIZE_BYTES) continue;
          await putFile(blob.path, {
            content: buf,
            sha: blob.sha,
          });
        } catch (e) {
          // One bad file shouldn't kill the whole sync. We log and continue;
          // the next sync will retry it (its sha will still differ from
          // whatever we have, or it'll be missing entirely).
          console.warn('[sync] write failed', blob.path, e && e.message);
        }
        setStatus({ progress: { done: i + 1, total: writes.length } });
      }

      for (const path of deletes) {
        try { await deleteFile(path); }
        catch (e) { console.warn('[sync] delete failed', path, e && e.message); }
      }

      await putMeta('treeSha', commit.treeSha);
      await putMeta('lastSyncAt', Date.now());
      await resetBackoff();

      setStatus({
        state: 'ok',
        lastSyncAt: Date.now(),
        treeSha: commit.treeSha,
        progress: null,
      });
      return { writes: writes.length, deletes: deletes.length };
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
  return {
    ...status,
    lastSyncAt: status.lastSyncAt || last,
    fileCount: s.count,
    bytes: s.bytes,
  };
}
