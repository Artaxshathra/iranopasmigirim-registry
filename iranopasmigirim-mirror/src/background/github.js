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
  GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH,
  TRUSTED_SIGNERS, ALLOW_UNPINNED_SIGNATURES,
} from '../config.js';
import { readSignature } from 'openpgp';

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

// Get the tip commit of the configured branch. We call this rather than the
// `branches/<name>` endpoint because the commit endpoint exposes the
// `verification` block directly without a second hop.
//
// Returns: {sha, treeSha, verification}
export async function getTipCommit() {
  const url = `${API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`;
  const c = await ghJson(url);
  if (!c || !c.sha || !c.commit || !c.commit.tree || !c.commit.tree.sha) {
    throw new Error('Malformed commit response');
  }
  return {
    sha: c.sha,
    treeSha: c.commit.tree.sha,
    verification: c.commit.verification || null,
  };
}

// Recursive tree listing. One call returns every blob path in the repo plus
// their individual blob SHAs. We use the SHA-per-blob to detect file-level
// changes without downloading anything: if the SHA matches what we already
// have for a path, the file is byte-identical and we skip the raw fetch.
//
// Returns: array of {path, sha, size}
export async function getTree(treeSha) {
  const url = `${API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${treeSha}?recursive=1`;
  const t = await ghJson(url);
  if (!t || !Array.isArray(t.tree)) throw new Error('Malformed tree response');
  if (t.truncated) {
    // Tree response is capped at 7 MB / 100 000 entries. A real site mirror
    // shouldn't approach that. If it does we fail loudly rather than ship
    // a partial sync that looks complete.
    throw new Error('Tree truncated by GitHub — repo too large');
  }
  return t.tree
    .filter((e) => e.type === 'blob')
    .map((e) => ({ path: e.path, sha: e.sha, size: e.size || 0 }));
}

// Fetch a file's bytes via the raw CDN. Returns ArrayBuffer for everything
// — the caller decides text vs binary based on extension. Going through
// the CDN costs no API quota.
export async function fetchRaw(path) {
  const url = `${RAW}/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${encodePath(path)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`raw ${path} -> ${res.status}`);
  return res.arrayBuffer();
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

  // GitHub REST verification objects expose `signature` and `payload`, but
  // not a stable `fingerprint` field. We extract signer identity from the
  // detached signature packet (issuer key-id/fingerprint), then compare it
  // to a pinned TRUSTED_SIGNERS entry.
  const signerId = await extractSignerId(v);
  if (!signerId) return { ok: false, reason: 'cannot extract signer id' };

  const norm = normalizeSignerId(signerId);
  const ok = trustedSigners.some((pinned) => matchesPinnedSigner(pinned, norm));
  return ok
    ? { ok: true, reason: 'matched pinned signer' }
    : { ok: false, reason: `unpinned signer ${norm.slice(-16)}` };
}

// Pull signer identity from the verification block. Prefer explicit fields
// if present; otherwise parse the detached OpenPGP signature packet.
// Returns uppercase hex signer id or null.
export async function extractSignerId(v) {
  if (v.signing_key && typeof v.signing_key === 'string') return normalizeSignerId(v.signing_key);
  if (v.signer && typeof v.signer.fingerprint === 'string') return normalizeSignerId(v.signer.fingerprint);

  if (!v.signature || typeof v.signature !== 'string') return null;
  try {
    const parsed = await readSignature({ armoredSignature: v.signature });
    const packet = parsed && parsed.packets && parsed.packets[0];
    if (!packet) return null;

    if (packet.issuerFingerprint && packet.issuerFingerprint.length) {
      return normalizeSignerId(bytesToHex(packet.issuerFingerprint));
    }
    if (packet.issuerKeyID && typeof packet.issuerKeyID.toHex === 'function') {
      return normalizeSignerId(packet.issuerKeyID.toHex());
    }
  } catch (_) {
    return null;
  }
  return null;
}

function matchesPinnedSigner(pinned, signerId) {
  const normPinned = normalizeSignerId(pinned);
  if (!normPinned || !signerId) return false;
  if (normPinned === signerId) return true;
  // Compatibility path: operators often pin a full fingerprint (40 hex)
  // while signature packets expose only long key-id (16 hex).
  if (normPinned.length === 40 && signerId.length === 16) {
    return normPinned.endsWith(signerId);
  }
  if (normPinned.length === 16 && signerId.length === 40) {
    return signerId.endsWith(normPinned);
  }
  return false;
}

function normalizeSignerId(value) {
  if (typeof value !== 'string') return '';
  return value.toUpperCase().replace(/[^0-9A-F]/g, '');
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
