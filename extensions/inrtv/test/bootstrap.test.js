'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const scriptPath = path.join(ROOT, 'bootstrap.sh');

describe('bootstrap.sh', () => {
  const content = fs.readFileSync(scriptPath, 'utf8');

  it('exists and is executable', () => {
    assert.ok(fs.existsSync(scriptPath));
    const stat = fs.statSync(scriptPath);
    assert.ok(stat.mode & 0o111, 'bootstrap.sh must be executable');
  });

  it('uses set -euo pipefail', () => {
    assert.ok(content.includes('set -euo pipefail'),
      'must use strict bash error handling');
  });

  it('contains a 64-character hex SHA-256 hash', () => {
    const hashMatch = content.match(/HLS_SHA256=["']([a-f0-9]+)["']/);
    assert.ok(hashMatch, 'must define HLS_SHA256');
    assert.equal(hashMatch[1].length, 64, 'SHA-256 must be 64 hex chars');
  });

  it('downloads from npm registry', () => {
    assert.ok(content.includes('registry.npmjs.org'),
      'must download from npm registry');
  });

  it('verifies checksum before writing output', () => {
    const shaCheckIdx = content.indexOf('sha256sum');
    const writeIdx = content.indexOf('cat -');
    assert.ok(shaCheckIdx > -1, 'must call sha256sum');
    assert.ok(writeIdx > -1, 'must write output file');
    assert.ok(shaCheckIdx < writeIdx,
      'SHA-256 check must happen before writing output');
  });

  it('strips sourcemap reference', () => {
    assert.ok(content.includes('sourceMappingURL'),
      'must strip sourcemap reference');
  });

  it('prepends license banner', () => {
    assert.ok(content.includes('Apache-2.0 License'),
      'must include license banner text');
  });

  it('pins a specific version', () => {
    const versionMatch = content.match(/HLS_VERSION=["'](\d+\.\d+\.\d+)["']/);
    assert.ok(versionMatch, 'must pin a specific semver version');
  });
});
