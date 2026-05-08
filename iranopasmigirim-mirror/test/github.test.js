'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMessage, generateKey, readPrivateKey, sign } from 'openpgp';
import { verifyCommit } from '../src/background/github.js';

// We test verifyCommit() in isolation. Network-touching functions
// (getTipCommit, getTree, fetchRaw) are integration paths and are exercised
// by the popup smoke test, not unit tests.

describe('verifyCommit: shape errors', () => {
  it('rejects null / missing verification block', async () => {
    assert.equal((await verifyCommit(null)).ok, false);
    assert.equal((await verifyCommit({})).ok, false);
    assert.equal((await verifyCommit({ verification: null })).ok, false);
  });

  it('rejects when GitHub itself says verified=false', async () => {
    const r = await verifyCommit({
      verification: { verified: false, reason: 'unsigned' },
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /github:/);
    assert.match(r.reason, /unsigned/);
  });
});

describe('verifyCommit: dev-mode (no pinned signers)', () => {
  it('accepts a verified commit when ALLOW_UNPINNED_SIGNATURES is on', async () => {
    // The default config has empty TRUSTED_SIGNERS and unpinned=true. This
    // test pins that pre-release behavior so we don't accidentally ship
    // with verification disabled.
    const r = await verifyCommit({
      verification: { verified: true, reason: 'valid', signing_key: 'AAAA' },
    });
    assert.equal(r.ok, true);
    assert.match(r.reason, /unpinned/);
  });
});

describe('verifyCommit: extracts fingerprint from common GitHub shapes', () => {
  it('reads signing_key field directly', async () => {
    // signing_key is the modern field name from the commits API.
    const r = await verifyCommit({
      verification: { verified: true, signing_key: '0123456789ABCDEF' },
    }, {
      trustedSigners: ['0123456789ABCDEF'],
      allowUnpinned: false,
    });
    assert.equal(r.ok, true);
  });

  it('falls back to signer.fingerprint', async () => {
    const r = await verifyCommit({
      verification: { verified: true, signer: { fingerprint: '0123456789ABCDEF' } },
    }, {
      trustedSigners: ['0123456789ABCDEF'],
      allowUnpinned: false,
    });
    assert.equal(r.ok, true);
  });

  it('fails cleanly when no signer id is recoverable in strict mode', async () => {
    const r = await verifyCommit({
      verification: { verified: true },
    }, {
      trustedSigners: ['0123456789ABCDEF'],
      allowUnpinned: false,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /cannot extract signer id/);
  });

  it('extracts signer key id from detached signature packet', async () => {
    const { privateKey } = await generateKey({
      type: 'rsa',
      rsaBits: 2048,
      userIDs: [{ name: 'mirror', email: 'mirror@example.com' }],
      format: 'armored',
    });
    const signingKey = await readPrivateKey({ armoredKey: privateKey });
    const message = await createMessage({ text: 'tree deadbeef\n\nmessage\n' });
    const detachedSignature = await sign({
      message,
      signingKeys: signingKey,
      detached: true,
      format: 'armored',
    });
    const keyId = signingKey.getKeyID().toHex().toUpperCase();

    const ok = await verifyCommit({
      verification: {
        verified: true,
        signature: detachedSignature,
        payload: 'tree deadbeef\n\nmessage\n',
      },
    }, {
      trustedSigners: [keyId],
      allowUnpinned: false,
    });
    assert.equal(ok.ok, true);

    const bad = await verifyCommit({
      verification: {
        verified: true,
        signature: detachedSignature,
        payload: 'tree deadbeef\n\nmessage\n',
      },
    }, {
      trustedSigners: ['AAAAAAAAAAAAAAAA'],
      allowUnpinned: false,
    });
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /unpinned signer/);
  });

  it('still allows unpinned verified commits in explicit dev-mode options', async () => {
    // With unpinned mode on, the missing fingerprint is fine — we already
    // accepted GitHub's verdict. Nothing to extract is OK because nothing
    // to compare against.
    const r = await verifyCommit({
      verification: { verified: true },
    }, {
      trustedSigners: [],
      allowUnpinned: true,
    });
    assert.equal(r.ok, true); // unpinned dev mode
  });
});
