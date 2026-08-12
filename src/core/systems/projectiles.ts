/**
 * S7 - updateProjectiles. Motion and lifetime only.
 *
 * This system deliberately does NOT detect or apply anything: S8 (updateCollision) writes the
 * HitBuffer and S9 (updateDamage) applies it. Keeping integration separate is what lets a shell's
 * flight be unit-tested with no enemies in the world at all.
 *
 * SHELLS CARRY NO TARGET REFERENCE. There is no target handle, dense index or spawnId anywhere in
 * ProjectilePool - once fired, a shell is a position and a velocity. So the classic bug of this
 * genre ("the target died mid-flight and the shell followed a recycled entity") is not a case
 * that can be handled wrongly here; it is structurally absent. Homing, when a later weapon wants
 * it, is a new BehaviourId reading a per-weapon data flag - it does not put a handle on every
 * shell that will never use one.
 *
 * ONE LOOP PER BEHAVIOUR, NOT ONE CALL PER PROJECTILE (DESIGN.md §5.3). A function-pointer call
 * per projectile per tick is a megamorphic call site ~200x per tick; here updateProjectiles calls
 * each behaviour exactly once and the behaviour filters on its own id byte. That is ~1 000
 * perfectly-predicted branches per tick - free - and every inner loop stays monomorphic over
 * contiguous typed arrays.
 *
 * NOTE FOR S8: a shell that expires here is flagged DEAD in this stage, before collision runs.
 * updateCollision must skip PROJECTILE_FLAG_DEAD (deferred reaping means it is still in the pool
 * until S12).
 */

import { EV_PROJECTILE_EXPIRED, pushEvent } from '../events/ring.js';
import { PROJECTILE_FLAG_DEAD, markProjectileDead } from '../entity/projectilePool.js';
import { BEHAVIOUR_STRAIGHT, type ProjectileBehaviour } from '../content/weaponCatalog.js';
import type { World } from '../types.js';

/**
 * `straight` - constant velocity, no steering, no drag, no gravity.
 *
 * The Cannon's whole feel lives in the numbers rather than the curve: 520 u/s is 8.67 u per tick,
 * so a max-range shell is visibly in flight for 30 frames and an enemy can walk out from under
 * it. That is the honest source of "weight" - hitstop would be a lie (it pauses the renderer but
 * not the sim), so travel time, knockback and camera kick carry it instead.
 *
 * 8.67 u/tick is comfortably under the smallest enemy radius (13 u), so point-in-circle collision
 * cannot tunnel and no swept test is needed (DESIGN.md §7.3).
 */
export const behaviourStraight: ProjectileBehaviour = (world, behaviourId, dt): void => {
  const p = world.projectiles;
  const n = p.count;
  const behaviour = p.behaviour;
  const flags = p.flags;
  const x = p.x;
  const y = p.y;
  const vx = p.vx;
  const vy = p.vy;
  const lifeSec = p.lifeSec;
  const travelled = p.travelled;

  for (let d = 0; d < n; d++) {
    if (behaviour[d] !== behaviourId) continue;
    if ((flags[d] & PROJECTILE_FLAG_DEAD) !== 0) continue;

    const dx = vx[d] * dt;
    const dy = vy[d] * dt;
    x[d] += dx;
    y[d] += dy;
    // Accumulated rather than derived from a spawn position: LONGBOW's Spotter trait scales
    // damage by distance FLOWN, which a later curving behaviour would make different from
    // distance from origin. One sqrt per shell per tick at <= 256 shells is nothing.
    travelled[d] += Math.sqrt(dx * dx + dy * dy);

    const left = lifeSec[d] - dt;
    lifeSec[d] = left;
    if (left <= 0) {
      markProjectileDead(p, d);
      pushEvent(world.events, EV_PROJECTILE_EXPIRED, world.tick, x[d], y[d], 0, d);
    }
  }
};

/**
 * THE BEHAVIOUR TABLE. Index === the value stored in ProjectilePool.behaviour === the BEHAVIOUR_*
 * constant in weaponCatalog.ts. Those indices are written into every replay hash, so this array
 * is APPEND ONLY - reordering it silently reinterprets every recorded run.
 */
export const PROJECTILE_BEHAVIOURS: readonly ProjectileBehaviour[] = Object.freeze([
  behaviourStraight, // BEHAVIOUR_STRAIGHT === 0
]);

export function updateProjectiles(world: World, dt: number): void {
  if (world.projectiles.count === 0) return;
  for (let b = 0; b < PROJECTILE_BEHAVIOURS.length; b++) {
    PROJECTILE_BEHAVIOURS[b](world, b, dt);
  }
}

/** Guard: the table index and the id constant must agree, forever. Asserted by the unit tests. */
export const BEHAVIOUR_TABLE_STRAIGHT_INDEX = BEHAVIOUR_STRAIGHT;
