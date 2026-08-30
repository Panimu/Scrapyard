/**
 * hashWorld - FNV-1a over everything that defines the simulation state.
 *
 * This is the determinism suite's workhorse: same seed + same InputFrame[] must produce the same
 * u32 at every checkpoint, in Node and in a Playwright-driven Chromium page. That cross-engine
 * comparison is what actually validates the one unproven assumption in the design - that
 * Math.sqrt is correctly rounded everywhere (DESIGN.md §2).
 *
 * ---------------------------------------------------------------------------------------------
 * THE RULE FOR WHAT GOES IN
 * ---------------------------------------------------------------------------------------------
 * HASH THE STATE WHOSE DIVERGENCE WOULD NOT PROMPTLY SHOW UP IN STATE ALREADY HASHED.
 *
 * That is the whole test, and it cuts both ways. A latch like `insuranceUsed` can differ for eight
 * minutes before the mech comes near death, and `magnetSec` until a gem happens to be in range, so
 * both must be here. The spatial hash and the flow field are rebuilt from positions that ARE here,
 * so a difference in them turns into a difference in enemy positions within a tick or two and is
 * caught anyway - hashing them would cost a large walk per checkpoint to learn the same thing one
 * tick sooner. Scenery is the same argument by a different route: a barrel that broke in one run
 * and not the other spawns a pickup, and the pickup pool is hashed.
 *
 * Covered: all five pools in dense order, the projectile hit ring, the player struct including its
 * timers and latches, the weapon instances, the director, the difficulty scales, the level-up
 * state and its counters, the chest, the run-scoped unlock tallies, and all six RNG streams.
 *
 * Not covered, each for a reason above or below: prevX/prevY (a pure copy of last tick's x/y), the
 * event ring (whose read cursor belongs to the renderer, so hashing it would make the hash depend
 * on how often the renderer drained), the spatial hash, the flow field, the scenery grid, the
 * per-tick buffers, and RunStats (which has its own hash - see `hashRunStats` for why the two are
 * separate rather than merged).
 *
 * ---------------------------------------------------------------------------------------------
 * THIS FUNCTION DRIFTS, AND IT HAS DRIFTED TWICE
 * ---------------------------------------------------------------------------------------------
 * It once said "all three pools" and "all three RNG states", which was true when it was written.
 * By the time anyone checked there were five pools and six streams, and the drone pool, the sheep
 * pool, the projectile hit ring, and the `event` and `sheep` streams had never been added. A
 * second pass then found the chest state, the player's four timers and latches, the level-up
 * counters, `director.eventCycle`, `weapon.droneBanked`, `autoLevel`, the slot caps and the three
 * run-scoped unlock arrays - all of them live state, none of them hashed.
 *
 * `criticalArmed` is the one that settles the argument. Its own comment reads: "A number rather
 * than a boolean because World is hashed for replay determinism and the hash walks numeric
 * fields." It was deliberately typed to be hashed. It was never added.
 *
 * The hit ring had a second excuse worth naming, because it is the shape of excuse that hides
 * things: it is `capacity * HIT_RING_STRIDE` long, so it does not fit `mixPool`'s
 * one-element-per-slot walk. That is a reason it is absent from `denseViews`. It was never a
 * reason to leave it unhashed.
 *
 * THE LESSON, SINCE THIS WILL HAPPEN AGAIN: A NEW PIECE OF RUN STATE IS NOT FINISHED UNTIL IT IS
 * IN THIS FUNCTION, or until the rule at the top says in writing why it does not need to be.
 *
 * `tests/hashCoverage.test.ts` now guards the fields that have already been missed: it mutates
 * each one and asserts the hash moves. That retires the "nothing can test for this" excuse for
 * everything on the list, and only for those - it cannot invent a field nobody thought of. Add the
 * new field there as well as here, and the next person has a list to check against.
 */

import { HIT_RING_STRIDE } from './entity/projectilePool.js';
import type { NumericArray } from './entity/layout.js';
import { Rng, type RngState } from './rng.js';
import type { World } from './types.js';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mixBytes(h: number, bytes: Uint8Array, start: number, end: number): number {
  let acc = h;
  for (let i = start; i < end; i++) {
    acc = Math.imul(acc ^ bytes[i], FNV_PRIME);
  }
  return acc;
}

function mixU32(h: number, v: number): number {
  let acc = h;
  acc = Math.imul(acc ^ (v & 0xff), FNV_PRIME);
  acc = Math.imul(acc ^ ((v >>> 8) & 0xff), FNV_PRIME);
  acc = Math.imul(acc ^ ((v >>> 16) & 0xff), FNV_PRIME);
  acc = Math.imul(acc ^ ((v >>> 24) & 0xff), FNV_PRIME);
  return acc;
}

/** Hashes a float by its exact bit pattern - no epsilon, no tolerance. That is the point. */
const scratchF64 = new Float64Array(1);
const scratchU32 = new Uint32Array(scratchF64.buffer);
function mixF64(h: number, v: number): number {
  scratchF64[0] = v;
  return mixU32(mixU32(h, scratchU32[0]), scratchU32[1]);
}

/**
 * Hashes the live prefix of every dense view of a pool.
 * `denseViews` is ordered at pool construction, so this walks fields in a fixed order.
 */
function mixPool(
  h: number,
  bytes: Uint8Array,
  views: readonly NumericArray[],
  count: number,
): number {
  let acc = mixU32(h, count);
  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    const start = v.byteOffset;
    acc = mixBytes(acc, bytes, start, start + count * v.BYTES_PER_ELEMENT);
  }
  return acc;
}

const rngScratch: RngState = { a: 0, b: 0, c: 0, d: 0 };
function mixRng(h: number, rng: Rng): number {
  rng.save(rngScratch);
  return mixU32(mixU32(mixU32(mixU32(h, rngScratch.a), rngScratch.b), rngScratch.c), rngScratch.d);
}

/**
 * Field-by-field walkers, for the state `mixPool` cannot reach: the drone and sheep pools (plain
 * arrays rather than one carved ArrayBuffer, so no `denseViews`) and the projectile hit ring
 * (whose length is a multiple of the slot count).
 *
 * A FLOAT32 IS HASHED AS ITS FOUR BYTES, not as the eight of the double it widens to when read.
 * That keeps it identical to what `mixPool` does for the f32 columns of the other three pools, and
 * it is the thing a port has to match: `BitConverter.SingleToInt32Bits((float)v)`, not
 * `DoubleToInt64Bits(v)`.
 */
const scratchF32 = new Float32Array(1);
const scratchF32Bits = new Uint32Array(scratchF32.buffer);
function mixF32Array(h: number, a: Float32Array, count: number): number {
  let acc = h;
  for (let i = 0; i < count; i++) {
    scratchF32[0] = a[i];
    acc = mixU32(acc, scratchF32Bits[0]);
  }
  return acc;
}

function mixIntArrayN(h: number, a: Int32Array | Uint32Array, count: number): number {
  let acc = h;
  for (let i = 0; i < count; i++) acc = mixU32(acc, a[i]);
  return acc;
}

function mixU8ArrayN(h: number, a: Uint8Array, count: number): number {
  let acc = h;
  for (let i = 0; i < count; i++) acc = Math.imul(acc ^ a[i], FNV_PRIME);
  return acc;
}

/** One byte, masked - an Int8Array holds -128..127 and must not sign-extend into four. */
function mixI8Array(h: number, a: Int8Array, count: number): number {
  let acc = h;
  for (let i = 0; i < count; i++) acc = Math.imul(acc ^ (a[i] & 0xff), FNV_PRIME);
  return acc;
}

export function hashWorld(world: World): number {
  let h = FNV_OFFSET;

  h = mixU32(h, world.tick);
  h = mixU32(h, world.runTicks);
  h = mixU32(h, world.phase);

  const e = world.enemies;
  h = mixPool(h, e.bytes, e.denseViews, e.count);
  h = mixU32(h, e.freeCount);
  const p = world.projectiles;
  h = mixPool(h, p.bytes, p.denseViews, p.count);
  h = mixU32(h, p.freeCount);
  // THE HIT RING, which `denseViews` cannot carry: it is `capacity * HIT_RING_STRIDE` long, and
  // `mixPool` walks `count` elements of each view. Left out of the generic walker for that reason
  // and then never hashed anywhere else - but it is live, swap-removed state (reapProjectiles
  // moves it), and it decides whether a piercing shell may damage a body it has already hit. A
  // divergence here is a difference in damage dealt.
  h = mixIntArrayN(h, p.hitRing, p.count * HIT_RING_STRIDE);
  h = mixU8ArrayN(h, p.hitRingPos, p.count);

  const g = world.pickups;
  h = mixPool(h, g.bytes, g.denseViews, g.count);
  h = mixU32(h, g.freeCount);

  // DRONES AND SHEEP. No handles and no free list on either - both are plain dense arrays with
  // swap-remove - so there is no `freeCount` to fold, and the field order below IS the format.
  const dr = world.drones;
  h = mixU32(h, dr.count);
  h = mixF32Array(h, dr.x, dr.count);
  h = mixF32Array(h, dr.y, dr.count);
  h = mixF32Array(h, dr.angle, dr.count);
  h = mixU8ArrayN(h, dr.state, dr.count);
  h = mixIntArrayN(h, dr.targetDense, dr.count);
  h = mixIntArrayN(h, dr.ammo, dr.count);
  h = mixF32Array(h, dr.cooldownLeft, dr.count);
  h = mixU8ArrayN(h, dr.weaponSlot, dr.count);
  h = mixI8Array(h, dr.spin, dr.count);

  const sh = world.sheep;
  h = mixU32(h, sh.count);
  h = mixF32Array(h, sh.x, sh.count);
  h = mixF32Array(h, sh.y, sh.count);
  h = mixF32Array(h, sh.dirX, sh.count);
  h = mixF32Array(h, sh.dirY, sh.count);
  h = mixU8ArrayN(h, sh.state, sh.count);
  h = mixF32Array(h, sh.timer, sh.count);
  h = mixIntArrayN(h, sh.spawnId, sh.count);

  // The puddle pool, field by field, for the reason the drone and sheep pools are done here:
  // `mixPool` reaches the ArrayBuffer-backed pools and this is not one.
  const pu = world.puddles;
  h = mixU32(h, pu.count);
  h = mixF32Array(h, pu.x, pu.count);
  h = mixF32Array(h, pu.y, pu.count);
  h = mixF32Array(h, pu.radius, pu.count);
  h = mixF32Array(h, pu.dps, pu.count);
  h = mixF32Array(h, pu.left, pu.count);
  h = mixF32Array(h, pu.life, pu.count);
  h = mixU8ArrayN(h, pu.by, pu.count);

  const pl = world.player;
  h = mixF64(h, pl.x);
  h = mixF64(h, pl.y);
  h = mixF64(h, pl.vx);
  h = mixF64(h, pl.vy);
  h = mixF64(h, pl.hp);
  h = mixF64(h, pl.faceX);
  h = mixF64(h, pl.faceY);
  h = mixU32(h, pl.level);
  h = mixF64(h, pl.xp);
  h = mixF64(h, pl.xpToNext);
  h = mixU32(h, pl.heroId);
  // Shield state gates whether the NEXT hit lands at all, so two runs can differ in it alone -
  // one rim up, one down - and hash identically right until something finally bites. Same
  // argument as weapon heat below.
  h = mixU32(h, pl.shieldLayers);
  h = mixF64(h, pl.shieldTimer);
  h = mixF64(h, pl.invulnLeft);
  // THE TIMERS AND LATCHES, and `criticalArmed`'s own comment is why they belong here: it says it
  // is "a number rather than a boolean because World is hashed for replay determinism and the hash
  // walks numeric fields". It was typed to be hashed and then never added. All four gate behaviour
  // and can differ for a long time before anything observable happens - magnetSec until a gem
  // comes near, insuranceUsed until the mech nearly dies - which is exactly the profile that needs
  // hashing rather than the profile that does not.
  h = mixF64(h, pl.magnetSec);
  h = mixF64(h, pl.repairLeft);
  h = mixU32(h, pl.criticalArmed);
  h = mixU32(h, pl.insuranceUsed);
  for (let i = 0; i < pl.traitScratch.length; i++) h = mixF64(h, pl.traitScratch[i]);

  h = mixU32(h, world.weaponCount);
  for (let i = 0; i < world.weaponCount; i++) {
    const w = world.weapons[i];
    h = mixU32(h, w.defId);
    h = mixU32(h, w.level);
    h = mixF64(h, w.cooldownLeft);
    h = mixF64(h, w.turretX);
    h = mixF64(h, w.turretY);
    h = mixU32(h, w.targetDense);
    // Heat is simulation state that gates firing, so it belongs in the determinism key. Enemy hp
    // catches a beam divergence only indirectly and only once it has already changed the world;
    // two runs could differ in LATCH STATE alone - one laser cut out, one not - and hash
    // identically right up until that difference finally produces a shot.
    h = mixF64(h, w.heat);
    h = mixU32(h, w.overheated ? 1 : 0);
    h = mixU32(h, w.ammo);
    h = mixF64(h, w.reloadLeft);
    h = mixU32(h, w.droneBanked ? 1 : 0);
    for (let k = 0; k < w.scratch.length; k++) h = mixF64(h, w.scratch[k]);
  }

  const d = world.director;
  h = mixF64(h, d.localPressure);
  h = mixF64(h, d.targetPressure);
  h = mixU32(h, d.liveElites);
  h = mixF64(h, d.spawnAccumulator);
  h = mixU32(h, d.nextSpawnId);
  // The resolved cycle is a pure function of cycleIndex, so hashing the index covers it.
  h = mixU32(h, d.cycleIndex);
  h = mixU32(h, d.cyclePhase);
  h = mixF64(h, d.eliteTimer);
  h = mixU32(h, d.bossCycle);
  h = mixU32(h, d.eventCycle);
  h = mixU32(h, d.bossSpawned);
  h = mixU32(h, d.bossHandle);

  const diff = world.difficulty;
  h = mixF64(h, diff.hpRamp);
  h = mixF64(h, diff.speedRamp);
  h = mixU32(h, diff.lastWholeSecond);

  const lu = world.levelUp;
  h = mixU32(h, lu.pending);
  h = mixU32(h, lu.offerCount);
  for (let i = 0; i < lu.offers.length; i++) h = mixU32(h, lu.offers[i]);
  h = mixBytes(h, lu.stacks, 0, lu.stacks.length);
  h = mixU32(h, lu.picksTaken);
  h = mixU32(h, lu.lastTaken);
  h = mixU32(h, lu.rerolls);
  h = mixU32(h, lu.rerollsUsed);

  // THE CHEST. Entirely unhashed until now, which meant the reels could land differently and the
  // determinism suite would not say so - the payout only becomes visible once it has been applied
  // to `levelUp.stacks`, and an ascension not at all.
  const ch = world.chest;
  h = mixIntArrayN(h, ch.reels, ch.reels.length);
  h = mixU32(h, ch.payout);
  h = mixIntArrayN(h, ch.grants, ch.grants.length);
  h = mixU32(h, ch.opened);
  h = mixU32(h, ch.ascension);

  // Run-scoped tallies that nothing else reflects until much later, if at all.
  h = mixBytes(h, world.droneStacks, 0, world.droneStacks.length);
  h = mixBytes(h, world.cardUnlocked, 0, world.cardUnlocked.length);
  h = mixBytes(h, world.ascensionSeen, 0, world.ascensionSeen.length);
  h = mixU32(h, world.autoLevel);
  h = mixU32(h, world.maxWeapons);
  h = mixU32(h, world.maxPassives);
  h = mixU32(h, world.chestWeight);

  h = mixF64(h, world.xpBanked);

  // ALL SIX STREAMS. `event` and `sheep` were missing, which meant a special-event roll or a
  // sheep's next decision could come out differently and the hash would not say so.
  h = mixRng(h, world.rng.spawn);
  h = mixRng(h, world.rng.loot);
  h = mixRng(h, world.rng.upgrade);
  h = mixRng(h, world.rng.weapon);
  h = mixRng(h, world.rng.event);
  h = mixRng(h, world.rng.sheep);

  return h >>> 0;
}

/**
 * hashRunStats - the SECOND hash, over the tally rather than the state.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS SEPARATE FROM hashWorld RATHER THAN FOLDED INTO IT
 * ---------------------------------------------------------------------------------------------
 * `hashWorld` deliberately excludes RunStats as derived, and for its original job - catching a
 * simulation that has drifted - that is right. But "derived" is doing a lot of work in that
 * sentence, because there is a whole class of defect that changes the tally WITHOUT changing the
 * state: crediting `damageByWeapon` to the wrong catalog index, counting a kill twice, missing a
 * `barrelsBroken`. The world evolves identically and the numbers are wrong.
 *
 * Those numbers are not cosmetic. `RunStats` is what `meetsUnlock` is evaluated against, so a
 * mis-tallied stat is a chassis that does not unlock or an achievement that fires for the wrong
 * thing - and `platformKey` is permanent once shipped, so that mistake is not one you take back.
 *
 * Kept SEPARATE rather than merged because two hashes localise a failure and one does not. "World
 * matches, stats diverged at 04:00" points at the crediting site immediately; a single combined
 * hash would say only that something, somewhere, is different.
 *
 * ---------------------------------------------------------------------------------------------
 * EVERY SCALAR GOES THROUGH mixF64, INCLUDING THE COUNTERS
 * ---------------------------------------------------------------------------------------------
 * `kills` holds an integer, and hashing it as a u32 would be a byte cheaper. It goes through the
 * float path anyway, and the reason is a port rather than this language: a C# translation is free
 * to declare `int kills` or `double kills`, and an integer's f64 bit pattern is identical either
 * way. Hashing as u32 would silently make that declaration a determinism decision. Uniform f64 is
 * one fewer thing for a translator to get wrong.
 *
 * THE ORDER OF THESE LINES IS THE FORMAT. Adding a field means appending it, never inserting.
 */
export function hashRunStats(world: World): number {
  const s = world.stats;
  let h = FNV_OFFSET;

  h = mixF64(h, s.kills);
  h = mixU32Array(h, s.killsByArchetype);
  h = mixU32Array(h, s.killsByRank);
  h = mixU32Array(h, s.killsByCycleRank);
  h = mixF64(h, s.damageDealt);
  h = mixF64(h, s.damageTaken);
  h = mixF64(h, s.damagePrevented);
  h = mixF64(h, s.credits);
  h = mixF64(h, s.consumables);
  h = mixF64(h, s.dice);
  h = mixF64(h, s.barrelsBroken);
  h = mixF64(h, s.sheepTaken);
  h = mixF64(h, s.chests);
  h = mixF64Array(h, s.damageByWeapon);
  h = mixU32Array(h, s.bossKillsByWeapon);
  h = mixU32Array(h, s.killsByFlavour);
  h = mixU32Array(h, s.killsByWeapon);
  h = mixU32Array(h, s.killsByWeaponRank);
  h = mixF64(h, s.contactHits);
  h = mixF64(h, s.fullRepairs);
  h = mixF64(h, s.lasersOverheated);
  h = mixF64(h, s.splashKills);
  h = mixF64(h, s.reloads);
  h = mixF64(h, s.killedByRank);
  h = mixF64(h, s.damageByShield);
  h = mixF64(h, s.gemsCollected);
  h = mixF64(h, s.shotsFired);
  h = mixF64(h, s.shotsHit);
  h = mixF64(h, s.peakEnemies);
  h = mixF64(h, s.peakBurning);
  h = mixF64(h, s.secondaryTouched);
  h = mixF64(h, s.endTick);

  return h >>> 0;
}

/** Length first, so a resized array can never collide with a shorter one that shares a prefix. */
function mixU32Array(h: number, a: Uint32Array): number {
  let acc = mixU32(h, a.length);
  for (let i = 0; i < a.length; i++) acc = mixU32(acc, a[i]);
  return acc;
}

function mixF64Array(h: number, a: Float64Array): number {
  let acc = mixU32(h, a.length);
  for (let i = 0; i < a.length; i++) acc = mixF64(acc, a[i]);
  return acc;
}

/** Convenience for logs and golden-hash constants: an 8-character lowercase hex string. */
export function hashToHex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
