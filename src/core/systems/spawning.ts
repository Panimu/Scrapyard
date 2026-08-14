/**
 * S2 - updateSpawning. The director. THE ONLY ENEMY ALLOCATION SITE IN THE SIMULATION.
 *
 * It runs before the spatial hash rebuild (S5) so an enemy is queryable the tick it appears, and
 * before reapDead (S12) so a slot can never be freed and re-allocated inside one tick.
 *
 * ---------------------------------------------------------------------------------------------
 * THE 120-SECOND CYCLE
 * ---------------------------------------------------------------------------------------------
 * A cycle is one creature (content/cycles.ts) in three ranks, on a fixed schedule:
 *
 *      0:00 - 1:00   REGULARS.                    One enemy. Nothing else. Learn it.
 *      1:00 - 1:30   REGULARS + ELITES.           Recoloured, x6 HP, x8 XP, arriving on a timer.
 *      1:30 - 2:00   REGULARS + ELITES + a BOSS.  Recoloured again, blue outline, x34 HP.
 *      2:00          Rollover: a new, tougher creature. NOTHING IS CLEARED.
 *
 * EXACTLY ONE BOSS PER CYCLE, and it is not a finale - it is a tenant. Cycle 3's boss is still on
 * the field in cycle 5 if you never killed it, because a rollover changes what this file SPAWNS
 * and touches nothing already alive. Over a 15-minute run that is seven bosses, and the last four
 * minutes are only survivable if you have been closing them out rather than running.
 *
 * ---------------------------------------------------------------------------------------------
 * PRESSURE, NOT HEADCOUNT
 * ---------------------------------------------------------------------------------------------
 * Regulars drip in while LOCAL PRESSURE - the sum of `RankDef.pressure` over live enemies within
 * THREAT_RADIUS (900 u) - sits under a target that rises one step per cycle:
 *
 *      targetPressure(cycle) = 14 + 4.5 x cycle          14 in cycle 0 -> 45.5 in cycle 7
 *
 * A regular weighs 1, an elite 3, a boss 6. Three consequences that a flat spawn rate does not
 * give you:
 *
 *   - Killing things makes more things arrive, immediately. The horde refills toward the player's
 *     actual clear rate instead of toward a number someone typed in.
 *   - Running away thins the horde, because pressure is LOCAL: the enemies you outran stop
 *     counting once they are past 900 u. Kiting is rewarded on its own terms.
 *   - A BOSS SUPPRESSES SIX REGULARS' WORTH OF SPAWNING WHILE IT LIVES. That is not a side effect
 *     - it is the design. The cannon commits to the boss whether the player likes it or not
 *     (highest-HP targeting), so the rule that makes the boss a problem is the same rule that
 *     clears the room to solve it. The set-piece creates its own space.
 *
 * ---------------------------------------------------------------------------------------------
 * CAPS, AND WHAT HAPPENS AT THEM
 * ---------------------------------------------------------------------------------------------
 *   maxSpawnsPerSec  12   Rate limit. The accumulator is CLAMPED TO 1 after the loop, so blocked
 *                         spawns are never banked. Without that clamp a minute spent in a boss's
 *                         pressure shadow would bank 700 spawns and discharge them as one instant
 *                         wall the moment the boss died - a frame spike and an unfair death from
 *                         a system the player cannot see. Blocked ELITES are dropped for the same
 *                         reason: the timer resets to a full interval rather than to zero.
 *   maxLiveElites     5   Elites stop arriving while five are already near the player, so a
 *                         player who ignores them gets a wall of HP rather than an endless stream.
 *   MAX_LIVE_ENEMIES 300  Hard population cap for phone frame budget. AT THE CAP THE DIRECTOR
 *                         SIMPLY STOPS SPAWNING; nothing is culled, nothing is queued, and
 *                         spawning resumes the tick a slot frees. THE BOSS IGNORES IT - a capped
 *                         field must never be able to cancel a cycle's set-piece.
 *   ENEMY_CAP        512  Pool capacity, above the live cap so `allocEnemy` can never fail during
 *                         a normal run. It is still checked: silently overwriting a live entity
 *                         is the worst class of bug in this design.
 *
 * ---------------------------------------------------------------------------------------------
 * DETERMINISM - the exact `rng.spawn` draw order per spawn
 * ---------------------------------------------------------------------------------------------
 *   1  variant roll                                          1 x nextFloat  (REGULARS ONLY -
 *                                                            elites and bosses are always plain)
 *   2  which non-plain flavour, only if (1) passed           1 x nextInt
 *   3  ring direction, rejection sampled in the unit disc    2 x nextRange per attempt
 *   4  forward-bias redraw, only when moving > 20 u/s and
 *      (3) was behind the player                             2 x nextRange per attempt
 *
 * There is no sprite draw any more: rank picks the recolour arithmetically off the cycle's hull.
 * Changing this order changes every replay and every golden hash - which is intended, and is why
 * the order is written down here rather than left to be inferred from the code.
 */

import { ARENA_HALF, MAX_LIVE_ENEMIES, SPAWN_RADIUS, THREAT_RADIUS } from '../constants.js';
import { cycleIndexAt, type DirectorTuning } from '../config/tuning.js';
import { ARCHETYPES, FLAVOURS, FLAV_PLAIN, type Archetype } from '../content/enemyCatalog.js';
import { MAX_ENEMY_RADIUS } from '../content/cycles.js';
import { pushOutOfScenery } from '../content/scenery.js';
import {
  RANKS,
  RANK_BOSS,
  RANK_ELITE,
  RANK_REGULAR,
  resolveCycle,
  type Rank,
} from '../content/cycles.js';
import {
  ENEMY_FLAG_ANCHORED,
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_DEAD,
  ENEMY_FLAG_ELITE,
  allocEnemy,
  enemyHandleAt,
  enemyIndex,
} from '../entity/enemyPool.js';
import { EV_BOSS_SPAWNED, EV_ENEMY_SPAWNED, pushEvent } from '../events/ring.js';
import type { Vec2 } from '../math/vec2.js';
import type { Rng } from '../rng.js';
import { RUN_PHASE_RUNNING, type World } from '../types.js';

/**
 * Rejection-sampling attempt limit for the unit-disc draw.
 *
 * Acceptance is pi/4 = 78.5%, so the expected cost is 1.27 attempts and 16 failures in a row has
 * probability ~8e-11 - roughly once in 400 million spawns, against ~2700 per run. The bound
 * exists so that a hostile or degenerate RNG cannot hang the tick; the fallback direction is
 * fixed (+x) rather than derived from the failed samples, so it is deterministic.
 */
const MAX_DISC_ATTEMPTS = 16;

export function updateSpawning(world: World, dt: number): void {
  // No-op during INTRO: three seconds to feel the controls with an empty field. INTRO and RUNNING
  // otherwise share the whole pipeline, so this is the only place the intro exists at all.
  if (world.phase !== RUN_PHASE_RUNNING) return;

  const dir = world.director;
  const t = world.config.tuning.director;
  const runSec = world.runSec;

  // --- the cycle -------------------------------------------------------------------------
  const index = cycleIndexAt(runSec, t);
  if (dir.cycle.index !== index) {
    // The ONLY thing a rollover does. No cull, no despawn, no state on the existing enemies -
    // "unkilled enemies persevere" is the absence of code, not the presence of it.
    resolveCycle(index, dir.cycle);
    dir.cycleIndex = index;
    // Zero, not `interval`: the elite phase opens with an arrival rather than with a wait.
    dir.eliteTimer = 0;
  }
  const cycleTime = runSec - index * t.cycleSeconds;
  dir.cyclePhase = cycleTime >= t.bossFromSec ? 2 : cycleTime >= t.eliteFromSec ? 1 : 0;

  // --- local pressure ---------------------------------------------------------------------
  dir.localPressure = measureLocalPressure(world);
  dir.targetPressure = t.pressureBase + t.pressurePerCycle * index;

  // --- the cycle's boss ---------------------------------------------------------------------
  // `bossCycle` is set only on a SUCCESSFUL allocation, so a momentarily full pool retries next
  // tick rather than costing the cycle its set-piece.
  if (dir.cyclePhase === 2 && dir.bossCycle !== index) {
    if (spawnRank(world, RANK_BOSS, t) >= 0) dir.bossCycle = index;
  }

  // --- elites ------------------------------------------------------------------------------
  if (dir.cyclePhase >= 1) {
    dir.eliteTimer -= dt;
    if (dir.eliteTimer <= 0) {
      if (dir.liveElites < t.maxLiveElites && world.enemies.count < MAX_LIVE_ENEMIES) {
        if (spawnRank(world, RANK_ELITE, t) >= 0) {
          dir.localPressure += RANKS[RANK_ELITE].pressure;
        }
      }
      // Reset to a FULL interval whether or not the spawn happened. A blocked elite is dropped,
      // never banked - same rule as the spawn accumulator's clamp, and for the same reason.
      dir.eliteTimer = eliteIntervalAt(index, t);
    }
  } else {
    dir.eliteTimer = 0;
  }

  // --- the ordinary drip --------------------------------------------------------------------
  dir.spawnAccumulator += t.maxSpawnsPerSec * dt;

  while (
    dir.spawnAccumulator >= 1 &&
    dir.localPressure < dir.targetPressure &&
    world.enemies.count < MAX_LIVE_ENEMIES
  ) {
    dir.spawnAccumulator -= 1;
    if (spawnRank(world, RANK_REGULAR, t) < 0) break; // pool exhausted - stop, do not spin
    dir.localPressure += RANKS[RANK_REGULAR].pressure;
  }

  // Never bank more than one spawn's worth of credit. See the CAPS note at the top of the file:
  // this single line is what stops a pressure shadow from discharging as a wall.
  if (dir.spawnAccumulator > 1) dir.spawnAccumulator = 1;
}

/** Seconds between elite drop-ins in `index`. 8.0 s in cycle 0, floored at 4.5 s. */
function eliteIntervalAt(index: number, t: DirectorTuning): number {
  const v = t.eliteIntervalBase - t.eliteIntervalPerCycle * index;
  return v > t.eliteIntervalMin ? v : t.eliteIntervalMin;
}

// -------------------------------------------------------------------------------------------
// Local pressure
// -------------------------------------------------------------------------------------------

/**
 * Sum of rank pressure over live enemies within THREAT_RADIUS of the player. Also writes the
 * nearby elite count to `director.liveElites`, because it is the same scan and a second pass over
 * 300 enemies to count one flag would be silly. It goes on the director rather than into a
 * module-level variable for the usual reason: two worlds are stepped in the same process by the
 * determinism suite, and module scratch would silently cross between them.
 *
 * RANK COMES FROM THE FLAGS, NOT FROM A POOL FIELD. Elite and boss are already single bits in
 * `flags`, which this loop must load anyway to skip the dead - so pressure costs one extra test
 * per enemy and the pool layout does not grow by a byte.
 *
 * A LINEAR SCAN, ON PURPOSE - this is the one place in the sim where the spatial hash is the
 * wrong tool. THREAT_RADIUS is 900 u against a 64 u cell, so a circle query would walk ~700 cells
 * and do 700 bucket probes to filter at most 300 enemies that already sit contiguously in two
 * typed arrays. The scan is fewer operations, perfectly cache-linear, and exact.
 *
 * It is also immune to the hash being one tick stale: S5 rebuilt it BEFORE S12 reaped, so at S2
 * the hash still holds dense indices for enemies that no longer exist. Reading the pool directly
 * cannot be wrong.
 */
function measureLocalPressure(world: World): number {
  const p = world.enemies;
  const px = world.player.x;
  const py = world.player.y;
  const r2 = THREAT_RADIUS * THREAT_RADIUS;
  const x = p.x;
  const y = p.y;
  const flags = p.flags;
  const n = p.count;

  const wElite = RANKS[RANK_ELITE].pressure;
  const wBoss = RANKS[RANK_BOSS].pressure;
  const wRegular = RANKS[RANK_REGULAR].pressure;

  let sum = 0;
  let elites = 0;
  for (let d = 0; d < n; d++) {
    const f = flags[d];
    if ((f & ENEMY_FLAG_DEAD) !== 0) continue;
    const dx = x[d] - px;
    const dy = y[d] - py;
    if (dx * dx + dy * dy > r2) continue;
    if ((f & ENEMY_FLAG_BOSS) !== 0) {
      sum += wBoss;
    } else if ((f & ENEMY_FLAG_ELITE) !== 0) {
      sum += wElite;
      elites++;
    } else {
      sum += wRegular;
    }
  }
  world.director.liveElites = elites;
  return sum;
}

// -------------------------------------------------------------------------------------------
// Flavour
// -------------------------------------------------------------------------------------------

/**
 * Plain, or one of the body class's permitted variants.
 *
 * Two draws rather than one weighted pick because the plain/variant split is the interesting
 * decision and the choice among variants is not: this way the cycle's dial (0% -> 34%) reads
 * directly as "how often is this enemy special", independent of how many specials exist.
 *
 * Cycle 0 authors `variantChance: 0`, which is what makes the opening minute exactly ONE enemy as
 * specified - not "usually one enemy". The float is still drawn so the RNG stream advances
 * identically whatever the dial says.
 *
 * Relies on `flavours[0] === FLAV_PLAIN` for every archetype.
 */
function rollFlavour(rng: Rng, archetype: Archetype, variantChance: number): number {
  const options = ARCHETYPES[archetype].flavours;
  const roll = rng.nextFloat();
  if (options.length <= 1) return FLAV_PLAIN;
  if (roll >= variantChance) return FLAV_PLAIN;
  return options[1 + rng.nextInt(options.length - 1)];
}

// -------------------------------------------------------------------------------------------
// Placement
// -------------------------------------------------------------------------------------------

/**
 * Uniform direction on the unit circle, by rejection sampling in the unit disc.
 *
 * NO TRIGONOMETRY: `Math.sin`/`cos` are implementation-defined and banned in core, so an angle
 * would break "record on the phone, replay in CI". Rejection + normalise uses only multiplies,
 * compares and one `sqrt` - all exactly rounded, all bit-identical across engines. It is also
 * genuinely uniform, which `(nextFloat() * TWO_PI)` fed through a polynomial sine would not be.
 *
 * The `l2 < 1e-4` rejection discards near-origin samples whose normalised direction would be
 * dominated by float error in the division.
 */
function drawUnitDirection(rng: Rng, out: Vec2): void {
  for (let attempt = 0; attempt < MAX_DISC_ATTEMPTS; attempt++) {
    const x = rng.nextRange(-1, 1);
    const y = rng.nextRange(-1, 1);
    const l2 = x * x + y * y;
    if (l2 > 1 || l2 < 1e-4) continue;
    const inv = 1 / Math.sqrt(l2);
    out.x = x * inv;
    out.y = y * inv;
    return;
  }
  out.x = 1;
  out.y = 0;
}

/**
 * A point on the spawn ring, written into `out`.
 *
 * ALWAYS EXACTLY SPAWN_RADIUS (560 u) FROM THE PLAYER. The largest half-diagonal any supported
 * viewport can show is 500.9 u (DESIGN.md §8.7), so an enemy is always off-screen when it
 * appears and never on top of the player - and the simulation learns nothing about the device,
 * which is what stops rotating the phone from buying sight-line.
 *
 * FORWARD BIAS, stated exactly: if the player is moving faster than `forwardBiasMinSpeed` and the
 * drawn direction is behind them, ONE replacement is drawn and used unconditionally. That yields
 * P(ahead) = 0.75, so running is a real choice - you outrun the enemies behind you at the cost
 * of meeting more of them. Redrawing until the sample lands forward would instead be a hard wall
 * you can never break through, and would burn an unbounded number of RNG draws.
 *
 * THE FENCE IS HANDLED BY REFLECTION, NOT BY CLAMPING. Fighting with your back to the fence would
 * otherwise put spawns on top of you: clamping a ring point into the arena shortens the radius, and
 * a spawn at 200 u instead of 560 u is a spawn that appears ON SCREEN. Negating the offending
 * component instead keeps the point at EXACTLY SPAWN_RADIUS and merely moves it to the mirrored
 * direction, so the guarantee that nothing is ever seen to appear survives being cornered.
 *
 * The clamp underneath it is unreachable while ARENA_SIZE > 2 x SPAWN_RADIUS (12288 against 1120)
 * and exists only so that a tuning sweep which shrank the arena to a closet could not place an
 * enemy outside the world.
 *
 * Exported because RELOCATION reuses it - an enemy the player outran is put back on this same ring.
 * It passes `biasForward: false`, and that is a balance decision rather than a detail: the forward
 * bias is the director's TAX ON RUNNING, and a relocated body has already paid it once by being
 * outrun. Charging it again hands the runner's own escape back as an ambush every time, and the
 * reference run measured the difference as surviving the full fifteen minutes versus dying at 6:47.
 * Relocated bodies therefore arrive uniformly around you - half of them behind - which is a horde
 * closing in rather than a wall being erected in front of you.
 */
export function rollRingPosition(
  world: World,
  t: DirectorTuning,
  out: Vec2,
  biasForward = true,
): void {
  const rng = world.rng.spawn;
  drawUnitDirection(rng, out);

  const p = world.player;
  const minSpeed = t.forwardBiasMinSpeed;
  if (biasForward && p.vx * p.vx + p.vy * p.vy > minSpeed * minSpeed) {
    // dot(u, vHat) < 0 is the same test as dot(u, v) < 0 for a non-zero v - one normalise saved.
    if (out.x * p.vx + out.y * p.vy < 0) drawUnitDirection(rng, out);
  }

  let x = p.x + out.x * SPAWN_RADIUS;
  let y = p.y + out.y * SPAWN_RADIUS;
  if (x < -ARENA_HALF || x > ARENA_HALF) x = p.x - out.x * SPAWN_RADIUS;
  if (y < -ARENA_HALF || y > ARENA_HALF) y = p.y - out.y * SPAWN_RADIUS;
  x = x < -ARENA_HALF ? -ARENA_HALF : x > ARENA_HALF ? ARENA_HALF : x;
  y = y < -ARENA_HALF ? -ARENA_HALF : y > ARENA_HALF ? ARENA_HALF : y;

  // NOTHING IS EVER PLACED INSIDE A SCRAP PILE. Movement would push it straight back out on the
  // first tick, so this is not a correctness fix - it is a visual one: an enemy that materialises
  // inside a wreck and squirts out of the side of it is the sort of thing a player sees once and
  // never unsees. Pushed out along the shortest path rather than redrawn, which costs no RNG and
  // therefore cannot change the spawn stream.
  //
  // MAX_ENEMY_RADIUS, not the actual body's: this runs before the archetype is known, and erring
  // large only means clearing the wreck by a few units more than strictly needed.
  const clear = pushOutOfScenery(world.scenery, x, y, MAX_ENEMY_RADIUS);
  out.x = clear.x;
  out.y = clear.y;
}

// -------------------------------------------------------------------------------------------
// Spawning
// -------------------------------------------------------------------------------------------

/**
 * THE SINGLE PLACE ENEMY STATS ARE WRITTEN. Puts one enemy of the current cycle, at `rank`, on
 * the ring. Returns its dense index, or -1 if the pool is full.
 *
 *      hp     = cycle.hp     x rank.hp  x flavour.hp    x difficulty.hpRamp
 *      speed  = cycle.speed  x rank.speed x flavour.speed x difficulty.speedRamp
 *      dmg    = cycle.dmg    x rank.dmg x flavour.dmg    (NOT scaled by the ramp)
 *      xp     = cycle.xp     x rank.xp
 *      radius = archetype.radius x rank.size             (the hitbox never lies about the sprite)
 *
 * Contact damage deliberately does not take the within-cycle ramp: a cycle should get harder
 * because its enemies are tougher and there are more of them, not because the same bite quietly
 * started hurting more. That keeps the player's damage-taken intuition, learned in the first
 * thirty seconds of a cycle, true for the whole cycle - and leaves `spiky` as the only thing that
 * changes a contact number, which is exactly the tension the design wants (more dangerous, still
 * invisible to the highest-HP targeting rule).
 */
function spawnRank(world: World, rank: Rank, t: DirectorTuning): number {
  const p = world.enemies;
  const dir = world.director;
  const c = dir.cycle;
  const r = RANKS[rank];
  const archetype = c.archetype;

  const flavourId =
    rank === RANK_REGULAR ? rollFlavour(world.rng.spawn, archetype, c.variantChance) : FLAV_PLAIN;

  const pos = world.scratch.v0;
  rollRingPosition(world, t, pos);

  const typeId = c.typeByRank[rank];
  const handle = allocEnemy(p, typeId, flavourId, archetype, pos.x, pos.y, dir.nextSpawnId);
  // enemyIndex is the only sanctioned way to dereference a handle, and it maps NULL_HANDLE (a
  // full pool) to -1 - so the exhaustion check and the deref are the same branch.
  const d = enemyIndex(p, handle);
  if (d < 0) return -1;
  // Advanced only once the allocation actually succeeded, so spawnId stays a dense, gapless
  // "how many enemies has this run produced" counter. It is the Cannon's final tie-break, and it
  // reads as "the one that has been alive longest".
  dir.nextSpawnId++;

  const a = ARCHETYPES[archetype];
  const f = FLAVOURS[flavourId];
  const diff = world.difficulty;

  const hp = c.hp * r.hp * f.hp * diff.hpRamp;
  p.hp[d] = hp;
  p.maxHp[d] = hp;
  p.speed[d] = c.speed * r.speed * f.speed * diff.speedRamp;
  p.radius[d] = a.radius * r.size;
  p.mass[d] = a.mass * r.mass;
  p.contactDamage[d] = c.contactDamage * r.dmg * f.dmg;
  p.contactTimer[d] = 0;
  p.xpValue[d] = c.xp * r.xp;
  p.flags[d] =
    rank === RANK_BOSS
      ? ENEMY_FLAG_BOSS | ENEMY_FLAG_ANCHORED
      : rank === RANK_ELITE
        ? ENEMY_FLAG_ELITE
        : 0;

  // c carries the SLOT: that is how the renderer maintains spriteBySlot as an O(1) typed-array
  // load with no Map and no hashing. d carries typeId so it can pick the atlas frame without
  // touching the pool at all.
  pushEvent(world.events, EV_ENEMY_SPAWNED, world.tick, pos.x, pos.y, p.slot[d], typeId);

  if (rank === RANK_BOSS) {
    // Only the MOST RECENT boss is tracked. Earlier ones are still alive and still enormous, but
    // they are ordinary enemies as far as the director and the HUD are concerned - there is one
    // boss health bar, and it belongs to the boss that just walked in.
    dir.bossHandle = enemyHandleAt(p, d);
    dir.bossSpawned++;
    pushEvent(world.events, EV_BOSS_SPAWNED, world.tick, pos.x, pos.y, p.slot[d], hp);
  }

  return d;
}
