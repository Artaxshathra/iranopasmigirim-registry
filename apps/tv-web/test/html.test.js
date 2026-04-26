'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

describe('tv-web index.html', () => {
  it('has no inline event handlers (onclick, onload, etc.)', () => {
    const re = /\s(onclick|onload|onerror|onsubmit|onmouseover|onfocus|onblur|onchange|onkeydown|onkeyup)\s*=/i;
    assert.ok(!re.test(html));
  });

  it('has no inline <script> blocks (CSP requires script-src self)', () => {
    assert.ok(!/<script>[\s\S]*?<\/script>/i.test(html),
      'all scripts must come from a src= attribute');
  });

  it('has no remote <script src="http..."> — all scripts vendored locally', () => {
    const remote = html.match(/<script[^>]+src=["']https?:\/\/[^"']+["']/gi) || [];
    assert.equal(remote.length, 0);
  });

  it('loads the bundled hls.js and a single app script (no surprises)', () => {
    const scripts = [...html.matchAll(/<script\s+src=["']([^"']+)["']/g)].map(m => m[1]);
    assert.deepEqual(scripts, ['lib/hls.min.js', 'player.js']);
  });

  it('every referenced asset path resolves to a real file', () => {
    const refs = [
      ...[...html.matchAll(/<link[^>]+href=["']([^"']+)["']/g)].map(m => m[1]),
      ...[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]),
    ].filter(p => !/^https?:/.test(p));
    for (const rel of refs) {
      assert.ok(fs.existsSync(path.join(SRC, rel)),
        `asset "${rel}" referenced by index.html must exist`);
    }
  });

  it('declares a strict CSP via <meta http-equiv="Content-Security-Policy">', () => {
    // TV web apps don't get a CSP HTTP header from the platform; the meta tag
    // is the only enforcement point. Mirrors the extension's MV3 directives.
    // Match content="..." or content='...' but capture inner CSP verbatim —
    // the CSP value itself contains single quotes (e.g. 'self', 'none'), so
    // a [^"'] character class would truncate it at the first directive.
    const m = html.match(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content=("([^"]+)"|'([^']+)')/i);
    assert.ok(m, 'must declare CSP via meta tag');
    const csp = m[2] || m[3];
    assert.match(csp, /default-src\s+'none'/);
    assert.match(csp, /script-src\s+'self'/);
    assert.ok(!csp.includes('unsafe-inline'));
    assert.ok(!csp.includes('unsafe-eval'));
    assert.match(csp, /connect-src[^;]*https:\/\/hls\.irannrtv\.live/);
    assert.match(csp, /media-src[^;]*https:\/\/hls\.irannrtv\.live/);
    // hls.js feeds the <video> via a MediaSource blob: URL — without this
    // the stream is silently blocked and the player just shows black.
    assert.match(csp, /media-src[^;]*\bblob:/);
    // frame-ancestors intentionally absent: ignored in <meta>, browsers warn.
    assert.ok(!/frame-ancestors/.test(csp), 'frame-ancestors only works as HTTP header');
  });

  it('stream URL in CSP matches STREAM_URL in player.js', () => {
    const playerJs = fs.readFileSync(path.join(SRC, 'player.js'), 'utf8');
    const url = new URL(playerJs.match(/STREAM_URL\s*=\s*['"]([^'"]+)['"]/)[1]);
    const origin = url.protocol + '//' + url.hostname;
    const cspMatch = html.match(/Content-Security-Policy["'][^>]+content=("([^"]+)"|'([^']+)')/);
    const csp = cspMatch[2] || cspMatch[3];
    assert.ok(csp.includes(origin), `CSP must pin ${origin}`);
  });

  it('no http:// URLs (https only)', () => {
    const matches = html.match(/http:\/\/[^\s'")`]+/g);
    assert.equal(matches, null);
  });

  it('no <iframe> elements', () => {
    assert.ok(!/<iframe/i.test(html));
  });
});
