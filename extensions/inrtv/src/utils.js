/* Pure utility functions — no browser APIs, fully testable in Node.js */

(function (exports) {
  'use strict';

  // --- Pattern definitions ---

  var STREAM_PATTERNS = [
    { re: /\.m3u8([\?#]|$)/i, type: 'hls' },
    { re: /\.mpd([\?#]|$)/i, type: 'dash' },
    { re: /\.ts([\?#]|$)/i, type: 'ts' },
    { re: /\.m4s([\?#]|$)/i, type: 'fmp4' },
    { re: /\.mp4([\?#]|$)/i, type: 'mp4' },
    { re: /\.webm([\?#]|$)/i, type: 'webm' },
  ];

  var CDN_PATTERNS = [
    { re: /\.cloudfront\.net/i, name: 'CloudFront' },
    { re: /akamaihd\.net|akamaistream\./i, name: 'Akamai' },
    { re: /cloudflare|cloudflarestream\.com/i, name: 'Cloudflare' },
    { re: /arvancloud\.ir|arvan\.cloud/i, name: 'ArvanCloud' },
    { re: /\.cdn77\./i, name: 'CDN77' },
    { re: /\.fastly\./i, name: 'Fastly' },
    { re: /stream\.mux\.com|\.mux\.com/i, name: 'Mux' },
    { re: /jwplatform|jwplayer|jwpcdn/i, name: 'JW Player' },
    { re: /brightcove/i, name: 'Brightcove' },
  ];

  var MANIFEST_TYPES = { hls: true, dash: true };
  var SKIP_PROTOCOLS = /^(data:|chrome-extension:|moz-extension:|blob:|about:)/;

  // --- Core functions ---

  function classifyUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (SKIP_PROTOCOLS.test(url)) return null;
    for (var i = 0; i < STREAM_PATTERNS.length; i++) {
      if (STREAM_PATTERNS[i].re.test(url)) return STREAM_PATTERNS[i].type;
    }
    return null;
  }

  function identifyCdn(url) {
    if (!url || typeof url !== 'string') return null;
    for (var i = 0; i < CDN_PATTERNS.length; i++) {
      if (CDN_PATTERNS[i].re.test(url)) return CDN_PATTERNS[i].name;
    }
    return null;
  }

  function isStreamUrl(url) {
    return classifyUrl(url) !== null;
  }

  function isManifestUrl(url) {
    var type = classifyUrl(url);
    return type !== null && MANIFEST_TYPES[type] === true;
  }

  function extractOrigin(url) {
    try { return new URL(url).origin; }
    catch (e) { return null; }
  }

  function formatM3u(name, url) {
    if (!url) return '';
    var title = name || 'INRTV Live';
    return '#EXTM3U\n#EXTINF:-1,' + title + '\n' + url + '\n';
  }

  function buildStreamInfo(url) {
    return {
      url: url,
      type: classifyUrl(url),
      cdn: identifyCdn(url),
      origin: extractOrigin(url),
      isManifest: isManifestUrl(url),
      detectedAt: Date.now(),
    };
  }

  function deduplicateStreams(streams) {
    var seen = {};
    var result = [];
    for (var i = 0; i < streams.length; i++) {
      if (!seen[streams[i].url]) {
        seen[streams[i].url] = true;
        result.push(streams[i]);
      }
    }
    return result;
  }

  function sortStreams(streams) {
    return streams.slice().sort(function (a, b) {
      if (a.isManifest && !b.isManifest) return -1;
      if (!a.isManifest && b.isManifest) return 1;
      return (a.detectedAt || 0) - (b.detectedAt || 0);
    });
  }

  // --- Exports ---

  exports.classifyUrl = classifyUrl;
  exports.identifyCdn = identifyCdn;
  exports.isStreamUrl = isStreamUrl;
  exports.isManifestUrl = isManifestUrl;
  exports.extractOrigin = extractOrigin;
  exports.formatM3u = formatM3u;
  exports.buildStreamInfo = buildStreamInfo;
  exports.deduplicateStreams = deduplicateStreams;
  exports.sortStreams = sortStreams;

})(typeof module !== 'undefined' && module.exports ? module.exports : (self.StreamUtils = {}));
