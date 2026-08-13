/**
 * WEAPON CONTENT - the `WeaponDef` shape, the three strategy tables, and the catalog itself.
 *
 * THE EXTENSIBILITY CONTRACT (DESIGN.md §5.3), stated as an obligation on future edits:
 *
 *     Adding weapon #2 is a `WeaponDef` literal in WEAPON_CATALOG plus, at most, ONE new pure
 *     function registered in ONE of the three tables below. `updateWeapons` is NEVER edited
 *     again.
 *
 * That is why the tables are string-keyed `Record`s over the id unions rather than `switch`
 * statements: extending `TargetingId` with `'lowest-hp'` becomes a compile error in exactly one
 * place - the `TARGETING` literal - which is the error you want.
 *
 * The functions themselves live next to the system that runs them (targeting.ts, weapons.ts,
 * projectiles.ts) and are re-exported here, so this file is the single import surface for
 * "everything that describes a weapon" while the implementations stay beside their hot loops.
 * The re-exports are runtime edges FROM this module TO the systems; every edge back the other
 * way is `import type` and therefore erased, so there is no import cycle at runtime.
 */

import { degToRad } from '../math/trig.js';
import type { WeaponStatKey } from '../data/stats.js';
import type { World, WeaponInstance } from '../types.js';

// ---------------------------------------------------------------------------------------------
// Id unions. Every one of these grows; none of them is a `string`.
// ---------------------------------------------------------------------------------------------

export type WeaponId = 'cannon' | 'laser-short' | 'laser-medium' | 'laser-long';

/**
 * Target-selection strategies.
 *
 * `'highest-hp'` is the Cannon's specced rule and the identity of this iteration.
 * `'nearest'` is not a demo: SCATTER's Flak Battery trait rewrites shells 2..n to it
 * (DESIGN.md §8.2), and it is what proves the strategy seam actually generalises.
 */
export type TargetingId = 'highest-hp' | 'nearest' | 'lowest-hp'; // grows: | 'densest'

export type FirePatternId = 'battery' | 'beam'; // grows: | 'spread' | 'burst'

export type BehaviourId = 'straight'; // grows: | 'homing' | 'arc'

/**
 * BehaviourId -> index into PROJECTILE_BEHAVIOURS, which is what the pool stores (a Uint8Array).
 * Indices are part of the determinism key: they are written into ProjectilePool.behaviour and
 * therefore into every replay hash. APPEND ONLY - never renumber.
 */
export const BEHAVIOUR_STRAIGHT = 0;

export const BEHAVIOUR_ID: Readonly<Record<BehaviourId, number>> = Object.freeze({
  straight: BEHAVIOUR_STRAIGHT,
});

// ---------------------------------------------------------------------------------------------
// WeaponDef
// ---------------------------------------------------------------------------------------------

/**
 * PROJECTILE weapons spawn shells on a cooldown. BEAM weapons are hitscan: they fire every tick
 * they are allowed to, apply damage continuously, and are limited by HEAT rather than a cooldown.
 *
 * This is the one place the two modalities are distinguished, and it is a `kind` tag rather than
 * a fourth strategy table because the difference is not "how do I pick a target" or "what shape is
 * the volley" - it is whether a shot is an OBJECT or an EVENT. Everything downstream of that
 * differs: allocation, damage timing, what the renderer draws, and what limits the rate of fire.
 */
export type WeaponKind = 'projectile' | 'beam';

export interface WeaponDef {
  readonly id: WeaponId;
  readonly name: string;
  readonly kind: WeaponKind;
  readonly targeting: TargetingId;
  readonly pattern: FirePatternId;
  readonly behaviour: BehaviourId;
  /**
   * Cannon: true - no target in range means no shot AND no cooldown consumed.
   * A weapon with `false` fires down the turret's current facing when the target set is empty,
   * which is the extension point for a future always-on beam or flak burst.
   */
  readonly requiresTarget: boolean;
  /** Exhaustive - the `Record` type forces every WeaponStatKey to be present. */
  readonly base: Readonly<Record<WeaponStatKey, number>>;
  /** perLevel[i] applies at weapon level i + 2. Sparse: absent keys are unchanged. */
  readonly perLevel: readonly Readonly<Partial<Record<WeaponStatKey, number>>>[];
  /**
   * Damage factor for surplus multishot shells that re-engage an already-targeted enemy.
   * This is what makes Twin Mount a BATTERY (spread across the top-K) rather than a flat damage
   * multiplier: the 4th shell into a lone elite is worth 0.55, not 1.0.
   */
  readonly reengageMul: number;
  /**
   * Render-side shell sprite selector. 0 is the atlas frame `shell`
   * (space-shooter-extension spaceMissiles_012, 16x22, grey body / red nose).
   * Sim-owned rather than render-owned so it lands in the replay and the harness can print it.
   */
  readonly visualId: number;
  /** Muzzle offset along the shell's own direction, world units. */
  readonly muzzleOffset: number;
  /**
   * Collision radius of the shell, world units. Not a WeaponStatKey: nothing upgrades it, and
   * making it moddable would let `range`-style stacking silently turn a shell into a beam.
   */
  readonly shellRadius: number;

  // ---- beam weapons only ----
  /**
   * Beam colour, 0xRRGGBB. Sim-owned rather than render-owned for the same reason `visualId` is:
   * it lands in the replay, and the harness can name the laser that killed you.
   */
  readonly beamColour: number;
  /** Drawn beam half-width, world units. Purely cosmetic; the beam's HIT test is a ray. */
  readonly beamWidth: number;
  /**
   * When true the weapon fires ONLY if its chosen target is the first thing the ray touches.
   * A body in the way means no shot at all - not a shot into the body.
   *
   * This is what gives the lasers their character. The Cannon lobs a shell at the biggest thing
   * on the field and does not care what is between; a laser needs a CLEAN LINE to the weakest
   * thing on the field, so it goes quiet exactly when the horde closes up. The two weapons want
   * you standing in different places, which is the whole point of having both.
   */
  readonly requiresClearLine: boolean;
}

// ---------------------------------------------------------------------------------------------
// Strategy function types. All three MUST be pure and allocation-free.
// ---------------------------------------------------------------------------------------------

/**
 * Fills `out` with up to `wantCount` target DENSE indices, BEST FIRST, and returns the count.
 *
 * Contract for every implementation:
 *   - query the spatial hash; NEVER `for (d = 0; d < enemies.count; d++)`;
 *   - skip enemies carrying ENEMY_FLAG_DEAD (deferred reaping leaves corpses in the hash until
 *     S12, and a corpse must never absorb a 1.2 s cooldown);
 *   - impose a STRICT TOTAL order, so the result cannot depend on candidate visit order;
 *   - allocate nothing.
 */
export type TargetingFn = (
  world: World,
  originX: number,
  originY: number,
  rangeSq: number,
  wantCount: number,
  out: Int32Array,
) => number;

/** Spawns the shells for one volley. The ONLY projectile allocation site in the game. */
export type FirePattern = (
  world: World,
  weaponIdx: number,
  inst: WeaponInstance,
  targets: Readonly<Int32Array>,
  targetCount: number,
) => void;

/**
 * Integrates every projectile whose `behaviour` byte equals `behaviourId`.
 *
 * PER BEHAVIOUR, NOT PER PROJECTILE. A function-pointer call per projectile per tick is a
 * megamorphic call site ~200x per tick; this way updateProjectiles calls each behaviour once and
 * the behaviour filters with `if (p.behaviour[d] !== behaviourId) continue`. That is ~1 000
 * perfectly-predicted branches per tick - nothing - and the inner loop stays monomorphic and
 * inlinable, which is what actually decides frame time.
 */
export type ProjectileBehaviour = (world: World, behaviourId: number, dt: number) => void;

// The three strategy tables (TARGETING, FIRE_PATTERNS, PROJECTILE_BEHAVIOURS) live beside their
// hot loops in systems/. They are deliberately NOT re-exported from here.
//
// They used to be, as a convenience, and it deadlocked module initialisation: this file is data,
// systems/projectiles.ts imports BEHAVIOUR_STRAIGHT from it, and re-exporting projectiles.ts back
// out closed the cycle. Under ESM that is a temporal dead zone, not a warning - the sim crashed on
// boot with "Cannot access 'BEHAVIOUR_STRAIGHT' before initialization" while typechecking clean.
//
// The rule that prevents a repeat: content/ and data/ describe WHAT things are and may never
// import from systems/, which decides what things DO. Import the tables from their own modules.

// ---------------------------------------------------------------------------------------------
// The Cannon (DESIGN.md §7.3)
//
// Character, in one line: MEDIUM RANGE, LOW FIRE RATE, GOOD DAMAGE, and it shoots the biggest
// thing in range rather than the closest. Every number below serves that.
// ---------------------------------------------------------------------------------------------

/**
 * 220 deg/s = 3.839724354387525 rad/s.
 *
 * Chosen against the cooldown, not by feel: 220 deg/s sweeps 264 deg during one 1.2 s cooldown
 * against a 180 deg worst-case re-lay, so the turret is essentially always laid on when the
 * cooldown expires. That is what makes hold-fire cost nothing and makes a target lock
 * unnecessary (DESIGN.md §0, "biggest design call").
 *
 * `degToRad` is a single exactly-rounded multiply, evaluated once at module init - not a trig
 * call, and not in a loop.
 */
const CANNON_TURRET_TRAVERSE = degToRad(220);

/**
 * 12 deg. A PERMISSION gate, not a dispersion cone: within this arc the weapon is allowed to
 * fire, and the shell then flies exactly at its target. There is no spread anywhere in this
 * game - "the number on screen is always the number" (DESIGN.md §7.3) applies to accuracy too.
 */
const CANNON_FIRE_ARC = degToRad(12);

export const CANNON: WeaponDef = Object.freeze({
  id: 'cannon',
  name: 'Cannon',
  kind: 'projectile',
  targeting: 'highest-hp',
  pattern: 'battery',
  behaviour: 'straight',
  requiresTarget: true,
  base: Object.freeze({
    damage: 44, // no variance, no crit
    cooldown: 1.2, // 0.833 shots/s - the whole pace of the game is this number
    range: 260, // 59% of the visible width at VIEW_MINOR_UNITS 440
    projectileSpeed: 520, // 0.5 s to max range: plainly visible flight, and leadable by enemies
    projectileCount: 1,
    pierce: 0,
    knockback: 190, // applied as impulse/mass: swarmer 380 u/s, elite 27, boss immune
    splashRadius: 54,
    // 0.62 -> 27 splash damage, which EXCEEDS a 20 HP swarmer. That single threshold is what
    // makes the highest-HP targeting rule a feature rather than a trap: aim at the bruiser in the
    // middle of the crowd and the blast clears the crowd. Below the swarmer's HP, the same rule
    // just pours your whole output into something you cannot kill while the swarm eats you.
    splashFrac: 0.62,
    turretTraverse: CANNON_TURRET_TRAVERSE,
    fireArc: CANNON_FIRE_ARC,
    heatPerSec: 0, // projectile weapons never heat
  }),
  // Weapon levels are not in this iteration (there is no weapon-level-up path yet); the array is
  // present and empty so `resolveWeaponStats` has nothing to special-case when they arrive.
  perLevel: Object.freeze([]),
  reengageMul: 0.55,
  visualId: 0,
  muzzleOffset: 30, // barrel tip, not chassis centre
  shellRadius: 9, // drawn ~18 u
  beamColour: 0,
  beamWidth: 0,
  requiresClearLine: false,
});

// ---------------------------------------------------------------------------------------------
// The lasers
//
// Three weapons, one mechanic, three tempos. Each targets the WEAKEST enemy in range, draws a line
// that stops on the first body it touches, and will not fire at all unless that body is the target.
//
// HEAT replaces the cooldown. Every laser heats and cools at the same rate as itself, so all three
// share identical RATIOS and differ only in tempo:
//
//              heat/s   opening burst   later bursts   gap      damage/s   range
//   short        10         10.0 s          5.0 s      5.0 s        30       150
//   medium       20          5.0 s          2.5 s      2.5 s        55       275
//   long         30          3.3 s          1.7 s      1.7 s        85       430
//
// The opening burst is twice as long as the rest because it climbs from cold (0 -> 100) while
// every later one restarts at HEAT_RESUME (50 -> 100). Sustained uptime is therefore 1/2, not the
// 2/3 the first burst suggests - see constants.ts. Effective sustained damage is half the listed
// figure - 15 / 27.5 / 42.5 - against the Cannon's 36.7 single target.
//
// So the short laser is a floodlight you leave on, and the long one is a held breath. Only the
// long laser out-damages the Cannon on sustained single-target numbers, and it pays for that by
// refusing blocked shots and by picking the WEAKEST thing on the field rather than the most
// dangerous one.
// ---------------------------------------------------------------------------------------------

/**
 * Lasers slew fast and fire wide. They are emitters on a gimbal, not a turret with a barrel to
 * heave around: the interesting gate on a laser is the CLEAR LINE, so making you also wait on
 * traverse would be two gates doing one job and would read as unresponsiveness.
 */
const LASER_TRAVERSE = degToRad(720);
const LASER_FIRE_ARC = degToRad(30);

function laser(
  id: WeaponId,
  name: string,
  range: number,
  damagePerSec: number,
  heatPerSec: number,
  beamColour: number,
  beamWidth: number,
): WeaponDef {
  return Object.freeze({
    id,
    name,
    kind: 'beam' as WeaponKind,
    targeting: 'lowest-hp' as TargetingId,
    pattern: 'beam' as FirePatternId,
    behaviour: 'straight' as BehaviourId, // unused by beams; no projectile is ever spawned
    requiresTarget: true,
    base: Object.freeze({
      // DAMAGE IS PER SECOND for a beam, not per shot. updateWeapons multiplies by dt.
      damage: damagePerSec,
      cooldown: 0, // unused: heat is the limiter and the beam fires every tick it is allowed to
      range,
      projectileSpeed: 0,
      projectileCount: 1,
      pierce: 0,
      // A continuous beam applying knockback every tick would launch a swarmer into orbit.
      knockback: 0,
      splashRadius: 0,
      splashFrac: 0,
      turretTraverse: LASER_TRAVERSE,
      fireArc: LASER_FIRE_ARC,
      heatPerSec,
    }),
    perLevel: Object.freeze([]),
    reengageMul: 1,
    visualId: 0,
    muzzleOffset: 22,
    shellRadius: 0,
    beamColour,
    beamWidth,
    requiresClearLine: true,
  }) as WeaponDef;
}

export const LASER_SHORT = laser('laser-short', 'Short Laser', 150, 30, 10, 0x3be86b, 1.6);
export const LASER_MEDIUM = laser('laser-medium', 'Medium Laser', 275, 55, 20, 0x4fa8ff, 2.1);
export const LASER_LONG = laser('laser-long', 'Long Laser', 430, 85, 30, 0xff4d4d, 2.7);

/**
 * Index in this array is `WeaponInstance.defId` and is written into every replay. APPEND ONLY.
 */
export const WEAPON_CATALOG: readonly WeaponDef[] = Object.freeze([
  CANNON,
  LASER_SHORT,
  LASER_MEDIUM,
  LASER_LONG,
]);

/** Catalog index for a weapon id, or -1. Used at run start to install the hero's starting weapon. */
export function weaponDefIndex(id: WeaponId): number {
  for (let i = 0; i < WEAPON_CATALOG.length; i++) {
    if (WEAPON_CATALOG[i].id === id) return i;
  }
  return -1;
}
