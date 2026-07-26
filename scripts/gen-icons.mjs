// Generates simple solid-accent PNG icons + an ICO wrapper. Placeholder art —
// replace public/icon-*.png with real icons any time.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../public');
fs.mkdirSync(OUT, { recursive: true });

const ACCENT = [245, 158, 11]; // amber
const BG = [10, 10, 10];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Solid rounded-ish square: accent disc on dark background.
function makePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const [rr, gg, bb] = inside ? ACCENT : BG;
      const o = rowStart + 1 + x * 4;
      raw[o] = rr;
      raw[o + 1] = gg;
      raw[o + 2] = bb;
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png192 = makePng(192);
const png512 = makePng(512);
const png32 = makePng(32);
fs.writeFileSync(path.join(OUT, 'icon-192.png'), png192);
fs.writeFileSync(path.join(OUT, 'icon-512.png'), png512);

// ICO wrapping a 32x32 PNG (PNG-in-ICO is valid since Vista).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const dir = Buffer.alloc(16);
dir[0] = 32; // width
dir[1] = 32; // height
dir[2] = 0; // palette
dir[4] = 1; // planes (LE)
dir.writeUInt16LE(32, 6); // bpp
dir.writeUInt32LE(png32.length, 8);
dir.writeUInt32LE(6 + 16, 12); // offset
fs.writeFileSync(path.join(OUT, 'favicon.ico'), Buffer.concat([header, dir, png32]));

console.log('✔ wrote public/icon-192.png, icon-512.png, favicon.ico');
