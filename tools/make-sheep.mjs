/**
 * `npm run sheep` - bakes Mossy Mayhem's SHEEP out of the vendored Tiny Swords resources into
 * public/sprites/ as `msheep_*.png`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT A SHEEP IS FOR
 * ---------------------------------------------------------------------------------------------
 * It is the moss map's FUEL DRUM: the thing that holds a consumable and gives it up when something
 * hits it. The Scrapyard's drum is a circle baked into the terrain and never moves; this one walks
 * around, grazes, and runs away from the mech. Everything about the sprite follows from that - see
 * `core/systems/sheep.ts` for the behaviour and `core/entity/sheepPool.ts` for the state.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO ANIMATIONS, AND `Sheep_Idle` IS NOT ONE OF THEM
 * ---------------------------------------------------------------------------------------------
 * The pack ships three sheets. `Sheep_Grass` (12 frames) is the head-down graze, `Sheep_Move`
 * (4 frames) is the walk, and `Sheep_Idle` (6 frames) is a standing breath so subtle that at the
 * size this draws it is indistinguishable from a still image - measured: its frames differ, but
 * every one of them has the identical opaque box, which is the tell.
 *
 * So a sheep is only ever GRAZING or WALKING, which is also what the behaviour has: it stands with
 * its head down until something makes it move. Baking the idle sheet as well would have been a
 * third TextureSource for a state nothing can see.
 *
 * ---------------------------------------------------------------------------------------------
 * BAKED AS HORIZONTAL STRIPS, FOR THE REASON THE TREES ARE
 * ---------------------------------------------------------------------------------------------
 * Frames as separate FILES would be one TextureSource per frame, and a flock is phase-staggered by
 * necessity - twelve sheep grazing in lockstep is a chorus line, not a field - so a screenful would
 * interleave a dozen sources and shred the batch. Frames cut out of ONE strip share their source,
 * so the whole flock is two sources however many are on screen. Pixi batches up to sixteen.
 *
 * EVERY FRAME IS CROPPED TO THE UNION of all frames' opaque boxes rather than to its own. This is
 * the same rule the sway strips keep and for the same reason: per-frame trimming re-centres the
 * body on every frame and deletes the animation it is meant to preserve. On the walk that motion is
 * most of the character - the sheep bobs forward into its own step.
 *
 * NEVER RUN `npx playwright install` - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(
  ROOT,
  'assets',
  'tinyswords',
  'tiny-swords-free-pack',
  'Terrain',
  'Resources',
  'Meat',
  'Sheep',
);
const OUT_DIR = join(ROOT, 'public', 'sprites');

/**
 * 2x nearest, matching the walls and the trees this animal stands among. Tiny Swords is drawn on a
 * 64-unit grid at 128 px, so the sheep arrives about 46 px across and leaves at 92 - which is what
 * keeps its pixels the same size as the grass it is standing on.
 */
const UPSCALE = 2;

/** `[key, file, frames]`. Frame counts are the sheets' own - see the header. */
const SHEETS = [
  ['msheep_graze', 'Sheep_Grass.png', 12],
  ['msheep_walk', 'Sheep_Move.png', 4],
];

/**
 * Runs INSIDE the page. Cuts `frames` equal columns out of a sheet, finds the UNION of their opaque
 * boxes, crops every frame to THAT box, and lays them out left to right at `upscale`.
 *
 * Lifted from `make-moss-walls.mjs` rather than shared, and that is deliberate: it is twenty lines
 * of canvas that runs in a different process than the module system, and a tools/ helper library
 * imported into a `page.evaluate` string is a build step for nobody's benefit.
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
  if (x1 < x0 || y1 < y0) throw new Error('sheep sheet is entirely transparent');

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

  console.log('');
  for (const [key, file, frames] of SHEETS) {
    const url = await dataUrlOf(join(SRC, file));
    const r = await page.evaluate(`(${BAKE_STRIP})(${JSON.stringify(url)}, ${frames}, ${UPSCALE})`);
    const buf = Buffer.from(r.url.split(',')[1], 'base64');
    await writeFile(join(OUT_DIR, `${key}.png`), buf);
    console.log(
      `  ${`${key}.png`.padEnd(18)} ${String(r.w).padStart(3)}x${String(r.h).padEnd(3)} x${frames}` +
        ` -> ${String(r.w * frames * UPSCALE).padStart(4)}x${String(r.h * UPSCALE).padEnd(3)}` +
        `  ${(buf.length / 1024).toFixed(1)} kB`,
    );
  }

  await browser.close();
  console.log(`\n  ${SHEETS.length} sheep strips -> ${OUT_DIR}\n`);
}

await main();
