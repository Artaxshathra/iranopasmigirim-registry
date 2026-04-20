'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'src', 'lib', 'hls.min.js');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function have(cmd) {
  try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// Stage the extension source + build script + LICENSE into an isolated copy
// so this test does not race with build.test.js over the shared ROOT/dist.
function stage() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inrtv-repro-'));
  execSync(`cp -r "${path.join(ROOT, 'src')}" "${tmp}/src"`);
  execSync(`cp "${path.join(ROOT, 'build.sh')}" "${tmp}/build.sh"`);
  execSync(`cp "${path.join(ROOT, 'LICENSE')}" "${tmp}/LICENSE"`);
  return tmp;
}

describe('reproducible builds', () => {
  it('build.sh produces byte-identical zips across runs', { skip: !fs.existsSync(LIB) || !have('zip') }, () => {
    const a = stage();
    const b = stage();
    try {
      execSync(`bash "${path.join(a, 'build.sh')}"`, { cwd: a, stdio: 'ignore' });
      execSync(`bash "${path.join(b, 'build.sh')}"`, { cwd: b, stdio: 'ignore' });

      const chromeA = sha256(path.join(a, 'dist', 'inrtv-chrome.zip'));
      const chromeB = sha256(path.join(b, 'dist', 'inrtv-chrome.zip'));
      const firefoxA = sha256(path.join(a, 'dist', 'inrtv-firefox.zip'));
      const firefoxB = sha256(path.join(b, 'dist', 'inrtv-firefox.zip'));

      assert.equal(chromeA, chromeB, 'Chrome zip must be byte-identical across runs');
      assert.equal(firefoxA, firefoxB, 'Firefox zip must be byte-identical across runs');
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });
});
