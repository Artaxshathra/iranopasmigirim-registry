// Serve cached pages out of IndexedDB into the extension origin.
//
// The fetch event in the SW only fires for requests from same-origin pages
// (i.e. chrome-extension://<id>/...). Popup actions and SW auto-open navigate
// users into /site/, and from this point every request — page, css, js, font,
// image — flows through this module.
//
// URL shape:
//   chrome-extension://<id>/site/<path>
//
// The /site/ prefix lets us reserve other paths for popup, options,
// internal pages without ambiguity.

import { getFile, touchFile } from './db.js';
import { mimeFor, isHtml } from './mime.js';
import { MIRROR_MANIFEST_PATH, SERVE_PATH, WHITELIST } from '../config.js';

// Headers we set on every response. CSP is the load-bearing one: the cached
// site can run its own scripts (the whole point), but it must not be able
// to phone home — connect-src 'self' confines it to the extension origin.
// Frames and workers must also stay local.
//
// We deliberately do NOT add HSTS, COEP, or COOP — those interact badly
// with extension origins and provide no benefit here.
function baseHeaders(mime) {
  return {
    'content-type': mime,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'none'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "frame-src 'none'",
      "worker-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
  };
}

// Map a fetch URL to the IndexedDB key. We only ever store paths *without*
// a leading slash, which matches the GitHub tree listing format. Root
// requests resolve to index.html (the standard SPA-ish fallback).
//
// Returns null if the URL isn't ours to handle.
export function urlToPath(urlStr) {
  let url;
  try { url = new URL(urlStr); } catch (_) { return null; }
  if (!url.pathname.startsWith(SERVE_PATH)) return null;
  let path = url.pathname.slice(SERVE_PATH.length);
  // Drop trailing slashes — the cache key for a directory is its index.html.
  if (path === '' || path.endsWith('/')) path = path + 'index.html';
  return decodeURIComponent(path);
}

// Inject <base href="/site/"> as the first thing in <head>. Result: every
// relative URL in the page resolves under our origin. Combined with the
// targeted absolute-URL replacements below, this covers the full set of
// link types (href, src, srcset, JS-built URLs, query strings, fragments)
// without parsing or walking the DOM.
//
// We also strip a few site-specific patterns that would either leak (real
// analytics) or break (third-party widgets that need network the user
// can't reach). String replace is fine here: these patterns are stable.
export function rewriteHtml(html, { siteHost = '' } = {}) {
  // <base> goes immediately after <head ...> so any <base> the original
  // page declared sits *after* ours and wins — our injection then becomes
  // the fallback for pages that don't declare their own. We don't try to
  // remove the original <base>, since that would risk breaking a relative
  // path the original author depended on.
  const baseTag = `<base href="${SERVE_PATH}">`;
  let out = html.replace(/<head([^>]*)>/i, (m, attrs) => `${m}${baseTag}`);
  // If there's no <head> at all (rare but valid HTML), inject after <html>.
  if (out === html) {
    out = html.replace(/<html([^>]*)>/i, (m) => `${m}<head>${baseTag}</head>`);
  }
  // Targeted absolute-URL rewrites. We handle:
  //   https://<site-host>/...   -> /site/...
  //   http://<site-host>/...    -> /site/...
  //   //<site-host>/...         -> /site/...     (protocol-relative)
  // Anchored on the host string (with optional port) so we don't false-
  // positive on a substring inside text content.
  const normalizedHost = String(siteHost || '').trim().toLowerCase();
  if (normalizedHost) {
    const hostEsc = normalizedHost.replace(/\./g, '\\.');
    const re = new RegExp(`(https?:)?//(?:www\\.)?${hostEsc}(:\\d+)?/`, 'gi');
    out = out.replace(re, SERVE_PATH);
  }
  return out;
}

export function isPathAllowedForHost(path, siteHost, whitelist = WHITELIST) {
  const normalizedHost = String(siteHost || '').trim().toLowerCase();
  if (!normalizedHost) return false;
  const hostPolicy = whitelist[normalizedHost];
  if (!hostPolicy || !Array.isArray(hostPolicy.paths) || hostPolicy.paths.length === 0) {
    return false;
  }

  const normalizedPath = `/${String(path || '').replace(/^\/+/, '')}`;
  for (const rawPattern of hostPolicy.paths) {
    const pattern = String(rawPattern || '').trim();
    if (!pattern) continue;
    if (pattern === '/') return true;
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -1); // keep trailing '/'
      if (normalizedPath.startsWith(base)) return true;
      continue;
    }
    if (normalizedPath === pattern) return true;
    if (normalizedPath.startsWith(`${pattern}/`)) return true;
  }
  return false;
}

// Build a Response. Static assets are returned as-is; HTML gets the
// <base href> injection. We never set a Content-Length: the body is
// already a Blob/ArrayBuffer and the browser fills it in.
async function buildResponse(path, record, context = {}) {
  const [mime] = mimeFor(path);
  if (isHtml(path) && record.content) {
    const html = new TextDecoder('utf-8').decode(record.content);
    const rewritten = rewriteHtml(html, context);
    return new Response(rewritten, { headers: baseHeaders(mime) });
  }
  return new Response(record.content, { headers: baseHeaders(mime) });
}

// Branded fallback for paths we don't have. Returning a real 404 is
// honest — pages that 404 in the original site should also 404 here.
// We keep it tiny and self-contained (no IndexedDB hit, no external CSS).
function notFoundResponse(path) {
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Not in mirror</title>
<style>
  body{background:#0a0a0a;color:#eee;font:18px system-ui;margin:0;
       display:grid;place-items:center;height:100vh;text-align:center;padding:24px}
  h1{margin:0 0 12px;font-size:28px}
  code{background:#1c1c1c;padding:2px 6px;border-radius:4px}
</style>
<h1>Not in the mirror</h1>
<p>The mirror does not contain <code>${escapeHtml(path)}</code>.<br>
This is an offline copy — only pages captured by the most recent sync are available.</p>`;
  return new Response(html, {
    status: 404,
    headers: baseHeaders('text/html; charset=utf-8'),
  });
}

function forbiddenResponse(path, siteHost) {
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Blocked by mirror policy</title>
<style>
  body{background:#0a0a0a;color:#eee;font:18px system-ui;margin:0;
       display:grid;place-items:center;height:100vh;text-align:center;padding:24px}
  h1{margin:0 0 12px;font-size:28px}
  code{background:#1c1c1c;padding:2px 6px;border-radius:4px}
</style>
<h1>Blocked by mirror policy</h1>
<p><code>${escapeHtml(path)}</code> is outside the allowed paths for <code>${escapeHtml(siteHost || 'unknown-host')}</code>.</p>`;
  return new Response(html, {
    status: 403,
    headers: baseHeaders('text/html; charset=utf-8'),
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Top-level entry point — call from the SW fetch listener with the request
// URL. Returns a Response or null (null means "not our URL, let the
// platform handle it normally", which for extension origin means 404).
export async function serve(urlStr) {
  const path = urlToPath(urlStr);
  if (path === null) return null;
  let servedPath = path;
  let record;
  try { record = await getFile(path); }
  catch (_) { record = null; }
  if (!record) {
    // Try an index.html under that directory as a last resort. Helps
    // when a site links to /about and the mirror stored /about/index.html.
    if (!path.endsWith('.html') && !path.endsWith('.htm')) {
      try { record = await getFile(path.replace(/\/?$/, '/index.html')); }
      catch (_) { record = null; }
      if (record) servedPath = path.replace(/\/?$/, '/index.html');
    }
  }
  if (!record) return notFoundResponse(path);

  try { await touchFile(servedPath); } catch (_) {}

  let siteHost = '';
  try {
    const manifest = await getFile(MIRROR_MANIFEST_PATH);
    if (manifest && manifest.content) {
      const text = new TextDecoder('utf-8').decode(manifest.content);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.siteHost === 'string') {
        siteHost = parsed.siteHost.trim().toLowerCase();
      }
    }
  } catch (_) {}

  if (siteHost && !isPathAllowedForHost(path, siteHost)) {
    return forbiddenResponse(path, siteHost);
  }

  return buildResponse(path, record, { siteHost });
}
