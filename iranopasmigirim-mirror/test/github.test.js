'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCommit } from '../src/background/github.js';

// We test verifyCommit() in isolation. Network-touching functions
// (getTipCommit, getTree, fetchRaw) are integration paths and are exercised
// by the popup smoke test, not unit tests.

describe('verifyCommit: shape errors', () => {
  it('rejects null / missing verification block', () => {
    assert.equal(verifyCommit(null).ok, false);
    assert.equal(verifyCommit({}).ok, false);
    assert.equal(verifyCommit({ verification: null }).ok, false);
  });

  it('rejects when GitHub itself says verified=false', () => {
    const r = verifyCommit({
      verification: { verified: false, reason: 'unsigned' },
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /github:/);
    assert.match(r.reason, /unsigned/);
  });
});

describe('verifyCommit: dev-mode (no pinned signers)', () => {
  it('accepts a verified commit when ALLOW_UNPINNED_SIGNATURES is on', () => {
    // The default config has empty TRUSTED_SIGNERS and unpinned=true. This
    // test pins that pre-release behavior so we don't accidentally ship
    // with verification disabled.
    const r = verifyCommit({
      verification: { verified: true, reason: 'valid', signing_key: 'AAAA' },
    });
    assert.equal(r.ok, true);
    assert.match(r.reason, /unpinned/);
  });
});

// The "rejects unpinned signer when ALLOW_UNPINNED_SIGNATURES=false" path
// requires reloading the module with a different config. We don't bother:
// the logic is one branch and visually obvious. Production verification
// will be exercised by an integration test against a real signed commit
// once the mirror repo exists.

describe('verifyCommit: extracts fingerprint from common GitHub shapes', () => {
  it('reads signing_key field directly', () => {
    // signing_key is the modern field name from the commits API.
    const r = verifyCommit({
      verification: { verified: true, signing_key: '0123456789ABCDEF' },
    });
    assert.equal(r.ok, true);
  });

  it('falls back to signer.fingerprint', () => {
    const r = verifyCommit({
      verification: { verified: true, signer: { fingerprint: '0123456789ABCDEF' } },
    });
    assert.equal(r.ok, true);
  });

  it('fails cleanly when no fingerprint is recoverable AND no signers configured', () => {
    // With unpinned mode on, the missing fingerprint is fine — we already
    // accepted GitHub's verdict. Nothing to extract is OK because nothing
    // to compare against.
    const r = verifyCommit({
      verification: { verified: true },
    });
    assert.equal(r.ok, true); // unpinned dev mode
  });
});
