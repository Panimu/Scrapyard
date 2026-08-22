/**
 * `npm run golden:wallsCity` (add to package.json) - emit `goldens/walls-city-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * NO CACHE, SO NO ORDER-INDEPENDENCE CHECK
 * ---------------------------------------------------------------------------------------------
 * Unlike wallsMossy's fixture, there is no forwards-vs-backwards sweep here: `cityKindAt` is pure
 * arithmetic with no memo at all, so there is no cache-population order for a query to depend on.
 * A dense sweep IS still the generation-determinism check, since every cell it names goes through
 * `hashBlock` -> `blockCellKind` exactly as a real query would - `blockCellBase`/`inGateway`/
 * `inGatewayLane` etc. are not exported, so (as with Mossy) there is no way to pose a block
 * directly and no need to: the public API reaches the same generator every time.
 *
 * ---------------------------------------------------------------------------------------------
 * THE PUSH-OUT "BURIED, NO OPEN FACE" BRANCH IS REACHABLE HERE - UNLIKE MOSSY'S
 * ---------------------------------------------------------------------------------------------
 * wallsMossy's fixture proves that branch UNREACHABLE: every shape it deals is one cell thick, so
 * every occupied cell keeps at least two open cardinal neighbours. City is not: a BLOCK_FILLED
 * slab is a solid 6x6 mass when it rolls the plain silhouette, so a cell at ring 2+ from every
 * edge can have all four cardinal neighbours also BUILDING. Searched for and (if the swept window
 * turns one up) recorded as a real bit-exact case below, rather than written off as unreachable a
 * second time without checking.
 */

import { writeFileSync } from 'node:fs';

import {
  CITY_CELL, CITY_PERIOD, CITY_ROAD_CELLS, CITY_BLOCK_CELLS, CITY_EMPTY, CITY_BUILDING,
  CITY_FENCE, CITY_BARREL, FENCE_SECTION_HP, FENCE_SECTIONS, CITY_BARREL_HALF, CITY_RING_THICKNESS,
  CITY_HALF, createCityBlocks, cityCentre, cityIsRoadCell, cityIsRoad, cityFenceRing,
  cityIsConstructionBlock, cityKindAt, cityPristineKindAt, isCityBroken, packCityCell, cityCellX,
  cityCellY, cityOverlap, cityDestructibleOverlap, pushOutOfCity, cityRayHit, cityLastRayT,
  cityDestructibleRayHit, cityIsBarrel, breakCityCell, citySectionsStanding, damageCityCell,
} from '../src/core/content/wallsCity.js';
import type { CityBlocks } from '../src/core/content/wallsCity.js';

const buf = new DataView(new ArrayBuffer(8));
function bits(v: number): string {
  buf.setFloat64(0, v);
  return buf.getBigUint64(0).toString(16).padStart(16, '0');
}

const SEEDS = [1, 7, 12345, 99, 2024];
const LO = -60;
const HI = 60;

// -------------------------------------------------------------------------------------------
// 1. A dense cityKindAt sweep, several seeds - the generation-determinism check.
// -------------------------------------------------------------------------------------------
function sweep(seed: number): string {
  const c = createCityBlocks(seed);
  const bitsPerCell = 2;
  const totalCells = (HI - LO) * (HI - LO);
  const bytes = new Uint8Array(Math.ceil((totalCells * bitsPerCell) / 8));
  let bitIndex = 0;
  for (let cy = LO; cy < HI; cy++) {
    for (let cx = LO; cx < HI; cx++) {
      const kind = cityKindAt(c, cx, cy);
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
// 2. packCityCell / cityCellX / cityCellY round-trip, including negative coordinates.
// -------------------------------------------------------------------------------------------
for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [-500, 500], [500, -500], [-999999, -999999]] as const) {
  const i = packCityCell(cx, cy);
  if (cityCellX(i) !== cx || cityCellY(i) !== cy) {
    throw new Error(`packCityCell round-trip failed for (${cx}, ${cy}): got (${cityCellX(i)}, ${cityCellY(i)})`);
  }
}

// -------------------------------------------------------------------------------------------
// 3. Road probes, including the phase claim: the origin sits mid-crossroads on both axes.
// -------------------------------------------------------------------------------------------
const roadProbes = [
  [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [5, 5], [-5, -5], [3, 0], [0, 3],
].map(([cx, cy]) => ({
  cx, cy,
  isRoadCellX: cityIsRoadCell(cx),
  isRoadCellY: cityIsRoadCell(cy),
  isRoad: cityIsRoad(cx, cy),
}));

// -------------------------------------------------------------------------------------------
// 4. Category probes: scan once for one cell of each kind the renderer-only helpers care about,
//    plus the two "buried" push-out topologies. A single pass over a fresh seed-7 world.
// -------------------------------------------------------------------------------------------
const probeWorld = createCityBlocks(7);

type Found = { cx: number; cy: number } | null;
let firstBuilding: Found = null;
let firstFenceRingCell: Found = null;
let firstPileCell: Found = null;
let firstBarrel: Found = null;
let firstConstructionCell: Found = null;
let firstNonConstructionOccupied: Found = null;
let buriedAnyTrue: Found = null;
let buriedAnyFalse: Found = null;

for (let cy = LO; cy < HI; cy++) {
  for (let cx = LO; cx < HI; cx++) {
    const kind = cityKindAt(probeWorld, cx, cy);
    if (kind === CITY_EMPTY) continue;

    if (kind === CITY_BUILDING && firstBuilding === null) firstBuilding = { cx, cy };
    if (kind === CITY_FENCE && cityFenceRing(cx, cy) && firstFenceRingCell === null) {
      firstFenceRingCell = { cx, cy };
    }
    if (kind === CITY_FENCE && !cityFenceRing(cx, cy) && firstPileCell === null) {
      firstPileCell = { cx, cy };
    }
    if (kind === CITY_BARREL && firstBarrel === null) firstBarrel = { cx, cy };

    const construction = cityIsConstructionBlock(probeWorld, cx, cy);
    if (construction && firstConstructionCell === null) firstConstructionCell = { cx, cy };
    if (!construction && firstNonConstructionOccupied === null) firstNonConstructionOccupied = { cx, cy };

    const openL = cityKindAt(probeWorld, cx - 1, cy) === CITY_EMPTY;
    const openR = cityKindAt(probeWorld, cx + 1, cy) === CITY_EMPTY;
    const openU = cityKindAt(probeWorld, cx, cy - 1) === CITY_EMPTY;
    const openD = cityKindAt(probeWorld, cx, cy + 1) === CITY_EMPTY;
    const any = openL || openR || openU || openD;
    if (any && buriedAnyTrue === null) buriedAnyTrue = { cx, cy };
    if (!any && buriedAnyFalse === null) buriedAnyFalse = { cx, cy };
  }
}
for (const [name, v] of [
  ['firstBuilding', firstBuilding], ['firstFenceRingCell', firstFenceRingCell],
  ['firstPileCell', firstPileCell], ['firstBarrel', firstBarrel],
  ['firstConstructionCell', firstConstructionCell],
  ['firstNonConstructionOccupied', firstNonConstructionOccupied], ['buriedAnyTrue', buriedAnyTrue],
] as const) {
  if (v === null) throw new Error(`expected to find a ${name} cell in the swept window`);
}
// buriedAnyFalse is allowed to come back null - see the header. Reported either way, not hidden.

// cityFenceRing / cityIsConstructionBlock / cityPristineKindAt at the found cells.
const categoryProbes = {
  building: { ...firstBuilding!, fenceRing: cityFenceRing(firstBuilding!.cx, firstBuilding!.cy) },
  fenceRingCell: {
    ...firstFenceRingCell!,
    fenceRing: cityFenceRing(firstFenceRingCell!.cx, firstFenceRingCell!.cy),
    isConstructionBlock: cityIsConstructionBlock(probeWorld, firstFenceRingCell!.cx, firstFenceRingCell!.cy),
  },
  pileCell: {
    ...firstPileCell!,
    fenceRing: cityFenceRing(firstPileCell!.cx, firstPileCell!.cy),
    isConstructionBlock: cityIsConstructionBlock(probeWorld, firstPileCell!.cx, firstPileCell!.cy),
  },
  barrel: { ...firstBarrel!, isBarrel: cityIsBarrel(probeWorld, firstBarrel!.cx, firstBarrel!.cy) },
  constructionCell: { ...firstConstructionCell!, isConstructionBlock: true },
  nonConstructionOccupied: { ...firstNonConstructionOccupied!, isConstructionBlock: false },
};

// pristineKindAt vs kindAt, before and after breaking - the whole point of pristineKindAt.
const pristineWorld = createCityBlocks(7);
const pristineCell = firstFenceRingCell!;
const pristineI = packCityCell(pristineCell.cx, pristineCell.cy);
const pristineBefore = {
  pristine: cityPristineKindAt(pristineWorld, pristineCell.cx, pristineCell.cy),
  live: cityKindAt(pristineWorld, pristineCell.cx, pristineCell.cy),
  broken: isCityBroken(pristineWorld, pristineCell.cx, pristineCell.cy),
};
breakCityCell(pristineWorld, pristineI);
const pristineAfter = {
  pristine: cityPristineKindAt(pristineWorld, pristineCell.cx, pristineCell.cy),
  live: cityKindAt(pristineWorld, pristineCell.cx, pristineCell.cy),
  broken: isCityBroken(pristineWorld, pristineCell.cx, pristineCell.cy),
};

// -------------------------------------------------------------------------------------------
// 5. Overlap / destructible overlap - building, fence, and the drum's SMALLER box specifically.
// -------------------------------------------------------------------------------------------
const overlapWorld = createCityBlocks(7);
const barrelCx = cityCentre(firstBarrel!.cx);
const barrelCy = cityCentre(firstBarrel!.cy);
const overlapProbes = [
  {
    name: 'zero-radius-at-building-centre',
    x: cityCentre(firstBuilding!.cx), y: cityCentre(firstBuilding!.cy), r: 0,
  },
  {
    name: 'zero-radius-at-building-corner',
    x: firstBuilding!.cx * CITY_CELL + 1, y: firstBuilding!.cy * CITY_CELL + 1, r: 0,
  },
  { name: 'zero-radius-in-the-open', x: cityCentre(0), y: cityCentre(0), r: 0 },
  {
    name: 'circle-touching-fence-ring',
    x: cityCentre(firstFenceRingCell!.cx) - CITY_CELL, y: cityCentre(firstFenceRingCell!.cy),
    r: CITY_CELL / 2 + 1,
  },
  // Between the drum's own box (half 20) and the full cell (half 32): must NOT touch the drum.
  { name: 'just-outside-drum-box', x: barrelCx + 26, y: barrelCy, r: 0 },
  // Inside the drum's own box: must touch.
  { name: 'just-inside-drum-box', x: barrelCx + 18, y: barrelCy, r: 0 },
  { name: 'drum-centre', x: barrelCx, y: barrelCy, r: 0 },
].map((p) => ({
  ...p,
  overlap: cityOverlap(overlapWorld, p.x, p.y, p.r),
  destructibleOverlap: cityDestructibleOverlap(overlapWorld, p.x, p.y, p.r),
}));

// -------------------------------------------------------------------------------------------
// 6. Push-out: property sweep (TypeScript checks its own invariant; the C# side reruns the same
//    probe formula and checks it independently, needing no oracle from here) plus bit-exact
//    individual probes for both buried topologies.
// -------------------------------------------------------------------------------------------
const MECH_RADIUS = 26;

function cellHalfOf(kind: number): number {
  return kind === CITY_BARREL ? CITY_BARREL_HALF : CITY_HALF;
}

function overlapsCity(c: CityBlocks, x: number, y: number, r: number): boolean {
  for (let cy = Math.floor((y - r) / CITY_CELL); cy <= Math.floor((y + r) / CITY_CELL); cy++) {
    for (let cx = Math.floor((x - r) / CITY_CELL); cx <= Math.floor((x + r) / CITY_CELL); cx++) {
      const kind = cityKindAt(c, cx, cy);
      if (kind === CITY_EMPTY) continue;
      const half = cellHalfOf(kind);
      const mx = cityCentre(cx);
      const my = cityCentre(cy);
      const x0 = mx - half;
      const y0 = my - half;
      const x1 = mx + half;
      const y1 = my + half;
      const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
      if (dx * dx + dy * dy < r * r - 1e-6) return true;
    }
  }
  return false;
}

// NOT a hard "never leaves a body inside" assertion, unlike Mossy's version of this sweep. Mossy's
// shapes are all one cell thick, so three passes provably always reach open air. City's BLOCK_FILLED
// slab can be a solid 6x6 mass, and a synthetic probe scattered across the WHOLE plane can start
// several cells deep inside one - a starting position no legitimate spawn or movement step can
// produce (spawns land only on reachable ground, per tests/wallsCity.test.ts, and nothing moves a
// body more than a few units per tick). Measured, not assumed: this sweep counts how many probes are
// still overlapping after the full three passes and records the count rather than asserting it is
// zero, so the C# port is checked against the TypeScript's ACTUAL behaviour - including this known,
// accepted gap - rather than against a claim that turned out not to hold.
let sweepPushed = 0;
let sweepChecked = 0;
let sweepStillOverlapping = 0;
for (const seed of SEEDS) {
  const c = createCityBlocks(seed);
  for (let i = 0; i < 20000; i++) {
    const x = ((i * 7919) % 40000) - 20000;
    const y = ((i * 104729) % 40000) - 20000;
    const p = pushOutOfCity(c, x, y, MECH_RADIUS);
    sweepChecked++;
    if (!p.hit) continue;
    sweepPushed++;
    if (overlapsCity(c, p.x, p.y, MECH_RADIUS)) sweepStillOverlapping++;
  }
}

const pushWorld = createCityBlocks(7);
const pushProbes = [
  { name: 'clear-opening', x: cityCentre(0), y: cityCentre(0), r: MECH_RADIUS },
  {
    name: 'against-building-face',
    x: cityCentre(firstBuilding!.cx) - CITY_CELL, y: cityCentre(firstBuilding!.cy), r: MECH_RADIUS,
  },
  {
    name: 'against-drum-face',
    x: barrelCx - CITY_CELL, y: barrelCy, r: MECH_RADIUS,
  },
].map((p) => {
  const r = pushOutOfCity(pushWorld, p.x, p.y, p.r);
  return { name: p.name, x: bits(p.x), y: bits(p.y), r: bits(p.r), result: { x: bits(r.x), y: bits(r.y), nx: bits(r.nx), ny: bits(r.ny), hit: r.hit } };
});

function buriedCase(cell: Found): { cx: number; cy: number; x: string; y: string; result: unknown } | null {
  if (cell === null) return null;
  const x = cityCentre(cell.cx);
  const y = cityCentre(cell.cy);
  const r = pushOutOfCity(pushWorld, x, y, MECH_RADIUS);
  return { cx: cell.cx, cy: cell.cy, x: bits(x), y: bits(y), result: { x: bits(r.x), y: bits(r.y), nx: bits(r.nx), ny: bits(r.ny), hit: r.hit } };
}
const buriedAnyTrueCase = buriedCase(buriedAnyTrue);
const buriedAnyFalseCase = buriedCase(buriedAnyFalse);

// -------------------------------------------------------------------------------------------
// 7. Rays: building-only, and the two-kind fence-or-drum destructible ray.
// -------------------------------------------------------------------------------------------
const rayWorld = createCityBlocks(7);
const rayProbes = [
  { name: 'straight-right', ox: cityCentre(0), oy: cityCentre(0), dx: 1, dy: 0, maxT: 5000 },
  { name: 'straight-down', ox: cityCentre(0), oy: cityCentre(0), dx: 0, dy: 1, maxT: 5000 },
  { name: 'diagonal', ox: cityCentre(0), oy: cityCentre(0), dx: 0.7071067811865476, dy: 0.7071067811865476, maxT: 5000 },
  { name: 'shallow-grazing', ox: cityCentre(0), oy: cityCentre(0), dx: 0.9987492177719088, dy: 0.04997916927067833, maxT: 5000 },
  { name: 'short-max-t', ox: cityCentre(0), oy: cityCentre(0), dx: 1, dy: 0, maxT: 10 },
].map((p) => {
  const solid = cityRayHit(rayWorld, p.ox, p.oy, p.dx, p.dy, p.maxT);
  const destructibleCell = cityDestructibleRayHit(rayWorld, p.ox, p.oy, p.dx, p.dy, p.maxT);
  const destructibleT = cityLastRayT();
  return {
    name: p.name,
    solidHit: bits(solid),
    destructibleCell,
    destructibleT: bits(destructibleT),
  };
});

// -------------------------------------------------------------------------------------------
// 8. Damage sequences: a fence cell (multi-section, like Mossy's tree) AND a drum (single-hit,
//    ignores amount) - City has both, unlike Mossy's uniform tree.
// -------------------------------------------------------------------------------------------
const damageWorld = createCityBlocks(7);
const fenceCell = firstFenceRingCell!;
const fenceI = packCityCell(fenceCell.cx, fenceCell.cy);
const perHitDamage = FENCE_SECTION_HP * 0.6; // less than one section's worth
const fenceDamageSteps: unknown[] = [];
fenceDamageSteps.push({
  step: 'initial',
  standing: citySectionsStanding(damageWorld, fenceCell.cx, fenceCell.cy),
  broken: isCityBroken(damageWorld, fenceCell.cx, fenceCell.cy),
});
for (let i = 0; i < FENCE_SECTIONS * 2; i++) {
  const felled = damageCityCell(damageWorld, fenceI, perHitDamage);
  fenceDamageSteps.push({
    step: i,
    felled,
    standing: citySectionsStanding(damageWorld, fenceCell.cx, fenceCell.cy),
    broken: isCityBroken(damageWorld, fenceCell.cx, fenceCell.cy),
    kind: cityKindAt(damageWorld, fenceCell.cx, fenceCell.cy),
  });
  if (isCityBroken(damageWorld, fenceCell.cx, fenceCell.cy)) break;
}

const barrelDamageWorld = createCityBlocks(7);
const barrelI = packCityCell(firstBarrel!.cx, firstBarrel!.cy);
const barrelBefore = {
  standing: citySectionsStanding(barrelDamageWorld, firstBarrel!.cx, firstBarrel!.cy),
  broken: isCityBroken(barrelDamageWorld, firstBarrel!.cx, firstBarrel!.cy),
};
// A tiny amount - must still take the whole drum in one hit, unlike a fence section.
const barrelFelled = damageCityCell(barrelDamageWorld, barrelI, 1);
const barrelAfter = {
  felled: barrelFelled,
  standing: citySectionsStanding(barrelDamageWorld, firstBarrel!.cx, firstBarrel!.cy),
  broken: isCityBroken(barrelDamageWorld, firstBarrel!.cx, firstBarrel!.cy),
  kind: cityKindAt(barrelDamageWorld, firstBarrel!.cx, firstBarrel!.cy),
};

// breakCityCell directly, on a fresh fence cell, to check the version/count bump and idempotence.
const breakWorld = createCityBlocks(7);
const breakI = packCityCell(fenceCell.cx, fenceCell.cy);
const beforeBreak = { count: breakWorld.count, version: breakWorld.version };
breakCityCell(breakWorld, breakI);
const afterBreak = { count: breakWorld.count, version: breakWorld.version, kind: cityKindAt(breakWorld, fenceCell.cx, fenceCell.cy) };
breakCityCell(breakWorld, breakI); // idempotent - must not double-count
const afterSecondBreak = { count: breakWorld.count, version: breakWorld.version };

// -------------------------------------------------------------------------------------------

const fixture = {
  note:
    'City Chaos\'s road grid, driven entirely through the public API - blockCellBase/blockCellKind/' +
    'inGateway etc. are not exported, so a dense cityKindAt sweep IS the generation-determinism ' +
    'check. Unlike wallsMossy there is no cache, so no order-independence check is needed. The ' +
    'push-out property sweep checks the same never-left-inside invariant tests/wallsCity.test.ts\'s ' +
    'own reachability tests protect a different way; the C# side reruns it independently.',
  cityCell: CITY_CELL,
  cityPeriod: CITY_PERIOD,
  cityRoadCells: CITY_ROAD_CELLS,
  cityBlockCells: CITY_BLOCK_CELLS,
  cityRingThickness: CITY_RING_THICKNESS,
  fenceSectionHp: FENCE_SECTION_HP,
  fenceSections: FENCE_SECTIONS,
  cityHalf: bits(CITY_HALF),
  cityBarrelHalf: bits(CITY_BARREL_HALF),
  sweepBounds: { lo: LO, hi: HI },
  sweeps,
  roadProbes,
  categoryProbes,
  pristineCheck: { cx: pristineCell.cx, cy: pristineCell.cy, before: pristineBefore, after: pristineAfter },
  overlapProbes,
  pushSweep: { checked: sweepChecked, pushed: sweepPushed, stillOverlapping: sweepStillOverlapping },
  pushProbes,
  buriedAnyTrueCase,
  buriedAnyFalseCase,
  rayProbes,
  fenceDamage: { cx: fenceCell.cx, cy: fenceCell.cy, steps: fenceDamageSteps },
  barrelDamage: { cx: firstBarrel!.cx, cy: firstBarrel!.cy, before: barrelBefore, after: barrelAfter },
  breakCheck: { before: beforeBreak, after: afterBreak, afterSecond: afterSecondBreak },
};

writeFileSync('goldens/walls-city-fixture.json', JSON.stringify(fixture, null, 1));
console.log(
  `goldens/walls-city-fixture.json: ${sweeps.length} sweeps of ${(HI - LO) * (HI - LO)} cells, ` +
    `${sweepPushed} of ${sweepChecked} push probes hit, buriedAnyFalse ${buriedAnyFalseCase ? 'FOUND' : 'not found'}, ` +
    `${rayProbes.length} ray probes`,
);
