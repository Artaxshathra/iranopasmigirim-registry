'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPathAllowedForHost, urlToPath, rewriteHtml } from '../src/background/serve.js';
import { SERVE_PATH } from '../src/config.js';

describe('serve: urlToPath', () => {
  it('strips the SERVE_PATH prefix off an extension URL', () => {
    const path = urlToPath('chrome-extension://abc/site/foo/bar.html');
    assert.equal(path, 'foo/bar.html');
  });

  it('maps the bare /site/ to index.html', () => {
    assert.equal(urlToPath('chrome-extension://abc/site/'), 'index.html');
  });

  it('appends index.html for trailing-slash directories', () => {
    assert.equal(urlToPath('chrome-extension://abc/site/about/'), 'about/index.html');
  });

  it('decodes percent-encoded segments', () => {
    assert.equal(
      urlToPath('chrome-extension://abc/site/path%20with%20space/x.html'),
      'path with space/x.html'
    );
  });

  it('returns null for non-/site/ URLs', () => {
    assert.equal(urlToPath('chrome-extension://abc/popup/popup.html'), null);
    assert.equal(urlToPath('chrome-extension://abc/options.html'), null);
  });

  it('handles malformed URLs by returning null, not throwing', () => {
    assert.equal(urlToPath('not a url'), null);
  });
});

describe('serve: rewriteHtml — base injection', () => {
  it('injects <base href> as the first child of <head>', () => {
    const out = rewriteHtml('<!doctype html><html><head><title>x</title></head><body></body></html>');
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
    assert.match(out, /<HEAD><base href="\/site\/"><TITLE>/);
  });
});

describe('serve: rewriteHtml — absolute URL rewrites', () => {
  const SITE_HOST = 'example.com';

  it('rewrites https://site-host/x to /site/x', () => {
    const out = rewriteHtml(`<a href="https://${SITE_HOST}/about">x</a>`, { siteHost: SITE_HOST });
    assert.match(out, /href="\/site\/about"/);
  });

  it('rewrites http:// (insecure) to /site/', () => {
    const out = rewriteHtml(`<img src="http://${SITE_HOST}/img.png">`, { siteHost: SITE_HOST });
    assert.match(out, /src="\/site\/img\.png"/);
  });

  it('rewrites protocol-relative //site-host/...', () => {
    const out = rewriteHtml(`<script src="//${SITE_HOST}/app.js"></script>`, { siteHost: SITE_HOST });
    assert.match(out, /src="\/site\/app\.js"/);
  });

  it('rewrites the www subdomain', () => {
    const out = rewriteHtml(`<a href="https://www.${SITE_HOST}/x">a</a>`, { siteHost: SITE_HOST });
    assert.match(out, /href="\/site\/x"/);
  });

  it('handles port-numbered URLs', () => {
    const out = rewriteHtml(`<a href="https://${SITE_HOST}:443/x">a</a>`, { siteHost: SITE_HOST });
    assert.match(out, /href="\/site\/x"/);
  });

  it('does not corrupt unrelated text that mentions the host name', () => {
    const out = rewriteHtml(`<p>Visit ${SITE_HOST} sometime.</p>`, { siteHost: SITE_HOST });
    assert.match(out, /Visit example\.com sometime/);
  });

  it('rewrites all occurrences (global flag)', () => {
    const html = `<a href="https://${SITE_HOST}/a"></a><a href="https://${SITE_HOST}/b"></a>`;
    const out = rewriteHtml(html, { siteHost: SITE_HOST });
    const matches = out.match(/href="\/site\//g) || [];
    assert.equal(matches.length, 2);
  });

  it('does not rewrite absolute hosts when no siteHost is provided', () => {
    const out = rewriteHtml('<a href="https://example.com/news">x</a>');
    assert.match(out, /href="https:\/\/example\.com\/news"/);
  });
});

describe('serve: whitelist path policy', () => {
  const whitelist = {
    'bbc.com': {
      paths: ['/news', '/news/*'],
    },
  };

  it('allows exact path matches', () => {
    assert.equal(isPathAllowedForHost('news', 'bbc.com', whitelist), true);
  });

  it('allows wildcard prefix matches', () => {
    assert.equal(isPathAllowedForHost('news/world/index.html', 'bbc.com', whitelist), true);
  });

  it('rejects out-of-policy paths', () => {
    assert.equal(isPathAllowedForHost('sport/index.html', 'bbc.com', whitelist), false);
  });

  it('rejects unknown hosts', () => {
    assert.equal(isPathAllowedForHost('news/index.html', 'unknown.com', whitelist), false);
  });
});

describe('serve: SERVE_PATH contract', () => {
  it('SERVE_PATH starts with / and ends with /', () => {
    assert.match(SERVE_PATH, /^\/.*\/$/);
  });
});
