/**
 * `npm run golden:director` - emit `goldens/director-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT BREAKS A PORT OF THIS STAGE
 * ---------------------------------------------------------------------------------------------
 * THE DRAW ORDER AND THE DRAW COUNT ARE THE FORMAT. Everything else about the director could be
 * rewritten and the runs would still match; change how many numbers come out of `rng.spawn` per
 * spawn and every replay is a different run from that tick onward. The traps, all of which
 * produce a perfectly plausible-looking horde:
 *
 *   - The variant roll is drawn for REGULARS ONLY, and it is drawn even when the archetype has one
 *     flavour and even when the cycle's chance is zero. Cycle 0 authors zero, so a port that
 *     returned early before the draw desynchronises the entire first minute and nothing else.
 *   - The disc sampler REJECTS. A discarded attempt costs the stream exactly what an accepted one
 *     costs, so a port that used an angle instead produces a uniform direction and a completely
 *     different stream.
 *   - The forward-bias redraw happens at most ONCE, and only when the player is moving. So the
 *     cases below run with the player still, moving slowly (under the threshold) and moving fast.
 *
 * THREE PLACES BANK NOTHING, and each is one line:
 *
 *   - The spawn accumulator is clamped to 1 AFTER the loop. Without it, time spent under a boss's
 *     pressure shadow banks spawns and discharges them as a wall. The `pressure-shadow` case sits
 *     a boss next to the player for hundreds of ticks precisely to build that debt.
 *   - A blocked elite resets its timer to a FULL interval, not to zero.
 *   - At the population cap the director STOPS. Nothing is culled, nothing is queued.
 *
 * THE ROLLOVER DOES ALMOST NOTHING, and that is the thing to get right: it resolves the new cycle,
 * zeroes the elite timer and rolls the wave's event. It does NOT touch a single existing enemy.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE CLOCK IS POSED RATHER THAN SIMULATED
 * ---------------------------------------------------------------------------------------------
 * `runSec = runTicks * DT` - exact, from an integer, never accumulated. So a case can START at
 * tick 5400 and be exactly as valid as one that spent ninety seconds getting there, and the boss
 * and elite phases are reachable without a fixture that takes minutes to generate and megabytes to
 * store. The C# side repeats the same one-line derivation.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DT, Simulation, type World } from '../src/core/index.js';
import { updateSpawning } from '../src/core/systems/spawning.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import {
  ENEMY_FLAG_ANCHORED,
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_ELITE,
} from '../src/core/entity/enemyPool.js';
import { RUN_PHASE_RUNNING } from '../src/core/types.js';
import type { RngState } from '../src/core/rng.js';
import { pickSpecialEvent } from '../src/core/content/specialEvents.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/director-fixture.json');

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

interface Seed {
  x: number;
  y: number;
  flags: number;
}

interface CaseSpec {
  name: string;
  seed: number;
  /** Where the clock starts. `runSec` is derived from it exactly as the clock system does. */
  startTick: number;
  ticks: number;
  /** How often to record. 1 for short cases; larger where the interesting part is the trend. */
  every: number;
  player: { x: number; y: number; vx: number; vy: number };
  /** The ramp is S1's output; posed here so this fixture is about the director alone. */
  hpRamp: number;
  speedRamp: number;
  /** Bodies standing before the first tick. A boss here is what creates a pressure shadow. */
  seedBodies?: Seed[];
  /** Fill the pool to just under the live cap, to reach the "director simply stops" branch. */
  fillToCap?: number;
}

function build(spec: CaseSpec) {
  const w: World = new Simulation({ seed: spec.seed, heroId: 0, levelId: 'scrapyard' }).world;

  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;

  w.phase = RUN_PHASE_RUNNING;
  w.player.x = spec.player.x;
  w.player.y = spec.player.y;
  w.player.vx = spec.player.vx;
  w.player.vy = spec.player.vy;
  w.difficulty.hpRamp = spec.hpRamp;
  w.difficulty.speedRamp = spec.speedRamp;

  const bodies = spec.seedBodies ?? [];
  for (const b of bodies) {
    const h = allocEnemy(w.enemies, 0, 0, 0, b.x, b.y, w.director.nextSpawnId);
    void h;
    const d = w.enemies.count - 1;
    w.enemies.flags[d] = b.flags;
    w.enemies.radius[d] = 20;
    w.enemies.hp[d] = 100;
    w.director.nextSpawnId++;
  }

  // Padding bodies far from the player so they count against MAX_LIVE_ENEMIES without adding
  // pressure - which is exactly the state that reaches the population-cap branch while the
  // pressure loop still wants to spawn.
  const fill = spec.fillToCap ?? 0;
  for (let i = 0; i < fill; i++) {
    allocEnemy(w.enemies, 0, 0, 0, 5000 + (i % 50), 5000 + Math.floor(i / 50), w.director.nextSpawnId);
    const d = w.enemies.count - 1;
    w.enemies.radius[d] = 10;
    w.enemies.hp[d] = 10;
    w.director.nextSpawnId++;
  }

  const rows: unknown[] = [];
  const sp: RngState = { a: 0, b: 0, c: 0, d: 0 };
  const ev: RngState = { a: 0, b: 0, c: 0, d: 0 };

  const record = (tick: number) => {
    const d = w.director;
    w.rng.spawn.save(sp);
    w.rng.event.save(ev);
    rows.push({
      tick,
      runSec: f64(w.runSec),
      cycleIndex: d.cycleIndex,
      cyclePhase: d.cyclePhase,
      localPressure: f64(d.localPressure),
      targetPressure: f64(d.targetPressure),
      liveElites: d.liveElites,
      spawnAccumulator: f64(d.spawnAccumulator),
      nextSpawnId: d.nextSpawnId,
      eliteTimer: f64(d.eliteTimer),
      bossCycle: d.bossCycle,
      eventCycle: d.eventCycle,
      bossSpawned: d.bossSpawned,
      bossHandle: u32(d.bossHandle),
      enemyCount: w.enemies.count,
      cycle: {
        index: d.cycle.index,
        name: d.cycle.name,
        archetype: d.cycle.archetype,
        hp: f64(d.cycle.hp),
        speed: f64(d.cycle.speed),
        contactDamage: f64(d.cycle.contactDamage),
        xp: f64(d.cycle.xp),
        variantChance: f64(d.cycle.variantChance),
        typeByRank: Array.from(d.cycle.typeByRank),
      },
      // THE STREAM STATES, and they carry more than the counts do: two ports can agree on how many
      // enemies exist and disagree on how many numbers it took to get there, and only the second
      // difference predicts what the rest of the run looks like.
      rngSpawn: [u32(sp.a), u32(sp.b), u32(sp.c), u32(sp.d)],
      rngEvent: [u32(ev.a), u32(ev.b), u32(ev.c), u32(ev.d)],
    });
  };

  for (let i = 0; i < spec.ticks; i++) {
    const tick = spec.startTick + i;
    w.tick = tick;
    w.runTicks = tick;
    w.runSec = w.runTicks * DT;
    updateSpawning(w, DT);
    if (i % spec.every === 0 || i === spec.ticks - 1) record(tick);
  }

  // Every body standing at the end, in slot order. This is the real proof: the counters can match
  // while the bodies are in different places carrying different stats.
  const p = w.enemies;
  const finalBodies = [];
  for (let d = 0; d < p.count; d++) {
    finalBodies.push({
      x: f32(p.x[d]),
      y: f32(p.y[d]),
      hp: f32(p.hp[d]),
      maxHp: f32(p.maxHp[d]),
      speed: f32(p.speed[d]),
      radius: f32(p.radius[d]),
      mass: f32(p.mass[d]),
      knockbackTake: f32(p.knockbackTake[d]),
      contactDamage: f32(p.contactDamage[d]),
      xpValue: p.xpValue[d],
      typeId: p.typeId[d],
      flavourId: p.flavourId[d],
      archetype: p.archetype[d],
      flags: p.flags[d],
      cycleIndex: p.cycleIndex[d],
      spawnId: u32(p.spawnId[d]),
      fixateX: f32(p.fixateX[d]),
      fixateY: f32(p.fixateY[d]),
      fixateLeft: f32(p.fixateLeft[d]),
      chargeX: f32(p.chargeX[d]),
      chargeY: f32(p.chargeY[d]),
      chargeLeft: f32(p.chargeLeft[d]),
    });
  }

  return {
    name: spec.name,
    seed: spec.seed,
    startTick: spec.startTick,
    ticks: spec.ticks,
    every: spec.every,
    player: {
      x: f64(spec.player.x),
      y: f64(spec.player.y),
      vx: f64(spec.player.vx),
      vy: f64(spec.player.vy),
    },
    hpRamp: f64(spec.hpRamp),
    speedRamp: f64(spec.speedRamp),
    seedBodies: bodies.map((b) => ({ x: f64(b.x), y: f64(b.y), flags: b.flags })),
    fillToCap: fill,
    checkpoints: rows,
    finalBodies,
  };
}

/** One boss and eighteen elites in a tight knot on the player. See the `pressure-shadow` case. */
function shadowBodies(): Seed[] {
  const out: Seed[] = [{ x: 30, y: 0, flags: ENEMY_FLAG_BOSS | ENEMY_FLAG_ANCHORED }];
  for (let i = 0; i < 18; i++) {
    // On a small integer lattice, well inside THREAT_RADIUS so every one of them counts.
    out.push({ x: ((i % 6) - 3) * 40, y: (Math.floor(i / 6) - 1) * 40, flags: ENEMY_FLAG_ELITE });
  }
  return out;
}

// -------------------------------------------------------------------------------------------
// The cases
// -------------------------------------------------------------------------------------------

const cases = [];

// 1. THE OPENING. Cycle 0 from tick 0: no elites, no boss, no events (index < 1 refuses the roll),
//    and variantChance 0 - so every body is plain and the variant float is drawn anyway. This is
//    the case a port that skips the zero-chance draw fails, and it fails immediately.
cases.push(
  build({
    name: 'cycle-0-opening',
    seed: 1234,
    startTick: 0,
    ticks: 240,
    every: 8,
    player: { x: 0, y: 0, vx: 0, vy: 0 },
    hpRamp: 1,
    speedRamp: 1,
  }),
);

// 2. THE PLAYER IS MOVING, fast enough to trigger the forward bias. Same opening, one difference:
//    every spawn whose direction lands behind the player costs TWO extra draws instead of none.
cases.push(
  build({
    name: 'forward-bias-running',
    seed: 1234,
    startTick: 0,
    ticks: 240,
    every: 8,
    player: { x: 0, y: 0, vx: 150, vy: -40 },
    hpRamp: 1,
    speedRamp: 1,
  }),
);

// 3. MOVING, BUT UNDER THE THRESHOLD (20 u/s). The bias must NOT fire. Sitting either side of a
//    threshold is how a port that used `>=` where the source uses `>` gets found.
cases.push(
  build({
    name: 'forward-bias-below-threshold',
    seed: 1234,
    startTick: 0,
    ticks: 180,
    every: 6,
    player: { x: 0, y: 0, vx: 19.999, vy: 0 },
    hpRamp: 1,
    speedRamp: 1,
  }),
);

// 4. THE ELITE PHASE. Starts at 0:58 of cycle 1 and runs across the 1:00 boundary, so it catches
//    the first elite arriving on a zeroed timer rather than after a full interval.
cases.push(
  build({
    name: 'elite-phase-opens',
    seed: 77,
    startTick: 120 * 60 + 58 * 60,
    ticks: 600,
    every: 10,
    player: { x: 120, y: -80, vx: 0, vy: 0 },
    hpRamp: 1.08,
    speedRamp: 1.02,
  }),
);

// 5. THE BOSS. Starts just before 1:30 of cycle 2. Exactly one boss, flagged BOSS|ANCHORED, and
//    `bossHandle` set - and the pressure it contributes is 6, which visibly throttles the drip.
cases.push(
  build({
    name: 'boss-arrives',
    seed: 4242,
    startTick: 2 * 120 * 60 + 89 * 60,
    ticks: 420,
    every: 6,
    player: { x: -400, y: 250, vx: 0, vy: 0 },
    hpRamp: 1.15,
    speedRamp: 1.03,
  }),
);

// 6. THE PRESSURE SHADOW, which is what the accumulator clamp exists for. A boss and four elites
//    stand on the player, pinning local pressure above target for the whole case, so the drip is
//    blocked every tick and the accumulator would otherwise bank 12 spawns a second.
//
//    A port missing the clamp agrees on every checkpoint here - the enemy count is the same,
//    because nothing spawns either way - and differs only in `spawnAccumulator`. Which is exactly
//    why the accumulator is recorded as a bit pattern rather than inferred from the count.
cases.push(
  build({
    name: 'pressure-shadow',
    seed: 909,
    startTick: 3 * 120 * 60 + 100 * 60,
    ticks: 600,
    every: 20,
    player: { x: 0, y: 0, vx: 0, vy: 0 },
    hpRamp: 1.2,
    speedRamp: 1.04,
    // Cycle 3's target is 28 + 8.75*3 = 54.25. A boss weighs 6 and an elite 3, so one boss and
    // eighteen elites is 60 - over target from the first tick and staying there, which is what
    // makes this a shadow rather than merely a crowd. An earlier version of this case used five
    // elites, sat just UNDER target, and quietly let twenty-five bodies drip in while claiming in
    // its own name to be testing the opposite.
    seedBodies: shadowBodies(),
  }),
);

// 7. THE POPULATION CAP. The pool is filled to just under 300 with bodies parked far away, so they
//    cost nothing in pressure and the drip keeps wanting to fire while the cap refuses it. The
//    director must simply stop: no cull, no queue, and the accumulator still clamped.
cases.push(
  build({
    name: 'population-cap',
    seed: 555,
    startTick: 60 * 60,
    ticks: 300,
    every: 10,
    player: { x: 0, y: 0, vx: 0, vy: 0 },
    hpRamp: 1.05,
    speedRamp: 1.01,
    fillToCap: 296,
  }),
);

// 8. THE ROLLOVER. Straddles 2:00 exactly, with bodies already standing - so the case states, as
//    data, that a rollover changes what is SPAWNED and touches nothing already alive. The final
//    body dump still contains the seeded bodies, unmoved and unmodified.
cases.push(
  build({
    name: 'rollover-keeps-everything',
    seed: 31337,
    startTick: 120 * 60 - 30,
    ticks: 240,
    every: 4,
    player: { x: 700, y: -700, vx: 60, vy: 60 },
    hpRamp: 1.25,
    speedRamp: 1.05,
    seedBodies: [
      { x: 100, y: 100, flags: 0 },
      { x: -100, y: 100, flags: ENEMY_FLAG_ELITE },
    ],
  }),
);

// 9-12. THE SPECIAL EVENTS. Each set-piece has to appear in the corpus or its whole branch is
//    untested, and which one a wave rolls is a property of the seed - so these are seeds picked by
//    searching for one that fires each. The search is below, and it asserts rather than hopes.
const EVENT_SEEDS = findEventSeeds();
for (const [id, seed] of EVENT_SEEDS) {
  cases.push(
    build({
      name: `special-event-${id}`,
      seed,
      // Cycle 1's rollover, which is the FIRST eligible wave (index < 1 is refused).
      startTick: 120 * 60 - 6,
      ticks: 200,
      every: 2,
      player: { x: 0, y: 0, vx: 0, vy: 0 },
      hpRamp: 1.1,
      speedRamp: 1.02,
    }),
  );
}

/**
 * Finds one seed per special event id, by asking the table what each seed's first eligible wave
 * would roll.
 *
 * SEARCHED RATHER THAN HARD-CODED, and it throws if an event cannot be reached. A hard-coded seed
 * silently stops firing its event the day a weight changes, and the fixture would go on passing
 * while covering three branches instead of four - which is the failure mode that makes a golden
 * corpus worse than useless, because it still says "ok".
 */
function findEventSeeds(): Array<[number, number]> {
  const found = new Map<number, number>();
  for (let seed = 1; seed < 4000 && found.size < 4; seed++) {
    const w = new Simulation({ seed, heroId: 0, levelId: 'scrapyard' }).world;
    // The roll the cycle-1 rollover would make, without disturbing the world we hand to `build`:
    // the same stream, the same first draw.
    // The bonus is passed even though every world here carries no meta tiers, so the copy cannot
    // drift from spawning.ts: the day this fixture gains a meta-tier case, it diverges loudly
    // rather than by omission.
    const id = pickSpecialEvent(w.rng.event.nextFloat(), w.chestWeight);
    if (!found.has(id)) found.set(id, seed);
  }
  if (found.size < 4) {
    throw new Error(`only found seeds for events [${[...found.keys()].join(',')}]; need all four`);
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]);
}

const fixture = {
  note:
    'The director. The DRAW ORDER and DRAW COUNT are the format: two ports can agree on how many ' +
    'enemies exist and disagree on how many numbers it took, and only the second predicts the ' +
    'rest of the run. Stream states are recorded at every checkpoint for that reason.',
  dt: f64(DT),
  cases,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(fixture, null, 1));

const checks = cases.reduce((n, c) => n + c.checkpoints.length, 0);
const bodies = cases.reduce((n, c) => n + c.finalBodies.length, 0);
console.log(
  `goldens/director-fixture.json: ${cases.length} cases, ${checks} checkpoints, ${bodies} final bodies`,
);
