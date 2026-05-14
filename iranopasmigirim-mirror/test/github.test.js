'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMessage, generateKey, readPrivateKey, sign } from 'openpgp';
import { commitTextFileToBranch, verifyCommit } from '../src/background/github.js';

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

describe('commitTextFileToBranch: GitHub Contents API writer', () => {
  function mockFetch(handler) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => handler(String(url), options);
    return () => { globalThis.fetch = previousFetch; };
  }

  function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('creates a missing branch and commits a new text file', async () => {
    const calls = [];
    const restoreFetch = mockFetch(async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/git/ref/heads/requests')) return jsonResponse({ message: 'Not Found' }, 404);
      if (url.endsWith('/repos/example/repo')) return jsonResponse({ default_branch: 'main' });
      if (url.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'base-sha' } });
      if (url.endsWith('/git/refs')) return jsonResponse({ ref: 'refs/heads/requests' }, 201);
      if (url.includes('/contents/requests/foo.json?ref=requests')) return jsonResponse({ message: 'Not Found' }, 404);
      if (url.endsWith('/contents/requests/foo.json')) {
        const body = JSON.parse(options.body);
        assert.equal(options.method, 'PUT');
        assert.equal(options.headers.Authorization, 'Bearer token-123');
        assert.equal(body.message, 'register: req');
        assert.equal(body.branch, 'requests');
        assert.equal(atob(body.content), 'hello\n');
        return jsonResponse({ content: { sha: 'file-sha' }, commit: { sha: 'commit-sha' } }, 201);
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    try {
      const result = await commitTextFileToBranch({
        repoUrl: 'https://github.com/example/repo',
        branch: 'requests',
        path: 'requests/foo.json',
        content: 'hello\n',
        message: 'register: req',
        token: 'token-123',
      });
      assert.equal(result.skipped, false);
      assert.equal(result.commitSha, 'commit-sha');
      assert.equal(calls.length, 6);
    } finally {
      restoreFetch();
    }
  });

  it('skips when the remote file already has the same content', async () => {
    const restoreFetch = mockFetch(async (url) => {
      if (url.endsWith('/git/ref/heads/requests')) return jsonResponse({ object: { sha: 'branch-sha' } });
      if (url.includes('/contents/_mirror/challenges/req.txt?ref=requests')) {
        return jsonResponse({ type: 'file', sha: 'same-sha', content: btoa('nonce\n') });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    try {
      const result = await commitTextFileToBranch({
        repoUrl: 'https://github.com/example/repo',
        branch: 'requests',
        path: '_mirror/challenges/req.txt',
        content: 'nonce\n',
        message: 'proof: req',
        token: 'token-123',
      });
      assert.equal(result.skipped, true);
      assert.equal(result.sha, 'same-sha');
    } finally {
      restoreFetch();
    }
  });
});
