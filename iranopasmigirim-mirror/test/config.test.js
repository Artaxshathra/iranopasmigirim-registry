'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as cfg from '../src/config.js';

describe('config: invariants', () => {
  it('SERVE_PATH starts and ends with /', () => {
    assert.match(cfg.SERVE_PATH, /^\/.*\/$/);
  });

  it('poll cadence is sensible', () => {
    assert.ok(cfg.POLL_INTERVAL_MINUTES >= 1, 'too aggressive');
    assert.ok(cfg.POLL_INTERVAL_MINUTES <= 60, 'too lazy');
    assert.ok(cfg.MAX_BACKOFF_MINUTES >= cfg.POLL_INTERVAL_MINUTES);
    assert.ok(cfg.MAINTENANCE_INTERVAL_HOURS >= 1, 'maintenance interval too aggressive');
    assert.ok(cfg.MAINTENANCE_INTERVAL_HOURS <= 24 * 14, 'maintenance interval too lazy');
  });

  it('size and count caps are sane', () => {
    assert.ok(cfg.MAX_FILE_SIZE_BYTES > 0);
    assert.ok(cfg.MAX_FILE_SIZE_BYTES <= 50 * 1024 * 1024,
      'huge per-file cap defeats the point');
    assert.ok(cfg.MAX_FILES_PER_SYNC > 100);
  });

  it('TRUSTED_SIGNERS is an array', () => {
    assert.ok(Array.isArray(cfg.TRUSTED_SIGNERS));
  });

  it('every TRUSTED_SIGNERS entry looks like a hex fingerprint', () => {
    for (const s of cfg.TRUSTED_SIGNERS) {
      const norm = s.toUpperCase().replace(/\s+/g, '');
      assert.match(norm, /^[0-9A-F]{40}$/, `bad fingerprint: ${s}`);
    }
  });

  it('protocol branches are non-empty strings', () => {
    assert.equal(typeof cfg.REQUESTS_BRANCH, 'string');
    assert.equal(typeof cfg.CONTENT_BRANCH, 'string');
    assert.equal(typeof cfg.REGISTRY_BRANCH, 'string');
    assert.ok(cfg.REQUESTS_BRANCH.length > 0);
    assert.ok(cfg.CONTENT_BRANCH.length > 0);
    assert.ok(cfg.REGISTRY_BRANCH.length > 0);
  });

  it('registry and manifest constants are configured', () => {
    assert.equal(typeof cfg.REGISTRY_REPO_URL, 'string');
    assert.equal(typeof cfg.MIRROR_MANIFEST_PATH, 'string');
    assert.equal(typeof cfg.DEFAULT_ENTRY_PATH, 'string');
    assert.match(cfg.REGISTRY_REPO_URL, /^https:\/\/github\.com\/.+\/.+/i);
    assert.ok(cfg.MIRROR_MANIFEST_PATH.includes('/'));
    assert.ok(!cfg.DEFAULT_ENTRY_PATH.startsWith('/'));
  });

  it('production gate: ALLOW_UNPINNED_SIGNATURES is a boolean', () => {
    assert.equal(typeof cfg.ALLOW_UNPINNED_SIGNATURES, 'boolean');
    assert.equal(cfg.ALLOW_UNPINNED_SIGNATURES, false,
      'ALLOW_UNPINNED_SIGNATURES must remain false in hardened builds');
  });
});
