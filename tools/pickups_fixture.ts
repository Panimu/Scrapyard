/**
 * GOLDEN FIXTURE for S10 - updatePickups. Feeds `cs/tests/.../PickupsTests.cs`.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS FIXTURE IS SHAPED THE WAY IT IS
 * ---------------------------------------------------------------------------------------------
 * The stage is two halves with completely different characters, so it is measured two ways.
 *
 * The DROP half is branch logic over the kill feed - which kills pay a chest, when the soft cap
 * retires a gem, which gem it merges into, what happens when the pool is genuinely exhausted. Those
 * cases pose an exact pool and an exact feed, run one tick, and compare everything.
 *
 * The MAGNET half is an INTEGRATOR, and an integrator cannot be checked at its endpoints: a gem
 * that arrives at the player would arrive under almost any wrong constant. So those cases run for
 * as many ticks as the approach takes and compare every gem's position and velocity on every one of
 * them, bit for bit. The tangential damp in particular is invisible in a final position - it is the
 * SHAPE of the curve, and only a per-tick comparison sees a shape.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS COMPARED
 * ---------------------------------------------------------------------------------------------
 * Every live pickup's kind, value, tier, flags, spawnId, position and velocity - positions and
 * velocities as raw f32 bits, because the pool stores them as f32 and a decimal comparison would
 * hide exactly the rounding this port has got wrong before. Plus xpBanked, the four tallies the
 * stage writes (credits, consumables, dice, gemsCollected), the player's hull and magnet timer, the
 * reroll count, the run phase, the scenery version, every event pushed, and the LOOT stream with a
 * draw count.
 *
 * THE LOOT STREAM, because barrel regrowth is the one thing in this file that draws - one draw per
 * revival, none at all when there is nothing to revive. A port that drew when the yard was untouched
 * would desynchronise every barrel afterwards.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CASES THAT EXIST BECAUSE THE CODE SAYS THEY ONCE WENT WRONG
 * ---------------------------------------------------------------------------------------------
 *   A SATURATED FIELD must still drop, by retiring the oldest gem - refusing there refused for the
 *     rest of the run, and players correctly reported enemies had stopped dropping anything.
 *   A BOSS KILLED AT THE CAP must still leave its chest - the chest drop sits ABOVE the cap check
 *     for exactly this reason.
 *   A SPANNER AT FULL HULL is left lying rather than consumed for nothing.
 *   A GEM AT THE FENCE must be clamped inside it - measured at 89 u outside the bound before the
 *     clamp existed, which is XP silently deleted.
 *   A GEM MUST NOT ORBIT: the tangential half of its velocity is damped, and both halves of that
 *     old bug (the orbit and the fling) are one missing term.
 *   A DRAGGED SPANNER PARKED ON THE MECH sits at EXACTLY zero distance, where 1/sqrt(0) is Infinity
 *     and the position becomes NaN.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  ARENA_HALF,
  DT,
  GEM_SOFT_CAP,
  MAX_KILLS_PER_TICK,
  PICKUP_CAP,
} from '../src/core/constants.js';
import { Simulation, type World } from '../src/core/index.js';
import { gemTierForValue } from '../src/core/config/tuning.js';
import { updatePickups } from '../src/core/systems/pickups.js';
import { pushKill } from '../src/core/events/ring.js';
import {
  PICKUP_KIND_CHEST,
  PICKUP_KIND_CREDIT,
  PICKUP_KIND_DICE,
  PICKUP_KIND_GEM,
  PICKUP_KIND_MAGNET,
  PICKUP_KIND_REPAIR,
  allocPickup,
} from '../src/core/entity/pickupPool.js';
import { ENEMY_FLAG_BOSS } from '../src/core/entity/enemyPool.js';
import { FLAVOURS } from '../src/core/content/enemyCatalog.js';
import {
  BARREL_REGROW_MIN_DIST,
  SCRAP_BARREL,
  destroyScenery,
} from '../src/core/content/scenery.js';
import { Rng } from '../src/core/rng.js';

const OUT_PATH = resolve(process.cwd(), 'goldens/pickups-fixture.json');

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

function lootState(w: World): string[] {
  const s = { a: 0, b: 0, c: 0, d: 0 };
  w.rng.loot.save(s);
  return [u32(s.a), u32(s.b), u32(s.c), u32(s.d)];
}

/**
 * How many draws separate two saved states, by replaying the stream between them.
 *
 * A raw four-word diff says only "wrong"; a draw count says "advanced 1 draw where 0 were expected",
 * which names the bug - regrowth drawing on a yard with nothing to revive.
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
        u32(at.c) === after[2] && u32(at.d) === after[3]) return n;
    probe.nextFloat();
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------

interface Drop {
  kind: number;
  value: number;
  tier?: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** Defaults to a monotonic counter, so "oldest" is the order they are listed in. */
  spawnId?: number;
}

interface Kill {
  x: number;
  y: number;
  xpValue: number;
  archetype?: number;
  flavour?: number;
  flags?: number;
}

interface CaseSpec {
  name: string;
  levelId?: string;
  /** Ticks to run. The magnet cases need the whole approach; the drop cases need one. */
  ticks: number;
  drops?: Drop[];
  /** Kills fed in on tick 0 only, unless `killsEveryTick`. */
  kills?: Kill[];
  killsEveryTick?: boolean;
  playerX?: number;
  playerY?: number;
  hp?: number;
  magnetSec?: number;
  /** Seeds `runTicks`, which is what barrel regrowth counts. */
  runTicks?: number;
  /** Breaks this many barrels before the case starts, so there is something to revive. */
  breakBarrels?: number;
  /**
   * Stands the player ON a barrel and breaks every barrel within the regrow minimum distance of it,
   * so EVERY broken drum is one the player is looking at and nothing is eligible to come back.
   *
   * Posed this way rather than by naming a coordinate, because the coordinate is a function of the
   * seed and the layout generator: a hardcoded one would quietly stop being a barrel the day either
   * moved, and the case would go on passing while measuring nothing. It reports where it stood, so
   * the port reproduces the same position rather than re-deriving it.
   *
   * Without this, "break 40 barrels" takes the first forty in the grid - which are scattered across
   * the whole yard - so the minimum-distance rule is never asked anything, and the case regrew a
   * barrel exactly like the positive one beside it.
   */
  standOnABarrel?: boolean;
  /** Pads the pool with this many far-away gems, to reach the soft cap. */
  padGems?: number;
  /** What each padding entry is worth. 1 unless a case is about the value ceiling. */
  padValue?: number;
  /** What KIND the padding is. Gems unless a case needs the pool full of things a retire skips. */
  padKind?: number;
  /**
   * Allocates the posed drops BEFORE the padding, making them the OLDEST things in the pool.
   *
   * Needed by the one case that has to separate "nearest to the retired gem" from "nearest to the
   * player": the retired gem has to be somewhere the player is not, with a neighbour of its own.
   */
  dropsFirst?: boolean;
  /** Overrides the pickup radius on the resolved stat block. */
  pickupRadius?: number;
}

const CASES: CaseSpec[] = [];

function buildCase(spec: CaseSpec) {
  const wantLevel = spec.levelId ?? 'scrapyard';
  const sim = new Simulation({ seed: 0x5ca19a2d, heroId: 0, levelId: wantLevel });
  const w: World = sim.world;
  // A WRONG LEVEL ID FALLS BACK SILENTLY. The moss case was written as 'mossy', which is not an id,
  // so it built the Scrapyard and reported the Scrapyard's numbers while claiming to be about the
  // lattice. Nothing in the fixture or the port would have noticed.
  if (w.level.id !== wantLevel) {
    throw new Error(`${spec.name}: asked for level '${wantLevel}' and got '${w.level.id}'`);
  }

  let px = spec.playerX ?? 0;
  let py = spec.playerY ?? 0;
  if (spec.standOnABarrel === true) {
    if (w.scenery.kind !== 'piles') throw new Error(`${spec.name}: no barrels on this level`);
    const s0 = w.scenery;
    const at = Array.from(s0.radius.keys())
      .find((i) => s0.variant[i] === SCRAP_BARREL && s0.radius[i] > 0);
    if (at === undefined) throw new Error(`${spec.name}: the yard holds no barrel to stand on`);
    px = s0.x[at];
    py = s0.y[at];
  }
  w.player.x = px;
  w.player.y = py;
  w.player.prevX = w.player.x;
  w.player.prevY = w.player.y;
  if (spec.hp !== undefined) w.player.hp = spec.hp;
  w.player.magnetSec = spec.magnetSec ?? 0;
  if (spec.pickupRadius !== undefined) w.player.stats.pickupRadius = spec.pickupRadius;

  w.tick = 900;
  w.runTicks = spec.runTicks ?? 0;

  // BROKEN BEFORE THE CASE RUNS, so regrowth has something eligible. destroyScenery is the same
  // call a shell makes, so the cells left behind are exactly what the game leaves behind.
  let broken = 0;
  const nearOnly = spec.standOnABarrel === true;
  const near2 = BARREL_REGROW_MIN_DIST * BARREL_REGROW_MIN_DIST;
  // ONLY THE SCRAPYARD HAS PILES. The two lattices are a different shape entirely - no radius
  // array to walk - and nothing on them breaks and comes back anyway.
  const piles = w.scenery.kind === 'piles' ? w.scenery : undefined;
  const wanted = piles === undefined ? 0
    : spec.standOnABarrel === true ? piles.radius.length : (spec.breakBarrels ?? 0);
  for (let i = 0; piles !== undefined && i < piles.radius.length && broken < wanted; i++) {
    if (piles.variant[i] !== SCRAP_BARREL || piles.radius[i] === 0) continue;
    if (nearOnly) {
      const dx = piles.x[i] - w.player.x;
      const dy = piles.y[i] - w.player.y;
      if (dx * dx + dy * dy >= near2) continue;
    }
    destroyScenery(piles, i);
    broken++;
  }
  if (wanted > 0 && broken === 0) {
    throw new Error(`${spec.name}: broke no barrels, so the case measures nothing`);
  }

  w.pickups.count = 0;
  w.pickups.freeCount = w.pickups.capacity;
  for (let i = 0; i < w.pickups.capacity; i++) {
    w.pickups.freeSlots[i] = w.pickups.capacity - 1 - i;
    // GENERATIONS START AT 1. Zero here is not a harmless reset: `packHandle(slot 0, gen 0)` is 0,
    // which IS `NULL_HANDLE`, so the very first allocation reads back as a failed one - dropChest
    // returned early, the chest kept a zeroed AUTO flag and pushed no event, and the fixture
    // recorded that as the truth. Caught by a case that showed one event where two were expected.
    w.pickups.generation[i] = 1;
  }

  // PADDING FIRST, so the posed drops are the NEWEST and the padding is what a retire reaches for.
  // Reversed by `dropsFirst`, for the case that needs the retired gem to be one it posed.
  let nextId = 1;
  const placeDrops = () => {
    for (const d of spec.drops ?? []) {
      allocPickup(w.pickups, d.kind, d.value, d.tier ?? 0, d.x, d.y, d.spawnId ?? nextId++);
      const dense = w.pickups.count - 1;
      w.pickups.vx[dense] = d.vx ?? 0;
      w.pickups.vy[dense] = d.vy ?? 0;
    }
  };
  if (spec.dropsFirst === true) placeDrops();
  for (let i = 0; i < (spec.padGems ?? 0); i++) {
    // Spread along a line far outside any radius, each one further than the last, so "nearest to
    // the retired gem" has a single unambiguous answer rather than a tie.
    const pv = spec.padValue ?? 1;
    allocPickup(w.pickups, spec.padKind ?? PICKUP_KIND_GEM, pv,
                gemTierForValue(pv, w.config.tuning.pickups), 4000 + i * 4, 4000, nextId++);
  }
  if (spec.dropsFirst !== true) placeDrops();

  const before = lootState(w);
  let prevLoot = before;

  const perTick: unknown[] = [];
  for (let t = 0; t < spec.ticks; t++) {
    w.tick = 900 + t;
    // ADVANCED HERE, because updatePickups does not move it - systems/clock.ts does, and this
    // fixture calls the one stage rather than the whole step. Barrel regrowth is a modulo on this
    // clock, so a fixture that left it standing still could never cross the beat: the first draft
    // of the three regrowth cases all reported zero draws and were indistinguishable from each
    // other. Incremented BEFORE the stage, matching S1's position ahead of S10.
    if (t > 0) w.runTicks++;
    w.kills.count = 0;
    if ((spec.kills?.length ?? 0) > 0 && (t === 0 || spec.killsEveryTick === true)) {
      for (const k of spec.kills ?? []) {
        pushKill(w.kills, k.x, k.y, k.xpValue, k.archetype ?? 0, k.flavour ?? 0, k.flags ?? 0);
      }
    }

    const evBefore = w.events.writeCursor;
    updatePickups(w, DT);
    const now = lootState(w);

    perTick.push({
      count: w.pickups.count,
      // PACKED, one hex run per column. A pool of 500 gems over several ticks would be megabytes
      // as JSON objects; as four packed strings it is kilobytes, and the C# reader slices by index.
      kinds: Array.from({ length: w.pickups.count }, (_, i) => w.pickups.kind[i]).join(','),
      values: Array.from({ length: w.pickups.count }, (_, i) => w.pickups.value[i]).join(','),
      tiers: Array.from({ length: w.pickups.count }, (_, i) => w.pickups.tier[i]).join(','),
      flags: Array.from({ length: w.pickups.count }, (_, i) => w.pickups.flags[i]).join(','),
      spawnIds: Array.from({ length: w.pickups.count }, (_, i) => w.pickups.spawnId[i]).join(','),
      pos: Array.from({ length: w.pickups.count },
        (_, i) => f32(w.pickups.x[i]) + f32(w.pickups.y[i])).join(''),
      vel: Array.from({ length: w.pickups.count },
        (_, i) => f32(w.pickups.vx[i]) + f32(w.pickups.vy[i])).join(''),

      xpBanked: f64(w.xpBanked),
      credits: f64(w.stats.credits),
      consumables: f64(w.stats.consumables),
      dice: f64(w.stats.dice),
      gems: f64(w.stats.gemsCollected),
      hp: f64(w.player.hp),
      magnetSec: f64(w.player.magnetSec),
      rerolls: w.levelUp.rerolls,
      phase: w.phase,
      sceneryVersion: w.scenery.version,
      sceneryCount: w.scenery.count,
      events: eventsSince(w, evBefore),
      lootDraws: drawsBetween(prevLoot, now),
      loot: now,
    });
    prevLoot = now;
  }

  CASES.push({
    ...({
      name: spec.name,
      levelId: spec.levelId ?? 'scrapyard',
      ticks: spec.ticks,
      playerX: f64(px),
      playerY: f64(py),
      hp: f64(spec.hp ?? -1),
      magnetSec: f64(spec.magnetSec ?? 0),
      runTicks: spec.runTicks ?? 0,
      breakBarrels: spec.breakBarrels ?? 0,
      standOnABarrel: spec.standOnABarrel === true,
      brokenCount: broken,
      padGems: spec.padGems ?? 0,
      padValue: spec.padValue ?? 1,
      padKind: spec.padKind ?? PICKUP_KIND_GEM,
      dropsFirst: spec.dropsFirst === true,
      pickupRadius: f64(spec.pickupRadius ?? -1),
      killsEveryTick: spec.killsEveryTick === true,
      drops: (spec.drops ?? []).map((d, i) => ({
        kind: d.kind, value: d.value, tier: d.tier ?? 0,
        x: f64(d.x), y: f64(d.y), vx: f64(d.vx ?? 0), vy: f64(d.vy ?? 0),
        spawnId: d.spawnId ?? -1,
      })),
      kills: (spec.kills ?? []).map((k) => ({
        x: f64(k.x), y: f64(k.y), xpValue: k.xpValue,
        archetype: k.archetype ?? 0, flavour: k.flavour ?? 0, flags: k.flags ?? 0,
      })),
      // THE RESOLVED STAT BLOCK, restored by the port rather than re-resolved there - the same
      // convention every other system fixture follows, and for the same reason: a case that plants
      // state after the world is built holds the RUN-START numbers.
      // THE RUN-START STACKS. A chest reads them to build its reel pool, and Slate opens holding
      // the Cannon at tier 1 - so the pool has one symbol in it, and `nextInt(1)` draws nothing. A
      // port that started from an all-zero table would find an EMPTY pool, take the consolation
      // path instead, and draw where the original did not.
      stacks: Array.from(w.levelUp.stacks).join(','),
      resolvedPickupRadius: f64(w.player.stats.pickupRadius),
      resolvedMaxHp: f64(w.player.stats.maxHp),
      startHp: f64(spec.hp ?? sim.world.player.stats.maxHp),
      streamBefore: before,
      perTick,
    } as unknown as CaseSpec),
  });
}

function eventsSince(w: World, from: number): unknown[] {
  const out: unknown[] = [];
  for (let c = from; c < w.events.writeCursor; c++) {
    const i = c & (w.events.capacity - 1);
    out.push({
      kind: w.events.kind[i],
      a: f32(w.events.a[i]), b: f32(w.events.b[i]),
      c: f32(w.events.c[i]), d: f32(w.events.d[i]),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------------------------

const CHEST_DROPPER = FLAVOURS.findIndex((f) => f.dropsChest === true);
if (CHEST_DROPPER < 0) throw new Error('no flavour drops a chest - the chest cases are stale');

// A KILL BECOMES A GEM on the tick it happened. Three kills at three values, so all three gem tiers
// the values reach are exercised and the derived spawnIds are visibly `1 + tick*128 + k`.
buildCase({
  name: 'kills-become-gems',
  ticks: 2,
  playerX: 3000, playerY: 3000,
  kills: [
    { x: 100, y: 0, xpValue: 1 },
    { x: 0, y: 100, xpValue: 9 },
    { x: -100, y: 0, xpValue: 45 },
  ],
});

// A ZERO-VALUE KILL PAYS NOTHING. The despawn ring never writes a feed entry at all, but the guard
// is here too and a port that dropped it would hand out white gems for enemies that walked away.
buildCase({
  name: 'a-zero-value-kill-drops-nothing',
  ticks: 1,
  playerX: 3000, playerY: 3000,
  kills: [{ x: 100, y: 0, xpValue: 0 }, { x: 200, y: 0, xpValue: 5 }],
});

// A BOSS LEAVES A CHEST as well as its core, and the chest is flagged AUTO so it is collected
// without being walked over.
buildCase({
  name: 'a-boss-leaves-a-chest',
  ticks: 1,
  playerX: 3000, playerY: 3000,
  kills: [{ x: 100, y: 0, xpValue: 500, flags: ENEMY_FLAG_BOSS }],
});

// AND SO DOES THE CHEST DROPPER, read off the FLAVOURS table rather than tested by id.
buildCase({
  name: 'the-chest-dropper-leaves-one-too',
  ticks: 1,
  playerX: 3000, playerY: 3000,
  kills: [{ x: 100, y: 0, xpValue: 3, flavour: CHEST_DROPPER }],
});

// THE SOFT CAP RETIRES THE OLDEST GEM rather than refusing the drop. The pad is laid down first so
// every one of them is older than the kill, and they are spread along a line so "nearest to the
// retired gem" has exactly one answer.
//
// The retired gem is MARKED, not removed - S12 owns removal - so the count goes UP by one on this
// tick even though a gem was retired, and the new drop sits above it.
buildCase({
  name: 'the-soft-cap-retires-the-oldest-gem',
  ticks: 1,
  playerX: 3000, playerY: 3000,
  padGems: GEM_SOFT_CAP,
  kills: [{ x: 100, y: 0, xpValue: 9 }],
});

// AND IT MERGES INTO THE GEM NEAREST THE RETIRED ONE, not the one nearest the player. The merge is
// meant to be invisible: two gems in a forgotten corner become one richer gem in that same corner.
// Sending the value to the player's neighbourhood instead would be a slow teleport of XP across the
// map, and would make the gems around the player silently swell for no reason on screen.
//
// So the two candidates are pulled apart: the oldest gem and its neighbour sit alone in the far
// corner, and the whole rest of the field is near the mech. A port that measured from the player
// would merge into the pack instead of into the neighbour, and every value in the corner would be
// wrong while every value in the pack would be too.
buildCase({
  name: 'a-retire-merges-into-the-neighbour-not-the-pack',
  ticks: 1,
  playerX: 3000, playerY: 3000,
  dropsFirst: true,
  drops: [
    { kind: PICKUP_KIND_GEM, value: 7, x: -5000, y: -5000 },
    { kind: PICKUP_KIND_GEM, value: 11, x: -5050, y: -5000 },
  ],
  padGems: GEM_SOFT_CAP - 2,
  kills: [{ x: 100, y: 0, xpValue: 9 }],
});

// A BOSS KILLED AT THE CAP STILL LEAVES ITS CHEST. This is the bug the chest drop was moved ABOVE
// the cap check to fix: it used to sit below a `continue`, so any boss in the back half of a long
// run left nothing.
buildCase({
  name: 'a-boss-at-the-cap-still-leaves-its-chest',
  ticks: 1,
  playerX: 3000, playerY: 3000,
  padGems: GEM_SOFT_CAP,
  kills: [{ x: 100, y: 0, xpValue: 500, flags: ENEMY_FLAG_BOSS }],
});

// A RETIRED GEM SATURATES RATHER THAN WRAPPING. The pool stores a value as u16, so a merge that
// carried it past 65535 would wrap round to a white gem - the richest gem in the yard becoming the
// poorest, silently. The pad is laid down at the ceiling so the merge has to clamp.
buildCase({
  name: 'a-merge-saturates-rather-than-wrapping',
  ticks: 1,
  playerX: 3000, playerY: 3000,
  padGems: GEM_SOFT_CAP,
  padValue: 65535,
  kills: [{ x: 100, y: 0, xpValue: 9 }],
});

// THE OLDEST GEM IS THE ONLY GEM, so there is nothing to merge into and retiring it would delete
// its XP outright. It stays where it is and the drop simply takes another slot - PICKUP_CAP has
// headroom above the soft cap for exactly this. Posed by padding with consumables, which share the
// pool but are skipped by kind in both of the retire passes.
buildCase({
  name: 'the-only-gem-is-not-retired',
  ticks: 1,
  playerX: 3000, playerY: 3000,
  padGems: GEM_SOFT_CAP - 1,
  padKind: PICKUP_KIND_CREDIT,
  drops: [{ kind: PICKUP_KIND_GEM, value: 40, x: -3000, y: -3000 }],
  kills: [{ x: 100, y: 0, xpValue: 9 }],
});

// AND WHEN THE POOL IS GENUINELY EXHAUSTED the drop is ABSORBED rather than discarded - the
// player's XP is never quietly deleted. Only reachable by filling PICKUP_CAP itself, which is above
// the soft cap: the retire marks one dead but S12 has not run, so the allocation still fails.
buildCase({
  name: 'an-exhausted-pool-absorbs-rather-than-discards',
  ticks: 1,
  playerX: 3000, playerY: 3000,
  padGems: PICKUP_CAP,
  kills: [{ x: 100, y: 0, xpValue: 9 }],
});

// ---- the magnet ------------------------------------------------------------------------------

// THE APPROACH, tick by tick. A gem well inside the field, at rest, with no sideways component: the
// pure radial case, and the one that pins magnetAccel and magnetMaxSpeed. Run until it arrives.
buildCase({
  name: 'a-gem-accelerates-in-and-is-collected',
  ticks: 23,
  drops: [{ kind: PICKUP_KIND_GEM, value: 5, tier: 1, x: 90, y: 0 }],
  pickupRadius: 200,
});

// THE TANGENTIAL DAMP, which is the whole reason gems stopped orbiting - and it is INVISIBLE in a
// final position, because a gem arrives either way. What differs is the SHAPE of the curve, so this
// gem is launched hard sideways and every tick of the arc is compared.
//
// Without the damp this is a satellite: it swings round, leaves the radius, and is flung. With it
// the sideways half is gone in about a sixth of a second and the gem curves in and lands.
buildCase({
  name: 'a-sideways-gem-curves-in-rather-than-orbiting',
  ticks: 45,
  drops: [{ kind: PICKUP_KIND_GEM, value: 5, tier: 1, x: 120, y: 0, vx: 0, vy: 560 }],
  pickupRadius: 260,
});

// OUTSIDE THE FIELD THE VELOCITY IS ZEROED rather than left to coast. The gem is given a velocity
// and put beyond the radius: it must stop dead where it is, not drift.
buildCase({
  name: 'a-gem-outside-the-field-stops-dead',
  ticks: 3,
  drops: [{ kind: PICKUP_KIND_GEM, value: 5, tier: 1, x: 800, y: 0, vx: -400, vy: 120 }],
  pickupRadius: 100,
});

// THE BOSS CORE IGNORES THE RADIUS ENTIRELY. Same position, same radius, top tier - and it comes.
// A 500 XP drop must never be lost to the player having walked away from where the boss fell.
buildCase({
  name: 'the-boss-core-comes-from-anywhere',
  ticks: 4,
  drops: [{ kind: PICKUP_KIND_GEM, value: 500, tier: 4, x: 800, y: 0 }],
  pickupRadius: 100,
});

// A RUNNING MAGNET PUTS EVERY GEM IN THE FIELD, whatever the distance - and sweeps up coins and
// spanners too, but NOT the dice and NOT a chest. All four kinds are posed at the same distance so
// the only thing separating them is the rule.
buildCase({
  name: 'a-running-magnet-drags-coins-and-spanners-but-not-dice',
  ticks: 6,
  hp: 50,
  magnetSec: 4,
  pickupRadius: 60,
  drops: [
    { kind: PICKUP_KIND_GEM, value: 5, tier: 1, x: 600, y: 0 },
    { kind: PICKUP_KIND_CREDIT, value: 12, x: 0, y: 600 },
    { kind: PICKUP_KIND_REPAIR, value: 30, x: -600, y: 0 },
    { kind: PICKUP_KIND_DICE, value: 1, x: 0, y: -600 },
  ],
});

// THE FENCE. A gem crossing at a shallow angle at 600 u/s covers 10 u per tick against an 18 u
// collect radius, so it can miss the player entirely - and standing AT the fence, the miss throws
// it into the void where the player can never reach it. The mech is put ON the bound and the gem
// aimed past it.
buildCase({
  name: 'the-magnet-cannot-throw-a-gem-through-the-fence',
  ticks: 12,
  playerX: 6144, playerY: 0,
  pickupRadius: 400,
  drops: [{ kind: PICKUP_KIND_GEM, value: 5, tier: 1, x: 6100, y: 200, vx: 500, vy: -560 }],
});

// ---- consumables -----------------------------------------------------------------------------

// WALKED OVER, not magnetised: a consumable inside its own generous radius is taken, and one just
// outside it is not moved at all.
buildCase({
  name: 'consumables-are-walked-over-not-chased',
  ticks: 2,
  hp: 50,
  drops: [
    { kind: PICKUP_KIND_CREDIT, value: 12, x: 20, y: 0 },
    { kind: PICKUP_KIND_CREDIT, value: 12, x: 300, y: 0 },
  ],
});

// A SPANNER AT FULL HULL IS LEFT WHERE IT LIES. It used to clamp to maxHp on collection, which is
// the same thing as deleting it - and full health is the state you spend most of a good run in, so
// the one reward that answers "I am about to die" was mostly being destroyed by people who were
// fine. Two ticks at full hull, then the hull drops and the same spanner is taken.
buildCase({
  name: 'a-spanner-at-full-hull-waits',
  ticks: 1,
  drops: [{ kind: PICKUP_KIND_REPAIR, value: 30, x: 5, y: 0 }],
});

buildCase({
  name: 'and-is-taken-once-there-is-damage-to-repair',
  ticks: 1,
  hp: 40,
  drops: [{ kind: PICKUP_KIND_REPAIR, value: 30, x: 5, y: 0 }],
});

// AND IT NEVER OVERHEALS. A spanner tops you up; it does not bank a buffer the HUD cannot show.
// Posed with the hull close enough to full that the heal would overshoot, which the two cases above
// deliberately do not - one is at full and one is 80 short of it, so neither ever reaches the clamp.
buildCase({
  name: 'a-spanner-never-overheals',
  ticks: 1,
  hp: 110,
  drops: [{ kind: PICKUP_KIND_REPAIR, value: 30, x: 5, y: 0 }],
});

// A SPANNER PARKED ON THE MECH AT EXACTLY ZERO DISTANCE. Dragged in by a magnet, refused at full
// hull, and now sitting on the pixel: 1/sqrt(0) is Infinity and 0*Infinity is NaN, so a port that
// let this reach the normalise would produce a pickup that can never be collected and never draws.
buildCase({
  name: 'a-refused-spanner-at-zero-distance-is-not-nan',
  ticks: 3,
  magnetSec: 4,
  drops: [{ kind: PICKUP_KIND_REPAIR, value: 30, x: 0, y: 0 }],
});

// THE DICE IS BANKED, NOT SPENT - the only thing in the yard you decide what to do with later.
buildCase({
  name: 'the-dice-banks-a-reroll',
  ticks: 1,
  drops: [{ kind: PICKUP_KIND_DICE, value: 1, x: 5, y: 0 }],
});

// A MAGNET IS REFRESHED, NOT STACKED. The timer is already part-run when the second one is taken,
// and it must go back to the full duration rather than to the sum.
buildCase({
  name: 'a-second-magnet-refreshes-rather-than-stacks',
  ticks: 2,
  magnetSec: 1.5,
  drops: [{ kind: PICKUP_KIND_MAGNET, value: 0, x: 5, y: 0 }],
});

// A CHEST FREEZES THE WORLD. It is marked dead BEFORE openChest runs, so it cannot be collected a
// second time on the tick the phase changes back, and the run phase moves to CHEST.
buildCase({
  name: 'a-chest-freezes-the-run',
  ticks: 1,
  drops: [{ kind: PICKUP_KIND_CHEST, value: 0, x: 5, y: 0 }],
});

// ---- barrel regrowth -------------------------------------------------------------------------

// THE CADENCE IS ON runTicks AND IT DRAWS ONCE. Seeded one tick short of the period so the case
// crosses it, with barrels already broken far from the mech so there is something eligible.
buildCase({
  name: 'a-barrel-stands-back-up-on-the-beat',
  ticks: 3,
  playerX: -6000, playerY: -6000,
  runTicks: 1079,
  breakBarrels: 40,
});

// AND AN UNTOUCHED YARD NEVER MOVES THE STREAM. Same beat, nothing broken: no candidate, no draw.
// A port that drew first and filtered afterwards would desynchronise every barrel after this tick.
buildCase({
  name: 'an-untouched-yard-draws-nothing',
  ticks: 3,
  playerX: -6000, playerY: -6000,
  runTicks: 1079,
  breakBarrels: 0,
});

// NOR DOES A BROKEN BARREL UNDER THE PLAYER'S NOSE. Everything eligible is inside the minimum
// distance, so the count is zero and the stream stands still - a drum is never seen standing up.
buildCase({
  name: 'a-barrel-the-player-is-standing-over-does-not-come-back',
  ticks: 3,
  runTicks: 1079,
  standOnABarrel: true,
});

// AND NOTHING COMES BACK ON THE LATTICES. A wood the player cut through stays cut.
buildCase({
  name: 'the-moss-lattice-regrows-nothing',
  levelId: 'mossy-mayhem',
  ticks: 3,
  playerX: -6000, playerY: -6000,
  runTicks: 1079,
});

// ---------------------------------------------------------------------------------------------

const W0 = new Simulation({ seed: 1, heroId: 0, levelId: 'scrapyard' }).world;
const T0 = W0.config.tuning.pickups;

const fixture = {
  note: 'Generated by tools/pickups_fixture.ts. Do not edit by hand.',
  constants: {
    gemSoftCap: GEM_SOFT_CAP,
    maxKillsPerTick: MAX_KILLS_PER_TICK,
    maxGemValue: 65535,
    magnetTangentDamp: f64(6),
    gemTierValues: Array.from(T0.gemTierValues, f64),
    magnetAccel: f64(T0.magnetAccel),
    magnetMaxSpeed: f64(T0.magnetMaxSpeed),
    collectRadius: f64(T0.collectRadius),
    consumableRadius: f64(T0.consumableRadius),
    magnetSec: f64(T0.magnetSec),
    barrelRegrowSec: f64(T0.barrelRegrowSec),
    barrelRegrowMinDist: f64(560),
    chestSpawnIdBase: 0x60000000,
  },
  shape: {
    enemyCapacity: W0.enemies.capacity,
    projectileCapacity: W0.projectiles.capacity,
    pickupCapacity: W0.pickups.capacity,
    droneCapacity: W0.drones.capacity,
    sheepCapacity: W0.sheep.capacity,
    eventRingCapacity: W0.events.capacity,
    hitCapacity: W0.hits.capacity,
    beamCapacity: W0.beams.capacity,
    contactCapacity: W0.contacts.capacity,
    maxQueryCandidates: W0.scratch.candidates.length,
    cellSize: W0.spatial.cellSize,
    bucketCount: W0.spatial.bucketCount,
    arenaSize: ARENA_HALF * 2,
    weaponCatalogCount: W0.weaponCatalog.length,
    upgradeCount: W0.upgradeCatalog.length,
  },
  cases: CASES,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`);
const ticks = CASES.reduce((n, c) => n + (c as unknown as { ticks: number }).ticks, 0);
console.log(`wrote ${OUT_PATH}  (${CASES.length} cases, ${ticks} ticks)`);
