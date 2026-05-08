// Map file extension → (mime, isBinary). Kept exhaustive enough to cover a
// real site mirror (HTML, CSS, JS, fonts, images, source maps, PDF) without
// pulling a 100 KB lookup table. Anything unknown is served as
// application/octet-stream and treated as binary.

const TABLE = {
  // Markup + script
  html: ['text/html; charset=utf-8',           false],
  htm:  ['text/html; charset=utf-8',           false],
  xhtml:['application/xhtml+xml; charset=utf-8',false],
  css:  ['text/css; charset=utf-8',            false],
  js:   ['application/javascript; charset=utf-8', false],
  mjs:  ['application/javascript; charset=utf-8', false],
  json: ['application/json; charset=utf-8',    false],
  xml:  ['application/xml; charset=utf-8',     false],
  svg:  ['image/svg+xml; charset=utf-8',       false],
  txt:  ['text/plain; charset=utf-8',          false],
  map:  ['application/json; charset=utf-8',    false],

  // Raster images — binary
  png:  ['image/png',  true],
  jpg:  ['image/jpeg', true],
  jpeg: ['image/jpeg', true],
  gif:  ['image/gif',  true],
  webp: ['image/webp', true],
  avif: ['image/avif', true],
  ico:  ['image/x-icon', true],

  // Fonts — binary
  woff:  ['font/woff',  true],
  woff2: ['font/woff2', true],
  ttf:   ['font/ttf',   true],
  otf:   ['font/otf',   true],
  eot:   ['application/vnd.ms-fontobject', true],

  // Misc
  pdf:  ['application/pdf', true],
  webm: ['video/webm', true],
  mp4:  ['video/mp4',  true],
  mp3:  ['audio/mpeg', true],
  wav:  ['audio/wav',  true],
  ogg:  ['audio/ogg',  true],
};

// Return [mimeType, isBinary] for the given path. Path is the IndexedDB key
// (no leading slash, no query string). Defaults are safe: octet-stream tells
// the browser "I don't know, treat as binary download" — which is correct
// when the type is unknown. We never guess by content sniffing.
export function mimeFor(path) {
  const lastDot = path.lastIndexOf('.');
  if (lastDot < 0) return ['application/octet-stream', true];
  const ext = path.slice(lastDot + 1).toLowerCase();
  return TABLE[ext] || ['application/octet-stream', true];
}

// Whether a given path is HTML — used by the serve layer to decide whether
// to inject <base href> for relative-URL resolution.
export function isHtml(path) {
  const lastDot = path.lastIndexOf('.');
  if (lastDot < 0) return false;
  const ext = path.slice(lastDot + 1).toLowerCase();
  return ext === 'html' || ext === 'htm' || ext === 'xhtml';
}
