/**
 * GOLDEN FIXTURE for the ground-path road layout. Feeds `cs/tests/.../GroundPathsTests.cs`.
 *
 * The roads are decoration in the sense that nothing collides with them, but they are NOT
 * decoration in the sense that matters here: they are the only landmark in a yard where every
 * direction looks the same, and a C# build whose roads run somewhere else is a build where "the
 * crossroads north of where I died" points at a different place. That is not a crash, it is worse -
 * it is a screenshot nobody else can reproduce.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS ACTUALLY GUARDING, WHICH IS THREE SILENT MISTRANSLATIONS
 * ---------------------------------------------------------------------------------------------
 * Every one of these compiles in C#, runs, and lays a perfectly plausible road network:
 *
 *   1. `x * 0x27220a95` is a FLOAT64 multiply that loses low bits past 2^53 and is then coerced to
 *      int32 by `^`. `Math.imul` keeps those bits and wraps. The cover layer's port used imul for
 *      all three terms and was wrong for weeks of nothing noticing.
 *   2. `Math.round` rounds halves UP; C#'s `Math.Round` rounds them to EVEN. The wander is rounded
 *      to a whole cell, so a disagreement would be a road in a different column - except that this
 *      one turns out to be UNREACHABLE, and the generator found that out by trying: two octaves of
 *      interpolated noise never land exactly on a half. So it is not claimed as guarded. The
 *      fixture records how close the arithmetic ever comes instead, and fails if it ever arrives.
 *   3. `>>>` is a LOGICAL shift; C#'s `>>` on a signed int is arithmetic and sign-extends.
 *
 * So this file does not merely record the layout - it computes the yard each mistranslation would
 * lay, counts the cells that come out differently, and REFUSES TO WRITE A FIXTURE THAT CANNOT FAIL.
 * A golden a broken port would sail through is worse than no golden, because it is a green tick
 * over a wrong answer. That check is what established that trap 2 is unreachable rather than
 * caught: it was written expecting three, and the file would not generate until the claim about the
 * third was corrected to the truth.
 *
 * ---------------------------------------------------------------------------------------------
 * THE WINDOW IS STORED AS MASK DIGITS, WHICH IS TOTAL RATHER THAN SAMPLED
 * ---------------------------------------------------------------------------------------------
 * One hex digit per cell: 0 for no road, 1..15 for the connectivity mask. That is the whole of what
 * the layer decides about a cell's shape, it is compact enough to store every cell in the window
 * rather than a sample, and TOTAL MATTERS - a fixture listing only the road cells would be passed
 * by a port that paved the entire yard.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT_PATH = resolve(process.cwd(), 'goldens/ground-paths-fixture.json');

// ---------------------------------------------------------------------------------------------
// Transcribed from src/render/groundPaths.ts. Kept in step by the C# test failing when it is not.
// ---------------------------------------------------------------------------------------------

const BAND = 12;
const AMP = 4;
const WAVE_LONG = 16;
const WAVE_SHORT = 9;
const WAVE_MIX = 0.7;
const BAND_SKIP = 0.2;
const EROSION = 0.1;
const ALPHA = 0.5;
const WEAR_MIN = 0.66;
const WEAR_MAX = 1.15;
const NO_ROAD = 0x7fffffff;

const SALT_COL = 0x9e3779b1 | 0;
const SALT_ROW = 0x85ebca6b | 0;
const SALT_SKIP = 0xc2b2ae35 | 0;
const SALT_ROT = 0x27d4eb2f | 0;
const SALT_WEAR = 0x165667b1 | 0;

/** How the port is allowed to be wrong. `ok` is the faithful one. */
type Variant = 'ok' | 'imul' | 'even' | 'arith';

function hash(x: number, y: number, seed: number, v: Variant): number {
  let h =
    v === 'imul'
      ? Math.imul(x, 0x27220a95) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)
      : (x * 0x27220a95) ^ (y * 0x165667b1) ^ (seed * 0x9e3779b1);
  // `>> 16` rather than `>>> 16` is the arithmetic-shift slip: identical for a positive h, and
  // sign-extending for a negative one.
  h = Math.imul(h ^ (v === 'arith' ? h >> 16 : h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (v === 'arith' ? h >> 15 : h >>> 15), 0x846ca68b);
  h ^= v === 'arith' ? h >> 16 : h >>> 16;
  return h >>> 0;
}

function floorDiv(cell: number, by: number): number {
  return Math.floor(cell / by);
}

function unit(h: number): number {
  return (h >>> 8) / 0x1000000;
}

/** C#'s default rounding, for the `even` variant: halves go to the nearer even integer. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function vnoise(t: number, period: number, salt: number, v: Variant): number {
  const i = floorDiv(t, period);
  const f = (t - i * period) / period;
  const a = unit(hash(i, 0, salt, v));
  const b = unit(hash(i + 1, 0, salt, v));
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

/** One yard. A fresh instance per seed AND per variant, so no memo is ever shared between them. */
class Paths {
  private readonly colMemo = new Map<number, number>();
  private readonly rowMemo = new Map<number, number>();

  /** Counts of the branches this seed actually reached, so the generator can check it measured something. */
  readonly reached = { skippedBands: 0, flattenedSpikes: 0, eroded: 0, junctions: 0 };

  /**
   * The closest any wander value came to an exact .5, over every call this yard made.
   *
   * This is the EVIDENCE FOR A TRAP BEING UNREACHABLE rather than guarded. `Math.round` and C#'s
   * banker's rounding differ only exactly on a half, and two octaves of interpolated noise scaled
   * by 8 never land there - so no window of cells can tell the two apart, and claiming the fixture
   * catches it would be a green tick over an untested line. What the fixture CAN honestly record
   * is how far away the arithmetic stays.
   */
  closestToHalf = Infinity;

  constructor(
    private readonly seed: number,
    private readonly v: Variant,
  ) {}

  private bandHas(b: number, axis: number): boolean {
    const has = hash(b, axis, this.seed ^ SALT_SKIP, this.v) % 1024 >= BAND_SKIP * 1024;
    if (!has) this.reached.skippedBands++;
    return has;
  }

  private wander(b: number, t: number, salt: number): number {
    const s = this.seed ^ salt ^ Math.imul(b, 0x9e3779b1);
    const n =
      vnoise(t, WAVE_LONG, s, this.v) * WAVE_MIX +
      vnoise(t, WAVE_SHORT, s ^ 0x5bf03635, this.v) * (1 - WAVE_MIX);
    const raw = (n * 2 - 1) * AMP;
    const frac = raw - Math.floor(raw);
    this.closestToHalf = Math.min(this.closestToHalf, Math.abs(frac - 0.5));
    return this.v === 'even' ? roundHalfEven(raw) : Math.round(raw);
  }

  private raw(b: number, t: number, salt: number): number {
    return b * BAND + (BAND >> 1) + this.wander(b, t, salt);
  }

  private centre(memo: Map<number, number>, b: number, t: number, axis: number, salt: number): number {
    if (!this.bandHas(b, axis)) return NO_ROAD;
    const key = b * 0x100000 + t + 0x80000;
    const seen = memo.get(key);
    if (seen !== undefined) return seen;
    const here = this.raw(b, t, salt);
    const before = this.raw(b, t - 1, salt);
    const after = this.raw(b, t + 1, salt);
    const flattened = before === after && before !== here;
    if (flattened) this.reached.flattenedSpikes++;
    const out = flattened ? before : here;
    memo.set(key, out);
    return out;
  }

  private colAt(b: number, cy: number): number {
    return this.centre(this.colMemo, b, cy, 0, SALT_COL);
  }

  private rowAt(b: number, cx: number): number {
    return this.centre(this.rowMemo, b, cx, 1, SALT_ROW);
  }

  private vertAt(cx: number, cy: number): boolean {
    const b = floorDiv(cx, BAND);
    const here = this.colAt(b, cy);
    if (here === NO_ROAD) return false;
    const next = this.colAt(b, cy + 1);
    return cx >= Math.min(here, next) && cx <= Math.max(here, next);
  }

  private horizAt(cx: number, cy: number): boolean {
    const b = floorDiv(cy, BAND);
    const here = this.rowAt(b, cx);
    if (here === NO_ROAD) return false;
    const next = this.rowAt(b, cx + 1);
    return cy >= Math.min(here, next) && cy <= Math.max(here, next);
  }

  road(cx: number, cy: number): boolean {
    const vert = this.vertAt(cx, cy);
    const horiz = this.horizAt(cx, cy);
    if (!vert && !horiz) return false;
    if (vert && horiz) {
      this.reached.junctions++;
      return true;
    }
    const kept = hash(cx, cy, this.seed ^ SALT_ROT, this.v) % 1024 >= EROSION * 1024;
    if (!kept) this.reached.eroded++;
    return kept;
  }

  mask(cx: number, cy: number): number {
    if (!this.road(cx, cy)) return 0;
    let mask = 0;
    if (this.road(cx, cy - 1)) mask |= 1;
    if (this.road(cx + 1, cy)) mask |= 2;
    if (this.road(cx, cy + 1)) mask |= 4;
    if (this.road(cx - 1, cy)) mask |= 8;
    return mask;
  }

  wearAlpha(cx: number, cy: number): number {
    const wear = (hash(cx, cy, this.seed ^ SALT_WEAR, this.v) >>> 8) & 0xff;
    return Math.min(1, ALPHA * (WEAR_MIN + (wear / 0xff) * (WEAR_MAX - WEAR_MIN)));
  }
}

const scratch = new Float64Array(1);
const bits = new Uint32Array(scratch.buffer);
function f64(v: number): string {
  scratch[0] = v;
  return bits[1].toString(16).padStart(8, '0') + bits[0].toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------

/**
 * LARGE SEEDS ARE THE POINT, not decoration on a list of small ones. At a small seed a float64
 * multiply and an imul agree exactly, so a fixture of tidy little numbers is one a broken port
 * sails through. Two are negative because a negative seed is what makes the arithmetic-shift slip
 * reachable.
 */
const SEEDS = [0, 1, 1554094637, -1030298724, 0x5ca19a2d, -7];

/** Cells either side of the origin, per axis. 31 wide is about two and a half bands. */
const REACH = 15;

function windowOf(p: Paths): string[] {
  const rows: string[] = [];
  for (let cy = -REACH; cy <= REACH; cy++) {
    let row = '';
    for (let cx = -REACH; cx <= REACH; cx++) row += p.mask(cx, cy).toString(16);
    rows.push(row);
  }
  return rows;
}

const seeds: unknown[] = [];
const seenMasks = new Set<number>();
let totalRoad = 0;
const reached = { skippedBands: 0, flattenedSpikes: 0, eroded: 0, junctions: 0 };
const distinguishes = { imul: 0, arith: 0 };
let closestToHalf = Infinity;

for (const seed of SEEDS) {
  const ok = new Paths(seed, 'ok');
  const rows = windowOf(ok);

  for (const row of rows) {
    for (const ch of row) {
      const m = parseInt(ch, 16);
      if (m !== 0) {
        seenMasks.add(m);
        totalRoad++;
      }
    }
  }
  reached.skippedBands += ok.reached.skippedBands;
  reached.flattenedSpikes += ok.reached.flattenedSpikes;
  reached.eroded += ok.reached.eroded;
  reached.junctions += ok.reached.junctions;
  closestToHalf = Math.min(closestToHalf, ok.closestToHalf);

  // THE FIXTURE HAS TO BE ABLE TO FAIL. Lay the same window with each mistranslation and count the
  // cells that come out differently; a seed that no variant disturbs is a seed carrying no
  // evidence, and is reported below rather than quietly padding the file.
  for (const v of ['imul', 'arith'] as const) {
    const other = windowOf(new Paths(seed, v));
    let diff = 0;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) if (rows[r][c] !== other[r][c]) diff++;
    }
    distinguishes[v] += diff;
  }

  // A handful of exact reals per seed. The mask window pins the LAYOUT; these pin the arithmetic
  // that feeds it, so a wear roll or a raw hash that is subtly off is caught at the source rather
  // than only when it happens to move a road.
  const probes: unknown[] = [];
  for (let i = 0; i < 24; i++) {
    const cx = ((i * 7) % 31) - REACH;
    const cy = ((i * 13) % 31) - REACH;
    probes.push({ cx, cy, hash: hash(cx, cy, seed, 'ok'), wear: f64(ok.wearAlpha(cx, cy)) });
  }

  seeds.push({ seed, rows, probes });
}

// ---------------------------------------------------------------------------------------------
// The generator refuses to write a fixture that cannot fail.
// ---------------------------------------------------------------------------------------------

const problems: string[] = [];
if (totalRoad === 0) problems.push('no road cell anywhere in the window');
if (seenMasks.size < 12) {
  problems.push(`only ${seenMasks.size} of the 15 masks appear - the tile choice is barely tested`);
}
for (const [k, n] of Object.entries(reached)) {
  if (n === 0) problems.push(`no ${k} in any window - that branch is untested`);
}
for (const [k, n] of Object.entries(distinguishes)) {
  if (n === 0) problems.push(`the '${k}' mistranslation lays an IDENTICAL yard - the fixture cannot catch it`);
}
// The rounding trap is real in the language and unreachable in this layout - see closestToHalf.
// What must hold is that it stays unreachable: a wander that DID land on a half would make the
// C# yard depend on which rounding the port happened to use, silently.
if (!(closestToHalf > 0)) {
  problems.push('a wander value landed exactly on .5 - the rounding mode now changes the layout');
}
if (problems.length > 0) {
  for (const p of problems) console.error(`  FIXTURE MEASURES NOTHING: ${p}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// BOUNDARY PROBES FOR THE TWO THRESHOLDS, because a window of cells only catches those by luck.
//
// `bandHas` compares against BAND_SKIP * 1024 = 204.8 and `road` against EROSION * 1024 = 102.4.
// Both are compared with an INTEGER, so what each really tests is `>= 205` and `>= 103` - and a
// port that wrote the scale as 1000 instead of 1024 would agree with the original everywhere
// except on a hash landing in the five or six values in between. That is roughly one band in two
// hundred, so a fixture that merely records a window catches it only if a straggler happens to
// fall in the gap. This one did not: an injected `BAND_SKIP * 1000` passed the whole window.
//
// So the boundary is probed on purpose. Search for band and cell decisions whose hash lands ON and
// EITHER SIDE of each cutoff, and record the answer at each. That pins the comparison itself
// rather than hoping a road wanders past it.
// ---------------------------------------------------------------------------------------------

interface Probe {
  seed: number;
  a: number;
  b: number;
  mod: number;
  yes: boolean;
}

function probeThreshold(
  cut: number,
  salt: number,
  decide: (h: number) => boolean,
  lo: number,
  hi: number,
): Probe[] {
  const wanted = [
    // Straddling the cutoff by one, which is what a mis-rounded threshold moves...
    (m: number) => m === Math.ceil(cut) - 1,
    (m: number) => m === Math.ceil(cut),
    // ...and inside the gap a 1000-instead-of-1024 scale opens up, which is the real target.
    (m: number) => m >= Math.floor(cut * (1000 / 1024)) && m < Math.ceil(cut),
  ];
  const found: Probe[] = [];
  for (const want of wanted) {
    let hit: Probe | null = null;
    for (let seed = 0; seed < 4000 && !hit; seed++) {
      for (let a = lo; a <= hi && !hit; a++) {
        for (let b = 0; b <= 1 && !hit; b++) {
          const h = hash(a, b, seed ^ salt, 'ok');
          const m = h % 1024;
          if (want(m)) hit = { seed, a, b, mod: m, yes: decide(h) };
        }
      }
    }
    if (hit) found.push(hit);
  }
  return found;
}

const bandProbes = probeThreshold(
  BAND_SKIP * 1024,
  SALT_SKIP,
  (h) => h % 1024 >= BAND_SKIP * 1024,
  -6,
  6,
);
const erosionProbes = probeThreshold(
  EROSION * 1024,
  SALT_ROT,
  (h) => h % 1024 >= EROSION * 1024,
  -20,
  20,
);

for (const [name, ps] of [['band skip', bandProbes], ['erosion', erosionProbes]] as const) {
  if (ps.length < 3) {
    console.error(
      `  FIXTURE MEASURES NOTHING: only ${ps.length} of 3 ${name} boundary probes found - the ` +
        `threshold is not pinned and a mis-scaled constant would pass`,
    );
    process.exit(1);
  }
}

const fixture = {
  note: 'Generated by tools/ground_paths_fixture.ts. Do not edit by hand.',
  bandProbes,
  erosionProbes,
  reach: REACH,
  seeds,
  /** Recorded so the C# test can assert the same coverage rather than trusting this run. */
  coverage: {
    roadCells: totalRoad,
    masks: [...seenMasks].sort((a, b) => a - b),
    ...reached,
    distinguishes,
    closestToHalf: f64(closestToHalf),
  },
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${OUT_PATH}`);
console.log(`  ${SEEDS.length} seeds, ${(REACH * 2 + 1) ** 2} cells each, ${totalRoad} of them road`);
console.log(`  masks seen: ${[...seenMasks].sort((a, b) => a - b).join(',')}`);
console.log(`  branches reached: ${JSON.stringify(reached)}`);
console.log(`  cells that expose each mistranslation: ${JSON.stringify(distinguishes)}`);
console.log(`  closest a wander came to an exact .5: ${closestToHalf}`);
console.log(`  band-skip boundary probes:  ${bandProbes.map((p) => `${p.mod}->${p.yes}`).join(' ')}`);
console.log(`  erosion boundary probes:    ${erosionProbes.map((p) => `${p.mod}->${p.yes}`).join(' ')}`);
