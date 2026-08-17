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

import {
  MAX_CHAIN_LINKS,
  MAX_TARGETS,
  STRIKE_RADIUS_MAX,
  STRIKE_RADIUS_MIN,
} from '../constants.js';
import { MAX_ENEMY_RADIUS } from '../content/cycles.js';
import {
  destructibleRayHit,
  destructibleRayDistance,
  sceneryRayHit,
  sceneryX,
  sceneryY,
} from '../content/scenery.js';
import { ENEMY_FLAG_DEAD } from '../entity/enemyPool.js';
import {
  allocProjectile,
  PROJECTILE_FLAG_NOCONTACT,
  PROJECTILE_FLAG_SPLITS,
} from '../entity/projectilePool.js';
import { NULL_HANDLE } from '../entity/handle.js';
import {
  EV_WEAPON_COOLED,
  EV_WEAPON_FIRED,
  EV_WEAPON_RELOADED,
  EV_WEAPON_RELOADING,
  EV_WEAPON_OVERHEATED,
  NO_BEAM_TARGET,
  pushBeam,
  pushEvent,
} from '../events/ring.js';
import type { WeaponStats } from '../data/stats.js';
import { dot, normalizeInto, rotateTowardsInto } from '../math/vec2.js';
import type { Vec2 } from '../math/vec2.js';
import { HERO_TRAITS } from '../data/traits.js';
import type { HeroTrait, ShotCtx } from '../data/heroes.js';
import {
  BEHAVIOUR_ID,
  SPLIT_SEC,
  type FirePattern,
  type FirePatternId,
  type WeaponDef,
} from '../content/weaponCatalog.js';
import { breakLootIn } from './pickups.js';
import { sheepRayHit } from './sheep.js';
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

  // WHICH BODIES THE LASERS HAVE ALREADY TAKEN THIS TICK.
  //
  // Every laser picks by the same rule - the weakest thing in range - so two of them left to
  // themselves choose the SAME body, and the second one's damage is spent on hit points the first
  // was already going to remove. Three lasers meant three beams into one runt.
  //
  // Claims are taken in SLOT ORDER, which makes the outcome deterministic: the laser in the lower
  // slot gets first refusal, the next takes the best of what is left. Nothing here reorders the
  // loop, so a replay is unaffected.
  //
  // The cost, stated: on a nearly empty field there may be fewer bodies than lasers, and the
  // lasers that miss out idle rather than piling on. That is the trade being made - overlap is
  // wasted damage in a crowd, which is where a run is actually decided.
  const claims = world.scratch.beamClaims;
  let claimCount = 0;

  for (let i = 0; i < world.weaponCount; i++) {
    const inst = world.weapons[i];
    const def = world.weaponCatalog[inst.defId];
    if (def === undefined) continue;
    const stats = inst.stats;
    const beam = def.kind === 'beam';

    // A DRONE BAY IS NOT FIRED HERE. It has no target, no volley and no muzzle; what it has is a
    // build timer, and systems/drones.ts owns that clock. Letting it fall through would run the
    // cooldown down twice a tick - once here and once there - and reset it on a shot that has no
    // meaning.
    if (def.pattern === 'factory') continue;

    // Runs down to <= 0 and stops there: exactly one banked shot. See the file header.
    // A beam has no cooldown at all - heat is its limiter, and `stats.cooldown` is floored at
    // 0.05 by resolveWeaponStats, so letting a beam through this gate would silently throttle it
    // to 20 ticks per second of fire.
    if (!beam && inst.cooldownLeft > 0) inst.cooldownLeft -= dt;

    // AMMUNITION, before anything else looks at this weapon.
    //
    // A reloading gun is genuinely offline: it does not target, does not traverse, does not hold
    // a target. That is the whole cost of the magazine - not a slower gun, an absent one - and
    // letting the turret keep tracking through a reload would quietly soften it.
    //
    // The magazine is FILLED HERE rather than at install time so that a fresh weapon, a weapon
    // whose capacity tier just landed, and a weapon finishing a reload all take the same path.
    if (stats.ammoCapacity > 0) {
      // -1 is "never loaded": a rack that has just been installed, or one whose capacity tier
      // landed before it ever fired. It fills instantly and silently. Only a magazine emptied BY
      // FIRING costs a reload - otherwise picking the weapon up would open with fifteen seconds
      // of nothing, which is exactly the bug this sentinel exists to prevent.
      if (inst.ammo < 0) inst.ammo = stats.ammoCapacity;

      if (inst.reloadLeft > 0) {
        inst.reloadLeft -= dt;
        if (inst.reloadLeft <= 0) {
          inst.reloadLeft = 0;
          inst.ammo = stats.ammoCapacity;
          pushEvent(world.events, EV_WEAPON_RELOADED, world.tick, i, stats.ammoCapacity, 0, 0);
        }
        inst.targetDense = -1;
        continue;
      }
      if (inst.ammo === 0 && stats.reloadTime > 0) {
        inst.reloadLeft = stats.reloadTime;
        pushEvent(world.events, EV_WEAPON_RELOADING, world.tick, i, stats.reloadTime, 0, 0);
        inst.targetDense = -1;
        continue;
      }
    }

    // Step 1: a laser that has cut out is not engaging anything. It cools, it holds no target,
    // and it does not traverse - an emitter with the breaker tripped is not tracking you. It also
    // claims nothing, which is the point: an overheated laser must not reserve a body it cannot
    // shoot while the one beside it goes hungry.
    if (beam && inst.overheated) {
      coolBeam(world, i, inst, dt);
      inst.targetDense = -1;
      continue;
    }

    // TARGET SELECTION RUNS EVERY TICK, not only when the cooldown is ready. That is what lets
    // the turret track smoothly across the 1.2 s between shots - and the visible traverse IS the
    // readability mechanism for the whole highest-HP rule (DESIGN.md §7.4 requirement 1).
    const want = stats.projectileCount < MAX_TARGETS ? stats.projectileCount : MAX_TARGETS;
    // BEAMS DO NOT DOUBLE UP. Ask for one extra candidate per body another laser has already
    // claimed this tick, so that after the claimed ones are dropped there is still a full list
    // left. Since `selectTopK` returns its result SORTED by the strategy's own order, the first
    // survivor of that drop is exactly the best target nobody else is burning.
    const ask =
      beam && claimCount > 0
        ? want + claimCount < MAX_TARGETS
          ? want + claimCount
          : MAX_TARGETS
        : want;
    let n = TARGETING[def.targeting](world, player.x, player.y, stats.rangeSq, ask, targets);
    if (beam && claimCount > 0) {
      n = dropClaimed(targets, n, claims, claimCount);
      // Back to what this weapon actually fires. `fireBeam` reads only `targets[0]` today, so the
      // surplus is currently harmless - but a volley pattern that trusted the count would fire one
      // beam per inflated slot, and that is not a bug worth leaving armed.
      if (n > want) n = want;
    }
    if (trait !== undefined && trait.modifyTargets !== undefined) {
      n = trait.modifyTargets(world, targets, n);
    }
    inst.targetDense = n > 0 ? targets[0] : -1;
    // CLAIMED AT SELECTION, not at firing. A laser that has chosen a body and is still slewing
    // onto it, or that refuses the shot because scrap is in the way, has still decided - and the
    // next laser along should be looking elsewhere rather than queueing behind it.
    if (beam && inst.targetDense >= 0 && claimCount < claims.length) {
      claims[claimCount++] = inst.targetDense;
    }

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

  // THE RADIATOR BANK'S UNLOCK CONDITION - see UnlockCond `lasersOverheated`. A LATCH, checked
  // only until it fires once: the loop above has already brought every instance's `overheated`
  // flag current for this tick, so this is the one place "all three at once" can be read rather
  // than reconstructed from three counters that might have peaked on different ticks.
  if (world.stats.lasersOverheated === 0) checkLasersOverheated(world);
}

/**
 * All three lasers held, all three overheated on the same tick. `def.id` stays the base laser id
 * even at tier 8 - the Chain Laser is the Medium Laser's own WeaponDef, renamed - so an ascended
 * laser still counts as the laser it came from.
 */
function checkLasersOverheated(world: World): void {
  let short = false;
  let medium = false;
  let long = false;
  for (let i = 0; i < world.weaponCount; i++) {
    const inst = world.weapons[i];
    if (!inst.overheated) continue;
    const def = world.weaponCatalog[inst.defId];
    if (def === undefined) continue;
    if (def.id === 'laser-short') short = true;
    else if (def.id === 'laser-medium') medium = true;
    else if (def.id === 'laser-long') long = true;
  }
  if (short && medium && long) world.stats.lasersOverheated = 1;
}

/**
 * Compacts `claimed` entries out of a SORTED target list, in place, preserving order.
 *
 * Order is the whole point: `selectTopK` returns its list already sorted by the strategy's own
 * comparator, so dropping the taken ones leaves the best untaken body at index 0 without a second
 * pass over the candidate set.
 *
 * `claimCount` is at most WEAPON_SLOTS and `n` at most MAX_TARGETS, so the inner scan is a handful
 * of integer compares on a list that is already in cache.
 */
function dropClaimed(
  targets: Int32Array,
  n: number,
  claims: Int32Array,
  claimCount: number,
): number {
  let out = 0;
  for (let i = 0; i < n; i++) {
    const d = targets[i];
    let taken = false;
    for (let c = 0; c < claimCount; c++) {
      if (claims[c] === d) {
        taken = true;
        break;
      }
    }
    if (!taken) targets[out++] = d;
  }
  return out;
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
 * `beam` - steps 4 to 6 of a beam weapon's tick: raycast, fire, heat.
 *
 * AIM AND IMPACT ARE DIFFERENT THINGS. The ray is aimed at the CHOSEN TARGET - the weakest enemy
 * in range - but it stops on, and damages, THE FIRST BODY IT TOUCHES. So the target decides where
 * the beam points and whatever is standing in the way takes the burn. A laser pointed into a
 * crowd melts the front rank while nominally aiming at the wounded thing behind it, which is what
 * a beam weapon should do.
 *
 * IT USED TO REFUSE THE SHOT INSTEAD. `requiresClearLine` cancelled the tick outright unless the
 * chosen target was the first thing on the line. Measured, that was close to a non-weapon: with
 * lowest-HP targeting over a 430 u disc the chosen target is almost always buried, so a
 * stationary Long Laser fired 1.8% of ticks for 1.6 dps against a table figure of 17.5. The flag
 * is gone rather than set to false - no weapon wants it, and a config nobody sets is a config
 * that rots.
 *
 * THE RAY IS AIMED AT THE TARGET, NOT DOWN THE TURRET. updateWeapons has already gated the turret
 * to within `fireArc`, and using the exact line keeps the drawn beam and the damaged body in
 * agreement to the pixel; aiming down the slightly-off turret vector would let them disagree for
 * a few ticks after every retarget.
 *
 * NO KNOCKBACK, EVER. A continuous beam applying an impulse sixty times a second would launch a
 * runt into orbit; the buffer carries no knockback field at all, so this is structural rather
 * than a number set to zero.
 */
export const fireBeam: FirePattern = (world, weaponIdx, inst, targets, targetCount): void => {
  const def = world.weaponCatalog[inst.defId] as WeaponDef;
  const stats = inst.stats;
  const dt = BEAM.dt;
  const aim = world.scratch.v2;

  const target = targetCount > 0 ? targets[0] : -1;
  aimInto(world, target, inst.turretX, inst.turretY, aim);

  const px = world.player.x;
  const py = world.player.y;
  // The emitter head, offset along the firing line exactly as a shell leaves the barrel. This is
  // where the beam is DRAWN from, and that is all it is.
  const x0 = px + aim.x * def.muzzleOffset;
  const y0 = py + aim.y * def.muzzleOffset;

  // THE RAY STARTS AT THE PLAYER CENTRE, NOT AT THE MUZZLE, and this is not a detail.
  //
  // Casting from the muzzle makes the weapon blind at point-blank range: the ray only looks
  // forward, so any body whose centre is nearer than `muzzleOffset - radius` sits entirely BEHIND
  // the origin and is skipped. At a 22 u offset against a 13 u runt that is everything inside
  // 9 u - which is to say, everything actually pressed against the mech. Measured standing in a
  // crowd, 84.7% of the Short Laser's beams hit nothing at all and 100% of those had their target
  // inside that blind spot: it fired over the top of the bodies touching it, into open ground,
  // and paid full heat for the privilege.
  //
  // Casting from the centre also makes the ray's reach exactly the targeting radius, since
  // targeting measures `rangeSq` from the centre too. The muzzle version silently reached
  // `range + muzzleOffset`.
  const hit = raycastNearestEnemy(world, px, py, aim.x, aim.y, stats.range);

  // Step 5. No target, no shot - and no heat either. Unreachable for the three lasers (all set
  // `requiresTarget`, so updateWeapons has already skipped them), but a beam must never pay heat
  // for firing at nothing, and this is the only place that can guarantee it.
  if (target < 0) {
    coolBeam(world, weaponIdx, inst, dt);
    return;
  }

  // SCRAP IN THE WAY, AND THE LASERS HOLD FIRE FOR IT.
  //
  // Every other weapon in the game finds out about an obstacle by hitting it: a shell buries
  // itself in a wreck and that is the shot spent. A laser is not a shot, it is a TAP - it burns
  // continuously and pays heat by the second - so "fires into the scrap and is absorbed" would
  // not be a miss, it would be the weapon quietly cooking itself to zero while the player watches
  // a beam terminate in a pile. Checking first makes the obstruction free: the laser stays cold,
  // the bar stays full, and the burst is waiting the moment the player steps around the wreck.
  //
  // Compared against the RAY'S OWN reach rather than the target's distance, because the beam bills
  // whatever it touches first - scrap nearer than the enemy the ray found is genuinely between the
  // two, and scrap beyond it is behind the thing being burned and does not matter.
  const blocked = sceneryRayHit(world.scenery, px, py, aim.x, aim.y, stats.range);
  if (blocked >= 0 && (hit < 0 || blocked < BEAM.hitT)) {
    coolBeam(world, weaponIdx, inst, dt);
    return;
  }

  // ---- A TREE IN THE WAY IS BURNED THROUGH, NOT HELD FIRE FOR --------------------------------
  //
  // THE THIRD KIND OF OBSTACLE, and it behaves like neither of the other two. Scrap and stone make a
  // laser hold fire (above): there is nothing to be gained by burning a rock, so the weapon stays
  // cold and waits for the player to step around it. A fuel drum is invisible to occlusion and pops
  // as the beam sweeps past, because a drum has no hit points to spend the beam on. A TREE HAS HIT
  // POINTS, so it is the one obstacle where firing into it is progress: the beam terminates in the
  // wood, the wood takes the tick's damage, and after a few seconds of that there is a hole and the
  // beam reaches whatever was standing behind it.
  //
  // WHY THIS IS NOT AN OCCLUDER INSTEAD, which would have been one line in `wallRayHit`: an occluder
  // makes the weapon HOLD FIRE, and a weapon that refuses to shoot at a tree can never remove one -
  // the lasers would be permanently walled out of a third of the map (TREE_SHARE). Targeting must go
  // on seeing straight through the wood; only the SHOT stops in it.
  //
  // MEASURED, and this is why it is here at all: before it, a beam passed through a clump AND hit the
  // body behind it, so a laser build fought as though the wood was not there and spent almost nothing
  // on it. Two minutes of bot play on Mossy felled three stems with the Medium Laser and opened no
  // cell at all, against 16-21 stems for the shell weapons, which stop in the wood as a shell should.
  const tree = destructibleRayHit(world.scenery, px, py, aim.x, aim.y, stats.range);
  const treeT = tree >= 0 ? destructibleRayDistance() : -1;
  const treeFirst =
    world.scenery.kind === 'walls' && tree >= 0 && (hit < 0 || treeT < BEAM.hitT);
  if (treeFirst) {
    const tx = sceneryX(world.scenery, tree);
    const ty = sceneryY(world.scenery, tree);
    // Through `breakLootIn`, so the wood is spent by exactly the door every other weapon uses - the
    // stem pool, the felling event and the stump all come from one place.
    breakLootIn(world, tx, ty, 0, stats.damage * dt);
    // Drawn to the wood and billing nobody: NO_BEAM_TARGET is what tells updateDamage there is
    // nothing to charge, and the player sees the beam stop where it is actually stopping.
    const stopT = treeT > def.muzzleOffset ? treeT : def.muzzleOffset;
    pushBeam(world.beams, weaponIdx, NO_BEAM_TARGET, 0, x0, y0, px + aim.x * stopT, py + aim.y * stopT);
    heatBeam(world, weaponIdx, inst, stats, dt);
    return;
  }

  // `hit` is whatever the ray touched FIRST, which may not be `target` - that is the design, not
  // a fallback. A beam aimed at a wounded enemy across a crowd burns the crowd.
  //
  // `hit < 0` means the ray reached its full length touching nothing, which needs a live target
  // sitting beyond the ray's own reach to happen at all. The beam draws to full length and bills
  // nobody; the NO_BEAM_TARGET sentinel is what tells updateDamage there is nothing to charge.
  const reach = hit >= 0 ? BEAM.hitT : stats.range;
  const damage = hit >= 0 ? stats.damage * dt : 0;

  // `reach` is measured from the CENTRE while the line is drawn from the MUZZLE, so a contact
  // inside the muzzle offset would otherwise draw a beam pointing backwards out of the emitter.
  // Clamped to the muzzle, a point-blank burn is a stub of light at the barrel - which is exactly
  // what it should look like.
  const endT = reach > def.muzzleOffset ? reach : def.muzzleOffset;

  pushBeam(
    world.beams,
    weaponIdx,
    hit >= 0 ? hit : NO_BEAM_TARGET,
    damage,
    x0,
    y0,
    px + aim.x * endT,
    py + aim.y * endT,
  );

  // A BEAM TAKES DRUMS WITH IT. Barrels are exempt from beam occlusion (they have to be, or the
  // lasers would refuse to fire at one and could never break it), so the sweep happens after the
  // shot instead: whatever the line crossed goes up, and the beam carries on to its target.
  //
  // THE SCRAPYARD ONLY. A drum has no hit points, so a beam passing over one costs the shot nothing
  // and there is nothing to spend; a TREE stops the beam outright and was already dealt with above.
  // Running this on Mossy as well would burn a clump standing BEHIND the body being burned, through
  // a beam that terminates at that body - damage out of nowhere, to a tree the shot never reached.
  if (world.scenery.kind !== 'walls') {
    const drum = destructibleRayHit(world.scenery, px, py, aim.x, aim.y, endT);
    if (drum >= 0) {
      // The beam's damage for THIS TICK, which is what `damage` already is here - a beam is paid per
      // tick, so a laser saws through a clump over a second or two rather than felling one per frame.
      breakLootIn(world, sceneryX(world.scenery, drum), sceneryY(world.scenery, drum), 0, damage);
    }
  }

  // AND IT TAKES SHEEP WITH IT, for the same reason and by the same route. The flock is not in the
  // scenery, so `destructibleRayHit` cannot see it; this is the one extra line that reason costs.
  // The point is handed back to `breakLootIn` rather than the animal being taken here, so the loot
  // it was carrying drops through the one door every other weapon uses.
  const grazing = sheepRayHit(world, px, py, aim.x, aim.y, endT);
  if (grazing >= 0) {
    breakLootIn(world, world.sheep.x[grazing], world.sheep.y[grazing], 0, damage);
  }

  // THE CHAIN. Only a weapon whose ascension has been taken gets here - see WeaponDef.chainsFrom.
  //
  // ROOTED AT THE MECH, AND ONLY THERE. The chain is an extension of the shot the player is
  // already taking: it hangs off the body this beam is burning, which hangs off the muzzle. It is
  // never rooted anywhere else, and if there is no first body there is no chain - a chain has to
  // start at the player or it is a beam that came from nothing.
  const chainsFrom = def.chainsFrom ?? 0;
  if (
    hit >= 0 &&
    (world.enemies.flags[hit] & ENEMY_FLAG_DEAD) === 0 &&
    chainsFrom > 0 &&
    inst.level >= chainsFrom
  ) {
    chainFrom(world, weaponIdx, stats, hit, px, py, aim, endT, damage);
  }

  // Step 6. Heat for the tick, which every path that actually FIRED has to pay - see `heatBeam`.
  heatBeam(world, weaponIdx, inst, stats, dt);
};

/**
 * The heat a tick of beam costs, and the overheat that ends the burst.
 *
 * ONE FUNCTION BECAUSE THERE ARE TWO WAYS TO FIRE. A beam that terminates in a tree is still a beam
 * being fired - it is doing work, and the wood is taking it - so it pays the same heat as one that
 * reaches a body. Extracted the moment the second path existed rather than duplicated, because a
 * copy is how one of them ends up free.
 *
 * The tick that reaches this weapon's OWN capacity still fires: it cuts out AFTER delivering the shot
 * that overloaded it, so a full burst is exactly heatCapacity / heatPerSec seconds of damage and not
 * one tick less. The ceiling is the weapon's, so a capacity tier buys a longer burst rather than a
 * fuller bar.
 */
function heatBeam(
  world: World,
  weaponIdx: number,
  inst: WeaponInstance,
  stats: WeaponStats,
  dt: number,
): void {
  const capacity = stats.heatCapacity;
  const heat = inst.heat + stats.heatPerSec * dt;
  if (heat >= capacity) {
    inst.heat = capacity; // clamped: heat never exceeds this weapon's capacity
    inst.overheated = true;
    pushEvent(world.events, EV_WEAPON_OVERHEATED, world.tick, weaponIdx, capacity, 0, 0);
  } else {
    inst.heat = heat;
  }
}


/**
 * THE CHAIN LASER'S JUMPS. Called after the primary beam has landed, and only for a beam whose
 * tier-8 ascension is held.
 *
 * ---------------------------------------------------------------------------------------------
 * RANGE IS THE BUDGET, AND IT IS SPENT ALONG THE WHOLE BEAM
 * ---------------------------------------------------------------------------------------------
 * The weapon's `range` stops being "how far can it reach" and becomes "how much beam is there".
 * The primary shot spends the distance from the mech to the first body; every jump spends the
 * distance it covers; and the chain stops the moment the nearest body left will not fit in what
 * remains. That is the whole rule, and it is why the ascension requires Targeting Optics - the
 * passive that was buying a longer beam is now buying MORE JUMPS out of the same beam.
 *
 * NEAREST, AND NEVER ONE ALREADY IN THE CHAIN. Nearest keeps the shape legible: the beam visibly
 * walks through a crowd rather than teleporting across one. Excluding the bodies it has already
 * touched is what stops two enemies standing next to each other from bouncing the beam between
 * them forever - and it is a linear scan of a list that is at most MAX_CHAIN_LINKS long, which is
 * cheaper than any set for a list that size.
 *
 * ---------------------------------------------------------------------------------------------
 * EACH LINK IS A WHOLE BEAM, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------------------------
 * A link pushes its own entry into the beam buffer: its own endpoints, its own target, its own
 * damage. So updateDamage bills every body the chain crosses without knowing chains exist, and
 * the renderer draws the whole zig-zag without knowing either. The one thing that had to change
 * for chaining was the SIZE of that buffer.
 *
 * Damage is the same on every link. A falloff would be the conventional choice and is the wrong
 * one here: the beam is already paying for each jump in range, which is a harder currency than a
 * damage multiplier - a chain through five bodies is a chain that found five bodies close enough
 * together, and that is the play being rewarded.
 *
 * NO SCENERY TEST ON A JUMP. The primary shot still refuses to fire into scrap, because that is
 * the mech aiming; a jump is an arc between two bodies and is allowed to cross a wreck. Testing
 * every link would also mean a ray cast per jump per tick, which is the one part of this that
 * would actually cost something.
 */
function chainFrom(
  world: World,
  weaponIdx: number,
  stats: WeaponStats,
  firstHit: number,
  px: number,
  py: number,
  aim: Vec2,
  endT: number,
  damage: number,
): void {
  const p = world.enemies;
  const chain = world.scratch.candidates; // reused as the "already burned" list, MAX_CHAIN_LINKS deep
  chain[0] = firstHit;
  let links = 1;

  // THE FIRST JUMP LEAVES FROM WHERE THE BEAM STOPPED, not from the body's centre. The primary
  // segment is drawn to the ray's contact point - the front of the body - so starting the chain at
  // the centre left a body-radius gap between the two, and a chain that visibly did not join onto
  // the beam feeding it. Measured on a runt that was thirteen units of daylight.
  let cx = px + aim.x * endT;
  let cy = py + aim.y * endT;

  // Range spent so far is the distance the beam has actually travelled from the MECH, which is
  // exactly `endT`. Everything left is the chain's to spend.
  let budget = stats.range - endT;

  while (links < MAX_CHAIN_LINKS && budget > 0) {
    // Nearest live body inside what is left of the beam, skipping everything already burned.
    let best = -1;
    let bestD2 = 0;
    const n = p.count;
    for (let d = 0; d < n; d++) {
      if ((p.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
      let already = false;
      for (let k = 0; k < links; k++) {
        if (chain[k] === d) {
          already = true;
          break;
        }
      }
      if (already) continue;
      const dx = p.x[d] - cx;
      const dy = p.y[d] - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > budget * budget) continue;
      if (best < 0 || d2 < bestD2) {
        best = d;
        bestD2 = d2;
      }
    }
    if (best < 0) return;

    const nx = p.x[best];
    const ny = p.y[best];
    pushBeam(world.beams, weaponIdx, best, damage, cx, cy, nx, ny);

    budget -= Math.sqrt(bestD2);
    chain[links++] = best;
    cx = nx;
    cy = ny;
  }
}

/**
 * THE FIRE-PATTERN TABLE. Adding a pattern is one entry here plus one pure function above.
 */

/**
 * `spread` - the missile racks. N projectiles leaving along the player's LAST MOVEMENT DIRECTION,
 * evenly fanned about it at `spreadAngle` between neighbours.
 *
 * NO TARGET IS CONSULTED. `targets`/`targetCount` are ignored entirely, which is why these weapons
 * declare `requiresTarget: false` and fire into an empty field quite happily. The volley is aimed
 * by the player's feet: the direction you were last moving is the direction the rack points, so
 * running away fires backwards and the choice of where to run becomes the choice of where to shoot.
 *
 * `player.faceX/faceY` is the sim's own unit facing, derived from velocity and HELD when the
 * player stops - so a stationary mech fires the way it last ran rather than the way it happens to
 * be pointing at frame zero.
 *
 * Fan layout is symmetric about the facing: offsets are (i - (n-1)/2) * spreadAngle, so an even
 * volley straddles the centre line and an odd one puts a missile straight down it. Trig runs once
 * per missile per VOLLEY - a few times a second at most - not per tick, so it is not worth
 * precomputing.
 */
export const fireSpread: FirePattern = (world, weaponIdx, inst, _targets, _targetCount): void => {
  const def = world.weaponCatalog[inst.defId] as WeaponDef;
  const stats = inst.stats;
  const projectiles = world.projectiles;
  const player = world.player;

  const count = stats.projectileCount >= 1 ? stats.projectileCount : 1;
  const behaviour = BEHAVIOUR_ID[def.behaviour];

  // Fan centre: the chassis facing for a rack aimed by your feet, otherwise the turret's own aim
  // line. Same pattern, two very different weapons - the missiles spray where you ran, the machine
  // gun straddles what it is looking at.
  const baseX = def.fireAlongFacing ? player.faceX : inst.turretX;
  const baseY = def.fireAlongFacing ? player.faceY : inst.turretY;
  const half = (count - 1) * 0.5;

  // THE GTM HORNET. At tier 8 the long rack's warheads come apart, and the only two things that
  // changes here are the FUSE and a flag: the fuse is cut to the split time so they break up
  // mid-flight rather than at the end of their reach, and the flag tells `expireProjectile` to
  // split rather than to stop. Everything else about the volley is unchanged - same tubes, same
  // fan, same homing.
  const splits = def.splitsFrom !== undefined && def.splitsFrom > 0 && inst.level >= def.splitsFrom;
  const life = splits ? SPLIT_SEC : stats.projectileLifetime;

  for (let i = 0; i < count; i++) {
    const a = (i - half) * stats.spreadAngle;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    // Rotate the facing by the fan offset. Unit in, unit out - no renormalisation needed.
    const dirX = baseX * c - baseY * sn;
    const dirY = baseX * sn + baseY * c;

    // A magazine is spent per ROUND, not per burst, so a two-round weapon empties twice as fast
    // as its shot count suggests. Running dry mid-burst simply ends the burst - the reload is
    // started by updateWeapons on the next tick, not here, so all magazine state changes in one
    // place.
    if (stats.ammoCapacity > 0) {
      if (inst.ammo <= 0) break;
      inst.ammo--;
    }

    const spawnId = ++world.stats.shotsFired;
    const handle = allocProjectile(
      projectiles,
      player.x + dirX * def.muzzleOffset,
      player.y + dirY * def.muzzleOffset,
      dirX * stats.projectileSpeed,
      dirY * stats.projectileSpeed,
      life,
      weaponIdx,
      behaviour,
      spawnId,
    );
    if (handle === NULL_HANDLE) break;

    const d = projectiles.count - 1;
    if (splits) projectiles.flags[d] |= PROJECTILE_FLAG_SPLITS;
    projectiles.damage[d] = stats.damage;
    projectiles.knockback[d] = stats.knockback;
    projectiles.splashRadius[d] = stats.splashRadius;
    projectiles.splashFrac[d] = stats.splashFrac;
    projectiles.radius[d] = def.shellRadius;
    projectiles.pierceLeft[d] = stats.pierce;
    projectiles.visualId[d] = def.visualId;

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
 * `barrage` - Heavy Artillery. Shells fall on random ground near the mech.
 *
 * NOTHING IS AIMED AT. No target is selected, the player's facing is ignored, and enemy positions
 * are never consulted - the strike points are drawn from the weapon RNG stream and land in a fixed
 * annulus about the player. That is the entire character of the weapon: it is weather, and the
 * player's job is to fight underneath it rather than with it.
 *
 * "VISIBLE" WITHOUT KNOWING THE SCREEN. STRIKE_RADIUS_MAX is 210 because the short axis of every
 * supported viewport shows 440 units, so that circle is on screen on any device in any orientation.
 * The simulation therefore never learns the viewport and the camera fairness rule holds - see
 * constants.ts.
 *
 * Shells are spawned AT the impact point with zero velocity, flagged NOCONTACT, and left to their
 * fuse. That reuses the missiles' fuse-detonation path exactly, and it means nothing can set a
 * shell off early: the blast lands where the barrage chose, when the barrage chose.
 *
 * The draw is `sqrt(u)` scaled between the radii rather than a plain uniform, because a uniform
 * radius clusters shells toward the middle - area grows with r^2, so the outer ring is bigger than
 * it looks. Without the sqrt an "even scatter" visibly bunches around the player.
 */
export const fireBarrage: FirePattern = (world, weaponIdx, inst, _targets, _targetCount): void => {
  const def = world.weaponCatalog[inst.defId] as WeaponDef;
  const stats = inst.stats;
  const projectiles = world.projectiles;
  const rng = world.rng.weapon;
  const player = world.player;

  const shells = stats.projectileCount >= 1 ? stats.projectileCount : 1;
  const behaviour = BEHAVIOUR_ID[def.behaviour];
  const rMin = STRIKE_RADIUS_MIN;
  const rSpan = STRIKE_RADIUS_MAX - STRIKE_RADIUS_MIN;

  for (let i = 0; i < shells; i++) {
    const ang = rng.nextFloat() * Math.PI * 2;
    const r = rMin + Math.sqrt(rng.nextFloat()) * rSpan;
    const sx = player.x + Math.cos(ang) * r;
    const sy = player.y + Math.sin(ang) * r;

    const spawnId = ++world.stats.shotsFired;
    const handle = allocProjectile(
      projectiles,
      sx,
      sy,
      0,
      0,
      stats.flightTime > 0 ? stats.flightTime : 0.7,
      weaponIdx,
      behaviour,
      spawnId,
    );
    if (handle === NULL_HANDLE) break;

    const d = projectiles.count - 1;
    projectiles.damage[d] = stats.damage;
    projectiles.knockback[d] = stats.knockback;
    projectiles.splashRadius[d] = stats.splashRadius;
    projectiles.splashFrac[d] = stats.splashFrac;
    projectiles.radius[d] = def.shellRadius;
    projectiles.pierceLeft[d] = 0;
    projectiles.visualId[d] = def.visualId;
    // Inert while it falls. Only the fuse can end it.
    projectiles.flags[d] |= PROJECTILE_FLAG_NOCONTACT;

    // Payload is the impact point; direction is meaningless for a shell that does not travel, so
    // the renderer gets (0,0) and draws a falling marker rather than a rotated sprite.
    pushEvent(world.events, EV_WEAPON_FIRED, world.tick, sx, sy, 0, 0);
  }
};

export const FIRE_PATTERNS: Readonly<Record<FirePatternId, FirePattern>> = Object.freeze({
  battery: fireBattery,
  spread: fireSpread,
  barrage: fireBarrage,
  beam: fireBeam,
  // A drone bay has no volley. Everything it does - the build timer, deploying, and the drones
  // themselves - lives in systems/drones.ts, which runs as its own stage. This entry exists so the
  // pattern table stays exhaustive over FirePatternId rather than being a partial record with a
  // lookup that can return undefined.
  factory: () => {},
});
