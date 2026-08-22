/**
 * `npm run golden:collision` - emit `goldens/collision-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT BREAKS A PORT OF THIS STAGE
 * ---------------------------------------------------------------------------------------------
 * PIERCE ORDER. A shell that can pass through several bodies must take the NEAREST ones, and the
 * tie-break is spawn id. That total order exists precisely so the result cannot depend on the
 * order the spatial hash happened to visit buckets in - so a port that scanned candidates in hash
 * order instead of sorting would agree on every shell that overlaps exactly one body and diverge
 * the first time one overlaps two. The cases below deliberately stack bodies at equal distance.
 *
 * THE CONTACT TIMER IS A FLOAT32 COLUMN. `timer[d] -= dt` in C# rounds twice - once for the
 * subtraction in single precision, once on store - where JavaScript computes in double and rounds
 * once. The cases run the timer down over many ticks so that difference accumulates into
 * something a bit-exact comparison can see.
 *
 * DEAD SHELLS AND DEAD BODIES. A projectile that expired earlier in the tick is still in the pool
 * until the reap and must not land; a dead enemy is still in the spatial hash and must not be hit.
 * Both are one flag check, and both are silently wrong in a port that forgets them.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DT, Simulation, type World } from '../src/core/index.js';
import { MAX_ENEMY_RADIUS } from '../src/core/content/cycles.js';
import { updateCollision } from '../src/core/systems/collision.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { allocEnemy, markEnemyDead } from '../src/core/entity/enemyPool.js';
import {
  PROJECTILE_FLAG_NOCONTACT,
  allocProjectile,
  markProjectileDead,
} from '../src/core/entity/projectilePool.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/collision-fixture.json');

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

interface EnemySpec {
  x: number; y: number; radius: number; contactTimer: number; dead?: boolean; spawnId: number;
}
interface ShellSpec {
  x: number; y: number; radius: number; pierceLeft: number; dead?: boolean; noContact?: boolean;
  alreadyHit?: number[];
}

function build(
  name: string,
  enemies: EnemySpec[],
  shells: ShellSpec[],
  player: { x: number; y: number; radius: number },
  ticks: number,
) {
  const w: World = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;

  // Empty the pools the constructor filled, so only what this case states is present.
  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;
  w.projectiles.count = 0;
  w.projectiles.killCount = 0;
  w.projectiles.freeCount = w.projectiles.capacity;

  enemies.forEach((e, i) => {
    allocEnemy(w.enemies, 0, 0, 0, e.x, e.y, e.spawnId);
    w.enemies.radius[i] = e.radius;
    w.enemies.contactTimer[i] = e.contactTimer;
  });
  enemies.forEach((e, i) => {
    if (e.dead === true) markEnemyDead(w.enemies, i);
  });

  shells.forEach((s, i) => {
    allocProjectile(w.projectiles, s.x, s.y, 0, 0, 5, 0, 0, 1000 + i);
    w.projectiles.radius[i] = s.radius;
    w.projectiles.pierceLeft[i] = s.pierceLeft;
    if (s.noContact === true) w.projectiles.flags[i] |= PROJECTILE_FLAG_NOCONTACT;
    for (const victim of s.alreadyHit ?? []) {
      const base = i * 4;
      w.projectiles.hitRing[base] = victim;
    }
  });
  shells.forEach((s, i) => {
    if (s.dead === true) markProjectileDead(w.projectiles, i);
  });

  w.player.x = player.x;
  w.player.y = player.y;
  w.player.stats.radius = player.radius;

  const perTick: unknown[] = [];
  for (let t = 0; t < ticks; t++) {
    w.hits.count = 0;
    w.contacts.count = 0;
    rebuildSpatialHash(w.spatial, w.enemies);
    updateCollision(w, DT);

    perTick.push({
      hits: Array.from({ length: w.hits.count }, (_, i) => ({
        projectileDense: w.hits.projectileDense[i],
        enemyDense: w.hits.enemyDense[i],
        x: f32(w.hits.x[i]),
        y: f32(w.hits.y[i]),
      })),
      contacts: Array.from({ length: w.contacts.count }, (_, i) => w.contacts.enemyDense[i]),
      // The float32 column after the subtraction, which is where a double-rounding port drifts.
      contactTimers: Array.from({ length: w.enemies.count }, (_, i) => f32(w.enemies.contactTimer[i])),
      hitRings: Array.from({ length: w.projectiles.count }, (_, i) =>
        Array.from(w.projectiles.hitRing.subarray(i * 4, i * 4 + 4)),
      ),
    });
  }

  return {
    name,
    enemies: enemies.map((e) => ({ ...e, x: f64(e.x), y: f64(e.y), radius: f64(e.radius), contactTimer: f64(e.contactTimer), dead: e.dead === true })),
    shells: shells.map((s) => ({ ...s, x: f64(s.x), y: f64(s.y), radius: f64(s.radius), dead: s.dead === true, noContact: s.noContact === true, alreadyHit: s.alreadyHit ?? [] })),
    player: { x: f64(player.x), y: f64(player.y), radius: f64(player.radius) },
    ticks,
    perTick,
  };
}

const cases = [
  // ONE SHELL, ONE BODY. The plain case, so a failure anywhere else is not this.
  build('single-hit',
    [{ x: 10, y: 0, radius: 20, contactTimer: 0, spawnId: 1 }],
    [{ x: 0, y: 0, radius: 8, pierceLeft: 0 }],
    { x: 9999, y: 9999, radius: 26 }, 1),

  // PIERCE THROUGH FOUR, ordered by distance. A port that scanned in hash order instead of
  // sorting picks a different three.
  build('pierce-ordering',
    [
      { x: 40, y: 0, radius: 15, contactTimer: 0, spawnId: 1 },
      { x: 10, y: 0, radius: 15, contactTimer: 0, spawnId: 2 },
      { x: 30, y: 0, radius: 15, contactTimer: 0, spawnId: 3 },
      { x: 20, y: 0, radius: 15, contactTimer: 0, spawnId: 4 },
    ],
    [{ x: 0, y: 0, radius: 60, pierceLeft: 2 }],
    { x: 9999, y: 9999, radius: 26 }, 1),

  // EQUAL DISTANCE, so the SPAWN ID tie-break is the only thing deciding. Four bodies on a circle
  // about the shell, deliberately out of spawn-id order.
  build('tie-break-by-spawn-id',
    [
      { x: 0, y: 30, radius: 12, contactTimer: 0, spawnId: 40 },
      { x: 30, y: 0, radius: 12, contactTimer: 0, spawnId: 10 },
      { x: 0, y: -30, radius: 12, contactTimer: 0, spawnId: 30 },
      { x: -30, y: 0, radius: 12, contactTimer: 0, spawnId: 20 },
    ],
    [{ x: 0, y: 0, radius: 40, pierceLeft: 1 }],
    { x: 9999, y: 9999, radius: 26 }, 1),

  // ALREADY HIT: the hit ring must stop a re-hit on a later tick, which is what stops a piercing
  // shell grinding the same body every tick it overlaps it.
  build('hit-ring-blocks-rehit',
    [
      { x: 10, y: 0, radius: 20, contactTimer: 0, spawnId: 7 },
      { x: 14, y: 0, radius: 20, contactTimer: 0, spawnId: 8 },
    ],
    [{ x: 0, y: 0, radius: 30, pierceLeft: 3, alreadyHit: [7] }],
    { x: 9999, y: 9999, radius: 26 }, 3),

  // DEAD SHELL and DEAD BODY: neither may produce a hit, and both are still in their pools.
  build('dead-are-skipped',
    [
      { x: 10, y: 0, radius: 20, contactTimer: 0, dead: true, spawnId: 1 },
      { x: -10, y: 0, radius: 20, contactTimer: 0, spawnId: 2 },
    ],
    [
      { x: 10, y: 0, radius: 8, pierceLeft: 0, dead: true },
      { x: -10, y: 0, radius: 8, pierceLeft: 0 },
      { x: -10, y: 0, radius: 8, pierceLeft: 0, noContact: true },
    ],
    { x: 9999, y: 9999, radius: 26 }, 1),

  // THE CONTACT CLOCK, over enough ticks that a double-rounding port drifts measurably. Timers are
  // deliberately not multiples of DT so the subtraction lands on awkward values.
  build('contact-timers-run-down',
    [
      { x: 20, y: 0, radius: 20, contactTimer: 0.4375, spawnId: 1 },
      { x: -20, y: 0, radius: 20, contactTimer: 0.1, spawnId: 2 },
      { x: 0, y: 25, radius: 20, contactTimer: 0, spawnId: 3 },
      { x: 900, y: 900, radius: 20, contactTimer: 0.9, spawnId: 4 },
    ],
    [],
    { x: 0, y: 0, radius: 26 }, 40),
];

const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for src/core/systems/collision.ts. Doubles are 16 hex digits, float32 columns are 8 - high word first.',
  dt: f64(DT),
  maxEnemyRadius: f64(MAX_ENEMY_RADIUS),
  shape: (() => {
    const w = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
    return {
      enemyCapacity: w.enemies.capacity,
      projectileCapacity: w.projectiles.capacity,
      pickupCapacity: w.pickups.capacity,
      droneCapacity: w.drones.capacity,
      sheepCapacity: w.sheep.capacity,
      eventRingCapacity: w.events.capacity,
      hitCapacity: w.hits.capacity,
      contactCapacity: w.contacts.capacity,
      maxQueryCandidates: w.scratch.candidates.length,
      cellSize: w.spatial.cellSize,
      bucketCount: w.spatial.bucketCount,
    };
  })(),
  cases,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(`wrote goldens/collision-fixture.json  (${cases.length} cases, MAX_ENEMY_RADIUS ${MAX_ENEMY_RADIUS})`);
