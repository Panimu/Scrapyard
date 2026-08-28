/**
 * `npm run plasma` - the Kenney particles this game needs, downscaled to the size it draws them.
 *
 *   flame_05, flame_06  ->  burn_0, burn_1     the flames a burning body wears
 *   muzzle_02           ->  gout               the bolt it throws
 *   circle_05           ->  gout_haze          the heat around that bolt
 *   twirl_01..03       ->  twirl_0..2         the Energy Shield's sweeping arcs
 *
 * ---------------------------------------------------------------------------------------------
 * WHY KENNEY AND NOT DCSS, WHICH IS WHAT THIS USED TO BAKE
 * ---------------------------------------------------------------------------------------------
 * `assets/README.md` draws a line: the Scrapyard is Kenney, and DCSS is for Mossy Mayhem's
 * CREATURES. The first version of this tool took `dcss/full/effect/flame_{0,1,2}` - fire, in the
 * right register, on the wrong side of that line for a weapon effect. It also looked worse for a
 * reason that had nothing to do with taste: those tiles are 32x32 with the colour baked in, so at
 * the size a burning enemy is drawn they are a bright orange smudge that changes shape slightly,
 * and nothing can be done about the colour.
 *
 * The Kenney particles are WHITE, which is the whole point of them. A white silhouette can be
 * tinted per draw, so the renderer can put a deep orange copy behind a pale one and get a
 * TEMPERATURE GRADIENT - the thing that separates fire from an orange shape - out of art that
 * carries no colour at all.
 *
 * ---------------------------------------------------------------------------------------------
 * THEY ARE DOWNSCALED, WHICH IS THE OPPOSITE OF WHAT `make-moss-enemies` DOES
 * ---------------------------------------------------------------------------------------------
 * That tool upscales 32x32 DCSS tiles four times, because its creatures are drawn at 40-odd units
 * and the source goes to mush. These are 512x512 and are drawn at TWENTY pixels: shipping them
 * whole would be 150 kB of art for a sprite the size of a thumbnail, on a build that preloads
 * every texture before the first frame. 128 is comfortably past what a 20 px draw needs even at
 * 2x device pixel ratio, and it costs a tenth of the bytes.
 *
 * DOWNSCALED THROUGH A CANVAS, not by a nearest-neighbour drop: these are soft-edged particles and
 * the whole value of them is the soft edge. `imageSmoothingQuality = 'high'` is what keeps it.
 *
 * ---------------------------------------------------------------------------------------------
 * FOUR FRAMES OUT OF TWO FILES
 * ---------------------------------------------------------------------------------------------
 * The burn loop is four poses and only two are on disk: the renderer MIRRORS both horizontally for
 * the other two. A flame is asymmetric enough that its mirror reads as a different tongue rather
 * than as the same one flipped, so this doubles the loop for nothing - no extra bytes, no extra
 * texture binds, one branch on the frame index. See BURN_FRAMES in the renderers.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');
const KENNEY = join(ROOT, 'assets', 'kenney', 'particle-pack', 'PNG (Transparent)');

/** Baked size, in px. See the header for why this is smaller than the source. */
const SIZE = 128;

const SPRITES = [
  // The burn loop's two poses. Mirrored at draw time for the other two.
  ['burn_0', 'flame_05.png'],
  ['burn_1', 'flame_06.png'],

  // The bolt: a compact teardrop with a frayed edge - the one shape in the pack that reads as a
  // LUMP OF FIRE MOVING rather than as a flash at a muzzle.
  ['gout', 'muzzle_02.png'],

  // The heat around it. A plain soft blob, which is all a haze layer should ever be.
  ['gout_haze', 'circle_05.png'],

  // THE ENERGY SHIELD'S OUTER LAYER - three sweeping arcs, played as a loop. Not the Plasma
  // Thrower's, and they are baked here anyway rather than in a tool of their own: this file is
  // "the Kenney particles the game needs at a size the game needs", and a second tool that did
  // the identical downscale for three more files would be the same code twice.
  ['twirl_0', 'twirl_01.png'],
  ['twirl_1', 'twirl_02.png'],
  ['twirl_2', 'twirl_03.png'],

  // THE ARCS THAT CRAWL OVER A SLOWED BODY - the Phase Cannon's blast leaves everything it caught
  // dragging, and this is how a player reads that off the field rather than off a number.
  //
  // KENNEY'S, NOT `dcss/full/effect/zap_*`, AND THE REASON IS THE ONE THIS FILE ALREADY GIVES
  // ABOVE. The DCSS zaps are genuinely the better DRAWING of electricity - four hand-pixelled
  // zigzags - and they are on the wrong side of two lines. `assets/README.md` keeps DCSS for Mossy
  // Mayhem's creatures while the Scrapyard's effects are Kenney, and a weapon effect is seen on
  // every map. More practically they are 32x32 with the cyan baked in, so they cannot be tinted:
  // exactly the complaint that moved the burn off `flame_{0,1,2}` in the first place. These four
  // are WHITE branching arcs, which is what lets the renderer put a dim wide copy behind a pale
  // narrow one and get a glow out of art that carries no colour at all.
  ['zap_0', 'spark_01.png'],
  ['zap_1', 'spark_02.png'],
  ['zap_2', 'spark_03.png'],
  ['zap_3', 'spark_04.png'],
];

/** Chromium, from wherever this machine keeps it. Same resolution order as `make-icons`. */
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

  let bytes = 0;
  for (const [key, file] of SPRITES) {
    const src = await readFile(join(KENNEY, file));
    const dataUri = `data:image/png;base64,${src.toString('base64')}`;

    const out = await page.evaluate(
      async ([uri, size]) => {
        const img = new Image();
        img.src = uri;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, size, size);
        return c.toDataURL('image/png');
      },
      [dataUri, SIZE],
    );

    const buf = Buffer.from(out.slice('data:image/png;base64,'.length), 'base64');
    await writeFile(join(OUT_DIR, `${key}.png`), buf);
    bytes += buf.length;
    console.log(
      `  ${key.padEnd(10)} <- kenney/particle-pack/${file.padEnd(14)}` +
        ` ${(src.length / 1024).toFixed(1)} kB -> ${(buf.length / 1024).toFixed(1)} kB`,
    );
  }

  await browser.close();
  console.log(`\n${SPRITES.length} sprites, ${(bytes / 1024).toFixed(1)} kB -> ${OUT_DIR}`);
}

void main();
