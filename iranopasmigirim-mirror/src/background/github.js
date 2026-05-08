// GitHub data plane.
//
// Two endpoints, no auth:
//   1. api.github.com — small JSON: tree listing + commit verification info.
//      60 req/hour unauth limit; we do at most ~2 calls per poll, so safe.
//   2. raw.githubusercontent.com — actual file bytes. No rate limit, served
//      from a CDN, supports ETag and conditional requests.
//
// Everything that *could* be tampered with comes through verifyCommit().
// Calls return parsed objects on success and throw on transport / shape
// errors; the sync engine catches and applies backoff.

import {
  GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, REPO_CANDIDATES,
  TRUSTED_SIGNERS, TRUSTED_SIGNER_PUBLIC_KEYS, ALLOW_UNPINNED_SIGNATURES,
} from '../config.js';
import { createMessage, readKey, readSignature, verify as pgpVerify } from 'openpgp';

const API  = 'https://api.github.com';
const RAW  = 'https://raw.githubusercontent.com';

// JSON GET wrapper with consistent error handling. We don't follow
// redirects manually; fetch() does it correctly for us. We force a
// short cache busting query so a stale CDN response never wedges sync
// (raw URLs are served by a CDN that occasionally caches longer than
// we'd like).
async function ghJson(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = new Error(`GitHub ${url} -> ${res.status}`);
    err.status = res.status;
    err.retryAfter = res.headers.get('retry-after');
    throw err;
  }
  return res.json();
}

function normalizedCandidates() {
  const fallback = [{ owner: GITHUB_OWNER, repo: GITHUB_REPO, branch: GITHUB_BRANCH }];
  const input = Array.isArray(REPO_CANDIDATES) && REPO_CANDIDATES.length
    ? REPO_CANDIDATES
    : fallback;
  return input
    .filter((c) => c && c.owner && c.repo && c.branch)
    .map((c) => ({ owner: String(c.owner), repo: String(c.repo), branch: String(c.branch) }));
}

function shuffled(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

// Resolve a signed pointer (tip commit + tree) from any configured candidate
// repo. Returns first validly-shaped response.
export async function resolvePointer() {
  const candidates = shuffled(normalizedCandidates());
  let lastError = null;
  for (const c of candidates) {
    try {
      const url = `${API}/repos/${c.owner}/${c.repo}/commits/${c.branch}`;
      const tip = await ghJson(url);
      if (!tip || !tip.sha || !tip.commit || !tip.commit.tree || !tip.commit.tree.sha) {
        throw new Error('Malformed commit response');
      }
      return {
        sha: tip.sha,
        treeSha: tip.commit.tree.sha,
        verification: tip.commit.verification || null,
        source: c,
      };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`pointer resolution failed across candidates: ${(lastError && lastError.message) || 'unknown error'}`);
}

// Recursive tree listing. One call returns every blob path in the repo plus
// their individual blob SHAs. We use the SHA-per-blob to detect file-level
// changes without downloading anything: if the SHA matches what we already
// have for a path, the file is byte-identical and we skip the raw fetch.
//
// Returns: array of {path, sha, size}
export async function getTree(treeSha) {
  const candidates = shuffled(normalizedCandidates());
  let lastError = null;
  for (const c of candidates) {
    try {
      const url = `${API}/repos/${c.owner}/${c.repo}/git/trees/${treeSha}?recursive=1`;
      const t = await ghJson(url);
      if (!t || !Array.isArray(t.tree)) throw new Error('Malformed tree response');
      if (t.truncated) {
        throw new Error('Tree truncated by GitHub — repo too large');
      }
      return t.tree
        .filter((e) => e.type === 'blob')
        .map((e) => ({ path: e.path, sha: e.sha, size: e.size || 0 }));
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`tree fetch failed across candidates: ${(lastError && lastError.message) || 'unknown error'}`);
}

// Fetch a file's bytes via the raw CDN. Returns ArrayBuffer for everything
// — the caller decides text vs binary based on extension. Going through
// the CDN costs no API quota.
export async function fetchRaw(path, commitSha) {
  const candidates = shuffled(normalizedCandidates());
  const encodedPath = encodePath(path);
  let lastError = null;
  for (const c of candidates) {
    const url = `${RAW}/${c.owner}/${c.repo}/${commitSha}/${encodedPath}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`raw ${path} -> ${res.status}`);
      return res.arrayBuffer();
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`raw fetch failed across candidates for ${path}: ${(lastError && lastError.message) || 'unknown error'}`);
}

// Encode each path segment but preserve slashes. encodeURIComponent escapes
// '/' which would break GitHub's URL routing.
function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

// Verify the tip commit. The trust model:
//
//   1. GitHub's own verification.verified must be true. This is GitHub's
//      attestation that the commit signature matched a key on the author's
//      account at the time of the push.
//   2. The signing key fingerprint must appear in TRUSTED_SIGNERS — pinned
//      in the extension code. This makes us independent of GitHub's trust
//      decisions: even if a GitHub admin uploaded a fake key to a hijacked
//      account, the fingerprint won't match what we shipped.
//
// Step 2 can be skipped while ALLOW_UNPINNED_SIGNATURES is on (development
// mode) — flipping it false is the production gate.
//
// Returns: {ok: bool, reason: string}
export async function verifyCommit(commit, opts = {}) {
  const trustedSigners = Array.isArray(opts.trustedSigners)
    ? opts.trustedSigners
    : TRUSTED_SIGNERS;
  const trustedSignerPublicKeys = Array.isArray(opts.trustedSignerPublicKeys)
    ? opts.trustedSignerPublicKeys
    : TRUSTED_SIGNER_PUBLIC_KEYS;
  const allowUnpinned = typeof opts.allowUnpinned === 'boolean'
    ? opts.allowUnpinned
    : ALLOW_UNPINNED_SIGNATURES;

  const v = commit && commit.verification;
  if (!v) return { ok: false, reason: 'no verification block' };
  if (!v.verified) {
    // GitHub returns a `reason` string (e.g. "unsigned", "bad_email") that
    // we surface for diagnostics — useful in the popup error display.
    return { ok: false, reason: `github: ${v.reason || 'unverified'}` };
  }
  if (!trustedSigners.length) {
    if (allowUnpinned) {
      return { ok: true, reason: 'unpinned (dev mode)' };
    }
    return { ok: false, reason: 'no trusted signers configured' };
  }
  if (!trustedSigners.every(isFullFingerprint)) {
    return { ok: false, reason: 'trusted signers must be full 40-hex fingerprints' };
  }
  if (!trustedSignerPublicKeys.length) {
    return { ok: false, reason: 'no trusted signer public keys configured' };
  }
  if (!v.signature || typeof v.signature !== 'string' || !v.payload || typeof v.payload !== 'string') {
    return { ok: false, reason: 'missing detached signature payload' };
  }

  const normalizedPins = trustedSigners.map(normalizeSignerId);
  const matchedFingerprint = await verifyWithPinnedKeys(v.signature, v.payload, trustedSignerPublicKeys);
  if (!matchedFingerprint) return { ok: false, reason: 'detached signature verification failed' };
  const ok = normalizedPins.includes(normalizeSignerId(matchedFingerprint));
  return ok
    ? { ok: true, reason: 'matched pinned signer' }
    : { ok: false, reason: `unpinned signer ${normalizeSignerId(matchedFingerprint).slice(-16)}` };
}

async function verifyWithPinnedKeys(armoredSignature, payload, armoredKeys) {
  let signature;
  try {
    signature = await readSignature({ armoredSignature });
  } catch (_) {
    return null;
  }

  let message;
  try {
    message = await createMessage({ text: payload });
  } catch (_) {
    return null;
  }

  for (const armored of armoredKeys) {
    let key;
    try {
      key = await readKey({ armoredKey: armored });
    } catch (_) {
      continue;
    }

    try {
      const verified = await pgpVerify({
        message,
        signature,
        verificationKeys: key,
      });
      if (!verified || !Array.isArray(verified.signatures)) continue;
      for (const sig of verified.signatures) {
        await sig.verified;
        if (typeof key.getFingerprint === 'function') {
          return normalizeSignerId(key.getFingerprint());
        }
      }
    } catch (_) {
      // Try next key.
    }
  }
  return null;
}

function normalizeSignerId(value) {
  if (typeof value !== 'string') return '';
  return value.toUpperCase().replace(/[^0-9A-F]/g, '');
}

function isFullFingerprint(value) {
  return /^[0-9A-F]{40}$/.test(normalizeSignerId(value));
}

