import {
  ALLOW_UNPINNED_SIGNATURES,
  GITHUB_OWNER,
  GITHUB_REPO,
  TRUSTED_SIGNERS,
} from '../src/config.js';

function isReleaseMode() {
  const v = String(process.env.IPM_RELEASE || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function fail(msg) {
  console.error(`[release-gate] ${msg}`);
  process.exit(1);
}

if (!isReleaseMode()) {
  process.exit(0);
}

if (ALLOW_UNPINNED_SIGNATURES) {
  fail('ALLOW_UNPINNED_SIGNATURES must be false for release builds');
}
if (!Array.isArray(TRUSTED_SIGNERS) || TRUSTED_SIGNERS.length === 0) {
  fail('TRUSTED_SIGNERS must contain at least one signer for release builds');
}
if (!GITHUB_OWNER || !GITHUB_REPO) {
  fail('GITHUB_OWNER/GITHUB_REPO must be configured');
}
if (GITHUB_OWNER === 'iran-mirror' && GITHUB_REPO === 'iranopasmigirim') {
  fail('GITHUB_OWNER/GITHUB_REPO are still at default placeholder values');
}

console.log('[release-gate] release configuration checks passed');
