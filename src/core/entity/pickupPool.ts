/**
 * Pickup pool (XP gems and repair motes). Same shape as the other two pools.
 *
 * Gems are the one pool that regularly sits near capacity, so overflow is a designed behaviour
 * rather than an error: above GEM_SOFT_CAP a new drop's value is ADDED to the nearest live gem
 * (tie-break: lowest spawnId) and that gem's tier upgrades to match. One linear pass, only on
 * overflow - bounded pool, same jackpot feel, no new data structure. That logic lives in
 * updatePickups; this file only provides the storage and the tie-break field.
 */

import {
  NULL_HANDLE,
  nextGeneration,
  packHandle,
  handleGen,
  handleSlot,
  type PickupHandle,
} from './handle.js';
import { PoolLayout, type NumericArray } from './layout.js';

export const PICKUP_FLAG_DEAD = 1 << 0;
/** Set on drops that skip the magnet and are collected on contact only (boss gem excepted). */
export const PICKUP_FLAG_AUTO = 1 << 1;

export const PICKUP_KIND_GEM = 0;
/**
 * CONSUMABLES - what a fuel barrel leaves behind. Everything above 0 is one, which is the only
 * test the magnet and the collector need to tell "XP" from "a thing you walk over and use".
 *
 *   REPAIR  a spanner. Heals a fraction of max HP.
 *   CREDIT  a blue coin. `value` is 1..50 and `tier` picks which of the four coin sprites is
 *           drawn, so the pile you can see IS the amount you are about to bank.
 *   MAGNET  drags every gem in the world to the player for a few seconds.
 */
export const PICKUP_KIND_REPAIR = 1;
export const PICKUP_KIND_CREDIT = 2;
export const PICKUP_KIND_MAGNET = 3;
/** A CYBER CHEST, left behind by a dead boss. Walk over it and the slot machine opens. */
export const PICKUP_KIND_CHEST = 4;

export interface PickupPool {
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

  readonly value: Uint16Array;
  readonly kind: Uint8Array;
  /** 0..4, selects the gem tint. Purely a function of `value`; stored so render need not bucket. */
  readonly tier: Uint8Array;
  readonly flags: Uint8Array;
  /** Tie-break for absorb-on-overflow, and the render layer's stable identity. */
  readonly spawnId: Uint32Array;
  readonly slot: Uint32Array;

  readonly denseOf: Int32Array;
  readonly generation: Uint16Array;

  readonly freeSlots: Uint16Array;
  freeCount: number;

  readonly killQueue: Uint16Array;
  killCount: number;
}

export function createPickupPool(capacity: number): PickupPool {
  const L = new PoolLayout();
  const oX = L.f32(capacity);
  const oY = L.f32(capacity);
  const oPrevX = L.f32(capacity);
  const oPrevY = L.f32(capacity);
  const oVx = L.f32(capacity);
  const oVy = L.f32(capacity);
  const oSpawnId = L.u32(capacity);
  const oSlot = L.u32(capacity);
  const oDenseOf = L.i32(capacity);
  const oValue = L.u16(capacity);
  const oGeneration = L.u16(capacity);
  const oFreeSlots = L.u16(capacity);
  const oKillQueue = L.u16(capacity);
  const oKind = L.u8(capacity);
  const oTier = L.u8(capacity);
  const oFlags = L.u8(capacity);

  const buffer = new ArrayBuffer(L.byteLength);
  const f32 = (o: number): Float32Array => new Float32Array(buffer, o, capacity);
  const u32 = (o: number): Uint32Array => new Uint32Array(buffer, o, capacity);
  const u16 = (o: number): Uint16Array => new Uint16Array(buffer, o, capacity);
  const u8 = (o: number): Uint8Array => new Uint8Array(buffer, o, capacity);

  const denseViews: NumericArray[] = [];

  const p: PickupPool = {
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

    value: u16(oValue),
    kind: u8(oKind),
    tier: u8(oTier),
    flags: u8(oFlags),
    spawnId: u32(oSpawnId),
    slot: u32(oSlot),

    denseOf: new Int32Array(buffer, oDenseOf, capacity),
    generation: u16(oGeneration),

    freeSlots: u16(oFreeSlots),
    freeCount: capacity,

    killQueue: u16(oKillQueue),
    killCount: 0,
  };

  denseViews.push(p.x, p.y, p.vx, p.vy, p.value, p.kind, p.tier, p.flags, p.spawnId, p.slot);

  resetPickupPool(p);
  return p;
}

export function resetPickupPool(p: PickupPool): void {
  p.count = 0;
  p.killCount = 0;
  p.freeCount = p.capacity;
  p.denseOf.fill(-1);
  p.generation.fill(1);
  for (let i = 0; i < p.capacity; i++) p.freeSlots[i] = p.capacity - 1 - i;
}

export function allocPickup(
  p: PickupPool,
  kind: number,
  value: number,
  tier: number,
  x: number,
  y: number,
  spawnId: number,
): PickupHandle {
  if (p.freeCount === 0 || p.count >= p.capacity) return NULL_HANDLE as PickupHandle;

  const s = p.freeSlots[--p.freeCount];
  const d = p.count++;
  p.denseOf[s] = d;
  p.slot[d] = s;

  p.x[d] = x;
  p.y[d] = y;
  p.prevX[d] = x;
  p.prevY[d] = y;
  p.vx[d] = 0;
  p.vy[d] = 0;
  p.value[d] = value;
  p.kind[d] = kind;
  p.tier[d] = tier;
  p.flags[d] = 0;
  p.spawnId[d] = spawnId;

  return packHandle(s, p.generation[s]) as PickupHandle;
}

export function markPickupDead(p: PickupPool, d: number): void {
  if (d < 0 || d >= p.count) return;
  if ((p.flags[d] & PICKUP_FLAG_DEAD) !== 0) return;
  p.flags[d] |= PICKUP_FLAG_DEAD;
  if (p.killCount < p.capacity) p.killQueue[p.killCount++] = d;
}

export function reapPickups(p: PickupPool): void {
  if (p.killCount === 0) return;

  for (let d = p.count - 1; d >= 0; d--) {
    if ((p.flags[d] & PICKUP_FLAG_DEAD) === 0) continue;

    const s = p.slot[d];
    const last = p.count - 1;
    if (d !== last) {
      p.x[d] = p.x[last];
      p.y[d] = p.y[last];
      p.prevX[d] = p.prevX[last];
      p.prevY[d] = p.prevY[last];
      p.vx[d] = p.vx[last];
      p.vy[d] = p.vy[last];
      p.value[d] = p.value[last];
      p.kind[d] = p.kind[last];
      p.tier[d] = p.tier[last];
      p.flags[d] = p.flags[last];
      p.spawnId[d] = p.spawnId[last];
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

export function pickupIndex(p: PickupPool, h: PickupHandle): number {
  if (h === NULL_HANDLE) return -1;
  const s = handleSlot(h);
  if (s >= p.capacity) return -1;
  if (p.generation[s] !== handleGen(h)) return -1;
  const d = p.denseOf[s];
  if (d < 0) return -1;
  if ((p.flags[d] & PICKUP_FLAG_DEAD) !== 0) return -1;
  return d;
}

export function isPickupAlive(p: PickupPool, h: PickupHandle): boolean {
  return pickupIndex(p, h) >= 0;
}
