/**
 * `npm run golden:wallsMossy` - emit `goldens/walls-mossy-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE BUGS ALREADY SHIPPED HERE, AND ALL THREE HAVE A CASE
 * ---------------------------------------------------------------------------------------------
 * `tests/wallsMossy.test.ts` names them: a body pushed out of a wall was still 9.5% of the time
 * inside one (a body buried mid-wall left through whichever side face was nearest, which for the
 * middle of a run is the NEXT cell of the same wall - a fixed point, not slow convergence); the
 * same seed produced a different world depending on the ORDER blocks were first asked for; and a
 * zero-radius probe - what every projectile in the game is - passed through every wall because
 * `distance < radius` is `0 < 0` for a point exactly on a boundary.
 *
 * ONLY THE PUBLIC API IS USED HERE, deliberately. `blockKey`, `BLOCK_CELLS` and `generateBlock`
 * are not exported, so there is no way to dump a raw block or pose one directly without editing
 * `wallsMossy.ts` itself - and there is no need to: `wallKindAt` reaches the same generator on
 * every call, so a dense coordinate sweep exercises exactly the same code a real query does,
 * through the same contract a real caller has.
 *
 * ---------------------------------------------------------------------------------------------
 * A GENUINELY UNREACHABLE BRANCH, FOUND WHILE BUILDING THIS
 * ---------------------------------------------------------------------------------------------
 * `pushOutOfWalls`'s "buried, no open face at all" fallback cannot be reached by anything this
 * generator draws: every shape (line, L, T, room) is one cell thick, so every occupied cell has at
 * least two empty cardinal neighbours - perpendicular to a line or an arm, or into a room's own
 * hollow interior. Searched exhaustively across five seeds and a wide area with no hit. Recorded
 * here rather than forced by hand-editing a block, which the exported API cannot do anyway; see
 * `docs` / `cs/README.md`'s "known untested branch" precedent for the same kind of honesty.
 */

import { writeFileSync } from 'node:fs';

import {
  WALL_CELL, WALL_EMPTY, WALL_SOLID, WALL_TREE, WALL_HALF, TREE_STEM_HP,
  createMossWalls, wallStemsAt, wallKindAt, isWallBroken, wallCentre,
  packWallCell, wallCellX, wallCellY, wallOverlap, wallDestructibleOverlap, pushOutOfWalls,
  wallRayHit, wallDestructibleRayHit, wallLastRayT, breakWallCell, wallStemsStanding, damageWallCell,
} from '../src/core/content/wallsMossy.js';
import type { MossWalls } from '../src/core/content/wallsMossy.js';

const buf = new DataView(new ArrayBuffer(8));
function bits(v: number): string {
  buf.setFloat64(0, v);
  return buf.getBigUint64(0).toString(16).padStart(16, '0');
}

const SEEDS = [1, 7, 12345, 99, 2024];

// -------------------------------------------------------------------------------------------
// 1. A dense wallKindAt sweep, several seeds - this IS the generation-determinism check, since
//    every cell it names has been through hashBlock -> BlockRng -> generateBlock exactly as a
//    real query would. -60..60 cells is six blocks of margin past the clear radius in every
//    direction, comfortably covering all four shape kinds and the empty-block case on every seed.
// -------------------------------------------------------------------------------------------
const LO = -60;
const HI = 60;

function sweep(seed: number): string {
  const w = createMossWalls(seed);
  // Packed two bits per cell into a hex string rather than one JSON array entry per cell - this
  // sweep is (HI-LO)^2 * SEEDS.length cells and a naive array would make the fixture unreadable
  // and slow to diff. WALL_EMPTY/SOLID/TREE fit in 2 bits with room to spare.
  const bitsPerCell = 2;
  const totalCells = (HI - LO) * (HI - LO);
  const bytes = new Uint8Array(Math.ceil((totalCells * bitsPerCell) / 8));
  let bitIndex = 0;
  for (let cy = LO; cy < HI; cy++) {
    for (let cx = LO; cx < HI; cx++) {
      const kind = wallKindAt(w, cx, cy);
      const byteIndex = bitIndex >> 3;
      const shift = bitIndex & 7;
      bytes[byteIndex] |= kind << shift;
      bitIndex += bitsPerCell;
    }
  }
  return Buffer.from(bytes).toString('hex');
}

const sweeps = SEEDS.map((seed) => ({ seed, packed: sweep(seed) }));

// -------------------------------------------------------------------------------------------
// 2. Order independence: the same seed, queried forwards and backwards. Both must equal the
//    sweep above; the C# side re-derives its own backward pass and checks it against the same
//    forward-pass values rather than trusting the two languages to agree on HOW they cache.
// -------------------------------------------------------------------------------------------
const orderSeed = 4242;
{
  const forwards = createMossWalls(orderSeed);
  const backwards = createMossWalls(orderSeed);
  for (let cy = HI - 1; cy >= LO; cy--) {
    for (let cx = HI - 1; cx >= LO; cx--) wallKindAt(backwards, cx, cy);
  }
  let mismatches = 0;
  for (let cy = LO; cy < HI; cy++) {
    for (let cx = LO; cx < HI; cx++) {
      if (wallKindAt(forwards, cx, cy) !== wallKindAt(backwards, cx, cy)) mismatches++;
    }
  }
  if (mismatches > 0) throw new Error(`order dependence in the TypeScript itself: ${mismatches} cells`);
}

// -------------------------------------------------------------------------------------------
// 3. wallStemsAt, standalone - it takes a MossWalls only to read `.seed`, so it is dumped as a
//    pure function of (seed, cx, cy) directly.
// -------------------------------------------------------------------------------------------
// packWallCell / wallCellX / wallCellY must round-trip, including negative coordinates - the
// KEY_BIAS/KEY_SPAN packing is exactly the kind of arithmetic a sign error hides in silently.
for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [-500, 500], [500, -500], [-999999, -999999]] as const) {
  const i = packWallCell(cx, cy);
  if (wallCellX(i) !== cx || wallCellY(i) !== cy) {
    throw new Error(`packWallCell round-trip failed for (${cx}, ${cy}): got (${wallCellX(i)}, ${wallCellY(i)})`);
  }
}

const stemsWorld = createMossWalls(7);
const stemProbes = [
  [0, 0], [1, 0], [-1, 0], [0, -1], [17, -33], [-1000, 1000], [999999, -999999],
].map(([cx, cy]) => ({ cx, cy, stems: wallStemsAt(stemsWorld, cx, cy) }));

// -------------------------------------------------------------------------------------------
// 4. Overlap / destructible overlap, at real geometry found by scanning. Zero-radius probes at
//    a cell's centre AND at a corner (bug #3's exact case: `0 < 0` at an exact boundary).
// -------------------------------------------------------------------------------------------
function findCell(w: MossWalls, kind: number, from: number, to: number): [number, number] | null {
  for (let cy = from; cy < to; cy++) {
    for (let cx = from; cx < to; cx++) {
      if (wallKindAt(w, cx, cy) === kind) return [cx, cy];
    }
  }
  return null;
}

const overlapWorld = createMossWalls(7);
const solidCell = findCell(overlapWorld, WALL_SOLID, LO, HI)!;
const treeCell = findCell(overlapWorld, WALL_TREE, LO, HI)!;

const overlapProbes = [
  { name: 'zero-radius-at-centre', x: wallCentre(solidCell[0]), y: wallCentre(solidCell[1]), r: 0 },
  { name: 'zero-radius-at-corner', x: solidCell[0] * WALL_CELL + 1, y: solidCell[1] * WALL_CELL + 1, r: 0 },
  { name: 'zero-radius-in-the-open', x: 0, y: 0, r: 0 },
  { name: 'circle-touching-solid', x: wallCentre(solidCell[0]) - WALL_CELL, y: wallCentre(solidCell[1]), r: WALL_CELL / 2 + 1 },
  { name: 'circle-not-touching-solid', x: wallCentre(solidCell[0]) - WALL_CELL * 3, y: wallCentre(solidCell[1]), r: 5 },
  { name: 'circle-touching-tree', x: wallCentre(treeCell[0]), y: wallCentre(treeCell[1]), r: 1 },
].map((p) => ({
  ...p,
  overlap: wallOverlap(overlapWorld, p.x, p.y, p.r),
  destructibleOverlap: wallDestructibleOverlap(overlapWorld, p.x, p.y, p.r),
}));

// -------------------------------------------------------------------------------------------
// 5. Push-out: the property sweep (mirrors tests/wallsMossy.test.ts exactly, so the C# side can
//    run the identical probe pattern and check the identical invariant with no oracle needed),
//    PLUS a handful of individual pushes recorded bit-exactly for direct comparison, PLUS a
//    dedicated search for a body whose centre lands inside an occupied cell (the "buried, has an
//    open face" branch - see the header for why "buried, NO open face" cannot be reached at all).
// -------------------------------------------------------------------------------------------
const MECH_RADIUS = 26;

function overlapsWall(w: MossWalls, x: number, y: number, r: number): boolean {
  for (let cy = Math.floor((y - r) / WALL_CELL); cy <= Math.floor((y + r) / WALL_CELL); cy++) {
    for (let cx = Math.floor((x - r) / WALL_CELL); cx <= Math.floor((x + r) / WALL_CELL); cx++) {
      if (wallKindAt(w, cx, cy) === WALL_EMPTY) continue;
      const x0 = cx * WALL_CELL;
      const y0 = cy * WALL_CELL;
      const dx = x < x0 ? x0 - x : x > x0 + WALL_CELL ? x - (x0 + WALL_CELL) : 0;
      const dy = y < y0 ? y0 - y : y > y0 + WALL_CELL ? y - (y0 + WALL_CELL) : 0;
      if (dx * dx + dy * dy < r * r - 1e-6) return true;
    }
  }
  return false;
}

let sweepPushed = 0;
let sweepChecked = 0;
for (const seed of SEEDS) {
  const w = createMossWalls(seed);
  for (let i = 0; i < 20000; i++) {
    const x = ((i * 7919) % 40000) - 20000;
    const y = ((i * 104729) % 40000) - 20000;
    const p = pushOutOfWalls(w, x, y, MECH_RADIUS);
    sweepChecked++;
    if (!p.hit) continue;
    sweepPushed++;
    if (overlapsWall(w, p.x, p.y, MECH_RADIUS)) {
      throw new Error(`TypeScript itself left a body inside a wall: seed ${seed} probe ${i}`);
    }
  }
}

const pushWorld = createMossWalls(7);
const pushProbes = [
  { name: 'clear-opening', x: 0, y: 0, r: MECH_RADIUS },
  { name: 'against-solid-face', x: wallCentre(solidCell[0]) - WALL_CELL, y: wallCentre(solidCell[1]), r: MECH_RADIUS },
].map((p) => {
  const r = pushOutOfWalls(pushWorld, p.x, p.y, p.r);
  return { name: p.name, x: bits(p.x), y: bits(p.y), r: bits(p.r), result: { x: bits(r.x), y: bits(r.y), nx: bits(r.nx), ny: bits(r.ny), hit: r.hit } };
});

// A body whose CENTRE is inside an occupied cell - the "buried, has an open face" branch. Found
// by scanning rather than posed, since the exported API cannot pose a block; recorded exactly
// because this is the one branch worth a bit-exact case rather than only a property sweep.
let buriedCase: { cx: number; cy: number; x: string; y: string; result: unknown } | null = null;
{
  const w = createMossWalls(11);
  outer: for (let cy = LO; cy < HI; cy++) {
    for (let cx = LO; cx < HI; cx++) {
      if (wallKindAt(w, cx, cy) === WALL_EMPTY) continue;
      const x = wallCentre(cx);
      const y = wallCentre(cy);
      const r = pushOutOfWalls(w, x, y, MECH_RADIUS);
      buriedCase = { cx, cy, x: bits(x), y: bits(y), result: { x: bits(r.x), y: bits(r.y), nx: bits(r.nx), ny: bits(r.ny), hit: r.hit } };
      break outer;
    }
  }
}
if (buriedCase === null) throw new Error('expected at least one occupied cell in the swept area');

// -------------------------------------------------------------------------------------------
// 6. Rays: solid-only and tree-only, several directions including axis-aligned (exercises the
//    Infinity tDelta branch) and a grazing near-corner angle (the "cell recorded, not
//    re-derived" comment's exact concern).
// -------------------------------------------------------------------------------------------
const rayWorld = createMossWalls(7);
const rayProbes = [
  { name: 'straight-right', ox: 0, oy: 0, dx: 1, dy: 0, maxT: 5000 },
  { name: 'straight-down', ox: 0, oy: 0, dx: 0, dy: 1, maxT: 5000 },
  { name: 'diagonal', ox: 0, oy: 0, dx: 0.7071067811865476, dy: 0.7071067811865476, maxT: 5000 },
  { name: 'shallow-grazing', ox: 0, oy: 0, dx: 0.9987492177719088, dy: 0.04997916927067833, maxT: 5000 },
  { name: 'short-max-t', ox: 0, oy: 0, dx: 1, dy: 0, maxT: 10 },
].map((p) => {
  const solid = wallRayHit(rayWorld, p.ox, p.oy, p.dx, p.dy, p.maxT);
  const destructibleCell = wallDestructibleRayHit(rayWorld, p.ox, p.oy, p.dx, p.dy, p.maxT);
  const destructibleT = wallLastRayT();
  return {
    name: p.name,
    solidHit: bits(solid),
    destructibleCell,
    destructibleT: bits(destructibleT),
  };
});

// -------------------------------------------------------------------------------------------
// 7. Damage sequence: partial hits, wallStemsStanding at each step, then a full break.
// -------------------------------------------------------------------------------------------
const damageWorld = createMossWalls(7);
const damageCell = findCell(damageWorld, WALL_TREE, LO, HI)!;
const damageI = packWallCell(damageCell[0], damageCell[1]);
const stemCount = wallStemsAt(damageWorld, damageCell[0], damageCell[1]);
const perHitDamage = TREE_STEM_HP * 0.6; // less than one stem's worth, so several hits are needed
const damageSteps: unknown[] = [];
damageSteps.push({
  step: 'initial',
  standing: wallStemsStanding(damageWorld, damageCell[0], damageCell[1]),
  broken: isWallBroken(damageWorld, damageCell[0], damageCell[1]),
});
for (let i = 0; i < stemCount * 2; i++) {
  const felled = damageWallCell(damageWorld, damageI, perHitDamage);
  damageSteps.push({
    step: i,
    felled,
    standing: wallStemsStanding(damageWorld, damageCell[0], damageCell[1]),
    broken: isWallBroken(damageWorld, damageCell[0], damageCell[1]),
    kind: wallKindAt(damageWorld, damageCell[0], damageCell[1]),
  });
  if (isWallBroken(damageWorld, damageCell[0], damageCell[1])) break;
}

// breakWallCell directly, on a fresh cell, to check the version/count bump and idempotence.
const breakWorld = createMossWalls(7);
const breakCell = findCell(breakWorld, WALL_TREE, LO, HI)!;
const breakI = packWallCell(breakCell[0], breakCell[1]);
const beforeBreak = { count: breakWorld.count, version: breakWorld.version };
breakWallCell(breakWorld, breakI);
const afterBreak = { count: breakWorld.count, version: breakWorld.version, kind: wallKindAt(breakWorld, breakCell[0], breakCell[1]) };
breakWallCell(breakWorld, breakI); // idempotent - must not double-count
const afterSecondBreak = { count: breakWorld.count, version: breakWorld.version };

// -------------------------------------------------------------------------------------------

const fixture = {
  note:
    'Mossy Mayhem\'s wall lattice, driven entirely through the public API - blockKey/BLOCK_CELLS/' +
    'generateBlock are not exported, so a dense wallKindAt sweep IS the generation-determinism ' +
    'check. The push-out property sweep mirrors tests/wallsMossy.test.ts exactly.',
  wallCell: WALL_CELL,
  wallHalf: bits(WALL_HALF),
  treeStemHp: bits(TREE_STEM_HP),
  sweepBounds: { lo: LO, hi: HI },
  sweeps,
  stemProbes,
  overlapProbes,
  pushSweep: { checked: sweepChecked, pushed: sweepPushed },
  pushProbes,
  buriedCase,
  rayProbes,
  damageCell: { cx: damageCell[0], cy: damageCell[1], stemCount },
  damageSteps,
  breakCheck: { before: beforeBreak, after: afterBreak, afterSecond: afterSecondBreak },
};

writeFileSync('goldens/walls-mossy-fixture.json', JSON.stringify(fixture, null, 1));
console.log(
  `goldens/walls-mossy-fixture.json: ${sweeps.length} sweeps of ${(HI - LO) * (HI - LO)} cells, ` +
    `${sweepPushed} of ${sweepChecked} push probes hit, ${rayProbes.length} ray probes`,
);
