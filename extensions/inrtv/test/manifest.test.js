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

  it('host_permissions uses only https scheme', () => {
    assert.ok(Array.isArray(manifest.host_permissions));
    for (const hp of manifest.host_permissions) {
      assert.match(hp, /^https:\/\//, `host_permission "${hp}" must use https://`);
    }
  });

  it('host_permissions contains only the stream domain', () => {
    assert.equal(manifest.host_permissions.length, 1);
    assert.equal(manifest.host_permissions[0], 'https://hls.irannrtv.live/*');
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
    assert.ok(csp.includes("script-src 'self'"), 'CSP must restrict script-src to self');
    assert.ok(csp.includes("object-src 'none'"), 'CSP must block object-src');
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
});
