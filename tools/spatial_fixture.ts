/**
 * `npm run golden:spatial` - emit `goldens/spatial-fixture.json`, the cross-language proof for the
 * math primitives and the broad-phase spatial hash.
 *
 * ---------------------------------------------------------------------------------------------
 * TRIG IS THE INTERESTING ONE
 * ---------------------------------------------------------------------------------------------
 * `dsin` exists because `Math.sin` is implementation-defined and V8 and JSC do not agree to the
 * last bit. The port has the same problem twice over: C#'s `Math.Sin` is a third implementation,
 * and .NET could in principle contract `a * b + c` into a fused multiply-add, which would be MORE
 * accurate and therefore WRONG.
 *
 * So the samples below are not a sanity check on accuracy - they are a bit-exact pin on a
 * polynomial. If the C# side ever disagrees, the cause is one of: a transcribed coefficient, a
 * reassociated Horner chain, or an FMA. All three look like "close enough" and none of them is.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SPATIAL CASES ARE ABOUT SIGNS AND ALIASES
 * ---------------------------------------------------------------------------------------------
 * Two things break a port of this structure, and neither shows up with tidy positive inputs:
 *
 *   NEGATIVE COORDINATES. `Math.floor` is not truncation. C# casts toward zero, so a naive
 *   `(int)(v * inv)` folds the whole strip between -cellSize and 0 into cell 0. The arena has
 *   negative coordinates everywhere, so the enemies get put in the wrong bucket and the query
 *   quietly misses them. Every case here straddles the origin.
 *
 *   BUCKET ALIASING. Two distant cells can hash into the same bucket, and the exact packed cell
 *   key is what keeps them apart. A port that dropped the key check would return enemies
 *   thousands of units away and still pass any test whose enemies happened to be near each other,
 *   so one case is built to force an alias.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Rng, hashToHex } from '../src/core/index.js';
import { PI, dcos, degToRad, dsin, radToDeg } from '../src/core/math/trig.js';
import { approach, clamp, lerp, signOf } from '../src/core/math/scalar.js';
import {
  clampLenInto,
  cross,
  dist,
  dot,
  len,
  normalizeInto,
  rotateTowardsInto,
  type Vec2,
} from '../src/core/math/vec2.js';
import {
  createSpatialHash,
  hashCell,
  queryCircleInto,
  queryCircleLiveInto,
  rebuildSpatialHash,
} from '../src/core/spatial/hashGrid.js';
import { allocEnemy, createEnemyPool, markEnemyDead } from '../src/core/entity/enemyPool.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/spatial-fixture.json');

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------
// Trig
// ---------------------------------------------------------------------------------------------

const TRIG_X: number[] = [];
// The contract interval, densely: k is 0 here so the range reduction takes no rounding hit, and
// this is where every real call lands.
for (let i = 0; i <= 64; i++) TRIG_X.push(-PI + (2 * PI * i) / 64);
// The fold boundaries themselves, where `r > HALF_PI` flips.
for (const v of [-PI, -PI / 2, 0, PI / 2, PI]) TRIG_X.push(v);
// Outside the contract range, so the range reduction is actually exercised rather than skipped.
for (const v of [-40.5, -7.25, 7.25, 12.5, 40.5, 1000.25, -1000.25]) TRIG_X.push(v);
// Tiny and denormal-adjacent, where the polynomial's leading `r` dominates.
for (const v of [0, 1e-8, -1e-8, 1e-300, -1e-300]) TRIG_X.push(v);

const trig = TRIG_X.map((x) => ({
  x: f64(x),
  sin: f64(dsin(x)),
  cos: f64(dcos(x)),
}));

// ---------------------------------------------------------------------------------------------
// Scalar and vector helpers
// ---------------------------------------------------------------------------------------------

const rng = new Rng(0x85ebca6b);
const out: Vec2 = { x: 0, y: 0 };

const scalar = Array.from({ length: 24 }, () => {
  const v = rng.nextRange(-500.5, 500.5);
  const lo = rng.nextRange(-200.5, 0);
  const hi = rng.nextRange(0, 200.5);
  const a = rng.nextRange(-90.5, 90.5);
  const b = rng.nextRange(-90.5, 90.5);
  const t = rng.nextRange(-0.25, 1.25); // deliberately outside [0,1] as well
  const cur = rng.nextRange(-50.5, 50.5);
  const target = rng.nextRange(-50.5, 50.5);
  const maxDelta = rng.nextRange(0, 20.5);
  return {
    in: { v: f64(v), lo: f64(lo), hi: f64(hi), a: f64(a), b: f64(b), t: f64(t), cur: f64(cur), target: f64(target), maxDelta: f64(maxDelta) },
    clamp: f64(clamp(v, lo, hi)),
    lerp: f64(lerp(a, b, t)),
    approach: f64(approach(cur, target, maxDelta)),
    signOf: f64(signOf(v)),
  };
});

// signOf(-0) must be 0, not -0: a signed zero leaking into hashed pool bytes is a different bit
// pattern for the same number, which is a divergence that reads as impossible.
const signOfNegZero = f64(signOf(-0));

const vec = Array.from({ length: 24 }, () => {
  const ax = rng.nextRange(-300.5, 300.5);
  const ay = rng.nextRange(-300.5, 300.5);
  const bx = rng.nextRange(-300.5, 300.5);
  const by = rng.nextRange(-300.5, 300.5);
  const maxLen = rng.nextRange(0, 200.5);

  const nLen = normalizeInto(ax, ay, out);
  const nx = out.x;
  const ny = out.y;
  clampLenInto(ax, ay, maxLen, out);
  const cx = out.x;
  const cy = out.y;

  // A rotation step of a few degrees, as a cos/sin pair - which is how every real caller supplies
  // it, since the trig runs once when weapon stats resolve and never in the loop.
  const step = degToRad(rng.nextRange(0.5, 30.5));
  normalizeInto(bx, by, out);
  const tx = out.x;
  const ty = out.y;
  rotateTowardsInto(nx, ny, tx, ty, dcos(step), dsin(step), out);

  return {
    in: { ax: f64(ax), ay: f64(ay), bx: f64(bx), by: f64(by), maxLen: f64(maxLen), step: f64(step) },
    len: f64(len(ax, ay)),
    dist: f64(dist(ax, ay, bx, by)),
    dot: f64(dot(ax, ay, bx, by)),
    cross: f64(cross(ax, ay, bx, by)),
    normLen: f64(nLen),
    normX: f64(nx),
    normY: f64(ny),
    clampX: f64(cx),
    clampY: f64(cy),
    rotX: f64(out.x),
    rotY: f64(out.y),
  };
});

// ---------------------------------------------------------------------------------------------
// Spatial hash
// ---------------------------------------------------------------------------------------------

const CELL = 64;
const BUCKETS = 256;
const CAP = 512;

interface Placed { x: number; y: number; dead: boolean }

function buildCase(name: string, placed: Placed[], queries: { x: number; y: number; r: number }[]) {
  const pool = createEnemyPool(CAP);
  const h = createSpatialHash(CELL, BUCKETS, CAP);

  placed.forEach((e, i) => {
    allocEnemy(pool, i % 5, i % 3, i % 4, e.x, e.y, i + 1);
  });
  // Marked AFTER allocation, so the dense indices line up with `placed`.
  placed.forEach((e, i) => {
    if (e.dead) markEnemyDead(pool, i);
  });

  rebuildSpatialHash(h, pool);

  const scratch = new Uint16Array(CAP);
  const results = queries.map((q) => {
    const nAll = queryCircleInto(h, q.x, q.y, q.r, scratch);
    const all = Array.from(scratch.subarray(0, nAll));
    const nLive = queryCircleLiveInto(h, pool, q.x, q.y, q.r, scratch);
    const live = Array.from(scratch.subarray(0, nLive));
    return { q: { x: f64(q.x), y: f64(q.y), r: f64(q.r) }, all, live };
  });

  return {
    name,
    placed: placed.map((e) => ({ x: f64(e.x), y: f64(e.y), dead: e.dead })),
    itemCount: h.itemCount,
    // The structure's own arrays, so a port is compared on WHAT IT BUILT rather than only on what
    // it happens to return. A bucket layout that differs but queries the same is a coincidence
    // waiting to stop being one.
    items: Array.from(h.items.subarray(0, h.itemCount)),
    itemKeys: Array.from(h.itemKey.subarray(0, h.itemCount)),
    bucketStart: Array.from(h.bucketStart),
    results,
  };
}

const spatialCases = [
  // STRADDLING THE ORIGIN. Every coordinate sign, and points exactly on cell boundaries and just
  // inside the negative side of them - which is where truncation-instead-of-floor breaks.
  buildCase(
    'origin-straddle',
    [
      { x: 0, y: 0, dead: false },
      { x: -0.5, y: -0.5, dead: false },
      { x: -64, y: -64, dead: false },
      { x: -64.5, y: 63.5, dead: false },
      { x: 63.5, y: -64.5, dead: false },
      { x: 128.25, y: -192.75, dead: false },
      { x: -300.5, y: 250.25, dead: false },
    ],
    [
      { x: 0, y: 0, r: 1 },
      { x: 0, y: 0, r: 100 },
      { x: -64, y: -64, r: 40 },
      { x: -300.5, y: 250.25, r: 5 },
      { x: 1000, y: 1000, r: 50 },
    ],
  ),

  // DEAD ENEMIES ARE STILL INSERTED - the reap has not run yet - so `all` and `live` must differ.
  buildCase(
    'dead-still-indexed',
    [
      { x: 10.5, y: 10.5, dead: false },
      { x: 12.5, y: 11.5, dead: true },
      { x: -20.25, y: 30.75, dead: true },
      { x: -22.25, y: 31.75, dead: false },
    ],
    [
      { x: 11, y: 11, r: 30 },
      { x: -21, y: 31, r: 30 },
      { x: 0, y: 0, r: 500 },
    ],
  ),

  // A wide spread, so the AABB walk covers many cells and the per-cell circle rejection actually
  // rejects. A port that walked the AABB without rejecting returns extra candidates from the four
  // corner regions and fails here.
  buildCase(
    'corner-rejection',
    Array.from({ length: 60 }, (_, i) => {
      const a = i * 0.7;
      return { x: Math.floor(400.5 * (a % 3) - 500), y: Math.floor(370.25 * ((a + 1) % 3) - 480), dead: i % 7 === 0 };
    }),
    [
      { x: 0, y: 0, r: 300 },
      { x: -500, y: -480, r: 64 },
      { x: 0, y: 0, r: 1200 },
    ],
  ),
];

// BUCKET ALIASING, built rather than hoped for: two cells that hash to the same bucket, far apart.
// Without the exact key check a query at one would return the enemy at the other.
const aliasPairs: { a: [number, number]; b: [number, number] }[] = [];
{
  const h = createSpatialHash(CELL, BUCKETS, CAP);
  const seen = new Map<number, [number, number]>();
  outer: for (let cx = -60; cx <= 60; cx++) {
    for (let cy = -60; cy <= 60; cy++) {
      const b = hashCell(h, cx, cy);
      const prev = seen.get(b);
      if (prev !== undefined) {
        const far = Math.abs(prev[0] - cx) > 20 || Math.abs(prev[1] - cy) > 20;
        if (far) {
          aliasPairs.push({ a: prev, b: [cx, cy] });
          if (aliasPairs.length >= 3) break outer;
          continue;
        }
      } else {
        seen.set(b, [cx, cy]);
      }
    }
  }
}

if (aliasPairs.length === 0) throw new Error('spatial fixture: found no distant bucket aliases');

spatialCases.push(
  buildCase(
    'bucket-alias',
    aliasPairs.flatMap(({ a, b }) => [
      { x: a[0] * CELL + 32, y: a[1] * CELL + 32, dead: false },
      { x: b[0] * CELL + 32, y: b[1] * CELL + 32, dead: false },
    ]),
    aliasPairs.map(({ a }) => ({ x: a[0] * CELL + 32, y: a[1] * CELL + 32, r: 20 })),
  ),
);

const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for src/core/math/{scalar,trig,vec2}.ts and src/core/spatial/hashGrid.ts. Doubles are IEEE-754 bits as 16 hex digits, high word first.',
  cellSize: CELL,
  bucketCount: BUCKETS,
  capacity: CAP,
  constants: { pi: f64(PI), degToRad: f64(degToRad(1)), radToDeg: f64(radToDeg(1)) },
  trig,
  scalar,
  signOfNegZero,
  vec,
  aliasPairs: aliasPairs.map(({ a, b }) => ({ a, b, bucket: 0 })),
  spatial: spatialCases,
  // A cheap end-to-end digest, so a reordering that leaves every individual value right but the
  // structure different still shows up as one failure rather than none.
  digest: hashToHex(
    spatialCases.reduce((acc, c) => acc ^ c.itemKeys.reduce((a2, k) => (a2 ^ k) >>> 0, c.itemCount), 0) >>> 0,
  ),
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/spatial-fixture.json  (${trig.length} trig samples, ${scalar.length} scalar, ` +
    `${vec.length} vector, ${spatialCases.length} spatial cases, ${aliasPairs.length} bucket aliases)`,
);
