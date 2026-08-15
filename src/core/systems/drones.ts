/**
 * S6b - updateDrones. The only system that moves something the player does not control and the
 * horde does not own.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT A DRONE DOES, IN ONE PARAGRAPH
 * ---------------------------------------------------------------------------------------------
 * It flies a circle. Around the PLAYER while there is nothing to shoot, and around an ENEMY once
 * something comes inside twice its gun's reach - and while it is circling that enemy it empties a
 * Machine Gun into it. When the enemy dies it goes back to circling the player, re-checking for a
 * new target the whole way home, so "returning" is not a state: it is escorting from further away.
 * When its magazine runs dry it explodes.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO STATES, NOT THREE
 * ---------------------------------------------------------------------------------------------
 * ESCORT and ENGAGE, and the difference between them is only WHICH POINT the drone is circling.
 * A separate RETURN state was the obvious third one and it would have been a mistake: a drone on
 * its way home that ignored a target until it arrived would look broken, and the moment you let it
 * re-acquire in transit, RETURN and ESCORT are the same behaviour written twice.
 *
 * ---------------------------------------------------------------------------------------------
 * IT ORBITS BY PHASE, NOT BY STEERING
 * ---------------------------------------------------------------------------------------------
 * The drone owns an ANGLE, advanced by a fixed rate every tick, and its position is that angle on
 * a circle around whatever it is following - then eased toward from where it actually is, so a
 * change of centre reads as flying across rather than teleporting. Steering forces would need a
 * velocity, a damping term and an arrival test to stop them slingshotting; a phase needs none of
 * that and cannot become unstable.
 *
 * `dcos`/`dsin` and not Math's, because core has to reproduce bit-identically off a phone.
 *
 * ---------------------------------------------------------------------------------------------
 * WHERE IT SITS IN THE PIPELINE
 * ---------------------------------------------------------------------------------------------
 * After S6 (weapons) and before S7 (projectiles), because a drone allocates projectiles and the
 * pipeline's contract is that every shell in flight was allocated before S7 integrates it. It
 * reads the spatial hash rebuilt at S5, so its target queries are exact.
 */

import { TARGETING } from './targeting.js';
import { DRONE_ACQUIRE_MUL } from '../content/weaponCatalog.js';
import { MACHINE_GUN } from '../content/weaponCatalog.js';
import { resolveWeaponStats, type WeaponStats } from '../data/stats.js';
import {
  DRONE_STATE_ENGAGE,
  DRONE_STATE_ESCORT,
  allocDrone,
  freeDrone,
} from '../entity/dronePool.js';
import { NULL_HANDLE } from '../entity/handle.js';
import {
  PROJECTILE_FLAG_NOCONTACT,
  allocProjectile,
} from '../entity/projectilePool.js';
import { ENEMY_FLAG_DEAD } from '../entity/enemyPool.js';
import { EV_WEAPON_FIRED, pushEvent } from '../events/ring.js';
import { TWO_PI, dcos, dsin } from '../math/trig.js';
import type { World } from '../types.js';

/** How far from the player a drone flies its holding pattern. Outside the mech, inside the crowd. */
const ESCORT_RADIUS = 62;
/**
 * How far from an ENEMY a drone flies while shooting it.
 *
 * A fraction of the gun's reach rather than the whole of it, so an enemy that steps away is still
 * inside the drone's range while the drone catches up - a ring at exactly max range would have the
 * drone flickering in and out of being able to shoot.
 */
const ENGAGE_RADIUS_FRAC = 0.55;
/**
 * Radians per second around the circle, and how fast the drone closes on where that circle says it
 * should be. QUARTERED from the numbers this shipped with (2.1 / 4.2), in two halvings: a drone
 * crossed the screen faster than the mech could and the orbit was a blur rather than a circle you
 * could watch.
 *
 * They are scaled TOGETHER on purpose. One is tangential speed and the other is transit speed, so
 * moving only one changes the SHAPE of the flight - a slow orbit with a fast transit darts and
 * parks, a fast orbit with a slow transit spirals. Scaling both keeps the path and slows the film.
 *
 * WHAT FOLLOW_RATE COSTS, stated because it is not obvious from the number. The follow is an
 * exponential approach, so a player running flat out leaves the drone a steady `speed /
 * FOLLOW_RATE` behind - about 186 units at 1.05 against a 195 u/s mech, which is three escort
 * radii. Drones trail a sprinting player rather than staying on his shoulder. That is the price of
 * a readable orbit, and it is only paid while actually running.
 */
const ORBIT_RATE = 0.525;
const FOLLOW_RATE = 1.05;

/**
 * THE ACQUISITION CIRCLE IS DRAWN AROUND THE PLAYER, NOT AROUND THE DRONE. This is the single most
 * important line in this file and it was wrong on the first pass.
 *
 * A circle around the drone is TRANSITIVE, and transitive means unbounded: the drone engages
 * something at the edge of its own reach, flies out to it, and from out there something further
 * out is now within reach. Across a spread-out wave that chains, one target at a time, until the
 * drone is off the screen and out of the run - which is exactly what happened. Capping how far
 * the chain may reach does not fix it; it only decides how far off screen the drone ends up,
 * because each individual hop is still perfectly legal.
 *
 * So the drone does not have a hunting radius at all. YOU do. An enemy is a target if it is within
 * `gun.range * DRONE_ACQUIRE_MUL` OF THE PLAYER, whatever the drone's own position, and the drone
 * flies to it however far that is. The chain cannot walk anywhere, because every link is measured
 * from the same point.
 *
 * WHAT THIS BOUNDS. The arithmetic ceiling is the acquisition radius, plus the orbit around the
 * target, plus the follow lag - 310 + 85 + 186 at tier 5, so about 580 in the worst case that
 * never quite happens. MEASURED over three full six-minute runs the furthest a drone ever got was
 * 426 / 444 / 474 units, and it spent 0.00% of its life beyond the 501-unit worst-case screen
 * half-diagonal. It is past the narrow side edge of a portrait phone about a quarter of the time,
 * chasing something that is itself past that edge, and it comes back.
 *
 * The same three runs under the drone-anchored circle: 979 / 1052 / 1096 units, and a THIRD of
 * every drone-frame spent beyond the half-diagonal - off the screen in any orientation, at any
 * aspect ratio. That is the bug this replaced, and those two rows are why the anchor moved rather
 * than the number.
 *
 * IT ALSO COSTS NOTHING TO CHASE. A drone hanging back 186 units behind a sprinting player can
 * still engage something 260 units ahead of him - 446 units away from itself, three times its own
 * reach. Under the old drone-anchored circle that body was invisible to it, so a running player's
 * drones went inert. Anchoring to the player fixed that as a side effect.
 */

/**
 * WHAT A DRONE'S ROUND IS WORTH, against the Machine Gun's own.
 *
 * HALF, AND THE MAGAZINE IS NOW FULL - the two go together and replaced each other. A drone used to
 * carry half a magazine at full damage, which is the same total damage in half the time; it now
 * carries the whole magazine at half damage, which is the same total damage over twice as long.
 * The second shape is the better one for a thing whose magazine IS its life: a drone at 200 rounds
 * lives 19.9 seconds of sustained fire against a twelve second rebuild, so a flight is
 * something you maintain rather than something that keeps evaporating.
 *
 * 19.9 AND NOT 18, WHICH IS WHAT THE ARITHMETIC SAYS. 200 rounds at the gun's 0.09 s cooldown is
 * 18.0 s, but 0.09 does not divide into the 1/60 s tick: the cooldown is decremented once per tick
 * and fires when it reaches zero, so 5.4 ticks becomes 6 and the real cadence is 0.1 s. Every
 * magazine weapon in the game is quantised this way; the drone is only the one where it shows up
 * as a lifespan. Measured, not derived - a drone deployed beside a target it cannot kill dies at
 * tick 1195.
 *
 * Applied HERE rather than by lowering MACHINE_GUN's own numbers, which would nerf the actual
 * Machine Gun for every player holding one. The drone's gun IS the Machine Gun; what a drone does
 * with it is a property of the drone.
 *
 * It scales with the tier for free, because it multiplies the gun's already-tiered damage.
 */
const DRONE_DAMAGE_FRAC = 0.5;

/**
 * Scratch for the per-tick target query, which asks for the four bodies nearest THE PLAYER.
 *
 * FOUR, not one, and this is what keeps a flight of drones from stacking. The legal set is the
 * same for every drone - it is the player's circle - so a single candidate would send all four
 * drones to the same body and they would fly as one object. Four candidates, each drone taking
 * whichever of them is nearest to ITSELF, spreads them across the near end of the crowd without
 * any shared state between drones and without a random roll.
 */
const DRONE_TARGETS = new Int32Array(4);

/**
 * The drone's gun, resolved once per tick rather than per drone.
 *
 * IT IS THE MACHINE GUN AT THE DRONE WEAPON'S OWN TIER, which is the whole specification - so it
 * is resolved from MACHINE_GUN with the drone's level rather than copied into the drone's def. A
 * chassis bonus to the Machine Gun therefore reaches the drones too, which is a real interaction
 * and the honest consequence of "it fires a machine gun".
 */
function droneGunStats(world: World, level: number): void {
  const hero = world.heroes[world.player.heroId];
  if (hero === undefined) return;
  resolveWeaponStats(
    MACHINE_GUN,
    hero,
    level,
    world.levelUp.stacks,
    world.upgradeCatalog,
    world.droneGun,
  );
}

export function updateDrones(world: World, dt: number): void {
  const drones = world.drones;

  // ---- find the bay -----------------------------------------------------------------------
  //
  // FIRST, because the drones' gun is the Machine Gun AT THE BAY'S TIER, and the magazine a new
  // drone is deployed with comes from that gun rather than from the bay. Reading it off the bay's
  // own stats was this system's first bug: the bay carries no ammo, so every drone launched with a
  // single round and detonated on its first shot.
  let bay = -1;
  for (let i = 0; i < world.weaponCount; i++) {
    const def = world.weaponCatalog[world.weapons[i].defId];
    if (def !== undefined && def.pattern === 'factory') {
      bay = i;
      break;
    }
  }
  if (bay < 0) {
    // No bay in the loadout. Any drones left over from one that somehow vanished are dropped
    // rather than orphaned with a slot that no longer means anything.
    drones.count = 0;
    return;
  }

  const inst = world.weapons[bay];
  droneGunStats(world, inst.level);
  const gun = world.droneGun;
  const acquire = gun.range * DRONE_ACQUIRE_MUL;
  const acquireSq = acquire * acquire;
  const engageRadius = gun.range * ENGAGE_RADIUS_FRAC;
  // THE GUN'S WHOLE MAGAZINE. No drone-specific fraction: the round is what was made cheaper.
  const magazine = Math.max(1, Math.floor(gun.ammoCapacity));

  // ---- the bay: build timers, and deploying what they finish -------------------------------
  //
  // Run before the drones move, so a drone that finishes this tick starts flying this tick rather
  // than sitting at the player's feet for a frame.
  const maxAlive = inst.stats.projectileCount >= 1 ? inst.stats.projectileCount : 1;
  let alive = 0;
  for (let d = 0; d < drones.count; d++) if (drones.weaponSlot[d] === bay) alive++;

  // THE TIMER RUNS WHATEVER IS ALIVE, and a finished build with no room to deploy is BANKED - one,
  // and only one. That is the prebuild rule: a player at full strength is still making progress, so
  // a loss is replaced the instant it happens and the next build starts from zero. Banking more
  // than one would let a careful player stockpile a squadron through a quiet minute and deploy it
  // into the next wave, which is a different weapon.
  //
  // `cooldownLeft` starts at 0, so THE FIRST DRONE IS FREE - it is flying the tick the bay is
  // picked up. A card that did nothing whatsoever for its first thirty seconds would be a card
  // nobody takes, and the thirty seconds is the REBUILD, which is where it actually bites.
  if (alive < maxAlive) {
    // THE RESERVE GOES FIRST. It is already built; running the timer down again before using it
    // would mean the prebuild bought nothing, which is the entire point of banking one.
    if (inst.droneBanked) {
      deployDrone(world, bay, magazine, alive);
      alive++;
      inst.droneBanked = false;
      inst.cooldownLeft = inst.stats.cooldown;
    } else {
      if (inst.cooldownLeft > 0) inst.cooldownLeft -= dt;
      if (inst.cooldownLeft <= 0) {
        deployDrone(world, bay, magazine, alive);
        alive++;
        inst.cooldownLeft = inst.stats.cooldown;
      }
    }
  } else if (!inst.droneBanked) {
    // At the cap and nothing in reserve: keep building, and STOP when it is full. The timer is
    // frozen rather than left running, so the reserve cannot silently become a queue.
    if (inst.cooldownLeft > 0) inst.cooldownLeft -= dt;
    if (inst.cooldownLeft <= 0) inst.droneBanked = true;
  }

  const enemies = world.enemies;
  const player = world.player;

  // ---- the drones ---------------------------------------------------------------------------
  //
  // DOWNWARD, because a drone that explodes is swap-removed and the entry moved into its place
  // must still be visited.
  for (let d = drones.count - 1; d >= 0; d--) {
    drones.prevX[d] = drones.x[d];
    drones.prevY[d] = drones.y[d];

    // ---- target: keep the one it has if it is still worth having, else look ----------------
    let target = drones.targetDense[d];
    if (target >= 0) {
      // A dense index is only valid within a tick: the enemy it pointed at last tick may be dead,
      // reaped, or a different body entirely after a swap-remove. Everything below re-earns it,
      // INCLUDING the circle - a target that walks out of the player's radius is dropped
      // mid-engagement rather than towed along behind it.
      if (
        target >= enemies.count ||
        (enemies.flags[target] & ENEMY_FLAG_DEAD) !== 0 ||
        distSq(enemies.x[target], enemies.y[target], player.x, player.y) > acquireSq
      ) {
        target = -1;
      }
    }
    if (target < 0) {
      // Queried from the PLAYER - see the comment on the acquisition circle. The drone's own
      // position decides only WHICH of the legal bodies it takes, never which are legal.
      const n = TARGETING.nearest(
        world,
        player.x,
        player.y,
        acquireSq,
        DRONE_TARGETS.length,
        DRONE_TARGETS,
      );
      let bestSq = Infinity;
      for (let k = 0; k < n; k++) {
        const cand = DRONE_TARGETS[k];
        const dSq = distSq(enemies.x[cand], enemies.y[cand], drones.x[d], drones.y[d]);
        if (dSq < bestSq) {
          bestSq = dSq;
          target = cand;
        }
      }
    }
    drones.targetDense[d] = target;
    drones.state[d] = target >= 0 ? DRONE_STATE_ENGAGE : DRONE_STATE_ESCORT;

    // ---- fly the circle -------------------------------------------------------------------
    const centreX = target >= 0 ? enemies.x[target] : player.x;
    const centreY = target >= 0 ? enemies.y[target] : player.y;
    const radius = target >= 0 ? engageRadius : ESCORT_RADIUS;

    drones.angle[d] += ORBIT_RATE * dt * drones.spin[d];
    if (drones.angle[d] > TWO_PI) drones.angle[d] -= TWO_PI;
    else if (drones.angle[d] < 0) drones.angle[d] += TWO_PI;

    const wantX = centreX + dcos(drones.angle[d]) * radius;
    const wantY = centreY + dsin(drones.angle[d]) * radius;
    // Eased rather than snapped, and `t` is clamped at 1 so a long frame cannot overshoot into a
    // wobble - the one way a follow like this can go unstable.
    const t = FOLLOW_RATE * dt < 1 ? FOLLOW_RATE * dt : 1;
    drones.x[d] += (wantX - drones.x[d]) * t;
    drones.y[d] += (wantY - drones.y[d]) * t;

    // ---- shoot ------------------------------------------------------------------------------
    if (drones.cooldownLeft[d] > 0) drones.cooldownLeft[d] -= dt;
    if (target < 0 || drones.cooldownLeft[d] > 0) continue;

    const dx = enemies.x[target] - drones.x[d];
    const dy = enemies.y[target] - drones.y[d];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > gun.range || len <= 0) continue;

    fireRound(world, d, dx / len, dy / len, gun);
    drones.cooldownLeft[d] = gun.cooldown;
    drones.ammo[d]--;

    // ---- and die when the magazine is empty -------------------------------------------------
    if (drones.ammo[d] <= 0) {
      explode(world, d);
      freeDrone(drones, d);
    }
  }
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Puts a new drone on the field, on the far side of the escort ring from the ones already there.
 *
 * The phase is spread by the count rather than drawn from an RNG: a random one would couple the
 * drones to the loot or spawn stream for a purely cosmetic decision, and evenly spaced is what a
 * player would draw if asked to.
 */
function deployDrone(world: World, slot: number, ammo: number, alive: number): void {
  const player = world.player;
  const angle = (TWO_PI * alive) / 4;
  const x = player.x + dcos(angle) * ESCORT_RADIUS;
  const y = player.y + dsin(angle) * ESCORT_RADIUS;
  // Alternating spin, so two drones on the same ring do not sit on top of each other forever.
  const spin = alive % 2 === 0 ? 1 : -1;
  allocDrone(world.drones, x, y, angle, ammo > 0 ? ammo : 1, slot, spin);
}

/** One round, credited to the bay that built the drone so the damage table names the right gun. */
function fireRound(world: World, d: number, dirX: number, dirY: number, gun: WeaponStats): void {
  const drones = world.drones;
  const p = world.projectiles;
  const spawnId = ++world.stats.shotsFired;
  const handle = allocProjectile(
    p,
    drones.x[d],
    drones.y[d],
    dirX * gun.projectileSpeed,
    dirY * gun.projectileSpeed,
    gun.projectileLifetime,
    drones.weaponSlot[d],
    0, // straight
    spawnId,
  );
  if (handle === NULL_HANDLE) return;

  const i = p.count - 1;
  p.damage[i] = gun.damage * DRONE_DAMAGE_FRAC;
  p.knockback[i] = gun.knockback;
  p.splashRadius[i] = 0;
  p.splashFrac[i] = 0;
  p.radius[i] = 5;
  p.pierceLeft[i] = 0;
  // The Machine Gun's own visual, read off the def rather than named here: the drone fires that
  // gun, so it should be impossible for the two to disagree about what its rounds look like.
  p.visualId[i] = MACHINE_GUN.visualId;
  pushEvent(world.events, EV_WEAPON_FIRED, world.tick, drones.x[d], drones.y[d], dirX, dirY);
}

/**
 * The dry-magazine blast, as a fused projectile with no contact and a one-tick life.
 *
 * Through the projectile path rather than by damaging a circle directly, because `expireProjectile`
 * already owns "detonate for splash, push EV_PROJECTILE_DETONATED, let the renderer draw a crater".
 * Doing it by hand would be a second detonation site to keep in step with the first.
 */
function explode(world: World, d: number): void {
  const drones = world.drones;
  const p = world.projectiles;
  const inst = world.weapons[drones.weaponSlot[d]];
  if (inst === undefined) return;
  const stats = inst.stats;

  const spawnId = ++world.stats.shotsFired;
  const handle = allocProjectile(
    p,
    drones.x[d],
    drones.y[d],
    0,
    0,
    // One tick. Long enough to be integrated and expired by S7 on this same frame, so the blast
    // lands where the drone died rather than a frame later.
    1 / 120,
    drones.weaponSlot[d],
    0,
    spawnId,
  );
  if (handle === NULL_HANDLE) return;

  const i = p.count - 1;
  p.damage[i] = stats.damage;
  p.knockback[i] = stats.knockback;
  p.splashRadius[i] = stats.splashRadius;
  p.splashFrac[i] = stats.splashFrac;
  p.radius[i] = 0;
  p.pierceLeft[i] = 0;
  p.visualId[i] = 5;
  p.flags[i] |= PROJECTILE_FLAG_NOCONTACT;
}
