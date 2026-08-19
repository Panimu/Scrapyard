/**
 * Enemy pool: struct-of-arrays over one ArrayBuffer, with a dense array + sparse set for
 * stable identity and deferred removal.
 *
 * TWO INDEX SPACES - keeping them straight is the whole trick:
 *   dense `d` in [0, count)   - where data lives. Contiguous, no holes, so every system loop is
 *                               `for (let d = 0; d < p.count; d++)` with zero branches.
 *                               NOT stable across ticks: reap swap-removes.
 *   slot  `s` in [0, capacity) - stable identity. denseOf[s] -> d, slot[d] -> s.
 *
 * Naming convention, enforced in review: `d` always means dense index, `s` always means slot.
 *
 * WHY DEFERRED REMOVAL: projectile-vs-enemy collision kills enemies from inside a loop, while
 * the spatial hash holds hundreds of dense indices. An immediate swap-remove would reshuffle the
 * dense array under both. Marking instead keeps every dense index and every hash cell valid for
 * the whole tick, confines all pool mutation to one known stage (reapDead, S12), and gives
 * double-kill dedupe for free.
 */

import {
  NULL_HANDLE,
  nextGeneration,
  packHandle,
  handleGen,
  handleSlot,
  type EnemyHandle,
} from './handle.js';
import { PoolLayout, type NumericArray } from './layout.js';

export const ENEMY_FLAG_DEAD = 1 << 0;
export const ENEMY_FLAG_ELITE = 1 << 1;
export const ENEMY_FLAG_BOSS = 1 << 2;
/** Set by the director for enemies that must never be knocked back (the boss). */
export const ENEMY_FLAG_ANCHORED = 1 << 3;

export interface EnemyPool {
  readonly capacity: number;
  count: number;
  /** One backing allocation - makes hashing and snapshotting a single Uint8Array view. */
  readonly buffer: ArrayBuffer;
  /** Whole-buffer byte view. Used by hashWorld; never touched in the tick. */
  readonly bytes: Uint8Array;
  /** Every dense-indexed view, in a fixed order, for generic hashing. */
  readonly denseViews: readonly NumericArray[];

  // ---- dense-indexed components ----
  readonly x: Float32Array;
  readonly y: Float32Array;
  /**
   * Position at the end of the previous tick. Owned by CORE, consumed by the renderer for
   * sub-tick interpolation, and swap-removed alongside x/y - which is exactly why the renderer
   * cannot keep this itself: after a reap, dense index 47 is a different enemy, and a renderer
   * caching last-frame positions by dense index would interpolate enemy A's new position from
   * enemy B's old one (a one-frame teleport streak on every kill).
   */
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** Knockback velocity, decayed separately from steering so a punt reads as a punt. */
  readonly pushX: Float32Array;
  readonly pushY: Float32Array;
  readonly hp: Float32Array;
  readonly maxHp: Float32Array;
  readonly radius: Float32Array;
  readonly speed: Float32Array;
  readonly mass: Float32Array;
  /**
   * Fraction of an incoming impulse this body actually takes, resolved from its flavour at spawn.
   * 1 for everything except a Heavy. Separate from `mass` so halving what a shell does to a body
   * does not also change how that body shoves the crowd - see FlavourDef.knockback.
   */
  readonly knockbackTake: Float32Array;
  /**
   * THE CHARGE - a fixed heading an enemy walks along INSTEAD of chasing the player, and the
   * seconds left of it. Zero on everything the ordinary director spawns; written only by the
   * SWARM special event.
   *
   * A unit vector rather than a target point, because a point would be reached and then what? The
   * behaviour is "commit to a direction and cross the yard", so the direction is the state and it
   * is decided once, at spawn, from where the body is standing to where it is aiming.
   */
  readonly chargeX: Float32Array;
  readonly chargeY: Float32Array;
  readonly chargeLeft: Float32Array;
  /**
   * THE FIXATION - a fixed point this body walks at INSTEAD of the player, and the seconds left
   * of it. Zero on everything except a body whose flavour asks for one (FlavourDef.fixateSec);
   * today that is the siege's Heavies, marked with where the player stood when the ring closed.
   *
   * A POINT rather than a heading, unlike the charge above, because the two say different things:
   * a charge is "commit to a direction and cross the yard", a fixation is "converge on a place".
   * Fifty Heavies charging snapshot bearings would fan straight through the centre and out the
   * other side; fifty walking at one point form the knot and stay a knot.
   */
  readonly fixateX: Float32Array;
  readonly fixateY: Float32Array;
  readonly fixateLeft: Float32Array;
  readonly contactDamage: Float32Array;
  /** Per-enemy contact cooldown. Replaces global i-frames: one runt must not be able to
   *  soak the player's invulnerability window on behalf of a bruiser. */
  readonly contactTimer: Float32Array;
  readonly xpValue: Uint16Array;
  /** Index into the CURRENT LEVEL's creature table - also selects the sprite. */
  readonly typeId: Uint8Array;
  /**
   * WHICH RUNG OF THE LADDER SPAWNED THIS ONE, clamped to the authored table.
   *
   * Not derivable from anything else the pool holds, and needed at the moment of DEATH rather than
   * of spawn: `typeId` does not identify a cycle (the Scrapyard's Hauler and Warden are the same
   * hull) and nothing despawns, so a cycle-2 body is routinely killed in cycle 5. Without this
   * column "which creature did I put down" is unanswerable, and that is what the Scrapopedia's
   * bestiary is gated on.
   *
   * Clamped rather than raw: past the authored ladder every cycle is an extrapolation of the last
   * rung, which is the same creature, so it counts as that rung.
   */
  readonly cycleIndex: Uint8Array;
  /** Index into FLAVOURS. */
  readonly flavourId: Uint8Array;
  readonly archetype: Uint8Array;
  readonly flags: Uint8Array;
  /**
   * Monotonic spawn counter. THIS - not the slot - is the "entity id" in the Cannon's final
   * tie-break, so targeting never depends on free-list recycling order. It also reads as
   * "the one that has been alive longest", which is a semantics a test can be written against.
   */
  readonly spawnId: Uint32Array;
  /** dense -> slot */
  readonly slot: Uint32Array;

  // ---- slot-indexed bookkeeping ----
  readonly denseOf: Int32Array; // -1 when free
  readonly generation: Uint16Array; // starts at 1, advanced on free, never 0

  // ---- free list (LIFO - deterministic reuse order) ----
  readonly freeSlots: Uint16Array;
  freeCount: number;

  // ---- deferred removal ----
  readonly killQueue: Uint16Array;
  killCount: number;
}

export function createEnemyPool(capacity: number): EnemyPool {
  const L = new PoolLayout();
  const oX = L.f32(capacity);
  const oY = L.f32(capacity);
  const oPrevX = L.f32(capacity);
  const oPrevY = L.f32(capacity);
  const oVx = L.f32(capacity);
  const oVy = L.f32(capacity);
  const oPushX = L.f32(capacity);
  const oPushY = L.f32(capacity);
  const oHp = L.f32(capacity);
  const oMaxHp = L.f32(capacity);
  const oRadius = L.f32(capacity);
  const oSpeed = L.f32(capacity);
  const oMass = L.f32(capacity);
  const oKnockbackTake = L.f32(capacity);
  const oChargeX = L.f32(capacity);
  const oChargeY = L.f32(capacity);
  const oChargeLeft = L.f32(capacity);
  const oFixateX = L.f32(capacity);
  const oFixateY = L.f32(capacity);
  const oFixateLeft = L.f32(capacity);
  const oContactDamage = L.f32(capacity);
  const oContactTimer = L.f32(capacity);
  const oSpawnId = L.u32(capacity);
  const oSlot = L.u32(capacity);
  const oDenseOf = L.i32(capacity);
  const oXpValue = L.u16(capacity);
  const oGeneration = L.u16(capacity);
  const oFreeSlots = L.u16(capacity);
  const oKillQueue = L.u16(capacity);
  const oTypeId = L.u8(capacity);
  const oFlavourId = L.u8(capacity);
  const oArchetype = L.u8(capacity);
  const oFlags = L.u8(capacity);
  const oCycleIndex = L.u8(capacity);

  const buffer = new ArrayBuffer(L.byteLength);
  const f32 = (o: number): Float32Array => new Float32Array(buffer, o, capacity);
  const u32 = (o: number): Uint32Array => new Uint32Array(buffer, o, capacity);
  const u16 = (o: number): Uint16Array => new Uint16Array(buffer, o, capacity);
  const u8 = (o: number): Uint8Array => new Uint8Array(buffer, o, capacity);

  const denseViews: NumericArray[] = [];

  const p: EnemyPool = {
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
    pushX: f32(oPushX),
    pushY: f32(oPushY),
    hp: f32(oHp),
    maxHp: f32(oMaxHp),
    radius: f32(oRadius),
    speed: f32(oSpeed),
    mass: f32(oMass),
    knockbackTake: f32(oKnockbackTake),
    chargeX: f32(oChargeX),
    chargeY: f32(oChargeY),
    chargeLeft: f32(oChargeLeft),
    fixateX: f32(oFixateX),
    fixateY: f32(oFixateY),
    fixateLeft: f32(oFixateLeft),
    contactDamage: f32(oContactDamage),
    contactTimer: f32(oContactTimer),
    xpValue: u16(oXpValue),
    typeId: u8(oTypeId),
    flavourId: u8(oFlavourId),
    archetype: u8(oArchetype),
    flags: u8(oFlags),
    cycleIndex: u8(oCycleIndex),
    spawnId: u32(oSpawnId),
    slot: u32(oSlot),

    denseOf: new Int32Array(buffer, oDenseOf, capacity),
    generation: u16(oGeneration),

    freeSlots: u16(oFreeSlots),
    freeCount: capacity,

    killQueue: u16(oKillQueue),
    killCount: 0,
  };

  // Hashed in this exact order by hashWorld. prevX/prevY are deliberately excluded: they are a
  // pure copy of the previous tick's x/y, so hashing them would only double the cost.
  denseViews.push(
    p.x, p.y, p.vx, p.vy, p.pushX, p.pushY,
    p.hp, p.maxHp, p.radius, p.speed, p.mass, p.knockbackTake,
    p.chargeX, p.chargeY, p.chargeLeft,
    p.fixateX, p.fixateY, p.fixateLeft,
    p.contactDamage, p.contactTimer,
    p.xpValue, p.typeId, p.flavourId, p.archetype, p.flags, p.cycleIndex,
    p.spawnId, p.slot,
  );

  resetEnemyPool(p);
  return p;
}

/** Returns the pool to its just-created state. Allocation-free. */
export function resetEnemyPool(p: EnemyPool): void {
  p.count = 0;
  p.killCount = 0;
  p.freeCount = p.capacity;
  p.denseOf.fill(-1);
  p.generation.fill(1);
  // LIFO free list, filled so the FIRST allocation takes slot 0: pop order 0,1,2... makes the
  // early game's slot assignment readable in a debug dump.
  for (let i = 0; i < p.capacity; i++) p.freeSlots[i] = p.capacity - 1 - i;
}

/**
 * Allocates one enemy. Returns NULL_HANDLE when the pool is full - callers MUST check, because
 * silently overwriting a live entity is the worst class of bug in this design.
 *
 * Only the caller's own fields are set here; hp/maxHp/speed/etc. are the spawner's job, so
 * archetype x flavour x growth stays in one place (updateSpawning).
 */
export function allocEnemy(
  p: EnemyPool,
  typeId: number,
  flavourId: number,
  archetype: number,
  x: number,
  y: number,
  spawnId: number,
): EnemyHandle {
  if (p.freeCount === 0 || p.count >= p.capacity) return NULL_HANDLE as EnemyHandle;

  const s = p.freeSlots[--p.freeCount];
  const d = p.count++;
  p.denseOf[s] = d;
  p.slot[d] = s;

  p.x[d] = x;
  p.y[d] = y;
  // prev = cur so a fresh enemy does not streak in from wherever the previous occupant of this
  // dense index was standing.
  p.prevX[d] = x;
  p.prevY[d] = y;
  p.vx[d] = 0;
  p.vy[d] = 0;
  p.pushX[d] = 0;
  p.pushY[d] = 0;
  p.hp[d] = 1;
  p.maxHp[d] = 1;
  p.radius[d] = 1;
  p.speed[d] = 0;
  p.mass[d] = 1;
  p.knockbackTake[d] = 1;
  p.chargeX[d] = 0;
  p.chargeY[d] = 0;
  p.chargeLeft[d] = 0;
  p.fixateX[d] = 0;
  p.fixateY[d] = 0;
  p.fixateLeft[d] = 0;
  p.contactDamage[d] = 0;
  p.contactTimer[d] = 0;
  p.xpValue[d] = 0;
  p.typeId[d] = typeId;
  p.flavourId[d] = flavourId;
  p.archetype[d] = archetype;
  p.flags[d] = 0;
  // The spawner overwrites this with the real rung; 0 is only what an unattributed alloc gets.
  p.cycleIndex[d] = 0;
  p.spawnId[d] = spawnId;

  return packHandle(s, p.generation[s]) as EnemyHandle;
}

/**
 * Marks an enemy dead. Systems NEVER destroy directly - they mark, and reapEnemies destroys.
 * Idempotent: two shells can land on the same enemy in the same tick.
 */
export function markEnemyDead(p: EnemyPool, d: number): void {
  if (d < 0 || d >= p.count) return;
  if ((p.flags[d] & ENEMY_FLAG_DEAD) !== 0) return;
  p.flags[d] |= ENEMY_FLAG_DEAD;
  if (p.killCount < p.capacity) p.killQueue[p.killCount++] = d;
}

/**
 * Compacts out every dead enemy. Runs exactly once per tick, at a fixed pipeline position
 * (S12), and is the ONLY code that removes from this pool.
 *
 * Iterating BACKWARDS is what makes this correct in one pass: when we swap the tail into hole
 * `d`, the tail has already been examined (its index is > d), so it is known alive.
 */
export function reapEnemies(p: EnemyPool): void {
  if (p.killCount === 0) return;

  for (let d = p.count - 1; d >= 0; d--) {
    if ((p.flags[d] & ENEMY_FLAG_DEAD) === 0) continue;

    const s = p.slot[d];
    const last = p.count - 1;
    if (d !== last) {
      p.x[d] = p.x[last];
      p.y[d] = p.y[last];
      p.prevX[d] = p.prevX[last];
      p.prevY[d] = p.prevY[last];
      p.vx[d] = p.vx[last];
      p.vy[d] = p.vy[last];
      p.pushX[d] = p.pushX[last];
      p.pushY[d] = p.pushY[last];
      p.hp[d] = p.hp[last];
      p.maxHp[d] = p.maxHp[last];
      p.radius[d] = p.radius[last];
      p.speed[d] = p.speed[last];
      p.mass[d] = p.mass[last];
      p.knockbackTake[d] = p.knockbackTake[last];
      p.chargeX[d] = p.chargeX[last];
      p.chargeY[d] = p.chargeY[last];
      p.chargeLeft[d] = p.chargeLeft[last];
      p.fixateX[d] = p.fixateX[last];
      p.fixateY[d] = p.fixateY[last];
      p.fixateLeft[d] = p.fixateLeft[last];
      p.contactDamage[d] = p.contactDamage[last];
      p.contactTimer[d] = p.contactTimer[last];
      p.xpValue[d] = p.xpValue[last];
      p.typeId[d] = p.typeId[last];
      p.flavourId[d] = p.flavourId[last];
      p.archetype[d] = p.archetype[last];
      p.flags[d] = p.flags[last];
      p.cycleIndex[d] = p.cycleIndex[last];
      p.spawnId[d] = p.spawnId[last];
      const movedSlot = p.slot[last];
      p.slot[d] = movedSlot;
      p.denseOf[movedSlot] = d;
    }
    p.count = last;

    // Free the slot LAST: bumping the generation is what invalidates every handle still
    // pointing here, including a shell already in flight.
    p.denseOf[s] = -1;
    p.generation[s] = nextGeneration(p.generation[s]);
    p.freeSlots[p.freeCount++] = s;
  }

  p.killCount = 0;
}

export function isEnemyAlive(p: EnemyPool, h: EnemyHandle): boolean {
  return enemyIndex(p, h) >= 0;
}

/**
 * Handle -> dense index, or -1 if the handle is stale/null/dead.
 * The ONLY sanctioned way to dereference a handle.
 */
export function enemyIndex(p: EnemyPool, h: EnemyHandle): number {
  if (h === NULL_HANDLE) return -1;
  const s = handleSlot(h);
  if (s >= p.capacity) return -1;
  if (p.generation[s] !== handleGen(h)) return -1;
  const d = p.denseOf[s];
  if (d < 0) return -1;
  if ((p.flags[d] & ENEMY_FLAG_DEAD) !== 0) return -1;
  return d;
}

/** Handle for a live dense index. Useful when a system needs to remember a target across ticks. */
export function enemyHandleAt(p: EnemyPool, d: number): EnemyHandle {
  if (d < 0 || d >= p.count) return NULL_HANDLE as EnemyHandle;
  const s = p.slot[d];
  return packHandle(s, p.generation[s]) as EnemyHandle;
}
