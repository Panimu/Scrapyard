/**
 * hashWorld - FNV-1a over everything that defines the simulation state.
 *
 * This is the determinism suite's workhorse: same seed + same InputFrame[] must produce the same
 * u32 at every checkpoint, in Node and in a Playwright-driven Chromium page. That cross-engine
 * comparison is what actually validates the one unproven assumption in the design - that
 * Math.sqrt is correctly rounded everywhere (DESIGN.md §2).
 *
 * Covered: the live dense range of all three pools (in dense order), the player struct, the
 * weapon instances, the director, the difficulty scales, the level-up state, and all three RNG
 * states. NOT covered: prevX/prevY (a pure copy of last tick's x/y), the event ring (whose read
 * cursor belongs to the renderer, so hashing it would make the hash depend on how often the
 * renderer drained), and RunStats (derived, and useful to diff separately when a hash mismatch
 * needs explaining).
 */

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
  const g = world.pickups;
  h = mixPool(h, g.bytes, g.denseViews, g.count);
  h = mixU32(h, g.freeCount);

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

  h = mixF64(h, world.xpBanked);

  h = mixRng(h, world.rng.spawn);
  h = mixRng(h, world.rng.loot);
  h = mixRng(h, world.rng.upgrade);
  h = mixRng(h, world.rng.weapon);

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
