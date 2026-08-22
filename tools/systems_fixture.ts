/**
 * `npm run golden:systems` - emit `goldens/systems-fixture.json`, the cross-language proof for the
 * pipeline stages that have been ported so far.
 *
 * ---------------------------------------------------------------------------------------------
 * A SYSTEM IS PROVEN BY ITS EFFECT, NOT BY ITS CODE
 * ---------------------------------------------------------------------------------------------
 * Each case below sets a world into a stated position, calls ONE stage, and records what changed.
 * That is deliberately narrower than the run corpus: the corpus proves the whole pipeline agrees,
 * and cannot say which stage disagreed. These say which stage, which is what a port needs while it
 * is being written and the corpus is still months from running.
 *
 * ---------------------------------------------------------------------------------------------
 * THE DIFFICULTY CASES ARE CHOSEN, NOT SAMPLED
 * ---------------------------------------------------------------------------------------------
 * `updateDifficulty` has four behaviours and three of them are edges: the ordinary
 * one-second-crossed step, the no-op when no whole second has passed, the CYCLE ROLLOVER that
 * resets both ramps, and the catch-up LOOP that crosses several seconds at once. A random sweep
 * would hit the first constantly and the other three rarely, so they are written out.
 *
 * The rollover is the one worth stating twice: it is what stops the within-cycle sawtooth
 * compounding with the authored cycle ladder into a single fifteen-minute exponential.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DT, Simulation, hashToHex, hashWorld, type InputFrame, type World } from '../src/core/index.js';
import { beginTick, endTick } from '../src/core/systems/clock.js';
import { updateDifficulty } from '../src/core/systems/difficulty.js';
import { reapDead } from '../src/core/systems/reap.js';
import { allocEnemy, markEnemyDead } from '../src/core/entity/enemyPool.js';
import { allocProjectile, markProjectileDead } from '../src/core/entity/projectilePool.js';
import { allocPickup, markPickupDead } from '../src/core/entity/pickupPool.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/systems-fixture.json');

const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function f64(v: number): string {
  scratchF64[0] = v;
  return scratchU32[1].toString(16).padStart(8, '0') + scratchU32[0].toString(16).padStart(8, '0');
}

function fresh(): World {
  return new Simulation({ seed: 0x5ca19a2d, heroId: 0, levelId: 'scrapyard' }).world;
}

// ---------------------------------------------------------------------------------------------
// updateDifficulty
// ---------------------------------------------------------------------------------------------

interface DiffCase {
  readonly name: string;
  readonly runSec: number;
  readonly lastWholeSecond: number;
  readonly hpRamp: number;
  readonly speedRamp: number;
}

const DIFF_CASES: readonly DiffCase[] = [
  { name: 'fresh-zero', runSec: 0, lastWholeSecond: 0, hpRamp: 1, speedRamp: 1 },
  // No whole second crossed - must be an exact no-op, including on the ramps.
  { name: 'no-op-fraction', runSec: 3.75, lastWholeSecond: 3, hpRamp: 1.004, speedRamp: 1.0009 },
  // The ordinary case: exactly one second crossed, one multiply each.
  { name: 'one-second', runSec: 4.0, lastWholeSecond: 3, hpRamp: 1.004, speedRamp: 1.0009 },
  // The catch-up loop. A saturated frame can advance runSec by up to 5 ticks; this crosses more,
  // because the loop must be exactly as many multiplies as seconds and not one fewer.
  { name: 'catch-up-9', runSec: 42.5, lastWholeSecond: 33, hpRamp: 1.07, speedRamp: 1.016 },
  // THE ROLLOVER. runSec past a cycle boundary with lastWholeSecond behind it: both ramps reset to
  // 1 and lastWholeSecond jumps to the boundary, and only THEN do the seconds since it apply.
  { name: 'rollover', runSec: 121.5, lastWholeSecond: 119, hpRamp: 1.29, speedRamp: 1.059 },
  // Rollover landing exactly ON the boundary second.
  { name: 'rollover-exact', runSec: 120.0, lastWholeSecond: 119, hpRamp: 1.3, speedRamp: 1.06 },
  // Second cycle, so the index arithmetic is not accidentally right only for cycle 1.
  { name: 'rollover-second-cycle', runSec: 241.25, lastWholeSecond: 239, hpRamp: 1.3, speedRamp: 1.06 },
  // Deep into a cycle, far from any boundary.
  { name: 'mid-cycle', runSec: 305.5, lastWholeSecond: 300, hpRamp: 1.11, speedRamp: 1.028 },
];

const difficulty = DIFF_CASES.map((c) => {
  const w = fresh();
  w.runSec = c.runSec;
  w.difficulty.lastWholeSecond = c.lastWholeSecond;
  w.difficulty.hpRamp = c.hpRamp;
  w.difficulty.speedRamp = c.speedRamp;

  updateDifficulty(w, DT);

  return {
    name: c.name,
    in: {
      runSec: f64(c.runSec),
      lastWholeSecond: c.lastWholeSecond,
      hpRamp: f64(c.hpRamp),
      speedRamp: f64(c.speedRamp),
    },
    out: {
      lastWholeSecond: w.difficulty.lastWholeSecond,
      hpRamp: f64(w.difficulty.hpRamp),
      speedRamp: f64(w.difficulty.speedRamp),
    },
  };
});

// ---------------------------------------------------------------------------------------------
// beginTick / endTick
// ---------------------------------------------------------------------------------------------

interface ClockCase {
  readonly name: string;
  readonly tick: number;
  readonly runTicks: number;
  readonly phase: number;
  readonly input: InputFrame;
  readonly enemies: number;
  readonly peakEnemies: number;
}

const CLOCK_CASES: readonly ClockCase[] = [
  // During the intro, runTicks must NOT advance - the ramp is frozen with it.
  { name: 'intro-early', tick: 5, runTicks: 0, phase: 0, input: { moveX: 12, moveY: -34, buttons: 0, chooseIndex: -1 }, enemies: 0, peakEnemies: 0 },
  // The tick the intro ends on. endTick flips the phase and pushes an event.
  { name: 'intro-boundary', tick: 179, runTicks: 0, phase: 0, input: { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 }, enemies: 3, peakEnemies: 1 },
  // Running: runTicks advances, and it advances BEFORE the pipeline would have run.
  { name: 'running', tick: 400, runTicks: 220, phase: 1, input: { moveX: -127, moveY: 127, buttons: 3, chooseIndex: 2 }, enemies: 7, peakEnemies: 4 },
  // A card is open: the phase is not RUNNING, so runTicks freezes. Time spent choosing an upgrade
  // is not time survived.
  { name: 'level-up-frozen', tick: 900, runTicks: 500, phase: 2, input: { moveX: 0, moveY: 0, buttons: 0, chooseIndex: 1 }, enemies: 11, peakEnemies: 11 },
  // Peak enemies only ever rises.
  { name: 'peak-not-exceeded', tick: 1200, runTicks: 900, phase: 1, input: { moveX: 1, moveY: 1, buttons: 0, chooseIndex: -1 }, enemies: 2, peakEnemies: 40 },
];

const clock = CLOCK_CASES.map((c) => {
  const w = fresh();
  w.tick = c.tick;
  w.runTicks = c.runTicks;
  w.phase = c.phase as World['phase'];
  w.stats.peakEnemies = c.peakEnemies;

  // Give the pools something, and move the player, so the prev-snapshot is observable.
  w.player.x = 123.25;
  w.player.y = -45.75;
  w.player.prevX = 0;
  w.player.prevY = 0;
  const spawned: { x: string; y: string }[] = [];
  for (let i = 0; i < c.enemies; i++) {
    const x = 10.5 * (i + 1);
    const y = -7.25 * (i + 1);
    allocEnemy(w.enemies, i % 5, i % 3, i % 4, x, y, i + 1);
    spawned.push({ x: f64(x), y: f64(y) });
  }

  // Dirty the seams so BeginTick is seen to clear them.
  w.hits.count = 9;
  w.contacts.count = 4;
  w.kills.count = 2;
  w.xpBanked = 77.5;

  const eventsBefore = w.events.writeCursor;
  beginTick(w, c.input);

  const afterBegin = {
    timeSec: f64(w.timeSec),
    runSec: f64(w.runSec),
    runTicks: w.runTicks,
    input: { moveX: w.input.moveX, moveY: w.input.moveY, buttons: w.input.buttons, chooseIndex: w.input.chooseIndex },
    playerPrevX: f64(w.player.prevX),
    playerPrevY: f64(w.player.prevY),
    // The whole-array copy, sampled past the live count: BeginTick copies CAPACITY, and a port
    // that copied only the live prefix would leave this stale.
    enemyPrevAtCount: c.enemies > 0 ? f64(w.enemies.prevX[c.enemies - 1]) : null,
    hits: w.hits.count,
    contacts: w.contacts.count,
    kills: w.kills.count,
    xpBanked: f64(w.xpBanked),
  };

  endTick(w);

  return {
    name: c.name,
    in: { ...c, input: { ...c.input } },
    spawned,
    afterBegin,
    afterEnd: {
      tick: w.tick,
      phase: w.phase,
      peakEnemies: w.stats.peakEnemies,
      endTick: w.stats.endTick,
      eventsPushed: w.events.writeCursor - eventsBefore,
    },
  };
});

// ---------------------------------------------------------------------------------------------
// reapDead
// ---------------------------------------------------------------------------------------------
//
// The pools' own reaps are already proven step by step; what this adds is that the STAGE calls all
// three, which a port could plausibly get wrong by forgetting one.

const reap = (() => {
  const w = fresh();
  const marks: { pool: string; d: number }[] = [];

  for (let i = 0; i < 6; i++) allocEnemy(w.enemies, i, 0, 0, i * 3.5, i * -2.25, i + 1);
  for (let i = 0; i < 4; i++) allocProjectile(w.projectiles, i * 2.5, i, 1, 0, 1.5, 0, 0, 100 + i);
  for (let i = 0; i < 5; i++) allocPickup(w.pickups, i % 6, i * 7, 0, i * 1.5, i, 200 + i);

  for (const d of [4, 1]) { markEnemyDead(w.enemies, d); marks.push({ pool: 'enemies', d }); }
  for (const d of [2]) { markProjectileDead(w.projectiles, d); marks.push({ pool: 'projectiles', d }); }
  for (const d of [3, 0]) { markPickupDead(w.pickups, d); marks.push({ pool: 'pickups', d }); }

  const before = {
    enemies: w.enemies.count, projectiles: w.projectiles.count, pickups: w.pickups.count,
  };

  reapDead(w);

  return {
    marks,
    before,
    after: {
      enemies: w.enemies.count, enemiesFree: w.enemies.freeCount,
      projectiles: w.projectiles.count, projectilesFree: w.projectiles.freeCount,
      pickups: w.pickups.count, pickupsFree: w.pickups.freeCount,
    },
    worldHash: hashToHex(hashWorld(w)),
  };
})();

const w0 = fresh();
const fixture = {
  formatVersion: 1,
  note: 'Cross-language proof for the ported pipeline stages. Doubles are IEEE-754 bits as 16 hex digits, high word first.',
  dt: f64(DT),
  introEndTick: 180,
  tuning: {
    cycleSeconds: w0.config.tuning.director.cycleSeconds,
    hpRampPerSec: f64(w0.config.tuning.director.hpRampPerSec),
    speedRampPerSec: f64(w0.config.tuning.director.speedRampPerSec),
  },
  shape: {
    enemyCapacity: w0.enemies.capacity,
    projectileCapacity: w0.projectiles.capacity,
    pickupCapacity: w0.pickups.capacity,
    droneCapacity: w0.drones.capacity,
    sheepCapacity: w0.sheep.capacity,
    eventRingCapacity: w0.events.capacity,
  },
  difficulty,
  clock,
  reap,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/systems-fixture.json  ` +
    `(${difficulty.length} difficulty cases, ${clock.length} clock cases, 1 reap case)`,
);
