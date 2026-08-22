/**
 * `npm run golden:playermove` - emit `goldens/player-movement-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * DRIVEN, AND THE WHOLE POINT IS THE CURVE
 * ---------------------------------------------------------------------------------------------
 * This system is an integrator. A single call says nothing: what matters is that the mech
 * APPROACHES its top speed and never exceeds it, that a reversal takes about half a second, that a
 * released stick decays geometrically rather than snapping, and that a diagonal tops out at exactly
 * the same speed as an axis run. Every case below drives a stated stick for hundreds of ticks and
 * records the position, velocity and facing every one of them.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT EACH CASE IS FOR
 * ---------------------------------------------------------------------------------------------
 *   THE RAMP: full stick from rest, long enough to reach the float fixed point. The recorded
 *     velocity must approach the top speed from BELOW and never cross it - that is an exact
 *     property of the iteration, not a tolerance, and a port that authored drag independently
 *     rather than deriving it would sail past.
 *   THE DIAGONAL: the same, on a corner input. The stick is clamped to unit LENGTH, so this must
 *     reach the identical top speed - without the clamp it would be 1.41x faster and the whole
 *     tuning table would be a lie.
 *   THE REVERSAL and THE RELEASE: committing to a direction is a real commitment, and a released
 *     stick coasts about a mech length.
 *   THE FENCE: position clamped AND the velocity into the wire dropped, with the other axis
 *     untouched so a diagonal run converts into running ALONG the fence rather than stopping.
 *   SCENERY: the same rule generalised to an arbitrary normal - slide out, drop only the component
 *     going in, keep the tangent.
 *   THE SHOVE: walking into a drum takes it (movement as a loot decision), and walking into a Mossy
 *     clump spends its hit-point pool at the chassis' own rate.
 *   REGEN, REPAIR and the SHIELD: three clocks with three different rules, including the two that
 *     are most easily got wrong - a repair clock that must START FULL rather than pay out on the
 *     tick the card is taken, and a shield timer that restarts immediately while a rim is missing.
 *   THE ROUND TRIP: under a fifth of the hull and all the way back, which is the unlock condition
 *     and a LATCH rather than a tally.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DT, Simulation, type World } from '../src/core/index.js';
import { ARENA_HALF } from '../src/core/constants.js';
import { type ScrapPiles } from '../src/core/content/scenery.js';
import { quantiseAxis } from '../src/core/types.js';
import { updatePlayerMovement } from '../src/core/systems/playerMovement.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/player-movement-fixture.json');

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

interface StatOverrides {
  maxHp?: number;
  hpRegen?: number;
  repairAmount?: number;
  repairInterval?: number;
  shieldLayers?: number;
  shieldRecharge?: number;
}

interface CaseSpec {
  name: string;
  level?: 'scrapyard' | 'mossy-mayhem';
  withScenery?: boolean;
  start: { x: number; y: number; vx?: number; vy?: number; hp?: number };
  /** The stick, as the raw floats the layer boundary quantises. Changed at stated ticks. */
  stick: Array<{ at: number; x: number; y: number }>;
  stats?: StatOverrides;
  /** Posed shield/repair state, for the clock cases. */
  shieldLayers?: number;
  invulnLeft?: number;
  ticks: number;
}

function buildCase(spec: CaseSpec) {
  const levelId = spec.level ?? 'scrapyard';
  const w: World = new Simulation({ seed: 0x5ca19a2d, heroId: 0, levelId }).world;

  if (spec.withScenery !== true && levelId === 'scrapyard') {
    const piles = w.scenery as ScrapPiles;
    piles.radius.fill(0);
    piles.count = 0;
  }

  const p = w.player;
  p.x = spec.start.x;
  p.y = spec.start.y;
  p.vx = spec.start.vx ?? 0;
  p.vy = spec.start.vy ?? 0;
  p.faceX = 1;
  p.faceY = 0;
  p.shieldLayers = spec.shieldLayers ?? 0;
  p.shieldTimer = 0;
  p.invulnLeft = spec.invulnLeft ?? 0;
  p.repairLeft = 0;
  p.criticalArmed = 0;

  const o = spec.stats ?? {};
  if (o.maxHp !== undefined) p.stats.maxHp = o.maxHp;
  if (o.hpRegen !== undefined) p.stats.hpRegen = o.hpRegen;
  if (o.repairAmount !== undefined) p.stats.repairAmount = o.repairAmount;
  if (o.repairInterval !== undefined) p.stats.repairInterval = o.repairInterval;
  if (o.shieldLayers !== undefined) p.stats.shieldLayers = o.shieldLayers;
  if (o.shieldRecharge !== undefined) p.stats.shieldRecharge = o.shieldRecharge;
  p.hp = spec.start.hp ?? p.stats.maxHp;

  const perTick: unknown[] = [];
  let stickIdx = 0;
  let sx = 0;
  let sy = 0;

  for (let t = 0; t < spec.ticks; t++) {
    while (stickIdx < spec.stick.length && spec.stick[stickIdx].at === t) {
      sx = spec.stick[stickIdx].x;
      sy = spec.stick[stickIdx].y;
      stickIdx++;
    }
    // THROUGH THE QUANTISER, exactly as a recorded input stream is: the stage decodes an int8, so
    // a fixture handing it raw floats would be testing a path no run ever takes.
    w.input.moveX = quantiseAxis(sx);
    w.input.moveY = quantiseAxis(sy);
    w.tick = 700 + t;

    const eventsBefore = w.events.writeCursor;
    updatePlayerMovement(w, DT);

    const events: unknown[] = [];
    for (let c = eventsBefore; c < w.events.writeCursor; c++) {
      const i = c & w.events.mask;
      events.push({
        kind: w.events.kind[i],
        a: f32(w.events.a[i]), b: f32(w.events.b[i]),
        c: f32(w.events.c[i]), d: f32(w.events.d[i]),
      });
    }

    perTick.push({
      // Packed: five doubles for the body, then the clocks. See the weapons fixture for why the
      // per-tick rows in this port are strings rather than objects.
      body: f64(p.x) + f64(p.y) + f64(p.vx) + f64(p.vy) + f64(p.faceX) + f64(p.faceY),
      clocks: f64(p.hp) + f64(p.repairLeft) + f64(p.shieldTimer) + f64(p.invulnLeft),
      ints: `${p.shieldLayers},${p.criticalArmed}`,
      fullRepairs: f64(w.stats.fullRepairs),
      barrelsBroken: f64(w.stats.barrelsBroken),
      events,
    });
  }

  return {
    name: spec.name,
    level: levelId,
    withScenery: spec.withScenery === true,
    start: {
      x: f64(spec.start.x), y: f64(spec.start.y),
      vx: f64(spec.start.vx ?? 0), vy: f64(spec.start.vy ?? 0),
      hp: f64(spec.start.hp ?? -1),
    },
    stick: spec.stick.map((s) => ({ at: s.at, x: f64(s.x), y: f64(s.y) })),
    stats: {
      maxHp: f64(o.maxHp ?? -1), hpRegen: f64(o.hpRegen ?? -1),
      repairAmount: f64(o.repairAmount ?? -1), repairInterval: f64(o.repairInterval ?? -1),
      shieldLayers: f64(o.shieldLayers ?? -1), shieldRecharge: f64(o.shieldRecharge ?? -1),
    },
    shieldLayers: spec.shieldLayers ?? 0,
    invulnLeft: f64(spec.invulnLeft ?? 0),
    // The resolved stats as the case actually ran with them, so the C# side reproduces the same
    // chassis rather than trusting its own resolution to land identically.
    resolved: {
      moveAccel: f64(p.stats.moveAccel), moveMaxSpeed: f64(p.stats.moveMaxSpeed),
      moveDrag: f64(p.stats.moveDrag), radius: f64(p.stats.radius),
      maxHp: f64(p.stats.maxHp), hpRegen: f64(p.stats.hpRegen),
      repairAmount: f64(p.stats.repairAmount), repairInterval: f64(p.stats.repairInterval),
      shieldLayers: f64(p.stats.shieldLayers), shieldRecharge: f64(p.stats.shieldRecharge),
    },
    ticks: spec.ticks,
    perTick,
  };
}

const cases = [
  // THE RAMP. Full stick from rest for long enough to reach the float fixed point, then held: the
  // velocity approaches the top speed from below and can never cross it.
  buildCase({
    name: 'ramp-to-top-speed',
    start: { x: 0, y: 0 },
    stick: [{ at: 0, x: 1, y: 0 }],
    ticks: 700,
  }),

  // THE DIAGONAL. Clamped to unit LENGTH, so this reaches the IDENTICAL top speed - the C# side
  // asserts that directly against the ramp above.
  buildCase({
    name: 'diagonal-is-not-faster',
    start: { x: 0, y: 0 },
    stick: [{ at: 0, x: 1, y: 1 }],
    ticks: 700,
  }),

  // THE REVERSAL: run right, then hard left. About half a second to fully turn round, with a
  // visible overshoot in between.
  buildCase({
    name: 'reversal-takes-time',
    start: { x: 0, y: 0 },
    stick: [{ at: 0, x: 1, y: 0 }, { at: 120, x: -1, y: 0 }],
    ticks: 300,
  }),

  // THE RELEASE: coast, and NOT snapped to zero at any epsilon.
  buildCase({
    name: 'release-coasts',
    start: { x: 0, y: 0 },
    stick: [{ at: 0, x: 1, y: 0 }, { at: 120, x: 0, y: 0 }],
    ticks: 400,
  }),

  // THE FENCE, hit diagonally. The x clamp fires and the x velocity is dropped; the y component
  // survives, so the run converts into running ALONG the wire.
  buildCase({
    name: 'fence-slides',
    start: { x: ARENA_HALF - 120, y: 0 },
    stick: [{ at: 0, x: 1, y: 0.6 }],
    ticks: 300,
  }),

  // A CORNER, so both axes clamp - the case a bounce or a reflection would get visibly wrong.
  buildCase({
    name: 'fence-corner',
    start: { x: ARENA_HALF - 120, y: ARENA_HALF - 120 },
    stick: [{ at: 0, x: 1, y: 1 }],
    ticks: 300,
  }),

  // SCENERY: a real yard, run across at an angle. The push-out slides the mech round the piles it
  // meets rather than stopping it in front of them, and any drum it touches goes over.
  // AIMED AT A DRUM, not walked hopefully across the map. The first draft started at (-1200,-600)
  // and ran diagonally for 700 ticks without touching a single barrel, so the case proved the
  // push-out worked and nothing about the shove at all. This heading crosses the two nearest drums
  // on this seed - (454, 371) and (959, 264) - so both go over, and the piles between them still
  // exercise the slide.
  buildCase({
    name: 'walks-through-the-yard',
    withScenery: true,
    start: { x: 0, y: 0 },
    stick: [{ at: 0, x: 0.774, y: 0.633 }, { at: 240, x: 1, y: -0.2 }],
    ticks: 700,
  }),

  // STRAIGHT INTO A WRECK, which the drum walk above does not do. Aimed at the nearest solid pile
  // on this seed - 67 units of radius at (-944, -470) - so the push-out actually fires and the
  // slide can be watched: the mech meets the pile head-on, the component going in is dropped, the
  // tangent survives and it comes round the side rather than stopping dead in front of it.
  //
  // The first draft of the yard case ran diagonally across the map hoping to meet something and
  // met nothing at all: it broke no drum, never triggered a push, and held top speed for the whole
  // seven hundred ticks while looking like a case about terrain.
  buildCase({
    name: 'slides-around-a-wreck',
    withScenery: true,
    start: { x: 0, y: 0 },
    stick: [{ at: 0, x: -0.8954, y: -0.4453 }],
    ticks: 700,
  }),

  // THE MECH SHOVES A TREE. Mossy terrain, walked into: the clump's pool is spent at the chassis'
  // own rate and the stems come down one at a time rather than the wall dissolving.
  buildCase({
    name: 'shoves-through-woodland',
    level: 'mossy-mayhem',
    withScenery: true,
    start: { x: 0, y: 0 },
    stick: [{ at: 0, x: 1, y: 0.2 }],
    ticks: 800,
  }),

  // REGENERATION: a per-tick rate, clamped at full, and gated on being alive.
  buildCase({
    name: 'regen-clamps-at-full',
    start: { x: 0, y: 0, hp: 40 },
    stick: [{ at: 0, x: 0, y: 0 }],
    stats: { maxHp: 120, hpRegen: 8 },
    ticks: 800,
  }),

  // FIELD REPAIR. THE CLOCK STARTS FULL - the tick the card is taken must NOT pay out, which is
  // exactly the moment a hurt player takes it. Then a repair every interval until full, at which
  // point the clock holds rather than ticking.
  buildCase({
    name: 'repair-clock-starts-full',
    start: { x: 0, y: 0, hp: 30 },
    stick: [{ at: 0, x: 0, y: 0 }],
    stats: { maxHp: 200, repairAmount: 25, repairInterval: 2 },
    ticks: 900,
  }),

  // THE ROUND TRIP that unlocks the card: under a fifth of the hull, then all the way back. A
  // LATCH - it fires once, on arrival, and not again while the run stays healthy.
  buildCase({
    name: 'critical-round-trip-latches',
    start: { x: 0, y: 0, hp: 20 },
    stick: [{ at: 0, x: 0, y: 0 }],
    stats: { maxHp: 200, hpRegen: 30 },
    ticks: 700,
  }),

  // THE SHIELD, two rims down. The timer restarts immediately while one is still missing, so the
  // first comes back after one period and the second after two - which is what the stacking card
  // means. Then it parks at 0 once whole.
  buildCase({
    name: 'shield-recharges-one-rim-at-a-time',
    start: { x: 0, y: 0 },
    stick: [{ at: 0, x: 0, y: 0 }],
    stats: { shieldLayers: 2, shieldRecharge: 3 },
    shieldLayers: 0,
    invulnLeft: 0.4,
    ticks: 600,
  }),

  // A SHIELD CAPACITY LOWERED UNDER A STANDING RIM. Nothing removes a shield card today, but the
  // clamp exists so a tuning sweep cannot leave a rim above the ceiling - and an untested clamp is
  // a clamp that rots.
  buildCase({
    name: 'shield-clamps-to-lowered-capacity',
    start: { x: 0, y: 0 },
    stick: [{ at: 0, x: 0, y: 0 }],
    stats: { shieldLayers: 1, shieldRecharge: 3 },
    shieldLayers: 3,
    ticks: 200,
  }),
];

const fixture = {
  note:
    'S3 - the chassis. Driven, because this is an integrator and a single call says nothing: what ' +
    'matters is that the mech approaches its top speed from BELOW and never crosses it, that a ' +
    'diagonal reaches the identical speed, and that three clocks with three different rules all ' +
    'behave. The drag is DERIVED from accel and top speed and must never be recomputed here - that ' +
    'derivation is the only thing pinning terminal velocity to the number in the table.',
  dt: f64(DT),
  arenaHalf: f64(ARENA_HALF),
  mechShoveDps: f64(150),
  criticalFrac: f64(0.2),
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
      beamCapacity: w.beams.capacity,
      contactCapacity: w.contacts.capacity,
      maxQueryCandidates: w.scratch.candidates.length,
      cellSize: w.spatial.cellSize,
      bucketCount: w.spatial.bucketCount,
      arenaSize: ARENA_HALF * 2,
      weaponCatalogCount: w.weaponCatalog.length,
      upgradeCount: w.upgradeCatalog.length,
    };
  })(),
  cases,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);

console.log(
  `wrote goldens/player-movement-fixture.json  (${cases.length} cases, ` +
    `${cases.reduce((a, c) => a + c.ticks, 0)} ticks)`,
);
