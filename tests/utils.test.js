var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var utils = require('../extension/utils.js');

// --- classifyUrl ---

describe('classifyUrl', function () {
  it('detects HLS manifests', function () {
    assert.equal(utils.classifyUrl('https://cdn.example.com/live/stream.m3u8'), 'hls');
    assert.equal(utils.classifyUrl('https://cdn.example.com/live/stream.m3u8?token=abc'), 'hls');
    assert.equal(utils.classifyUrl('https://cdn.example.com/live/stream.m3u8#t=0'), 'hls');
  });

  it('detects DASH manifests', function () {
    assert.equal(utils.classifyUrl('https://cdn.example.com/live/manifest.mpd'), 'dash');
    assert.equal(utils.classifyUrl('https://cdn.example.com/live/manifest.mpd?v=2'), 'dash');
  });

  it('detects TS segments', function () {
    assert.equal(utils.classifyUrl('https://cdn.example.com/seg001.ts'), 'ts');
    assert.equal(utils.classifyUrl('https://cdn.example.com/seg001.ts?v=1'), 'ts');
  });

  it('detects fMP4 segments', function () {
    assert.equal(utils.classifyUrl('https://cdn.example.com/init.m4s'), 'fmp4');
  });

  it('detects MP4 files', function () {
    assert.equal(utils.classifyUrl('https://example.com/video.mp4'), 'mp4');
  });

  it('detects WebM files', function () {
    assert.equal(utils.classifyUrl('https://example.com/video.webm'), 'webm');
  });

  it('returns null for non-stream URLs', function () {
    assert.equal(utils.classifyUrl('https://example.com/page.html'), null);
    assert.equal(utils.classifyUrl('https://example.com/style.css'), null);
    assert.equal(utils.classifyUrl('https://example.com/app.js'), null);
    assert.equal(utils.classifyUrl('https://example.com/photo.jpg'), null);
  });

  it('returns null for invalid input', function () {
    assert.equal(utils.classifyUrl(null), null);
    assert.equal(utils.classifyUrl(undefined), null);
    assert.equal(utils.classifyUrl(''), null);
    assert.equal(utils.classifyUrl(42), null);
  });

  it('skips blob: data: and extension URLs', function () {
    assert.equal(utils.classifyUrl('blob:https://example.com/abc'), null);
    assert.equal(utils.classifyUrl('data:video/mp4;base64,AAA'), null);
    assert.equal(utils.classifyUrl('chrome-extension://id/video.mp4'), null);
    assert.equal(utils.classifyUrl('moz-extension://id/video.mp4'), null);
  });
});

// --- identifyCdn ---

describe('identifyCdn', function () {
  it('identifies CloudFront', function () {
    assert.equal(utils.identifyCdn('https://d1234.cloudfront.net/stream.m3u8'), 'CloudFront');
  });

  it('identifies Akamai', function () {
    assert.equal(utils.identifyCdn('https://stream.akamaihd.net/live.m3u8'), 'Akamai');
  });

  it('identifies ArvanCloud', function () {
    assert.equal(utils.identifyCdn('https://stream.arvancloud.ir/live.m3u8'), 'ArvanCloud');
    assert.equal(utils.identifyCdn('https://cdn.arvan.cloud/video.mp4'), 'ArvanCloud');
  });

  it('identifies Cloudflare', function () {
    assert.equal(utils.identifyCdn('https://videodelivery.cloudflarestream.com/abc'), 'Cloudflare');
  });

  it('identifies Mux', function () {
    assert.equal(utils.identifyCdn('https://stream.mux.com/abc.m3u8'), 'Mux');
  });

  it('identifies JW Player', function () {
    assert.equal(utils.identifyCdn('https://cdn.jwplayer.com/manifests/abc.m3u8'), 'JW Player');
  });

  it('returns null for unknown CDN', function () {
    assert.equal(utils.identifyCdn('https://my-server.com/stream.m3u8'), null);
  });

  it('returns null for invalid input', function () {
    assert.equal(utils.identifyCdn(null), null);
    assert.equal(utils.identifyCdn(''), null);
  });
});

// --- isStreamUrl / isManifestUrl ---

describe('isStreamUrl', function () {
  it('returns true for stream URLs', function () {
    assert.equal(utils.isStreamUrl('https://cdn.example.com/live.m3u8'), true);
    assert.equal(utils.isStreamUrl('https://cdn.example.com/manifest.mpd'), true);
    assert.equal(utils.isStreamUrl('https://cdn.example.com/seg.ts'), true);
  });

  it('returns false for non-stream URLs', function () {
    assert.equal(utils.isStreamUrl('https://example.com/page.html'), false);
    assert.equal(utils.isStreamUrl(null), false);
  });
});

describe('isManifestUrl', function () {
  it('returns true for HLS and DASH manifests', function () {
    assert.equal(utils.isManifestUrl('https://cdn.example.com/live.m3u8'), true);
    assert.equal(utils.isManifestUrl('https://cdn.example.com/manifest.mpd'), true);
  });

  it('returns false for segments and other media', function () {
    assert.equal(utils.isManifestUrl('https://cdn.example.com/seg.ts'), false);
    assert.equal(utils.isManifestUrl('https://cdn.example.com/chunk.m4s'), false);
    assert.equal(utils.isManifestUrl('https://cdn.example.com/video.mp4'), false);
  });
});

// --- extractOrigin ---

describe('extractOrigin', function () {
  it('extracts origin from valid URL', function () {
    assert.equal(utils.extractOrigin('https://cdn.example.com/path/file.m3u8'), 'https://cdn.example.com');
    assert.equal(utils.extractOrigin('http://localhost:8080/stream.m3u8'), 'http://localhost:8080');
  });

  it('returns null for invalid URL', function () {
    assert.equal(utils.extractOrigin('not-a-url'), null);
    assert.equal(utils.extractOrigin(null), null);
  });
});

// --- formatM3u ---

describe('formatM3u', function () {
  it('formats valid M3U playlist', function () {
    var result = utils.formatM3u('Test Stream', 'https://example.com/live.m3u8');
    assert.equal(result, '#EXTM3U\n#EXTINF:-1,Test Stream\nhttps://example.com/live.m3u8\n');
  });

  it('uses default name when null', function () {
    var result = utils.formatM3u(null, 'https://example.com/live.m3u8');
    assert.ok(result.includes('INRTV Live'));
    assert.ok(result.includes('https://example.com/live.m3u8'));
  });

  it('returns empty string for missing URL', function () {
    assert.equal(utils.formatM3u('Name', null), '');
    assert.equal(utils.formatM3u('Name', undefined), '');
    assert.equal(utils.formatM3u('Name', ''), '');
  });
});

// --- buildStreamInfo ---

describe('buildStreamInfo', function () {
  it('builds complete info for HLS on CloudFront', function () {
    var info = utils.buildStreamInfo('https://d1234.cloudfront.net/live/stream.m3u8');
    assert.equal(info.url, 'https://d1234.cloudfront.net/live/stream.m3u8');
    assert.equal(info.type, 'hls');
    assert.equal(info.cdn, 'CloudFront');
    assert.equal(info.origin, 'https://d1234.cloudfront.net');
    assert.equal(info.isManifest, true);
    assert.equal(typeof info.detectedAt, 'number');
  });

  it('handles unknown CDN', function () {
    var info = utils.buildStreamInfo('https://my-server.com/live.m3u8');
    assert.equal(info.cdn, null);
    assert.equal(info.type, 'hls');
    assert.equal(info.isManifest, true);
  });

  it('marks segments as non-manifest', function () {
    var info = utils.buildStreamInfo('https://cdn.example.com/seg001.ts');
    assert.equal(info.type, 'ts');
    assert.equal(info.isManifest, false);
  });
});

// --- deduplicateStreams ---

describe('deduplicateStreams', function () {
  it('removes duplicate URLs keeping first', function () {
    var streams = [
      { url: 'https://a.com/s.m3u8', type: 'hls' },
      { url: 'https://a.com/s.m3u8', type: 'hls' },
      { url: 'https://b.com/s.m3u8', type: 'hls' },
    ];
    var result = utils.deduplicateStreams(streams);
    assert.equal(result.length, 2);
    assert.equal(result[0].url, 'https://a.com/s.m3u8');
    assert.equal(result[1].url, 'https://b.com/s.m3u8');
  });

  it('returns empty array for empty input', function () {
    assert.deepEqual(utils.deduplicateStreams([]), []);
  });
});

// --- sortStreams ---

describe('sortStreams', function () {
  it('puts manifests before segments', function () {
    var streams = [
      { url: 'seg.ts', isManifest: false, detectedAt: 1 },
      { url: 'live.m3u8', isManifest: true, detectedAt: 2 },
    ];
    var result = utils.sortStreams(streams);
    assert.equal(result[0].url, 'live.m3u8');
    assert.equal(result[1].url, 'seg.ts');
  });

  it('sorts by detection time within same category', function () {
    var streams = [
      { url: 'b.m3u8', isManifest: true, detectedAt: 200 },
      { url: 'a.m3u8', isManifest: true, detectedAt: 100 },
    ];
    var result = utils.sortStreams(streams);
    assert.equal(result[0].detectedAt, 100);
    assert.equal(result[1].detectedAt, 200);
  });

  it('does not mutate original array', function () {
    var streams = [
      { url: 'b', isManifest: false, detectedAt: 2 },
      { url: 'a', isManifest: true, detectedAt: 1 },
    ];
    utils.sortStreams(streams);
    assert.equal(streams[0].url, 'b');
  });
});
