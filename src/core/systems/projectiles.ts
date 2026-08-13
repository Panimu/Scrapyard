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

import { EV_PROJECTILE_EXPIRED, NO_DIRECT_HIT, pushEvent, pushHit } from '../events/ring.js';
import { PROJECTILE_FLAG_DEAD, markProjectileDead } from '../entity/projectilePool.js';
import {
  BEHAVIOUR_HOMING,
  BEHAVIOUR_STRAIGHT,
  type ProjectileBehaviour,
  type WeaponDef,
} from '../content/weaponCatalog.js';
import { queryCircleLiveInto } from '../spatial/hashGrid.js';
import type { World } from '../types.js';

/**
 * How far a missile looks for something to steer toward.
 *
 * Deliberately finite and fairly short. An infinite seek would make "weak homing" meaningless -
 * every missile would eventually curve onto SOMETHING, and the spread pattern would stop mattering
 * because the fan would collapse toward whatever was nearest the player. A short leash keeps the
 * volley's shape: a missile commits to the neighbourhood it was fired into.
 */
const HOMING_SEEK_RADIUS = 240;

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
 * `homing` - the missile racks. Steers weakly toward whatever enemy is nearest to THE MISSILE, and
 * detonates when its fuse runs out.
 *
 * NEAREST TO ITSELF, RE-EVALUATED EVERY TICK, AND NEVER STORED. This is what the file header
 * predicted: homing needs no target handle, so the "target died mid-flight and the shell chased a
 * recycled entity" bug remains structurally impossible. A missile whose quarry dies simply picks
 * the next nearest thing on the following tick, which also happens to be exactly the behaviour a
 * player expects from a swarm of missiles crossing a crowded field.
 *
 * The turn is a ROTATION AT A CAPPED RATE, not a steering force: velocity keeps its magnitude and
 * only its direction moves, by at most `turnRate * dt` per tick. Missiles therefore never
 * accelerate, never stall, and never spiral - a missile that cannot out-turn its quarry sails past
 * and detonates on its fuse, which is precisely what "weak homing" should feel like.
 */
export const behaviourHoming: ProjectileBehaviour = (world, behaviourId, dt): void => {
  const p = world.projectiles;
  const n = p.count;
  const enemies = world.enemies;
  const candidates = world.scratch.candidates;

  for (let d = 0; d < n; d++) {
    if (p.behaviour[d] !== behaviourId) continue;
    if ((p.flags[d] & PROJECTILE_FLAG_DEAD) !== 0) continue;

    const px = p.x[d];
    const py = p.y[d];

    // Turn rate belongs to the weapon that fired this missile, read through ownerWeapon rather
    // than copied onto every projectile: a rack upgraded mid-flight steers its airborne missiles
    // better immediately, and the pool stays one byte lighter per shell.
    const inst = world.weapons[p.ownerWeapon[d]];
    const turnRate = inst === undefined ? 0 : inst.stats.turnRate;

    if (turnRate > 0) {
      const m = queryCircleLiveInto(world.spatial, enemies, px, py, HOMING_SEEK_RADIUS, candidates);
      let bestD = -1;
      let bestDist2 = Infinity;
      let bestSpawn = 0xffffffff;
      for (let i = 0; i < m; i++) {
        const e = candidates[i];
        const ex = enemies.x[e] - px;
        const ey = enemies.y[e] - py;
        const dist2 = ex * ex + ey * ey;
        // Strict total order: nearest, then lowest spawnId. Without the tie-break two missiles at
        // identical distance could resolve differently on different engines.
        const sid = enemies.spawnId[e];
        if (dist2 < bestDist2 || (dist2 === bestDist2 && sid < bestSpawn)) {
          bestDist2 = dist2;
          bestSpawn = sid;
          bestD = e;
        }
      }

      if (bestD >= 0) {
        const vx = p.vx[d];
        const vy = p.vy[d];
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed > 0) {
          const tx = enemies.x[bestD] - px;
          const ty = enemies.y[bestD] - py;
          const tlen = Math.sqrt(tx * tx + ty * ty);
          if (tlen > 0) {
            const dx = tx / tlen;
            const dy = ty / tlen;
            const cx = vx / speed;
            const cy = vy / speed;
            // Signed angle from current heading to the desired one, clamped to this tick's budget.
            const cross = cx * dy - cy * dx;
            const dot = cx * dx + cy * dy;
            let ang = Math.atan2(cross, dot);
            const maxStep = turnRate * dt;
            if (ang > maxStep) ang = maxStep;
            else if (ang < -maxStep) ang = -maxStep;
            const c = Math.cos(ang);
            const sn = Math.sin(ang);
            p.vx[d] = (cx * c - cy * sn) * speed;
            p.vy[d] = (cx * sn + cy * c) * speed;
          }
        }
      }
    }

    const mx = p.vx[d] * dt;
    const my = p.vy[d] * dt;
    p.x[d] += mx;
    p.y[d] += my;
    p.travelled[d] += Math.sqrt(mx * mx + my * my);

    const left = p.lifeSec[d] - dt;
    p.lifeSec[d] = left;
    if (left <= 0) {
      markProjectileDead(p, d);
      // FUSE DETONATION. A missile that ran out of flight time explodes where it is, for splash
      // only - there is no body to take a direct hit. It goes through the HitBuffer rather than
      // touching enemies here, so every point of damage in the game is still applied by S9 and
      // the detection/application split holds.
      const def = world.weaponCatalog[world.weapons[p.ownerWeapon[d]]?.defId ?? -1] as
        | WeaponDef
        | undefined;
      if (def?.detonateOnExpiry === true && p.splashRadius[d] > 0) {
        pushHit(world.hits, d, NO_DIRECT_HIT, p.x[d], p.y[d]);
      }
      pushEvent(world.events, EV_PROJECTILE_EXPIRED, world.tick, p.x[d], p.y[d], 0, d);
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
  behaviourHoming, // BEHAVIOUR_HOMING === 1
]);

export function updateProjectiles(world: World, dt: number): void {
  if (world.projectiles.count === 0) return;
  for (let b = 0; b < PROJECTILE_BEHAVIOURS.length; b++) {
    PROJECTILE_BEHAVIOURS[b](world, b, dt);
  }
}

/** Guard: the table index and the id constant must agree, forever. Asserted by the unit tests. */
export const BEHAVIOUR_TABLE_STRAIGHT_INDEX = BEHAVIOUR_STRAIGHT;
