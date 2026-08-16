/**
 * `npm run moss` - bakes Mossy Mayhem's creatures out of the vendored DCSS tiles into
 * public/sprites/ as `moss_*.png`.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS ONE COPIES RATHER THAN DRAWS, AND IT STILL EARNS A TOOL
 * ---------------------------------------------------------------------------------------------
 * Every other make-*.mjs paints a sprite from nothing. This one takes art somebody else drew and
 * does two things to it that MUST happen exactly once, in one place:
 *
 *   1. TRIM TO CONTENT. A DCSS tile is a 32x32 canvas with the creature somewhere inside it, and
 *      how much space is left around it varies wildly - a giant snail nearly fills its tile, a
 *      jackal sits in the bottom two thirds. Drawn untrimmed, `drawSize` would size the CANVAS
 *      and every creature would appear at a different fraction of its stated size. Trimmed, the
 *      PNG's own dimensions ARE the content, so the renderer sizes art rather than air and needs
 *      no per-hull measurement table (contrast HULL_CONTENT_PX in render/assets.ts, which exists
 *      solely because the Kenney sprites could not be trimmed after the fact).
 *
 *   2. UPSCALE 4x, NEAREST. 32 px of source against a 42-unit body on a 3x phone screen is a
 *      hair over one source pixel per three device pixels. Baking the magnification in with a
 *      hard nearest-neighbour step keeps the pixel grid square and intact; leaving it to the GPU
 *      gets it bilinearly smeared into mush at exactly the sizes the game uses most.
 *
 * The output is checked in like every other sprite, so nobody needs Chromium - or the 37 MB of
 * vendored tiles - to build or play.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SOURCE LIST IS THE PROVENANCE
 * ---------------------------------------------------------------------------------------------
 * Each row below names the DCSS tile it came from, by path. That is deliberate: `moss_hydra_5.png`
 * in public/sprites/ is a derived artefact with no way to say where it came from, and the question
 * asked later is always "which tile is this, and does the pack have a sibling of it". Keep the
 * paths exact. `assets/dcss/README.md` says where the packs themselves came from.
 *
 * `_new` suffixes are DCSS's own redraws of tiles it replaced. Prefer them; the `_old` tile beside
 * each one is a second visual for the same creature if variety ever runs short.
 *
 * NEVER run `npx playwright install` - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');
const DCSS = join(ROOT, 'assets', 'dcss');

/** Source-pixel magnification. See the header - this is baked, not left to the GPU. */
const UPSCALE = 4;

/**
 * `moss_<key>.png` <- DCSS tile. The key is what `content/creaturesMossy.ts` names.
 *
 * Grouped by the cycle that uses them, because that is how anyone reading this will want to find
 * a row, and because it makes an unused entry obvious.
 */
const SPRITES = [
  // 1  Sporeling - one creature at all three ranks
  ['wandering_mushroom', 'full/monster/fungi_plants/wandering_mushroom_new.png'],

  // 2  Blowfly / Stinger / Bloodsucker - three insects, one per rank
  ['giant_blowfly', 'full/monster/animals/giant_blowfly.png'],
  ['killer_bee', 'full/monster/animals/killer_bee.png'],
  ['giant_mosquito', 'full/monster/animals/giant_mosquito.png'],

  // 3  Jelly / Ooze / Shellback - the boss sheds its shell as it is hurt
  ['jelly', 'full/monster/amorphous/jelly.png'],
  ['ooze', 'full/monster/amorphous/ooze_new.png'],
  ['giant_snail', 'full/monster/animals/giant_snail.png'],
  ['giant_slug', 'full/monster/animals/giant_slug.png'],

  // 4  Jackal / Raiju / Hellhound
  ['jackal', 'full/monster/animals/jackal_new.png'],
  ['raiju', 'full/monster/animals/raiju.png'],
  ['hell_hound', 'full/monster/animals/hell_hound_new.png'],

  // 5  Vine Stalker - one creature at all three ranks
  ['vine_stalker', 'full/monster/fungi_plants/vine_stalker.png'],

  // 6  Draconian - one creature at all three ranks
  ['draconic_green', 'full/monster/draconic/draconic_base-green_new.png'],

  // 7  Earth elemental / Stone golem / Iron golem
  ['earth_elemental', 'full/monster/nonliving/earth_elemental.png'],
  ['stone_golem', 'full/monster/nonliving/stone_golem.png'],
  ['iron_golem', 'full/monster/nonliving/iron_golem.png'],

  // 8  Dragon / Golden dragon / Hydra - the boss loses a head per damage stage
  ['dragon', 'full/monster/dragons/dragon.png'],
  ['golden_dragon', 'full/monster/dragons/golden_dragon.png'],
  ['hydra_1', 'full/monster/dragons/hydra_1_new.png'],
  ['hydra_2', 'full/monster/dragons/hydra_2_new.png'],
  ['hydra_3', 'full/monster/dragons/hydra_3_new.png'],
  ['hydra_4', 'full/monster/dragons/hydra_4_new.png'],
  ['hydra_5', 'full/monster/dragons/hydra_5_new.png'],
];

/**
 * Runs INSIDE the page. Decodes the tile, finds the opaque bounding box, and redraws that box
 * alone at `UPSCALE` with smoothing off.
 *
 * The alpha threshold is 0, not something forgiving: DCSS tiles are hard-edged pixel art with no
 * antialiased fringe, so any non-zero alpha is real art and a threshold would eat a rim.
 */
const BAKE = `async (dataUrl, upscale) => {
  const im = new Image();
  im.src = dataUrl;
  await im.decode();

  const src = document.createElement('canvas');
  src.width = im.width; src.height = im.height;
  const sg = src.getContext('2d', { willReadFrequently: true });
  sg.drawImage(im, 0, 0);
  const px = sg.getImageData(0, 0, im.width, im.height).data;

  let x0 = im.width, y0 = im.height, x1 = -1, y1 = -1;
  for (let y = 0; y < im.height; y++) {
    for (let x = 0; x < im.width; x++) {
      if (px[(y * im.width + x) * 4 + 3] !== 0) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  // A fully transparent tile would leave the box inverted. Nothing in the list is blank, but a
  // silent 0x0 PNG is a far worse failure than a loud one.
  if (x1 < x0 || y1 < y0) throw new Error('tile is entirely transparent');

  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = w * upscale; out.height = h * upscale;
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, x0, y0, w, h, 0, 0, out.width, out.height);
  return { url: out.toDataURL('image/png'), w, h, srcW: im.width, srcH: im.height };
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

async function main() {
  const { chromium } = await import('@playwright/test');
  const launchOptions = {};
  const found = resolveChromium();
  if (found !== undefined) launchOptions.executablePath = found;

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(OUT_DIR, { recursive: true });

  for (const [key, rel] of SPRITES) {
    const srcPath = join(DCSS, rel);
    if (!existsSync(srcPath)) throw new Error(`missing DCSS tile: ${rel}`);
    const dataUrl = `data:image/png;base64,${(await readFile(srcPath)).toString('base64')}`;
    const r = await page.evaluate(`(${BAKE})(${JSON.stringify(dataUrl)}, ${UPSCALE})`);
    const buf = Buffer.from(r.url.slice(r.url.indexOf(',') + 1), 'base64');
    const file = `moss_${key}.png`;
    await writeFile(join(OUT_DIR, file), buf);
    console.log(
      `  ${file.padEnd(26)} ${String(r.srcW).padStart(2)}x${r.srcH} -> trimmed ${String(r.w).padStart(2)}x${String(r.h).padEnd(2)} -> ${r.w * UPSCALE}x${r.h * UPSCALE}  ${(buf.length / 1024).toFixed(1)} kB`,
    );
  }

  await browser.close();
  console.log(`\n  ${SPRITES.length} creature sprites -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
