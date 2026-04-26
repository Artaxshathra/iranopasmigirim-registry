'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'config.xml');
const xml = fs.readFileSync(CONFIG, 'utf8');

describe('tv-web Tizen: config.xml', () => {
  it('declares both required namespaces (w3.org widgets + tizen)', () => {
    assert.match(xml, /xmlns="http:\/\/www\.w3\.org\/ns\/widgets"/);
    assert.match(xml, /xmlns:tizen="http:\/\/tizen\.org\/ns\/widgets"/);
  });

  it('declares a tizen:application id and matching package id', () => {
    // The 10-char string before the dot in tizen:application@id MUST equal
    // tizen:application@package — Tizen rejects the .wgt otherwise.
    const m = xml.match(/<tizen:application\s+id="([^"]+)"\s+package="([^"]+)"/);
    assert.ok(m, 'tizen:application must declare id + package');
    const [, appId, pkgId] = m;
    assert.equal(appId.split('.')[0], pkgId,
      'app id prefix must equal package id');
    assert.equal(pkgId.length, 10, 'Tizen package id must be exactly 10 chars');
  });

  it('targets TV (tv-samsung profile) and a sane minimum platform', () => {
    assert.match(xml, /<tizen:profile\s+name="tv-samsung"/);
    const m = xml.match(/required_version="([^"]+)"/);
    assert.ok(m);
    const major = Number(m[1].split('.')[0]);
    assert.ok(major >= 6, 'targeting Tizen TV 6.0+ keeps us on 2021+ TVs');
  });

  it('locks landscape and disables features the app does not need', () => {
    assert.match(xml, /screen-orientation="landscape"/);
    assert.match(xml, /background-support="disable"/);
    assert.match(xml, /encryption="disable"/);
  });

  it('whitelists exactly the stream origin (matches CSP)', () => {
    // Must agree with the meta CSP: any drift means the WebView allows
    // origins the page would block, or vice versa.
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const cspMatch = html.match(/Content-Security-Policy["'][^>]+content=("([^"]+)"|'([^']+)')/);
    const csp = cspMatch[2] || cspMatch[3];
    const cspOrigin = csp.match(/connect-src[^;]*?(https:\/\/[^\s;]+)/)[1];
    assert.match(xml, new RegExp(`<access\\s+origin="${cspOrigin.replace(/\./g, '\\.')}"`));
  });

  it('points content at index.html and an icon that exists', () => {
    assert.match(xml, /<content\s+src="index\.html"/);
    const iconMatch = xml.match(/<icon\s+src="([^"]+)"/);
    assert.ok(iconMatch);
    assert.ok(fs.existsSync(path.join(ROOT, iconMatch[1])),
      `icon "${iconMatch[1]}" must exist at project root`);
  });
});

describe('tv-web Tizen: build artifact (only if dist/ exists)', () => {
  const wgt = path.join(ROOT, 'dist', 'inrtv-tizen.wgt');

  it('skips when dist/inrtv-tizen.wgt is absent (tests must not require build)', (t) => {
    if (!fs.existsSync(wgt)) {
      t.skip('run `npm run build` to materialize dist/');
      return;
    }
    // .wgt is a zip — its first two bytes are 'PK' (50 4b).
    const head = fs.readFileSync(wgt).subarray(0, 2);
    assert.equal(head.toString('ascii'), 'PK', '.wgt must be a valid zip');
  });
});
