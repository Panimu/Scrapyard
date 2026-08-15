/**
 * DRONES - the first thing in this game that is neither a shell nor a beam.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY A POOL AND NOT A PROJECTILE
 * ---------------------------------------------------------------------------------------------
 * Everything else a weapon produces is fire-and-forget: a shell is spawned with a velocity and is
 * never steered again, and a beam does not exist between ticks at all. A drone PERSISTS - it has a
 * destination it re-decides every tick, a magazine that empties over half a minute, and a death
 * that damages things. None of that fits ProjectilePool, and bolting it on would put four dead
 * fields on all 256 shells to serve at most four drones.
 *
 * ---------------------------------------------------------------------------------------------
 * NO HANDLES, DELIBERATELY
 * ---------------------------------------------------------------------------------------------
 * The other pools carry a slot/handle indirection so something can hold a stable reference across
 * ticks. Nothing outside this pool ever refers to a drone: the weapon system counts them, the
 * renderer draws all of them, and a drone's own target is an enemy DENSE index re-resolved every
 * tick. So this is a plain dense array with swap-remove, which is the simplest thing that works.
 *
 * `prevX/prevY` live in the pool rather than in a renderer-side cache for exactly the reason
 * CLAUDE.md gives: a cache keyed by dense index would, after one swap-remove, interpolate one
 * drone from another's last position.
 */

/** Circling the player, waiting for something to shoot - which includes flying home. */
export const DRONE_STATE_ESCORT = 0;
/** Circling an enemy and shooting it. */
export const DRONE_STATE_ENGAGE = 1;

/**
 * Hard ceiling on drones in the world. Four per weapon at tier 7 and one drone weapon, so this is
 * double what the game can currently reach - room for a second source without a resize, and small
 * enough that the whole pool is one cache line per field.
 */
export const DRONE_CAP = 8;

export interface DronePool {
  readonly capacity: number;
  count: number;

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  /** Orbit phase, radians. Advanced every tick; the drone's position is derived from it. */
  readonly angle: Float32Array;
  /** DRONE_STATE_*. */
  readonly state: Uint8Array;
  /** Enemy DENSE index being circled, or -1. Re-resolved every tick - never trusted across one. */
  readonly targetDense: Int32Array;
  /** Rounds left. At zero the drone explodes. */
  readonly ammo: Int32Array;
  /** Seconds until this drone may fire again. */
  readonly cooldownLeft: Float32Array;
  /** Loadout slot of the weapon that built it, so its shells are credited to the right gun. */
  readonly weaponSlot: Uint8Array;
  /** Which way round the orbit it flies: +1 or -1. Alternates, so drones do not stack up. */
  readonly spin: Int8Array;
}

export function createDronePool(capacity = DRONE_CAP): DronePool {
  return {
    capacity,
    count: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    prevX: new Float32Array(capacity),
    prevY: new Float32Array(capacity),
    angle: new Float32Array(capacity),
    state: new Uint8Array(capacity),
    targetDense: new Int32Array(capacity),
    ammo: new Int32Array(capacity),
    cooldownLeft: new Float32Array(capacity),
    weaponSlot: new Uint8Array(capacity),
    spin: new Int8Array(capacity),
  };
}

/** Returns the new drone's dense index, or -1 if the pool is full. */
export function allocDrone(
  p: DronePool,
  x: number,
  y: number,
  angle: number,
  ammo: number,
  weaponSlot: number,
  spin: number,
): number {
  if (p.count >= p.capacity) return -1;
  const d = p.count++;
  p.x[d] = x;
  p.y[d] = y;
  // prev = current on the first tick, so a drone appears where it is rather than streaking in
  // from wherever the previous occupant of this slot died.
  p.prevX[d] = x;
  p.prevY[d] = y;
  p.angle[d] = angle;
  p.state[d] = DRONE_STATE_ESCORT;
  p.targetDense[d] = -1;
  p.ammo[d] = ammo;
  p.cooldownLeft[d] = 0;
  p.weaponSlot[d] = weaponSlot;
  p.spin[d] = spin;
  return d;
}

/**
 * SWAP-REMOVE. The caller must iterate DOWNWARD when removing inside a loop, or the entry swapped
 * into `d` is skipped - the same contract every other pool here has.
 */
export function freeDrone(p: DronePool, d: number): void {
  const last = --p.count;
  if (d !== last) {
    p.x[d] = p.x[last];
    p.y[d] = p.y[last];
    p.prevX[d] = p.prevX[last];
    p.prevY[d] = p.prevY[last];
    p.angle[d] = p.angle[last];
    p.state[d] = p.state[last];
    p.targetDense[d] = p.targetDense[last];
    p.ammo[d] = p.ammo[last];
    p.cooldownLeft[d] = p.cooldownLeft[last];
    p.weaponSlot[d] = p.weaponSlot[last];
    p.spin[d] = p.spin[last];
  }
}
