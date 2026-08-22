/**
 * `npm run golden:rng` - emit `goldens/rng-fixture.json`, the cross-language proof for the RNG and
 * the hash primitives.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS SEPARATELY FROM THE RUN CORPUS
 * ---------------------------------------------------------------------------------------------
 * `goldens/corpus.json` proves the whole simulation reproduces. It is also useless as a first
 * milestone for a port, because it cannot pass until `stepWorld` and everything under it exists -
 * so the single most failure-prone part of the translation, the 32-bit integer arithmetic, would
 * go unverified for weeks and then surface as "the world hash differs at tick 3" with eleven
 * thousand lines of suspects.
 *
 * This file inverts that. It pins the arithmetic on its own, in a fixture a fresh port can satisfy
 * on its first day: sfc32, splitmix32, the six salted streams, and the FNV mixers. Everything in
 * the traps table of docs/PORTING-GOLDEN-MASTER.md is exercised here - `Math.imul`, `>>>`, `| 0`,
 * the four constants that overflow int32, and the 2^-24 literal.
 *
 * ---------------------------------------------------------------------------------------------
 * FLOATS ARE STORED AS BIT PATTERNS, NOT AS DECIMALS
 * ---------------------------------------------------------------------------------------------
 * Every double in here is written as a 16-character hex string of its IEEE-754 bits. Writing
 * `0.1234567890123` and re-parsing it on the other side introduces exactly one question - whether
 * both languages' decimal parsers round identically - and that question has nothing to do with the
 * simulation. Hex bits remove it: the comparison is on the number, not on its spelling.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  RNG_SALT_EVENT,
  RNG_SALT_LOOT,
  RNG_SALT_SHEEP,
  RNG_SALT_SPAWN,
  RNG_SALT_UPGRADE,
  RNG_SALT_WEAPON,
  Rng,
  createRngStreams,
  hashToHex,
  splitmix32,
  type RngState,
} from '../src/core/index.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/rng-fixture.json');

/** Seeds chosen to hit the awkward cases, not to look random. */
const SEEDS: readonly { readonly name: string; readonly seed: number }[] = [
  { name: 'zero', seed: 0 },
  { name: 'one', seed: 1 },
  // NEGATIVE, because a JS seed is `| 0` and the harness's default seed has the top bit set.
  // A C# port that typed the seed as `uint` somewhere would pass every other case and fail this.
  { name: 'negative', seed: -1 },
  { name: 'int32-min', seed: -2147483648 },
  { name: 'int32-max', seed: 2147483647 },
  { name: 'harness-default', seed: 0x5ca19a2d },
  // Top bit set, which is what every salt xor produces about half the time.
  { name: 'high-bit', seed: 0x9e3779b1 | 0 },
  { name: 'corpus-full', seed: 0x1d0c8a77 },
];

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);

/** A double as the 16 hex digits of its IEEE-754 bits, high word first for readability. */
function f64Bits(v: number): string {
  scratchF64[0] = v;
  const hi = scratchU32[1].toString(16).padStart(8, '0');
  const lo = scratchU32[0].toString(16).padStart(8, '0');
  return hi + lo;
}

function u32Hex(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}

function stateOf(rng: Rng): { a: string; b: string; c: string; d: string } {
  const s: RngState = { a: 0, b: 0, c: 0, d: 0 };
  rng.save(s);
  return { a: u32Hex(s.a), b: u32Hex(s.b), c: u32Hex(s.c), d: u32Hex(s.d) };
}

// --- splitmix32 -------------------------------------------------------------------------------
// Taken BEFORE any Rng construction, because Rng consumes four splitmix outputs and then burns
// twelve of its own - a port that got the warm-up count wrong would still pass a test that only
// looked at the stream afterwards.
const splitmix = SEEDS.map(({ name, seed }) => {
  const next = splitmix32(seed);
  const out: string[] = [];
  for (let i = 0; i < 16; i++) out.push(u32Hex(next()));
  return { name, seed, out };
});

// --- the generator itself ---------------------------------------------------------------------
const rngs = SEEDS.map(({ name, seed }) => {
  const u32: string[] = [];
  {
    const r = new Rng(seed);
    for (let i = 0; i < 32; i++) u32.push(u32Hex(r.nextU32()));
  }

  // A FRESH GENERATOR PER VIEW. Sharing one would make each list depend on how many draws the
  // previous list happened to take, so adding a case later would rewrite the whole fixture.
  const doubles: string[] = [];
  {
    const r = new Rng(seed);
    for (let i = 0; i < 16; i++) doubles.push(f64Bits(r.nextFloat()));
  }

  const ranges: string[] = [];
  {
    const r = new Rng(seed);
    for (let i = 0; i < 8; i++) ranges.push(f64Bits(r.nextRange(-17.5, 42.25)));
  }

  // The bounds matter more than the count: 1 short-circuits, 2 and 3 have the widest rejection
  // bands, and 2^31 is the largest value that survives the `| 0` a caller might apply.
  const ints: Record<string, number[]> = {};
  for (const n of [1, 2, 3, 7, 10, 64, 1000, 2147483647]) {
    const r = new Rng(seed);
    const list: number[] = [];
    for (let i = 0; i < 12; i++) list.push(r.nextInt(n));
    ints[String(n)] = list;
  }

  // Cumulative weights, deliberately including a zero-weight entry (index 1 can never be picked)
  // and a repeated boundary - the two cases a binary search gets wrong.
  const cumulative = new Float64Array([1, 1, 4, 4.5, 9, 9, 20]);
  const picks: number[] = [];
  {
    const r = new Rng(seed);
    for (let i = 0; i < 16; i++) picks.push(r.pickWeighted(cumulative, cumulative.length));
  }

  // State after a known number of draws, so a port can compare the generator's INTERNALS rather
  // than only its outputs. Two generators can agree for 32 draws and hold different state.
  const r = new Rng(seed);
  for (let i = 0; i < 100; i++) r.nextU32();

  return { name, seed, u32, doubles, ranges, ints, picks, stateAfter100: stateOf(r) };
});

// --- the salted streams -----------------------------------------------------------------------
const streams = SEEDS.map(({ name, seed }) => {
  const s = createRngStreams(seed);
  return {
    name,
    seed,
    // The freshly-seeded state of each stream. This is what catches a salt applied with the wrong
    // sign, or a constant that lost its top bit crossing into C#.
    spawn: stateOf(s.spawn),
    loot: stateOf(s.loot),
    upgrade: stateOf(s.upgrade),
    weapon: stateOf(s.weapon),
    event: stateOf(s.event),
    sheep: stateOf(s.sheep),
    // And the first draw off each, so a stream that is correctly seeded but wrongly advanced is
    // still caught.
    firstDraw: {
      spawn: u32Hex(s.spawn.nextU32()),
      loot: u32Hex(s.loot.nextU32()),
      upgrade: u32Hex(s.upgrade.nextU32()),
      weapon: u32Hex(s.weapon.nextU32()),
      event: u32Hex(s.event.nextU32()),
      sheep: u32Hex(s.sheep.nextU32()),
    },
  };
});

// --- the FNV mixers ---------------------------------------------------------------------------
// Reimplemented here rather than imported, because `mixU32`/`mixF64` are private to hash.ts and
// exporting them purely for a fixture would widen core's surface for a test's convenience. They
// are six lines; the duplication is checked by `hashWorld` itself agreeing with the corpus.
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mixU32(h: number, v: number): number {
  let acc = h;
  acc = Math.imul(acc ^ (v & 0xff), FNV_PRIME);
  acc = Math.imul(acc ^ ((v >>> 8) & 0xff), FNV_PRIME);
  acc = Math.imul(acc ^ ((v >>> 16) & 0xff), FNV_PRIME);
  acc = Math.imul(acc ^ ((v >>> 24) & 0xff), FNV_PRIME);
  return acc;
}

function mixF64(h: number, v: number): number {
  scratchF64[0] = v;
  return mixU32(mixU32(h, scratchU32[0]), scratchU32[1]);
}

const U32_CASES = [0, 1, 0xff, 0x100, 0x7fffffff, 0x80000000, 0xffffffff, 0x811c9dc5];
const F64_CASES = [
  0,
  -0,
  1,
  -1,
  0.1,
  -0.1,
  0.5,
  1e-300,
  1e300,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  Number.EPSILON,
  // 2^-24 itself, since it is the constant nextFloat multiplies by.
  5.960464477539063e-8,
  Infinity,
  -Infinity,
  NaN,
];

const fnv = {
  offset: u32Hex(FNV_OFFSET),
  prime: u32Hex(FNV_PRIME),
  // Each case hashed from the offset basis on its own, so one wrong entry does not cascade.
  u32: U32_CASES.map((v) => ({ input: u32Hex(v), out: hashToHex(mixU32(FNV_OFFSET, v)) })),
  f64: F64_CASES.map((v) => ({ bits: f64Bits(v), out: hashToHex(mixF64(FNV_OFFSET, v)) })),
  // And one chained sequence, which is what the real hash does: order must matter.
  chained: hashToHex(
    U32_CASES.reduce((h, v) => mixU32(h, v), F64_CASES.reduce((h, v) => mixF64(h, v), FNV_OFFSET)),
  ),
};

const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for src/core/rng.ts and the FNV mixers in src/core/hash.ts. Doubles are IEEE-754 bits as 16 hex digits, high word first.',
  salts: {
    spawn: u32Hex(RNG_SALT_SPAWN),
    loot: u32Hex(RNG_SALT_LOOT),
    upgrade: u32Hex(RNG_SALT_UPGRADE),
    weapon: u32Hex(RNG_SALT_WEAPON),
    event: u32Hex(RNG_SALT_EVENT),
    sheep: u32Hex(RNG_SALT_SHEEP),
  },
  twoPowMinus24: f64Bits(5.960464477539063e-8),
  splitmix,
  rngs,
  streams,
  fnv,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/rng-fixture.json  (${SEEDS.length} seeds, ` +
    `${fnv.u32.length} u32 + ${fnv.f64.length} f64 hash cases)`,
);
