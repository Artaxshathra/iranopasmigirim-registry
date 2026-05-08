'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gitBlobShaHex, isQuotaError } from '../src/background/sync.js';

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
