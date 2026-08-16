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
 * OVERFLOW RECYCLES THE OLDEST GEM SO THE NEWEST ONE STILL DROPS
 * ---------------------------------------------------------------------------------------------
 * Gems only leave the field when they are picked up, and nobody picks up all of them - a gem
 * dropped at the far side of the yard at 3:00 is still lying there at 12:00. So the pool climbs
 * monotonically through a long run and, at GEM_SOFT_CAP, EVERY subsequent kill is at the cap. The
 * old rule ("above the cap, add the new value to the nearest live gem") therefore did not describe
 * a rare overflow, it described the whole back half of a run: from the moment the cap was reached
 * no kill ever produced a gem again, and the player - standing where the fighting is, nowhere near
 * the ancient gems quietly soaking up their XP - correctly reported that enemies had stopped
 * dropping anything.
 *
 * So the cap now RECYCLES instead of refusing. At the cap the OLDEST live gem (lowest spawnId) is
 * retired: its value is merged into the live gem nearest to IT, and then the new drop is allocated
 * exactly as normal. The kill in front of the player always leaves something on the ground; what
 * collapses is the abandoned corner of the yard, where two old gems becoming one richer gem costs
 * nobody anything they were ever going to walk back for.
 *
 * Two linear passes over the pool, only on overflow. Nothing is destroyed: a retired gem with no
 * other gem to merge into is left where it is, and the drop absorbs the old way instead.
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

import {
  BARREL_BREAK_RADIUS,
  DT,
  GEM_SOFT_CAP,
  MAX_KILLS_PER_TICK,
} from '../constants.js';
import { gemTierForValue } from '../config/tuning.js';
import {
  destroyScenery,
  destructibleOverlap,
  regrowBarrel,
  sceneryRadius,
  sceneryX,
  sceneryY,
} from '../content/scenery.js';
import { NULL_HANDLE } from '../entity/handle.js';
import { ENEMY_FLAG_BOSS } from '../entity/enemyPool.js';
import { FLAVOURS } from '../content/enemyCatalog.js';
import {
  PICKUP_FLAG_AUTO,
  PICKUP_FLAG_DEAD,
  PICKUP_KIND_CHEST,
  PICKUP_KIND_CREDIT,
  PICKUP_KIND_DICE,
  PICKUP_KIND_GEM,
  PICKUP_KIND_MAGNET,
  PICKUP_KIND_REPAIR,
  allocPickup,
  markPickupDead,
} from '../entity/pickupPool.js';
import {
  EV_BARREL_BROKEN,
  EV_BARREL_GREW,
  EV_WALL_BROKEN,
  EV_CONSUMABLE_TAKEN,
  EV_GEM_COLLECTED,
  EV_GEM_SPAWNED,
  pushEvent,
} from '../events/ring.js';
import { openChest } from './progression.js';
import type { World } from '../types.js';

/** Uint16Array ceiling. An absorbed gem saturates here rather than wrapping to a white gem. */
const MAX_GEM_VALUE = 65535;

/**
 * How fast the SIDEWAYS half of a magnetised gem's velocity is bled off, per second.
 *
 * 6 is a time constant of about 0.17 s: fast enough that no gem completes a lap, slow enough that
 * a gem thrown sideways by a blast still visibly curves rather than snapping onto the radius.
 * Above about 12 the arc disappears and gems appear to change direction; below about 3 the orbits
 * come back. It is in this file rather than in Tuning because it is not a balance dial - it is the
 * difference between the magnet working and not.
 */
const MAGNET_TANGENT_DAMP = 6;

export function updatePickups(world: World, dt: number): void {
  const p = world.player;
  if (p.magnetSec > 0) {
    p.magnetSec -= dt;
    if (p.magnetSec < 0) p.magnetSec = 0;
  }
  regrowBarrels(world);
  dropGems(world);
  magnetAndCollect(world, dt);
}

/**
 * Stands one broken drum back up every `barrelRegrowSec` of PLAYED time.
 *
 * THE YARD USED TO BE A FIXED ALLOWANCE. Scenery was generated once at world creation and a
 * broken barrel was gone for the rest of the run, so a 16-minute run spent its second half in
 * ground the player had already stripped - the piles do not move, so a cleared area stays cleared
 * and the whole mechanic quietly stopped existing partway through.
 *
 * `runTicks` RATHER THAN `tick`, and a modulo rather than a stored timer. runTicks is frozen while
 * a level-up card or a chest is open, so the cadence counts time the player was actually PLAYING -
 * eighteen seconds of fighting, not eighteen seconds of menu. The modulo means there is no timer
 * to add to World, to reset, or to keep in the hash; the schedule is a pure function of the clock.
 *
 * THE DRAW IS ON `rng.loot`, like everything else a barrel does. Not `spawn` - see this file's
 * header: the horde must not depend on how much scrap the player has shot, and that argument runs
 * in both directions.
 */
function regrowBarrels(world: World): void {
  const every = Math.round(world.config.tuning.pickups.barrelRegrowSec / DT);
  if (every <= 0) return;
  if (world.runTicks === 0 || world.runTicks % every !== 0) return;

  const i = regrowBarrel(world.scenery, world.rng.loot, world.player.x, world.player.y);
  if (i < 0) return;
  pushEvent(
    world.events,
    EV_BARREL_GREW,
    world.tick,
    sceneryX(world.scenery, i),
    sceneryY(world.scenery, i),
    sceneryRadius(world.scenery, i),
    0,
  );
}

// -------------------------------------------------------------------------------------------
// Fuel barrels and what falls out of them
// -------------------------------------------------------------------------------------------

/**
 * Breaks whatever DESTRUCTIBLE TERRAIN overlaps the circle (x, y, r). Returns true if something
 * went. On the Scrapyard that is a fuel barrel, and what was inside falls out; on Mossy Mayhem it
 * is a tree, which leaves a stump and nothing else.
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

  const bx = sceneryX(world.scenery, i);
  const by = sceneryY(world.scenery, i);

  // A TREE IS NOT A DRUM, and this is the one place the difference has to be spoken aloud. Both
  // terrains answer `destructibleOverlap`, so all four callers above reach this function without
  // knowing which map they are on - but what happens next genuinely differs, and pretending
  // otherwise would either drop loot out of a hedge or make every tree on the moss map explode.
  //
  // Written as an early return rather than a shared body with two `if`s in it, so the barrel path
  // below reads exactly as it did before there was a second terrain.
  if (world.scenery.kind === 'walls') {
    const br = sceneryRadius(world.scenery, i);
    destroyScenery(world.scenery, i);
    pushEvent(world.events, EV_WALL_BROKEN, world.tick, bx, by, br, 0);
    return true;
  }

  // OFF SCREEN, SO IT SURVIVES. See BARREL_BREAK_RADIUS: a drum the player cannot see is a drum
  // whose contents they will never collect, so breaking it only costs them the barrel. Measured
  // from the MECH rather than from the hit, because the mech is what the camera is centred on -
  // an artillery shell landing 800 u away is exactly the case this exists for.
  //
  // Every caller ignores the return value, so refusing is free: the shell still lands, the beam
  // still burns, the blast still goes off. Only the drum is spared.
  const dx = bx - world.player.x;
  const dy = by - world.player.y;
  if (dx * dx + dy * dy > BARREL_BREAK_RADIUS * BARREL_BREAK_RADIUS) return false;
  // Read BEFORE destroying: destruction is a radius write, so this is the last tick the size of
  // the thing that went up exists anywhere, and the renderer sizes its burst from it.
  const br = sceneryRadius(world.scenery, i);
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

  // EMPTY. Drawn from the same `which` roll rather than a separate one, so the odds are a single
  // readable partition of [0, 1) and adding a fourth outcome later does not change how many values
  // a barrel consumes. The break still happens - the burst, the event, the stat - because "you
  // opened it and there was nothing in it" is a result, and one the player has to be able to see.
  if (which < t.barrelEmptyChance) return;

  let kind: number;
  let value: number;
  let tier: number;

  // The kind thresholds sit ABOVE the empty band, so the three shares below are shares of the
  // barrels that actually held something.
  const held = (which - t.barrelEmptyChance) / (1 - t.barrelEmptyChance);

  if (held < CONSUMABLE_REPAIR_CHANCE) {
    kind = PICKUP_KIND_REPAIR;
    value = Math.max(1, Math.round(world.player.stats.maxHp * t.repairFrac));
    tier = 0;
  } else if (held < CONSUMABLE_REPAIR_CHANCE + CONSUMABLE_MAGNET_CHANCE) {
    kind = PICKUP_KIND_MAGNET;
    value = 0;
    tier = 0;
  } else if (held < CONSUMABLE_REPAIR_CHANCE + CONSUMABLE_MAGNET_CHANCE + CONSUMABLE_DICE_CHANCE) {
    kind = PICKUP_KIND_DICE;
    value = 1; // one reroll. A field rather than a constant, so a future big die is a value change.
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

/**
 * Puts a Cyber Chest where a boss fell.
 *
 * NO ROLL AND NO CHANCE. Every boss drops one, every time. A boss is the longest single engagement
 * in the game and there are only seven of them in a run; a chest that sometimes did not appear
 * would turn the one guaranteed reward in the yard into another thing the player feels unlucky
 * about.
 *
 * It is a pickup rather than a scenery object because it has to be walked over, has to persist
 * exactly where it fell, and has to survive the boss's body being reaped in the same tick.
 */
function dropChest(world: World, x: number, y: number): void {
  const handle = allocPickup(
    world.pickups,
    PICKUP_KIND_CHEST,
    0,
    0,
    x,
    y,
    CHEST_SPAWN_ID_BASE + world.tick,
  );
  if (handle === NULL_HANDLE) return;
  const d = world.pickups.count - 1;
  world.pickups.flags[d] |= PICKUP_FLAG_AUTO;
  pushEvent(world.events, EV_GEM_SPAWNED, world.tick, x, y, 0, 0);
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
 * THE DICE, and it is the rarest thing a drum can hold by a wide margin: one barrel in twenty that
 * is not empty, against nine for a spanner and three for a magnet.
 *
 * RARE BECAUSE OF WHAT IT IS, not because it is strong. A reroll is worth whatever the worst card
 * you are about to be offered is worth, which is sometimes a run and usually nothing - so it cannot
 * be priced like a heal. What it CAN be is the drop you remember finding, and that only works if
 * finding one is an event. Five percent is about one a run.
 *
 * It comes out of the coin's share rather than the spanner's. Credits are the filler outcome and
 * the one a player is least attached to; taking the die's slice from the heal would have made
 * barrels measurably worse at the job they are mostly there for.
 */
const CONSUMABLE_DICE_CHANCE = 0.05;

/**
 * Consumable spawnIds live above every gem's. A gem's is `1 + tick * MAX_KILLS_PER_TICK + k`, so
 * this base clears the whole space a 15-minute run can reach and the renderer can keep keying
 * sprites off spawnId without the two ever colliding.
 */
const CONSUMABLE_SPAWN_ID_BASE = 0x40000000;

/** Above the consumables' band, for the same reason theirs sits above the gems'. */
const CHEST_SPAWN_ID_BASE = 0x60000000;

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

    // A CYBER CHEST as well as a core. Dropped here rather than in updateDamage because this is
    // already the stage that turns a KillFeed entry into something on the ground, and the feed
    // carries both the flags and the flavour that say which kills pay one.
    //
    // ABOVE the cap check, deliberately. It used to sit below it, behind a `continue`, so a boss
    // killed while the field was saturated - which is to say any boss in the back half of a long
    // run - left no chest at all. The one guaranteed reward in the game must not be contingent on
    // how many gems happen to be lying in a corner of the yard.
    // A BOSS LEAVES ONE, and so does anything whose FLAVOUR says it does - the Chest Dropper, an
    // elite that exists to be shot for exactly this. Read off the table rather than tested by id,
    // so a second body that pays a chest is a literal in FLAVOURS and not a third clause here.
    if (
      (feed.flags[k] & ENEMY_FLAG_BOSS) !== 0 ||
      FLAVOURS[feed.flavour[k]]?.dropsChest === true
    ) {
      dropChest(world, x, y);
    }

    // MAKE ROOM RATHER THAN REFUSE THE DROP. See the header: at the cap, every kill is at the cap,
    // so refusing here is refusing for the rest of the run.
    if (pool.count >= GEM_SOFT_CAP) recycleOldestGem(world);

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
 * Retires the OLDEST live gem, merging its value into the live gem nearest to it.
 *
 * OLDEST - not furthest, not smallest. Age is the honest proxy for "abandoned": the yard is 12 288
 * units across and the fighting moves around it, so a gem that has survived a long time is one
 * nobody went back for. Distance-from-player would eat the gem the player is sprinting towards the
 * instant they turned around; smallest-value would strip the field of exactly the cheap gems that
 * make a horde kill look like a horde kill. Age is also free to compute - spawnId is already a
 * monotonic clock (`1 + tick * MAX_KILLS_PER_TICK + k`) and already unique, so "oldest" is a
 * minimum over a field the pool has to carry anyway.
 *
 * NEAREST TO THE RETIRED GEM, not nearest to the player. The merge is meant to be invisible: two
 * gems in a forgotten corner become one richer gem in that same corner. Sending the value to the
 * player's neighbourhood instead would be a slow teleport of XP across the map, and would make the
 * gems around the player silently swell for reasons nothing on screen explains.
 *
 * Consumables and chests are skipped by kind in both passes. They share the pool but not the rule -
 * a spanner is not spare capacity, and a chest that evaporated because the gem field filled up
 * would be the boss-reward bug again in a different costume.
 */
function recycleOldestGem(world: World): void {
  const pool = world.pickups;
  const n = pool.count;

  let oldest = -1;
  for (let d = 0; d < n; d++) {
    if ((pool.flags[d] & PICKUP_FLAG_DEAD) !== 0) continue;
    if (pool.kind[d] !== PICKUP_KIND_GEM) continue;
    if (oldest < 0 || pool.spawnId[d] < pool.spawnId[oldest]) oldest = d;
  }
  if (oldest < 0) return;

  const ox = pool.x[oldest];
  const oy = pool.y[oldest];

  let best = -1;
  let bestD2 = 0;
  for (let d = 0; d < n; d++) {
    if (d === oldest) continue;
    if ((pool.flags[d] & PICKUP_FLAG_DEAD) !== 0) continue;
    if (pool.kind[d] !== PICKUP_KIND_GEM) continue;
    const dx = pool.x[d] - ox;
    const dy = pool.y[d] - oy;
    const d2 = dx * dx + dy * dy;
    if (best < 0 || d2 < bestD2 || (d2 === bestD2 && pool.spawnId[d] < pool.spawnId[best])) {
      best = d;
      bestD2 = d2;
    }
  }
  // The oldest gem is the only gem. Retiring it would delete its XP outright, so it stays and the
  // caller's drop simply takes another slot - PICKUP_CAP has headroom above the soft cap for
  // exactly this sort of edge.
  if (best < 0) return;

  const total = pool.value[best] + pool.value[oldest];
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

  // Marked, not removed - S12 owns removal, so `pool.count` does not fall until the end of the
  // tick and the caller's allocPickup takes a fresh slot above it. PICKUP_CAP is sized for that.
  markPickupDead(pool, oldest);
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
    //
    // A SPANNER AT FULL HEALTH IS LEFT WHERE IT LIES rather than consumed for nothing. It used to
    // clamp to maxHp on collection, which is the same thing as deleting it - and a player at full
    // health walks over spanners constantly, because full health is the state you spend most of a
    // good run in. So the one reward that answers "I am about to die" was mostly being destroyed
    // by people who were fine. It now waits, and the question the barrel posed stays open.
    //
    // NOT AN EARLY `continue`: it falls through to the same skip every consumable takes, so the
    // spanner is simply not TAKEN. It stays in the pool, keeps its position, and is collected the
    // moment the player comes back to it having lost something.
    if (pool.kind[d] !== PICKUP_KIND_GEM) {
      if (d2 <= consumableR2 && !wouldBeWasted(world, pool.kind[d])) takeConsumable(world, d);
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
    const ux = dx * inv;
    const uy = dy * inv;

    // SPLIT THE VELOCITY AND DAMP THE SIDEWAYS HALF. This is the whole fix for gems that ORBITED.
    //
    // Acceleration toward a point, with no damping, is not a magnet - it is gravity, and gravity
    // makes satellites. Any gem with a sideways component kept it forever: it swung round the
    // player instead of arriving, and the moment its circle carried it past `pickupRadius` the
    // field let go and the velocity was zeroed, which is the "flung away and lands still" half of
    // the same bug. Both halves are one missing term.
    //
    // So the velocity is resolved into RADIAL (toward the player) and TANGENTIAL (around him). The
    // radial part accelerates exactly as before. The tangential part is what makes an orbit, and it
    // is damped away in about a sixth of a second - so a gem curves in hard and lands, and nothing
    // can ever settle into a stable circle.
    //
    // NOT A GLOBAL DRAG, which is the other way to kill an orbit and the wrong one: drag would also
    // slow the approach, and the approach is the feedback the whole magnet exists to give.
    const vr = pool.vx[d] * ux + pool.vy[d] * uy;
    let tx = pool.vx[d] - vr * ux;
    let ty = pool.vy[d] - vr * uy;
    const keep = 1 - MAGNET_TANGENT_DAMP * dt;
    const damp = keep > 0 ? keep : 0;
    tx *= damp;
    ty *= damp;

    const nvr = vr + accel * dt;
    let vx = ux * nvr + tx;
    let vy = uy * nvr + ty;

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
    const edge = world.arenaHalf;
    if (x < -edge) x = -edge;
    else if (x > edge) x = edge;
    if (y < -edge) y = -edge;
    else if (y > edge) y = edge;

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
 * Would running over this consumable throw it away?
 *
 * ONE KIND ANSWERS YES: a repair at full health. Credits always land, and a magnet is a refresh
 * rather than a stack, so taking a second one mid-pull genuinely does something.
 *
 * `>=` rather than `>`: hp is a float that regen and clamping both write, so "full" is a state the
 * number reaches exactly and must not be one ulp away from.
 */
function wouldBeWasted(world: World, kind: number): boolean {
  if (kind !== PICKUP_KIND_REPAIR) return false;
  return world.player.hp >= world.player.stats.maxHp;
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

  if (kind === PICKUP_KIND_CHEST) {
    // FREEZES THE WORLD. openChest rolls the spin and sets RUN_PHASE_CHEST, so this tick is the
    // last one the horde moves until the player acknowledges the overlay. Marked dead first: the
    // chest must not still be sitting there to be collected a second time on the tick the phase
    // changes back.
    markPickupDead(pool, d);
    world.stats.consumables++;
    pushEvent(world.events, EV_CONSUMABLE_TAKEN, world.tick, pool.x[d], pool.y[d], 0, kind);
    openChest(world);
    return;
  }

  if (kind === PICKUP_KIND_REPAIR) {
    // Clamped to max: a spanner tops you up, it never overheals into a buffer the HUD cannot show.
    const hp = player.hp + value;
    player.hp = hp > player.stats.maxHp ? player.stats.maxHp : hp;
  } else if (kind === PICKUP_KIND_CREDIT) {
    world.stats.credits += value;
  } else if (kind === PICKUP_KIND_DICE) {
    // BANKED, NOT SPENT. It sits on the run until the player chooses to burn it on a card they do
    // not like, which is the whole point: every other consumable resolves the instant you touch
    // it, and this one is the only thing in the yard you can decide what to do with later.
    world.levelUp.rerolls += value;
    world.stats.dice++;
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
