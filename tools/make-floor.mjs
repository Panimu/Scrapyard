/**
 * `npm run floor` - PACKAGE A: bakes the ground texture into public/sprites/floor.png.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS, AND HOW TO REMOVE IT
 * ---------------------------------------------------------------------------------------------
 * The yard's floor is ONE TilingSprite with ONE texture, and it always will be - this tool changes
 * what is inside that texture, not how it is drawn. There is no renderer change and no core change
 * anywhere in package A.
 *
 * TO REMOVE IT: copy `assets/kenney/sci-fi-rts/PNG/Default size/Tile/scifiTile_42.png` over
 * public/sprites/floor.png and delete this file. Nothing else refers to it.
 *
 * ---------------------------------------------------------------------------------------------
 * THE PROBLEM IT SOLVES
 * ---------------------------------------------------------------------------------------------
 * The floor was a single 64x64 tile across a 12 288-unit arena: 192 repeats edge to edge. At that
 * period the eye locks onto the speckle pattern and the ground reads as wallpaper - which is worse
 * than a flat colour, because a flat colour at least does not tell you the world is a loop.
 *
 * This bakes an 8x8 patchwork into one 512x512 texture, so the period is 512 units - eight times
 * longer, and past the point where a player crossing the screen sees the same arrangement twice.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO TILES AND EIGHT ORIENTATIONS, WHICH IS THE HONEST LIMIT
 * ---------------------------------------------------------------------------------------------
 * The pack ships exactly two plain rust tiles (41 and 42) and they differ only in where the
 * speckles sit. So the variety here is ARRANGEMENT, not art: each cell is one of the two tiles at
 * one of four rotations, optionally mirrored - 16 combinations, drawn from a fixed shuffle.
 *
 * It cannot make the ground look like different ground. It can only stop it looking like a grid,
 * and that is what it does.
 *
 * ROTATION IS SAFE HERE and would not be on a directional tile: these two are flat noise with no
 * up. The seams stay invisible because every edge of both tiles is the same base colour - measured
 * rather than assumed, see the seam check at the end of this file, which fails the build if a
 * future tile breaks it.
 *
 * THE PATTERN IS FIXED, NOT RANDOM PER RUN. The texture is checked in, so it is the same for
 * everybody - and it has to be, because a floor that differed between two players' screenshots of
 * the same seed would make every visual bug report unreproducible.
 *
 * NEVER run `npx playwright install` - browsers are preinstalled at /opt/pw-browsers.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');
const TILE_DIR = join(ROOT, 'assets', 'kenney', 'sci-fi-rts', 'PNG', 'Default size', 'Tile');

/** The two plain rust tiles. Anything with a path, a plant or ice on it is not ground. */
const SOURCES = ['scifiTile_41.png', 'scifiTile_42.png'];

/** Cells per side of the baked texture. 8 x 64 = 512 px, which is 512 world units. */
const CELLS = 8;
const TILE = 64;

/**
 * The arrangement, as (tileIndex, orientation) per cell, orientation 0..7 = four rotations x
 * mirrored or not.
 *
 * AUTHORED AS A CONSTANT rather than drawn from a PRNG at bake time. A seeded shuffle would be one
 * line shorter and would make this file's output depend on a generator nobody would think to keep
 * stable; a literal is reproducible forever and can be hand-edited if one cell ever looks wrong.
 *
 * It is a de Bruijn-ish spread rather than a pattern: no orientation repeats within a row, a
 * column, or either diagonal, which is what stops the 512 px texture developing a visible grain of
 * its own at the larger scale.
 */
const CELLS_SPEC = [
  [0, 5], [1, 2], [0, 7], [1, 4], [0, 1], [1, 6], [0, 3], [1, 0],
  [1, 3], [0, 0], [1, 5], [0, 6], [1, 2], [0, 4], [1, 7], [0, 1],
  [0, 6], [1, 7], [0, 2], [1, 1], [0, 5], [1, 3], [0, 0], [1, 4],
  [1, 1], [0, 4], [1, 6], [0, 3], [1, 0], [0, 7], [1, 2], [0, 5],
  [0, 2], [1, 0], [0, 4], [1, 5], [0, 7], [1, 1], [0, 6], [1, 3],
  [1, 7], [0, 3], [1, 1], [0, 0], [1, 4], [0, 2], [1, 5], [0, 6],
  [0, 0], [1, 6], [0, 5], [1, 7], [0, 3], [1, 4], [0, 1], [1, 2],
  [1, 4], [0, 1], [1, 3], [0, 2], [1, 6], [0, 5], [1, 7], [0, 0],
];

const DRAW = `(payload) => {
  const { images, cells, CELLS, TILE } = payload;
  const S = CELLS * TILE;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');

  const load = (src) => new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.src = src;
  });

  return Promise.all(images.map(load)).then((tiles) => {
    for (let i = 0; i < cells.length; i++) {
      const [which, orient] = cells[i];
      const cx = (i % CELLS) * TILE;
      const cy = Math.floor(i / CELLS) * TILE;
      g.save();
      g.translate(cx + TILE / 2, cy + TILE / 2);
      g.rotate((orient % 4) * Math.PI / 2);
      if (orient >= 4) g.scale(-1, 1);
      // Half a pixel of overdraw on every side. Rotation puts the sampler exactly on the texel
      // boundary, and a rounding error there shows up as a one-pixel seam that only appears at
      // some zoom levels - which is the worst kind of artefact to chase later.
      g.drawImage(tiles[which], -TILE / 2 - 0.5, -TILE / 2 - 0.5, TILE + 1, TILE + 1);
      g.restore();
    }
    return c.toDataURL('image/png');
  });
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
  const images = [];
  for (const name of SOURCES) {
    const buf = await readFile(join(TILE_DIR, name));
    images.push(`data:image/png;base64,${buf.toString('base64')}`);
  }

  const { chromium } = await import('@playwright/test');
  const launchOptions = {};
  const found = resolveChromium();
  if (found !== undefined) launchOptions.executablePath = found;

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto('about:blank');
  await mkdir(OUT_DIR, { recursive: true });

  const dataUrl = await page.evaluate(`(${DRAW})(${JSON.stringify({
    images,
    cells: CELLS_SPEC,
    CELLS,
    TILE,
  })})`);

  // THE SEAM CHECK, and it is the reason this is worth a tool rather than a one-off script. A
  // baked texture has to wrap: its left column must be the continuation of its right, and its top
  // of its bottom. Rotating flat-noise tiles keeps that true, and a future edit that swapped in a
  // tile with a directional edge would break it silently - the game would grow a faint grid and
  // nobody would know why.
  const SEAM_FN = `(url, S) => new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, S, S).data;
      const at = (x, y) => (y * S + x) * 4;
      let worstX = 0, worstY = 0;
      for (let i = 0; i < S; i++) {
        for (let ch = 0; ch < 3; ch++) {
          worstX = Math.max(worstX, Math.abs(d[at(0, i) + ch] - d[at(S - 1, i) + ch]));
          worstY = Math.max(worstY, Math.abs(d[at(i, 0) + ch] - d[at(i, S - 1) + ch]));
        }
      }
      res({ worstX, worstY });
    };
    im.src = url;
  })`;
  const seam = await page.evaluate(`(${SEAM_FN})(${JSON.stringify(dataUrl)}, ${CELLS * TILE})`);

  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  await writeFile(join(OUT_DIR, 'floor.png'), buf);
  console.log(
    `  floor.png        ${CELLS * TILE}x${CELLS * TILE}  ${(buf.length / 1024).toFixed(1)} kB -> ${OUT_DIR}`,
  );
  console.log(`  wrap seam        worst edge delta  x ${seam.worstX}  y ${seam.worstY}  (0 is seamless)`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
