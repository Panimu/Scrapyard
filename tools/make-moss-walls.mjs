/**
 * `npm run walls` - bakes Mossy Mayhem's WALL SEGMENTS out of the vendored Tiny Swords terrain
 * into public/sprites/ as `mwall_*.png`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT A WALL IS MADE OF, AND WHY IT IS TWENTY-SIX SPRITES RATHER THAN ONE
 * ---------------------------------------------------------------------------------------------
 * A Mossy wall is a lattice of 64-unit cells (see `core/content/wallsMossy.ts`), and which sprite
 * a cell draws depends on WHICH OF ITS NEIGHBOURS ARE ALSO WALL. That is an autotile, and the
 * Tiny Swords tileset is laid out for exactly one:
 *
 *     cols 0,1,2 = left edge / middle / right edge      col 3 = a ONE-CELL-WIDE column
 *     rows 0,1,2 = top edge  / middle / bottom edge     row 3 = a ONE-CELL-TALL bar
 *     (3, 3)                                           = a lone 1x1 block
 *
 * Sixteen pieces, and the thin variants are the reason this tileset was chosen over the others
 * tried: a wall ONE CELL THICK is a first-class citizen here rather than something that has to be
 * doubled up to look right, and one cell thick is what the brief asked for. This took a seam test
 * to establish - the obvious reading is a 4x4 edge set, which puts a visible rim between every
 * pair of adjacent cells.
 *
 * THE CLIFF FACE is the other four. Any cell with nothing below it is an edge being looked at from
 * the front, and it gets a face drawn under it - which is what stops a wall reading as a flat patch
 * of ground and starts it reading as something with height.
 *
 * ---------------------------------------------------------------------------------------------
 * THE FACE IS CUT TO 36 OF ITS 64 PIXELS, AND THAT IS THE WHOLE DIFFERENCE
 * ---------------------------------------------------------------------------------------------
 * Drawn at its full height a wall cell is a 64 u grass top PLUS a 64 u stone face - 128 u of
 * vertical against a 52 u mech, so the walls loomed and the mech read as a toy. The BOTTOM 36 px
 * of the face row keeps the rounded base (which is the part that reads as stone) and drops the
 * height. It is the single change that made the segments sit down beside the player, and it is
 * why this is a crop rather than a copy.
 *
 * ---------------------------------------------------------------------------------------------
 * TREES ARE THE DESTRUCTIBLE VARIETY, AND THEIR STUMPS COME FROM THE SAME PACK
 * ---------------------------------------------------------------------------------------------
 * A destructible cell draws a tree; once it has been broken it draws that tree's STUMP. Tiny
 * Swords ships both, drawn by the same hand at the same scale - Stump N is literally Tree N cut
 * down, right down to the trunk colour (1 and 2 are the pines' brown, 3 and 4 the birches' white).
 * Pairing them by index is therefore not a convention this tool invented; it is the one the pack
 * already had, and it is why the destructible variety did not need a second source. Keep TREES and
 * STUMPS in step: index N of one must be the same tree as index N of the other.
 *
 * THE TREES SWAY, AND ALL EIGHT FRAMES ARE BAKED. This used to take frame 0 only, on the grounds
 * that the lattice is static world geometry drawn by the hundred and a per-cell animation clock was
 * not worth paying for. The clock turned out to cost nothing (one integer per cell per frame, from
 * a hash the dressing already computes) and the wood turned out to be worth a great deal: a
 * treeline that moves is the difference between scenery and a place.
 *
 * BAKED AS A HORIZONTAL STRIP, ONE PER VARIANT, and that is the part that matters for performance.
 * Eight frames as eight FILES would be eight TextureSources per tree, and with the wood phase-
 * staggered - which it must be, or a forest sways in lockstep like a chorus line - a screenful
 * would interleave two dozen sources and shred the batch. Frames cut out of ONE strip share their
 * source, so the whole wood is three sources however many frames are on screen at once, and the
 * bushes are four more. Pixi batches up to sixteen.
 *
 * EVERY FRAME IS CROPPED TO THE SAME BOX - the UNION of all eight frames' content, not each
 * frame's own. Trimming per frame would delete exactly the motion being baked: the sway IS the
 * canopy moving inside its box, so per-frame trimming re-centres it every frame and the tree
 * stands perfectly still while its outline breathes.
 *
 * ---------------------------------------------------------------------------------------------
 * BUSHES ARE UNDERGROWTH, AND THEY ARE THE SAME SHAPE OF THING
 * ---------------------------------------------------------------------------------------------
 * Four bush types, eight sway frames each, baked into strips the same way. They are drawn at the
 * FOOT of a tree clump (dressingMoss.ts), which is what hides the line where trunks meet the
 * ground - the giveaway that a treeline is a row of stamps rather than a wood.
 *
 * NOTHING COLLIDES WITH A BUSH. They are inside the treed cell that already collides, so they add
 * no promise the simulation does not keep; scattering them onto open ground would.
 *
 * ---------------------------------------------------------------------------------------------
 * 2x, AND WHY NOT 1x OR 4x
 * ---------------------------------------------------------------------------------------------
 * Every texture in this game is drawn with `scaleMode: 'linear'` (ASSET_MANIFEST gotcha 6), so the
 * magnification has to be baked with a hard nearest step or the GPU smears the pixel grid. A 64 px
 * tile covering a 64 u cell is 1 texel per unit - the same density as the moss floor it sits on,
 * which is the thing it must not look detached from - but the camera reaches about 2.5 device px
 * per unit on a desktop, and a 1x tile is visibly soft there. 2x covers that case at 1:1 and costs
 * a mild downscale on a phone. 4x would be sharper at neither and four times the bytes.
 *
 * The output is checked in like every other sprite, so nobody needs Chromium - or the vendored
 * pack - to build or play.
 *
 * NEVER run `npx playwright install` - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');
const PACK = join(ROOT, 'assets', 'tinyswords', 'tiny-swords-free-pack');

/** Source-pixel magnification. See the header - this is baked, not left to the GPU. */
const UPSCALE = 2;

/** Edge of one tile on the Tiny Swords sheet, and of one wall cell in world units. */
const TILE = 64;

/**
 * WHICH PALETTE. The sheet ships five recolours of the same tiles; `Tilemap_color3` is the plain
 * green one, which is what was picked over the yellow-green `color1` after seeing both against the
 * moss floor. Changing this one number restyles every wall in the game.
 */
const TILESET = join(PACK, 'Terrain', 'Tileset', 'Tilemap_color3.png');

/** Column of the sheet where the cliff-face row starts, and the row it is on. */
const FACE_COL0 = 5;
const FACE_ROW = 5;
const FACE_VARIANTS = 4;

/**
 * How much of the 64 px face row survives, measured from its BOTTOM. See the header: this is the
 * number that decides whether a wall looms over the mech or stands beside it.
 */
const FACE_PX = 36;

/**
 * `mwall_tree<i>` / `mwall_stump<i>` <- these, paired by index. See the header - the pairing is
 * the pack's, not ours: stump N is tree N cut down.
 */
/**
 * TREE2 IS NOT HERE, and its absence is the point. The renderer sizes a tree by its HEIGHT (see
 * dressingMoss.ts - scaling by width let a tall one reach 200 units against a 52-unit mech), and
 * the four differ wildly in aspect: at a fixed height Tree1, Tree3 and Tree4 come out 69, 68 and
 * 72 units wide - all about one cell, so a run of them interlocks into a treeline - while Tree2 is
 * a spire that comes out 42 and leaves gaps a treeline should not have.
 */
const TREES = ['Tree1.png', 'Tree3.png', 'Tree4.png'];
const STUMPS = ['Stump 1.png', 'Stump 3.png', 'Stump 4.png'];

/**
 * Frames in a sway cycle. MUST match `SWAY_FRAMES` in render/assets.ts - the renderer cuts a strip
 * into this many equal columns and there is nothing in the PNG that says how many there are.
 */
const SWAY_FRAMES = 8;

/**
 * `mwall_bush<i>` <- these. Four types, each an 8-frame sway on a 128 px grid. Bushe3 is the
 * biggest and leafiest, Bushe2 the smallest; all four are drawn by the same hand as the trees.
 */
const BUSHES = ['Bushe1.png', 'Bushe2.png', 'Bushe3.png', 'Bushe4.png'];

/**
 * Runs INSIDE the page. Crops a rectangle out of a source PNG, optionally trims the result to its
 * opaque bounding box, and redraws it at `UPSCALE` with smoothing off.
 *
 * `trim` is off for the autotile and the face - those are grid pieces whose alignment IS their
 * meaning, and trimming one to its content would shift it against its neighbours by however much
 * transparent margin that particular tile happened to have. It is on for trees and stumps, which
 * are free-standing props the renderer positions by their own centre.
 *
 * The alpha threshold is 0 rather than something forgiving: this is hard-edged pixel art with no
 * antialiased fringe, so any non-zero alpha is real art and a threshold would eat a rim.
 */
const BAKE = `async (dataUrl, sx, sy, sw, sh, trim, upscale) => {
  const im = new Image();
  im.src = dataUrl;
  await im.decode();

  const src = document.createElement('canvas');
  src.width = sw; src.height = sh;
  const sg = src.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingEnabled = false;
  sg.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);

  let x0 = 0, y0 = 0, x1 = sw - 1, y1 = sh - 1;
  if (trim) {
    const px = sg.getImageData(0, 0, sw, sh).data;
    x0 = sw; y0 = sh; x1 = -1; y1 = -1;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (px[(y * sw + x) * 4 + 3] !== 0) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    // A fully transparent crop would leave the box inverted. Nothing in the list is blank, but a
    // silent 0x0 PNG is a far worse failure than a loud one.
    if (x1 < x0 || y1 < y0) throw new Error('crop is entirely transparent');
  }

  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = w * upscale; out.height = h * upscale;
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, x0, y0, w, h, 0, 0, out.width, out.height);
  return { url: out.toDataURL('image/png'), w, h };
}`;

/**
 * Runs INSIDE the page. Cuts `frames` equal columns out of a sway sheet, finds the UNION of their
 * opaque boxes, crops every frame to THAT box, and lays them out left to right at `upscale`.
 *
 * The union is the whole trick - see the header. Per-frame trimming would re-centre the canopy on
 * every frame and delete the sway it is meant to preserve.
 */
const BAKE_STRIP = `async (dataUrl, frames, upscale) => {
  const im = new Image();
  im.src = dataUrl;
  await im.decode();
  const fw = Math.round(im.width / frames);
  const fh = im.height;

  const src = document.createElement('canvas');
  src.width = im.width; src.height = fh;
  const sg = src.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingEnabled = false;
  sg.drawImage(im, 0, 0);
  const px = sg.getImageData(0, 0, im.width, fh).data;

  let x0 = fw, y0 = fh, x1 = -1, y1 = -1;
  for (let f = 0; f < frames; f++) {
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        if (px[(y * im.width + f * fw + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) throw new Error('sway sheet is entirely transparent');

  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = w * frames * upscale; out.height = h * upscale;
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (let f = 0; f < frames; f++) {
    g.drawImage(src, f * fw + x0, y0, w, h, f * w * upscale, 0, w * upscale, h * upscale);
  }
  return { url: out.toDataURL('image/png'), w, h };
}`;

function resolveChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const candidates = [];
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('chromium-')) candidates.push(join(root, entry, 'chrome-linux', 'chrome'));
  }
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('chromium_headless_shell-')) {
      candidates.push(join(root, entry, 'chrome-linux', 'headless_shell'));
    }
  }
  return candidates.find((p) => existsSync(p));
}

async function dataUrlOf(path) {
  if (!existsSync(path)) throw new Error(`missing vendored art: ${path}`);
  return `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
}

async function main() {
  const { chromium } = await import('@playwright/test');
  const launchOptions = {};
  const found = resolveChromium();
  if (found !== undefined) launchOptions.executablePath = found;

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(OUT_DIR, { recursive: true });

  let written = 0;
  const emit = async (key, url, sx, sy, sw, sh, trim) => {
    const r = await page.evaluate(
      `(${BAKE})(${JSON.stringify(url)}, ${sx}, ${sy}, ${sw}, ${sh}, ${trim}, ${UPSCALE})`,
    );
    const buf = Buffer.from(r.url.slice(r.url.indexOf(',') + 1), 'base64');
    await writeFile(join(OUT_DIR, `${key}.png`), buf);
    written++;
    console.log(
      `  ${`${key}.png`.padEnd(20)} ${String(r.w).padStart(3)}x${String(r.h).padEnd(3)} -> ${String(r.w * UPSCALE).padStart(3)}x${String(r.h * UPSCALE).padEnd(3)}  ${(buf.length / 1024).toFixed(1)} kB`,
    );
  };

  const sheet = await dataUrlOf(TILESET);

  // The sixteen autotile pieces. `mwall_t<col><row>`, so the renderer's lookup is the two indices
  // its neighbour test already produced and there is no table in between.
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      await emit(`mwall_t${col}${row}`, sheet, col * TILE, row * TILE, TILE, TILE, false);
    }
  }

  // The cliff faces, cropped to their bottom FACE_PX. Four variants so a long wall's front edge
  // does not repeat one stone every 64 units.
  for (let i = 0; i < FACE_VARIANTS; i++) {
    await emit(
      `mwall_face${i}`,
      sheet,
      (FACE_COL0 + i) * TILE,
      FACE_ROW * TILE + (TILE - FACE_PX),
      TILE,
      FACE_PX,
      false,
    );
  }

  const emitStrip = async (key, url) => {
    const r = await page.evaluate(`(${BAKE_STRIP})(${JSON.stringify(url)}, ${SWAY_FRAMES}, ${UPSCALE})`);
    const buf = Buffer.from(r.url.slice(r.url.indexOf(',') + 1), 'base64');
    await writeFile(join(OUT_DIR, `${key}.png`), buf);
    written++;
    console.log(
      `  ${`${key}.png`.padEnd(20)} ${String(r.w).padStart(3)}x${String(r.h).padEnd(3)} x${SWAY_FRAMES} -> ${String(r.w * SWAY_FRAMES * UPSCALE).padStart(4)}x${String(r.h * UPSCALE).padEnd(3)}  ${(buf.length / 1024).toFixed(1)} kB`,
    );
  };

  // Trees, as 8-frame sway strips. See the header for why the frames share one file and why every
  // frame is cropped to the same box.
  for (let i = 0; i < TREES.length; i++) {
    await emitStrip(
      `mwall_tree${i}`,
      await dataUrlOf(join(PACK, 'Terrain', 'Resources', 'Wood', 'Trees', TREES[i])),
    );
  }

  // The undergrowth, the same shape of thing.
  for (let i = 0; i < BUSHES.length; i++) {
    await emitStrip(
      `mwall_bush${i}`,
      await dataUrlOf(join(PACK, 'Terrain', 'Decorations', 'Bushes', BUSHES[i])),
    );
  }
  for (let i = 0; i < STUMPS.length; i++) {
    const url = await dataUrlOf(join(PACK, 'Terrain', 'Resources', 'Wood', 'Trees', STUMPS[i]));
    const size = await page.evaluate(
      `(async () => { const i = new Image(); i.src = ${JSON.stringify(url)}; await i.decode(); return [i.width, i.height]; })()`,
    );
    await emit(`mwall_stump${i}`, url, 0, 0, size[0], size[1], true);
  }

  await browser.close();
  console.log(`\n  ${written} wall sprites -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
