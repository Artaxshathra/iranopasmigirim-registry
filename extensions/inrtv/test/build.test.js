'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Helper: list files in a zip
function zipList(zipPath) {
  const out = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
  return out.split('\n')
    .map(line => line.trim().split(/\s+/).pop())
    .filter(f => f && !f.startsWith('-') && !f.startsWith('Name') && !f.startsWith('Archive') && f !== '');
}

// Helper: read a file from inside a zip
function zipRead(zipPath, innerPath) {
  return execSync(`unzip -p "${zipPath}" "${innerPath}"`, { encoding: 'utf8' });
}

describe('build output', () => {
  before(() => {
    // Run build
    execSync('bash build.sh', { cwd: ROOT, stdio: 'pipe' });
  });

  describe('Chrome zip', () => {
    const zipPath = path.join(DIST, 'inrtv-chrome.zip');

    it('exists', () => {
      assert.ok(fs.existsSync(zipPath), 'inrtv-chrome.zip must exist');
    });

    it('contains all required source files', () => {
      const files = zipList(zipPath);
      const required = [
        'manifest.json',
        'popup.html', 'popup.js', 'popup.css',
        'player.html', 'player.js', 'player.css',
      ];
      for (const f of required) {
        assert.ok(files.some(z => z.endsWith(f)), `Chrome zip must contain ${f}`);
      }
    });

    it('contains hls.min.js', () => {
      const files = zipList(zipPath);
      assert.ok(files.some(f => f.includes('hls.min.js')), 'must contain hls.min.js');
    });

    it('contains locale files', () => {
      const files = zipList(zipPath);
      assert.ok(files.some(f => f.includes('_locales/en/messages.json')),
        'must contain English locale');
    });

    it('contains icon files', () => {
      const files = zipList(zipPath);
      assert.ok(files.some(f => f.includes('icons/icon128.png')));
    });

    it('does not contain .DS_Store', () => {
      const files = zipList(zipPath);
      assert.ok(!files.some(f => f.includes('.DS_Store')),
        'must not contain .DS_Store');
    });

    it('hls.min.js starts with license banner', () => {
      const hlsContent = zipRead(zipPath, 'lib/hls.min.js');
      assert.match(hlsContent, /^\/\*! hls\.js v[\d.]+ \| Apache-2\.0/,
        'hls.min.js must start with license banner');
    });

    it('manifest in zip is valid JSON', () => {
      const m = JSON.parse(zipRead(zipPath, 'manifest.json'));
      assert.equal(m.manifest_version, 3);
    });
  });

  describe('Firefox zip', () => {
    const zipPath = path.join(DIST, 'inrtv-firefox.zip');

    it('exists', () => {
      assert.ok(fs.existsSync(zipPath), 'inrtv-firefox.zip must exist');
    });

    it('includes LICENSE file', () => {
      const files = zipList(zipPath);
      assert.ok(files.some(f => f === 'LICENSE' || f.endsWith('/LICENSE')),
        'Firefox zip must include LICENSE');
    });

    it('manifest has browser_specific_settings.gecko', () => {
      const m = JSON.parse(zipRead(zipPath, 'manifest.json'));
      assert.ok(m.browser_specific_settings?.gecko,
        'Firefox manifest must have gecko settings');
    });

    it('gecko has id and strict_min_version', () => {
      const m = JSON.parse(zipRead(zipPath, 'manifest.json'));
      const gecko = m.browser_specific_settings.gecko;
      assert.ok(gecko.id, 'gecko must have id');
      assert.ok(gecko.strict_min_version, 'gecko must have strict_min_version');
    });

    it('does not contain .DS_Store', () => {
      const files = zipList(zipPath);
      assert.ok(!files.some(f => f.includes('.DS_Store')));
    });

    it('contains all required source files', () => {
      const files = zipList(zipPath);
      const required = [
        'manifest.json',
        'popup.html', 'popup.js', 'popup.css',
        'player.html', 'player.js', 'player.css',
      ];
      for (const f of required) {
        assert.ok(files.some(z => z.endsWith(f)), `Firefox zip must contain ${f}`);
      }
    });

    it('hls.min.js starts with license banner', () => {
      const hlsContent = zipRead(zipPath, 'lib/hls.min.js');
      assert.match(hlsContent, /^\/\*! hls\.js v[\d.]+ \| Apache-2\.0/);
    });
  });
});
