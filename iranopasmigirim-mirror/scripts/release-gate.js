import {
  ALLOW_UNPINNED_SIGNATURES,
  GITHUB_OWNER,
  GITHUB_REPO,
  TRUSTED_SIGNER_PUBLIC_KEYS,
  TRUSTED_SIGNERS,
} from '../src/config.js';
import { readKey } from 'openpgp';

function fail(msg) {
  console.error(`[release-gate] ${msg}`);
  process.exit(1);
}

if (ALLOW_UNPINNED_SIGNATURES) {
  fail('ALLOW_UNPINNED_SIGNATURES must be false for release builds');
}
if (!Array.isArray(TRUSTED_SIGNERS) || TRUSTED_SIGNERS.length === 0) {
  fail('TRUSTED_SIGNERS must contain at least one signer for release builds');
}
for (const fp of TRUSTED_SIGNERS) {
  const norm = String(fp || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!/^[0-9A-F]{40}$/.test(norm)) {
    fail(`TRUSTED_SIGNERS entry must be full 40-hex fingerprint: ${fp}`);
  }
}
if (!Array.isArray(TRUSTED_SIGNER_PUBLIC_KEYS) || TRUSTED_SIGNER_PUBLIC_KEYS.length === 0) {
  fail('TRUSTED_SIGNER_PUBLIC_KEYS must contain at least one armored key');
}
if (TRUSTED_SIGNER_PUBLIC_KEYS.length < TRUSTED_SIGNERS.length) {
  fail('TRUSTED_SIGNER_PUBLIC_KEYS must be at least as many as TRUSTED_SIGNERS');
}

const keyFingerprints = new Set();
for (const armored of TRUSTED_SIGNER_PUBLIC_KEYS) {
  try {
    const key = await readKey({ armoredKey: String(armored || '') });
    const fp = String(key.getFingerprint() || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    if (!/^[0-9A-F]{40}$/.test(fp)) {
      fail('TRUSTED_SIGNER_PUBLIC_KEYS contains key with invalid fingerprint format');
    }
    keyFingerprints.add(fp);
  } catch (e) {
    fail(`invalid armored public key in TRUSTED_SIGNER_PUBLIC_KEYS: ${(e && e.message) || e}`);
  }
}
for (const fp of TRUSTED_SIGNERS) {
  const norm = String(fp || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (!keyFingerprints.has(norm)) {
    fail(`TRUSTED_SIGNERS fingerprint has no matching armored key: ${fp}`);
  }
}
if (!GITHUB_OWNER || !GITHUB_REPO) {
  fail('GITHUB_OWNER/GITHUB_REPO must be configured');
}
if (GITHUB_OWNER === 'iran-mirror' && GITHUB_REPO === 'iranopasmigirim') {
  fail('GITHUB_OWNER/GITHUB_REPO are still at default placeholder values');
}

console.log('[release-gate] release configuration checks passed');
