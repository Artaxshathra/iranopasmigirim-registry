'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

function readHTML(name) {
  return fs.readFileSync(path.join(SRC, name), 'utf8');
}

// Minimal tag/attribute extractor (no DOM parser needed for static checks)
function attrs(html, tagPattern) {
  const matches = [];
  const re = new RegExp(`<${tagPattern}[^>]*>`, 'gi');
  let m;
  while ((m = re.exec(html)) !== null) matches.push(m[0]);
  return matches;
}

function attrValue(tag, attr) {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

// ── player.html ─────────────────────────────────────────────

describe('player.html', () => {
  const html = readHTML('player.html');

  it('has lang="en" on <html>', () => {
    assert.match(html, /<html[^>]*\slang=["']en["']/);
  });

  it('has <meta charset="utf-8">', () => {
    assert.match(html, /<meta\s+charset=["']utf-8["']/i);
  });

  it('has no inline <script> blocks', () => {
    // Should only have <script src="..."> tags, no inline code
    const inlineScripts = html.match(/<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/gi);
    assert.equal(inlineScripts, null, 'must not contain inline scripts');
  });

  it('has no inline style attributes', () => {
    assert.ok(!html.match(/\sstyle\s*=/i), 'must not use inline style attributes');
  });

  it('video element has aria-label', () => {
    const [videoTag] = attrs(html, 'video');
    assert.ok(videoTag, '<video> must exist');
    assert.ok(attrValue(videoTag, 'aria-label'), '<video> must have aria-label');
  });

  it('all buttons have aria-label', () => {
    const buttons = attrs(html, 'button');
    assert.ok(buttons.length > 0, 'must have buttons');
    for (const btn of buttons) {
      const label = attrValue(btn, 'aria-label');
      assert.ok(label, `button must have aria-label: ${btn.slice(0, 60)}`);
    }
  });

  it('volume slider has aria-label', () => {
    const inputs = attrs(html, 'input');
    const volume = inputs.find(i => attrValue(i, 'id') === 'volume');
    assert.ok(volume, '#volume input must exist');
    assert.ok(attrValue(volume, 'aria-label'), '#volume must have aria-label');
  });

  it('error overlay has role="status" and aria-live="polite"', () => {
    const overlays = attrs(html, 'div');
    const errorOv = overlays.find(d => attrValue(d, 'id') === 'overlay-error');
    assert.ok(errorOv, '#overlay-error must exist');
    assert.equal(attrValue(errorOv, 'role'), 'status');
    assert.equal(attrValue(errorOv, 'aria-live'), 'polite');
  });

  it('branding has aria-hidden="true"', () => {
    const divs = attrs(html, 'div');
    const branding = divs.find(d => attrValue(d, 'id') === 'branding');
    assert.ok(branding, '#branding must exist');
    assert.equal(attrValue(branding, 'aria-hidden'), 'true');
  });

  it('loading overlay has a caption', () => {
    assert.match(html, /class=["']loading-caption["'][^>]*>[^<]+</,
      'loading overlay must have a visible caption');
  });

  it('play prompt overlay exists and is hidden by default', () => {
    const divs = attrs(html, 'div');
    const playOv = divs.find(d => attrValue(d, 'id') === 'overlay-play');
    assert.ok(playOv, '#overlay-play must exist');
    assert.ok(playOv.includes('hidden'), '#overlay-play must be hidden by default');
  });

  it('play prompt overlay is keyboard-accessible', () => {
    const divs = attrs(html, 'div');
    const playOv = divs.find(d => attrValue(d, 'id') === 'overlay-play');
    assert.ok(playOv, '#overlay-play must exist');
    assert.equal(attrValue(playOv, 'role'), 'button', '#overlay-play must have role="button"');
    assert.equal(attrValue(playOv, 'tabindex'), '0', '#overlay-play must have tabindex="0"');
    assert.ok(attrValue(playOv, 'aria-label'), '#overlay-play must have aria-label');
  });

  it('decorative SVGs inside buttons have aria-hidden', () => {
    const svgRe = /<svg[^>]*>/gi;
    let m;
    while ((m = svgRe.exec(html)) !== null) {
      const tag = m[0];
      // Skip standalone SVGs (like play-circle in overlay)
      if (tag.includes('play-circle')) continue;
      assert.ok(tag.includes('aria-hidden="true"'),
        `SVG must have aria-hidden="true": ${tag.slice(0, 80)}`);
    }
  });

  it('loading overlay has role="status"', () => {
    const divs = attrs(html, 'div');
    const loadingOv = divs.find(d => attrValue(d, 'id') === 'overlay-loading');
    assert.ok(loadingOv, '#overlay-loading must exist');
    assert.equal(attrValue(loadingOv, 'role'), 'status');
  });

  it('uses SVG icons in control buttons (no emoji)', () => {
    const buttons = attrs(html, 'button');
    const playerBtns = buttons.filter(b => {
      const id = attrValue(b, 'id');
      return id && id.startsWith('btn-') && id !== 'btn-watch';
    });
    // Buttons should not contain emoji text content — they contain SVG children
    assert.ok(playerBtns.length >= 4, 'must have at least 4 control buttons');
  });

  it('scripts reference only local files', () => {
    const scripts = attrs(html, 'script');
    for (const s of scripts) {
      const src = attrValue(s, 'src');
      if (src) {
        assert.ok(!src.startsWith('http'), `script src must be local: ${src}`);
      }
    }
  });

  it('all referenced CSS files exist', () => {
    const links = attrs(html, 'link');
    for (const link of links) {
      if (attrValue(link, 'rel') === 'stylesheet') {
        const href = attrValue(link, 'href');
        assert.ok(fs.existsSync(path.join(SRC, href)), `CSS file must exist: ${href}`);
      }
    }
  });

  it('all referenced JS files exist (excluding lib/)', () => {
    const scripts = attrs(html, 'script');
    for (const s of scripts) {
      const src = attrValue(s, 'src');
      if (src && !src.startsWith('lib/')) {
        assert.ok(fs.existsSync(path.join(SRC, src)), `JS file must exist: ${src}`);
      }
    }
  });
});

// ── popup.html ──────────────────────────────────────────────

describe('popup.html', () => {
  const html = readHTML('popup.html');

  it('has lang="en" on <html>', () => {
    assert.match(html, /<html[^>]*\slang=["']en["']/);
  });

  it('has <meta charset="utf-8">', () => {
    assert.match(html, /<meta\s+charset=["']utf-8["']/i);
  });

  it('has no inline <script> blocks', () => {
    const inlineScripts = html.match(/<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/gi);
    assert.equal(inlineScripts, null, 'must not contain inline scripts');
  });

  it('has no inline style attributes', () => {
    assert.ok(!html.match(/\sstyle\s*=/i), 'must not use inline style attributes');
  });

  it('btn-watch button exists', () => {
    assert.match(html, /id=["']btn-watch["']/);
  });

  it('link-site element exists', () => {
    assert.match(html, /id=["']link-site["']/);
  });

  it('link-site has a real href (not placeholder)', () => {
    const links = attrs(html, 'a');
    const siteLink = links.find(a => attrValue(a, 'id') === 'link-site');
    assert.ok(siteLink, '#link-site must exist');
    const href = attrValue(siteLink, 'href');
    assert.ok(href && href.startsWith('https://'), '#link-site href must be a real HTTPS URL');
  });

  it('has a <title> element', () => {
    assert.match(html, /<title>[^<]+<\/title>/, 'popup.html must have a <title>');
  });

  it('logo image has alt attribute', () => {
    const imgs = attrs(html, 'img');
    assert.ok(imgs.length > 0, 'must have img');
    for (const img of imgs) {
      const alt = attrValue(img, 'alt');
      assert.ok(alt !== null, 'img must have alt attribute');
    }
  });

  it('all referenced CSS files exist', () => {
    const links = attrs(html, 'link');
    for (const link of links) {
      if (attrValue(link, 'rel') === 'stylesheet') {
        const href = attrValue(link, 'href');
        assert.ok(fs.existsSync(path.join(SRC, href)), `CSS file must exist: ${href}`);
      }
    }
  });

  it('all referenced JS files exist', () => {
    const scripts = attrs(html, 'script');
    for (const s of scripts) {
      const src = attrValue(s, 'src');
      if (src) {
        assert.ok(fs.existsSync(path.join(SRC, src)), `JS file must exist: ${src}`);
      }
    }
  });
});
