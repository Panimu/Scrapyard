/**
 * PUDDLES - Toxic Sludge's ground, and the first thing in this game that damages by STANDING ON IT.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS A POOL AND NOT A PROJECTILE THAT FORGOT TO DIE
 * ---------------------------------------------------------------------------------------------
 * The obvious cheat was a projectile with no velocity and a long life. It does not survive contact
 * with `ProjectilePool`: a projectile bills ONE body once and is spent, moves every tick, carries
 * pierce, knockback and splash it would never use, and is reaped by a collision system whose whole
 * contract is "the first thing I touch ends me". A puddle is the opposite of every one of those -
 * it never moves, it bills EVERY body standing in it, every tick, for as long as it lasts, and
 * nothing it damages removes it.
 *
 * So it is its own pool, and deliberately the second-smallest in the game: no handles, no spatial
 * hash of its own, no collision response. Nothing outside this pool holds a reference to a puddle
 * across a tick.
 *
 * ---------------------------------------------------------------------------------------------
 * NO prevX/prevY, AND THAT IS THE ONE DEPARTURE FROM EVERY OTHER POOL HERE
 * ---------------------------------------------------------------------------------------------
 * Every other pool carries them because the renderer interpolates and the pools swap-remove, so a
 * renderer-side cache keyed by dense index draws one entity from another's last position
 * (CLAUDE.md). A puddle is at the same place on both ticks, forever, so there is nothing to
 * interpolate and a `prev` pair would be two arrays of duplicated numbers - and, worse, two more
 * fields in the hash format saying the same thing twice.
 *
 * WHAT IT DOES CARRY, and why each one has to be per-puddle rather than read off the weapon:
 *   `radius` and `dps` are captured AT THE MOMENT IT LANDS, so a rack that levels up - or a
 *   chassis bonus that is recomputed - does not retroactively resize sludge already on the floor.
 *   `by` credits the kill, exactly as `EnemyPool.burnBy` does, so a body that falls over in a
 *   puddle nobody is aiming still counts for the gun that put it there.
 */

/**
 * Hard ceiling. Toxic Sludge throws a small spread per shot off a shallow magazine and each pool
 * lives a few seconds, so a couple of dozen is already the worst case with the reload discounted;
 * this is ample room for a tier ladder that widens both, and small enough that the whole pool is a
 * cache line or two per field.
 */
export const PUDDLE_CAP = 64;

export interface PuddlePool {
  readonly capacity: number;
  count: number;

  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Radius on the ground. Captured when it lands - see the header. */
  readonly radius: Float32Array;
  /** Damage per second to anything standing in it, as it was when it landed. */
  readonly dps: Float32Array;
  /** Seconds left before it dries up. */
  readonly left: Float32Array;
  /** Total seconds it started with, so the renderer can fade it without a second field. */
  readonly life: Float32Array;
  /** The weapon SLOT that threw it, for crediting the kill. 255 is nobody. */
  readonly by: Uint8Array;
}

export function createPuddlePool(capacity = PUDDLE_CAP): PuddlePool {
  return {
    capacity,
    count: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    radius: new Float32Array(capacity),
    dps: new Float32Array(capacity),
    left: new Float32Array(capacity),
    life: new Float32Array(capacity),
    by: new Uint8Array(capacity),
  };
}

/**
 * Returns the new puddle's dense index, or -1 if the pool is full.
 *
 * FULL MEANS DROPPED, SILENTLY, and that is the right failure. The alternative - evicting the
 * oldest - would let a burst of fire delete ground the player is currently relying on, and at the
 * cap this pool is set to, a run has to be doing something extraordinary to reach it at all.
 */
export function allocPuddle(
  p: PuddlePool,
  x: number,
  y: number,
  radius: number,
  dps: number,
  seconds: number,
  by: number,
): number {
  if (p.count >= p.capacity) return -1;
  const d = p.count++;
  p.x[d] = x;
  p.y[d] = y;
  p.radius[d] = radius;
  p.dps[d] = dps;
  p.left[d] = seconds;
  p.life[d] = seconds;
  p.by[d] = by;
  return d;
}

/**
 * SWAP-REMOVE. The caller must iterate DOWNWARD when removing inside a loop, or the entry swapped
 * into `d` is skipped - the same contract every other pool here has.
 */
export function freePuddle(p: PuddlePool, d: number): void {
  const last = --p.count;
  if (d !== last) {
    p.x[d] = p.x[last];
    p.y[d] = p.y[last];
    p.radius[d] = p.radius[last];
    p.dps[d] = p.dps[last];
    p.left[d] = p.left[last];
    p.life[d] = p.life[last];
    p.by[d] = p.by[last];
  }
}

export function resetPuddlePool(p: PuddlePool): void {
  p.count = 0;
}
