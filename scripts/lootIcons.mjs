/**
 * Draws the treasure-chest loot icons (32×32 pixel art) into public/sprites/loot/ with no image library:
 * shapes are drawn into an RGBA buffer, a one-pixel dark outline is added automatically, and the result is
 * written as a PNG through node:zlib.
 *
 *   node scripts/lootIcons.mjs                 → writes the six PNGs
 *   node scripts/lootIcons.mjs --preview out.png  → also writes a 6× preview sheet
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'sprites', 'loot');
const S = 32;

// ---------- PNG ----------
const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- canvas ----------
const hex = (h, a = 255) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]; };
class Canvas {
  constructor() { this.px = new Array(S * S).fill(null); }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= S || y >= S) return; this.px[y * S + x] = c; }
  get(x, y) { return x < 0 || y < 0 || x >= S || y >= S ? null : this.px[y * S + x]; }
  rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  circle(cx, cy, r, c) { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.25) this.set(x, y, c); }
  line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; for (let i = 0; i <= n; i++) this.set(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c); }
  /** Replace colour `from` with `to` inside a rectangle (shading). */
  tint(x0, y0, x1, y1, from, to) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.get(x, y) === from) this.set(x, y, to); }
  /** One-pixel dark outline around everything opaque. */
  outline(c) {
    const add = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (this.get(x, y)) continue;
      if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push([x, y]);
    }
    for (const [x, y] of add) this.set(x, y, c);
  }
  rgba() { const b = Buffer.alloc(S * S * 4); for (let i = 0; i < S * S; i++) { const c = this.px[i]; if (c) { b[i * 4] = c[0]; b[i * 4 + 1] = c[1]; b[i * 4 + 2] = c[2]; b[i * 4 + 3] = c[3]; } } return b; }
}

const INK = hex('#1b1b2f');
const WOOD = hex('#8b5a2b'), WOOD_D = hex('#5a3519'), WOOD_L = hex('#b07a45');
const GOLD = hex('#f5c542'), GOLD_D = hex('#b8860b'), GOLD_L = hex('#fde68a');
const GLOW = hex('#fcd34d', 190);
const WHITE = hex('#f8fafc');

function chestClosed(c) {
  c.rect(4, 8, 27, 14, WOOD); c.rect(6, 6, 25, 7, WOOD); c.rect(8, 5, 23, 5, WOOD);   // lid
  c.rect(4, 15, 27, 26, WOOD);                                                            // body
  c.tint(4, 23, 27, 26, WOOD, WOOD_D); c.tint(24, 15, 27, 26, WOOD, WOOD_D);             // shade
  c.rect(6, 6, 20, 6, WOOD_L); c.rect(5, 16, 22, 16, WOOD_L);                            // highlights
  c.rect(5, 19, 26, 19, WOOD_D); c.rect(5, 23, 26, 23, WOOD_D);                          // planks
  c.rect(7, 5, 8, 26, GOLD); c.rect(23, 5, 24, 26, GOLD); c.rect(4, 13, 27, 14, GOLD);   // bands
  c.rect(8, 14, 8, 26, GOLD_D); c.rect(24, 14, 24, 26, GOLD_D); c.rect(4, 14, 27, 14, GOLD_D);
  c.rect(13, 12, 18, 18, GOLD); c.rect(14, 13, 17, 13, GOLD_L); c.rect(18, 13, 18, 18, GOLD_D);  // lock
  c.rect(15, 14, 16, 15, INK); c.rect(15, 16, 16, 17, INK);                              // keyhole
}
function chestOpen(c) {
  c.rect(5, 3, 26, 8, WOOD); c.rect(7, 2, 24, 2, WOOD);                                  // lid, swung up
  c.rect(5, 8, 26, 9, GOLD); c.rect(7, 2, 8, 9, GOLD); c.rect(23, 2, 24, 9, GOLD); c.rect(6, 3, 21, 3, WOOD_L);
  c.rect(9, 10, 22, 16, GLOW); c.rect(11, 12, 20, 16, hex('#fde68a', 220));              // light pouring out
  c.rect(4, 16, 27, 27, WOOD); c.tint(4, 24, 27, 27, WOOD, WOOD_D); c.tint(24, 16, 27, 27, WOOD, WOOD_D);
  c.rect(5, 16, 26, 19, hex('#2a1a0e'));                                                 // the open mouth
  c.circle(10, 19, 2, GOLD); c.circle(16, 18, 2.2, GOLD); c.circle(22, 19, 2, GOLD);     // coins
  c.set(9, 18, GOLD_L); c.set(15, 17, GOLD_L); c.set(21, 18, GOLD_L);
  c.rect(5, 23, 26, 23, WOOD_D);
  c.rect(7, 20, 8, 27, GOLD); c.rect(23, 20, 24, 27, GOLD); c.rect(8, 20, 8, 27, GOLD_D); c.rect(24, 20, 24, 27, GOLD_D);
  c.rect(14, 20, 17, 23, GOLD); c.rect(17, 20, 17, 23, GOLD_D); c.set(15, 21, INK); c.set(16, 21, INK);  // lock, hanging open
  for (const [x, y] of [[16, 12], [8, 13], [24, 12]]) { c.set(x, y, WHITE); c.set(x - 1, y, WHITE); c.set(x + 1, y, WHITE); c.set(x, y - 1, WHITE); c.set(x, y + 1, WHITE); }  // sparkles
}
const STEEL = hex('#9aa3b5'), STEEL_D = hex('#4b5563'), STEEL_L = hex('#d1d5db');
function ballGun(c) {
  c.rect(14, 12, 29, 16, STEEL); c.rect(14, 12, 29, 12, STEEL_L); c.rect(14, 16, 29, 16, STEEL_D);   // barrel
  c.rect(27, 11, 29, 17, STEEL_D); c.rect(30, 13, 30, 15, INK);                                        // muzzle
  c.rect(7, 10, 18, 19, STEEL_D); c.rect(8, 11, 17, 12, STEEL);                                        // body
  for (let i = 0; i < 9; i++) c.rect(9 + Math.floor(i / 3), 19 + i, 13 + Math.floor(i / 3), 19 + i, STEEL_D);  // grip
  c.rect(10, 20, 11, 26, STEEL);
  c.rect(15, 20, 16, 22, INK); c.set(14, 20, STEEL_D);                                                 // trigger
  c.circle(12, 7, 5, hex('#ee3b4b')); c.rect(7, 7, 17, 7, INK);                                        // Poké Ball drum
  for (let y = 8; y <= 12; y++) for (let x = 7; x <= 17; x++) if ((x - 12) ** 2 + (y - 7) ** 2 <= 25.25) c.set(x, y, WHITE);
  c.rect(11, 6, 13, 8, WHITE); c.set(12, 7, INK); c.set(9, 4, hex('#ff8a94')); c.set(10, 4, hex('#ff8a94'));
}
const TEAL = hex('#2dd4bf'), TEAL_D = hex('#0f766e'), TEAL_L = hex('#99f6e4'), VOLT = hex('#fde047'), VOLT_L = hex('#fef9c3'), VOLT_B = hex('#7dd3fc');
function laserGun(c) {
  c.rect(6, 11, 20, 18, TEAL); c.rect(7, 11, 19, 11, TEAL_L); c.rect(6, 18, 20, 18, TEAL_D);     // body
  c.rect(10, 7, 16, 10, TEAL_D); c.rect(11, 7, 15, 7, TEAL);                                       // top fin
  c.rect(20, 12, 27, 16, TEAL_D); c.rect(20, 12, 27, 12, TEAL); c.rect(21, 14, 26, 14, TEAL);     // barrel
  c.circle(28.5, 14, 2.5, VOLT); c.set(28, 13, VOLT_L); c.set(29, 14, VOLT_L);                     // emitter
  for (const [x, y] of [[31, 14], [30, 10], [30, 18], [31, 12], [31, 16], [29, 9], [29, 19]]) c.set(x, y, VOLT_B); // electric arcs
  c.set(31, 13, VOLT_L); c.set(31, 15, VOLT_L);
  c.rect(12, 13, 17, 15, VOLT); c.rect(13, 13, 16, 13, VOLT_L); c.set(14, 14, VOLT_B); c.set(16, 14, VOLT_B); // charged cell
  for (let i = 0; i < 9; i++) c.rect(8 + Math.floor(i / 3), 19 + i, 12 + Math.floor(i / 3), 19 + i, TEAL_D);  // grip
  c.rect(9, 20, 10, 26, TEAL);
  c.rect(14, 19, 15, 21, INK);                                                                     // trigger
}
function timer(c) {
  c.circle(16, 18, 11, GOLD); c.circle(16, 18, 8.5, WHITE);                                        // case + face
  for (let y = 18; y <= 29; y++) for (let x = 16; x <= 27; x++) if (c.get(x, y) === GOLD) c.set(x, y, GOLD_D);  // shade
  c.rect(14, 3, 17, 6, GOLD); c.rect(15, 6, 16, 8, GOLD_D); c.rect(14, 3, 17, 3, GOLD_L);         // crown
  c.rect(25, 8, 27, 10, GOLD); c.set(24, 10, GOLD_D);                                              // side button
  c.rect(16, 10, 16, 11, INK); c.rect(16, 25, 16, 26, INK); c.rect(8, 18, 9, 18, INK); c.rect(23, 18, 24, 18, INK);  // ticks
  c.line(16, 18, 16, 12, INK); c.line(16, 18, 21, 18, INK); c.circle(16, 18, 1, hex('#ef4444'));  // hands
  c.set(11, 13, GOLD_L); c.set(12, 12, GOLD_L);
}
const BLUE = hex('#3b82f6'), BLUE_D = hex('#1d4ed8'), BLUE_L = hex('#93c5fd');
function blueHeart(c) {
  c.circle(11, 12, 6, BLUE); c.circle(21, 12, 6, BLUE);
  for (let y = 12; y <= 27; y++) { const hw = Math.round((27 - y) * (11 / 15)); c.rect(16 - hw, y, 16 + hw, y, BLUE); }
  for (let y = 19; y <= 27; y++) for (let x = 16; x <= 29; x++) if (c.get(x, y) === BLUE) c.set(x, y, BLUE_D);
  for (let y = 12; y <= 18; y++) for (let x = 24; x <= 29; x++) if (c.get(x, y) === BLUE) c.set(x, y, BLUE_D);
  c.circle(10, 10, 2.6, BLUE_L); c.set(8, 9, WHITE); c.set(9, 8, WHITE); c.set(9, 9, WHITE);
}

const ICONS = { chest_closed: chestClosed, chest_open: chestOpen, ballGun, laserGun, timer, blueHeart };

mkdirSync(OUT, { recursive: true });
const canvases = {};
for (const [name, draw] of Object.entries(ICONS)) {
  const c = new Canvas(); draw(c); c.outline(INK);
  canvases[name] = c;
  writeFileSync(join(OUT, `${name}.png`), encodePNG(S, S, c.rgba()));
  console.log('wrote', `public/sprites/loot/${name}.png`);
}

const pi = process.argv.indexOf('--preview');
if (pi >= 0 && process.argv[pi + 1]) {
  const K = 6, names = Object.keys(canvases), W = names.length * (S + 2) * K, H = (S + 2) * K;
  const b = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { b[i * 4] = 40; b[i * 4 + 1] = 60; b[i * 4 + 2] = 90; b[i * 4 + 3] = 255; }
  names.forEach((n, ni) => { const c = canvases[n]; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const p = c.get(x, y); if (!p) continue; for (let dy = 0; dy < K; dy++) for (let dx = 0; dx < K; dx++) { const X = (ni * (S + 2) + 1 + x) * K + dx, Y = (1 + y) * K + dy, o = (Y * W + X) * 4; const a = p[3] / 255; b[o] = Math.round(p[0] * a + 40 * (1 - a)); b[o + 1] = Math.round(p[1] * a + 60 * (1 - a)); b[o + 2] = Math.round(p[2] * a + 90 * (1 - a)); b[o + 3] = 255; } } });
  writeFileSync(process.argv[pi + 1], encodePNG(W, H, b));
  console.log('preview', process.argv[pi + 1]);
}
