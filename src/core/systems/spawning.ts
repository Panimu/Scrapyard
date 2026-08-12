/**
 * S2 - updateSpawning. The director. THE ONLY ENEMY ALLOCATION SITE IN THE SIMULATION.
 *
 * It runs before the spatial hash rebuild (S5) so an enemy is queryable the tick it appears, and
 * before reapDead (S12) so a slot can never be freed and re-allocated inside one tick.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS A THREAT CONTROLLER, NOT A SPAWN TABLE
 * ---------------------------------------------------------------------------------------------
 * Each tick it measures LOCAL THREAT - the sum of `ArchetypeDef.threat` over live enemies within
 * THREAT_RADIUS (560 u, equal to SPAWN_RADIUS so a new spawn counts immediately) - and spawns
 * only while that is under a target that rises with the clock:
 *
 *      targetThreat(runSec) = 20 + 12.7 x (runSec / 60)        20 at 0:00 -> 210.5 at 15:00
 *
 * Threat is weighted by archetype (swarmer 1, grunt 2, bruiser 5, elite 14), so the director
 * measures PRESSURE rather than headcount. Three consequences that a flat spawn rate does not
 * give you:
 *
 *   - Killing things makes more things arrive, immediately. The horde refills toward the player's
 *     actual clear rate instead of toward a number someone typed in.
 *   - Running away thins the horde, because threat is LOCAL: the enemies you outran stop
 *     counting once they are past 560 u. Kiting is rewarded on its own terms.
 *   - AN ELITE SUPPRESSES ORDINARY SPAWNING WHILE IT LIVES. 14 threat is fourteen swarmers'
 *     worth of budget parked in one slow target. That is not a side effect - it is the design:
 *     the cannon commits to the elite whether the player likes it or not (highest-HP targeting),
 *     so the rule that makes the elite a problem is the same rule that clears the room to solve
 *     it. The set-piece creates its own space.
 *
 * Resulting density, verified by the harness: ~11 live at 0:00, ~40 at 4:00, ~69 at 8:00,
 * ~98 at 12:00, ~120 at 15:00.
 *
 * ---------------------------------------------------------------------------------------------
 * CAPS, AND WHAT HAPPENS AT THEM
 * ---------------------------------------------------------------------------------------------
 *   maxSpawnsPerSec  12   Rate limit. The accumulator is CLAMPED TO 1 after the loop, so blocked
 *                         spawns are never banked. Without that clamp a minute spent under an
 *                         elite's threat shadow would bank 700 spawns and discharge them as one
 *                         instant wall the moment the elite died - a frame spike and an unfair
 *                         death from a system the player cannot see.
 *   MAX_LIVE_ENEMIES 300  Hard population cap for phone frame budget. AT THE CAP THE DIRECTOR
 *                         SIMPLY STOPS SPAWNING; nothing is culled, nothing is queued, and
 *                         spawning resumes the tick a slot frees. Deaths and the 900 u despawn
 *                         ring drain the pool continuously, so the cap is a ceiling on the render
 *                         and collision cost, never a stall. The shipping curve peaks at ~120, so
 *                         300 is ~2.5x headroom and is only reached by pathological play
 *                         (standing still in a corner) or a deliberately hostile Tuning.
 *   ENEMY_CAP        512  Pool capacity, above the live cap so `allocEnemy` can never fail during
 *                         a normal run. It is still checked: silently overwriting a live entity
 *                         is the worst class of bug in this design.
 *
 * ---------------------------------------------------------------------------------------------
 * DETERMINISM - the exact `rng.spawn` draw order per ordinary spawn
 * ---------------------------------------------------------------------------------------------
 *   1  pickWeighted(archetype)                                        1 x nextFloat
 *   2  variant roll                                                   1 x nextFloat  (skipped
 *                                                                     when the archetype has one
 *                                                                     permitted flavour)
 *   3  which non-plain flavour, only if (2) passed                    1 x nextInt
 *   4  sprite within (archetype, tier)                                1 x nextInt
 *   5  ring direction, rejection sampled in the unit disc             2 x nextRange per attempt
 *   6  forward-bias redraw, only when moving > 20 u/s and (5) was
 *      behind the player                                              2 x nextRange per attempt
 *
 * Changing this order changes every replay and every golden hash - which is intended, and is why
 * the order is written down here rather than left to be inferred from the code.
 */

import { MAX_LIVE_ENEMIES, SPAWN_RADIUS, THREAT_RADIUS } from '../constants.js';
import { targetThreatAt, type DirectorTuning } from '../config/tuning.js';
import {
  ARCH_BOSS,
  ARCH_ELITE,
  ARCHETYPES,
  BOSS_TYPE_ID,
  ENEMY_IDS_BY_ARCHETYPE_TIER,
  FLAVOURS,
  FLAV_PLAIN,
  THREAT_BY_ARCHETYPE,
  VARIANT_CHANCE_BY_TIER,
  type Archetype,
} from '../content/enemyCatalog.js';
import {
  ENEMY_FLAG_ANCHORED,
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_DEAD,
  ENEMY_FLAG_ELITE,
  allocEnemy,
  enemyHandleAt,
  enemyIndex,
} from '../entity/enemyPool.js';
import { NULL_HANDLE } from '../entity/handle.js';
import { EV_BOSS_SPAWNED, EV_ENEMY_SPAWNED, pushEvent } from '../events/ring.js';
import { clamp } from '../math/scalar.js';
import type { Vec2 } from '../math/vec2.js';
import type { Rng } from '../rng.js';
import { RUN_PHASE_RUNNING, type World } from '../types.js';

/** Highest visual tier index. Four faction recolours: blue / orange / green / grey. */
const MAX_TIER = 3;

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

  // --- visual tier band ------------------------------------------------------------------
  dir.tier = clamp(Math.floor(runSec / t.tierSeconds), 0, MAX_TIER) | 0;

  // --- scripted swarm surge --------------------------------------------------------------
  // A surge triples the swarmer share and raises the target 30% for 30 s. It is deliberately the
  // one event that makes the cannon's target choice feel WRONG: the screen fills with things it
  // will not shoot. Splash, pierce and knockback are the answer, and a surge is where the player
  // learns that.
  let surgeTargetMul = 1;
  let surgeSwarmerMul = 1;
  dir.surgeTimer = 0;
  for (let i = 0; i < t.surges.length; i++) {
    const s = t.surges[i];
    const left = s.atSec + s.durationSec - runSec;
    if (runSec >= s.atSec && left > 0) {
      dir.surgeTimer = left;
      surgeTargetMul = s.targetThreatMul;
      surgeSwarmerMul = s.swarmerShareMul;
      break;
    }
  }

  // --- local pressure --------------------------------------------------------------------
  dir.localThreat = measureLocalThreat(world);

  // --- the Scraplord ---------------------------------------------------------------------
  if (dir.bossSpawned === 0 && runSec >= t.bossAtSec) {
    if (runSec < t.bossAtSec + t.bossSilenceSec) {
      // Four seconds of scripted silence. Nothing spawns, the field drains, and the player is
      // left alone with whatever is already chewing on them. Earned quiet before the set-piece.
      dir.targetThreat = 0;
      dir.spawnAccumulator = 0;
      return;
    }
    spawnBoss(world);
  }

  // --- the target ------------------------------------------------------------------------
  let target = targetThreatAt(runSec, t) * surgeTargetMul;
  // While the boss lives, ordinary pressure drops to 60%: the adds are there to deny the player
  // free positioning, not to out-damage a 4000 HP target that already owns every shell.
  if (dir.bossSpawned !== 0) target *= t.bossTargetMul;
  dir.targetThreat = target;

  // --- scripted elite drop-ins -----------------------------------------------------------
  // These IGNORE the threat target (that is what makes them events) but respect the live cap.
  // Each one immediately adds 14 to localThreat, which is what buys the player room to fight it.
  while (
    dir.eliteEventsSpawned < t.eliteEvents.length &&
    runSec >= t.eliteEvents[dir.eliteEventsSpawned].atSec
  ) {
    const ev = t.eliteEvents[dir.eliteEventsSpawned];
    for (let i = 0; i < ev.count; i++) {
      if (world.enemies.count >= MAX_LIVE_ENEMIES) break;
      if (spawnOrdinary(world, ARCH_ELITE as Archetype, t) < 0) break;
      dir.localThreat += THREAT_BY_ARCHETYPE[ARCH_ELITE];
    }
    dir.eliteEventsSpawned++;
  }

  // --- the ordinary drip -----------------------------------------------------------------
  dir.spawnAccumulator += t.maxSpawnsPerSec * dt;

  ensureMixWeights(world, t, runSec, surgeSwarmerMul);

  while (
    dir.spawnAccumulator >= 1 &&
    dir.localThreat < dir.targetThreat &&
    world.enemies.count < MAX_LIVE_ENEMIES
  ) {
    dir.spawnAccumulator -= 1;
    const archetype = rollArchetype(world);
    if (spawnOrdinary(world, archetype, t) < 0) break; // pool exhausted - stop, do not spin
    dir.localThreat += THREAT_BY_ARCHETYPE[archetype];
  }

  // Never bank more than one spawn's worth of credit. See the CAPS note at the top of the file:
  // this single line is what stops a threat shadow from discharging as a wall.
  if (dir.spawnAccumulator > 1) dir.spawnAccumulator = 1;
}

// -------------------------------------------------------------------------------------------
// Local threat
// -------------------------------------------------------------------------------------------

/**
 * Sum of archetype threat over live enemies within THREAT_RADIUS of the player.
 *
 * A LINEAR SCAN, ON PURPOSE - this is the one place in the sim where the spatial hash is the
 * wrong tool. THREAT_RADIUS is 560 u against a 64 u cell, so a circle query would walk ~283
 * cells and do 283 bucket probes to filter at most 300 enemies that already sit contiguously in
 * two typed arrays. The scan is fewer operations, perfectly cache-linear, and exact.
 *
 * It is also immune to the hash being one tick stale: S5 rebuilt it BEFORE S12 reaped, so at S2
 * the hash still holds dense indices for enemies that no longer exist. Reading the pool directly
 * cannot be wrong.
 */
function measureLocalThreat(world: World): number {
  const p = world.enemies;
  const px = world.player.x;
  const py = world.player.y;
  const r2 = THREAT_RADIUS * THREAT_RADIUS;
  const x = p.x;
  const y = p.y;
  const flags = p.flags;
  const arch = p.archetype;
  const n = p.count;

  let sum = 0;
  for (let d = 0; d < n; d++) {
    if ((flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
    const dx = x[d] - px;
    const dy = y[d] - py;
    if (dx * dx + dy * dy > r2) continue;
    sum += THREAT_BY_ARCHETYPE[arch[d]];
  }
  return sum;
}

// -------------------------------------------------------------------------------------------
// Wave composition
// -------------------------------------------------------------------------------------------

/**
 * Rebuilds `director.weightCum` when the effective mix changes.
 *
 * `director.mixRow` caches WHICH mix is prefix-summed, encoded as `rowIndex * 2 + surgeFlag`
 * because a surge changes the weights without changing the row. Encoding beats a second field:
 * the pair is only ever compared for equality, and one integer compare per tick is the whole
 * cost of not re-summing five weights sixty times a second.
 *
 * Zero-weight archetypes are dropped rather than prefix-summed as ties, so `weightCount` is the
 * number of things that can actually spawn right now - which is what makes the early game's
 * "swarmers only" row a fact the data states rather than an accident of a binary search.
 */
function ensureMixWeights(
  world: World,
  t: DirectorTuning,
  runSec: number,
  surgeSwarmerMul: number,
): void {
  const rows = t.spawnMix;
  let row = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (runSec >= rows[i].fromSec) {
      row = i;
      break;
    }
  }

  const surging = surgeSwarmerMul !== 1;
  const key = row * 2 + (surging ? 1 : 0);
  const dir = world.director;
  if (dir.mixRow === key) return;

  const w = rows[row].weights;
  let acc = 0;
  let n = 0;
  for (let a = 0; a < w.length; a++) {
    const weight = a === 0 ? w[a] * surgeSwarmerMul : w[a];
    if (weight <= 0) continue;
    acc += weight;
    dir.weightCum[n] = acc;
    dir.weightArchetype[n] = a;
    n++;
  }
  dir.weightCount = n;
  dir.mixRow = key;
}

function rollArchetype(world: World): Archetype {
  const dir = world.director;
  const i = world.rng.spawn.pickWeighted(dir.weightCum, dir.weightCount);
  return dir.weightArchetype[i] as Archetype;
}

/**
 * Plain, or one of the archetype's permitted variants.
 *
 * Two draws rather than one weighted pick because the plain/variant split is the interesting
 * decision and the choice among variants is not: this way the tier dial (10% -> 34%) reads
 * directly as "how often is this enemy special", independent of how many specials exist.
 *
 * Relies on `flavours[0] === FLAV_PLAIN` for every archetype - asserted in the catalog tests.
 */
function rollFlavour(rng: Rng, archetype: Archetype, tier: number): number {
  const options = ARCHETYPES[archetype].flavours;
  if (options.length <= 1) return FLAV_PLAIN;
  if (rng.nextFloat() >= VARIANT_CHANCE_BY_TIER[tier]) return FLAV_PLAIN;
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
 */
function rollRingPosition(world: World, t: DirectorTuning, out: Vec2): void {
  const rng = world.rng.spawn;
  drawUnitDirection(rng, out);

  const p = world.player;
  const minSpeed = t.forwardBiasMinSpeed;
  if (p.vx * p.vx + p.vy * p.vy > minSpeed * minSpeed) {
    // dot(u, vHat) < 0 is the same test as dot(u, v) < 0 for a non-zero v - one normalise saved.
    if (out.x * p.vx + out.y * p.vy < 0) drawUnitDirection(rng, out);
  }

  out.x = p.x + out.x * SPAWN_RADIUS;
  out.y = p.y + out.y * SPAWN_RADIUS;
}

// -------------------------------------------------------------------------------------------
// Spawning
// -------------------------------------------------------------------------------------------

/**
 * Rolls flavour, sprite and position for `archetype` and puts one enemy on the ring.
 * Returns its dense index, or -1 if the pool is full.
 */
function spawnOrdinary(world: World, archetype: Archetype, t: DirectorTuning): number {
  const rng = world.rng.spawn;
  const tier = world.director.tier;
  const flavour = rollFlavour(rng, archetype, tier);

  const ids = ENEMY_IDS_BY_ARCHETYPE_TIER[archetype][tier];
  const typeId = ids[rng.nextInt(ids.length)];

  const pos = world.scratch.v0;
  rollRingPosition(world, t, pos);

  return spawnAt(
    world,
    archetype,
    flavour,
    typeId,
    pos.x,
    pos.y,
    archetype === ARCH_ELITE ? ENEMY_FLAG_ELITE : 0,
  );
}

/**
 * The single place enemy stats are written. Everything else in the game rolls IDs and calls this.
 *
 *      hp    = archetype.hp    x flavour.hp    x difficulty.hpScale[archetype]
 *      speed = archetype.speed x flavour.speed x difficulty.speedScale[archetype]
 *      dmg   = archetype.contactDamage x flavour.dmg          (NOT scaled by time)
 *
 * Contact damage deliberately does not grow: minute 15 is dangerous because there are more
 * things and they have more HP, not because a swarmer bite quietly became a bruiser bite. That
 * keeps the player's damage-taken intuition, learned in minute 1, true for the whole run - and
 * leaves `spiky` as the only thing that changes a contact number, which is exactly the tension
 * the design wants (more dangerous, still invisible to the highest-HP targeting rule).
 *
 * XP does not scale either: gem value is archetype identity, and the XP curve is tuned against
 * the mix, not against the clock.
 */
function spawnAt(
  world: World,
  archetype: Archetype,
  flavour: number,
  typeId: number,
  x: number,
  y: number,
  flags: number,
): number {
  const p = world.enemies;
  const dir = world.director;

  const handle = allocEnemy(p, typeId, flavour, archetype, x, y, dir.nextSpawnId);
  // enemyIndex is the only sanctioned way to dereference a handle, and it maps NULL_HANDLE (a
  // full pool) to -1 - so the exhaustion check and the deref are the same branch.
  const d = enemyIndex(p, handle);
  if (d < 0) return -1;
  // Advanced only once the allocation actually succeeded, so spawnId stays a dense, gapless
  // "how many enemies has this run produced" counter. It is the Cannon's final tie-break, and it
  // reads as "the one that has been alive longest".
  dir.nextSpawnId++;

  const a = ARCHETYPES[archetype];
  const f = FLAVOURS[flavour];

  const hp = a.hp * f.hp * world.difficulty.hpScale[archetype];
  p.hp[d] = hp;
  p.maxHp[d] = hp;
  p.speed[d] = a.speed * f.speed * world.difficulty.speedScale[archetype];
  p.radius[d] = a.radius;
  p.mass[d] = a.mass;
  p.contactDamage[d] = a.contactDamage * f.dmg;
  p.contactTimer[d] = 0;
  p.xpValue[d] = a.xp;
  p.flags[d] = flags;

  // c carries the SLOT: that is how the renderer maintains spriteBySlot as an O(1) typed-array
  // load with no Map and no hashing. d carries typeId so it can pick the atlas frame without
  // touching the pool at all.
  pushEvent(world.events, EV_ENEMY_SPAWNED, world.tick, x, y, p.slot[d], typeId);
  return d;
}

/**
 * The Scraplord. 4000 HP, no growth, anchored against knockback, and drawn at 112 u.
 *
 * It is the payoff of the targeting rule rather than an exception to it: at 2.89x the toughest
 * elite it is unambiguously the highest-HP target for its entire life, so the cannon locks on and
 * never wavers and the player's whole job is to stay alive inside its range while the adds close.
 * The one weapon behaviour the player has been fighting all run is, for 45 seconds, exactly what
 * they want.
 *
 * Ignores MAX_LIVE_ENEMIES - a capped field must never be able to cancel the finale. ENEMY_CAP
 * (512) is well above the live cap, so there is always a slot.
 */
function spawnBoss(world: World): void {
  const t = world.config.tuning.director;
  const pos = world.scratch.v0;
  rollRingPosition(world, t, pos);

  const d = spawnAt(
    world,
    ARCH_BOSS as Archetype,
    FLAV_PLAIN,
    BOSS_TYPE_ID,
    pos.x,
    pos.y,
    ENEMY_FLAG_BOSS | ENEMY_FLAG_ANCHORED,
  );
  if (d < 0) return; // pool momentarily full: retried next tick rather than skipped

  const p = world.enemies;
  world.director.bossHandle = enemyHandleAt(p, d);
  world.director.bossSpawned = 1;
  pushEvent(world.events, EV_BOSS_SPAWNED, world.tick, p.x[d], p.y[d], p.slot[d], p.maxHp[d]);
}
