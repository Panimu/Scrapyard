/**
 * S10 - updatePickups. THE ONLY PICKUP ALLOCATION SITE IN THE SIMULATION.
 *
 * Two passes, in this order and no other:
 *   1. drain the KillFeed into gems;
 *   2. magnet every live gem toward the player, and collect the ones that arrive.
 *
 * It runs after updateDamage (S9) so a kill's gem exists on the SAME TICK the kill happened, and
 * before updateProgression (S11) so the XP that gem is worth can level you on that same tick. The
 * whole reward chain - shell lands, body dies, gem drops, gem is magnetised, XP banks, card opens -
 * can complete inside 16 ms. There is no artificial lag anywhere in it, and the reason is just
 * that the stages are in the right order.
 *
 * ---------------------------------------------------------------------------------------------
 * THE MAGNET CHASES, IT DOES NOT TELEPORT
 * ---------------------------------------------------------------------------------------------
 * Inside `pickupRadius` a gem ACCELERATES toward the player at `magnetAccel` (1400 u/s^2), capped
 * at `magnetMaxSpeed` (600 u/s), and is collected inside `collectRadius` (18 u). Snapping gems to
 * the player would be one line shorter and would delete the single best piece of feedback in the
 * game: the moment a kill happens and eleven gems come streaming at you is the reward, and it is
 * legible precisely because it takes a few hundred milliseconds and you can see it coming.
 *
 * 600 u/s against a 238 u/s worst-case chassis means a gem that has entered the field always
 * catches up. Leaving the field zeroes the gem's velocity rather than letting it coast: the magnet
 * is a FIELD, not a launcher, and a coasting gem would need a drag constant that does not exist in
 * Tuning and must not be invented here.
 *
 * The Scraplord's core (the top gem tier) ignores the radius entirely and comes from anywhere -
 * "auto-collected", as the design puts it. A 500 XP drop must never be lost to the player having
 * walked away from where the boss happened to fall.
 *
 * ---------------------------------------------------------------------------------------------
 * OVERFLOW IS A DESIGNED BEHAVIOUR, NOT AN ERROR
 * ---------------------------------------------------------------------------------------------
 * Above GEM_SOFT_CAP (400) a new drop's value is ADDED to the nearest live gem (tie-break: lowest
 * spawnId) and that gem's tier upgrades to match its new total. One linear pass, only on overflow.
 * The alternative - merging nearest PAIRS - would need the gems in a spatial structure of their
 * own; this keeps the pool bounded, keeps the jackpot feel (the field visibly becomes fewer, more
 * valuable gems), and adds no data structure. Nothing is ever silently dropped.
 *
 * ---------------------------------------------------------------------------------------------
 * GEM spawnId - derived, not stored
 * ---------------------------------------------------------------------------------------------
 * A gem's spawnId is `1 + tick * MAX_KILLS_PER_TICK + killIndex`. It has to be unique among live
 * gems (the renderer keys sprites off it) and totally ordered (it is the overflow tie-break), and
 * there is exactly one gem per KillFeed entry, so the tick and the feed index already identify it.
 * Deriving it avoids adding a counter field to World - which would have to be reset, hashed and
 * kept monotonic - and it stays inside u32 for 33 554 ticks x 128, far past a 54 000-tick run.
 * It is 1-based so that 0 stays available as "none" for anything that later wants it.
 */

import { ARENA_HALF, GEM_SOFT_CAP, MAX_KILLS_PER_TICK } from '../constants.js';
import { gemTierForValue } from '../config/tuning.js';
import { destroyScenery, destructibleOverlap } from '../content/scenery.js';
import { NULL_HANDLE } from '../entity/handle.js';
import {
  PICKUP_FLAG_AUTO,
  PICKUP_FLAG_DEAD,
  PICKUP_KIND_CREDIT,
  PICKUP_KIND_GEM,
  PICKUP_KIND_MAGNET,
  PICKUP_KIND_REPAIR,
  allocPickup,
  markPickupDead,
} from '../entity/pickupPool.js';
import {
  EV_BARREL_BROKEN,
  EV_CONSUMABLE_TAKEN,
  EV_GEM_COLLECTED,
  EV_GEM_SPAWNED,
  pushEvent,
} from '../events/ring.js';
import type { World } from '../types.js';

/** Uint16Array ceiling. An absorbed gem saturates here rather than wrapping to a white gem. */
const MAX_GEM_VALUE = 65535;

export function updatePickups(world: World, dt: number): void {
  const p = world.player;
  if (p.magnetSec > 0) {
    p.magnetSec -= dt;
    if (p.magnetSec < 0) p.magnetSec = 0;
  }
  dropGems(world);
  magnetAndCollect(world, dt);
}

// -------------------------------------------------------------------------------------------
// Fuel barrels and what falls out of them
// -------------------------------------------------------------------------------------------

/**
 * Breaks any FUEL BARREL overlapping the circle (x, y, r) and drops what was inside. Returns true
 * if something went up.
 *
 * CALLED FROM FOUR PLACES - the three ways a WEAPON can touch the ground, and the player.
 *
 *   a shell arriving          radius 0
 *   a blast going off         radius = splashRadius
 *   a beam sweeping across    the caller resolves the ray and passes the point
 *   THE PLAYER WALKING INTO IT   radius = the mech's own, from updatePlayerMovement
 *
 * ENEMIES CANNOT. They walk around barrels like any other scenery, which keeps a drum a thing the
 * player spends on rather than something the horde clears for them on its way past.
 *
 * A barrel is NEVER TARGETED. It is not an enemy, so no targeting rule can see it, and that is the
 * whole character of the thing: the guns break barrels BY ACCIDENT, aiming at something else.
 * Making it targetable would put a decoy in front of every weapon whose job is to pick the right
 * enemy - and it would delete the reason to ever walk into one, which is the only DELIBERATE way
 * to take a barrel there is.
 */
export function breakBarrelIn(world: World, x: number, y: number, r: number): boolean {
  const i = destructibleOverlap(world.scenery, x, y, r);
  if (i < 0) return false;

  const bx = world.scenery.x[i];
  const by = world.scenery.y[i];
  // Read BEFORE destroying: destruction is a radius write, so this is the last tick the size of
  // the thing that went up exists anywhere, and the renderer sizes its burst from it.
  const br = world.scenery.radius[i];
  destroyScenery(world.scenery, i);
  world.stats.barrelsBroken++;
  pushEvent(world.events, EV_BARREL_BROKEN, world.tick, bx, by, br, 0);
  dropConsumable(world, bx, by);
  return true;
}

/**
 * Rolls one consumable and puts it where the barrel stood.
 *
 * THE DRAW IS ON `rng.loot`, not `rng.spawn`. Barrels are broken by whatever the player happened
 * to be shooting at the time, so the number of draws per run is a function of how they play - and
 * pulling those out of the spawn stream would make the horde itself depend on how much scenery
 * someone shot. Loot is the stream that already exists for exactly this.
 *
 * Two draws, always, in this order: WHICH consumable, then the coin jitter. The second is drawn
 * even for a spanner or a magnet, so that adding or reweighting a kind later cannot shift the
 * stream for the kinds either side of it.
 */
function dropConsumable(world: World, x: number, y: number): void {
  const rng = world.rng.loot;
  const t = world.config.tuning.pickups;

  const which = rng.nextFloat();
  const jitter = rng.nextRange(1 - t.creditJitter, 1 + t.creditJitter);

  let kind: number;
  let value: number;
  let tier: number;

  if (which < CONSUMABLE_REPAIR_CHANCE) {
    kind = PICKUP_KIND_REPAIR;
    value = Math.max(1, Math.round(world.player.stats.maxHp * t.repairFrac));
    tier = 0;
  } else if (which < CONSUMABLE_REPAIR_CHANCE + CONSUMABLE_MAGNET_CHANCE) {
    kind = PICKUP_KIND_MAGNET;
    value = 0;
    tier = 0;
  } else {
    kind = PICKUP_KIND_CREDIT;
    // VALUE RIDES THE CLOCK. A coin found in the first minute is worth about 1 and one found at
    // the end is worth about 50, so the same barrel is a trivial pickup early and a real prize
    // late - which is what stops the yard being farmed dry in the opening two minutes while the
    // player is safe and everything is slow.
    const span = world.config.runLengthSec > 0 ? world.runSec / world.config.runLengthSec : 0;
    const clamped = span < 0 ? 0 : span > 1 ? 1 : span;
    const base = t.creditMin + (t.creditMax - t.creditMin) * clamped;
    const rolled = Math.round(base * jitter);
    value = rolled < t.creditMin ? t.creditMin : rolled > t.creditMax ? t.creditMax : rolled;
    tier = creditTier(value, t.creditTierValues);
  }

  const spawnId = CONSUMABLE_SPAWN_ID_BASE + world.tick;
  const handle = allocPickup(world.pickups, kind, value, tier, x, y, spawnId);
  if (handle === NULL_HANDLE) return; // pool full: the drop is simply lost, never overwritten

  const d = world.pickups.count - 1;
  // NOT MAGNETISED. A consumable that flew to you would delete the decision the barrel exists to
  // pose - is that spanner worth crossing the field for, right now, with this much behind you.
  world.pickups.flags[d] |= PICKUP_FLAG_AUTO;

  pushEvent(world.events, EV_GEM_SPAWNED, world.tick, x, y, value, tier);
}

/** Which of the four coin sprites a value draws. Highest threshold that fits. */
function creditTier(value: number, thresholds: readonly number[]): number {
  let tier = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (value >= thresholds[i]) tier = i;
  }
  return tier;
}

/**
 * Drop weights. A spanner is the most common because it is the one that answers the question the
 * player actually has in the back half of a run; the magnet is rarest because it is the only one
 * that changes the next ten seconds rather than the next number.
 */
const CONSUMABLE_REPAIR_CHANCE = 0.45;
const CONSUMABLE_MAGNET_CHANCE = 0.15;

/**
 * Consumable spawnIds live above every gem's. A gem's is `1 + tick * MAX_KILLS_PER_TICK + k`, so
 * this base clears the whole space a 15-minute run can reach and the renderer can keep keying
 * sprites off spawnId without the two ever colliding.
 */
const CONSUMABLE_SPAWN_ID_BASE = 0x40000000;

// -------------------------------------------------------------------------------------------
// Drops
// -------------------------------------------------------------------------------------------

function dropGems(world: World): void {
  const feed = world.kills;
  if (feed.count === 0) return;

  const pool = world.pickups;
  const tuning = world.config.tuning.pickups;

  for (let k = 0; k < feed.count; k++) {
    const value = feed.xpValue[k];
    // Zero-value kills drop nothing. The 900 u despawn ring never reaches this stage at all - it
    // marks enemies dead without writing a KillFeed entry, because a kill you did not make must
    // not pay.
    if (value <= 0) continue;

    const x = feed.x[k];
    const y = feed.y[k];

    if (pool.count >= GEM_SOFT_CAP) {
      absorbIntoNearest(world, x, y, value);
      continue;
    }

    const spawnId = 1 + world.tick * MAX_KILLS_PER_TICK + k;
    const tier = gemTierForValue(value, tuning);
    const handle = allocPickup(pool, PICKUP_KIND_GEM, value, tier, x, y, spawnId);
    if (handle === NULL_HANDLE) {
      // Pool genuinely exhausted below the soft cap (only reachable with a hostile PICKUP_CAP).
      // Absorb rather than discard: the player's XP is never quietly deleted.
      absorbIntoNearest(world, x, y, value);
      continue;
    }

    pushEvent(world.events, EV_GEM_SPAWNED, world.tick, x, y, value, tier);
  }
}

/**
 * Adds `value` to the nearest live gem, upgrading its tier. Ties on exact distance go to the lower
 * spawnId, which makes the choice a strict total order and therefore independent of dense index -
 * important, because dense indices are reshuffled by every reap.
 */
function absorbIntoNearest(world: World, x: number, y: number, value: number): void {
  const pool = world.pickups;
  const n = pool.count;

  let best = -1;
  let bestD2 = 0;
  for (let d = 0; d < n; d++) {
    if ((pool.flags[d] & PICKUP_FLAG_DEAD) !== 0) continue;
    if (pool.kind[d] !== PICKUP_KIND_GEM) continue;
    const dx = pool.x[d] - x;
    const dy = pool.y[d] - y;
    const d2 = dx * dx + dy * dy;
    if (best < 0 || d2 < bestD2 || (d2 === bestD2 && pool.spawnId[d] < pool.spawnId[best])) {
      best = d;
      bestD2 = d2;
    }
  }
  // Nothing live to absorb into: only reachable if the pool is simultaneously at the soft cap and
  // empty, which is a contradiction. Guarded rather than asserted - a lost gem is not worth a crash.
  if (best < 0) return;

  const total = pool.value[best] + value;
  const clamped = total > MAX_GEM_VALUE ? MAX_GEM_VALUE : total;
  pool.value[best] = clamped;
  pool.tier[best] = gemTierForValue(clamped, world.config.tuning.pickups);

  pushEvent(
    world.events,
    EV_GEM_SPAWNED,
    world.tick,
    pool.x[best],
    pool.y[best],
    clamped,
    pool.tier[best],
  );
}

// -------------------------------------------------------------------------------------------
// Magnet + collection
// -------------------------------------------------------------------------------------------

function magnetAndCollect(world: World, dt: number): void {
  const pool = world.pickups;
  const n = pool.count;
  if (n === 0) return;

  const player = world.player;
  const px = player.x;
  const py = player.y;

  const tuning = world.config.tuning.pickups;
  const pickupR = player.stats.pickupRadius;
  const pickupR2 = pickupR * pickupR;
  const collectR2 = tuning.collectRadius * tuning.collectRadius;
  const accel = tuning.magnetAccel;
  const maxSpeed = tuning.magnetMaxSpeed;
  const maxSpeed2 = maxSpeed * maxSpeed;
  /** Top tier of gemTierValues - the boss core, which is attracted from any distance. */
  const bossTier = tuning.gemTierValues.length - 1;

  const consumableR2 = tuning.consumableRadius * tuning.consumableRadius;
  // While a MAGNET is running, every gem is in the field whatever the distance.
  const magnetAll = player.magnetSec > 0;

  for (let d = 0; d < n; d++) {
    if ((pool.flags[d] & PICKUP_FLAG_DEAD) !== 0) continue;

    const dx = px - pool.x[d];
    const dy = py - pool.y[d];
    const d2 = dx * dx + dy * dy;

    // CONSUMABLES ARE WALKED OVER. They do not chase and are not chased: no magnet term, no
    // velocity, just a generous contact radius. That is the point of them - a barrel poses a
    // question ("is that spanner worth crossing the field for, right now") and a consumable that
    // flew to the player would answer it for them.
    if (pool.kind[d] !== PICKUP_KIND_GEM) {
      if (d2 <= consumableR2) takeConsumable(world, d);
      continue;
    }

    // `d2 === 0` is folded in here so the normalise below can never divide by zero: a gem sitting
    // exactly on the player is, by any reading, collected.
    if (d2 <= collectR2 || d2 === 0) {
      collect(world, d);
      continue;
    }

    if (!magnetAll && d2 > pickupR2 && pool.tier[d] < bossTier) {
      // Outside the field. The magnet is a field, not a launcher - a gem that leaves it stops
      // rather than coasting on a drag constant that does not exist in Tuning.
      pool.vx[d] = 0;
      pool.vy[d] = 0;
      continue;
    }

    const inv = 1 / Math.sqrt(d2);
    let vx = pool.vx[d] + dx * inv * accel * dt;
    let vy = pool.vy[d] + dy * inv * accel * dt;

    const s2 = vx * vx + vy * vy;
    if (s2 > maxSpeed2) {
      const k = maxSpeed / Math.sqrt(s2);
      vx *= k;
      vy *= k;
    }

    pool.vx[d] = vx;
    pool.vy[d] = vy;
    let x = pool.x[d] + vx * dt;
    let y = pool.y[d] + vy * dt;

    // THE FENCE, and it is the magnet that needs it rather than the drop. A gem is dropped where
    // a body died, and bodies are held inside the yard - but the magnet is a launcher-shaped
    // accelerator: at 600 u/s it covers 10 u per tick against an 18 u collect radius, so a gem
    // crossing at a shallow angle can miss the player entirely. Standing AT the fence, the miss
    // throws it into the void, where it stops - and where the player can never get within 18 u of
    // it, because they cannot reach the wire. Measured at 89 u outside the bound before this
    // clamp, which is XP silently deleted.
    if (x < -ARENA_HALF) x = -ARENA_HALF;
    else if (x > ARENA_HALF) x = ARENA_HALF;
    if (y < -ARENA_HALF) y = -ARENA_HALF;
    else if (y > ARENA_HALF) y = ARENA_HALF;

    pool.x[d] = x;
    pool.y[d] = y;
  }
}

/**
 * Banks the gem's face value. Scaling by `xpGain` is deliberately NOT done here: updateProgression
 * owns that multiply, so `xpBanked` always means "raw XP picked up this tick" and a Data Siphon
 * taken mid-flight cannot double-count against a gem already in transit.
 */
function collect(world: World, d: number): void {
  const pool = world.pickups;
  world.xpBanked += pool.value[d];
  world.stats.gemsCollected++;
  pushEvent(
    world.events,
    EV_GEM_COLLECTED,
    world.tick,
    pool.x[d],
    pool.y[d],
    pool.value[d],
    pool.tier[d],
  );
  // Marked, never removed. S12 is the only removal site, so this dense index stays valid for
  // updateProgression and for the renderer's drain after stepWorld returns.
  markPickupDead(pool, d);
}

/**
 * Applies a consumable and marks it taken.
 *
 * All three land INSTANTLY and none of them opens a menu. A bullet-heaven's floor pickups have to
 * resolve in the moment the player runs over them, because the player is running over them while
 * being chased - anything that needed a decision would be a pause button with extra steps.
 */
function takeConsumable(world: World, d: number): void {
  const pool = world.pickups;
  const player = world.player;
  const kind = pool.kind[d];
  const value = pool.value[d];

  if (kind === PICKUP_KIND_REPAIR) {
    // Clamped to max: a spanner tops you up, it never overheals into a buffer the HUD cannot show.
    const hp = player.hp + value;
    player.hp = hp > player.stats.maxHp ? player.stats.maxHp : hp;
  } else if (kind === PICKUP_KIND_CREDIT) {
    world.stats.credits += value;
  } else if (kind === PICKUP_KIND_MAGNET) {
    // Refreshed, not stacked. Two magnets inside four seconds is a longer pull, not a double one -
    // there is nothing for a second copy of "every gem is attracted" to do.
    const sec = world.config.tuning.pickups.magnetSec;
    if (sec > player.magnetSec) player.magnetSec = sec;
  }

  world.stats.consumables++;
  pushEvent(world.events, EV_CONSUMABLE_TAKEN, world.tick, pool.x[d], pool.y[d], value, kind);
  markPickupDead(pool, d);
}
