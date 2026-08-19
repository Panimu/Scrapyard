/**
 * `npm run levelart` - draws each level's SELECT-SCREEN ICON into public/sprites/.
 *
 * WHY A TOOL AND NOT A HAND-PICKED SPRITE. The Scrapyard's card wears `scrap_0`, a piece of its
 * own scenery, and that worked because the scrap piles happen to be square single-frame sprites.
 * Mossy Mayhem has nothing of the kind: its trees and bushes are SWAY SHEETS - `mwall_tree0` is
 * 1936x380, eight frames in a strip - so pointing the card at one would show the whole animation
 * squashed into an 84 px box. There is no croppable single frame checked in to point at, so the
 * icon is composited from the level's own art instead of drawn from nothing.
 *
 * WHAT IT COMPOSITES, and every part is the level's real art rather than an impression of it:
 * the floor tile the yard is actually drawn on, and one tree frame lifted off the sway sheet at
 * the same size the field draws it. A player who reaches Mossy sees exactly this ground and
 * exactly this tree, which is the whole job of a level icon - it is a photograph of the place,
 * not a logo for it.
 *
 * 192 px SQUARE, matching `scrap_0` so the two cards are the same weight in the list.
 *
 * NEVER run `npx playwright install` - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPRITES = join(ROOT, 'public', 'sprites');

/** Matches `scrap_0`, the Scrapyard's card art, so neither card is the bigger picture. */
const S = 192;

/** Must match SWAY_FRAMES in src/render/assets.ts - the strip is that many frames wide. */
const SWAY_FRAMES = 8;

const LEVELS = [
  {
    out: 'level_mossy',
    floor: 'floor_moss',
    // Tree 0 is the biggest of the three and the one that reads at icon size; frame 0 is the
    // rest pose, so the icon is not a tree caught mid-lean.
    prop: 'mwall_tree0',
    frame: 0,
  },
];

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

const dataUri = async (key) =>
  `data:image/png;base64,${(await readFile(join(SPRITES, `${key}.png`))).toString('base64')}`;

const DRAW = `async (job) => {
  const S = ${S};
  const FRAMES = ${SWAY_FRAMES};
  const load = (src) => new Promise((ok, no) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => no(new Error('load failed'));
    im.src = src;
  });

  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');

  // ---- the ground. Drawn as a TILE rather than stretched: the moss floor is a 512 px repeating
  // texture and scaling one copy to fill the icon would show a blur of one blade of grass.
  const floor = await load(job.floor);
  const TILE = Math.round(S / 2);
  for (let y = 0; y < S; y += TILE) {
    for (let x = 0; x < S; x += TILE) g.drawImage(floor, x, y, TILE, TILE);
  }

  // A vignette, so the ground has depth and the tree has something to sit against at the edges.
  const vig = g.createRadialGradient(S / 2, S / 2, S * 0.22, S / 2, S / 2, S * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(6,10,8,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, S, S);

  // ---- AND THEN THE GROUND FADES OUT, which is what makes this a card icon rather than a
  // swatch. The Scrapyard's art is a transparent PNG of some wrecks, so it FLOATS on the card's
  // dark plate; a full-bleed square of grass beside it reads as a sticker stuck to the same
  // plate, and the two cards stop looking like they belong to one game. Erasing the outer ring to
  // transparent gives this the same floating silhouette out of art that has no transparency of
  // its own. Done BEFORE the tree, so the tree keeps its own hard edges and stays the subject.
  g.globalCompositeOperation = 'destination-out';
  const fade = g.createRadialGradient(S / 2, S / 2, S * 0.30, S / 2, S / 2, S * 0.50);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.75, 'rgba(0,0,0,0.55)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fade;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';

  // ---- one tree, lifted off the sway sheet at its own aspect and centred low, the way it stands
  // on the field: roots near the bottom edge, canopy filling the upper two thirds.
  const sheet = await load(job.prop);
  const fw = Math.round(sheet.width / FRAMES);
  const fh = sheet.height;
  const scale = Math.min((S * 0.78) / fw, (S * 0.86) / fh);
  const dw = fw * scale;
  const dh = fh * scale;
  g.drawImage(sheet, job.frame * fw, 0, fw, fh, (S - dw) / 2, S - dh - S * 0.06, dw, dh);

  return c.toDataURL('image/png');
}`;

async function main() {
  const { chromium } = await import('@playwright/test');
  const found = resolveChromium();
  const browser = await chromium.launch(found !== undefined ? { executablePath: found } : {});
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(SPRITES, { recursive: true });

  let bytes = 0;
  for (const level of LEVELS) {
    const job = {
      floor: await dataUri(level.floor),
      prop: await dataUri(level.prop),
      frame: level.frame,
    };
    const uri = await page.evaluate(`(${DRAW})(${JSON.stringify(job)})`);
    const buf = Buffer.from(uri.split(',')[1], 'base64');
    await writeFile(join(SPRITES, `${level.out}.png`), buf);
    bytes += buf.length;
  }

  await browser.close();
  console.log(`${LEVELS.length} level icon${LEVELS.length === 1 ? '' : 's'}, ${Math.round(bytes / 1024)} kB -> ${SPRITES}`);
}

await main();
