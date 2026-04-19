'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

// Read all source JS and HTML (excludes lib/)
function sourceFiles(ext) {
  return fs.readdirSync(SRC)
    .filter(f => f.endsWith(ext))
    .map(f => ({ name: f, content: fs.readFileSync(path.join(SRC, f), 'utf8') }));
}

const jsFiles = sourceFiles('.js');
const htmlFiles = sourceFiles('.html');
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));

describe('security: JavaScript source', () => {
  it('never uses innerHTML', () => {
    for (const { name, content } of jsFiles) {
      assert.ok(!content.includes('innerHTML'), `${name} must not use innerHTML`);
    }
  });

  it('never uses outerHTML assignment', () => {
    for (const { name, content } of jsFiles) {
      assert.ok(!content.match(/\.outerHTML\s*=/), `${name} must not assign outerHTML`);
    }
  });

  it('never uses document.write', () => {
    for (const { name, content } of jsFiles) {
      assert.ok(!content.includes('document.write'), `${name} must not use document.write`);
    }
  });

  it('never uses eval()', () => {
    for (const { name, content } of jsFiles) {
      // Match eval( but not ".eval" in comments or strings that are part of other words
      assert.ok(!content.match(/\beval\s*\(/), `${name} must not use eval()`);
    }
  });

  it('never uses new Function()', () => {
    for (const { name, content } of jsFiles) {
      assert.ok(!content.match(/new\s+Function\s*\(/), `${name} must not use new Function()`);
    }
  });

  it('uses no http:// URLs (only https://)', () => {
    for (const { name, content } of jsFiles) {
      const httpMatches = content.match(/http:\/\/[^\s'")`]+/g);
      assert.equal(httpMatches, null, `${name} must not contain http:// URLs`);
    }
  });

  it('uses textContent for error display (not innerHTML)', () => {
    const playerJs = jsFiles.find(f => f.name === 'player.js');
    assert.ok(playerJs, 'player.js must exist');
    assert.ok(playerJs.content.includes('errorMsg.textContent'),
      'error messages must use textContent');
  });
});

describe('security: HTML source', () => {
  it('has no external <script src="http...">', () => {
    for (const { name, content } of htmlFiles) {
      const externalScripts = content.match(/<script[^>]+src=["']https?:\/\//gi);
      assert.equal(externalScripts, null,
        `${name} must not load external scripts`);
    }
  });

  it('has no inline event handlers (onclick, onload, onerror, etc.)', () => {
    const handlerRe = /\s(onclick|onload|onerror|onsubmit|onmouseover|onfocus|onblur|onchange|onkeydown|onkeyup)\s*=/i;
    for (const { name, content } of htmlFiles) {
      assert.ok(!handlerRe.test(content),
        `${name} must not use inline event handlers`);
    }
  });

  it('has no http:// URLs in HTML (only https://)', () => {
    for (const { name, content } of htmlFiles) {
      const httpMatches = content.match(/http:\/\/[^\s'")`]+/g);
      assert.equal(httpMatches, null, `${name} must not contain http:// URLs`);
    }
  });

  it('has no <iframe> elements', () => {
    for (const { name, content } of htmlFiles) {
      assert.ok(!content.match(/<iframe/i), `${name} must not contain iframes`);
    }
  });
});

describe('security: stream URL ↔ host_permissions consistency', () => {
  it('stream URL domain matches host_permissions', () => {
    const playerJs = jsFiles.find(f => f.name === 'player.js');
    assert.ok(playerJs);
    const urlMatch = playerJs.content.match(/STREAM_URL\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(urlMatch, 'STREAM_URL must be defined');
    const streamUrl = new URL(urlMatch[1]);

    // host_permissions must cover the stream domain
    const covered = manifest.host_permissions.some(hp => {
      const hpUrl = new URL(hp.replace('/*', '/'));
      return hpUrl.hostname === streamUrl.hostname && hpUrl.protocol === streamUrl.protocol;
    });
    assert.ok(covered, `stream domain ${streamUrl.hostname} must be in host_permissions`);
  });

  it('stream URL uses https', () => {
    const playerJs = jsFiles.find(f => f.name === 'player.js');
    const urlMatch = playerJs.content.match(/STREAM_URL\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(urlMatch);
    assert.ok(urlMatch[1].startsWith('https://'), 'STREAM_URL must use https');
  });
});
