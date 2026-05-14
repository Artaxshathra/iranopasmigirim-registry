'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommitInstructions,
  canonicalRepoUrl,
  createRegistrationDraft,
  mergeRegistrationRemoteState,
  parseRequestedSite,
} from '../src/background/registration.js';

describe('registration: repo/url normalization', () => {
  it('canonicalizes GitHub HTTPS and SSH URLs', () => {
    assert.equal(
      canonicalRepoUrl('https://github.com/foo/bar.git'),
      'https://github.com/foo/bar'
    );
    assert.equal(
      canonicalRepoUrl('git@github.com:foo/bar.git'),
      'https://github.com/foo/bar'
    );
  });

  it('parses only HTTPS requested URLs', () => {
    const parsed = parseRequestedSite('https://www.bbc.com/news');
    assert.equal(parsed.siteHost, 'bbc.com');
    assert.equal(parsed.origin, 'https://www.bbc.com');
    assert.throws(() => parseRequestedSite('http://bbc.com/news'), /https/);
  });
});

describe('registration: draft and instruction generation', () => {
  it('creates a draft with stable structure', () => {
    const draft = createRegistrationDraft({
      userRepoUrl: 'https://github.com/example/user-mirror',
      requestedUrl: 'https://bbc.com/news',
      now: 1700000000000,
    });

    assert.match(draft.requestId, /^req-\d+-[0-9a-f]{12}$/);
    assert.equal(draft.userRepoUrl, 'https://github.com/example/user-mirror');
    assert.equal(draft.siteHost, 'bbc.com');
    assert.equal(draft.registry.state, 'draft');
    assert.equal(draft.ownership.branch.length > 0, true);
    assert.equal(draft.delivery.producerFingerprint, null);
    assert.match(draft.ownership.challengePath, /^_mirror\/challenges\/.+\.txt$/);
  });

  it('builds two commit instructions with expected paths', () => {
    const draft = createRegistrationDraft({
      userRepoUrl: 'https://github.com/example/user-mirror',
      requestedUrl: 'https://bbc.com/news',
      now: 1700000000000,
    });
    const instructions = buildCommitInstructions(draft);

    assert.equal(typeof instructions.step1.content, 'string');
    assert.equal(typeof instructions.step2.content, 'string');
    assert.match(instructions.step1.path, /^requests\//);
    assert.match(instructions.step2.path, /^_mirror\/challenges\//);
    assert.match(instructions.step1.commitMessage, /^register:/);
    assert.match(instructions.step2.commitMessage, /^proof:/);
  });
});

describe('registration: remote-state merge', () => {
  it('marks ownership verified when challenge text matches nonce', () => {
    const draft = createRegistrationDraft({
      userRepoUrl: 'https://github.com/example/user-mirror',
      requestedUrl: 'https://bbc.com/news',
      now: 1700000000000,
    });

    const updated = mergeRegistrationRemoteState(
      draft,
      {
        state: 'approved',
        reason: 'ok',
        commitSha: 'a'.repeat(40),
        deliveryBranch: 'content',
        producerFingerprint: 'AA BB CC DD EE FF 00 11 22 33 44 55 66 77 88 99 AA BB CC DD',
      },
      `${draft.ownership.nonce}\n`,
      1700000005000,
    );

    assert.equal(updated.ownership.verified, true);
    assert.equal(updated.registry.state, 'approved');
    assert.equal(updated.delivery.ready, true);
    assert.equal(updated.delivery.commitSha, 'a'.repeat(40));
    assert.equal(updated.delivery.producerFingerprint, 'AABBCCDDEEFF00112233445566778899AABBCCDD');
  });

  it('keeps ownership unverified when challenge mismatch', () => {
    const draft = createRegistrationDraft({
      userRepoUrl: 'https://github.com/example/user-mirror',
      requestedUrl: 'https://bbc.com/news',
    });

    const updated = mergeRegistrationRemoteState(
      draft,
      { state: 'pending' },
      'wrong-nonce',
    );

    assert.equal(updated.ownership.verified, false);
    assert.equal(updated.registry.state, 'pending');
  });

  it('ignores malformed status fields and does not mark delivery ready', () => {
    const draft = createRegistrationDraft({
      userRepoUrl: 'https://github.com/example/user-mirror',
      requestedUrl: 'https://bbc.com/news',
    });

    const updated = mergeRegistrationRemoteState(
      draft,
      {
        state: 'APPROVED_BUT_TAMPERED',
        commitSha: 'not-a-sha',
        producerFingerprint: 'bad-fingerprint',
      },
      draft.ownership.nonce,
    );

    assert.equal(updated.registry.state, draft.registry.state);
    assert.equal(updated.delivery.commitSha, null);
    assert.equal(updated.delivery.ready, false);
    assert.equal(updated.delivery.producerFingerprint, null);
  });

  it('ignores short commit SHAs from remote status', () => {
    const draft = createRegistrationDraft({
      userRepoUrl: 'https://github.com/example/user-mirror',
      requestedUrl: 'https://bbc.com/news',
    });

    const updated = mergeRegistrationRemoteState(
      draft,
      {
        state: 'approved',
        commitSha: 'abc1234',
      },
      draft.ownership.nonce,
    );

    assert.equal(updated.delivery.commitSha, null);
    assert.equal(updated.delivery.ready, false);
  });
});
