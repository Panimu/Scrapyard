/**
 * `npm run golden:pools` - emit `goldens/pools-fixture.json`, the cross-language proof for the four
 * pools that `pool_fixture.ts` does not cover: projectile, pickup, drone and sheep.
 *
 * Same argument as the enemy pool's fixture, which this deliberately does not replace: the pool is
 * where a port stops being arithmetic and starts being STRUCTURE, and structure fails quietly. It
 * is a separate file because the enemy fixture is committed and passing, and folding it in here
 * would mean re-recording a thing that is already proven in order to add three new ones.
 *
 * THE THREE THINGS THIS COVERS THAT THE ENEMY FIXTURE CANNOT
 * ---------------------------------------------------------
 *  1. THE HIT RING. `capacity * HIT_RING_STRIDE` long, moved by reapProjectiles, and the thing
 *     that decides whether a piercing shell may damage a body it has already hit. It went unhashed
 *     in hashWorld for a long time precisely because its shape does not fit the generic walker, so
 *     it gets its own operations here - record a hit, then reap around it.
 *  2. Int8Array COLUMNS. `pierceLeft` goes negative in normal use, and a port that typed it `byte`
 *     would agree on every positive value.
 *  3. POOLS WITH NO HANDLES. Drones and sheep have no slots, no generations and no free list -
 *     `free(d)` swap-removes immediately rather than marking for a later reap. That is a different
 *     contract, and one a port is likely to "helpfully" unify with the others.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Rng, hashToHex } from '../src/core/index.js';
import {
  HIT_RING_STRIDE,
  PROJECTILE_FLAG_NOCONTACT,
  PROJECTILE_FLAG_PHASE,
  allocProjectile,
  createProjectilePool,
  markProjectileDead,
  projectileIndex,
  projectileRecordHit,
  reapProjectiles,
  type ProjectilePool,
} from '../src/core/entity/projectilePool.js';
import {
  PICKUP_FLAG_AUTO,
  PICKUP_KIND_CHEST,
  PICKUP_KIND_GEM,
  allocPickup,
  createPickupPool,
  markPickupDead,
  pickupIndex,
  reapPickups,
  type PickupPool,
} from '../src/core/entity/pickupPool.js';
import {
  DRONE_STATE_ENGAGE,
  allocDrone,
  createDronePool,
  freeDrone,
  type DronePool,
} from '../src/core/entity/dronePool.js';
import {
  SHEEP_FLEE,
  SHEEP_WALK,
  allocSheep,
  createSheepPool,
  freeSheep,
  type SheepPool,
} from '../src/core/entity/sheepPool.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/pools-fixture.json');

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

/** `mixPool` from src/core/hash.ts, over any of the buffer-backed pools. */
function hashDense(p: ProjectilePool | PickupPool): number {
  let acc = mixU32(FNV_OFFSET, p.count);
  for (const v of p.denseViews) {
    const start = v.byteOffset;
    acc = mixBytes(acc, p.bytes, start, start + p.count * v.BYTES_PER_ELEMENT);
  }
  return acc >>> 0;
}

/** The hit ring, folded the way hashWorld folds it. */
function hashHitRing(p: ProjectilePool): number {
  let acc = FNV_OFFSET;
  const n = p.count * HIT_RING_STRIDE;
  for (let i = 0; i < n; i++) acc = mixU32(acc, p.hitRing[i]);
  for (let i = 0; i < p.count; i++) acc = Math.imul(acc ^ p.hitRingPos[i], FNV_PRIME);
  return acc >>> 0;
}

const scratchF32 = new Float32Array(1);
const scratchF32Bits = new Uint32Array(scratchF32.buffer);
function mixF32(h: number, v: number): number {
  scratchF32[0] = v;
  return mixU32(h, scratchF32Bits[0]);
}

function hashDrones(p: DronePool): number {
  let acc = mixU32(FNV_OFFSET, p.count);
  for (let i = 0; i < p.count; i++) acc = mixF32(acc, p.x[i]);
  for (let i = 0; i < p.count; i++) acc = mixF32(acc, p.y[i]);
  for (let i = 0; i < p.count; i++) acc = mixF32(acc, p.angle[i]);
  for (let i = 0; i < p.count; i++) acc = Math.imul(acc ^ p.state[i], FNV_PRIME);
  for (let i = 0; i < p.count; i++) acc = mixU32(acc, p.targetDense[i]);
  for (let i = 0; i < p.count; i++) acc = mixU32(acc, p.ammo[i]);
  for (let i = 0; i < p.count; i++) acc = mixF32(acc, p.cooldownLeft[i]);
  for (let i = 0; i < p.count; i++) acc = Math.imul(acc ^ p.weaponSlot[i], FNV_PRIME);
  for (let i = 0; i < p.count; i++) acc = Math.imul(acc ^ (p.spin[i] & 0xff), FNV_PRIME);
  return acc >>> 0;
}

function hashSheep(p: SheepPool): number {
  let acc = mixU32(FNV_OFFSET, p.count);
  for (let i = 0; i < p.count; i++) acc = mixF32(acc, p.x[i]);
  for (let i = 0; i < p.count; i++) acc = mixF32(acc, p.y[i]);
  for (let i = 0; i < p.count; i++) acc = mixF32(acc, p.dirX[i]);
  for (let i = 0; i < p.count; i++) acc = mixF32(acc, p.dirY[i]);
  for (let i = 0; i < p.count; i++) acc = Math.imul(acc ^ p.state[i], FNV_PRIME);
  for (let i = 0; i < p.count; i++) acc = mixF32(acc, p.timer[i]);
  for (let i = 0; i < p.count; i++) acc = mixU32(acc, p.spawnId[i]);
  return acc >>> 0;
}

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64Bits(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}

const rng = new Rng(0x1d0c8a77);
type Step = Record<string, unknown> & { op: string };

// ---------------------------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------------------------

const PROJ_CAP = 20;
const proj = createProjectilePool(PROJ_CAP);
const projSteps: Step[] = [];
const projDense: string[] = [];
const projRing: string[] = [];
const projCounts: number[] = [];
const projFree: number[] = [];

function projRecord(): void {
  projDense.push(hashToHex(hashDense(proj)));
  projRing.push(hashToHex(hashHitRing(proj)));
  projCounts.push(proj.count);
  projFree.push(proj.freeCount);
}

let projSpawn = 1;
projRecord();

for (let round = 0; round < 60; round++) {
  const allocs = rng.nextInt(4);
  for (let a = 0; a < allocs; a++) {
    const x = rng.nextRange(-800.5, 800.5);
    const y = rng.nextRange(-800.5, 800.5);
    const vx = rng.nextRange(-420.5, 420.5);
    const vy = rng.nextRange(-420.5, 420.5);
    const life = rng.nextRange(0.15, 2.75);
    const owner = rng.nextInt(8);
    const behaviour = rng.nextInt(6);
    const id = projSpawn++;
    const h = allocProjectile(proj, x, y, vx, vy, life, owner, behaviour, id);
    projSteps.push({
      op: 'alloc',
      x: f64Bits(x), y: f64Bits(y), vx: f64Bits(vx), vy: f64Bits(vy),
      lifeSec: f64Bits(life), ownerWeapon: owner, behaviour, spawnId: id,
    });
    projRecord();

    if (h === 0) continue;
    const d = projectileIndex(proj, h);
    if (d < 0) continue;

    // pierceLeft goes NEGATIVE in normal use - an Int8Array column, and the reason a port that
    // typed it `byte` would agree on every positive value and diverge here.
    const pierce = rng.nextInt(9) - 4;
    const damage = rng.nextRange(1.5, 260.25);
    const knockback = rng.nextRange(0, 900.5);
    const splashR = rng.nextRange(0, 120.25);
    const splashF = rng.nextRange(0, 1);
    const flags = [0, PROJECTILE_FLAG_NOCONTACT, PROJECTILE_FLAG_PHASE][rng.nextInt(3)];
    proj.pierceLeft[d] = pierce;
    proj.damage[d] = damage;
    proj.knockback[d] = knockback;
    proj.splashRadius[d] = splashR;
    proj.splashFrac[d] = splashF;
    proj.flags[d] |= flags;
    proj.travelled[d] = rng.nextRange(0, 400.5);
    projSteps.push({
      op: 'fill', d, pierceLeft: pierce,
      damage: f64Bits(damage), knockback: f64Bits(knockback),
      splashRadius: f64Bits(splashR), splashFrac: f64Bits(splashF),
      travelled: f64Bits(proj.travelled[d]), flags,
    });
    projRecord();
  }

  // THE HIT RING. More hits than the stride, so it wraps and `hitRingPos` cycles - the case a
  // port implementing it as a growing list would pass and a port with the wrong modulus would not.
  const hits = rng.nextInt(6);
  for (let k = 0; k < hits && proj.count > 0; k++) {
    const d = rng.nextInt(proj.count);
    const victim = 1 + rng.nextInt(400);
    projectileRecordHit(proj, d, victim);
    projSteps.push({ op: 'hit', d, enemySpawnId: victim });
    projRecord();
  }

  const kills = rng.nextInt(4);
  for (let k = 0; k < kills && proj.count > 0; k++) {
    const d = rng.nextInt(proj.count);
    markProjectileDead(proj, d);
    projSteps.push({ op: 'markDead', d });
    projRecord();
  }
  if (rng.nextInt(3) !== 0) {
    reapProjectiles(proj);
    projSteps.push({ op: 'reap' });
    projRecord();
  }
}

// ---------------------------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------------------------

const PICK_CAP = 16;
const pick = createPickupPool(PICK_CAP);
const pickSteps: Step[] = [];
const pickHashes: string[] = [];
const pickCounts: number[] = [];
const pickFree: number[] = [];

function pickRecord(): void {
  pickHashes.push(hashToHex(hashDense(pick)));
  pickCounts.push(pick.count);
  pickFree.push(pick.freeCount);
}

let pickSpawn = 1;
pickRecord();

for (let round = 0; round < 50; round++) {
  const allocs = rng.nextInt(4);
  for (let a = 0; a < allocs; a++) {
    const kind = rng.nextInt(6);
    const value = rng.nextInt(70000); // wraps a Uint16Array, as it must in C#
    const tier = rng.nextInt(8);
    const x = rng.nextRange(-700.5, 700.5);
    const y = rng.nextRange(-700.5, 700.5);
    const id = pickSpawn++;
    const h = allocPickup(pick, kind, value, tier, x, y, id);
    pickSteps.push({ op: 'alloc', kind, value, tier, x: f64Bits(x), y: f64Bits(y), spawnId: id });
    pickRecord();

    if (h === 0) continue;
    const d = pickupIndex(pick, h);
    if (d < 0) continue;
    const vx = rng.nextRange(-200.5, 200.5);
    const vy = rng.nextRange(-200.5, 200.5);
    const flags = rng.nextInt(2) === 0 ? 0 : PICKUP_FLAG_AUTO;
    pick.vx[d] = vx;
    pick.vy[d] = vy;
    pick.flags[d] |= flags;
    pickSteps.push({ op: 'fill', d, vx: f64Bits(vx), vy: f64Bits(vy), flags });
    pickRecord();
  }

  const kills = rng.nextInt(3);
  for (let k = 0; k < kills && pick.count > 0; k++) {
    const d = rng.nextInt(pick.count);
    markPickupDead(pick, d);
    pickSteps.push({ op: 'markDead', d });
    pickRecord();
  }
  if (rng.nextInt(3) !== 0) {
    reapPickups(pick);
    pickSteps.push({ op: 'reap' });
    pickRecord();
  }
}

// ---------------------------------------------------------------------------------------------
// Drones and sheep - no handles, and `free(d)` removes IMMEDIATELY rather than marking
// ---------------------------------------------------------------------------------------------

const drone = createDronePool();
const droneSteps: Step[] = [];
const droneHashes: string[] = [];
const droneCounts: number[] = [];

droneHashes.push(hashToHex(hashDrones(drone)));
droneCounts.push(drone.count);

for (let round = 0; round < 60; round++) {
  if (rng.nextInt(2) === 0 || drone.count === 0) {
    const x = rng.nextRange(-300.5, 300.5);
    const y = rng.nextRange(-300.5, 300.5);
    const angle = rng.nextRange(-3.25, 3.25);
    const ammo = rng.nextInt(40);
    const slot = rng.nextInt(8);
    const spin = rng.nextInt(2) === 0 ? 1 : -1;
    allocDrone(drone, x, y, angle, ammo, slot, spin);
    droneSteps.push({
      op: 'alloc', x: f64Bits(x), y: f64Bits(y), angle: f64Bits(angle), ammo, weaponSlot: slot, spin,
    });
  } else if (rng.nextInt(3) === 0) {
    const d = rng.nextInt(drone.count);
    const target = rng.nextInt(200) - 1;
    const cd = rng.nextRange(0, 1.75);
    drone.state[d] = DRONE_STATE_ENGAGE;
    drone.targetDense[d] = target;
    drone.cooldownLeft[d] = cd;
    drone.ammo[d] = drone.ammo[d] - 1;
    droneSteps.push({ op: 'engage', d, targetDense: target, cooldownLeft: f64Bits(cd) });
  } else {
    const d = rng.nextInt(drone.count);
    freeDrone(drone, d);
    droneSteps.push({ op: 'free', d });
  }
  droneHashes.push(hashToHex(hashDrones(drone)));
  droneCounts.push(drone.count);
}

const sheep = createSheepPool();
const sheepSteps: Step[] = [];
const sheepHashes: string[] = [];
const sheepCounts: number[] = [];

sheepHashes.push(hashToHex(hashSheep(sheep)));
sheepCounts.push(sheep.count);

let sheepSpawn = 1;
for (let round = 0; round < 80; round++) {
  if (rng.nextInt(2) === 0 || sheep.count === 0) {
    const x = rng.nextRange(-1200.5, 1200.5);
    const y = rng.nextRange(-1200.5, 1200.5);
    const id = sheepSpawn++;
    allocSheep(sheep, x, y, id);
    sheepSteps.push({ op: 'alloc', x: f64Bits(x), y: f64Bits(y), spawnId: id });
  } else if (rng.nextInt(3) === 0) {
    const d = rng.nextInt(sheep.count);
    const dx = rng.nextRange(-1, 1);
    const dy = rng.nextRange(-1, 1);
    const timer = rng.nextRange(0, 4.75);
    sheep.dirX[d] = dx;
    sheep.dirY[d] = dy;
    sheep.state[d] = rng.nextInt(2) === 0 ? SHEEP_WALK : SHEEP_FLEE;
    sheep.timer[d] = timer;
    sheepSteps.push({
      op: 'move', d, dirX: f64Bits(dx), dirY: f64Bits(dy), state: sheep.state[d], timer: f64Bits(timer),
    });
  } else {
    const d = rng.nextInt(sheep.count);
    freeSheep(sheep, d);
    sheepSteps.push({ op: 'free', d });
  }
  sheepHashes.push(hashToHex(hashSheep(sheep)));
  sheepCounts.push(sheep.count);
}

const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for the projectile, pickup, drone and sheep pools. Doubles are IEEE-754 bits as 16 hex digits, high word first. Replay each pool\'s `steps` in order; `hashes[0]` is the empty pool before any step.',
  hitRingStride: HIT_RING_STRIDE,
  kinds: { gem: PICKUP_KIND_GEM, chest: PICKUP_KIND_CHEST },
  projectiles: {
    capacity: PROJ_CAP,
    steps: projSteps,
    dense: projDense,
    hitRing: projRing,
    counts: projCounts,
    freeCounts: projFree,
  },
  pickups: {
    capacity: PICK_CAP,
    steps: pickSteps,
    hashes: pickHashes,
    counts: pickCounts,
    freeCounts: pickFree,
  },
  drones: { capacity: drone.capacity, steps: droneSteps, hashes: droneHashes, counts: droneCounts },
  sheep: { capacity: sheep.capacity, steps: sheepSteps, hashes: sheepHashes, counts: sheepCounts },
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/pools-fixture.json  ` +
    `projectiles ${projSteps.length} steps, pickups ${pickSteps.length}, ` +
    `drones ${droneSteps.length}, sheep ${sheepSteps.length}`,
);
