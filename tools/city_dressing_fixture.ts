/**
 * GOLDEN FIXTURE for City Chaos's dressing. Feeds `cs/tests/.../CityDressingTests.cs`.
 *
 * Everything recorded here is ART ONLY: which litter decal lies in a cell, which of four material
 * piles is stacked in it, which frontage a building wears, where on its roof the AC unit sits. The
 * simulation has never heard of a cone. Nothing here collides and nothing reaches the world hash,
 * so getting it wrong cannot break a run - it can only make the C# build and the web build show
 * different cities for the same seed, which is the kind of bug that wastes an afternoon before
 * anyone realises the two screenshots were never of the same thing.
 *
 * ---------------------------------------------------------------------------------------------
 * THE HASH HERE IS GENUINELY Math.imul ON BOTH TERMS
 * ---------------------------------------------------------------------------------------------
 * Which is worth saying because the two ground layers' hashes are NOT - their opening mixes are
 * plain float64 multiplies that lose bits past 2^53. Three hashes in one renderer, two of them
 * following one rule and one the other, all looking identical on the page. That is the argument
 * for reading each original rather than applying a remembered rule, and the argument for this file.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE GENERATOR REFUSES TO WRITE
 * ---------------------------------------------------------------------------------------------
 * A window in which nothing is littered, no fence is half-broken, no building has a frontage or no
 * pile appears is a window that agrees with any port at all. So the branches are counted, and a
 * fixture that misses one does not get written.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  CITY_BARREL,
  CITY_BUILDING,
  CITY_CELL,
  CITY_EMPTY,
  CITY_FENCE,
  CITY_PERIOD,
  CITY_ROAD_CELLS,
  type CityBlocks,
  cityFenceRing,
  cityIsConstructionBlock,
  cityIsRoad,
  cityIsRoadCell,
  cityKindAt,
  cityPristineKindAt,
  citySectionsStanding,
  createCityBlocks,
  damageCityCell,
  isCityBroken,
  packCityCell,
} from '../src/core/content/wallsCity.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/city-dressing-fixture.json');

// ---------------------------------------------------------------------------------------------
// Transcribed from src/render/dressingCity.ts.
// ---------------------------------------------------------------------------------------------

const FACE_HEIGHT = 36;
const PROP_SHARE = 0.22;
const PROP_SIZE = 26;
const LITTER_SHARE = 0.21;
const CONE_SHARE = 0.05;
const LITTER_SIZE = 34;
const CONE_SIZE = 24;

const CITY_FACE_COUNT = 4;
const CITY_FENCE_VARIANTS = 2;
const CITY_PILE_COUNT = 4;
const CITY_RUBBLE_COUNT = 2;
const CITY_LITTER_COUNT = 5;
const CITY_CONE_COUNT = 2;
const CITY_ROOF_PROP_COUNT = 3;

function cellHash(cx: number, cy: number): number {
  let h = Math.imul(cx | 0, 0x27d4eb2f) ^ Math.imul(cy | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

function litterVariant(cx: number, cy: number): number {
  const v = (cx + 2 * cy) % CITY_LITTER_COUNT;
  return v < 0 ? v + CITY_LITTER_COUNT : v;
}

function firstOfPair(v: number): boolean {
  return (((v + 1) % CITY_PERIOD) + CITY_PERIOD) % CITY_PERIOD === CITY_ROAD_CELLS - 2;
}

/** 0 none, 1 vertical road, 2 horizontal. */
function dashAt(cx: number, cy: number): number {
  const roadX = cityIsRoadCell(cx);
  const roadY = cityIsRoadCell(cy);
  if (roadX && !roadY && firstOfPair(cx)) return 1;
  if (roadY && !roadX && firstOfPair(cy)) return 2;
  return 0;
}

const scratch = new Float64Array(1);
const bits = new Uint32Array(scratch.buffer);
function f64(v: number): string {
  scratch[0] = v;
  return bits[1].toString(16).padStart(8, '0') + bits[0].toString(16).padStart(8, '0');
}

interface Decal {
  variant: number;
  x: string;
  y: string;
  size: string;
  rotation: string;
}

function litterAt(cx: number, cy: number): Decal | null {
  const h = cellHash(cx, cy);
  if (!((h & 0xfff) / 4096 < LITTER_SHARE)) return null;
  const variant = litterVariant(cx, cy);
  return {
    variant,
    x: f64((cx + 0.28 + ((h >>> 16) & 127) / 288) * CITY_CELL),
    y: f64((cy + 0.28 + ((h >>> 23) & 127) / 288) * CITY_CELL),
    size: f64(LITTER_SIZE * (0.8 + ((h >>> 2) & 63) / 160)),
    rotation: f64(variant === 4 ? 0 : ((h >>> 4) & 255) * 0.0245),
  };
}

function coneAt(cx: number, cy: number): Decal | null {
  const h = cellHash(cx, cy);
  if (!(((h >>> 19) & 0xfff) / 4096 < CONE_SHARE)) return null;
  return {
    variant: (h >>> 9) % CITY_CONE_COUNT,
    x: f64((cx + 0.32 + ((h >>> 13) & 63) / 192) * CITY_CELL),
    y: f64((cy + 0.32 + ((h >>> 26) & 63) / 192) * CITY_CELL),
    size: f64(CONE_SIZE),
    rotation: f64(0),
  };
}

function roofTile(city: CityBlocks, cx: number, cy: number): [number, number] {
  const solid = (x: number, y: number): boolean => cityKindAt(city, x, y) === CITY_BUILDING;
  const left = solid(cx - 1, cy);
  const right = solid(cx + 1, cy);
  const up = solid(cx, cy - 1);
  const down = solid(cx, cy + 1);
  return [
    !left && !right ? 3 : !left ? 0 : !right ? 2 : 1,
    !up && !down ? 3 : !up ? 0 : !down ? 2 : 1,
  ];
}

function roofPropAt(cx: number, cy: number, col: number, row: number): Decal | null {
  if (col !== 1 || row !== 1) return null;
  const h = cellHash(cx, cy);
  if (!(h / 4294967296 < PROP_SHARE)) return null;
  return {
    variant: (h >>> 8) % CITY_ROOF_PROP_COUNT,
    x: f64((cx + 0.3 + ((h >>> 12) % 128) / 320) * CITY_CELL),
    y: f64((cy + 0.3 + ((h >>> 19) % 128) / 320) * CITY_CELL),
    size: f64(PROP_SIZE),
    rotation: f64(0),
  };
}

/** 0 none, 1 fence, 2 pile, 3 rubble - matching CityDressingLayout.StreetKind. */
function streetAt(city: CityBlocks, cx: number, cy: number): [number, number, string] {
  const kind = cityKindAt(city, cx, cy);
  const h = cellHash(cx, cy);

  const felled =
    kind === CITY_EMPTY &&
    isCityBroken(city, cx, cy) &&
    cityPristineKindAt(city, cx, cy) === CITY_FENCE;
  if (felled) return [3, h % CITY_RUBBLE_COUNT, f64(1)];
  if (kind !== CITY_FENCE) return [0, 0, f64(1)];

  const alpha = f64(citySectionsStanding(city, cx, cy) === 1 ? 0.62 : 1);
  if (!cityFenceRing(cx, cy)) return [2, h % CITY_PILE_COUNT, alpha];

  const ringFence = (x: number, y: number): boolean =>
    cityKindAt(city, x, y) === CITY_FENCE && cityFenceRing(x, y);
  const mask =
    (ringFence(cx, cy - 1) ? 1 : 0) |
    (ringFence(cx + 1, cy) ? 2 : 0) |
    (ringFence(cx, cy + 1) ? 4 : 0) |
    (ringFence(cx - 1, cy) ? 8 : 0);
  if (mask === 0) return [2, h % CITY_PILE_COUNT, alpha];
  return [1, (mask - 1) * CITY_FENCE_VARIANTS + ((h >>> 6) % CITY_FENCE_VARIANTS), alpha];
}

function littersHere(city: CityBlocks, cx: number, cy: number): boolean {
  return (
    cityKindAt(city, cx, cy) === CITY_EMPTY &&
    !isCityBroken(city, cx, cy) &&
    cityIsConstructionBlock(city, cx, cy)
  );
}

// ---------------------------------------------------------------------------------------------

const SEEDS = [0, 1, 1554094637, -1030298724, 0x5ca19a2d];
/** Two full block periods each way, so every phase of the road/block lattice is in the window. */
const REACH = 20;

const reached = {
  road: 0,
  dash: 0,
  litter: 0,
  cone: 0,
  building: 0,
  face: 0,
  roofProp: 0,
  fence: 0,
  pile: 0,
  rubble: 0,
  barrel: 0,
  halfBroken: 0,
  felledDrum: 0,
  felledFence: 0,
};
const seenLitterVariants = new Set<number>();
const seenRoofTiles = new Set<string>();

const seeds: unknown[] = [];
for (const seed of SEEDS) {
  const city = createCityBlocks(seed);

  // BREAK SOME FENCE ON PURPOSE. Rubble, the orphaned-stub pile and the half-damaged dim are all
  // states a pristine grid never reaches, and they are three of the fiddlier branches in the file.
  // A fixture generated from an untouched city would test none of them.
  let damaged = 0;
  for (let cy = -REACH; cy <= REACH && damaged < 40; cy++) {
    for (let cx = -REACH; cx <= REACH && damaged < 40; cx++) {
      if (cityKindAt(city, cx, cy) !== CITY_FENCE) continue;
      const i = packCityCell(cx, cy);
      // Alternate: destroy outright, or take exactly one section off so the cell dims.
      damageCityCell(city, i, damaged % 2 === 0 ? 1e9 : 90);
      damaged++;
    }
  }

  // AND BREAK SOME DRUMS, which is a different fact from breaking fence and the whole reason
  // `felled` consults the PRISTINE kind. Both leave an empty cell in the broken set, and rubble is
  // splintered boards and hazard tape - nonsense lying where a fuel drum went up. Without a broken
  // drum in the window that distinction is untested, and it was: dropping the pristine-kind check
  // entirely passed the fixture, because no drum had ever been destroyed in it.
  // EVERY OTHER ONE, not all of them: a window with no drum left standing stops testing the drum
  // sprite, which is the branch the felled one is being distinguished FROM.
  let seen = 0;
  for (let cy = -REACH; cy <= REACH; cy++) {
    for (let cx = -REACH; cx <= REACH; cx++) {
      if (cityKindAt(city, cx, cy) !== CITY_BARREL) continue;
      if (seen % 2 === 0) damageCityCell(city, packCityCell(cx, cy), 1e9);
      seen++;
    }
  }

  const cells: unknown[] = [];
  for (let cy = -REACH; cy <= REACH; cy++) {
    for (let cx = -REACH; cx <= REACH; cx++) {
      const kind = cityKindAt(city, cx, cy);
      const [col, row] = roofTile(city, cx, cy);
      const [sKind, sIndex, sAlpha] = streetAt(city, cx, cy);
      const lit = littersHere(city, cx, cy) ? litterAt(cx, cy) : null;
      const cone = littersHere(city, cx, cy) ? coneAt(cx, cy) : null;
      const prop = kind === CITY_BUILDING ? roofPropAt(cx, cy, col, row) : null;
      const face =
        kind === CITY_BUILDING && cityKindAt(city, cx, cy + 1) !== CITY_BUILDING
          ? cellHash(cx, cy + 1) % CITY_FACE_COUNT
          : -1;
      const dash = dashAt(cx, cy);

      if (cityIsRoad(cx, cy)) reached.road++;
      if (dash !== 0) reached.dash++;
      if (lit) {
        reached.litter++;
        seenLitterVariants.add(lit.variant);
      }
      if (cone) reached.cone++;
      if (kind === CITY_BUILDING) {
        reached.building++;
        seenRoofTiles.add(`${col}${row}`);
      }
      if (face >= 0) reached.face++;
      if (prop) reached.roofProp++;
      if (sKind === 1) reached.fence++;
      if (sKind === 2) reached.pile++;
      if (sKind === 3) reached.rubble++;
      if (kind === CITY_BARREL) reached.barrel++;
      if (kind === CITY_EMPTY && isCityBroken(city, cx, cy)) {
        if (cityPristineKindAt(city, cx, cy) === CITY_FENCE) reached.felledFence++;
        else reached.felledDrum++;
      }
      if (kind === CITY_FENCE && citySectionsStanding(city, cx, cy) === 1) reached.halfBroken++;

      cells.push({
        cx,
        cy,
        hash: cellHash(cx, cy),
        dash,
        litters: littersHere(city, cx, cy),
        litter: lit,
        cone,
        col,
        row,
        face,
        prop,
        street: { kind: sKind, index: sIndex, alpha: sAlpha },
      });
    }
  }

  // The broken set travels with the fixture: the C# has to reproduce the same damage before it can
  // agree about rubble, and re-deriving it there would be a second implementation to get wrong.
  const broken: number[][] = [];
  const half: number[][] = [];
  for (let cy = -REACH; cy <= REACH; cy++) {
    for (let cx = -REACH; cx <= REACH; cx++) {
      if (isCityBroken(city, cx, cy)) broken.push([cx, cy]);
      else if (cityKindAt(city, cx, cy) === CITY_FENCE && citySectionsStanding(city, cx, cy) === 1) {
        half.push([cx, cy]);
      }
    }
  }

  seeds.push({ seed, broken, half, cells });
}

const problems: string[] = [];
for (const [k, n] of Object.entries(reached)) {
  if (n === 0) problems.push(`nothing in any window reaches ${k} - that branch is untested`);
}
if (seenLitterVariants.size < CITY_LITTER_COUNT) {
  problems.push(
    `only ${seenLitterVariants.size} of ${CITY_LITTER_COUNT} litter variants appear - the lattice is barely tested`,
  );
}
if (seenRoofTiles.size < 9) {
  problems.push(`only ${seenRoofTiles.size} roof autotile pieces appear - edges and corners are missing`);
}
if (problems.length > 0) {
  for (const p of problems) console.error(`  FIXTURE MEASURES NOTHING: ${p}`);
  process.exit(1);
}

// HASH PROBES OUT WHERE THE TWO MULTIPLIES DISAGREE.
//
// `cellHash` uses Math.imul on both terms - a 32-bit wrapping multiply - and a port that reached
// for a plain float64 multiply instead would be wrong. Except that it would not, anywhere the game
// can go: the arena is 12,288 units at 64 to a cell, so |cx| never passes about 100, and the two
// spellings agree exactly until |cx| * 0x27d4eb2f passes 2^53 - around thirteen million. Injecting
// that fault changed not one cell of the window.
//
// That leaves two honest options: call the distinction untestable, or test the FUNCTION rather
// than the yard. These are the second. They pin cellHash at coordinates chosen precisely because
// the wrong multiply diverges there, which costs a dozen numbers and means the next person to
// "simplify" the hash is told about it.
const hashProbes: unknown[] = [];
for (const c of [1 << 24, 1 << 27, 123456789, -123456789, 2147483647, -2147483648, 99999999]) {
  hashProbes.push({ cx: c, cy: 3, h: cellHash(c, 3) });
  hashProbes.push({ cx: 3, cy: c, h: cellHash(3, c) });
}

const fixture = {
  note: 'Generated by tools/city_dressing_fixture.ts. Do not edit by hand.',
  hashProbes,
  reach: REACH,
  faceHeight: f64(FACE_HEIGHT),
  seeds,
  coverage: { ...reached, litterVariants: [...seenLitterVariants].sort((a, b) => a - b) },
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${OUT_PATH}`);
console.log(`  ${SEEDS.length} seeds, ${(REACH * 2 + 1) ** 2} cells each`);
console.log(`  branches reached: ${JSON.stringify(reached)}`);
console.log(`  roof autotile pieces seen: ${[...seenRoofTiles].sort().join(' ')}`);
