#!/usr/bin/env node
'use strict';

// Generates a 117x117 brand-accent PNG with a centered red dot.
// Tizen TV requires an icon; until we have a designed asset, this keeps
// the build reproducible from source (no opaque binary in git).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const W = 117, H = 117;
const BG = [0, 0, 0];        // #000
const FG = [196, 30, 58];    // brand accent
const R = 38;                 // dot radius

function pixel(x, y) {
  const dx = x - W / 2, dy = y - H / 2;
  return (dx * dx + dy * dy <= R * R) ? FG : BG;
}

// Raw image data: filter byte (0) per row, then RGB triplets.
const raw = Buffer.alloc(H * (1 + W * 3));
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = pixel(x, y);
    raw[o++] = r; raw[o++] = g; raw[o++] = b;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// CRC-32 (PNG spec). Tiny inline implementation — pulling a dep just for
// this would be wildly disproportionate.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 2;   // color type: RGB
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', '..', 'src', 'icon.png');
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
