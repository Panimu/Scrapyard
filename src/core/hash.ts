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
    for (let k = 0; k < w.scratch.length; k++) h = mixF64(h, w.scratch[k]);
  }

  const d = world.director;
  h = mixF64(h, d.localThreat);
  h = mixF64(h, d.targetThreat);
  h = mixF64(h, d.spawnAccumulator);
  h = mixU32(h, d.nextSpawnId);
  h = mixU32(h, d.tier);
  h = mixU32(h, d.eliteEventsSpawned);
  h = mixF64(h, d.surgeTimer);
  h = mixU32(h, d.bossSpawned);
  h = mixU32(h, d.bossHandle);

  const diff = world.difficulty;
  for (let i = 0; i < diff.hpScale.length; i++) h = mixF64(h, diff.hpScale[i]);
  for (let i = 0; i < diff.speedScale.length; i++) h = mixF64(h, diff.speedScale[i]);
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

  return h >>> 0;
}

/** Convenience for logs and golden-hash constants: an 8-character lowercase hex string. */
export function hashToHex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
