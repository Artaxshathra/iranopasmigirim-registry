'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  gitBlobShaHex,
  isQuotaError,
  parseSnapshotManifestBuffer,
  shouldRunMaintenance,
  validateSnapshotManifest,
} from '../src/background/sync.js';

describe('sync: git blob hashing', () => {
  it('matches git hash-object for known content', async () => {
    const buf = new TextEncoder().encode('hello\n').buffer;
    const sha = await gitBlobShaHex(buf);
    assert.equal(sha, 'ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('sync: quota detection', () => {
  it('detects QuotaExceededError by name', () => {
    assert.equal(isQuotaError({ name: 'QuotaExceededError' }), true);
  });

  it('detects quota wording in message', () => {
    assert.equal(isQuotaError(new Error('quota exceeded while writing')), true);
  });

  it('does not false-positive on regular errors', () => {
    assert.equal(isQuotaError(new Error('network failed')), false);
  });
});

describe('sync: maintenance scheduling', () => {
  it('runs when no previous timestamp exists', () => {
    assert.equal(shouldRunMaintenance(0, 1000), true);
    assert.equal(shouldRunMaintenance(null, 1000), true);
  });

  it('does not run before interval elapsed', () => {
    const hour = 60 * 60 * 1000;
    assert.equal(shouldRunMaintenance(10 * hour, 10 * hour + 23 * hour), false);
  });

  it('runs after interval elapsed', () => {
    const hour = 60 * 60 * 1000;
    assert.equal(shouldRunMaintenance(10 * hour, 10 * hour + 24 * hour), true);
  });
});

describe('sync: snapshot manifest validation', () => {
  it('accepts well-formed manifest', () => {
    const meta = validateSnapshotManifest({
      siteHost: 'bbc.com',
      entryPath: 'news/index.html',
      requestId: 'req-123',
    });
    assert.equal(meta.siteHost, 'bbc.com');
    assert.equal(meta.entryPath, 'news/index.html');
    assert.equal(meta.requestId, 'req-123');
  });

  it('rejects manifest with missing siteHost', () => {
    assert.throws(() => {
      validateSnapshotManifest({ entryPath: 'index.html' });
    }, /missing siteHost/);
  });

  it('rejects malformed manifest JSON payload', () => {
    const bad = new TextEncoder().encode('{not-json').buffer;
    assert.throws(() => parseSnapshotManifestBuffer(bad), /not valid JSON/);
  });

  it('rejects oversized manifest payload', () => {
    const oversized = new ArrayBuffer((1024 * 1024) + 1);
    assert.throws(() => parseSnapshotManifestBuffer(oversized), /exceeds MAX_MANIFEST_SIZE_BYTES/);
  });
});
