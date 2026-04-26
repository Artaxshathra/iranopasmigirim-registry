'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LOCALES = path.join(__dirname, '..', '_locales');

describe('tv-web locales', () => {
  it('en and fa exist with identical key sets and non-empty messages', () => {
    const en = JSON.parse(fs.readFileSync(path.join(LOCALES, 'en', 'messages.json'), 'utf8'));
    const fa = JSON.parse(fs.readFileSync(path.join(LOCALES, 'fa', 'messages.json'), 'utf8'));
    assert.deepEqual(Object.keys(en).sort(), Object.keys(fa).sort(),
      'en and fa must define the same message keys');
    for (const k of Object.keys(en)) {
      assert.ok(en[k].message && en[k].message.length > 0, `en[${k}] empty`);
      assert.ok(fa[k].message && fa[k].message.length > 0, `fa[${k}] empty`);
    }
  });
});
