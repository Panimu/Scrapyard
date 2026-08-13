/**
 * Event ring + the three per-tick buffers that are the seams between the mandated systems.
 *
 * The render layer must not poll for "did anything explode?". It reads a ring.
 *
 * IT IS A RING WITH A READ CURSOR, NOT A PER-TICK BUFFER: the render loop may run up to 5 sim
 * steps in one frame, and events from step 1 must survive until the frame drains them.
 *
 * ONLY the render / audio / harness layers advance readCursor. Core systems NEVER read this -
 * that is what KillFeed is for. (A core system reading the ring would steal events from the
 * renderer and desync the visuals from the sim in a way that only shows up under frame drops.)
 */

export const EV_ENEMY_SPAWNED = 0;
export const EV_ENEMY_DAMAGED = 1;
export const EV_ENEMY_KILLED = 2;
export const EV_PLAYER_DAMAGED = 3;
export const EV_WEAPON_FIRED = 4;
export const EV_PROJECTILE_HIT = 5;
export const EV_PROJECTILE_EXPIRED = 6;
export const EV_GEM_SPAWNED = 7;
export const EV_GEM_COLLECTED = 8;
export const EV_LEVEL_UP = 9;
export const EV_UPGRADE_TAKEN = 10;
export const EV_PHASE_CHANGED = 11;
export const EV_BOSS_SPAWNED = 12;
/** A laser cut out at HEAT_MAX. The UI flashes the heat bar on this. */
export const EV_WEAPON_OVERHEATED = 13;
/** A laser cooled to HEAT_RESUME and is live again. */
export const EV_WEAPON_COOLED = 14;

/** Human-readable names, for the harness timeline and the debug HUD. Index === event kind. */
export const EVENT_NAMES: readonly string[] = [
  'ENEMY_SPAWNED',
  'ENEMY_DAMAGED',
  'ENEMY_KILLED',
  'PLAYER_DAMAGED',
  'WEAPON_FIRED',
  'PROJECTILE_HIT',
  'PROJECTILE_EXPIRED',
  'GEM_SPAWNED',
  'GEM_COLLECTED',
  'LEVEL_UP',
  'UPGRADE_TAKEN',
  'PHASE_CHANGED',
  'BOSS_SPAWNED',
];

export interface EventRing {
  readonly capacity: number;
  readonly mask: number;
  readonly kind: Uint8Array;
  readonly tick: Uint32Array;
  readonly a: Float32Array; // usually x
  readonly b: Float32Array; // usually y
  readonly c: Float32Array; // amount / slot
  readonly d: Float32Array; // id / aux
  writeCursor: number;
  readCursor: number;
  /** Events overwritten before anyone read them. Counted, never grown - no allocation. */
  dropped: number;
}

export function createEventRing(capacity: number): EventRing {
  return {
    capacity,
    mask: capacity - 1, // capacity is a power of two (EVENT_RING_CAPACITY)
    kind: new Uint8Array(capacity),
    tick: new Uint32Array(capacity),
    a: new Float32Array(capacity),
    b: new Float32Array(capacity),
    c: new Float32Array(capacity),
    d: new Float32Array(capacity),
    writeCursor: 0,
    readCursor: 0,
    dropped: 0,
  };
}

/**
 * EV_ENEMY_SPAWNED / EV_ENEMY_KILLED carry the SLOT in `c`. That is how the renderer maintains
 * `spriteBySlot: Int32Array` - an O(1) typed-array load per entity per frame, no Map, no hashing,
 * no allocation.
 */
export function pushEvent(
  r: EventRing,
  kind: number,
  tick: number,
  a: number,
  b: number,
  c: number,
  d: number,
): void {
  // Overwrite the oldest unread event rather than growing. A dropped cosmetic event is a
  // missing puff of smoke; an allocation mid-run is a dropped frame.
  if (r.writeCursor - r.readCursor >= r.capacity) {
    r.dropped++;
    r.readCursor++;
  }
  const i = r.writeCursor & r.mask;
  r.kind[i] = kind;
  r.tick[i] = tick;
  r.a[i] = a;
  r.b[i] = b;
  r.c[i] = c;
  r.d[i] = d;
  r.writeCursor++;
}

/** Number of unread events. Render/harness only. */
export function pendingEvents(r: EventRing): number {
  return r.writeCursor - r.readCursor;
}

/** Drops everything unread. Used when a consumer knows it has fallen too far behind to care. */
export function clearEvents(r: EventRing): void {
  r.readCursor = r.writeCursor;
}

// -------------------------------------------------------------------------------------------
// Per-tick buffers. Cleared in beginTick. These are the explicit seams between systems: the
// split exists so that DETECTION (updateCollision) and APPLICATION (updateDamage) are separately
// testable, and so damage order is an explicit property of a buffer rather than an emergent
// property of loop nesting.
// -------------------------------------------------------------------------------------------

/** Written by updateCollision, consumed by updateDamage. */
export interface HitBuffer {
  readonly capacity: number;
  count: number;
  readonly projectileDense: Uint16Array;
  readonly enemyDense: Uint16Array;
  /** Impact point, for the FX layer and for splash origin. */
  readonly x: Float32Array;
  readonly y: Float32Array;
}

export function createHitBuffer(capacity: number): HitBuffer {
  return {
    capacity,
    count: 0,
    projectileDense: new Uint16Array(capacity),
    enemyDense: new Uint16Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
  };
}

export function pushHit(
  h: HitBuffer,
  projectileDense: number,
  enemyDense: number,
  x: number,
  y: number,
): void {
  if (h.count >= h.capacity) return;
  const i = h.count++;
  h.projectileDense[i] = projectileDense;
  h.enemyDense[i] = enemyDense;
  h.x[i] = x;
  h.y[i] = y;
}

/**
 * Beams fired this tick. Written by updateWeapons, damage consumed by updateDamage, geometry
 * consumed by the renderer.
 *
 * SEPARATE FROM HitBuffer because a hit is keyed by the projectile that caused it, and a beam has
 * no projectile - it is hitscan. Rather than invent a sentinel projectile index that every
 * consumer would have to remember to check, beams get their own buffer and updateDamage reads
 * both. The detection/application split is preserved: updateWeapons decides WHAT a beam touched,
 * updateDamage decides what that costs.
 *
 * The endpoint is carried because the renderer must draw the beam terminating exactly where the
 * simulation said it stopped. Recomputing it render-side would let the line and the damage
 * disagree on a frame where interpolation moved the target.
 */
export interface BeamBuffer {
  readonly capacity: number;
  count: number;
  /** Index into World.weapons - identifies which laser, hence colour and width. */
  readonly weaponIdx: Uint8Array;
  /** Enemy struck, or NO_BEAM_TARGET when the beam reached its full length hitting nothing. */
  readonly enemyDense: Uint16Array;
  /** Damage applied THIS TICK (dps * dt), already scaled - updateDamage does not rescale it. */
  readonly damage: Float32Array;
  readonly x0: Float32Array;
  readonly y0: Float32Array;
  readonly x1: Float32Array;
  readonly y1: Float32Array;
}

/** enemyDense sentinel: the beam terminated in empty space. */
export const NO_BEAM_TARGET = 0xffff;

export function createBeamBuffer(capacity: number): BeamBuffer {
  return {
    capacity,
    count: 0,
    weaponIdx: new Uint8Array(capacity),
    enemyDense: new Uint16Array(capacity),
    damage: new Float32Array(capacity),
    x0: new Float32Array(capacity),
    y0: new Float32Array(capacity),
    x1: new Float32Array(capacity),
    y1: new Float32Array(capacity),
  };
}

export function pushBeam(
  b: BeamBuffer,
  weaponIdx: number,
  enemyDense: number,
  damage: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  if (b.count >= b.capacity) return;
  const i = b.count++;
  b.weaponIdx[i] = weaponIdx;
  b.enemyDense[i] = enemyDense;
  b.damage[i] = damage;
  b.x0[i] = x0;
  b.y0[i] = y0;
  b.x1[i] = x1;
  b.y1[i] = y1;
}

/** Player-vs-enemy overlaps this tick. Written by updateCollision, consumed by updateDamage. */
export interface ContactBuffer {
  readonly capacity: number;
  count: number;
  readonly enemyDense: Uint16Array;
}

export function createContactBuffer(capacity: number): ContactBuffer {
  return { capacity, count: 0, enemyDense: new Uint16Array(capacity) };
}

export function pushContact(c: ContactBuffer, enemyDense: number): void {
  if (c.count >= c.capacity) return;
  c.enemyDense[c.count++] = enemyDense;
}

/**
 * Written by updateDamage, consumed by updatePickups.
 *
 * Exists so drops do not have to read the event ring, whose read cursor belongs to the renderer.
 * It also carries the kill's position, which the enemy no longer has by the time gems spawn -
 * the corpse is reaped at S12.
 */
export interface KillFeed {
  readonly capacity: number;
  count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly xpValue: Uint16Array;
  readonly archetype: Uint8Array;
  readonly flags: Uint8Array;
}

export function createKillFeed(capacity: number): KillFeed {
  return {
    capacity,
    count: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    xpValue: new Uint16Array(capacity),
    archetype: new Uint8Array(capacity),
    flags: new Uint8Array(capacity),
  };
}

export function pushKill(
  k: KillFeed,
  x: number,
  y: number,
  xpValue: number,
  archetype: number,
  flags: number,
): void {
  if (k.count >= k.capacity) return;
  const i = k.count++;
  k.x[i] = x;
  k.y[i] = y;
  k.xpValue[i] = xpValue;
  k.archetype[i] = archetype;
  k.flags[i] = flags;
}
