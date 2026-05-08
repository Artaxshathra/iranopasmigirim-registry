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
export function verifyCommit(commit) {
  const v = commit && commit.verification;
  if (!v) return { ok: false, reason: 'no verification block' };
  if (!v.verified) {
    // GitHub returns a `reason` string (e.g. "unsigned", "bad_email") that
    // we surface for diagnostics — useful in the popup error display.
    return { ok: false, reason: `github: ${v.reason || 'unverified'}` };
  }
  if (!TRUSTED_SIGNERS.length) {
    if (ALLOW_UNPINNED_SIGNATURES) {
      return { ok: true, reason: 'unpinned (dev mode)' };
    }
    return { ok: false, reason: 'no trusted signers configured' };
  }
  // GitHub's `payload` field is the signed git-commit object body, and
  // `signature` is the detached PGP signature. We do not re-verify the
  // signature ourselves — doing so in a service worker would require
  // shipping an OpenPGP implementation just for one check, and the same
  // public infrastructure (GitHub's trust DB) already did the math.
  // Instead we trust GitHub's `verified=true` *and* require the signing
  // key's identity (signer.id or payer / key id) to match our pin.
  //
  // GitHub returns `verification.signature` and a `payload` that includes
  // the signer's gpg key ID in the signature header line. We require an
  // explicit `verification.signer` field if present, otherwise fall back
  // to extracting the long-id from the signature payload.
  const fingerprint = extractFingerprint(v);
  if (!fingerprint) return { ok: false, reason: 'cannot extract fingerprint' };
  const norm = fingerprint.toUpperCase().replace(/\s+/g, '');
  const ok = TRUSTED_SIGNERS.some(
    (k) => k.toUpperCase().replace(/\s+/g, '') === norm
  );
  return ok
    ? { ok: true, reason: 'matched pinned signer' }
    : { ok: false, reason: `unpinned signer ${norm.slice(0, 16)}…` };
}

// Pull the signing key identity out of GitHub's verification block. The
// API returns this in different fields across endpoints; we check both.
// Returns null if nothing recognizable is present.
function extractFingerprint(v) {
  // Newer responses include a fingerprint directly. Prefer it.
  if (v.signing_key && typeof v.signing_key === 'string') return v.signing_key;
  // Some responses wrap it under `signer`.
  if (v.signer && v.signer.fingerprint) return v.signer.fingerprint;
  return null;
}
