'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { submitRegistrationViaEndpoint } from '../src/background/registration-api.js';
import {
  buildCommitInstructions,
  createRegistrationDraft,
} from '../src/background/registration.js';

describe('registration-api: hosted submission', () => {
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

  it('posts the complete registration package to the configured endpoint', async () => {
    const draft = createRegistrationDraft({
      userRepoUrl: 'https://github.com/example/user-mirror',
      requestedUrl: 'https://bbc.com/news',
      now: 1700000000000,
    });
    const instructions = buildCommitInstructions(draft);
    const restoreFetch = mockFetch(async (url, options) => {
      assert.equal(url, 'https://requests.example.test/register');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Accept, 'application/json');
      const body = JSON.parse(options.body);
      assert.equal(body.requestId, draft.requestId);
      assert.equal(body.userRepoUrl, draft.userRepoUrl);
      assert.equal(body.requestedUrl, draft.requestedUrl);
      assert.equal(body.files.registryRequest.path, instructions.step1.path);
      assert.equal(body.files.ownershipProof.path, instructions.step2.path);
      assert.equal(body.files.ownershipProof.content, instructions.step2.content);
      return jsonResponse({ ok: true, accepted: true });
    });

    try {
      const result = await submitRegistrationViaEndpoint({
        endpoint: 'https://requests.example.test/register',
        draft,
        instructions,
      });
      assert.equal(result.accepted, true);
    } finally {
      restoreFetch();
    }
  });

  it('surfaces request service errors clearly', async () => {
    const draft = createRegistrationDraft({
      userRepoUrl: 'https://github.com/example/user-mirror',
      requestedUrl: 'https://bbc.com/news',
      now: 1700000000000,
    });
    const instructions = buildCommitInstructions(draft);
    const restoreFetch = mockFetch(async () => jsonResponse({ ok: false, error: 'host is not allowed' }, 403));

    try {
      await assert.rejects(
        submitRegistrationViaEndpoint({
          endpoint: 'https://requests.example.test/register',
          draft,
          instructions,
        }),
        /Request service failed: host is not allowed/,
      );
    } finally {
      restoreFetch();
    }
  });
});