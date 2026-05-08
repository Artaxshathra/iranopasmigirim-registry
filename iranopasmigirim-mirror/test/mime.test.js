'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mimeFor, isHtml } from '../src/background/mime.js';

describe('mime: known extensions', () => {
  it('html / htm map to text/html with utf-8 and isBinary=false', () => {
    const [m1, b1] = mimeFor('index.html');
    assert.match(m1, /^text\/html/);
    assert.equal(b1, false);
    const [m2, b2] = mimeFor('about/index.htm');
    assert.match(m2, /^text\/html/);
    assert.equal(b2, false);
  });

  it('binary asset types are flagged isBinary=true', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'woff', 'woff2', 'ttf', 'pdf', 'mp4']) {
      const [, b] = mimeFor('asset.' + ext);
      assert.equal(b, true, `${ext} must be binary`);
    }
  });

  it('text-ish types are flagged isBinary=false', () => {
    for (const ext of ['css', 'js', 'mjs', 'json', 'xml', 'svg', 'txt', 'map']) {
      const [, b] = mimeFor('asset.' + ext);
      assert.equal(b, false, `${ext} must be text`);
    }
  });

  it('unknown extension falls back to octet-stream and isBinary=true', () => {
    const [m, b] = mimeFor('weird.xyzzy');
    assert.equal(m, 'application/octet-stream');
    assert.equal(b, true);
  });

  it('no extension falls back to octet-stream', () => {
    const [m] = mimeFor('Makefile');
    assert.equal(m, 'application/octet-stream');
  });

  it('extension casing does not matter', () => {
    const [m1] = mimeFor('IMAGE.PNG');
    const [m2] = mimeFor('image.png');
    assert.equal(m1, m2);
  });
});

describe('mime: isHtml', () => {
  it('only html/htm/xhtml count as HTML', () => {
    assert.equal(isHtml('index.html'),  true);
    assert.equal(isHtml('a/index.htm'), true);
    assert.equal(isHtml('a.xhtml'),     true);
    assert.equal(isHtml('a.css'),       false);
    assert.equal(isHtml('a.json'),      false);
    assert.equal(isHtml('a.svg'),       false);
    assert.equal(isHtml('Makefile'),    false);
  });

  it('casing does not matter', () => {
    assert.equal(isHtml('INDEX.HTML'), true);
  });
});
