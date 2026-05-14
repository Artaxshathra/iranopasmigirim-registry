// GitHub data plane for request-response protocol.
//
// Two endpoints, no auth required:
//   1. api.github.com — JSON: commit info + signatures
//      60 req/hour unauth limit; we poll ~2 calls per cycle, so safe.
//   2. raw.githubusercontent.com — file bytes via CDN
//
// Extension workflow:
//   1. User configures their repo URL (via popup or storage)
//   2. Extension polls user's repo on CONTENT_BRANCH
//   3. Verifies signature against PRODUCER_PUBLIC_KEY_FINGERPRINT
//   4. Fetches and caches files
//
// Trust model: Producer signs commits. Extension verifies producer's signature.
// No central authority — producer is transparent via git history.

import {
  TRUSTED_SIGNERS,
  TRUSTED_SIGNER_PUBLIC_KEYS,
  ALLOW_UNPINNED_SIGNATURES,
  CONTENT_BRANCH,
  REVOKED_SIGNERS,
} from '../config.js';
import { createMessage, readKey, readSignature, verify as pgpVerify } from 'openpgp';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

// JSON GET wrapper with consistent error handling.
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

// Parse GitHub SSH/HTTPS URL into owner and repo components.
// Supports: https://github.com/owner/repo, https://github.com/owner/repo.git,
//           git@github.com:owner/repo.git, git@github.com:owner/repo
export function parseGitHubUrl(url) {
  if (typeof url !== 'string') {
    throw new Error('repo URL must be a string');
  }

  // HTTPS: https://github.com/owner/repo[.git]
  const httpsMatch = url.match(/https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/i);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2],
    };
  }

  // SSH: git@github.com:owner/repo[.git]
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/]+?)(\.git)?$/i);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    };
  }

  throw new Error('Invalid GitHub URL format');
}

// Fetch the tip commit SHA and tree SHA from the user's repo on CONTENT_BRANCH.
// Returns: {sha, treeSha, verification}
export async function resolvePointer(userRepoUrl, branch = CONTENT_BRANCH) {
  try {
    const { owner, repo } = parseGitHubUrl(userRepoUrl);
    const url = `${API}/repos/${owner}/${repo}/commits/${branch}`;
    const tip = await ghJson(url);
    if (!tip || !tip.sha || !tip.commit || !tip.commit.tree || !tip.commit.tree.sha) {
      throw new Error('Malformed commit response');
    }
    return {
      sha: tip.sha,
      treeSha: tip.commit.tree.sha,
      verification: tip.commit.verification || null,
      owner,
      repo,
    };
  } catch (e) {
    throw new Error(`Failed to resolve pointer: ${(e && e.message) || 'unknown error'}`);
  }
}

// Recursive tree listing from repo. Returns array of {path, sha, size}.
export async function getTree(userRepoUrl, treeSha) {
  try {
    const { owner, repo } = parseGitHubUrl(userRepoUrl);
    const url = `${API}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
    const t = await ghJson(url);
    if (!t || !Array.isArray(t.tree)) throw new Error('Malformed tree response');
    if (t.truncated) {
      throw new Error('Tree truncated by GitHub — repo too large');
    }
    return t.tree
      .filter((e) => e.type === 'blob')
      .map((e) => ({ path: e.path, sha: e.sha, size: e.size || 0 }));
  } catch (e) {
    throw new Error(`Failed to fetch tree: ${(e && e.message) || 'unknown error'}`);
  }
}

// Fetch a file's bytes via raw CDN. Returns ArrayBuffer.
export async function fetchRaw(userRepoUrl, path, commitSha) {
  try {
    const { owner, repo } = parseGitHubUrl(userRepoUrl);
    const encodedPath = encodePath(path);
    const url = `${RAW}/${owner}/${repo}/${commitSha}/${encodedPath}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`raw ${path} -> ${res.status}`);
    return res.arrayBuffer();
  } catch (e) {
    throw new Error(`Failed to fetch ${path}: ${(e && e.message) || 'unknown error'}`);
  }
}

// Fetch plain text from a branch path via raw CDN.
export async function fetchTextFromBranch(repoUrl, path, branch) {
  const { owner, repo } = parseGitHubUrl(repoUrl);
  const encodedPath = encodePath(path);
  const ref = encodePath(String(branch || '').trim());
  const url = `${RAW}/${owner}/${repo}/${ref}/${encodedPath}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const err = new Error(`raw ${path} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

// Fetch JSON from a branch path. Returns null on 404 to simplify polling.
export async function fetchJsonFromBranch(repoUrl, path, branch) {
  try {
    const text = await fetchTextFromBranch(repoUrl, path, branch);
    return JSON.parse(text);
  } catch (e) {
    if (e && e.status === 404) return null;
    throw e;
  }
}

// Encode each path segment but preserve slashes. encodeURIComponent escapes
// '/' which would break GitHub's URL routing.
function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

// Verify the commit signature against the producer's pinned public key.
// Returns: {ok: bool, reason: string}
export async function verifyCommit(commit, options = {}) {
  if (!commit || !commit.verification) {
    return { ok: false, reason: 'no verification block' };
  }

  const v = commit.verification;
  if (!v.verified) {
    return { ok: false, reason: `github: ${v.reason || 'unverified'}` };
  }

  const trustedSigners = Array.isArray(options.trustedSigners)
    ? options.trustedSigners
    : TRUSTED_SIGNERS;
  const trustedSignerPublicKeys = Array.isArray(options.trustedSignerPublicKeys)
    ? options.trustedSignerPublicKeys
    : TRUSTED_SIGNER_PUBLIC_KEYS;
  const allowUnpinned = typeof options.allowUnpinned === 'boolean'
    ? options.allowUnpinned
    : ALLOW_UNPINNED_SIGNATURES;
  const revokedSigners = Array.isArray(options.revokedSigners)
    ? options.revokedSigners
    : REVOKED_SIGNERS;

  if (allowUnpinned && (!v.signature || !v.payload)) {
    return { ok: true, reason: 'unpinned mode' };
  }

  if (!v.signature || !v.payload) {
    return { ok: false, reason: 'missing detached signature payload' };
  }

  for (const fp of trustedSigners) {
    if (!isFullFingerprint(fp)) {
      return { ok: false, reason: 'trusted signer pins must be full 40-hex fingerprints' };
    }
  }

  if (!trustedSigners.length || !trustedSignerPublicKeys.length) {
    return allowUnpinned
      ? { ok: true, reason: 'unpinned mode' }
      : { ok: false, reason: 'no trusted signers configured' };
  }

  const matchedFingerprint = await verifyWithPinnedKeys(v.signature, v.payload, trustedSignerPublicKeys);
  if (!matchedFingerprint) {
    return { ok: false, reason: 'signature verification failed' };
  }

  const allowed = new Set(trustedSigners.map(normalizeSignerId));
  const revoked = new Set(revokedSigners.map(normalizeSignerId));
  const actual = normalizeSignerId(matchedFingerprint);
  if (revoked.has(actual)) {
    return { ok: false, reason: `revoked signer: ${actual.slice(-16)}` };
  }
  if (!allowed.has(actual)) {
    return { ok: false, reason: `unpinned signer: ${actual.slice(-16)}` };
  }

  return { ok: true, reason: 'signature verified', signerFingerprint: actual };
}

async function verifyWithPinnedKeys(armoredSignature, payload, armoredKeys) {
  try {
    const signature = await readSignature({ armoredSignature });
    const message = await createMessage({ text: payload });
    for (const armored of armoredKeys) {
      try {
        const key = await readKey({ armoredKey: String(armored || '') });
        const verified = await pgpVerify({ message, signature, verificationKeys: key });
        if (!verified || !Array.isArray(verified.signatures)) continue;
        for (const sig of verified.signatures) {
          try {
            await sig.verified;
            const fp = typeof key.getFingerprint === 'function' ? key.getFingerprint() : null;
            if (fp) return normalizeSignerId(fp);
          } catch (_) {
            // keep trying
          }
        }
      } catch (_) {
        // keep trying
      }
    }
  } catch (_) {
    // Parsing or verification failure.
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

