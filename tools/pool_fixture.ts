/**
 * `npm run golden:pool` - emit `goldens/pool-fixture.json`, the cross-language proof for the entity
 * pool's swap-remove, its free list and its hashable layout.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE POOL NEEDS ITS OWN FIXTURE
 * ---------------------------------------------------------------------------------------------
 * The pool is where a port stops being arithmetic and starts being STRUCTURE, and structure fails
 * quietly. Reap iterating forwards instead of backwards, a free list that pops in the wrong order,
 * a generation bumped before the slot is released rather than after - each leaves a pool that is
 * perfectly self-consistent, passes any behavioural test you would think to write, and produces a
 * different `hashWorld` on tick one.
 *
 * So this drives the real pool through a scripted sequence of allocations, kills and reaps, and
 * records the pool hash after every step. A port that disagrees is told exactly which step.
 *
 * ---------------------------------------------------------------------------------------------
 * THE VALUES ARE DELIBERATELY NOT REPRESENTABLE IN FLOAT32
 * ---------------------------------------------------------------------------------------------
 * Every position and stat written here comes from `nextRange`, so it is a full-precision double
 * that float32 must round. That matters: a port that typed these columns as `double` - which is
 * the obvious thing to do, since JavaScript numbers ARE doubles - would agree on every integer and
 * diverge on the first fractional coordinate. Storing the rounded value is the behaviour, and this
 * fixture is what makes that non-negotiable.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SCRIPT IS RECORDED, NOT REGENERATED
 * ---------------------------------------------------------------------------------------------
 * Same argument as the run corpus. The operations are chosen here using an Rng, and then written
 * out as a flat list, so the C# side replays a fixed script rather than needing its own copy of
 * the choosing logic. A divergence is then unambiguously in the pool.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Rng, hashToHex } from '../src/core/index.js';
import {
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_DEAD,
  ENEMY_FLAG_ELITE,
  allocEnemy,
  createEnemyPool,
  enemyHandleAt,
  enemyIndex,
  markEnemyDead,
  reapEnemies,
  type EnemyPool,
} from '../src/core/entity/enemyPool.js';
import type { EnemyHandle } from '../src/core/entity/handle.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/pool-fixture.json');

/** Small enough that the free list wraps and slots are genuinely recycled. */
const CAPACITY = 24;

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

function mixBytes(h: number, bytes: Uint8Array, start: number, end: number): number {
  let acc = h;
  for (let i = start; i < end; i++) acc = Math.imul(acc ^ bytes[i], FNV_PRIME);
  return acc;
}

/** Exactly `mixPool` from src/core/hash.ts, which is what hashWorld folds a pool with. */
function hashPool(p: EnemyPool): number {
  let acc = mixU32(FNV_OFFSET, p.count);
  for (const v of p.denseViews) {
    const start = v.byteOffset;
    acc = mixBytes(acc, p.bytes, start, start + p.count * v.BYTES_PER_ELEMENT);
  }
  return acc >>> 0;
}

type Step =
  | { op: 'alloc'; typeId: number; flavourId: number; archetype: number; x: number; y: number; spawnId: number }
  | { op: 'fill'; d: number; hp: number; maxHp: number; radius: number; speed: number; mass: number; xpValue: number; cycleIndex: number; flags: number }
  | { op: 'markDead'; d: number }
  | { op: 'reap' };

const rng = new Rng(0x5ca19a2d);
const pool = createEnemyPool(CAPACITY);

const steps: Step[] = [];
const hashes: string[] = [];
const counts: number[] = [];
const freeCounts: number[] = [];

/** Doubles are stored as bit patterns for the same reason the RNG fixture does it. */
const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64Bits(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}

function record(): void {
  hashes.push(hashToHex(hashPool(pool)));
  counts.push(pool.count);
  freeCounts.push(pool.freeCount);
}

let spawnId = 1;
const live: EnemyHandle[] = [];

function doAlloc(): void {
  const typeId = rng.nextInt(7);
  const flavourId = rng.nextInt(5);
  const archetype = rng.nextInt(5);
  const x = rng.nextRange(-900.5, 900.5);
  const y = rng.nextRange(-900.5, 900.5);
  const id = spawnId++;

  const h = allocEnemy(pool, typeId, flavourId, archetype, x, y, id);
  steps.push({ op: 'alloc', typeId, flavourId, archetype, x, y, spawnId: id });
  record();

  // A FULL POOL RETURNS NULL RATHER THAN OVERWRITING, and the fixture walks into that case on
  // purpose - it is the branch a port is most likely to write as a silent wrap.
  if (h === 0) return;
  live.push(h);

  // Fill the stat columns the way a spawner would, with values float32 has to round.
  const d = enemyIndex(pool, h);
  if (d < 0) return;
  const hp = rng.nextRange(1.5, 400.25);
  const maxHp = hp;
  const radius = rng.nextRange(4.5, 30.75);
  const speed = rng.nextRange(20.5, 180.25);
  const mass = rng.nextRange(0.5, 9.75);
  const xpValue = rng.nextInt(70000); // > 65535 on purpose: Uint16Array wraps, and so must C#
  const cycleIndex = rng.nextInt(12);
  const flags = [0, ENEMY_FLAG_ELITE, ENEMY_FLAG_BOSS][rng.nextInt(3)];

  pool.hp[d] = hp;
  pool.maxHp[d] = maxHp;
  pool.radius[d] = radius;
  pool.speed[d] = speed;
  pool.mass[d] = mass;
  pool.xpValue[d] = xpValue;
  pool.cycleIndex[d] = cycleIndex;
  pool.flags[d] |= flags;

  steps.push({ op: 'fill', d, hp, maxHp, radius, speed, mass, xpValue, cycleIndex, flags });
  record();
}

function doKill(): void {
  if (pool.count === 0) return;
  const d = rng.nextInt(pool.count);
  markEnemyDead(pool, d);
  steps.push({ op: 'markDead', d });
  record();
}

function doReap(): void {
  reapEnemies(pool);
  steps.push({ op: 'reap' });
  record();
}

// The opening state, before anything happens.
record();

// PHASE 1: fill past capacity, so the full-pool branch is exercised.
for (let i = 0; i < CAPACITY + 4; i++) doAlloc();

// PHASE 2: churn. Kills and reaps interleaved with allocations is what recycles slots and bumps
// generations, and it is the only way the free list's LIFO order shows up in the hash.
for (let round = 0; round < 40; round++) {
  const kills = rng.nextInt(4);
  for (let k = 0; k < kills; k++) doKill();
  // Reaping only SOMETIMES is the point: several marks accumulating before one reap is the real
  // tick shape, and it is where a forward-iterating reap goes wrong.
  if (rng.nextInt(3) !== 0) doReap();
  const allocs = rng.nextInt(4);
  for (let a = 0; a < allocs; a++) doAlloc();
}

// PHASE 3: drain it completely, which walks the swap-remove down to an empty pool.
for (let d = pool.count - 1; d >= 0; d--) {
  markEnemyDead(pool, d);
  steps.push({ op: 'markDead', d });
  record();
}
doReap();

// Handle resolution AFTER all that recycling: every handle taken in phase 1 is now either stale
// or has been reissued against a different generation, which is the entire reason handles exist.
const handleChecks = live.map((h) => ({
  handle: (h >>> 0).toString(16).padStart(8, '0'),
  index: enemyIndex(pool, h),
}));

// And a live-handle round trip on a freshly refilled pool, so `handleAt` is covered too.
for (let i = 0; i < 6; i++) doAlloc();
const roundTrip: { d: number; handle: string; index: number }[] = [];
for (let d = 0; d < pool.count; d++) {
  const h = enemyHandleAt(pool, d);
  roundTrip.push({
    d,
    handle: (h >>> 0).toString(16).padStart(8, '0'),
    index: enemyIndex(pool, h),
  });
}

const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for src/core/entity/enemyPool.ts. Doubles are IEEE-754 bits as 16 hex digits, high word first. Replay `steps` in order and compare `hashes[i]` after step i-1; hashes[0] is the empty pool before any step.',
  capacity: CAPACITY,
  flags: { dead: ENEMY_FLAG_DEAD, elite: ENEMY_FLAG_ELITE, boss: ENEMY_FLAG_BOSS },
  steps: steps.map((s) =>
    s.op === 'alloc'
      ? { ...s, x: f64Bits(s.x), y: f64Bits(s.y) }
      : s.op === 'fill'
        ? {
            ...s,
            hp: f64Bits(s.hp),
            maxHp: f64Bits(s.maxHp),
            radius: f64Bits(s.radius),
            speed: f64Bits(s.speed),
            mass: f64Bits(s.mass),
          }
        : s,
  ),
  hashes,
  counts,
  freeCounts,
  handleChecks,
  roundTrip,
  finalHash: hashToHex(hashPool(pool)),
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/pool-fixture.json  (${steps.length} steps, ${hashes.length} hashes, ` +
    `${handleChecks.length} stale-handle checks, final ${fixture.finalHash})`,
);
