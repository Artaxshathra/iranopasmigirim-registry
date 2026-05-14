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
describe('verifyCommit: strict pinned-key verification', () => {
  async function makeSignedPayload() {
    const { privateKey, publicKey } = await generateKey({
      type: 'rsa',
      rsaBits: 2048,
      userIDs: [{ name: 'mirror', email: 'mirror@example.com' }],
      format: 'armored',
    });
    const signingKey = await readPrivateKey({ armoredKey: privateKey });
    const payload = 'tree deadbeef\n\nmessage\n';
    const message = await createMessage({ text: payload });
    const detachedSignature = await sign({
      message,
      signingKeys: signingKey,
      detached: true,
      format: 'armored',
    });
    const fingerprint = signingKey.getFingerprint().toUpperCase();
    return { payload, detachedSignature, publicKey, fingerprint };
  }

  it('accepts when detached signature verifies with pinned key and fingerprint', async () => {
    const data = await makeSignedPayload();
    const r = await verifyCommit({
      verification: {
        verified: true,
        signature: data.detachedSignature,
        payload: data.payload,
      },
    }, {
      trustedSigners: [data.fingerprint],
      trustedSignerPublicKeys: [data.publicKey],
      allowUnpinned: false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.signerFingerprint, data.fingerprint);
  });

  it('rejects when only short key-id pin is supplied', async () => {
    const data = await makeSignedPayload();
    const shortPin = data.fingerprint.slice(-16);
    const r = await verifyCommit({
      verification: {
        verified: true,
        signature: data.detachedSignature,
        payload: data.payload,
      },
    }, {
      trustedSigners: [shortPin],
      trustedSignerPublicKeys: [data.publicKey],
      allowUnpinned: false,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /full 40-hex/);
  });

  it('rejects when signature payload is missing', async () => {
    const data = await makeSignedPayload();
    const r = await verifyCommit({
      verification: {
        verified: true,
      },
    }, {
      trustedSigners: [data.fingerprint],
      trustedSignerPublicKeys: [data.publicKey],
      allowUnpinned: false,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /missing detached signature payload/);
  });

  it('rejects when pinned fingerprint does not match verifying key', async () => {
    const data = await makeSignedPayload();
    const r = await verifyCommit({
      verification: {
        verified: true,
        signature: data.detachedSignature,
        payload: data.payload,
      },
    }, {
      trustedSigners: ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
      trustedSignerPublicKeys: [data.publicKey],
      allowUnpinned: false,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /unpinned signer/);
  });


  it('rejects when signer fingerprint is revoked', async () => {
    const data = await makeSignedPayload();
    const r = await verifyCommit({
      verification: {
        verified: true,
        signature: data.detachedSignature,
        payload: data.payload,
      },
    }, {
      trustedSigners: [data.fingerprint],
      trustedSignerPublicKeys: [data.publicKey],
      revokedSigners: [data.fingerprint],
      allowUnpinned: false,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /revoked signer/);
  });

  it('rejects tampered payload with a valid detached signature fixture', async () => {
    const data = await makeSignedPayload();
    const r = await verifyCommit({
      verification: {
        verified: true,
        signature: data.detachedSignature,
        payload: `${data.payload}tampered`,
      },
    }, {
      trustedSigners: [data.fingerprint],
      trustedSignerPublicKeys: [data.publicKey],
      allowUnpinned: false,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /signature verification failed/);
  });

  it('explicitly allows unpinned mode only when opted-in', async () => {
    const r = await verifyCommit({
      verification: { verified: true },
    }, {
      trustedSigners: [],
      trustedSignerPublicKeys: [],
      allowUnpinned: true,
    });
    assert.equal(r.ok, true);
  });
});
