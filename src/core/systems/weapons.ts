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
 *
 * ---------------------------------------------------------------------------------------------
 * BEAM WEAPONS - the second modality, and the ONE branch in the loop
 * ---------------------------------------------------------------------------------------------
 * `WeaponDef.kind` is the only thing the loop below branches on, and it branches for one reason:
 * a shell is an OBJECT and a beam is an EVENT. A projectile weapon spends a COOLDOWN and leaves
 * something behind that the sim integrates for the next half second; a beam spends HEAT and
 * exists only for the tick that produced it. Nothing else about them differs - they share the
 * targeting table, the traverse, the fire arc and the muzzle offset - so the branch is three
 * `if`s guarding the cooldown, not a second copy of the loop.
 *
 * A BEAM WEAPON'S TICK, in order (and every early exit COOLS, which is what makes the duty cycle
 * a property of the mechanic rather than of how often you happen to have a target):
 *
 *   1. overheated?          cool; resume at `stats.heatResume`. Never fires.
 *   2. no target in range?  cool.
 *   3. turret not laid on?  cool.
 *   4. raycast from the muzzle for the NEAREST enemy the line touches.
 *   5. `requiresClearLine` and that enemy is not the target?  cool. NO SHOT AT ALL - the beam
 *      does not fire into the blocker, which is the whole character of the weapon.
 *   6. otherwise fire: damage x dt into the beam buffer, heat up, maybe cut out.
 *
 * DAMAGE IS PER SECOND for a beam. `stats.damage * dt` goes into the buffer already scaled, and
 * updateDamage applies it verbatim - so a 30 dps laser deals exactly 30 over a second of contact
 * no matter what the tick rate is, and there is exactly one place that knows about the scaling.
 *
 * ---------------------------------------------------------------------------------------------
 * HEAT IS THREE PER-WEAPON NUMBERS, NOT ONE GLOBAL CEILING
 * ---------------------------------------------------------------------------------------------
 * There is no HEAT_MAX and no HEAT_RESUME here any more. Every laser carries its own
 *
 *     stats.heatPerSec       gained per second of fire       (a damage tier raises it)
 *     stats.heatCapacity     the ceiling it cuts out at      (a capacity tier raises it)
 *     stats.heatDispersion   shed per second while not firing (a dispersion tier raises it)
 *     stats.heatResume       derived: heatCapacity * HEAT_RESUME_FRAC
 *
 * and this file reads all four off `inst.stats` rather than off a constant. GENERATION AND
 * DISPERSION ARE DIFFERENT NUMBERS - that is the whole point of the ladder, and it is why cooling
 * runs at `heatDispersion` and NOT at `heatPerSec`. They start equal on an untiered laser (which
 * is what gives it its even half-uptime rhythm) and diverge the moment a tier is taken:
 *
 *     burst from cold     heatCapacity / heatPerSec
 *     burst in steady state   (heatCapacity - heatResume) / heatPerSec
 *     silence             (heatCapacity - heatResume) / heatDispersion
 *     sustained uptime    heatDispersion / (heatPerSec + heatDispersion)
 *
 * A capacity tier makes both the burst and the silence proportionally longer at the same uptime;
 * a dispersion tier shortens the silence alone and is the only thing that moves the uptime.
 */

import { MAX_TARGETS } from '../constants.js';
import { MAX_ENEMY_RADIUS } from '../content/enemyCatalog.js';
import { ENEMY_FLAG_DEAD } from '../entity/enemyPool.js';
import { allocProjectile } from '../entity/projectilePool.js';
import { NULL_HANDLE } from '../entity/handle.js';
import {
  EV_WEAPON_COOLED,
  EV_WEAPON_FIRED,
  EV_WEAPON_OVERHEATED,
  NO_BEAM_TARGET,
  pushBeam,
  pushEvent,
} from '../events/ring.js';
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

/**
 * The beam path's tick-local context.
 *
 * MODULE-LEVEL FOR EXACTLY THE SAME REASON AS `SHOT`, and with the same safety argument: every
 * field is written immediately before it is read, inside one synchronous call chain, and nothing
 * is carried between weapons or between ticks. It exists because `FirePattern` is a fixed
 * five-argument signature shared with `battery` - it carries no `dt`, and it has nowhere to put
 * the ray result - and widening that signature for one pattern would push a beam-shaped
 * parameter into the Cannon's call site, which is the coupling the table exists to avoid.
 *
 * `hitT` is the distance along the ray at which the beam stopped, so the drawn line ends exactly
 * where the simulation says it ended rather than at the target's centre.
 */
const BEAM = {
  dt: 0,
  hitT: 0,
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

  // The beam buffer's per-tick reset. It belongs HERE rather than in beginTick, next to
  // hits/contacts/kills, for one reason: the renderer reads the beams AFTER stepWorld returns,
  // to draw the lines the sim just fired. Clearing it at the top of its only writer means the
  // buffer holds this tick's beams for every consumer downstream of S6 - updateDamage at S9 and
  // the render layer after S13 - and is empty again before anything can write a second set.
  // (beginTick would work identically for the sim; it would just also blank the geometry the
  // renderer has not drawn yet on any tick where the pipeline exits early.)
  world.beams.count = 0;

  for (let i = 0; i < world.weaponCount; i++) {
    const inst = world.weapons[i];
    const def = world.weaponCatalog[inst.defId];
    if (def === undefined) continue;
    const stats = inst.stats;
    const beam = def.kind === 'beam';

    // Runs down to <= 0 and stops there: exactly one banked shot. See the file header.
    // A beam has no cooldown at all - heat is its limiter, and `stats.cooldown` is floored at
    // 0.05 by resolveWeaponStats, so letting a beam through this gate would silently throttle it
    // to 20 ticks per second of fire.
    if (!beam && inst.cooldownLeft > 0) inst.cooldownLeft -= dt;

    // Step 1: a laser that has cut out is not engaging anything. It cools, it holds no target,
    // and it does not traverse - an emitter with the breaker tripped is not tracking you.
    if (beam && inst.overheated) {
      coolBeam(world, i, inst, dt);
      inst.targetDense = -1;
      continue;
    }

    // TARGET SELECTION RUNS EVERY TICK, not only when the cooldown is ready. That is what lets
    // the turret track smoothly across the 1.2 s between shots - and the visible traverse IS the
    // readability mechanism for the whole highest-HP rule (DESIGN.md §7.4 requirement 1).
    const want = stats.projectileCount < MAX_TARGETS ? stats.projectileCount : MAX_TARGETS;
    let n = TARGETING[def.targeting](world, player.x, player.y, stats.rangeSq, want, targets);
    if (trait !== undefined && trait.modifyTargets !== undefined) {
      n = trait.modifyTargets(world, targets, n);
    }
    inst.targetDense = n > 0 ? targets[0] : -1;

    if (n === 0 && def.requiresTarget) {
      // idle: no shot, and NO cooldown reset
      if (beam) coolBeam(world, i, inst, dt); // step 2
      continue;
    }

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

    if (!beam && inst.cooldownLeft > 0) continue;
    // Hold fire until laid on. Not a cooldown reset - only a delay.
    if (dot(inst.turretX, inst.turretY, aim.x, aim.y) < stats.cosFireArc) {
      if (beam) coolBeam(world, i, inst, dt); // step 3
      continue;
    }

    // Steps 4-6 for a beam live in `fireBeam`, which owns the raycast, the clear-line refusal
    // (and its cooling) and the heat. A projectile weapon's volley is unchanged.
    BEAM.dt = dt;
    FIRE_PATTERNS[def.pattern](world, i, inst, targets, n);
    if (!beam) inst.cooldownLeft = stats.cooldown;
  }
}

// -------------------------------------------------------------------------------------------
// Heat
// -------------------------------------------------------------------------------------------

/**
 * Sheds `stats.heatDispersion * dt` and, once at or below `stats.heatResume`, unlatches the
 * weapon. Heat is clamped into [0, heatCapacity] on the way through.
 *
 * DISPERSION, NOT GENERATION. Cooling used to run at `heatPerSec` because the two were the same
 * number; they are now separate stats upgraded by separate tiers, and reading the wrong one here
 * would silently delete the entire dispersion half of every laser's ladder - the weapon would
 * take the tier, the card would claim it, and nothing on the field would change.
 *
 * Called from EVERY path that does not fire - overheated, no target, not laid on, blocked line -
 * because "cools while not firing" has to mean exactly that. If cooling only ran while the
 * weapon had a target and a clear line, a laser would freeze one point under its ceiling the
 * moment the horde closed up and stay dead until the crowd parted, which is the opposite of the
 * intended behaviour: refusing a blocked shot is supposed to BUY you the next burst.
 *
 * The unlatch tick does not fire. That is deliberate and it is what `overheated` being a latched
 * flag rather than `heat >= heatCapacity` buys: the weapon stays out for the whole slide down to
 * the resume threshold, then comes back on the following tick with that much headroom.
 */
function coolBeam(world: World, weaponIdx: number, inst: WeaponInstance, dt: number): void {
  const stats = inst.stats;
  let heat = inst.heat - stats.heatDispersion * dt;
  if (heat < 0) heat = 0;
  else if (heat > stats.heatCapacity) heat = stats.heatCapacity;
  inst.heat = heat;
  if (inst.overheated && heat <= stats.heatResume) {
    inst.overheated = false;
    pushEvent(world.events, EV_WEAPON_COOLED, world.tick, weaponIdx, heat, 0, 0);
  }
}

// -------------------------------------------------------------------------------------------
// The beam raycast
// -------------------------------------------------------------------------------------------

/**
 * Nearest live enemy whose CIRCLE the ray (origin + dir * t, 0 <= t <= maxDist) touches.
 * Returns its dense index, or -1, and leaves the contact distance in `BEAM.hitT`.
 *
 * THIS QUERIES THE SPATIAL HASH, NEVER THE POOL. At 300 live enemies, three lasers and 60 Hz, a
 * linear scan would be 54 000 circle tests per second before the Cannon's targeting query has
 * done anything at all. What this walks instead is the band of CELLS the segment crosses:
 *
 *   - the cell rectangle of the segment's bounding box, dilated by MAX_ENEMY_RADIUS, is the only
 *     region that can contain the CENTRE of an enemy whose body touches the line;
 *   - each candidate cell is then rejected exactly, by clipping the segment's parameter range
 *     against that cell's dilated rectangle (the slab test below). A cell the segment does not
 *     cross costs about ten flops and is never opened.
 *
 * For the long laser (430 u) that is at most a 7x7 rectangle of which ~9 cells survive the slab
 * test - roughly a twentieth of the cells its own targeting query already walked. A DDA march
 * would visit a similar number of cells and then need the same one-cell dilation to catch bodies
 * whose centre sits in a neighbouring cell, so this form is chosen for being the one whose
 * correctness is obvious.
 *
 * BUCKET ALIASING IS NOT FILTERED HERE, deliberately. `itemKey` exists so that a circle query
 * does not PAY for enemies from a distant cell that merely hashed into the same bucket; but the
 * exact ray-circle test below is the authority on what the beam touches, and it accepts an
 * aliased entry only when that enemy genuinely intersects the segment - in which case finding it
 * is correct. So the filter would change the cost by one circle test per alias and change the
 * result by nothing, at the price of duplicating the hash's private cell encoding in this file.
 */
function raycastNearestEnemy(
  world: World,
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  maxDist: number,
): number {
  const h = world.spatial;
  const enemies = world.enemies;
  const ex = enemies.x;
  const ey = enemies.y;
  const er = enemies.radius;
  const flags = enemies.flags;
  const spawnId = enemies.spawnId;

  const endX = originX + dirX * maxDist;
  const endY = originY + dirY * maxDist;

  // Dilation: an enemy whose body touches the segment has its CENTRE within its own radius of
  // the segment, and no enemy in the roster is larger than MAX_ENEMY_RADIUS.
  const pad = MAX_ENEMY_RADIUS;
  const inv = h.invCellSize;
  const cell = h.cellSize;

  const minX = (originX < endX ? originX : endX) - pad;
  const maxX = (originX > endX ? originX : endX) + pad;
  const minY = (originY < endY ? originY : endY) - pad;
  const maxY = (originY > endY ? originY : endY) + pad;

  const cx0 = Math.floor(minX * inv);
  const cx1 = Math.floor(maxX * inv);
  const cy0 = Math.floor(minY * inv);
  const cy1 = Math.floor(maxY * inv);

  // Division is hoisted out of the cell loop. The zero branches keep the slab test off the
  // Infinity path entirely for an axis-aligned beam, which is the common case when the player
  // is standing still.
  const dirXZero = dirX === 0;
  const dirYZero = dirY === 0;
  const invDirX = dirXZero ? 0 : 1 / dirX;
  const invDirY = dirYZero ? 0 : 1 / dirY;

  const bucketStart = h.bucketStart;
  const items = h.items;
  const mask = h.bucketMask;

  let bestDense = -1;
  let bestT = 0;

  for (let cy = cy0; cy <= cy1; cy++) {
    const ry0 = cy * cell - pad;
    const ry1 = ry0 + cell + pad + pad;
    if (dirYZero && (originY < ry0 || originY > ry1)) continue;

    for (let cx = cx0; cx <= cx1; cx++) {
      const rx0 = cx * cell - pad;
      const rx1 = rx0 + cell + pad + pad;

      // Slab clip of t in [0, maxDist] against the dilated cell rectangle. Conservative by
      // construction (it is the segment-vs-AABB overlap test), so it can reject a cell but can
      // never reject an enemy the exact test below would have accepted.
      let tmin = 0;
      let tmax = maxDist;
      if (dirXZero) {
        if (originX < rx0 || originX > rx1) continue;
      } else {
        let ta = (rx0 - originX) * invDirX;
        let tb = (rx1 - originX) * invDirX;
        if (ta > tb) {
          const swap = ta;
          ta = tb;
          tb = swap;
        }
        if (ta > tmin) tmin = ta;
        if (tb < tmax) tmax = tb;
      }
      if (!dirYZero) {
        let ta = (ry0 - originY) * invDirY;
        let tb = (ry1 - originY) * invDirY;
        if (ta > tb) {
          const swap = ta;
          ta = tb;
          tb = swap;
        }
        if (ta > tmin) tmin = ta;
        if (tb < tmax) tmax = tb;
      }
      if (tmin > tmax) continue;

      // Cell coordinates are hashed with the grid's own function, so this cannot drift from the
      // layout rebuildSpatialHash wrote.
      const b = (Math.imul(cx, 0x05891c1b) ^ Math.imul(cy, 0x29193f5b)) & mask;
      const end = bucketStart[b + 1];
      for (let i = bucketStart[b]; i < end; i++) {
        const d = items[i];
        // Deferred reaping leaves corpses in the hash until S12. A beam must not stop on one -
        // that would let a body you killed this tick shield the enemy behind it for one tick.
        if ((flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;

        const ox = ex[d] - originX;
        const oy = ey[d] - originY;
        const tca = ox * dirX + oy * dirY; // projection onto the ray; dir is unit
        const r = er[d];
        const r2 = r * r;
        const perp2 = ox * ox + oy * oy - tca * tca; // squared distance from centre to the line
        if (perp2 > r2) continue;

        // Entry point: where the ray first TOUCHES the circle, which is where the drawn line
        // has to stop. (Not tca - that is the point of closest approach, inside the body.)
        const half = Math.sqrt(r2 - perp2 > 0 ? r2 - perp2 : 0);
        let t = tca - half;
        if (t > maxDist) continue;
        if (t < 0) {
          // The muzzle is already inside this body, or the body is entirely behind it.
          if (tca + half < 0) continue;
          t = 0;
        }

        // Strict total order: nearer wins, then lower spawnId. The tie-break can only matter for
        // two bodies contacted at bit-identical distance, but without it the winner would be
        // decided by bucket layout and a replay could drift on a rebuild.
        if (bestDense < 0 || t < bestT || (t === bestT && spawnId[d] < spawnId[bestDense])) {
          bestDense = d;
          bestT = t;
        }
      }
    }
  }

  BEAM.hitT = bestT;
  return bestDense;
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
 * `beam` - steps 4 to 6 of a beam weapon's tick: raycast, refuse or fire, heat.
 *
 * THE RAY IS AIMED AT THE TARGET, NOT DOWN THE TURRET. The turret facing has already been
 * gated to within `fireArc` of the target by updateWeapons; using the exact line to the target
 * is what makes "is anything in the way?" the question it is supposed to be. Aiming down the
 * (very slightly off) turret vector instead would make the clear-line test depend on traverse
 * lag, so a laser would refuse shots for a fraction of a second after every retarget for no
 * reason a player could see.
 *
 * THE REFUSAL IS THE WEAPON. `requiresClearLine` means a body between the emitter and the chosen
 * target cancels the shot outright - the beam does not fire into the blocker, does not partially
 * damage it, and does not pick a different target this tick. It cools instead, which is why a
 * laser walks out of a bad position with a full charge rather than an empty one.
 *
 * NO KNOCKBACK, EVER. A continuous beam applying an impulse sixty times a second would launch a
 * swarmer into orbit; the buffer carries no knockback field at all, so this is structural rather
 * than a number set to zero.
 */
export const fireBeam: FirePattern = (world, weaponIdx, inst, targets, targetCount): void => {
  const def = world.weaponCatalog[inst.defId] as WeaponDef;
  const stats = inst.stats;
  const dt = BEAM.dt;
  const aim = world.scratch.v2;

  const target = targetCount > 0 ? targets[0] : -1;
  aimInto(world, target, inst.turretX, inst.turretY, aim);

  // The emitter head, offset along the firing line exactly as a shell leaves the barrel.
  const x0 = world.player.x + aim.x * def.muzzleOffset;
  const y0 = world.player.y + aim.y * def.muzzleOffset;

  const hit = raycastNearestEnemy(world, x0, y0, aim.x, aim.y, stats.range);

  // Step 5. `target < 0` is unreachable for a laser (all three set `requiresTarget`), and is
  // refused rather than waved through: "fire only if the chosen target is the first thing the
  // ray touches" cannot be satisfied by a weapon that has not chosen one.
  if (def.requiresClearLine && (target < 0 || hit !== target)) {
    coolBeam(world, weaponIdx, inst, dt); // blocked, or the target slipped off the line
    return;
  }

  // A weapon with `requiresClearLine: false` and nothing on the line draws its full length into
  // empty space and deals nothing. No laser does that today; the branch is what keeps the
  // NO_BEAM_TARGET sentinel in the buffer meaningful rather than unreachable.
  const reach = hit >= 0 ? BEAM.hitT : stats.range;
  const damage = hit >= 0 ? stats.damage * dt : 0;

  pushBeam(
    world.beams,
    weaponIdx,
    hit >= 0 ? hit : NO_BEAM_TARGET,
    damage,
    x0,
    y0,
    x0 + aim.x * reach,
    y0 + aim.y * reach,
  );

  // Step 6. The tick that reaches this weapon's OWN capacity still fires - it cuts out AFTER
  // delivering the shot that overloaded it, so a full burst is exactly
  // heatCapacity / heatPerSec seconds of damage and not one tick less. The ceiling is the
  // weapon's, so a capacity tier buys a longer burst rather than a fuller bar.
  const capacity = stats.heatCapacity;
  const heat = inst.heat + stats.heatPerSec * dt;
  if (heat >= capacity) {
    inst.heat = capacity; // clamped: heat never exceeds this weapon's capacity
    inst.overheated = true;
    pushEvent(world.events, EV_WEAPON_OVERHEATED, world.tick, weaponIdx, capacity, 0, 0);
  } else {
    inst.heat = heat;
  }
};

/**
 * THE FIRE-PATTERN TABLE. Adding a pattern is one entry here plus one pure function above.
 */
export const FIRE_PATTERNS: Readonly<Record<FirePatternId, FirePattern>> = Object.freeze({
  battery: fireBattery,
  beam: fireBeam,
});
