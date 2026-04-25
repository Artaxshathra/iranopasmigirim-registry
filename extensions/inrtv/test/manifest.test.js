'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));

describe('manifest.json', () => {
  it('is valid JSON with required MV3 fields', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.name, 'name is required');
    assert.ok(manifest.version, 'version is required');
    assert.ok(manifest.description, 'description is required');
  });

  it('uses i18n message references for name and description', () => {
    assert.match(manifest.name, /^__MSG_\w+__$/);
    assert.match(manifest.description, /^__MSG_\w+__$/);
  });

  it('has default_locale matching _locales directory', () => {
    assert.equal(manifest.default_locale, 'en');
    const localeDir = path.join(SRC, '_locales', 'en');
    assert.ok(fs.existsSync(localeDir), '_locales/en/ must exist');
    const messages = JSON.parse(fs.readFileSync(path.join(localeDir, 'messages.json'), 'utf8'));
    const nameKey = manifest.name.replace(/^__MSG_/, '').replace(/__$/, '');
    const descKey = manifest.description.replace(/^__MSG_/, '').replace(/__$/, '');
    assert.ok(messages[nameKey], `messages.json must define "${nameKey}"`);
    assert.ok(messages[descKey], `messages.json must define "${descKey}"`);
  });

  it('declares no permissions', () => {
    assert.equal(manifest.permissions, undefined, 'permissions array must not exist');
  });

  it('declares no host_permissions', () => {
    // CSP connect-src/media-src pins the stream host; host_permissions would
    // trigger Firefox's "Can't read and change data on this site" without
    // adding any real capability for this extension.
    assert.equal(manifest.host_permissions, undefined,
      'host_permissions must not exist — CSP alone constrains network egress');
  });

  it('has no background script or service worker', () => {
    assert.equal(manifest.background, undefined);
  });

  it('has no content_scripts', () => {
    assert.equal(manifest.content_scripts, undefined);
  });

  it('has no web_accessible_resources', () => {
    assert.equal(manifest.web_accessible_resources, undefined);
  });

  it('CSP blocks inline scripts and objects', () => {
    const csp = manifest.content_security_policy?.extension_pages;
    assert.ok(csp, 'CSP must be defined');
    assert.match(csp, /script-src\s+'self'\s*;/, "CSP script-src must be exactly 'self' (no remote origins — MV3 forbids them)");
    assert.ok(csp.includes("object-src 'none'"), 'CSP must block object-src');
  });

  it("script-src is locked to 'self' only — no remote origins (MV3 rejects them)", () => {
    const csp = manifest.content_security_policy.extension_pages;
    const scriptSrc = csp.match(/script-src\s+([^;]+)/)[1].trim();
    assert.equal(scriptSrc, "'self'",
      "All scripts must be local — Chrome MV3 rejects any remote script origin");
  });

  it('version is 1.2.2', () => {
    assert.equal(manifest.version, '1.2.2', 'manifest version must be 1.2.2');
  });

  it('CSP includes base-uri and frame-ancestors', () => {
    const csp = manifest.content_security_policy.extension_pages;
    assert.ok(csp.includes("base-uri 'self'"), 'CSP must include base-uri self');
    assert.ok(csp.includes("frame-ancestors 'none'"), 'CSP must include frame-ancestors none');
  });

  it('CSP does not allow unsafe-inline or unsafe-eval', () => {
    const csp = manifest.content_security_policy.extension_pages;
    assert.ok(!csp.includes('unsafe-inline'), 'CSP must not allow unsafe-inline');
    assert.ok(!csp.includes('unsafe-eval'), 'CSP must not allow unsafe-eval');
  });

  it('CSP pins connect-src and media-src to the stream host', () => {
    const csp = manifest.content_security_policy.extension_pages;
    assert.ok(csp.includes('connect-src'), 'CSP must define connect-src');
    assert.ok(csp.includes('media-src https://hls.irannrtv.live'),
      'CSP media-src must pin the stream host');
    assert.ok(/connect-src[^;]*https:\/\/hls\.irannrtv\.live/.test(csp),
      'CSP connect-src must include the stream host');
  });

  it("CSP worker-src is 'self' with no blob: (MV3 forbids blob: in worker-src)", () => {
    const csp = manifest.content_security_policy.extension_pages;
    assert.ok(/worker-src\s+'self'(?![^;]*blob:)/.test(csp),
      "CSP worker-src must be 'self' only — MV3 rejects blob: here; hls.js runs on main thread");
  });

  it('all declared icon files exist', () => {
    const iconPaths = new Set();
    if (manifest.icons) Object.values(manifest.icons).forEach(p => iconPaths.add(p));
    if (manifest.action?.default_icon) Object.values(manifest.action.default_icon).forEach(p => iconPaths.add(p));
    for (const iconPath of iconPaths) {
      assert.ok(fs.existsSync(path.join(SRC, iconPath)), `icon file "${iconPath}" must exist`);
    }
  });

  it('popup file exists', () => {
    const popup = manifest.action?.default_popup;
    assert.ok(popup);
    assert.ok(fs.existsSync(path.join(SRC, popup)), `popup file "${popup}" must exist`);
  });

  it('version follows semver format', () => {
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  });

  it('en and fa locales exist with identical key sets', () => {
    const en = JSON.parse(fs.readFileSync(path.join(SRC, '_locales', 'en', 'messages.json'), 'utf8'));
    const fa = JSON.parse(fs.readFileSync(path.join(SRC, '_locales', 'fa', 'messages.json'), 'utf8'));
    assert.deepEqual(Object.keys(en).sort(), Object.keys(fa).sort(),
      'en and fa locales must define the same message keys');
    for (const key of Object.keys(en)) {
      assert.ok(fa[key].message && fa[key].message.length > 0,
        `fa locale must provide a non-empty message for "${key}"`);
    }
  });
});
