#!/usr/bin/env node
/**
 * prepare_assets.mjs - copy the sprites the game ACTUALLY uses out of assets/kenney/** into
 * public/sprites/, under flat, lowercase, space-free names, and generate the PWA icons.
 *
 * WHY THIS EXISTS
 * ---------------
 * The four Kenney packs total 1090 files. Shipping them all would put ~85 MB of decoded texture
 * memory and 1090 service-worker cache entries on a phone (docs/ASSET_MANIFEST.md §5.2). This
 * script copies exactly 71 files - the ones docs/ASSET_MANIFEST.md §7 names - and nothing else.
 *
 * SOURCE PATHS CONTAIN SPACES AND PARENTHESES (`Top view`, `Default size`, `PNG (Transparent)`).
 * They are handled here as JS strings, never as shell words, and they never reach the browser:
 * every destination name is flat and URL-safe.
 *
 * IDEMPOTENT. Re-running copies nothing when the destination already matches the source byte
 * length and is no older than it. `--force` copies regardless.
 *
 * NOT DONE HERE, DELIBERATELY:
 *   - No downscaling of the 512x512 particles. That needs an image codec and this repo has no
 *     image dependency. The five particles we ship are 328 KB on disk and ~5 MB of VRAM, which is
 *     inside budget; the manifest's ~85 MB figure is for loading all 81 particles, which we do
 *     not. If a particle downscale is ever wanted it belongs in the atlas packer, not here.
 *   - No atlas packing. docs/ASSET_MANIFEST.md §6 recommends one packed 1024x1024 atlas and
 *     package.json already reserves `npm run assets` -> tools/pack-assets.mjs for it. Until that
 *     lands the renderer loads individual textures; see README "What's next".
 *
 * Usage:
 *   node tools/prepare_assets.mjs [--force] [--quiet]
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = join(ROOT, 'assets', 'kenney');
const OUT_SPRITES = join(ROOT, 'public', 'sprites');
const OUT_ICONS = join(ROOT, 'public', 'icons');

const FORCE = process.argv.includes('--force');
const QUIET = process.argv.includes('--quiet');

// ---------------------------------------------------------------------------------------------
// The manifest. Left column is relative to assets/kenney/, right column is the frame key the
// renderer asks for (src/render/assets.ts) and the file name under public/sprites/.
// ---------------------------------------------------------------------------------------------

/** @type {Array<[string, string]>} */
const COPIES = [];

// -- 1. The 8 player mechs. 148x154, art faces +x, rotation offset 0. ASSET_MANIFEST §1 --------
for (const colour of ['blue', 'green', 'red', 'yellow', '3Dblue', '3Dgreen', '3Dred', '3Dyellow']) {
  COPIES.push([
    `robot-pack/PNG/Top view/robot_${colour}.png`,
    `mech_${colour.toLowerCase()}.png`, // 3Dblue -> mech_3dblue, matching HERO_CATALOG.sprite
  ]);
}

// -- 2. All 48 enemies, RETINA (128x128). ASSET_MANIFEST §2 + gotcha 6: the Default size art is
//       a 3.3x upscale for swarmers on a DPR-3 screen; Retina cuts it to 1.6x. -----------------
for (let n = 1; n <= 48; n++) {
  const nn = String(n).padStart(2, '0');
  COPIES.push([`sci-fi-rts/PNG/Retina/Unit/scifiUnit_${nn}.png`, `enemy_${nn}.png`]);
}

// -- 3. Ground tile. Stays a standalone 64x64 power-of-two texture so WebGL REPEAT works;
//       a sub-rect of an atlas cannot wrap (ASSET_MANIFEST gotcha 8). ---------------------------
COPIES.push(['sci-fi-rts/PNG/Default size/Tile/scifiTile_42.png', 'floor.png']);

// -- 4. Shell and gem. ASSET_MANIFEST §3.2 / §3.5 ----------------------------------------------
COPIES.push(['space-shooter-extension/PNG/Sprites/Missiles/spaceMissiles_012.png', 'shell.png']);
// The missile racks draw a different projectile from the Cannon's shell - a longer finned body,
// so a screen carrying both reads as two weapons rather than one firing oddly.
COPIES.push(['space-shooter-extension/PNG/Sprites/Missiles/spaceMissiles_001.png', 'missile.png']);
// Machine gun rounds: a small slug, distinct from both the Cannon's shell and the missile body.
COPIES.push(['space-shooter-extension/PNG/Sprites/Missiles/spaceMissiles_027.png', 'slug.png']);
COPIES.push(['space-shooter-extension/PNG/Sprites/Parts/spaceParts_035.png', 'gem.png']);

// -- 5. Death puff, 7 frames. Strictly size-monotonic subset: 011 and 014 are deliberately
//       excluded because they break the ordering and the puff would pop inward. §3.4 -----------
const PUFF_FRAMES = ['008', '009', '010', '012', '013', '015', '016'];
PUFF_FRAMES.forEach((frame, i) => {
  COPIES.push([`space-shooter-extension/PNG/Sprites/Effects/spaceEffects_${frame}.png`, `puff_${i}.png`]);
});

// -- 6. The five particles we actually draw. All 512x512, all premultiplied alpha, all drawn
//       with blendMode 'add' which consumes RGB directly (gotcha 3). ---------------------------
COPIES.push(['particle-pack/PNG (Transparent)/muzzle_04.png', 'fx_muzzle.png']);
COPIES.push(['particle-pack/PNG (Transparent)/light_03.png', 'fx_flash.png']);
COPIES.push(['particle-pack/PNG (Transparent)/fire_01.png', 'fx_burst.png']);
COPIES.push(['particle-pack/PNG (Transparent)/star_08.png', 'fx_sparkle.png']);
COPIES.push(['particle-pack/PNG (Transparent)/trace_07.png', 'fx_trail.png']);

// ---------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------

function log(...args) {
  if (!QUIET) console.log(...args);
}

/** @returns {{ copied: number, skipped: number, bytes: number }} */
function copyAll() {
  mkdirSync(OUT_SPRITES, { recursive: true });

  const missing = [];
  for (const [src] of COPIES) {
    try {
      statSync(join(SRC_ROOT, src));
    } catch {
      missing.push(src);
    }
  }
  if (missing.length > 0) {
    console.error(`prepare_assets: ${missing.length} source file(s) missing under ${SRC_ROOT}:`);
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }

  let copied = 0;
  let skipped = 0;
  let bytes = 0;

  for (const [src, dest] of COPIES) {
    const from = join(SRC_ROOT, src);
    const to = join(OUT_SPRITES, dest);
    const s = statSync(from);
    bytes += s.size;

    if (!FORCE) {
      let d = null;
      try {
        d = statSync(to);
      } catch {
        /* not there yet */
      }
      if (d !== null && d.size === s.size && d.mtimeMs >= s.mtimeMs) {
        skipped++;
        continue;
      }
    }

    writeFileSync(to, readFileSync(from));
    copied++;
  }

  return { copied, skipped, bytes };
}

// ---------------------------------------------------------------------------------------------
// PWA icons
//
// Generated rather than committed as opaque binaries so the art is reviewable as code and a
// palette change is a one-line diff. A minimal PNG encoder is ~30 lines on top of node:zlib,
// which is cheaper than taking an image dependency for four flat-colour squares.
//
// iOS masks the corners of apple-touch-icon itself, so the source must be SQUARE and FULLY
// OPAQUE with the art inset (docs/IPHONE_PLATFORM.md §3.3). The maskable variant insets further:
// the maskable safe zone is the centre circle of 80% diameter, so art stays inside ~60%.
// ---------------------------------------------------------------------------------------------

const PALETTE = {
  bg: [0x0b, 0x0e, 0x13],
  panel: [0x16, 0x1c, 0x26],
  tread: [0x39, 0x44, 0x52],
  hull: [0x94, 0xa2, 0xb1],
  head: [0x6e, 0x7c, 0x8c],
  eye: [0xe8, 0xf2, 0xff],
  barrel: [0xe7, 0xb9, 0x00],
};

class Raster {
  constructor(size) {
    this.size = size;
    this.px = new Uint8Array(size * size * 4);
  }

  /** Solid fill of the whole canvas - keeps the icon opaque, which iOS requires. */
  clear(rgb) {
    const { px } = this;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = 255;
    }
  }

  /** Coordinates are fractions of the canvas, so one description serves every icon size. */
  rect(x0, y0, x1, y1, rgb, radius = 0) {
    const s = this.size;
    const ax = Math.round(x0 * s);
    const ay = Math.round(y0 * s);
    const bx = Math.round(x1 * s);
    const by = Math.round(y1 * s);
    const r = radius * s;
    for (let y = Math.max(0, ay); y < Math.min(s, by); y++) {
      for (let x = Math.max(0, ax); x < Math.min(s, bx); x++) {
        if (r > 0) {
          // Round the corners by testing against the inset corner circles.
          const cx = Math.min(Math.max(x + 0.5, ax + r), bx - r);
          const cy = Math.min(Math.max(y + 0.5, ay + r), by - r);
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (dx * dx + dy * dy > r * r) continue;
        }
        const i = (y * s + x) * 4;
        this.px[i] = rgb[0];
        this.px[i + 1] = rgb[1];
        this.px[i + 2] = rgb[2];
        this.px[i + 3] = 255;
      }
    }
  }

  circle(cxf, cyf, rf, rgb) {
    const s = this.size;
    const cx = cxf * s;
    const cy = cyf * s;
    const r = rf * s;
    const r2 = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(s, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(s, Math.ceil(cx + r)); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = (y * s + x) * 4;
        this.px[i] = rgb[0];
        this.px[i + 1] = rgb[1];
        this.px[i + 2] = rgb[2];
        this.px[i + 3] = 255;
      }
    }
  }

  /** PNG, colour type 6 (RGBA), bit depth 8, filter 0 on every row. */
  toPng() {
    const s = this.size;
    const stride = s * 4;
    const raw = Buffer.alloc((stride + 1) * s);
    for (let y = 0; y < s; y++) {
      raw[y * (stride + 1)] = 0; // filter: None
      Buffer.from(this.px.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(s, 0);
    ihdr.writeUInt32BE(s, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type RGBA
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/**
 * A top-down mech facing +x, matching the game's own facing convention, drawn entirely from
 * rectangles and circles so it stays legible at 180 px and at 32 px in a browser tab.
 * `inset` is the fraction of the canvas left empty around the art.
 */
function drawIcon(size, inset) {
  const r = new Raster(size);
  r.clear(PALETTE.bg);

  const a = inset;
  const b = 1 - inset;
  const w = b - a;
  const at = (u, v) => [a + u * w, a + v * w];

  // Backing plate, so the mech reads against the dark background at small sizes.
  {
    const [x0, y0] = at(0, 0);
    const [x1, y1] = at(1, 1);
    r.rect(x0, y0, x1, y1, PALETTE.panel, 0.16 * w);
  }
  // Treads, top and bottom (the long axis is horizontal - the mech faces right).
  for (const [ty0, ty1] of [
    [0.13, 0.29],
    [0.71, 0.87],
  ]) {
    const [x0, y0] = at(0.12, ty0);
    const [x1, y1] = at(0.82, ty1);
    r.rect(x0, y0, x1, y1, PALETTE.tread, 0.05 * w);
  }
  // Hull.
  {
    const [x0, y0] = at(0.17, 0.25);
    const [x1, y1] = at(0.74, 0.75);
    r.rect(x0, y0, x1, y1, PALETTE.hull, 0.07 * w);
  }
  // Head panel at the front (+x), carrying the eyes.
  {
    const [x0, y0] = at(0.56, 0.29);
    const [x1, y1] = at(0.74, 0.71);
    r.rect(x0, y0, x1, y1, PALETTE.head, 0.05 * w);
  }
  {
    const [ex, ey0] = at(0.65, 0.4);
    const [, ey1] = at(0, 0.6);
    r.circle(ex, ey0, 0.045 * w, PALETTE.eye);
    r.circle(ex, a + 0.6 * w, 0.045 * w, PALETTE.eye);
    void ey0;
    void ey1;
  }
  // Barrel, pointing +x. The one warm colour in the icon.
  {
    const [x0, y0] = at(0.72, 0.45);
    const [x1, y1] = at(0.94, 0.55);
    r.rect(x0, y0, x1, y1, PALETTE.barrel, 0.03 * w);
  }
  return r.toPng();
}

function writeIcons() {
  mkdirSync(OUT_ICONS, { recursive: true });
  /** @type {Array<[string, number, number]>} name, size, inset */
  const icons = [
    // THE icon iOS actually uses. Square, opaque, art inset ~10% - iOS masks the corners itself.
    ['apple-touch-icon-180.png', 180, 0.1],
    ['icon-192.png', 192, 0.1],
    ['icon-512.png', 512, 0.1],
    // Maskable safe zone is the centre circle of 80% diameter, so the art insets further.
    ['icon-maskable-512.png', 512, 0.22],
    // Browser tab / bookmark.
    ['favicon-32.png', 32, 0.06],
  ];
  let bytes = 0;
  for (const [name, size, inset] of icons) {
    const png = drawIcon(size, inset);
    writeFileSync(join(OUT_ICONS, name), png);
    bytes += png.length;
  }
  return { count: icons.length, bytes };
}

// ---------------------------------------------------------------------------------------------

const t0 = Date.now();
const sprites = copyAll();
const icons = writeIcons();

log(
  `prepare_assets: ${COPIES.length} sprites (${sprites.copied} copied, ${sprites.skipped} up to date, ` +
    `${(sprites.bytes / 1024).toFixed(0)} KB) -> public/sprites/`,
);
log(`prepare_assets: ${icons.count} icons (${(icons.bytes / 1024).toFixed(0)} KB) -> public/icons/`);
log(`prepare_assets: done in ${Date.now() - t0} ms`);
