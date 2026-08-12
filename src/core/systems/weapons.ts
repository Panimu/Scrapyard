/**
 * S6 - updateWeapons. The firing loop, written once and never edited to add a weapon.
 *
 * Everything weapon-specific arrives through three data-selected strategies:
 *
 *     WeaponDef.targeting  -> TARGETING[id]            (targeting.ts)   who to shoot
 *     WeaponDef.pattern    -> FIRE_PATTERNS[id]        (this file)      how the volley leaves
 *     WeaponDef.behaviour  -> PROJECTILE_BEHAVIOURS[i] (projectiles.ts) how the shell flies
 *
 * so weapon #2 is a WeaponDef literal plus at most one new pure function. Nothing below this
 * comment knows what a Cannon is.
 *
 * THE COOLDOWN, WHILE NOTHING IS IN RANGE - the deliberate choice, stated once:
 *
 *   `cooldownLeft` is decremented at the TOP of the loop, before targeting, and only while it is
 *   still positive. So an idle weapon runs its cooldown down to <= 0 and STAYS there. The Cannon
 *   therefore BANKS EXACTLY ONE CHARGED SHOT: walk into a fight and the first shell is already
 *   chambered; walk around for a minute and it is still exactly one, never sixty.
 *
 *   This is the right shape for a heavy weapon. Banking nothing would punish repositioning - the
 *   core skill of the genre - by making every disengage cost a full 1.2 s on re-contact. Banking
 *   many would turn kiting into a burst-damage exploit and delete the pacing the whole game is
 *   built on. One is the only number that does neither.
 *
 *   The same rule covers HOLD FIRE: when the turret is not yet laid on, the loop `continue`s
 *   WITHOUT resetting the cooldown, so a shot is only ever DELAYED, never lost.
 */

import { MAX_TARGETS } from '../constants.js';
import { allocProjectile } from '../entity/projectilePool.js';
import { NULL_HANDLE } from '../entity/handle.js';
import { EV_WEAPON_FIRED, pushEvent } from '../events/ring.js';
import { dot, normalizeInto, rotateTowardsInto } from '../math/vec2.js';
import type { Vec2 } from '../math/vec2.js';
import { HERO_TRAITS } from '../data/traits.js';
import type { HeroTrait, ShotCtx } from '../data/heroes.js';
import {
  BEHAVIOUR_ID,
  type FirePattern,
  type FirePatternId,
  type WeaponDef,
} from '../content/weaponCatalog.js';
import { TARGETING } from './targeting.js';
import type { World, WeaponInstance } from '../types.js';

/**
 * The mutable ShotCtx handed to `HeroTrait.onFireShell`.
 *
 * MODULE-LEVEL AND THAT IS SAFE, unlike the world-scoped scratch in `World.scratch`: every field
 * is written immediately before the hook is called and read immediately after it returns, within
 * one synchronous call, and nothing is ever carried between calls. Two worlds stepped in the
 * same process (which the determinism suite does) cannot interleave inside it. Putting it on
 * World would mean editing types.ts, which this agent does not own.
 */
const SHOT: ShotCtx = {
  dirX: 1,
  dirY: 0,
  damage: 0,
  knockback: 0,
  targetDense: -1,
  shellIndex: 0,
};

/** The hero's trait record, or undefined for a fixture hero with no traits registered. */
function traitOf(world: World): HeroTrait | undefined {
  const hero = world.heroes[world.player.heroId];
  if (hero === undefined) return undefined;
  return HERO_TRAITS[hero.id] as HeroTrait | undefined;
}

/**
 * Unit vector from the turret pivot (the chassis centre) to enemy `dense`, into `out`.
 * Falls back to the supplied facing when there is no target, or in the degenerate case of an
 * enemy standing exactly on the player - which must resolve to something rather than (0,0).
 */
function aimInto(
  world: World,
  dense: number,
  fallbackX: number,
  fallbackY: number,
  out: Vec2,
): void {
  if (dense >= 0) {
    const len = normalizeInto(
      world.enemies.x[dense] - world.player.x,
      world.enemies.y[dense] - world.player.y,
      out,
    );
    if (len > 0) return;
  }
  out.x = fallbackX;
  out.y = fallbackY;
}

export function updateWeapons(world: World, dt: number): void {
  const player = world.player;
  const targets = world.scratch.targets;
  const aim = world.scratch.v0;
  const turned = world.scratch.v1;
  const trait = traitOf(world);

  for (let i = 0; i < world.weaponCount; i++) {
    const inst = world.weapons[i];
    const def = world.weaponCatalog[inst.defId];
    if (def === undefined) continue;
    const stats = inst.stats;

    // Runs down to <= 0 and stops there: exactly one banked shot. See the file header.
    if (inst.cooldownLeft > 0) inst.cooldownLeft -= dt;

    // TARGET SELECTION RUNS EVERY TICK, not only when the cooldown is ready. That is what lets
    // the turret track smoothly across the 1.2 s between shots - and the visible traverse IS the
    // readability mechanism for the whole highest-HP rule (DESIGN.md §7.4 requirement 1).
    const want = stats.projectileCount < MAX_TARGETS ? stats.projectileCount : MAX_TARGETS;
    let n = TARGETING[def.targeting](world, player.x, player.y, stats.rangeSq, want, targets);
    if (trait !== undefined && trait.modifyTargets !== undefined) {
      n = trait.modifyTargets(world, targets, n);
    }
    inst.targetDense = n > 0 ? targets[0] : -1;

    if (n === 0 && def.requiresTarget) continue; // idle: no shot, and NO cooldown reset

    // Traverse toward the primary target. No trigonometry: rotateTowardsInto rotates a unit
    // vector by the precomputed cos/sin of one step, which is the only way this stays
    // bit-identical between V8 in CI and JSC on the phone (DESIGN.md §2).
    aimInto(world, inst.targetDense, inst.turretX, inst.turretY, aim);
    rotateTowardsInto(
      inst.turretX,
      inst.turretY,
      aim.x,
      aim.y,
      stats.cosTraverseStep,
      stats.sinTraverseStep,
      turned,
    );
    inst.turretX = turned.x;
    inst.turretY = turned.y;

    if (inst.cooldownLeft > 0) continue;
    // Hold fire until laid on. Not a cooldown reset - only a delay.
    if (dot(inst.turretX, inst.turretY, aim.x, aim.y) < stats.cosFireArc) continue;

    FIRE_PATTERNS[def.pattern](world, i, inst, targets, n);
    inst.cooldownLeft = stats.cooldown;
  }
}

/**
 * `battery` - the default pattern. `projectileCount` shells are distributed across the top-K
 * targets: shell i goes to targets[min(i, n-1)], and any SURPLUS shell (one that re-engages an
 * already-targeted enemy) deals damage x reengageMul.
 *
 * That is what makes Twin Mount a battery rather than a damage multiplier: four shells into four
 * separate enemies are worth 4x, four shells into a lone elite are worth 1 + 3 x 0.55.
 *
 * SHELLS FLY TOWARD A DIRECTION, NOT TOWARD AN ENTITY. The projectile pool carries no target
 * handle at all, so "the target died mid-flight" is not a case that can be got wrong - there is
 * nothing to dangle. Homing, when it arrives, is a new BehaviourId plus a per-weapon data flag,
 * not a field on every shell.
 *
 * Each shell is aimed at ITS OWN target's position at the moment of firing, and leaves from a
 * muzzle offset along its own direction. The primary shell's direction is within `fireArc` of
 * the turret by construction (updateWeapons gates on exactly that), so it visibly leaves the
 * barrel; secondary shells are a flak battery and are expected to fan out.
 */
export const fireBattery: FirePattern = (world, weaponIdx, inst, targets, targetCount): void => {
  const def = world.weaponCatalog[inst.defId] as WeaponDef;
  const stats = inst.stats;
  const projectiles = world.projectiles;
  const trait = traitOf(world);
  const aim = world.scratch.v2;
  const renormalised = world.scratch.v1;

  const shells = stats.projectileCount >= 1 ? stats.projectileCount : 1;
  const behaviour = BEHAVIOUR_ID[def.behaviour];

  for (let s = 0; s < shells; s++) {
    // Surplus shells (index >= targetCount) re-engage the last target at reduced damage.
    const reengage = s >= targetCount;
    const dense = targetCount > 0 ? targets[reengage ? targetCount - 1 : s] : -1;

    aimInto(world, dense, inst.turretX, inst.turretY, aim);

    SHOT.dirX = aim.x;
    SHOT.dirY = aim.y;
    SHOT.damage = reengage ? stats.damage * def.reengageMul : stats.damage;
    SHOT.knockback = stats.knockback;
    SHOT.targetDense = dense;
    SHOT.shellIndex = s;
    if (trait !== undefined && trait.onFireShell !== undefined) trait.onFireShell(world, SHOT);

    // The hook receives a UNIT direction. If it rotated and/or SCALED that vector, the resulting
    // LENGTH is used as a projectile-speed multiplier - which is how HARRIER's Kinetic Feed adds
    // shell speed through a ShotCtx that has no speed field. The comparison is exact float
    // equality with no epsilon, so a hook that leaves the vector alone (the overwhelmingly common
    // case) contributes exactly zero float perturbation: the shell gets precisely
    // stats.projectileSpeed and precisely the aim direction.
    let dirX = SHOT.dirX;
    let dirY = SHOT.dirY;
    let speed = stats.projectileSpeed;
    if (dirX !== aim.x || dirY !== aim.y) {
      const scale = normalizeInto(dirX, dirY, renormalised);
      if (scale > 0) {
        dirX = renormalised.x;
        dirY = renormalised.y;
        speed = stats.projectileSpeed * scale;
      } else {
        dirX = aim.x;
        dirY = aim.y;
      }
    }

    // spawnId 0 is reserved as "none", so shell ids start at 1.
    const spawnId = ++world.stats.shotsFired;
    const handle = allocProjectile(
      projectiles,
      world.player.x + dirX * def.muzzleOffset,
      world.player.y + dirY * def.muzzleOffset,
      dirX * speed,
      dirY * speed,
      stats.projectileLifetime,
      weaponIdx,
      behaviour,
      spawnId,
    );
    // Pool exhausted (256 shells in flight - pathological). Abandon the rest of the volley; the
    // caller still consumes the cooldown, so a saturated pool cannot make the weapon retry every
    // tick and pin the CPU.
    if (handle === NULL_HANDLE) break;

    // allocProjectile appends, so the new shell is the last dense entry. This is the documented
    // pool shape and avoids a handle round-trip in the one place that allocates.
    const d = projectiles.count - 1;
    projectiles.damage[d] = SHOT.damage;
    projectiles.knockback[d] = SHOT.knockback;
    projectiles.splashRadius[d] = stats.splashRadius;
    projectiles.splashFrac[d] = stats.splashFrac;
    projectiles.radius[d] = def.shellRadius;
    projectiles.pierceLeft[d] = stats.pierce;
    projectiles.visualId[d] = def.visualId;

    // Payload: muzzle position, then the shell's unit direction - everything the render layer
    // needs to place and rotate a muzzle flash without recomputing anything.
    pushEvent(
      world.events,
      EV_WEAPON_FIRED,
      world.tick,
      projectiles.x[d],
      projectiles.y[d],
      dirX,
      dirY,
    );
  }
};

/**
 * THE FIRE-PATTERN TABLE. Adding a pattern is one entry here plus one pure function above.
 */
export const FIRE_PATTERNS: Readonly<Record<FirePatternId, FirePattern>> = Object.freeze({
  battery: fireBattery,
});
