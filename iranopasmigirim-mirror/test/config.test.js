'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as cfg from '../src/config.js';

describe('config: invariants', () => {
  it('SERVE_PATH starts and ends with /', () => {
    assert.match(cfg.SERVE_PATH, /^\/.*\/$/);
  });

  it('TARGET_HOST has no scheme and no path', () => {
    assert.ok(!cfg.TARGET_HOST.includes('://'));
    assert.ok(!cfg.TARGET_HOST.includes('/'));
    assert.match(cfg.TARGET_HOST, /^[a-z0-9.-]+$/i);
  });

  it('poll cadence is sensible', () => {
    assert.ok(cfg.POLL_INTERVAL_MINUTES >= 1, 'too aggressive');
    assert.ok(cfg.POLL_INTERVAL_MINUTES <= 60, 'too lazy');
    assert.ok(cfg.MAX_BACKOFF_MINUTES >= cfg.POLL_INTERVAL_MINUTES);
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
      assert.match(norm, /^[0-9A-F]{16,40}$/, `bad fingerprint: ${s}`);
    }
  });

  it('production gate: ALLOW_UNPINNED_SIGNATURES is a boolean', () => {
    assert.equal(typeof cfg.ALLOW_UNPINNED_SIGNATURES, 'boolean');
    // We allow it to be true during dev — the config comment explains the
    // production gate. This test just pins the type so a typo can't
    // silently turn verification off.
  });
});
