'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const chrome  = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'),         'utf8'));
const firefox = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest_firefox.json'), 'utf8'));

describe('manifest: chrome MV3', () => {
  it('declares MV3', () => {
    assert.equal(chrome.manifest_version, 3);
  });

  it('uses a module-type service worker', () => {
    assert.ok(chrome.background, 'background section missing');
    assert.equal(chrome.background.type, 'module');
    assert.equal(chrome.background.service_worker, 'background.js');
  });

  it('requests exactly the permissions the SW uses', () => {
    // Anything beyond this list is a Chrome-store red flag. Don't ask for
    // 'tabs' or 'scripting' — we don't need them.
    const expected = ['alarms', 'storage'];
    for (const p of expected) assert.ok(chrome.permissions.includes(p), `missing permission: ${p}`);
    for (const p of chrome.permissions) assert.ok(expected.includes(p), `unexpected permission: ${p}`);
  });

  it('host permissions are scoped to GitHub only', () => {
    // No wildcards beyond what's needed. raw + api are the data plane.
    const required = [
      'https://api.github.com/*',
      'https://raw.githubusercontent.com/*',
    ];
    for (const h of required) assert.ok(chrome.host_permissions.includes(h), `missing host: ${h}`);
    for (const h of chrome.host_permissions) {
      assert.ok(/^(\*|https?):\/\/.+\/\*$/.test(h), `host pattern looks wrong: ${h}`);
    }
  });

  it('CSP forbids inline scripts in extension pages', () => {
    const csp = chrome.content_security_policy.extension_pages;
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp),
      'extension pages must not allow inline script');
    assert.ok(!/script-src[^;]*'unsafe-eval'/.test(csp),
      'extension pages must not allow eval');
    assert.match(csp, /object-src 'none'/);
  });

  it('CSP allows connect to GitHub data plane only', () => {
    const csp = chrome.content_security_policy.extension_pages;
    assert.match(csp, /connect-src[^;]*'self'/);
    assert.match(csp, /connect-src[^;]*api\.github\.com/);
    assert.match(csp, /connect-src[^;]*raw\.githubusercontent\.com/);
  });

});

describe('manifest: firefox MV2', () => {
  it('declares MV2', () => {
    assert.equal(firefox.manifest_version, 2);
  });

  it('declares a stable extension id (required for Firefox installs)', () => {
    assert.ok(firefox.browser_specific_settings.gecko.id);
    assert.match(firefox.browser_specific_settings.gecko.id, /@/);
  });

  it('has parity on host permissions with chrome', () => {
    for (const h of [
      'https://api.github.com/*',
      'https://raw.githubusercontent.com/*',
    ]) {
      assert.ok(firefox.permissions.includes(h), `firefox missing host: ${h}`);
    }
  });
});

describe('manifest: parity', () => {
  it('name / description / version match across both files', () => {
    assert.equal(chrome.name,        firefox.name);
    assert.equal(chrome.description, firefox.description);
    assert.equal(chrome.version,     firefox.version);
  });
});
