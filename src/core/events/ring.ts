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
/** A laser cut out at its own heatCapacity. The UI flashes the heat bar on this. */
export const EV_WEAPON_OVERHEATED = 13;
/** A magazine ran dry and a reload started. Payload: (weaponIdx, reloadSeconds). */
export const EV_WEAPON_RELOADING = 15;
/** A reload finished. Payload: (weaponIdx, rounds). */
export const EV_WEAPON_RELOADED = 16;
/** A laser cooled to its own heatResume and is live again. */
export const EV_WEAPON_COOLED = 14;
/**
 * An Energy Shield layer absorbed a hit. Payload: (x, y, damage PREVENTED, layers still up).
 * The prevented amount is the fully-resolved number the player would have taken - armour and
 * damageTakenMul already applied - so the harness can total what the shield is actually worth.
 */
export const EV_PLAYER_SHIELD_BROKEN = 17;
/** A layer finished recharging. Payload: (x, y, layers now up, capacity). */
export const EV_PLAYER_SHIELD_RESTORED = 18;
/**
 * A fused shell reached the end of its flight time and blew up in open air, hitting no body
 * directly. Payload: (x, y, splash RADIUS, visualId).
 *
 * Distinct from EV_PROJECTILE_HIT, which fires when something is actually struck, because the two
 * want different pictures: a hit is a spark on a body, and this is a crater whose size the
 * renderer cannot otherwise know - the blast radius is a per-projectile number and there is
 * nowhere else the render layer could read it once the shell has been reaped.
 */
export const EV_PROJECTILE_DETONATED = 19;
/**
 * A fuel barrel was destroyed by a weapon. Payload: (x, y, the barrel's radius, 0).
 *
 * Carries the radius because the renderer draws the burst to the size of the thing that went up,
 * and the simulation has already zeroed it by the time the event is drained - destruction IS a
 * radius write (content/scenery.ts), so this is the last place the number exists.
 */
export const EV_BARREL_BROKEN = 20;
/**
 * The player walked over a consumable. Payload: (x, y, value, KIND) - kind being the
 * PICKUP_KIND_* constant, so one event covers the spanner, the coin and the magnet and the
 * renderer picks the effect off `d`.
 */
export const EV_CONSUMABLE_TAKEN = 21;
/**
 * A Cyber Chest was walked onto and its reels are spinning. Payload: (x, y, payout, chests opened
 * this run). The overlay reads the landed symbols off `World.chest` rather than off this event -
 * three reels do not fit in four payload floats, and the state is still there when the drain runs.
 */
export const EV_CHEST_OPENED = 22;
/** The chest's upgrades have landed and the world is running again. Payload: (x, y, 0, 0). */
export const EV_CHEST_CLOSED = 23;
/**
 * A destroyed fuel barrel stood back up. Payload: (x, y, the barrel's radius, 0).
 *
 * APPENDED, never inserted. These numbers are written into replays, so the list is append-only in
 * exactly the way UPGRADE_CATALOG is - renumbering one would silently reinterpret every recording
 * ever made.
 *
 * The renderer does not have to do anything with this: regrowth happens at least 560 u away,
 * which is past the camera's reach, so there is nothing on screen to announce. It exists so the
 * harness timeline and the debug HUD can see the yard restocking rather than having to infer it
 * from a barrel count that went up on its own.
 */
export const EV_BARREL_GREW = 24;

/**
 * A level-up card was REROLLED. Payload: (rerolls left after the spend, rerollsUsed, 0, 0).
 *
 * Carries what is LEFT rather than what was spent, because that is the number the HUD and the
 * summary both want and the one a timeline reader is actually asking about.
 */
export const EV_UPGRADE_REROLLED = 25;

/**
 * A wave rolled a SPECIAL EVENT. Payload: (event id, cycle index, 1 if this was the wave's
 * mid-point roll rather than its opening one, 0).
 *
 * Pushed for `nothing` as well as for a set-piece, deliberately: the timeline is meant to answer
 * "what did this wave roll", and an entry that only appears when something happens cannot
 * distinguish a quiet wave from a broken roller.
 */
export const EV_SPECIAL_EVENT = 26;
/**
 * FIELD REPAIR put hit points back. Payload: (x, y, hp restored, 0).
 *
 * An event rather than something the renderer infers from the bar going up, because the bar also
 * goes up for a spanner and the two want different pictures - a spanner is a thing you walked to,
 * a repair is the mech mending itself.
 */
export const EV_PLAYER_REPAIRED = 27;
/**
 * MECH INSURANCE paid out. Payload: (x, y, seconds of immunity opened, 0).
 *
 * The single most consequential moment a run can have - the tick it was over and then was not - so
 * it gets an event of its own rather than being inferred from a full hull appearing. Nothing else
 * in the game restores every hit point at once, but a renderer watching for that would also fire on
 * the first frame of a run, which is when the hull is also suddenly full.
 *
 * The immunity duration is carried so the picture can last exactly as long as the window does. A
 * renderer that guessed at three seconds would drift the day the number is tuned, and an effect
 * that outlives the protection it depicts is worse than no effect.
 */
export const EV_PLAYER_SAVED = 28;
/**
 * A DESTRUCTIBLE WALL SEGMENT was broken - a tree on Mossy Mayhem. Payload: (x, y, radius, 0).
 *
 * ITS OWN EVENT RATHER THAN EV_BARREL_BROKEN, because the two look nothing alike and the renderer
 * has to be able to tell them apart: a drum is a fireball and a scorch mark, a felled tree is
 * leaves and a stump. Sharing the id would have made every tree on the moss map explode.
 */
export const EV_WALL_BROKEN = 29;
/**
 * A DRONE fired a round. Payload: (x, y, unit dir x, unit dir y) - identical to EV_WEAPON_FIRED,
 * because it wants the identical muzzle flash.
 *
 * ITS OWN EVENT, and the reason is everything ELSE the renderer hangs off a shot. `EV_WEAPON_FIRED`
 * means THE MECH FIRED, and the renderer answers it by kicking the turret back along its mount and
 * shoving the camera. A drone firing is not the mech firing, and it was pushing the same event -
 * so a fleet of four drones running a machine gun at ten rounds a second held the turret jammed
 * against its stop and the camera permanently shaking. The gun on the chassis was recoiling for
 * shots fired by something twenty units away from it.
 *
 * Splitting the id rather than adding a payload flag: the four slots are full, and "which of these
 * two things fired" is the kind of question the kind field exists to answer. The renderer draws the
 * same flash and does none of the rest.
 */
export const EV_DRONE_FIRED = 30;

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
  'WEAPON_OVERHEATED',
  'WEAPON_COOLED',
  'WEAPON_RELOADING',
  'WEAPON_RELOADED',
  'SHIELD_BROKEN',
  'SHIELD_RESTORED',
  'PROJECTILE_DETONATED',
  'BARREL_BROKEN',
  'CONSUMABLE_TAKEN',
  'CHEST_OPENED',
  'CHEST_CLOSED',
  'BARREL_GREW',
  'UPGRADE_REROLLED',
  'SPECIAL_EVENT',
  'PLAYER_REPAIRED',
  'PLAYER_SAVED',
  'WALL_BROKEN',
  'DRONE_FIRED',
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

/**
 * `enemyDense` sentinel: this hit has no directly-struck body.
 *
 * A missile that detonates on its fuse explodes in open air - splash only. Routing that through
 * the HitBuffer with a sentinel keeps ALL damage application in S9 rather than letting S7 reach
 * into enemy hp, which is the property that makes damage order testable.
 */
export const NO_DIRECT_HIT = 0xffff;

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
  /**
   * The dead body's FLAVOUR. Carried for the same reason the position is: the enemy is reaped at
   * S12 and the drop stage runs after it, so anything a drop depends on has to travel in the feed.
   * `dropsChest` is read off it - see FLAVOURS in content/enemyCatalog.ts.
   */
  readonly flavour: Uint8Array;
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
    flavour: new Uint8Array(capacity),
    flags: new Uint8Array(capacity),
  };
}

export function pushKill(
  k: KillFeed,
  x: number,
  y: number,
  xpValue: number,
  archetype: number,
  flavour: number,
  flags: number,
): void {
  if (k.count >= k.capacity) return;
  const i = k.count++;
  k.x[i] = x;
  k.y[i] = y;
  k.xpValue[i] = xpValue;
  k.archetype[i] = archetype;
  k.flavour[i] = flavour;
  k.flags[i] = flags;
}
