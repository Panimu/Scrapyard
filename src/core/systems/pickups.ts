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
import { NULL_HANDLE } from '../entity/handle.js';
import {
  PICKUP_FLAG_DEAD,
  PICKUP_KIND_GEM,
  allocPickup,
  markPickupDead,
} from '../entity/pickupPool.js';
import { EV_GEM_COLLECTED, EV_GEM_SPAWNED, pushEvent } from '../events/ring.js';
import type { World } from '../types.js';

/** Uint16Array ceiling. An absorbed gem saturates here rather than wrapping to a white gem. */
const MAX_GEM_VALUE = 65535;

export function updatePickups(world: World, dt: number): void {
  dropGems(world);
  magnetAndCollect(world, dt);
}

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

  for (let d = 0; d < n; d++) {
    if ((pool.flags[d] & PICKUP_FLAG_DEAD) !== 0) continue;

    const dx = px - pool.x[d];
    const dy = py - pool.y[d];
    const d2 = dx * dx + dy * dy;

    // `d2 === 0` is folded in here so the normalise below can never divide by zero: a gem sitting
    // exactly on the player is, by any reading, collected.
    if (d2 <= collectR2 || d2 === 0) {
      collect(world, d);
      continue;
    }

    if (d2 > pickupR2 && pool.tier[d] < bossTier) {
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
