/**
 * GOLDEN FIXTURE for Mossy Mayhem's dressing. Feeds `cs/tests/.../MossDressingTests.cs`.
 *
 * A treed cell is a CLUMP, not a tree - several smaller stems at hashed offsets, so a treeline's
 * silhouette is ragged instead of a row of stamps on a 64-unit grid. Which is a lot of arithmetic
 * per cell, all of it art-only, none of it stored, and every bit of it capable of being wrong in a
 * way that still draws a perfectly convincing wood.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT MAKES THIS ONE WORTH RECORDING
 * ---------------------------------------------------------------------------------------------
 * Three things here are order- or index-sensitive in ways that survive a careless port and then
 * quietly do the wrong thing:
 *
 *   - THE STEM SORT. Stems are drawn south-first so a nearer trunk covers a further one, and the
 *     standing count is taken off the END of that order, so the gap in a clump opens towards the
 *     player who is shooting at it. Drop the sort and the wood still looks fine - it just falls
 *     from the wrong side.
 *   - THE SWAY PHASE. `((tick / SWAY_TICKS) | 0) + (h >>> 8)) % SWAY_FRAMES`, per cell. Lose the
 *     per-cell offset and every tree in the wood reaches the same frame on the same tick, which is
 *     a chorus line and far more obviously wrong than no animation.
 *   - `stemFrac` RE-MIXES rather than slicing the cell hash, because the raw bits are too
 *     correlated for six positions and taking them directly lined every clump up on a diagonal.
 *
 * So the fixture records every stem and bush of every treed cell in a window, at three different
 * ticks, to the bit - and the generator refuses to write one where the wood is untouched, nothing
 * is felled, or the sway never advances.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  type MossWalls,
  WALL_CELL,
  WALL_EMPTY,
  WALL_TREE,
  breakWallCell,
  createMossWalls,
  damageWallCell,
  isWallBroken,
  packWallCell,
  wallKindAt,
  wallStemsAt,
  wallStemsStanding,
} from '../src/core/content/wallsMossy.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/moss-dressing-fixture.json');

// ---------------------------------------------------------------------------------------------
// Transcribed from src/render/dressingMoss.ts.
// ---------------------------------------------------------------------------------------------

const STEM_HEIGHT = 76;
const STEM_SPREAD = 0.5;
const STEM_SCALE_MIN = 0.8;
const STEM_SCALE_SPAN = 0.45;
const STEM_BASE_FRAC = 0.58;
const BUSH_WIDTH = 34;
const BUSH_COUNT = 2;
const BUSH_SPREAD = 0.9;
const BUSH_BASE_FRAC = 0.68;
const BUSH_BASE_SPAN = 0.3;
const SWAY_TICKS = 7;
const SWAY_FRAMES = 8;
const STUMP_HEIGHT = 30;
const WALL_TREE_COUNT = 3;
const WALL_BUSH_COUNT = 4;
const WALL_FACE_COUNT = 4;

function cellHash(cx: number, cy: number): number {
  let h = Math.imul(cx | 0, 0x27d4eb2f) ^ Math.imul(cy | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

function stemFrac(h: number, k: number, q: number): number {
  let v = Math.imul(h ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(q + 7, 0x85ebca6b), 0xc2b2ae35);
  v ^= v >>> 16;
  v = Math.imul(v, 0x27d4eb2f);
  return ((v ^ (v >>> 15)) >>> 0) / 4294967296;
}

function variantOf(cx: number, cy: number, n: number): number {
  return cellHash(cx, cy) % n;
}

function topTile(walls: MossWalls, cx: number, cy: number): [number, number] {
  const solid = (x: number, y: number): boolean => wallKindAt(walls, x, y) !== WALL_EMPTY;
  const left = solid(cx - 1, cy);
  const right = solid(cx + 1, cy);
  const up = solid(cx, cy - 1);
  const down = solid(cx, cy + 1);
  return [
    !left && !right ? 3 : !left ? 0 : !right ? 2 : 1,
    !up && !down ? 3 : !up ? 0 : !down ? 2 : 1,
  ];
}

function hasTop(walls: MossWalls, cx: number, cy: number): boolean {
  const kind = wallKindAt(walls, cx, cy);
  return kind !== WALL_EMPTY && kind !== WALL_TREE;
}

function hasFace(walls: MossWalls, cx: number, cy: number): boolean {
  return hasTop(walls, cx, cy) && wallKindAt(walls, cx, cy + 1) === WALL_EMPTY;
}

function hasWood(walls: MossWalls, cx: number, cy: number): boolean {
  const kind = wallKindAt(walls, cx, cy);
  return kind === WALL_TREE || (kind === WALL_EMPTY && isWallBroken(walls, cx, cy));
}

const scratch = new Float64Array(1);
const bits = new Uint32Array(scratch.buffer);
function f64(v: number): string {
  scratch[0] = v;
  return bits[1].toString(16).padStart(8, '0') + bits[0].toString(16).padStart(8, '0');
}

interface Piece {
  variant: number;
  frame: number;
  felled: boolean;
  x: string;
  y: string;
  height: string;
  width: string;
}

function stemsOf(walls: MossWalls, cx: number, cy: number, tick: number): Piece[] {
  const h = cellHash(cx, cy);
  const felled = wallKindAt(walls, cx, cy) === WALL_EMPTY;
  const n = wallStemsAt(walls, cx, cy);
  const standing = felled ? 0 : wallStemsStanding(walls, cx, cy);
  const frame = felled ? 0 : (((tick / SWAY_TICKS) | 0) + (h >>> 8)) % SWAY_FRAMES;

  const order: number[] = [];
  for (let k = 0; k < n; k++) order[k] = k;
  for (let a = 1; a < n; a++) {
    const key = order[a];
    const ky = stemFrac(h, key, 1);
    let b = a - 1;
    while (b >= 0 && stemFrac(h, order[b], 1) > ky) {
      order[b + 1] = order[b];
      b--;
    }
    order[b + 1] = key;
  }

  const out: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const k = order[i];
    const down = felled || i < n - standing;
    const v = (h >>> (k * 3 + 2)) % WALL_TREE_COUNT;
    const grow = STEM_SCALE_MIN + stemFrac(h, k, 2) * STEM_SCALE_SPAN;
    const height = down ? STUMP_HEIGHT : STEM_HEIGHT;
    out.push({
      variant: v,
      frame: down ? 0 : frame,
      felled: down,
      x: f64((cx + 0.5) * WALL_CELL + (stemFrac(h, k, 0) - 0.5) * WALL_CELL * STEM_SPREAD),
      y: f64((cy + STEM_BASE_FRAC) * WALL_CELL + (stemFrac(h, k, 1) - 0.5) * WALL_CELL * STEM_SPREAD),
      height: f64(height * grow),
      width: f64(0),
    });
  }
  return out;
}

function bushesOf(walls: MossWalls, cx: number, cy: number, tick: number): Piece[] {
  const h = cellHash(cx, cy);
  const felled = wallKindAt(walls, cx, cy) === WALL_EMPTY;
  const frame = felled ? 0 : (((tick / SWAY_TICKS) | 0) + (h >>> 8)) % SWAY_FRAMES;

  const out: Piece[] = [];
  for (let k = 0; k < BUSH_COUNT; k++) {
    const bv = (h >>> (k * 4 + 11)) % WALL_BUSH_COUNT;
    const w = BUSH_WIDTH * (STEM_SCALE_MIN + stemFrac(h, k, 3) * STEM_SCALE_SPAN);
    out.push({
      variant: bv,
      frame,
      felled: false,
      x: f64((cx + 0.5) * WALL_CELL + (stemFrac(h, k, 4) - 0.5) * WALL_CELL * BUSH_SPREAD),
      y: f64((cy + BUSH_BASE_FRAC) * WALL_CELL + stemFrac(h, k, 5) * WALL_CELL * BUSH_BASE_SPAN),
      height: f64(0),
      width: f64(w),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

const SEEDS = [0, 1, 1554094637, -1030298724];
const REACH = 14;
/** Three ticks, chosen so the sway frame is on a different phase at each. */
const TICKS = [0, 23, 400];

const reached = {
  top: 0,
  face: 0,
  wood: 0,
  standingStem: 0,
  fallenStem: 0,
  felledCell: 0,
  partlyFelled: 0,
  bush: 0,
};
const seenFrames = new Set<number>();
const seenTopTiles = new Set<string>();
const seenTreeVariants = new Set<number>();
const seenBushVariants = new Set<number>();
/** Cells whose stems come out in a different order once sorted - the sort's own evidence. */
let reorderedClumps = 0;

const seeds: unknown[] = [];
for (const seed of SEEDS) {
  const walls = createMossWalls(seed);

  // DAMAGE THE WOOD ON PURPOSE. A pristine lattice has no stump in it, so the felled branch, the
  // "southernmost falls first" rule and the felled-cell sway suppression are all untested - and
  // two of those three are the reason the stem sort exists at all.
  let hit = 0;
  for (let cy = -REACH; cy <= REACH && hit < 30; cy++) {
    for (let cx = -REACH; cx <= REACH && hit < 30; cx++) {
      if (wallKindAt(walls, cx, cy) !== WALL_TREE) continue;
      const i = packWallCell(cx, cy);
      // A third flattened, a third partly cut, a third left alone. TREE_STEM_HP is 110, so 150
      // takes exactly one stem off a clump - enough to reach the partly-felled branch without
      // reaching the flattened one, which is the state the south-first fall order is about.
      if (hit % 3 === 0) breakWallCell(walls, i);
      else if (hit % 3 === 1) damageWallCell(walls, i, 150);
      hit++;
    }
  }

  const ticks: unknown[] = [];
  for (const tick of TICKS) {
    const cells: unknown[] = [];
    for (let cy = -REACH; cy <= REACH; cy++) {
      for (let cx = -REACH; cx <= REACH; cx++) {
        const top = hasTop(walls, cx, cy);
        const face = hasFace(walls, cx, cy);
        const wood = hasWood(walls, cx, cy);
        const [col, row] = topTile(walls, cx, cy);

        if (top) {
          reached.top++;
          seenTopTiles.add(`${col}${row}`);
        }
        if (face) reached.face++;

        if (!wood) {
          cells.push({ cx, cy, top, face, col, row, wood: false });
          continue;
        }

        reached.wood++;
        const stems = stemsOf(walls, cx, cy, tick);
        const bushes = bushesOf(walls, cx, cy, tick);
        if (wallKindAt(walls, cx, cy) === WALL_EMPTY) reached.felledCell++;
        else if (wallStemsStanding(walls, cx, cy) < wallStemsAt(walls, cx, cy)) reached.partlyFelled++;
        for (const st of stems) {
          if (st.felled) reached.fallenStem++;
          else {
            reached.standingStem++;
            seenFrames.add(st.frame);
          }
          seenTreeVariants.add(st.variant);
        }
        for (const b of bushes) {
          reached.bush++;
          seenBushVariants.add(b.variant);
        }

        // Did sorting actually move anything? A clump whose jittered y happens to be increasing
        // already is no evidence for the sort at all.
        const h = cellHash(cx, cy);
        const n = wallStemsAt(walls, cx, cy);
        for (let k = 1; k < n; k++) {
          if (stemFrac(h, k, 1) < stemFrac(h, k - 1, 1)) {
            reorderedClumps++;
            break;
          }
        }

        cells.push({
          cx,
          cy,
          top,
          face,
          col,
          row,
          wood: true,
          faceVariant: face ? variantOf(cx, cy, WALL_FACE_COUNT) : -1,
          stems,
          bushes,
        });
      }
    }
    ticks.push({ tick, cells });
  }

  // The damaged state, so the C# can check it reproduced the same lattice before comparing art.
  const broken: number[][] = [];
  const standing: number[][] = [];
  for (let cy = -REACH; cy <= REACH; cy++) {
    for (let cx = -REACH; cx <= REACH; cx++) {
      if (isWallBroken(walls, cx, cy)) broken.push([cx, cy]);
      if (wallKindAt(walls, cx, cy) === WALL_TREE) {
        standing.push([cx, cy, wallStemsStanding(walls, cx, cy), wallStemsAt(walls, cx, cy)]);
      }
    }
  }

  seeds.push({ seed, broken, standing, ticks });
}

const problems: string[] = [];
for (const [k, n] of Object.entries(reached)) {
  if (n === 0) problems.push(`nothing in any window reaches ${k} - that branch is untested`);
}
if (seenFrames.size < SWAY_FRAMES / 2) {
  problems.push(
    `only ${seenFrames.size} sway frames appear across ${TICKS.length} ticks - the animation is barely tested`,
  );
}
if (seenTopTiles.size < 6) problems.push(`only ${seenTopTiles.size} grass autotile pieces appear`);
if (seenTreeVariants.size < WALL_TREE_COUNT) problems.push('not every tree variant appears');
if (seenBushVariants.size < WALL_BUSH_COUNT) problems.push('not every bush variant appears');
if (reorderedClumps === 0) {
  problems.push('no clump is reordered by the south-first sort - dropping the sort would pass');
}
if (problems.length > 0) {
  for (const p of problems) console.error(`  FIXTURE MEASURES NOTHING: ${p}`);
  process.exit(1);
}

const fixture = {
  note: 'Generated by tools/moss_dressing_fixture.ts. Do not edit by hand.',
  reach: REACH,
  faceFraction: f64(36 / 64),
  seeds,
  coverage: {
    ...reached,
    reorderedClumps,
    frames: [...seenFrames].sort((a, b) => a - b),
    topTiles: [...seenTopTiles].sort(),
  },
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${OUT_PATH}`);
console.log(`  ${SEEDS.length} seeds x ${TICKS.length} ticks x ${(REACH * 2 + 1) ** 2} cells`);
console.log(`  branches reached: ${JSON.stringify(reached)}`);
console.log(`  sway frames seen: ${[...seenFrames].sort((a, b) => a - b).join(',')}`);
console.log(`  clumps the sort reorders: ${reorderedClumps}`);
