'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..');
// Runtime files that ship in the .wgt — explicitly listed so build-time
// scripts (make-icon.js, etc.) at the project root are not mistaken for
// app code and audited under the same rules.
const RUNTIME_JS = ['player.js'];
const jsFiles = RUNTIME_JS.map(f => ({
  name: f,
  content: fs.readFileSync(path.join(SRC, f), 'utf8'),
}));

describe('tv-web security: JavaScript source', () => {
  it('never uses innerHTML', () => {
    for (const { name, content } of jsFiles) {
      assert.ok(!content.includes('innerHTML'), `${name} must not use innerHTML`);
    }
  });

  it('never uses outerHTML assignment', () => {
    for (const { name, content } of jsFiles) {
      assert.ok(!/\.outerHTML\s*=/.test(content), `${name} must not assign outerHTML`);
    }
  });

  it('never uses document.write', () => {
    for (const { name, content } of jsFiles) {
      assert.ok(!content.includes('document.write'), `${name}`);
    }
  });

  it('never uses eval()', () => {
    for (const { name, content } of jsFiles) {
      assert.ok(!/\beval\s*\(/.test(content), `${name}`);
    }
  });

  it('never uses new Function()', () => {
    for (const { name, content } of jsFiles) {
      assert.ok(!/new\s+Function\s*\(/.test(content), `${name}`);
    }
  });

  it('uses no http:// URLs (only https://)', () => {
    for (const { name, content } of jsFiles) {
      const matches = content.match(/http:\/\/[^\s'")`]+/g);
      assert.equal(matches, null, `${name}`);
    }
  });

  it('error display uses textContent (never innerHTML)', () => {
    const player = jsFiles.find(f => f.name === 'player.js');
    assert.ok(player.content.includes('errorMsg.textContent'));
  });
});

describe('tv-web security: bundled hls.js', () => {
  it('hls.min.js banner declares Apache-2.0 (matches extension)', () => {
    const banner = fs.readFileSync(path.join(SRC, 'lib', 'hls.min.js'), 'utf8').slice(0, 200);
    assert.match(banner, /Apache-2\.0/i);
  });

  it('hls.min.js is byte-identical to the extension copy (one audit covers both)', () => {
    // The TV app and the extension MUST ship the exact same hls.js bytes —
    // otherwise every supply-chain audit, store review, and reproducible-build
    // claim has to be done twice. Hashing both files asserts that invariant.
    const crypto = require('node:crypto');
    const tv = fs.readFileSync(path.join(SRC, 'lib', 'hls.min.js'));
    const ext = fs.readFileSync(path.join(__dirname, '..', '..', '..',
      'extensions', 'inrtv', 'src', 'lib', 'hls.min.js'));
    const tvHash = crypto.createHash('sha256').update(tv).digest('hex');
    const extHash = crypto.createHash('sha256').update(ext).digest('hex');
    assert.equal(tvHash, extHash,
      'apps/tv-web/lib/hls.min.js must be byte-identical to extensions/inrtv/src/lib/hls.min.js');
  });

  it('bootstrap.sh pins the same hls.js version as the extension', () => {
    // The two bootstrap scripts must agree on version + upstream SHA, or a
    // future re-fetch could silently drift one app off-version.
    const tv = fs.readFileSync(path.join(__dirname, '..', 'bootstrap.sh'), 'utf8');
    const ext = fs.readFileSync(path.join(__dirname, '..', '..', '..',
      'extensions', 'inrtv', 'bootstrap.sh'), 'utf8');
    const tvVer = tv.match(/HLS_VERSION="([^"]+)"/)[1];
    const extVer = ext.match(/HLS_VERSION="([^"]+)"/)[1];
    const tvSha = tv.match(/HLS_SHA256="([0-9a-f]+)"/)[1];
    const extSha = ext.match(/HLS_SHA256="([0-9a-f]+)"/)[1];
    assert.equal(tvVer, extVer, 'HLS_VERSION must match the extension');
    assert.equal(tvSha, extSha, 'HLS_SHA256 must match the extension');
  });
});
