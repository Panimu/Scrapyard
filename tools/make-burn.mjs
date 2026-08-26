/**
 * `npm run burn` - the three flame frames that sit on a burning enemy.
 *
 *   assets/dcss/full/effect/flame_{0,1,2}.png  ->  public/sprites/burn_{0,1,2}.png
 *
 * A STRAIGHT COPY, AND THAT IS THE WHOLE TOOL. Every other sprite pipeline here either draws
 * something from scratch through a canvas (`make-mechs`, `make-icons`) or bakes a vendored tile
 * with real work in between - `make-moss-enemies` upscales four times and rebuilds a keyline,
 * because those creatures are drawn at 40-odd units and DCSS art at 32x32 goes to mush at that
 * size. These do not need any of it: a burn flame is drawn at about 16 units, so the source is
 * already larger than the destination and every pixel of processing would be thrown away by the
 * downscale.
 *
 * SO WHY A TOOL AT ALL, rather than copying three files by hand once. Because the copy is the
 * least interesting half of what this file is for: the other half is the record of WHERE they came
 * from, which is the question CLAUDE.md says actually gets asked six months later ("the pack had a
 * bear, does it have a wolf"). A tool that names its source paths answers that in one `cat`; three
 * files that appeared in a commit answer it with a search.
 *
 * PREFERRED OVER DRAWING THEM, per CLAUDE.md's first rule: the pack is already vendored, already
 * licensed, already in the same visual language as Mossy Mayhem's whole bestiary. A hand-drawn
 * flame would have cost an afternoon to look worse and sit slightly outside the game's own idiom.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'sprites');
const DCSS = join(ROOT, 'assets', 'dcss');

/**
 * `burn_<n>.png` <- DCSS tile. THREE FRAMES OF ONE ANIMATION, in order.
 *
 * `flame_*` rather than `cloud_fire_*`, which are the other candidates in that directory: the
 * cloud tiles are a smoky billow that fills its whole 32x32 cell, which reads as ground on fire.
 * These are a tight tongue with a lot of empty space around it, which is what a thing that is
 * itself burning looks like at this size.
 */
const FRAMES = [
  ['burn_0', 'full/effect/flame_0.png'],
  ['burn_1', 'full/effect/flame_1.png'],
  ['burn_2', 'full/effect/flame_2.png'],
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let bytes = 0;
  for (const [key, rel] of FRAMES) {
    const buf = await readFile(join(DCSS, rel));
    await writeFile(join(OUT_DIR, `${key}.png`), buf);
    bytes += buf.length;
    console.log(`  ${key.padEnd(8)} <- dcss/${rel}   ${(buf.length / 1024).toFixed(1)} kB`);
  }

  console.log(`\n${FRAMES.length} frames, ${(bytes / 1024).toFixed(1)} kB -> ${OUT_DIR}`);
}

void main();
