/**
 * `npm run golden:sheep` - emit `goldens/sheep-fixture.json`.
 *
 * ---------------------------------------------------------------------------------------------
 * DRIVEN, LIKE THE ENEMY AI, AND FOR THE SAME REASON
 * ---------------------------------------------------------------------------------------------
 * `updateSheep` does not answer a question. It runs a three-state machine on a timer that rolls its
 * own next state, so nothing interesting happens inside a single call - the behaviour is which
 * state a sheep is in forty ticks later and how many values it drew getting there. Every case below
 * places a flock and steps the stage repeatedly, dumping every column plus the SHEEP RNG STATE
 * after every tick.
 *
 * ---------------------------------------------------------------------------------------------
 * THE STREAM IS THE POINT, NOT JUST THE POSITIONS
 * ---------------------------------------------------------------------------------------------
 * This system's every decision is a draw: the graze/wander coin, both state durations, the random
 * fallback heading, and TWO PER SPAWN ATTEMPT. Positions alone would not catch a port that took a
 * different NUMBER of values, because a sheep that drew one extra float still ends up somewhere
 * plausible - and every future roll in the run is then wrong. So the four sfc32 words are compared
 * every tick alongside the columns.
 *
 * Two branches exist only to keep that count fixed, and both are cased:
 *
 *   THE SPAWN TERNARY PAIR. A MOVING mech spends its angle draw on the jitter (`base` is atan2, no
 *   draw); a STANDING one spends it on `base` and takes no jitter. Exactly one draw either way. A
 *   port that evaluated both sides of either ternary would take two, and `topping-up-standing`
 *   diverges on the first top-up.
 *
 *   REJECTION SAMPLING. A crowded placement is thrown away, but it has already drawn its angle and
 *   its radius, so a rejected attempt costs the stream the same as one that lands.
 *   `top-up-crowded` packs the ring so attempts are refused and the loop gives up.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT ELSE IS DELIBERATELY POSED
 * ---------------------------------------------------------------------------------------------
 * A sheep standing EXACTLY on the mech (`distP2 === 0`), which is the divide-by-zero guard and the
 * only place a NaN could enter the pool. Unreachable in play, one line to pose, and a port that
 * dropped the guard would fill the columns with NaN rather than failing anywhere obvious.
 *
 * The `want <= 0 && count === 0` early return, which must draw NOTHING - a Scrapyard-shaped level
 * running this stage every tick and touching neither the pool nor the stream.
 *
 * The intro gate, because a flock materialising during the three seconds of empty field would be
 * the first thing the player ever saw.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DT, Simulation, type World } from '../src/core/index.js';
import { RUN_PHASE_INTRO, RUN_PHASE_RUNNING, type RunPhase } from '../src/core/types.js';
import type { LevelDef } from '../src/core/content/levels.js';
import { Rng } from '../src/core/rng.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { allocSheep } from '../src/core/entity/sheepPool.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import {
  SHEEP_RADIUS,
  SHEEP_SPAWN_GAP,
  sheepRayHit,
  takeSheepIn,
  updateSheep,
} from '../src/core/systems/sheep.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/sheep-fixture.json');

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

interface Animal {
  x: number;
  y: number;
  /** Optional overrides, so a case can start a sheep mid-state rather than waiting for it. */
  state?: number;
  timer?: number;
  dirX?: number;
  dirY?: number;
}

interface Body {
  x: number;
  y: number;
}

interface CaseSpec {
  name: string;
  seed: number;
  /** What `LevelDef.sheep` says. Overridden per case - the flock size IS the thing being driven. */
  want: number;
  phase: RunPhase;
  tick: number;
  runTicks: number;
  player: { x: number; y: number; vx: number; vy: number };
  animals: Animal[];
  enemies?: Body[];
  ticks: number;
}

function rngState(w: World): string[] {
  const s = { a: 0, b: 0, c: 0, d: 0 };
  w.rng.sheep.save(s);
  return [u32(s.a), u32(s.b), u32(s.c), u32(s.d)];
}

/**
 * HOW MANY VALUES THE STREAM ADVANCED between two saved states, by replaying it.
 *
 * Recorded because it is the number a failure actually needs to name. Four hex words that do not
 * match say only "the stream diverged"; "took 3 draws where 2 were expected" says which branch to
 * look at - a spawn ternary that evaluated both sides, or a rejected attempt that forgot it had
 * already paid. The C# side derives the same figure from its OWN pair of states, so this is a
 * legible cross-check rather than a second copy of the same comparison.
 *
 * Bounded: an unmatched state after a generous number of steps means a genuine divergence rather
 * than a long tick, and returning -1 keeps a broken fixture from hanging the generator.
 */
function drawsBetween(before: readonly string[], after: readonly string[]): number {
  const probe = new Rng(0);
  probe.restore({
    a: parseInt(before[0], 16) | 0, b: parseInt(before[1], 16) | 0,
    c: parseInt(before[2], 16) | 0, d: parseInt(before[3], 16) | 0,
  });
  const at = { a: 0, b: 0, c: 0, d: 0 };
  for (let n = 0; n <= 512; n++) {
    probe.save(at);
    if (u32(at.a) === after[0] && u32(at.b) === after[1] &&
        u32(at.c) === after[2] && u32(at.d) === after[3]) {
      return n;
    }
    probe.nextFloat();
  }
  return -1;
}

function buildCase(spec: CaseSpec) {
  const w: World = new Simulation({ seed: spec.seed, heroId: 0, levelId: 'mossy-mayhem' }).world;

  // The flock size is the independent variable here, and MOSSY_MAYHEM is frozen - so the level is
  // replaced with a copy rather than mutated. The C# side reads `want` and hands its own ILevel
  // the same number, so neither side is quietly using the shipped 4.
  (w as { level: LevelDef }).level = { ...w.level, sheep: spec.want };

  w.phase = spec.phase;
  w.tick = spec.tick;
  w.runTicks = spec.runTicks;
  w.player.x = spec.player.x;
  w.player.y = spec.player.y;
  w.player.vx = spec.player.vx;
  w.player.vy = spec.player.vy;

  w.sheep.count = 0;
  spec.animals.forEach((a, i) => {
    allocSheep(w.sheep, a.x, a.y, 1000 + i);
    if (a.state !== undefined) w.sheep.state[i] = a.state;
    if (a.timer !== undefined) w.sheep.timer[i] = a.timer;
    if (a.dirX !== undefined) w.sheep.dirX[i] = a.dirX;
    if (a.dirY !== undefined) w.sheep.dirY[i] = a.dirY;
  });

  w.enemies.count = 0;
  w.enemies.killCount = 0;
  w.enemies.freeCount = w.enemies.capacity;
  const enemies = spec.enemies ?? [];
  enemies.forEach((b, i) => {
    allocEnemy(w.enemies, 0, 0, 1, b.x, b.y, i + 1);
    w.enemies.radius[i] = 18;
    w.enemies.speed[i] = 60;
    w.enemies.mass[i] = 1;
  });

  // Recorded BEFORE the first step, so the C# side starts from an identical stream rather than
  // trusting that both languages' world construction happened to draw the same amount.
  const rngBefore = rngState(w);

  const perTick: unknown[] = [];
  let rngPrev = rngBefore;
  for (let t = 0; t < spec.ticks; t++) {
    // The hash is rebuilt every tick by the real pipeline; the avoid query reads it.
    rebuildSpatialHash(w.spatial, w.enemies);
    updateSheep(w, DT);

    const n = w.sheep.count;
    // COLUMNS PACKED AS ONE STRING EACH, eight hex digits per float32 - the same trick the walls
    // fixtures use on their cell sweeps, and for the same reason. A JSON array indented one space
    // per element costs about fifteen bytes for every eight bytes of information, and this fixture
    // holds nine columns for up to twenty-four animals across nearly three thousand ticks: written
    // out naively it came to 4.9 MB, more than every other golden in the repository put together.
    // Nothing is lost - the values are the identical bit patterns, and a packed row diffs as one
    // line rather than twenty-four.
    const col = (a: Float32Array): string => {
      let out = '';
      for (let i = 0; i < n; i++) out += f32(a[i]);
      return out;
    };
    perTick.push({
      count: n,
      x: col(w.sheep.x),
      y: col(w.sheep.y),
      prevX: col(w.sheep.prevX),
      prevY: col(w.sheep.prevY),
      dirX: col(w.sheep.dirX),
      dirY: col(w.sheep.dirY),
      timer: col(w.sheep.timer),
      // One digit each: the three states are 0, 1 and 2.
      state: Array.from({ length: n }, (_, i) => w.sheep.state[i]).join(''),
      // Comma-joined rather than hex - these are ordinary small integers and stay readable.
      spawnId: Array.from({ length: n }, (_, i) => w.sheep.spawnId[i]).join(','),
      rng: rngState(w),
      draws: drawsBetween(rngPrev, rngState(w)),
    });
    rngPrev = rngState(w);

    // The clock advances the way BeginTick would, so the top-up's `runTicks % every` lands on the
    // same ticks it does in a real run.
    w.tick++;
    w.runTicks++;
  }

  return {
    name: spec.name,
    seed: spec.seed,
    want: spec.want,
    phase: spec.phase,
    tick: spec.tick,
    runTicks: spec.runTicks,
    player: {
      x: f64(spec.player.x), y: f64(spec.player.y),
      vx: f64(spec.player.vx), vy: f64(spec.player.vy),
    },
    animals: spec.animals.map((a) => ({
      x: f64(a.x), y: f64(a.y),
      state: a.state ?? 0, timer: f64(a.timer ?? 0),
      dirX: f64(a.dirX ?? 0), dirY: f64(a.dirY ?? 0),
    })),
    enemies: enemies.map((b) => ({ x: f64(b.x), y: f64(b.y) })),
    rngBefore,
    ticks: spec.ticks,
    perTick,
  };
}

const STILL = { vx: 0, vy: 0 };

/** A ring of animals, for the crowding case. Fixture-side maths, so plain trig is fine. */
const ring = (n: number, r: number, cx: number, cy: number): Animal[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });

const cases = [
  // GRAZE AND WANDER, uninterrupted: no player nearby, no enemies, flock already at its count so
  // nothing tops up. Long enough for every animal to roll the graze/wander coin many times, so it
  // covers the timer decrement, both durations, the random-heading fallback (nothing to lean away
  // from) and the walk-speed integrate.
  buildCase({
    name: 'graze-and-wander',
    seed: 0x5ca19a2d,
    want: 4,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 500,
    // FAR ENOUGH NOT TO BE NOTICED, CLOSE ENOUGH NOT TO CULL. Every animal below sits between
    // AVOID_RADIUS (260) and CULL_DIST (1500) of the mech, so nothing flees, nothing leans away
    // from the player, and nothing is picked up - which is what leaves the state machine itself as
    // the only thing moving. An earlier draft parked the mech 141,000 u away and culled the entire
    // flock on the first tick, measuring a repopulation under the name of a graze.
    player: { x: 0, y: -700, ...STILL },
    animals: [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 0, y: 300 },
      { x: -300, y: -300 },
    ],
    ticks: 400,
  }),

  // THE MECH ARRIVES. Two animals inside FLEE_DIST and two outside it, so the same tick exercises
  // both the re-arming flee and the ordinary timer path. The fleeing pair outrun the trigger radius
  // and settle back into a graze, which is the "a finished flee always grazes" branch.
  buildCase({
    name: 'fleeing-from-the-mech',
    seed: 0x5ca19a2d,
    want: 4,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 500,
    player: { x: 0, y: 0, ...STILL },
    animals: [
      { x: 40, y: 0 },
      { x: -30, y: 30 },
      { x: 400, y: 0 },
      { x: 0, y: -420 },
    ],
    ticks: 120,
  }),

  // EXACTLY ON THE MECH. distP2 is 0, so the flee heading divides by zero unless the guard is
  // there - the one place a NaN could enter the pool, and a port that dropped the guard fills the
  // columns with them rather than failing anywhere legible.
  buildCase({
    name: 'sheep-standing-on-the-mech',
    seed: 0x5ca19a2d,
    want: 2,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 500,
    player: { x: 250, y: -125, ...STILL },
    animals: [
      { x: 250, y: -125 },
      { x: 250 + SHEEP_RADIUS, y: -125 },
    ],
    // LONG ENOUGH TO GET AWAY. At 40 ticks both animals were still inside FLEE_DIST, so the flee
    // timer was re-armed every tick, no roll was ever made and the case proved only the guard. 200
    // ticks carries them clear, so the settle-into-a-graze branch runs too.
    ticks: 200,
  }),

  // AVOIDING A CROWD. Enemies inside AVOID_RADIUS of a wandering animal, and the player inside it
  // too but outside FLEE_DIST - so the repulsion sum has both kinds of contributor and comes out
  // longer than 1, taking the normalised branch rather than the random fallback.
  buildCase({
    name: 'avoiding-a-crowd',
    seed: 0x5ca19a2d,
    want: 3,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 500,
    player: { x: 200, y: 0, ...STILL },
    animals: [
      { x: 0, y: 0, state: 1, timer: 0.02 },
      { x: 60, y: 40, state: 1, timer: 0.05 },
      { x: -80, y: -20, state: 0, timer: 0.01 },
    ],
    enemies: [
      { x: -120, y: 0 }, { x: -100, y: 90 }, { x: 30, y: -150 },
      { x: 150, y: 120 }, { x: -60, y: 140 }, { x: 90, y: 90 },
    ],
    ticks: 90,
  }),

  // TOPPING UP AHEAD OF A MOVING MECH: `moving` is true, so `base` is an atan2 that draws nothing
  // and the jitter draws once. runTicks starts on a multiple of the interval so the first tick
  // tops up rather than waiting.
  buildCase({
    name: 'topping-up-moving',
    seed: 0x5ca19a2d,
    want: 6,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 540,
    player: { x: 0, y: 0, vx: 140, vy: -60 },
    animals: [{ x: 700, y: 700 }],
    ticks: 400,
  }),

  // TOPPING UP AROUND A STANDING MECH: `moving` is false, so `base` draws and the jitter does not.
  // THE SAME NUMBER OF DRAWS BY A DIFFERENT ROUTE - which is exactly what a port that evaluated
  // both sides of the ternary would get wrong, and only the stream comparison can see.
  buildCase({
    name: 'topping-up-standing',
    seed: 0x5ca19a2d,
    want: 6,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 540,
    player: { x: 0, y: 0, ...STILL },
    animals: [{ x: 700, y: 700 }],
    ticks: 400,
  }),

  // REJECTION SAMPLING. The spawn ring is packed with animals a little under the required gap
  // apart, so most placements are refused - each refusal having already spent its two draws - and
  // some top-ups give up after all eight tries.
  buildCase({
    name: 'top-up-crowded',
    seed: 0x5ca19a2d,
    want: 24,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 540,
    player: { x: 0, y: 0, ...STILL },
    animals: [
      ...ring(9, 600, 0, 0),
      ...ring(9, 680, 0, 0),
      ...ring(4, 760, 0, 0),
    ],
    // Long enough to cover every top-up and multi-animal roll this seed produces - the last of them
    // lands at t=251.
    ticks: 260,
  }),

  // THE SPAWN LOOP, ISOLATED SO ITS DRAWS CAN BE COUNTED. Every animal is armed with a timer no
  // number of ticks here will run down, so NOTHING rolls a state and every draw on a top-up tick
  // belongs to the placement loop - two per attempt, so the per-tick `draws` reads directly as
  // 2 x attempts and a rejected attempt is visible as a 4 where an accepted one is a 2.
  //
  // `want` is deliberately above SHEEP_CAP, which also covers the branch where the ring is refused
  // so often that the loop reaches a placement the pool has no room for: `allocSheep` returns -1,
  // the loop breaks anyway, and the draws are spent regardless. A port that skipped the draws when
  // the pool was full would desynchronise every later roll in the run.
  buildCase({
    name: 'spawn-attempts-isolated',
    seed: 0x5ca19a2d,
    want: 30,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 540,
    player: { x: 0, y: 0, ...STILL },
    animals: [
      ...ring(10, 600, 0, 0),
      ...ring(9, 690, 0, 0),
      ...ring(5, 780, 0, 0),
    ].map((a) => ({ ...a, timer: 100 })),
    // THREE TOP-UPS IS THE WHOLE CASE. They land 108 ticks apart, and by design nothing else here
    // moves or rolls - so every tick between them repeats twenty-four identical columns. 220 covers
    // an accepted placement (t=0), one that took a rejection first (t=108) and another accepted one
    // (t=216); 600 covered three more of the same and cost two thirds of a megabyte to say so.
    ticks: 220,
  }),

  // THE ORDER OF THE TWO MULTIPLICATIONS IN THE INTEGRATE, pinned deliberately.
  //
  // The source writes `dirX * speed * dt`, which groups as `(dirX * speed) * dt`. Hoisting
  // `speed * dt` out of the loop is the obvious optimisation and is algebraically identical - and
  // it differs in the last bit of the double about 45% of the time. Almost always the float32 store
  // absorbs that, which is why no ordinary case catches it: MEASURED at about one surviving
  // difference in 500,000 position updates, so a fixture of a few thousand would need luck.
  //
  // The three animals below are posed on searched values where the difference DOES survive the
  // store. They are put in FLEE state because the divergence needs the step to be large against the
  // coordinate, and 132 u/s is the only speed here that reaches it - the walk speed shares the
  // identical line, so pinning it once pins it for both. Long timers and a mech 500 u away (past
  // FLEE_DIST, inside CULL_DIST) mean nothing re-arms, nothing rolls and nothing is culled: the
  // integrate is the only thing running.
  buildCase({
    name: 'integrate-association',
    seed: 0x5ca19a2d,
    want: 3,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 500,
    player: { x: 0, y: -500, ...STILL },
    animals: [
      { x: -0.0048767924308776855, y: -0.0048767924308776855, dirX: 0.4039342701435089, dirY: 0.4039342701435089, state: 2, timer: 100 },
      { x: -1.403071403503418, y: -1.403071403503418, dirX: 0.4038827121257782, dirY: 0.4038827121257782, state: 2, timer: 100 },
      { x: 3.2747244834899902, y: 3.2747244834899902, dirX: -0.7430598139762878, dirY: -0.7430598139762878, state: 2, timer: 100 },
    ],
    ticks: 4,
  }),

  // THE INTRO GATE. Below its count and on a top-up tick, but not running yet: nothing may be
  // placed and nothing may be drawn.
  buildCase({
    name: 'intro-does-not-top-up',
    seed: 0x5ca19a2d,
    want: 6,
    phase: RUN_PHASE_INTRO,
    tick: 60,
    runTicks: 0,
    player: { x: 0, y: 0, ...STILL },
    animals: [{ x: 700, y: 700 }],
    // Two top-up boundaries crossed (t=0 and t=108) with nothing placed at either, which is the
    // whole claim.
    ticks: 120,
  }),

  // CULLING STRAYS, including one in the MIDDLE of the array - the pool swap-removes, so a port
  // that iterated upward would skip the entry swapped into the freed slot.
  buildCase({
    name: 'culling-strays',
    seed: 0x5ca19a2d,
    want: 4,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 501,
    player: { x: 0, y: 0, ...STILL },
    animals: [
      { x: 400, y: 0 },
      { x: 2000, y: 0 },
      { x: -350, y: 200 },
      { x: 0, y: -1800 },
      { x: 1200, y: 1200 },
    ],
    ticks: 30,
  }),

  // A LEVEL WITH NO FLOCK. The Scrapyard runs this stage every tick of every run and must touch
  // nothing - not the pool, and above all not the stream, which is shared with nothing else but is
  // still part of the world hash.
  buildCase({
    name: 'no-flock-level',
    seed: 0x5ca19a2d,
    want: 0,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 540,
    player: { x: 0, y: 0, vx: 140, vy: -60 },
    animals: [],
    ticks: 60,
  }),

  // A LEVEL THAT TURNED ITS FLOCK OFF while animals were still standing. `want` is 0 but the count
  // is not, so the early return does NOT fire: the survivors keep grazing and get culled as they
  // fall behind, and nothing new is ever placed.
  buildCase({
    name: 'flock-turned-off-with-animals-out',
    seed: 0x5ca19a2d,
    want: 0,
    phase: RUN_PHASE_RUNNING,
    tick: 500,
    runTicks: 540,
    player: { x: 0, y: 0, ...STILL },
    animals: [{ x: 300, y: 0 }, { x: -200, y: 200 }],
    ticks: 120,
  }),
];

// ---------------------------------------------------------------------------------------------
// sheepRayHit: posed, not driven - it answers a question and has no state.
// ---------------------------------------------------------------------------------------------
const rayWorld: World = new Simulation({ seed: 7, heroId: 0, levelId: 'mossy-mayhem' }).world;
rayWorld.sheep.count = 0;
// Deliberately NOT in distance order along the +x axis, so "nearest along the ray" and "first in
// the array" give different answers and a port that returned the wrong one is caught.
for (const [x, y] of [[600, 0], [200, 0], [400, 0], [300, 220]] as const) {
  allocSheep(rayWorld.sheep, x, y, 1);
}

const rayProbes = [
  { name: 'nearest-not-first', ox: 0, oy: 0, dx: 1, dy: 0, len: 5000 },
  { name: 'stops-short-of-all', ox: 0, oy: 0, dx: 1, dy: 0, len: 100 },
  { name: 'behind-the-origin', ox: 0, oy: 0, dx: -1, dy: 0, len: 5000 },
  { name: 'misses-every-body', ox: 0, oy: 500, dx: 1, dy: 0, len: 5000 },
  { name: 'grazes-the-edge', ox: 0, oy: SHEEP_RADIUS - 0.5, dx: 1, dy: 0, len: 5000 },
  { name: 'just-outside-the-edge', ox: 0, oy: SHEEP_RADIUS + 0.5, dx: 1, dy: 0, len: 5000 },
  { name: 'diagonal-to-the-off-axis-body', ox: 0, oy: 0, dx: 0.80622577482985, dy: 0.59161283081, len: 5000 },
].map((p) => ({ ...p, hit: sheepRayHit(rayWorld, p.ox, p.oy, p.dx, p.dy, p.len) }));

// ---------------------------------------------------------------------------------------------
// takeSheepIn: a sequence, because each call MUTATES - it frees a body, bumps the tally and
// pushes an event. One per call even when the circle covers two.
// ---------------------------------------------------------------------------------------------
const takeWorld: World = new Simulation({ seed: 7, heroId: 0, levelId: 'mossy-mayhem' }).world;
takeWorld.sheep.count = 0;
takeWorld.tick = 4242;
for (const [x, y] of [[0, 0], [20, 0], [500, 500]] as const) {
  allocSheep(takeWorld.sheep, x, y, 1);
}

const takeProbes: unknown[] = [];
for (const p of [
  // Covers the first TWO animals; must take exactly one, leaving the other standing.
  { name: 'covers-two-takes-one', x: 10, y: 0, r: 40 },
  // The survivor of the pair, which swap-remove has moved, is still takeable where it stands.
  { name: 'takes-the-survivor', x: 10, y: 0, r: 40 },
  // Nothing within reach.
  { name: 'empty-ground', x: -900, y: -900, r: 40 },
  // Exactly on the boundary: `> reach2` is a miss, so touching at the sum of the radii IS a hit.
  { name: 'exactly-at-reach', x: 500 + 30 + SHEEP_RADIUS, y: 500, r: 30 },
]) {
  const before = { count: takeWorld.sheep.count, taken: takeWorld.stats.sheepTaken, events: takeWorld.events.writeCursor };
  const got = takeSheepIn(takeWorld, p.x, p.y, p.r);
  const i = (takeWorld.events.writeCursor - 1) & takeWorld.events.mask;
  takeProbes.push({
    name: p.name,
    x: f64(p.x), y: f64(p.y), r: f64(p.r),
    result: got,
    countBefore: before.count,
    countAfter: takeWorld.sheep.count,
    sheepTakenAfter: f64(takeWorld.stats.sheepTaken),
    eventsPushed: takeWorld.events.writeCursor - before.events,
    // The event's own payload, when one was pushed. The ring is not hashed and systems-fixture.json
    // records only how many events a stage pushed, so without this the KIND and the payload are
    // unchecked - which is exactly how EV_PHASE_CHANGED came to be ported as the wrong number.
    event: takeWorld.events.writeCursor > before.events
      ? {
          kind: takeWorld.events.kind[i],
          tick: takeWorld.events.tick[i],
          a: f32(takeWorld.events.a[i]),
          b: f32(takeWorld.events.b[i]),
          c: f32(takeWorld.events.c[i]),
          d: f32(takeWorld.events.d[i]),
        }
      : null,
  });
}

const fixture = {
  note:
    "Mossy Mayhem's flock, driven. The SHEEP RNG STATE is compared every tick alongside the " +
    'columns: every decision this system makes is a draw, and a port that took a different NUMBER ' +
    'of them still puts each animal somewhere plausible while desynchronising every future roll. ' +
    'The spawn ternaries and the rejection loop exist to keep that count fixed and are cased ' +
    'directly.',
  dt: f64(DT),
  sheepRadius: f64(SHEEP_RADIUS),
  sheepSpawnGap: f64(SHEEP_SPAWN_GAP),
  levelSheepCounts: { scrapyard: 0, mossyMayhem: 4, cityChaos: 0 },
  shape: (() => {
    const w = new Simulation({ seed: 1, heroId: 0, levelId: 'mossy-mayhem' }).world;
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
  rayProbes,
  takeProbes,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture, null, 1)}\n`);

console.log(
  `wrote goldens/sheep-fixture.json  (${cases.length} cases, ` +
    `${cases.reduce((a, c) => a + c.ticks, 0)} ticks, ${rayProbes.length} ray probes, ` +
    `${takeProbes.length} take probes)`,
);
