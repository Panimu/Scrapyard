/**
 * `npm run golden:scenery` - emit `goldens/scenery-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * THE GENERATOR IS THE PART THAT MATTERS
 * ---------------------------------------------------------------------------------------------
 * `createScenery` draws FIVE VALUES PER CELL whether or not the cell ends up holding anything, and
 * says so: it is what lets the fill rate be tuned without also reshuffling where the occupied
 * piles sit. A port that short-circuits after the fill roll - which is the obvious optimisation,
 * and skips four draws on a quarter of the cells - produces a completely different yard from the
 * same seed, and every enemy in every replay lands somewhere else.
 *
 * So the fixture dumps the whole grid for several seeds. 256 cells is small enough to compare in
 * full, and comparing in full is the only way to catch a stream that has slipped by four draws
 * three hundred cells in.
 *
 * ---------------------------------------------------------------------------------------------
 * AND THE QUERIES ARE ABOUT WHAT THEY DELIBERATELY MISS
 * ---------------------------------------------------------------------------------------------
 * `sceneryRayHit` SKIPS FUEL BARRELS - a beam passes through a drum and burns what is behind it -
 * while `destructibleOverlap` returns ONLY barrels, and the nearest one rather than the first.
 * Both are one line, both are silently wrong in a port that treats terrain as terrain, and neither
 * shows up unless the fixture aims at a barrel on purpose. So it does: the query points below are
 * taken FROM the generated grid rather than guessed, so every one of them is aimed at something.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ARENA_HALF, ARENA_SIZE } from '../src/core/constants.js';
import { Rng } from '../src/core/rng.js';
import {
  SCENERY_CELL,
  SCENERY_COLS,
  SCRAP_BARREL,
  createScenery,
  destroyScenery,
  destructibleOverlap,
  isDestructible,
  pushOutOfScenery,
  sceneryOverlap,
  sceneryRayHit,
  sceneryVersion,
  type ScrapPiles,
} from '../src/core/content/scenery.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/scenery-fixture.json');

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}
const scratchF32 = new Float32Array(1);
const scratchF32Bits = new Uint32Array(scratchF32.buffer);
function f32(v: number): string {
  scratchF32[0] = v;
  return scratchF32Bits[0].toString(16).padStart(8, '0');
}

const SEEDS = [0, 1, -1, 0x5ca19a2d, 0x1d0c8a77, 0x1d140a77 | 0];

/** Cells that actually hold something, so the dump is not mostly zeroes. */
function occupied(s: ScrapPiles): { i: number; x: string; y: string; r: string; v: number }[] {
  const out: { i: number; x: string; y: string; r: string; v: number }[] = [];
  for (let i = 0; i < s.radius.length; i++) {
    if (s.radius[i] === 0) continue;
    out.push({ i, x: f32(s.x[i]), y: f32(s.y[i]), r: f32(s.radius[i]), v: s.variant[i] });
  }
  return out;
}

const rng = new Rng(0x27d4eb2f);

const grids = SEEDS.map((seed) => {
  const s = createScenery(seed);
  const cells = occupied(s);

  // QUERY POINTS TAKEN FROM THE GRID, not guessed. A point picked at random in a 12288-unit arena
  // misses everything, and a fixture of misses proves only that both sides can return -1.
  const barrels = cells.filter((c) => c.v === SCRAP_BARREL);
  const solids = cells.filter((c) => c.v !== SCRAP_BARREL);

  const probes: unknown[] = [];
  const pick = <T,>(a: readonly T[], n: number): T[] =>
    a.length === 0 ? [] : Array.from({ length: n }, () => a[rng.nextInt(a.length)]);

  for (const c of [...pick(solids, 6), ...pick(barrels, 6)]) {
    const cx = s.x[c.i];
    const cy = s.y[c.i];
    const r = s.radius[c.i];

    // Dead centre, just inside the rim, just outside it, and a clear miss.
    const points: { x: number; y: number; r: number }[] = [
      { x: cx, y: cy, r: 1 },
      { x: cx + r * 0.5, y: cy, r: 12 },
      { x: cx + r + 30, y: cy, r: 12 },
      { x: cx + 4000.5, y: cy - 3000.25, r: 12 },
    ];

    for (const p of points) {
      probes.push({
        p: { x: f64(p.x), y: f64(p.y), r: f64(p.r) },
        overlap: sceneryOverlap(s, p.x, p.y, p.r),
        destructible: destructibleOverlap(s, p.x, p.y, p.r),
        push: (() => {
          const q = pushOutOfScenery(s, p.x, p.y, p.r);
          return { x: f64(q.x), y: f64(q.y), nx: f64(q.nx), ny: f64(q.ny), hit: q.hit };
        })(),
      });
    }

    // A ray fired AT this piece from a fixed distance away. Barrels must not block it.
    const len = Math.sqrt((r + 600) * (r + 600));
    const ox = cx - 600;
    const oy = cy;
    probes.push({
      ray: { ox: f64(ox), oy: f64(oy), dx: f64(1), dy: f64(0), maxT: f64(len + 200) },
      hit: f64(sceneryRayHit(s, ox, oy, 1, 0, len + 200)),
      aimedAtBarrel: c.v === SCRAP_BARREL,
    });
  }

  return {
    seed,
    count: s.count,
    version: sceneryVersion(s),
    cells,
    destructibleFlags: cells.map((c) => isDestructible(s, c.i)),
    probes,
  };
});

// Breaking things: the version bumps, the count drops, and the piece stops answering queries -
// while keeping its position, which is what lets the renderer draw a scorch mark where it stood.
const destruction = (() => {
  const s = createScenery(0x5ca19a2d);
  const barrels: number[] = [];
  for (let i = 0; i < s.radius.length; i++) {
    if (s.radius[i] > 0 && s.variant[i] === SCRAP_BARREL) barrels.push(i);
  }

  const steps: unknown[] = [];
  for (const i of barrels.slice(0, 5)) {
    const bx = s.x[i];
    const by = s.y[i];
    const before = sceneryOverlap(s, bx, by, 1);
    destroyScenery(s, i);
    steps.push({
      i,
      overlapBefore: before,
      overlapAfter: sceneryOverlap(s, bx, by, 1),
      destructibleAfter: destructibleOverlap(s, bx, by, 1),
      count: s.count,
      version: sceneryVersion(s),
      // Position survives; only the radius is zeroed.
      x: f32(s.x[i]),
      y: f32(s.y[i]),
      radius: f32(s.radius[i]),
    });
  }

  // Destroying twice must be a no-op, or count and version drift.
  const i0 = barrels[0];
  destroyScenery(s, i0);
  steps.push({ i: i0, doubleDestroy: true, count: s.count, version: sceneryVersion(s) });

  return steps;
})();

const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for the ScrapPiles half of src/core/content/scenery.ts. Doubles are 16 hex digits, float32 columns 8 - high word first.',
  arenaSize: ARENA_SIZE,
  arenaHalf: ARENA_HALF,
  cell: SCENERY_CELL,
  cols: SCENERY_COLS,
  grids,
  destruction,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/scenery-fixture.json  (${grids.length} seeds, ` +
    `${grids.map((g) => g.count).join('/')} piles, ${destruction.length} destruction steps)`,
);
