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

import { sceneryOverlap } from '../content/scenery.js';
import { EV_PROJECTILE_EXPIRED, NO_DIRECT_HIT, pushEvent, pushHit } from '../events/ring.js';
import {
  allocProjectile,
  PROJECTILE_FLAG_DEAD,
  PROJECTILE_FLAG_SPLITS,
  markProjectileDead,
} from '../entity/projectilePool.js';
import { MISSILE_SHORT, SPLIT_COS, SPLIT_SIN } from '../content/weaponCatalog.js';
import { NULL_HANDLE } from '../entity/handle.js';
import {
  BEHAVIOUR_HOMING,
  BEHAVIOUR_STRAIGHT,
  type ProjectileBehaviour,
  type WeaponDef,
} from '../content/weaponCatalog.js';
import { breakBarrelIn } from './pickups.js';
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
 * Ends a projectile whose fuse has run out, detonating it if its weapon says so.
 *
 * SHARED BY EVERY BEHAVIOUR ON PURPOSE. Fuse detonation was first written inside `homing`, which
 * silently meant the artillery - a `straight` projectile with `detonateOnExpiry` - landed three
 * shells a volley and dealt exactly zero damage. The behaviour a projectile flies with and whether
 * it explodes at the end are independent properties, so the code that ends a life belongs in one
 * place that all of them call.
 */
/**
 * THE GTM HORNET'S SPLIT. One warhead becomes two short-rack missiles, `15 deg` apart.
 *
 * WHY THIS IS A FUSE AND NOT A TIMER: the shell already carries a countdown, and "a second after
 * launch, unless it hit something first" is exactly what a fuse means. `fireSpread` cuts the
 * Hornet's fuse to SPLIT_SEC and flags the shell; everything else follows from the fuse running
 * out, including the "if not detonated" half - a shell that struck something was reaped long
 * before it got here.
 *
 * THE CHILDREN CANNOT SPLIT AGAIN. They are spawned without the flag, which is the whole reason
 * the flag lives on the shell rather than being derived from the owning weapon: they are fired by
 * the Hornet, at tier 8, and anything read through the owner would be true of them too. One volley
 * would become a chain reaction and then the pool ceiling.
 *
 * THE NUMBERS ARE THE SHORT RACK'S AT TIER SEVEN, off `World.splitStats` - the rack itself has
 * been eaten by the time any of this runs, so there is no instance to read. They stay credited to
 * the Hornet through `ownerWeapon`, because the Hornet is what fired them.
 *
 * `Math.cos`/`Math.sin` are banned in core, so the half-angle arrives precomputed as its two
 * components - see SPLIT_COS.
 */
function splitProjectile(world: World, d: number): void {
  const p = world.projectiles;
  const st = world.splitStats;
  const vx = p.vx[d];
  const vy = p.vy[d];
  const len = Math.sqrt(vx * vx + vy * vy);
  // A shell with no velocity has no heading to fan about. Unreachable - a missile is spawned at
  // speed and never decelerates - but the alternative is dividing by zero into a NaN heading that
  // would spread silently through the replay hash.
  if (len <= 0) return;
  const ux = vx / len;
  const uy = vy / len;
  const x = p.x[d];
  const y = p.y[d];
  const owner = p.ownerWeapon[d];

  for (let k = 0; k < 2; k++) {
    // -7.5 deg then +7.5, so the pair straddles the parent's heading rather than veering off it.
    const sn = k === 0 ? -SPLIT_SIN : SPLIT_SIN;
    const dirX = ux * SPLIT_COS - uy * sn;
    const dirY = ux * sn + uy * SPLIT_COS;
    const handle = allocProjectile(
      p,
      x,
      y,
      dirX * st.projectileSpeed,
      dirY * st.projectileSpeed,
      st.projectileLifetime,
      owner,
      BEHAVIOUR_HOMING,
      ++world.stats.shotsFired,
    );
    if (handle === NULL_HANDLE) return;

    const c = p.count - 1;
    p.damage[c] = st.damage;
    p.knockback[c] = st.knockback;
    p.splashRadius[c] = st.splashRadius;
    p.splashFrac[c] = st.splashFrac;
    p.radius[c] = MISSILE_SHORT.shellRadius;
    p.pierceLeft[c] = st.pierce;
    p.visualId[c] = MISSILE_SHORT.visualId;
  }
}

function expireProjectile(world: World, d: number): void {
  const p = world.projectiles;
  const splits = (p.flags[d] & PROJECTILE_FLAG_SPLITS) !== 0;
  markProjectileDead(p, d);

  // BEFORE the detonation below and INSTEAD of it. A Hornet warhead that comes apart has not gone
  // off - it has become two missiles, and the damage is theirs to deal. Splitting AND detonating
  // would pay the volley twice for the same warhead.
  if (splits) {
    splitProjectile(world, d);
    pushEvent(world.events, EV_PROJECTILE_EXPIRED, world.tick, p.x[d], p.y[d], 0, d);
    return;
  }

  const inst = world.weapons[p.ownerWeapon[d]];
  const def =
    inst === undefined ? undefined : (world.weaponCatalog[inst.defId] as WeaponDef | undefined);
  if (def?.detonateOnExpiry === true && p.splashRadius[d] > 0) {
    // Splash only - there is no struck body. updateDamage applies it, so S7 never touches hp.
    pushHit(world.hits, d, NO_DIRECT_HIT, p.x[d], p.y[d]);
  }
  pushEvent(world.events, EV_PROJECTILE_EXPIRED, world.tick, p.x[d], p.y[d], 0, d);
}

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
    if (left <= 0) expireProjectile(world, d);
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
    if (left <= 0) expireProjectile(world, d);
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
  stopAtTheEdges(world);
}

/**
 * WHERE THE WORLD STOPS A ROUND: the perimeter fence, and the scrap piles standing in the yard.
 *
 * One sweep after every behaviour rather than a bound test inside each. The rule is about the
 * WORLD, not about how a given round flies - a straight shell and a homing missile should both
 * stop at the same wire and bury themselves in the same wreck - and a third behaviour added later
 * inherits it for free.
 *
 * THE FENCE AND THE SCRAP END A ROUND DIFFERENTLY, and the difference is the design:
 *
 *   THE FENCE expires it, so a shell with `detonateOnExpiry` bursts against the wire and the
 *     barrier reads as something that was hit.
 *   SCRAP ABSORBS IT, doing no damage to anything. A pile is cover, and cover that set off a
 *     tier-7 barrage's splash would be the opposite of cover - the player would be shelling
 *     themselves every time they used it. So the round dies where it struck, the renderer plays
 *     the same fizzle it plays for any expiry, and nothing is charged for it.
 *
 * A round is only ever one tick's travel past the line (at most 15 u for the fastest slug), so it
 * always dies visibly ON the thing it hit.
 */
function stopAtTheEdges(world: World): void {
  const p = world.projectiles;
  const n = p.count;
  const x = p.x;
  const y = p.y;
  const flags = p.flags;
  const scenery = world.scenery;
  // On an unbounded level this is Infinity, so nothing is ever culled by the edge. Rounds still
  // die on their own `projectileLifetime`, which is what actually bounds a shot's travel - the
  // wall was only ever the second, coarser of the two.
  const edge = world.arenaHalf;

  for (let d = 0; d < n; d++) {
    if ((flags[d] & PROJECTILE_FLAG_DEAD) !== 0) continue;

    if (
      x[d] < -edge ||
      x[d] > edge ||
      y[d] < -edge ||
      y[d] > edge
    ) {
      expireProjectile(world, d);
      continue;
    }

    // Radius 0: a round is a point against scenery, as it already is against enemies.
    if (sceneryOverlap(scenery, x[d], y[d], 0) >= 0) {
      // A FUEL BARREL goes up rather than swallowing the round quietly. The projectile still dies
      // here either way - a drum stops a shell whether or not it was the breakable kind.
      breakBarrelIn(world, x[d], y[d], 0, p.damage[d]);
      markProjectileDead(p, d);
      pushEvent(world.events, EV_PROJECTILE_EXPIRED, world.tick, x[d], y[d], 0, d);
    }
  }
}

/** Guard: the table index and the id constant must agree, forever. Asserted by the unit tests. */
export const BEHAVIOUR_TABLE_STRAIGHT_INDEX = BEHAVIOUR_STRAIGHT;
