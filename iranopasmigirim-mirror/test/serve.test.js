'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { urlToPath, rewriteHtml } from '../src/background/serve.js';
import { SERVE_PATH, TARGET_HOST } from '../src/config.js';

describe('serve: urlToPath', () => {
  it('strips the SERVE_PATH prefix off an extension URL', () => {
    const path = urlToPath(`chrome-extension://abc/site/foo/bar.html`);
    assert.equal(path, 'foo/bar.html');
  });

  it('maps the bare /site/ to index.html', () => {
    assert.equal(urlToPath(`chrome-extension://abc/site/`), 'index.html');
  });

  it('appends index.html for trailing-slash directories', () => {
    assert.equal(urlToPath(`chrome-extension://abc/site/about/`), 'about/index.html');
  });

  it('decodes percent-encoded segments', () => {
    assert.equal(
      urlToPath(`chrome-extension://abc/site/path%20with%20space/x.html`),
      'path with space/x.html'
    );
  });

  it('returns null for non-/site/ URLs', () => {
    assert.equal(urlToPath(`chrome-extension://abc/popup/popup.html`), null);
    assert.equal(urlToPath(`chrome-extension://abc/options.html`), null);
  });

  it('handles malformed URLs by returning null, not throwing', () => {
    assert.equal(urlToPath('not a url'), null);
  });
});

describe('serve: rewriteHtml — base injection', () => {
  it('injects <base href> as the first child of <head>', () => {
    const out = rewriteHtml('<!doctype html><html><head><title>x</title></head><body></body></html>');
    // The <base> tag must precede any <link> / <script> in <head> so it
    // wins URL-resolution for everything that follows.
    assert.match(out, /<head><base href="\/site\/"><title>/);
  });

  it('preserves attributes on the existing <head> element', () => {
    const out = rewriteHtml('<head data-x="1"><meta charset="utf-8"></head>');
    assert.match(out, /<head data-x="1"><base href="\/site\/"><meta/);
  });

  it('synthesizes a <head> if there is none', () => {
    const out = rewriteHtml('<html><body>just body</body></html>');
    assert.match(out, /<html><head><base href="\/site\/"><\/head><body>/);
  });

  it('case-insensitive on <head> tag', () => {
    const out = rewriteHtml('<HTML><HEAD><TITLE>x</TITLE></HEAD></HTML>');
    // Our injection is lowercase but it sits BEFORE the existing uppercase tag.
    assert.match(out, /<HEAD><base href="\/site\/"><TITLE>/);
  });
});

describe('serve: rewriteHtml — absolute URL rewrites', () => {
  it('rewrites https://TARGET_HOST/x to /site/x', () => {
    const out = rewriteHtml(`<a href="https://${TARGET_HOST}/about">x</a>`);
    assert.match(out, /href="\/site\/about"/);
  });

  it('rewrites http:// (insecure) to /site/', () => {
    const out = rewriteHtml(`<img src="http://${TARGET_HOST}/img.png">`);
    assert.match(out, /src="\/site\/img\.png"/);
  });

  it('rewrites protocol-relative //TARGET_HOST/...', () => {
    const out = rewriteHtml(`<script src="//${TARGET_HOST}/app.js"></script>`);
    assert.match(out, /src="\/site\/app\.js"/);
  });

  it('rewrites the www subdomain', () => {
    const out = rewriteHtml(`<a href="https://www.${TARGET_HOST}/x">a</a>`);
    assert.match(out, /href="\/site\/x"/);
  });

  it('handles port-numbered URLs', () => {
    const out = rewriteHtml(`<a href="https://${TARGET_HOST}:443/x">a</a>`);
    assert.match(out, /href="\/site\/x"/);
  });

  it('does not corrupt unrelated text that mentions the host name', () => {
    // The regex requires `://` or `//` immediately before the host, so a
    // bare mention in body text must survive untouched.
    const out = rewriteHtml(`<p>Visit ${TARGET_HOST} sometime.</p>`);
    assert.match(out, /Visit iranopasmigirim\.com sometime/);
  });

  it('rewrites all occurrences (global flag)', () => {
    const html = `<a href="https://${TARGET_HOST}/a"></a><a href="https://${TARGET_HOST}/b"></a>`;
    const out = rewriteHtml(html);
    const matches = out.match(/href="\/site\//g) || [];
    assert.equal(matches.length, 2);
  });
});

describe('serve: SERVE_PATH contract', () => {
  it('SERVE_PATH starts with / and ends with /', () => {
    assert.match(SERVE_PATH, /^\/.*\/$/);
  });
});
