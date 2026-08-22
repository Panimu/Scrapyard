/**
 * `npm run golden:enemyai` - emit `goldens/enemyai-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS ONE IS DRIVEN, NOT POSED
 * ---------------------------------------------------------------------------------------------
 * Every fixture before this set a world into a stated position and called one function. That works
 * because those systems answer a question. This one does not answer anything - it MOVES A CROWD,
 * and the interesting behaviour is entirely in how the four passes interact over time: a body
 * separates into a wall, the wall slides it along, the slide puts it somewhere the flow field has
 * a different opinion about, and thirty ticks later it is round the corner.
 *
 * So the cases place a crowd and step the stage repeatedly, dumping every enemy's position and
 * velocity after every tick. Posed single calls would miss precisely the emergent part.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE CROWDS ARE FOR
 * ---------------------------------------------------------------------------------------------
 * EXACTLY COINCIDENT BODIES. Two enemies at identical coordinates have no direction to push apart
 * in, so the tie breaks on spawn id - and only on `ax`, which looks like a bug and is not. One
 * case stacks four bodies on one point.
 *
 * A WALL TO SLIDE ALONG. The seek pass has three nested fallbacks (flow field, tangent, second
 * tangent, normal) and the deeper ones only fire when a body is wedged between two piles. The
 * crowds are placed against real generated terrain rather than in open ground.
 *
 * THE RELOCATE RING. A body dragged past its flavour's allowance is picked up and re-placed, which
 * DRAWS FROM THE SPAWN STREAM - so a port that relocates a different set of bodies desynchronises
 * every future spawn, not just the strays. One case parks the player and puts bodies far out.
 *
 * CHARGES AND FIXATIONS, which are the two ways a body ignores the player entirely.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DT, Simulation, type World } from '../src/core/index.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { ARENA_HALF } from '../src/core/constants.js';
import { createScenery, type ScrapPiles } from '../src/core/content/scenery.js';
import { updateEnemyAI } from '../src/core/systems/enemyAI.js';
import { createFlowField, updateFlowField } from '../src/core/spatial/flowField.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/enemyai-fixture.json');

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
function u32(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}

interface Body {
  x: number; y: number; radius: number; speed: number; mass: number;
  flavourId: number; archetype: number; flags: number;
  pushX?: number; pushY?: number;
  chargeX?: number; chargeY?: number; chargeLeft?: number;
  fixateX?: number; fixateY?: number; fixateLeft?: number;
}

function buildCase(
  name: string,
  seed: number,
  player: { x: number; y: number },
  bodies: Body[],
  ticks: number,
) {
  const w: World = new Simulation({ seed, heroId: 0, levelId: 'scrapyard' }).world;
  const scenery = createScenery(seed) as ScrapPiles;
  (w as { scenery: ScrapPiles }).scenery = scenery;
  (w as { flow: ReturnType<typeof createFlowField> }).flow = createFlowField();
  (w as { arenaHalf: number }).arenaHalf = ARENA_HALF;

  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;

  w.player.x = player.x;
  w.player.y = player.y;
  w.player.vx = 0;
  w.player.vy = 0;

  bodies.forEach((b, i) => {
    allocEnemy(w.enemies, 0, b.flavourId, b.archetype, b.x, b.y, i + 1);
    w.enemies.radius[i] = b.radius;
    w.enemies.speed[i] = b.speed;
    w.enemies.mass[i] = b.mass;
    w.enemies.flags[i] = b.flags;
    w.enemies.pushX[i] = b.pushX ?? 0;
    w.enemies.pushY[i] = b.pushY ?? 0;
    w.enemies.chargeX[i] = b.chargeX ?? 0;
    w.enemies.chargeY[i] = b.chargeY ?? 0;
    w.enemies.chargeLeft[i] = b.chargeLeft ?? 0;
    w.enemies.fixateX[i] = b.fixateX ?? 0;
    w.enemies.fixateY[i] = b.fixateY ?? 0;
    w.enemies.fixateLeft[i] = b.fixateLeft ?? 0;
  });

  const perTick: unknown[] = [];
  for (let t = 0; t < ticks; t++) {
    w.tick = 100 + t;
    updateFlowField(w);
    rebuildSpatialHash(w.spatial, w.enemies);
    updateEnemyAI(w, DT);

    const n = w.enemies.count;
    perTick.push({
      x: Array.from({ length: n }, (_, i) => f32(w.enemies.x[i])),
      y: Array.from({ length: n }, (_, i) => f32(w.enemies.y[i])),
      vx: Array.from({ length: n }, (_, i) => f32(w.enemies.vx[i])),
      vy: Array.from({ length: n }, (_, i) => f32(w.enemies.vy[i])),
      pushX: Array.from({ length: n }, (_, i) => f32(w.enemies.pushX[i])),
      pushY: Array.from({ length: n }, (_, i) => f32(w.enemies.pushY[i])),
      speed: Array.from({ length: n }, (_, i) => f32(w.enemies.speed[i])),
      chargeLeft: Array.from({ length: n }, (_, i) => f32(w.enemies.chargeLeft[i])),
      fixateLeft: Array.from({ length: n }, (_, i) => f32(w.enemies.fixateLeft[i])),
      // THE SPAWN STREAM, because relocation draws from it. A port that relocates a different set
      // of bodies desynchronises every future spawn, not just the strays.
      rng: (() => {
        const s = { a: 0, b: 0, c: 0, d: 0 };
        w.rng.spawn.save(s);
        return [u32(s.a), u32(s.b), u32(s.c), u32(s.d)];
      })(),
    });
  }

  return {
    name, seed, player: { x: f64(player.x), y: f64(player.y) },
    bodies: bodies.map((b) => ({
      x: f64(b.x), y: f64(b.y), radius: f64(b.radius), speed: f64(b.speed), mass: f64(b.mass),
      flavourId: b.flavourId, archetype: b.archetype, flags: b.flags,
      pushX: f64(b.pushX ?? 0), pushY: f64(b.pushY ?? 0),
      chargeX: f64(b.chargeX ?? 0), chargeY: f64(b.chargeY ?? 0), chargeLeft: f64(b.chargeLeft ?? 0),
      fixateX: f64(b.fixateX ?? 0), fixateY: f64(b.fixateY ?? 0), fixateLeft: f64(b.fixateLeft ?? 0),
    })),
    ticks,
    perTick,
  };
}

const ring = (n: number, r: number, cx = 0, cy = 0): Body[] =>
  Array.from({ length: n }, (_, i) => {
    // Placed by rejection-free polar arithmetic on the FIXTURE side only - this is test data, not
    // simulation, so it may use whatever maths it likes.
    const a = (i / n) * Math.PI * 2;
    return {
      x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
      radius: 13 + (i % 3) * 6, speed: 60 + (i % 5) * 9, mass: 1 + (i % 4) * 0.5,
      flavourId: i % 4, archetype: i % 3, flags: 0,
    };
  });

const cases = [
  // A crowd converging on a standing player, through real terrain. Long enough for the seek and
  // separate passes to fight each other into a stable ring.
  buildCase('converging-crowd', 0x5ca19a2d, { x: 0, y: 0 }, ring(24, 400), 60),

  // EXACTLY COINCIDENT. Four bodies on one point: no direction to push in, tie broken on spawn id,
  // and only on ax.
  buildCase('coincident', 0x5ca19a2d, { x: 300, y: 0 }, [
    { x: 0, y: 0, radius: 18, speed: 70, mass: 1, flavourId: 0, archetype: 1, flags: 0 },
    { x: 0, y: 0, radius: 18, speed: 70, mass: 1, flavourId: 0, archetype: 1, flags: 0 },
    { x: 0, y: 0, radius: 18, speed: 70, mass: 1, flavourId: 0, archetype: 1, flags: 0 },
    { x: 0, y: 0, radius: 18, speed: 70, mass: 1, flavourId: 0, archetype: 1, flags: 0 },
  ], 20),

  // CHARGES: bodies committed to a heading, which expire at different ticks and pay half their
  // speed when they do.
  buildCase('charges-expiring', 0x5ca19a2d, { x: 0, y: 0 }, [
    { x: -500, y: 0, radius: 18, speed: 120, mass: 1, flavourId: 5, archetype: 1, flags: 0, chargeX: 1, chargeY: 0, chargeLeft: 0.05 },
    { x: -500, y: 90, radius: 18, speed: 120, mass: 1, flavourId: 5, archetype: 1, flags: 0, chargeX: 1, chargeY: 0, chargeLeft: 0.2 },
    { x: -500, y: -90, radius: 18, speed: 120, mass: 1, flavourId: 5, archetype: 1, flags: 0, chargeX: 0.6, chargeY: 0.8, chargeLeft: 0.5 },
  ], 45),

  // FIXATIONS: Heavies walking at a point rather than the player, one of which ARRIVES and must
  // stop dead rather than orbiting.
  buildCase('fixations', 0x5ca19a2d, { x: 900, y: 900 }, [
    { x: 100, y: 0, radius: 34, speed: 20, mass: 4, flavourId: 4, archetype: 3, flags: 0, fixateX: 0, fixateY: 0, fixateLeft: 5 },
    { x: 300, y: 40, radius: 34, speed: 20, mass: 4, flavourId: 4, archetype: 3, flags: 0, fixateX: 0, fixateY: 0, fixateLeft: 0.1 },
  ], 40),

  // KNOCKBACK decaying to the epsilon snap, which is where the push columns stop changing.
  buildCase('knockback-decay', 0x5ca19a2d, { x: 0, y: 0 }, [
    { x: 200, y: 0, radius: 18, speed: 60, mass: 1, flavourId: 0, archetype: 1, flags: 0, pushX: -600, pushY: 220 },
    { x: 240, y: 60, radius: 18, speed: 60, mass: 2, flavourId: 0, archetype: 1, flags: 0, pushX: 400, pushY: -400 },
  ], 40),

  // RELOCATION: bodies dragged well past their allowance, including a Heavy (4x) that must NOT
  // relocate at the same distance a plain body does, and a boss that must never relocate at all.
  buildCase('relocate', 0x1d0c8a77, { x: 0, y: 0 }, [
    { x: 2500, y: 0, radius: 18, speed: 60, mass: 1, flavourId: 0, archetype: 1, flags: 0 },
    { x: 2500, y: 200, radius: 34, speed: 20, mass: 4, flavourId: 4, archetype: 3, flags: 0 },
    { x: 2500, y: 400, radius: 56, speed: 40, mass: 8, flavourId: 0, archetype: 4, flags: 4 },
    { x: 5000, y: 0, radius: 34, speed: 20, mass: 4, flavourId: 4, archetype: 3, flags: 0 },
  ], 6),

  // A dense knot against terrain in the negative quadrant, where the tangent fallbacks fire.
  buildCase('wedged', 0x1d0c8a77, { x: -1800, y: -1400 }, ring(16, 120, -1500, -1200), 45),
];

const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for src/core/systems/enemyAI.ts. Doubles are 16 hex digits, float32 columns 8 - high word first.',
  dt: f64(DT),
  arenaSize: 12288,
  tuning: {
    separationStrength: f64(DEFAULT_TUNING.steering.separationStrength),
    separationMaxNeighbours: DEFAULT_TUNING.steering.separationMaxNeighbours,
    separationPadding: f64(DEFAULT_TUNING.steering.separationPadding),
    pushDamping: f64(DEFAULT_TUNING.steering.pushDamping),
    pushEpsilon: f64(DEFAULT_TUNING.steering.pushEpsilon),
  },
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

console.log(
  `wrote goldens/enemyai-fixture.json  (${cases.length} cases, ` +
    `${cases.reduce((a, c) => a + c.ticks, 0)} ticks total)`,
);
