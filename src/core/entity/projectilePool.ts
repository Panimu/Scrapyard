/**
 * Projectile pool. Same dense-array + sparse-set + deferred-removal shape as EnemyPool
 * (see that file for why), with the fields a shell needs.
 *
 * Deliberately a copy rather than a shared abstraction: three hand-written pools with explicit
 * fields are less code, faster, and easier to debug than any generic component system at this
 * scale - and a generic one goes megamorphic in exactly the loops that matter.
 */

import {
  NULL_HANDLE,
  nextGeneration,
  packHandle,
  handleGen,
  handleSlot,
  type ProjectileHandle,
} from './handle.js';
import { PoolLayout, type NumericArray } from './layout.js';

export const PROJECTILE_FLAG_DEAD = 1 << 0;
/**
 * Never collides with a body; only its fuse can end it.
 *
 * Artillery shells land where the barrage aimed, not where something happened to be standing. A
 * shell that detonated on contact would fire early and off-centre the moment it clipped a runt
 * on the way in, which would quietly turn an area-denial weapon into a very slow homing one.
 */
export const PROJECTILE_FLAG_NOCONTACT = 1 << 1;
/**
 * THIS SHELL SPLITS WHEN ITS FUSE RUNS OUT instead of ending. The GTM Hornet's warheads and
 * nothing else - see `splitProjectile` in systems/projectiles.ts.
 *
 * A FLAG ON THE SHELL RATHER THAN A LOOKUP THROUGH ITS WEAPON, because the two children are
 * ordinary missiles that must NOT split again. They are fired by the same weapon at the same tier,
 * so anything derived from the owner would be true of them too and one Hornet volley would become
 * a chain reaction. The property belongs to the shell, so it lives on the shell.
 */
export const PROJECTILE_FLAG_SPLITS = 1 << 2;

/** Stride of the per-projectile hit ring: the last 4 enemy spawnIds this shell has damaged. */
export const HIT_RING_STRIDE = 4;

export interface ProjectilePool {
  readonly capacity: number;
  count: number;
  readonly buffer: ArrayBuffer;
  readonly bytes: Uint8Array;
  readonly denseViews: readonly NumericArray[];

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;

  readonly damage: Float32Array;
  readonly knockback: Float32Array;
  readonly splashRadius: Float32Array;
  readonly splashFrac: Float32Array;
  readonly radius: Float32Array;
  /** Counts down; <= 0 marks the shell dead. */
  readonly lifeSec: Float32Array;
  /** Distance travelled so far. LONGBOW's Spotter trait reads it - one add per projectile per
   *  tick, which is cheaper and more robust than remembering a spawn position. */
  readonly travelled: Float32Array;

  readonly pierceLeft: Int8Array;
  /** Index into PROJECTILE_BEHAVIOURS. */
  readonly behaviour: Uint8Array;
  readonly ownerWeapon: Uint8Array;
  /** Render-only, but sim-owned so it lands in the replay. */
  readonly visualId: Uint8Array;
  readonly flags: Uint8Array;

  /** Ring of the last HIT_RING_STRIDE enemy spawnIds hit, so a piercing shell cannot re-hit the
   *  same enemy on consecutive ticks. spawnId 0 is never issued, so 0 means "empty". */
  readonly hitRing: Uint32Array;
  readonly hitRingPos: Uint8Array;

  readonly spawnId: Uint32Array;
  readonly slot: Uint32Array;

  readonly denseOf: Int32Array;
  readonly generation: Uint16Array;

  readonly freeSlots: Uint16Array;
  freeCount: number;

  readonly killQueue: Uint16Array;
  killCount: number;
}

export function createProjectilePool(capacity: number): ProjectilePool {
  const L = new PoolLayout();
  const oX = L.f32(capacity);
  const oY = L.f32(capacity);
  const oPrevX = L.f32(capacity);
  const oPrevY = L.f32(capacity);
  const oVx = L.f32(capacity);
  const oVy = L.f32(capacity);
  const oDamage = L.f32(capacity);
  const oKnockback = L.f32(capacity);
  const oSplashRadius = L.f32(capacity);
  const oSplashFrac = L.f32(capacity);
  const oRadius = L.f32(capacity);
  const oLifeSec = L.f32(capacity);
  const oTravelled = L.f32(capacity);
  const oHitRing = L.u32(capacity * HIT_RING_STRIDE);
  const oSpawnId = L.u32(capacity);
  const oSlot = L.u32(capacity);
  const oDenseOf = L.i32(capacity);
  const oGeneration = L.u16(capacity);
  const oFreeSlots = L.u16(capacity);
  const oKillQueue = L.u16(capacity);
  const oPierceLeft = L.i8(capacity);
  const oBehaviour = L.u8(capacity);
  const oOwnerWeapon = L.u8(capacity);
  const oVisualId = L.u8(capacity);
  const oFlags = L.u8(capacity);
  const oHitRingPos = L.u8(capacity);

  const buffer = new ArrayBuffer(L.byteLength);
  const f32 = (o: number): Float32Array => new Float32Array(buffer, o, capacity);
  const u32 = (o: number): Uint32Array => new Uint32Array(buffer, o, capacity);
  const u16 = (o: number): Uint16Array => new Uint16Array(buffer, o, capacity);
  const u8 = (o: number): Uint8Array => new Uint8Array(buffer, o, capacity);

  const denseViews: NumericArray[] = [];

  const p: ProjectilePool = {
    capacity,
    count: 0,
    buffer,
    bytes: new Uint8Array(buffer),
    denseViews,

    x: f32(oX),
    y: f32(oY),
    prevX: f32(oPrevX),
    prevY: f32(oPrevY),
    vx: f32(oVx),
    vy: f32(oVy),
    damage: f32(oDamage),
    knockback: f32(oKnockback),
    splashRadius: f32(oSplashRadius),
    splashFrac: f32(oSplashFrac),
    radius: f32(oRadius),
    lifeSec: f32(oLifeSec),
    travelled: f32(oTravelled),

    pierceLeft: new Int8Array(buffer, oPierceLeft, capacity),
    behaviour: u8(oBehaviour),
    ownerWeapon: u8(oOwnerWeapon),
    visualId: u8(oVisualId),
    flags: u8(oFlags),

    hitRing: new Uint32Array(buffer, oHitRing, capacity * HIT_RING_STRIDE),
    hitRingPos: u8(oHitRingPos),

    spawnId: u32(oSpawnId),
    slot: u32(oSlot),

    denseOf: new Int32Array(buffer, oDenseOf, capacity),
    generation: u16(oGeneration),

    freeSlots: u16(oFreeSlots),
    freeCount: capacity,

    killQueue: u16(oKillQueue),
    killCount: 0,
  };

  denseViews.push(
    p.x, p.y, p.vx, p.vy,
    p.damage, p.knockback, p.splashRadius, p.splashFrac, p.radius, p.lifeSec, p.travelled,
    p.pierceLeft, p.behaviour, p.ownerWeapon, p.visualId, p.flags,
    p.spawnId, p.slot,
  );

  resetProjectilePool(p);
  return p;
}

export function resetProjectilePool(p: ProjectilePool): void {
  p.count = 0;
  p.killCount = 0;
  p.freeCount = p.capacity;
  p.denseOf.fill(-1);
  p.generation.fill(1);
  for (let i = 0; i < p.capacity; i++) p.freeSlots[i] = p.capacity - 1 - i;
}

/**
 * Allocates one shell. Returns NULL_HANDLE when full.
 *
 * The caller (a FirePattern) sets damage/knockback/splash/pierce/behaviour afterwards; this
 * only owns identity, position, velocity and the bookkeeping that must never be forgotten -
 * in particular clearing the hit ring, which would otherwise make a recycled slot immune to
 * the enemy the previous shell last hit.
 */
export function allocProjectile(
  p: ProjectilePool,
  x: number,
  y: number,
  vx: number,
  vy: number,
  lifeSec: number,
  ownerWeapon: number,
  behaviour: number,
  spawnId: number,
): ProjectileHandle {
  if (p.freeCount === 0 || p.count >= p.capacity) return NULL_HANDLE as ProjectileHandle;

  const s = p.freeSlots[--p.freeCount];
  const d = p.count++;
  p.denseOf[s] = d;
  p.slot[d] = s;

  p.x[d] = x;
  p.y[d] = y;
  p.prevX[d] = x;
  p.prevY[d] = y;
  p.vx[d] = vx;
  p.vy[d] = vy;
  p.damage[d] = 0;
  p.knockback[d] = 0;
  p.splashRadius[d] = 0;
  p.splashFrac[d] = 0;
  p.radius[d] = 1;
  p.lifeSec[d] = lifeSec;
  p.travelled[d] = 0;
  p.pierceLeft[d] = 0;
  p.behaviour[d] = behaviour;
  p.ownerWeapon[d] = ownerWeapon;
  p.visualId[d] = 0;
  p.flags[d] = 0;
  p.spawnId[d] = spawnId;

  const base = d * HIT_RING_STRIDE;
  for (let i = 0; i < HIT_RING_STRIDE; i++) p.hitRing[base + i] = 0;
  p.hitRingPos[d] = 0;

  return packHandle(s, p.generation[s]) as ProjectileHandle;
}

export function markProjectileDead(p: ProjectilePool, d: number): void {
  if (d < 0 || d >= p.count) return;
  if ((p.flags[d] & PROJECTILE_FLAG_DEAD) !== 0) return;
  p.flags[d] |= PROJECTILE_FLAG_DEAD;
  if (p.killCount < p.capacity) p.killQueue[p.killCount++] = d;
}

/**
 * True if this shell has already damaged that enemy (by spawnId, which is never recycled).
 * Pierce would otherwise re-hit the same target every tick it overlaps it.
 */
export function projectileHasHit(p: ProjectilePool, d: number, enemySpawnId: number): boolean {
  const base = d * HIT_RING_STRIDE;
  for (let i = 0; i < HIT_RING_STRIDE; i++) {
    if (p.hitRing[base + i] === enemySpawnId) return true;
  }
  return false;
}

export function projectileRecordHit(p: ProjectilePool, d: number, enemySpawnId: number): void {
  const pos = p.hitRingPos[d] % HIT_RING_STRIDE;
  p.hitRing[d * HIT_RING_STRIDE + pos] = enemySpawnId;
  p.hitRingPos[d] = (pos + 1) % HIT_RING_STRIDE;
}

export function reapProjectiles(p: ProjectilePool): void {
  if (p.killCount === 0) return;

  for (let d = p.count - 1; d >= 0; d--) {
    if ((p.flags[d] & PROJECTILE_FLAG_DEAD) === 0) continue;

    const s = p.slot[d];
    const last = p.count - 1;
    if (d !== last) {
      p.x[d] = p.x[last];
      p.y[d] = p.y[last];
      p.prevX[d] = p.prevX[last];
      p.prevY[d] = p.prevY[last];
      p.vx[d] = p.vx[last];
      p.vy[d] = p.vy[last];
      p.damage[d] = p.damage[last];
      p.knockback[d] = p.knockback[last];
      p.splashRadius[d] = p.splashRadius[last];
      p.splashFrac[d] = p.splashFrac[last];
      p.radius[d] = p.radius[last];
      p.lifeSec[d] = p.lifeSec[last];
      p.travelled[d] = p.travelled[last];
      p.pierceLeft[d] = p.pierceLeft[last];
      p.behaviour[d] = p.behaviour[last];
      p.ownerWeapon[d] = p.ownerWeapon[last];
      p.visualId[d] = p.visualId[last];
      p.flags[d] = p.flags[last];
      p.spawnId[d] = p.spawnId[last];
      const dBase = d * HIT_RING_STRIDE;
      const lBase = last * HIT_RING_STRIDE;
      for (let i = 0; i < HIT_RING_STRIDE; i++) p.hitRing[dBase + i] = p.hitRing[lBase + i];
      p.hitRingPos[d] = p.hitRingPos[last];
      const movedSlot = p.slot[last];
      p.slot[d] = movedSlot;
      p.denseOf[movedSlot] = d;
    }
    p.count = last;

    p.denseOf[s] = -1;
    p.generation[s] = nextGeneration(p.generation[s]);
    p.freeSlots[p.freeCount++] = s;
  }

  p.killCount = 0;
}

export function projectileIndex(p: ProjectilePool, h: ProjectileHandle): number {
  if (h === NULL_HANDLE) return -1;
  const s = handleSlot(h);
  if (s >= p.capacity) return -1;
  if (p.generation[s] !== handleGen(h)) return -1;
  const d = p.denseOf[s];
  if (d < 0) return -1;
  if ((p.flags[d] & PROJECTILE_FLAG_DEAD) !== 0) return -1;
  return d;
}

export function isProjectileAlive(p: ProjectilePool, h: ProjectileHandle): boolean {
  return projectileIndex(p, h) >= 0;
}
