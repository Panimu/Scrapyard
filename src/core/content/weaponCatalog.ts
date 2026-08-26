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

import { HEAT_CAPACITY_BASE, STRIKE_RADIUS_MAX } from '../constants.js';
// TYPE-ONLY BOTH WAYS BUT ONE: upgrades.ts imports `WeaponId` from here as a type, which is
// erased, so this runtime import does not close a cycle.
import { WEAPON_ASCENDED_TIER } from '../data/upgrades.js';
import { degToRad } from '../math/trig.js';
import type { WeaponStatKey } from '../data/stats.js';
import type { World, WeaponInstance } from '../types.js';

// ---------------------------------------------------------------------------------------------
// Id unions. Every one of these grows; none of them is a `string`.
// ---------------------------------------------------------------------------------------------

export type WeaponId =
  | 'cannon'
  | 'laser-short'
  | 'laser-medium'
  | 'laser-long'
  | 'missile-short'
  | 'missile-long'
  | 'machine-gun'
  | 'flak-cannon'
  | 'artillery'
  | 'drone'
  | 'phase-cannon'
  | 'mortar'
  | 'plasma'
  | 'sludge';

/**
 * WHAT A PROJECTILE LOOKS LIKE. Named rather than numbered at the use site, because a bare `3` in
 * a weapon def says nothing and these are read far more often than they are written.
 *
 * They are stable IDENTIFIERS, not indices into anything: `visualId` is copied onto every
 * projectile and lands in the replay, so the numbers must not be reshuffled to keep them tidy.
 *
 * The two missile racks are separate entries even though they share one source texture. The
 * renderer draws that texture at different proportions for each - short squat and fat, long
 * longer and thinner - which is a render decision, but WHICH rack fired is sim data and has to
 * travel on the projectile to survive a rack levelling behind a volley already in the air.
 */
export const VIS_SHELL = 0;
export const VIS_MISSILE_SHORT = 1;
export const VIS_SLUG = 2;
/** Artillery: no shell at all. A red targeting ring on the ground, counting its own fuse down. */
export const VIS_STRIKE_MARKER = 3;
export const VIS_MISSILE_LONG = 4;
// A drone's round has NO VIS_ ID OF ITS OWN. It fires the Machine Gun, so it draws the Machine
// Gun's slug - one at a time rather than the gun's pair, which is the fire pattern and not the
// sprite. Id 5 was a drone-specific entry that fell through the renderer's chain to the CANNON's
// shell, so a drone appeared to be lobbing artillery. The number is retired rather than reused:
// visualId lands in the replay, and 5 has already been written into recorded runs.
/** The Phase Cannon's bolt: a blue plasma ball. 6, because 5 is retired - see above. */
export const VIS_PLASMA = 6;
/** The Plasma Thrower's bolt: a slow gout of fire. */
export const VIS_FLAME = 7;
/** Toxic Sludge's glob, and the pool it leaves. */
export const VIS_SLUDGE = 8;

/**
 * Target-selection strategies.
 *
 * `'highest-hp'` is the Cannon's specced rule and the identity of this iteration.
 * `'nearest'` is not a demo: SCATTER's Flak Battery trait rewrites shells 2..n to it
 * (DESIGN.md §8.2), and it is what proves the strategy seam actually generalises.
 * `'densest'` is the Phase Cannon's: the body with the most neighbours packed around it -
 * and, uniquely, it does NOT filter for line of sight, because its round phases through
 * whatever is in the way. See `targetDensest` in systems/targeting.ts.
 */
export type TargetingId =
  | 'highest-hp'
  | 'nearest'
  | 'lowest-hp'
  | 'densest'
  | 'cone-densest'
  | 'cone-coldest'
  | 'rear-cone';

export type FirePatternId =
  | 'sludge'
  | 'battery'
  | 'beam'
  | 'spread'
  | 'barrage'
  | 'factory'
  | 'phase'
  | 'cone';

export type BehaviourId = 'straight' | 'homing' | 'phase'; // grows: | 'arc'

/**
 * BehaviourId -> index into PROJECTILE_BEHAVIOURS, which is what the pool stores (a Uint8Array).
 * Indices are part of the determinism key: they are written into ProjectilePool.behaviour and
 * therefore into every replay hash. APPEND ONLY - never renumber.
 */
export const BEHAVIOUR_STRAIGHT = 0;
export const BEHAVIOUR_HOMING = 1;
export const BEHAVIOUR_PHASE = 2;

export const BEHAVIOUR_ID: Readonly<Record<BehaviourId, number>> = Object.freeze({
  straight: BEHAVIOUR_STRAIGHT,
  homing: BEHAVIOUR_HOMING,
  phase: BEHAVIOUR_PHASE,
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
   * Render-side shell selector - one of the VIS_* constants below. Sim-owned rather than
   * render-owned so it lands in the replay and the harness can print it, and copied onto each
   * projectile at spawn so a round already in flight keeps its look if the gun behind it levels.
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
   * Tier at which this beam starts CHAINING. Absent on everything that never does, which is every
   * weapon but one - hence optional rather than a `0` that seven definitions would have to carry.
   *
   * A TIER RATHER THAN A BOOLEAN, because the chain is a tier-8 ascension and the same WeaponDef
   * is the weapon at every tier: the Medium Laser and the Chain Laser are one entry, and this is
   * the line where they differ. Comparing it against the instance's level keeps that difference in
   * the catalog instead of putting a "which weapon am I now" branch in the firing code.
   */
  readonly chainsFrom?: number;
  /**
   * Tier at which this weapon's shells SPLIT at the end of their fuse instead of ending, or 0 for
   * a weapon that never does. The GTM Hornet - the Long Missiles' tier 8 - and nothing else.
   *
   * A TIER RATHER THAN A BOOLEAN, and on the WeaponDef rather than the Ascension, for the same
   * reason `chainsFrom` is both: an ascension is the SAME WeaponDef at level 8, so the thing that
   * changes has to be expressible as a function of the level. `fireSpread` reads it once per
   * volley; nothing has to know the word "ascension".
   */
  readonly splitsFrom?: number;
  /**
   * Tier at which this weapon fires a TWIN VOLLEY - two parallel shells straddling the aim line -
   * instead of its ordinary battery, or absent for a weapon that never does. The Twin Mount (the
   * Cannon's tier 8) and nothing else.
   *
   * A TIER RATHER THAN A BOOLEAN, on the WeaponDef, for exactly the reason `chainsFrom` and
   * `splitsFrom` are: an ascension is the SAME WeaponDef at level 8, so the thing that changes
   * must be expressible as a function of the level. `fireBattery` reads it once per volley;
   * nothing has to know the word "ascension".
   *
   * THE PAIR IS AIMED AS ITS MIDPOINT AND NEVER CONVERGES. Both shells fly the target's exact
   * bearing, offset TWIN_HALF_GAP either side of it, each a full-damage shell with its own pierce
   * and its own hit record - so a wide body centred on the line takes both, and a runt slightly
   * off it catches exactly the near one. No convergence is the design: converging shells would
   * collapse back into one big shell with extra steps.
   */
  readonly twinFrom?: number;
  /**
   * Tier at which this beam goes GIGA - the Long Laser's tier 8 - or absent for a beam that never
   * does. A tier rather than a boolean, on the WeaponDef, for exactly the reason the other three
   * ascension fields are: the ascension is the SAME WeaponDef at level 8.
   *
   * What the tier switches on, all in one place because each piece lives in a different system:
   *
   *   TARGETING swaps to `densest` - the Phase Cannon's rule - so the beam aims where the crowd
   *   is thickest rather than at the weakest straggler (updateWeapons).
   *   THE BEAM BECOMES A SWATH: it runs its FULL RANGE through everything - scrap, trees, drums,
   *   bodies - and damages every enemy inside its half-width instead of stopping on the first
   *   (fireGiga). The hold-fire-for-scrap rule does not apply; nothing occludes it.
   *   THE HALF-WIDTH IS `splashRadius`, granted by the tier-8 rung below - which is what makes
   *   "it gets wider with AoE effects" true by construction: Shaped Charges and a chassis blast
   *   bonus multiply splashRadius, so they widen this beam through the same key that widens a
   *   barrage, with no giga-specific branch anywhere in the stats.
   *   THE NOSE HARDPOINT IS ITS BY RIGHT - see laserHardpoint. Other beams move to the shoulders.
   *   +100% HEAT CAPACITY, also on the tier-8 rung: the burst is twice as long, the mechanic
   *   (and the gap after it) unchanged.
   */
  readonly gigaFrom?: number;
  /**
   * Tier at which this weapon POPULATES EVERY FREE LASER HARDPOINT with copies of itself - the
   * Short Laser's tier 8, the Hydra - or absent for a weapon that never does.
   *
   * THE ONLY ASCENSION THAT CHANGES THE LOADOUT RATHER THAN THE WEAPON. Every other one rewrites
   * what a gun does: the beam jumps, the shell doubles, the warhead splits, the beam widens. This
   * one leaves the Short Laser exactly as it was and gives you four more of it - so the thing that
   * got better is the MECH, and the emitters that were bare mounting points are now guns.
   *
   * COPIES ARE REAL WEAPONS IN REAL SLOTS, not one weapon drawn five times. Each takes its own
   * hardpoint (laserHardpoint assigns by slot), each picks its own target under the beam-claim
   * rule that stops two lasers burning one body, and each carries its own heat. Five short lasers
   * are five duty cycles running out of step, which is the whole texture of the thing: the Short
   * Laser has the best uptime in the game and five of them are very nearly continuous.
   *
   * AT THE SAME TIER AS THE ORIGINAL, which is tier 8 and therefore terminal - no card can offer
   * a ninth. So "they share the original's stats" needs no upkeep: they are resolved from the same
   * def at the same level with the same passives, every time anything re-resolves.
   *
   * IT IS A TIER RATHER THAN A BOOLEAN for the reason the other four ascension fields are: an
   * ascension is the SAME WeaponDef at level 8, so what changes has to be a function of the level.
   * Unlike the others this one is read at the moment the tier LANDS (progression's applyChoice)
   * rather than every time the weapon fires - filling the mounts is an event, not a behaviour -
   * and it is also read as a question ("is the Hydra held?") by the deck and the HUD.
   */
  readonly fillsMountsFrom?: number;
  /**
   * WEAPONS THAT CANNOT SHARE THE CHASSIS WITH THIS ONE. Absent on everything that fits beside
   * anything, which is every gun but the two that share a mount.
   *
   * The Flak Cannon bolts onto the SAME rotary mount the Machine Gun uses - one snout, drawn from
   * one sprite (render's TURRET_ART) - so a loadout holding both would be two guns claiming one
   * piece of hardware and one barrel visibly firing for both. They are also the same IDEA at two
   * ranges, and a deck that offered both would routinely spend two of five weapon slots on it.
   *
   * DECLARED ONCE, ENFORCED BOTH WAYS. `isOfferable` asks whether THIS card's gun excludes
   * anything held AND whether anything held excludes this card's gun, so the pair needs only one
   * of the two defs to name the other. A `excludes` on each would be two facts that can drift
   * apart, and the drift would be silent: the deck would simply start offering the pair in one
   * order and not the other.
   *
   * IT IS A FACT ABOUT THE HARDWARE, so it lives on the weapon rather than on the upgrade card -
   * the card is how you get the gun, not what the gun is bolted to.
   */
  readonly excludes?: readonly WeaponId[];

  /**
   * WHAT THIS GUN SETS ALIGHT, or absent for the ten guns that set nothing alight.
   *
   * OPTIONAL, LIKE `excludes`, AND FOR THE SAME REASON: burning is one weapon's mechanic, and two
   * more fields on `base` would have meant writing `burnDps: 0` into every def in the file to say
   * nothing. A `burn` that is present IS the "this ignites" flag; there is no separate boolean to
   * fall out of step with it.
   *
   * `dpsFrac` IS A FRACTION OF THE HIT, NOT A NUMBER OF ITS OWN. A damage tier therefore raises
   * the fire it starts, and so does a chassis bonus, without either of them naming fire - which
   * is what the card means by "raise damage" on a gun whose damage is mostly the burn. An
   * absolute burn rate here would have made every damage tier a smaller and smaller share of the
   * gun's output until tier 7 barely moved it.
   */
  readonly burn?: Readonly<{ dpsFrac: number; seconds: number }>;

  /**
   * WHAT THIS GUN LEAVES ON THE FLOOR, or absent for the twelve guns that leave nothing.
   *
   * Optional for the reason `burn` is, and shaped the same on purpose: `dpsFrac` is a fraction of
   * the round's own damage, so one damage dial moves the gun and the ground together. The pool's
   * SIZE is not here - it is `splashRadius`, which the tier ladder and a chassis bonus already
   * know how to move.
   */
  readonly puddle?: Readonly<{ dpsFrac: number; seconds: number }>;
  // ---- fused weapons (missiles) ----
  /**
   * Fire along the player's LAST MOVEMENT DIRECTION rather than at a target.
   *
   * This is the missiles' defining property and it inverts how the weapon plays. Every other gun
   * here aims itself while you concentrate on not dying; a missile rack fires where you are
   * FACING, so the direction you run becomes an aiming decision. It also means the weapon works
   * with no enemy in range at all - `requiresTarget` is false - and that a player kiting backwards
   * is firing backwards.
   */
  readonly fireAlongFacing: boolean;
  // `drivesTurret` USED TO LIVE HERE and is gone rather than set to false anywhere - a config
  // nobody reads is a config that rots (the same rule that removed `requiresClearLine`). The
  // drawn turrets are now a fixed stack of three, keyed by weapon ID in the renderer's own
  // TURRET_ART table (render/gameRenderer.ts): the Cannon, the Phase Cannon and the Machine Gun
  // each show their own mount while held, and nothing else draws one - every other weapon's
  // hardware is baked into the chassis art or is not on the mech at all.
  /**
   * Detonate for splash when the fuse runs out, not only on contact. Only the artillery sets it:
   * its shells are spawned NOCONTACT with no velocity, so the fuse is the ONLY way they can ever
   * do anything. `expireProjectile` additionally requires `splashRadius > 0`, so a weapon with no
   * blast cannot detonate a blast of nothing.
   */
  readonly detonateOnExpiry: boolean;
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
  /**
   * THE TURRET'S OWN FACING, as a unit vector - not the player's, and not the direction of
   * travel.
   *
   * Every rule in the table today ignores it, and TypeScript lets them: a function declaring
   * fewer parameters satisfies a type declaring more, so none of the four needed editing to
   * accept this. It is here for the rules that CANNOT be written without it - a cone in front of
   * the barrel is a question about where the barrel is pointing, and the only alternative is
   * handing every rule the whole weapon instance and letting each decide what it may read.
   *
   * A weapon with no turret passes its own idle facing; nothing is ever asked to aim from a
   * direction that does not exist.
   */
  aimX: number,
  aimY: number,
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
 * 81 deg/s now (see the trim note below), originally DOWN FROM 220 to 90.
 *
 * THE OLD NUMBER WAS CHOSEN SO THE TURRET WAS ALWAYS LAID ON: 220 deg/s sweeps 278 deg during a
 * 1.263 s cooldown against a 180 deg worst-case re-lay, so switching targets cost the Cannon
 * nothing and it fired on essentially every cooldown expiry. That is most of why a single-target
 * gun with no splash, no heat and no magazine sat at the top of the damage table - measured with
 * every weapon in the game held at tier 7, it took 18.9% of a run's damage against a four-way
 * cluster at 14.2%.
 *
 * At 90 deg/s the sweep was 114 deg per cooldown at tier 1 and 80 deg at tier 7, against that
 * same 180 deg worst case. So the gun now HAS TO TRACK, and it loses shots exactly when the horde
 * is spread around the mech rather than in front of it - a situational cost rather than a flat
 * one, and one that grows as its own fire-rate tiers land.
 *
 * TRIMMED A FURTHER 10% (90 -> 81 deg/s): 102 deg per cooldown at tier 1, 72 at tier 7. Same
 * lever, one more notch - the Machine Gun's mount was slowed by the same tenth in the same pass.
 *
 * WHAT THIS DOES NOT CHANGE: hold-fire still does not reset the cooldown, and a target lock is
 * still wrong - it would contradict the specced highest-HP rule (DESIGN.md §0, "biggest design
 * call"). What has changed is that hold-fire is no longer free, which is the point of it.
 *
 * The visible swing is also the READABILITY mechanism for the whole highest-HP rule, and a slower
 * one shows the decision for longer.
 *
 * `degToRad` is a single exactly-rounded multiply, evaluated once at module init - not a trig
 * call, and not in a loop.
 */
const CANNON_TURRET_TRAVERSE = degToRad(81);

/**
 * 12 deg. A PERMISSION gate, not a dispersion cone: within this arc the weapon is allowed to
 * fire, and the shell then flies exactly at its target. There is no spread anywhere in this
 * game - "the number on screen is always the number" (DESIGN.md §7.3) applies to accuracy too.
 */
const CANNON_FIRE_ARC = degToRad(12);

/**
 * THE CANNON'S PACE, and its two rate tiers expressed as a FRACTION OF IT rather than as a
 * number of seconds.
 *
 * The tiers used to be a flat -0.18 s each, which was 15% of the 1.2 s cooldown they were
 * authored against. Flat deltas do not survive a change to the base: trimming the base by 5%
 * left those two rungs subtracting the same 0.18 s from a bigger number, so the finished gun
 * lost 7% of its rate where the fresh one lost 5%. Deriving them keeps the LADDER'S SHAPE fixed
 * - tier 7 is 0.70x the base cooldown, exactly as it always was - whatever the base becomes.
 */
const CANNON_COOLDOWN = 1.263;
const CANNON_RATE_TIER_FRAC = 0.15;
const CANNON_RATE_TIER = -CANNON_COOLDOWN * CANNON_RATE_TIER_FRAC;

/**
 * Half the distance between the Twin Mount's pair, perpendicular to the aim - each shell flies
 * TWIN_HALF_GAP off the line, 16 u apart in total.
 *
 * Sized so a body CENTRED on the aim line takes both shells whatever its class: the smallest
 * enemy (runt, radius 13) plus the shell's own 9 still comfortably covers an 8 u offset. What the
 * gap actually buys is the miss the midpoint rule allows - a body far enough OFF the line catches
 * one shell instead of two, so aiming the pair well is worth something and the second barrel is
 * not a flat x2.
 */
export const TWIN_HALF_GAP = 8;

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
    cooldown: CANNON_COOLDOWN, // 0.792 shots/s - the whole pace of the game is this number
    range: 247, // 56% of the visible width at VIEW_MINOR_UNITS 440
    projectileSpeed: 520, // 0.5 s to max range: plainly visible flight, and leadable by enemies
    projectileCount: 1,
    pierce: 0,
    knockback: 190, // applied as impulse/mass: runt 380 u/s, elite 27, boss immune
    // NO SPLASH. The Cannon is a single heavy shell into a single body, and that is the whole
    // weapon: it commits to the highest-HP enemy in range and pays for that commitment by
    // ignoring everything else on the field. It used to carry a 54 u blast at 0.62, sized so 27
    // splash exceeded a 20 HP runt - which quietly made the "shoots the biggest thing" rule
    // free, because the chaff died anyway. Without it the rule has teeth, and the answer to a
    // crowd is a different weapon rather than a bigger number on this one.
    //
    // Its ONLY multi-target tool is the pierce tier at T7, which is earned rather than baseline.
    splashRadius: 0,
    splashFrac: 0,
    turretTraverse: CANNON_TURRET_TRAVERSE,
    fireArc: CANNON_FIRE_ARC,
    heatPerSec: 0, // projectile weapons never heat
    heatCapacity: HEAT_CAPACITY_BASE,
    heatDispersion: 0,
    turnRate: 0, // flies straight
    spreadAngle: 0,
    flightTime: 0, // reach is range / speed, not a fuse
    ammoCapacity: 0, // no magazine: the cooldown is the whole limiter
    reloadTime: 0,
  }),
  /**
   * TIERS 2-7. Index i applies at tier i+2, cumulatively. Deltas are ADDITIVE.
   *
   *   2 range   3 rate of fire   4 damage   5 range   6 rate of fire   7 pierce
   *
   * Range first because it is the tier you feel without aiming differently, and pierce last
   * because it changes what the gun IS - one shell through two bodies rewrites the Cannon's
   * relationship with the swarm it otherwise ignores.
   */
  perLevel: Object.freeze([
    { range: 62 }, // T2  247 -> 309
    { cooldown: CANNON_RATE_TIER }, // T3  1.263 -> 1.0736 s  (-15% of base)
    { damage: 18 }, // T4  44 -> 62
    { range: 62 }, // T5  309 -> 371
    { cooldown: CANNON_RATE_TIER }, // T6  1.0736 -> 0.8841 s  (0.70x base, as always)
    { pierce: 1 }, // T7  punches through one body
    // T8 - THE TWIN MOUNT, and it carries no stats at all, exactly like the Chain Laser's rung:
    // the tier is bought with the MECHANIC it switches on (see `twinFrom` below - the volley
    // becomes two full parallel shells), and paying a stat rung on top would make the capstone
    // read as a bonus stapled to a stat card.
    {}, // T8
  ]),
  // ONE BARREL, TWO GUNS THAT COULD BOLT TO IT. Declared HERE and nowhere else - the check runs
  // both directions, so naming the Mortar from this side is the whole fact. See the Flak Cannon's
  // own note, and WeaponDef.excludes.
  //
  // They are also the same IDEA aimed differently: one heavy shell from a long barrel, at the
  // biggest thing in range or at the thickest part of the crowd. A deck that offered both would
  // routinely spend two of five weapon slots on that one idea.
  excludes: Object.freeze(['mortar'] as const),
  // The second barrel comes back at tier 8 - see WeaponDef.twinFrom and TWIN_HALF_GAP.
  twinFrom: WEAPON_ASCENDED_TIER,
  reengageMul: 0.55,
  visualId: VIS_SHELL,
  muzzleOffset: 30, // barrel tip, not chassis centre
  shellRadius: 9, // drawn ~18 u
  beamColour: 0,
  beamWidth: 0,
  fireAlongFacing: false,
  detonateOnExpiry: false,
});

// ---------------------------------------------------------------------------------------------
// The lasers
//
// Three weapons, one mechanic, three tempos. Each AIMS at the weakest enemy in range and draws a
// line that stops on - and burns - the first body it touches. Aim and impact are therefore two
// different things: the weakest enemy decides where the beam points, and whatever is standing in
// front of it takes the damage.
//
// THE BEAM USED TO REFUSE A BLOCKED SHOT ENTIRELY. That read well on paper and measured terribly:
// lowest-HP targeting over a 430 u disc almost always picks something buried behind another body,
// so a stationary Long Laser fired 1.8% of the time and delivered 1.6 dps against a table figure
// of 17.5. A weapon that goes quiet exactly when the horde closes up is not a trade-off when the
// horde is the game.
//
// HEAT replaces the cooldown. All three share one mechanic and differ in TEMPO. Every figure
// here is TIER 1, and every one of them is derived from the four numbers in the constructor
// calls below - if you edit those, `npm run dps` recomputes this table and this comment does not.
//
//            range  dmg/s  heat/s  disp/s   burst from cold   steady burst   gap    uptime  sustained
//   short     165     46     10     8.5          10.0 s           5.0 s     5.9 s    45.9%    21.1
//   medium   302.5    66     22     8.6           4.5 s           2.3 s     5.8 s    28.1%    18.5
//   long      473     92     34     8.0           2.9 s           1.5 s     6.3 s    19.0%    17.5
//
// The opening burst is twice the steady one because it climbs from cold (0 -> capacity) while
// every later burst restarts at the resume line (half capacity -> capacity). Sustained uptime is
// therefore dispersion / (generation + dispersion) and has NO CAPACITY TERM AT ALL - which is
// worth saying out loud, because it means the two capacity tiers (3 and 6) lengthen the burst and
// the silence in equal measure and add exactly zero sustained damage. They buy rhythm, not output.
//
// DISPERSION IS NEARLY FLAT ACROSS THE THREE (8.5 / 8.6 / 8.0) while generation triples. That is
// the retune that put the SHORT laser on top of the sustained ranking: it is the one that fires
// nearly half the time, and the long one is a held breath that spends four fifths of a fight
// cooling. All three are the weakest sustained weapons in the game, and they pay for it with
// range and with a max hit of one tick's damage.
//
// WHAT THE TABLE STILL CANNOT TELL YOU is that a laser only earns these figures with something in
// front of it, and measured, it usually does not have it. `npm run dps` runs each of these
// against the real horde for four minutes: the short laser reached 9% of its sustained figure at
// tier 7 and gained almost nothing from six tiers of upgrades, because the thing it is short of
// is REACH and no rung of the ladder sells any. All three bases carry +10% for that reason.
// ---------------------------------------------------------------------------------------------

/**
 * Lasers slew fast and fire wide. They are emitters on a gimbal, not a turret with a barrel to
 * heave around: heat is the gate that matters, so making you also wait on traverse would be two
 * gates doing one job and would read as unresponsiveness.
 */
const LASER_TRAVERSE = degToRad(720);
const LASER_FIRE_ARC = degToRad(30);

/**
 * TIERS 2-7 for every laser, the same shape for all three:
 *
 *   2 damage + heat    3 capacity    4 dispersion    5 damage + heat    6 capacity    7 dispersion
 *
 * Damage tiers RAISE HEAT GENERATION as well: a harder-hitting laser runs hotter, so raw power
 * shortens your bursts and you buy the burst back with capacity and dispersion. That is the whole
 * ladder - it alternates "hits harder" against "runs longer", and a laser that only ever took
 * damage tiers would fire in shorter and shorter bursts.
 *
 * Deltas scale with the weapon's own base so all three ladders feel proportionally identical.
 */
function laserTiers(
  damagePerSec: number,
  heatPerSec: number,
  heatDispersion: number,
): readonly Readonly<Partial<Record<WeaponStatKey, number>>>[] {
  const dmgStep = damagePerSec * 0.4;
  const heatStep = heatPerSec * 0.4;
  // Scaled off DISPERSION, not generation. Off generation, a dispersion tier on the Long Laser
  // (34/s generation against 8/s dispersion) tripled its uptime in one card while the same tier on
  // the Short Laser barely moved it - the same card meaning wildly different things per weapon.
  const dispStep = heatDispersion * 0.5;
  return Object.freeze([
    { damage: dmgStep, heatPerSec: heatStep }, // T2
    { heatCapacity: 40 }, // T3
    { heatDispersion: dispStep }, // T4
    { damage: dmgStep, heatPerSec: heatStep }, // T5
    { heatCapacity: 40 }, // T6
    { heatDispersion: dispStep }, // T7
    // T8 - THE ASCENSION, AND IT CARRIES NO STATS AT ALL. Reached only through a Cyber Chest and
    // only with the right passive held (data/upgrades.ts).
    //
    // It used to hand out half a dispersion tier and +30 range on top of the chain. Both are gone.
    // The tier is bought with the MECHANIC it switches on, and the moment it also pays a stat rung
    // the mechanic starts reading as a bonus attached to a stat card - and worse, the two it paid
    // were exactly the two that make the chain itself stronger, so the capstone was quietly scaling
    // its own new behaviour on top of granting it.
    //
    // An empty object rather than a missing entry: `perLevel[6]` is the tier-8 slot, and a table
    // whose length stops at 7 would make "what does tier 8 give" a question about array bounds.
    {}, // T8
  ]);
}

/**
 * THE LASER HARDPOINTS - where a beam actually leaves the mech, in BODY space: +x is the way the
 * chassis is walking, +y its right side, world units. `fireBeam` rotates them by the player's
 * facing, and the point is the beam's TRUE ORIGIN - the raycast starts there and the line is
 * drawn from there, one fact rather than two (the old emitter was cosmetic and the ray came from
 * the centre; the two could visibly disagree at point-blank range).
 *
 * FIVE POINTS - a nose and four corners - ASSIGNED BY HOW MANY BEAMS THE LOADOUT HOLDS. See
 * BEAM_MOUNTS below for the assignment itself; the shape of it is:
 *
 *   one laser     the NOSE - a single gun mounts on the centreline
 *   two lasers    the two SHOULDERS - a pair mounts symmetrically
 *   three         nose and both shoulders, in slot order
 *   four          the four CORNERS, nose empty - four guns want the wide square, not a spine
 *   five          all of them
 *
 * THE BACK PAIR IS REACHED BY THE HYDRA AND ONLY BY THE HYDRA. Three beam weapons exist (short,
 * medium, long - the Chain Laser is the Medium at tier 8 and the Giga is the Long, so an ascension
 * adds no beam), so the ordinary route tops out at the front trio; the Hydra puts a second and a
 * third Short Laser on the chassis (HYDRA_MOUNTS), which is what takes a laser build to four and
 * five beams and out onto the rear quarters.
 *
 * The numbers are read off the generated chassis art (tools/make-mechs.mjs): the nose sits ~54 px
 * ahead of centre and the shoulder line at SY = 38K px, on a 148 px canvas drawn 58 world units
 * wide - so ~21 u forward, and ~5 u forward by ~15 u out. The back pair sits ~23 px BEHIND centre
 * on the same lateral line as the shoulders: ~9 u aft by ~15 u out. Behind the shoulders and well
 * clear of the tail - the rear thruster block starts ~42 px back and the hull ends around 48 -
 * which is what "not very far back" buys: the mounts read as rear quarters of the same hull
 * rather than as guns bolted to the exhaust.
 *
 * ONE SET FOR ALL SIXTEEN CHASSIS rather than sixteen hand-fitted sets: the frames differ by a
 * weight class the offsets sit comfortably inside, and per-chassis fitting is a decision for the
 * day a chassis ships whose silhouette actually contradicts these. Rough symmetry over precision,
 * by design - the back pair shares the shoulders' ~15 u half-width for exactly that reason, which
 * on a light frame is a unit or so proud of the hull and on a heavy one a unit or so inside it.
 *
 * IN CORE, NOT THE RENDERER, because the origin is now a SIMULATION fact: it decides what the ray
 * hits, so it has to live where the ray lives and land in the replay.
 */
export const LASER_HARDPOINTS: readonly Readonly<{ x: number; y: number }>[] = Object.freeze([
  Object.freeze({ x: 21, y: 0 }), // 0  nose
  Object.freeze({ x: 5, y: -15 }), // 1  left shoulder
  Object.freeze({ x: 5, y: 15 }), // 2  right shoulder
  Object.freeze({ x: -9, y: -15 }), // 3  back left
  Object.freeze({ x: -9, y: 15 }), // 4  back right
]);

/**
 * HOW MANY MOUNTS THE HYDRA TAKES - the total number of Short Lasers a chassis ends up with when
 * that ascension lands, counting the one that ascended. See `fillLaserMounts`.
 *
 * THREE, NOT FIVE, AND THE DIFFERENCE IS THE POINT. It used to be "every free hardpoint", which
 * on a pure Short Laser run meant all five - and five of one gun is not a build, it is the end of
 * one: with the mounts full the deck stops offering beams (see `isOfferable`), so the ascension
 * that was supposed to be a laser run's reward was also the moment its laser choices stopped.
 * Three leaves two mounts standing, which is exactly enough for a Medium and a Long, so the Hydra
 * now BUYS a wider laser build instead of closing it.
 *
 * It is still a ceiling rather than a promise: a run already carrying a Medium and a Long has two
 * hardpoints free, not four, and gets what fits.
 */
export const HYDRA_MOUNTS = 3;

/**
 * WHICH MOUNTS ARE USED FOR A GIVEN NUMBER OF BEAMS, indexed by that number. Row `n` has exactly
 * `n` entries and every entry is an index into LASER_HARDPOINTS.
 *
 * A TABLE RATHER THAN THE ARITHMETIC IT REPLACED. This used to be three lines of index juggling
 * with `< 3 ? : 2` clamps in them, which was already hard to read for three points and would have
 * been unreadable for five - and the clamps were load-bearing in a way nothing stated. As data,
 * the assignment is legible at a glance, the row length IS the invariant (row n has n mounts), and
 * a test can walk every row instead of trusting the arithmetic.
 *
 * FOUR BEAMS TAKE THE CORNERS AND LEAVE THE NOSE EMPTY, which is the one row worth arguing about.
 * Nose-plus-three would put an odd gun on the centreline and break the symmetry the other rows
 * keep; four guns on four corners is what the hull is shaped for.
 */
export const BEAM_MOUNTS: readonly (readonly number[])[] = Object.freeze([
  Object.freeze([]), // 0 - no beams held
  Object.freeze([0]), // 1 - nose
  Object.freeze([1, 2]), // 2 - shoulders
  Object.freeze([0, 1, 2]), // 3 - nose and shoulders
  Object.freeze([1, 2, 3, 4]), // 4 - the four corners
  Object.freeze([0, 1, 2, 3, 4]), // 5 - everything
]);

/**
 * Which hardpoint this beam fires from, by HOW MANY beams the loadout holds - see the
 * LASER_HARDPOINTS doc for the assignment (1 -> nose, 2 -> shoulders, 3 -> all, slot order).
 * Five beams is the ceiling - three laser cards, and the Hydra's two extra Short Lasers - so
 * `mine` is always inside the table; clamped anyway rather than trusted.
 *
 * IT LIVES IN THE CATALOG, BESIDE THE TABLE, BECAUSE IT HAS TWO CALLERS AND THEY MUST NOT
 * DISAGREE. `fireBeam` uses it for the ray's true origin; the render layer uses it to place the
 * emitter's heat glow and the cut-out sputter. Systems are not on the public barrel, so the
 * renderer's only other option was a mirrored copy of the assignment - and a mirrored copy is
 * exactly how a glow ends up hanging in the air beside a beam that leaves from somewhere else.
 * The rule is a fact about where a gun SITS ON THE CHASSIS, which is the same kind of fact as
 * the offsets themselves, so this is where it belongs.
 */
export function laserHardpoint(world: World, weaponIdx: number): Readonly<{ x: number; y: number }> {
  // THE GIGA LASER OWNS THE NOSE. A beam that wide fires down the centreline or the art is a lie,
  // so when one is held it takes hardpoint 0 unconditionally and every other beam is pushed to
  // the shoulders - whatever the count-based rule below would have said. Losing the two-laser
  // shoulder symmetry to it was accepted when the hardpoints became real: the gun is somewhere.
  let gigaIdx = -1;
  for (let i = 0; i < world.weaponCount; i++) {
    const d = world.weaponCatalog[world.weapons[i].defId] as WeaponDef | undefined;
    if (d?.gigaFrom !== undefined && world.weapons[i].level >= d.gigaFrom) {
      gigaIdx = i;
      break;
    }
  }
  if (gigaIdx >= 0) {
    if (weaponIdx === gigaIdx) return LASER_HARDPOINTS[0];
    // Every other beam takes the remaining mounts in slot order - shoulders first, then the back
    // pair. The nose is spoken for, so this walks LASER_HARDPOINTS from 1 rather than consulting
    // BEAM_MOUNTS: the count-based rows all assume the nose is available to give away.
    let nth = 0;
    for (let i = 0; i < world.weaponCount; i++) {
      if (i === gigaIdx) continue;
      if ((world.weaponCatalog[world.weapons[i].defId] as WeaponDef | undefined)?.kind !== 'beam')
        continue;
      if (i === weaponIdx) break;
      nth++;
    }
    const at = nth + 1;
    return LASER_HARDPOINTS[at < LASER_HARDPOINTS.length ? at : LASER_HARDPOINTS.length - 1];
  }

  let held = 0;
  let mine = 0;
  for (let i = 0; i < world.weaponCount; i++) {
    if ((world.weaponCatalog[world.weapons[i].defId] as WeaponDef | undefined)?.kind !== 'beam') continue;
    if (i === weaponIdx) mine = held;
    held++;
  }
  // Straight off the table - see BEAM_MOUNTS. Both lookups are clamped rather than trusted: more
  // beams than there are mounts is not reachable today and must not become an undefined read the
  // day it is.
  const row = BEAM_MOUNTS[held < BEAM_MOUNTS.length ? held : BEAM_MOUNTS.length - 1];
  if (row.length === 0) return LASER_HARDPOINTS[0];
  return LASER_HARDPOINTS[row[mine < row.length ? mine : row.length - 1]];
}

/**
 * THE GIGA LASER'S HALF-WIDTH, world units, before AoE multipliers. It rides the `splashRadius`
 * key (see WeaponDef.gigaFrom), so Shaped Charges' +50% takes it to 18 and the drawn beam grows
 * with it - the width on screen IS the width that burns.
 *
 * 9.6 u half - a 19.2 u channel, plus each body's own radius - is sized against the crowd it is
 * aimed at: the densest-cluster rule points it at a knot, and a knot's bodies stand roughly a
 * radius apart, so a runt column two abreast still fits inside the swath while a spread line
 * across it catches one or two. Wide enough to be unmistakably a different weapon; narrow enough
 * that where the mech faces still matters.
 *
 * DOWN 20% FROM THE 12 IT SHIPPED AT. Area is what this number really buys - the swath bills
 * everything it covers - so a fifth off the half-width is a fifth off the ground covered at every
 * range, which is the most direct lever the weapon has and the one that leaves its damage, its
 * burst and its reach alone.
 */
export const GIGA_HALF_WIDTH = 9.6;

function laser(
  id: WeaponId,
  name: string,
  range: number,
  damagePerSec: number,
  heatPerSec: number,
  heatDispersion: number,
  beamColour: number,
  beamWidth: number,
  /** Tier at which this beam starts chaining, or 0 for a beam that never does. */
  chainsFrom = 0,
  /** Tier at which this beam goes giga, or 0 for a beam that never does. */
  gigaFrom = 0,
  /** Tier at which this beam fills every free mount with copies of itself, or 0 for never. */
  fillsMountsFrom = 0,
): WeaponDef {
  const tiers = laserTiers(damagePerSec, heatPerSec, heatDispersion);
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
      // A continuous beam applying knockback every tick would launch a runt into orbit.
      knockback: 0,
      splashRadius: 0,
      splashFrac: 0,
      turretTraverse: LASER_TRAVERSE,
      fireArc: LASER_FIRE_ARC,
      heatPerSec,
      heatCapacity: HEAT_CAPACITY_BASE,
      // Dispersion is AUTHORED PER LASER and is well below generation on all three, so every
      // laser spends most of a fight cooling. It is the single number that decides uptime -
      // dispersion / (generation + dispersion) - and therefore the whole ranking below.
      heatDispersion,
      turnRate: 0,
      spreadAngle: 0,
      flightTime: 0,
      ammoCapacity: 0,
      reloadTime: 0,
    }),
    // A GIGA BEAM'S TIER 8 IS THE ONE ASCENSION RUNG THAT CARRIES STATS, and they are the
    // mechanic rather than a bonus stapled to it: `splashRadius` IS the swath's half-width (a
    // width of zero would be the old beam wearing a new name), and the doubled capacity - base
    // plus both capacity tiers over again - is what makes a beam that now bills a crowd per tick
    // burn long enough to read as the capstone it is. Contrast the empty rung the other
    // ascensions keep (see laserTiers T8).
    //
    // AND IT SHEDS HEAT 10% SLOWER, which is the one number here that is a COST. Measured
    // (`npm run t8`, five seeds, every ascension at 8 with every passive): the Giga took 37.3% of
    // all damage against the Chain Laser's 24.9%, the Twin Mount's 20.1% and the Hornet's 17.5% -
    // top of the table on every single seed. A beam that bills every body it covers scales with
    // the crowd in a way none of the other three do, so the lever is UPTIME rather than damage:
    // uptime is dispersion / (generation + dispersion), and taking dispersion down lengthens the
    // silence between bursts without touching what a burst is worth. The alternative - cutting
    // dps - would have made the swath feel weaker per body while still covering the same ground,
    // which is trimming the wrong half of what the measurement actually found.
    //
    // -0.2x THE AUTHORED BASE, because the deltas here are ADDITIVE and cumulative dispersion at
    // tier 7 is `base + 2 x (0.5 x base)` = `2 x base` (see laserTiers). A tenth of that is
    // `0.2 x base`, so this stays exactly 10% through any retune of the number it is derived from
    // rather than being a literal that silently stops meaning 10%.
    perLevel:
      gigaFrom > 0
        ? Object.freeze([
            ...tiers.slice(0, 6),
            Object.freeze({
              heatCapacity: HEAT_CAPACITY_BASE + 80,
              splashRadius: GIGA_HALF_WIDTH,
              heatDispersion: -heatDispersion * 0.2,
            }),
          ])
        : tiers,
    chainsFrom,
    ...(gigaFrom > 0 ? { gigaFrom } : {}),
    ...(fillsMountsFrom > 0 ? { fillsMountsFrom } : {}),
    reengageMul: 1,
    visualId: VIS_SHELL,
    muzzleOffset: 22,
    shellRadius: 0,
    beamColour,
    beamWidth,
    fireAlongFacing: false,
      detonateOnExpiry: false,
  }) as WeaponDef;
}

// HEAT GENERATION IS 25% BELOW WHAT THESE LASERS SHIPPED WITH (10 / 22 / 34). Uptime is
// dispersion / (generation + dispersion), so every beam in the game now spends noticeably more of
// a fight firing and less of it cooling - which is the lever that lifts the beams as a CLASS
// without changing a single number their cards advertise as damage.
//
// WHY UPTIME AND NOT DAMAGE. Measured across five full runs with every weapon held at tier 7, the
// four beams took 19.7% of a run's damage against the four projectile weapons' 80.1%. That split
// is structural rather than a stray number: a volley bills a separate body per shell and so scales
// with how crowded the field is, while a beam burns one target and does not. Paying the beams more
// damage per second would have papered over that; buying them more SECONDS is the half of the
// equation the ladder was already built around - damage tiers raise heat, capacity and dispersion
// buy it back - so this makes the existing economy more generous instead of bypassing it.
//
// IT SCALES ITSELF. `laserTiers` derives every heat rung as 0.4x the base, so the cut holds at
// every tier rather than washing out by tier 7 the way a flat delta would.
//
// Base ranges are all +10% over the numbers this file shipped with (150 / 275 / 430). Measured,
// a beam spends most of a fight with NOTHING INSIDE IT - the Short Laser reached 9% of its
// arithmetic ceiling at tier 7 and gained almost nothing across six tiers, because reach, not
// damage, was what it was short of. Range tiers do not exist on the laser ladder, so the base is
// the only place this can be bought. `npm run dps` is where to check whether it was enough.
export const LASER_SHORT = laser(
  'laser-short',
  'Short Laser',
  165,
  46,
  7.5,
  8.5,
  0x3be86b,
  1.6,
  0,
  0,
  // Fills every free laser mount at tier 8 - the Hydra. See WeaponDef.fillsMountsFrom.
  8,
);
export const LASER_MEDIUM = laser(
  'laser-medium',
  'Medium Laser',
  302.5,
  66,
  16.5,
  8.6,
  0x4fa8ff,
  2.1,
  // Chains from tier 8 - the Chain Laser. See WeaponDef.chainsFrom.
  8,
);
export const LASER_LONG = laser(
  'laser-long',
  'Long Laser',
  473,
  92,
  25.5,
  8.0,
  0xff4d4d,
  2.7,
  0,
  // Goes giga at tier 8 - see WeaponDef.gigaFrom.
  8,
);

/**
 * Index in this array is `WeaponInstance.defId` and is written into every replay. APPEND ONLY.
 */
// ---------------------------------------------------------------------------------------------
// The missiles
//
// Two racks that break the rule every other weapon here follows: THEY DO NOT AIM. A volley leaves
// along the direction the player last MOVED, spread evenly about it, and each missile then steers
// weakly toward whatever enemy is nearest to ITSELF - re-evaluated every tick, never a locked
// target. So the missiles connect because of where you were running, not because the gun found
// something; the direction you flee becomes an aiming decision, and kiting backwards means firing
// backwards.
//
// Turn rate, not target choice, decides whether a volley lands. "Weak homing" is a low turn rate:
// a missile curves onto a straggler it was already pointed near and sails straight past a crowd
// off to one side. That is why the tier ladders spend two rungs on turn radius.
//
//                  volley   spread   rearm   damage   flight   turn      reach
//   SRM              2       15 deg   3.0 s     68     1.15 s  4.8 rad/s  ~345
//   LRM              3       10 deg   4.2 s     46     2.00 s  1.95 rad/s ~660
//
// SRM is the panic button: a slow, heavy, close-in double tap. LRM is a commitment - a wider,
// slower, longer-reaching salvo that has to be aimed a second in advance.
//
// BASE TURN RATES ARE DOUBLE (SRM) AND HALF AGAIN (LRM) what this file shipped with - 2.4 and
// 1.3. Measured over four minutes of real fighting, both racks were landing about ONE MISSILE IN
// SIX: 0.17 hits per shot on the short rack and 0.13 on the long, against a Cannon's 1.00. "Weak
// homing" had stopped being a characterful drawback and become a weapon that mostly misses. The
// two turn-rate rungs on each ladder still exist and still matter; they now start from a rate
// that can actually curve onto something.
//
// BASE DAMAGE IS UP A SHADE ON BOTH RACKS - 62 and 42 before this - a small correction rather than
// a rework: `npm run passives` had both racks landing near the bottom of the T7 table even fully
// built, well below what a homing weapon that finally connects ought to manage.
// ---------------------------------------------------------------------------------------------

function missile(
  id: WeaponId,
  name: string,
  volley: number,
  spreadDeg: number,
  cooldown: number,
  damage: number,
  range: number,
  speed: number,
  flightTime: number,
  turnRate: number,
  /**
   * BOTH ZERO ON EVERY MISSILE TODAY. The parameters stay because the rack is the natural place
   * for a warhead to come back, and `splashRadius`/`splashFrac` are the only two numbers that
   * would need to move - but a missile currently deals its damage to exactly the body it strikes.
   * A missile that misses, misses.
   */
  splashRadius: number,
  splashFrac: number,
  knockback: number,
  /**
   * VIS_MISSILE_SHORT or VIS_MISSILE_LONG. The two racks draw the same source art at different
   * proportions - the short body squat and fat, the long one longer and thinner - so a screen
   * carrying both volleys says which is which without a colour or a label.
   */
  visualId: number,
  perLevel: readonly Readonly<Partial<Record<WeaponStatKey, number>>>[],
  /** Tier at which the warheads split. 0 for a rack that never does. See WeaponDef.splitsFrom. */
  splitsFrom = 0,
): WeaponDef {
  return Object.freeze({
    id,
    name,
    kind: 'projectile' as WeaponKind,
    splitsFrom,
    // Unused: `fireAlongFacing` means no target is ever selected. Declared as 'nearest' rather
    // than inventing a 'none' strategy, because a fourth entry in the targeting table that is
    // never called would be a lie about what that table is for.
    targeting: 'nearest' as TargetingId,
    pattern: 'spread' as FirePatternId,
    behaviour: 'homing' as BehaviourId,
    // The rack fires whether or not anything is in range. It is aimed by your feet.
    requiresTarget: false,
    base: Object.freeze({
      damage,
      cooldown,
      range,
      projectileSpeed: speed,
      projectileCount: volley,
      pierce: 0,
      knockback,
      splashRadius,
      splashFrac,
      // No turret: the rack points where the chassis points.
      turretTraverse: degToRad(720),
      fireArc: degToRad(180),
      heatPerSec: 0,
      heatCapacity: HEAT_CAPACITY_BASE,
      heatDispersion: 0,
      turnRate,
      spreadAngle: degToRad(spreadDeg),
      flightTime,
      ammoCapacity: 0,
      reloadTime: 0,
    }),
    perLevel,
    reengageMul: 1,
    visualId,
    muzzleOffset: 26,
    shellRadius: 8,
    beamColour: 0,
    beamWidth: 0,
    fireAlongFacing: true,
    // FALSE now that missiles carry no warhead splash: a fuse that detonates a zero-radius blast
    // is a no-op with a puff on it. `expireProjectile` already guards on `splashRadius > 0`, so
    // this is belt and braces - but a flag set true while meaning nothing is exactly the kind of
    // config that gets read as an intention later.
    detonateOnExpiry: false,
  }) as WeaponDef;
}

export const MISSILE_SHORT = missile(
  'missile-short', 'Short Missiles',
  2, 15, 3.0, 68, 280, 300, 1.15, 4.8, 0, 0, 210, VIS_MISSILE_SHORT,
  Object.freeze([
    { cooldown: -0.45 }, // T2  3.00 -> 2.55 s
    { turnRate: 0.7 }, // T3  2.4 -> 3.1 rad/s
    { damage: 22 }, // T4  68 -> 90
    { cooldown: -0.45 }, // T5  2.55 -> 2.10 s
    { turnRate: 0.7 }, // T6  3.1 -> 3.8 rad/s
    { projectileCount: 1 }, // T7  a third missile
  ]),
);

/**
 * THE GTM HORNET - what the Long Missiles become at tier 8.
 *
 * A warhead that has been in the air for `SPLIT_SEC` without hitting anything breaks into two
 * SHORT-rack missiles, `SPLIT_APART` apart. Five tubes become ten warheads, and the volley stops
 * being a fan and starts being a cloud.
 *
 * 0.35 SECONDS - well under a sixth of the long rack's own 2.6 s fuse at tier 7, walked down from
 * the one second it shipped at through half and then 0.4. The split has to happen while the
 * missiles are still crossing the field rather than as they expire, or the children arrive with
 * nothing left to fly at, and a Hornet volley's whole shape is the second wave spreading through
 * the gap the first one flew into. A second was late enough that the parents were most of the way
 * to their targets before coming apart; half was better but still let the parents open most of
 * their fan first; 0.4 formed the cloud barely past the tubes, and 0.35 pulls it three frames
 * closer still, which puts all ten warheads into the crowd nearer the mech - where the crowd
 * actually is - rather than out at the parents' own range.
 *
 * FIFTEEN DEGREES BETWEEN THE PAIR, so each child leaves at half that off its parent's heading.
 * Wide enough that they separate before their own fuses run out, narrow enough that the pair still
 * reads as one missile having come apart rather than as two unrelated ones.
 *
 * `Math.cos`/`Math.sin` are banned in core (implementation-defined in the last ulp, and one ulp of
 * heading is a divergent replay), so the half-angle is stored as its two components, computed
 * offline. Same treatment as the flow field's swirl table.
 */
export const SPLIT_SEC = 0.35;
export const SPLIT_COS = 0.9914448613738104; // cos(7.5 deg)
export const SPLIT_SIN = 0.13052619222005157; // sin(7.5 deg)

/**
 * THE CHILDREN CORNER HARDER THAN THE RACK THEY ARE COPIED FROM: +20% turn rate over the short
 * rack's own tier-7 figure. A child is born mid-field already pointing 7.5 degrees off anything,
 * with whatever is left of a short fuse to come around in - the tightness the rack earns over
 * seven tiers is tuned for missiles that leave the tubes aimed, and a split child never does.
 * Applied in `resolveSplitStats`, so it stacks with the same passives a held rack would get.
 */
export const SPLIT_TURN_MUL = 1.2;

export const MISSILE_LONG = missile(
  'missile-long', 'Long Missiles',
  3, 10, 4.2, 46, 430, 330, 2.0, 1.95, 0, 0, 160, VIS_MISSILE_LONG,
  Object.freeze([
    { cooldown: -0.6 }, // T2  4.20 -> 3.60 s
    { turnRate: 0.45 }, // T3  1.30 -> 1.75 rad/s
    { damage: 15 }, // T4  46 -> 61
    { projectileCount: 1 }, // T5  a fourth missile
    { flightTime: 0.6 }, // T6  2.0 -> 2.6 s, reach ~860
    { projectileCount: 1 }, // T7  a fifth missile
  ]),
  // T8 - the GTM Hornet. See SPLIT_SEC above.
  WEAPON_ASCENDED_TIER,
);

// ---------------------------------------------------------------------------------------------
// The Machine Gun
//
// The third kind of limiter in the game, and the one that hurts. A cooldown paces you evenly; a
// heat bar trades burst against silence every few seconds; a MAGAZINE gives you a long
// uninterrupted stream and then takes the weapon away for fifteen seconds. Every round you spend
// is a slice of that silence you have already bought.
//
//   200 rounds, 2 per burst = 100 bursts. At a 0.09 s cycle that is 9.0 s of fire, then 15 s of
//   nothing: 37% uptime, the lowest in the game by a distance.
//
// Everything else about it is built to make that trade worth taking. 5.5 damage a round is the
// smallest number in the catalog, but 22 rounds a second is 122 dps while the belt lasts - the
// highest burst in the game - and it targets the WEAKEST enemy in range, so it finishes what other
// weapons started rather than starting anything itself. Range 130 is shorter than any laser: you
// have to be inside the crowd for it to do anything at all, and it is empty exactly when you most
// want to leave.
// ---------------------------------------------------------------------------------------------

export const MACHINE_GUN: WeaponDef = Object.freeze({
  id: 'machine-gun',
  name: 'Machine Gun',
  kind: 'projectile',
  targeting: 'lowest-hp',
  // `spread` fanned about the TURRET, not the chassis: fireAlongFacing is false, so the pair
  // straddles the aim line rather than the direction of travel.
  pattern: 'spread',
  behaviour: 'straight',
  requiresTarget: true,
  base: Object.freeze({
    damage: 5.5, // the smallest number in the catalog, fired more often than anything else
    cooldown: 0.09, // ~11 bursts/s = 22 rounds/s
    range: 130, // shorter than the Short Laser's 165 - you must be inside the crowd
    projectileSpeed: 900, // near-hitscan; at this range travel time is not the point
    projectileCount: 2,
    pierce: 0,
    knockback: 14, // barely a nudge, but 22 a second adds up against a runt
    splashRadius: 0,
    splashFrac: 0,
    turretTraverse: degToRad(810), // whips around (trimmed 10% with the Cannon's); still far ahead of its rate of fire
    fireArc: degToRad(20),
    heatPerSec: 0,
    heatCapacity: HEAT_CAPACITY_BASE,
    heatDispersion: 0,
    turnRate: 0,
    spreadAngle: degToRad(5), // "close together" - a tight pair, not a shotgun
    flightTime: 0,
    ammoCapacity: 200,
    reloadTime: 15,
  }),
  perLevel: Object.freeze([
    { damage: 1.5 }, // T2  5.5 -> 7.0
    { cooldown: -0.018 }, // T3  0.090 -> 0.072 s  (~28 rounds/s)
    { ammoCapacity: 80 }, // T4  200 -> 280 rounds
    { range: 25 }, // T5  130 -> 155
    { damage: 3 }, // T6  7.0 -> 10.0
    { reloadTime: -4.5 }, // T7  15.0 -> 10.5 s
  ]),
  reengageMul: 1,
  visualId: VIS_SLUG,
  muzzleOffset: 28,
  shellRadius: 5,
  beamColour: 0,
  beamWidth: 0,
  fireAlongFacing: false,
  detonateOnExpiry: false,
});

// ---------------------------------------------------------------------------------------------
// The Flak Cannon
//
// The Machine Gun's opposite number on the same mount, and the two cannot be held together (see
// WeaponDef.excludes). Where the belt gun is a precise stream that only works INSIDE the crowd,
// this throws three shells at once into a sixty-degree cone at four hundred units - the longest
// reach of any projectile weapon here - and most of them miss.
//
//   3 shells   0.13 s cycle   4 damage   60 deg cone   300 rounds   13 s reload
//
// THE CONE IS THE WEAPON, and it is genuinely random rather than a fan: three shells drawn
// independently from the spread each burst, so no two bursts are the same shape and none of them
// can be aimed. What the weapon actually delivers is a function of HOW MANY BODIES ARE IN THE
// CONE, which is the trade being sold: fire it at a loner across the yard and most of the belt
// goes into the dirt; fire it into a wave and nearly every shell finds something.
//
// IT SHOOTS THE NEAREST BODY, not the weakest, and that is what makes the cone usable: the aim
// point is the near edge of the crowd, so the cone opens INTO the mass behind it rather than
// reaching past it at something buried. Aiming at the weakest would point a shotgun at whatever
// happened to be most nearly dead.
//
// THE BELT IS DEEPER AND THE RELOAD SHORTER than the Machine Gun's (300/13 s against 200/15 s),
// which is not generosity - it is the miss rate priced in. 100 bursts at 0.13 s is 13 s of fire
// against 13 s of silence: 50% uptime, the best of any magazine weapon, and it still spends half
// its rounds on empty ground.
//
// MEASURED, AND CUT FOR IT. `npm run passives` (T7, isolated, real sim) originally had this
// outdamaging the Machine Gun by 50-60% both bare and with every passive held: 163.8 dps against
// 103.8 with nothing else in play, 260.9 against 171.9 fully built. It took three passes to land
// under the belt gun in both states rather than one - DAMAGE DOES NOT SCALE EFFECTIVE DPS
// LINEARLY, because a lot of what a smaller shell stops wasting is OVERKILL on a body that was
// already about to die, and a straight percentage cut recovers less of that than it looks like it
// should. Worse, THE TWO STATES DID NOT MOVE TOGETHER: the cone's damage share of its fully-built
// DPS shrinks faster than the belt gun's does, because a stacked build kills faster, which keeps a
// wider, denser crowd in front of a weapon whose whole trade is coverage rather than precision - so
// a cut that cleared the bare comparison left the built one essentially tied (114.3/103.8 bare,
// 192.8/171.9 built, after the first cut alone).
//
// Per-shot damage now runs 4/5.0/6.5 across the ladder, under the Machine Gun's own 5.5/7.0/10.0
// at every rung, landing at 87.4 bare and 163.9 built against the belt gun's 103.8 and 171.9 -
// below in both states with room either side of the line. What is left to sell is volume and
// reach, not a harder-hitting shell too.
//
// OWED A FRESH `npm run passives` after any further retune of either gun - see CLAUDE.md, "measure
// balance changes, do not assert them". The numbers above are what motivated this one.
// ---------------------------------------------------------------------------------------------

/**
 * THE CONE, and it is the FULL width rather than the angle between neighbours.
 *
 * `spreadAngle` means something slightly different in the two patterns that read it, which is
 * worth stating out loud: in `spread` (the missile racks, the Machine Gun) it is the gap BETWEEN
 * adjacent shells of a fixed fan, and in `cone` it is the total width of the arc each shell is
 * drawn from independently. Same key, because both are "how wide does this volley go" and a
 * second key would need a second column in WeaponStats that six weapons would carry as zero.
 */
export const FLAK_CONE = degToRad(60);

export const FLAK_CANNON: WeaponDef = Object.freeze({
  id: 'flak-cannon',
  name: 'Flak Cannon',
  // THE NEAREST BODY. See the header: the cone has to open into the crowd, and the near edge of
  // it is the only aim point that guarantees that.
  targeting: 'nearest',
  kind: 'projectile',
  pattern: 'cone',
  behaviour: 'straight',
  requiresTarget: true,
  base: Object.freeze({
    damage: 4, // under the belt gun's 5.5 - see the header for why: volume sells this gun now, not the shell
    cooldown: 0.13, // 7.7 bursts/s = 23 rounds/s
    range: 400, // the longest projectile reach in the game - and the least accurate
    projectileSpeed: 620, // 0.65 s to maximum range: the spread is VISIBLE opening in flight
    projectileCount: 3,
    pierce: 0,
    knockback: 18,
    splashRadius: 0,
    splashFrac: 0,
    // THE MACHINE GUN'S MOUNT WEARING MORE WEIGHT. The same sprite draws both - only one of the
    // two can ever be held - but this one slews 10% slower than the belt gun's 810 deg/s.
    //
    // It costs this weapon less than it would cost the Machine Gun, which is why it is the one
    // that pays: the belt gun puts two rounds down a line and wants the line laid exactly, while
    // this throws three shells into a sixty-degree cone where a degree of lag is inside the spread
    // already. What the player feels instead is the mount's WEIGHT - a flak battery swinging onto
    // a new crowd is a heavier thing coming round than a machine gun is.
    turretTraverse: degToRad(729),
    // Wider than the belt gun's 20 deg. A weapon that sprays a sixty-degree cone has no business
    // waiting to be precisely laid on first; the gate would be finer than the weapon.
    fireArc: degToRad(30),
    heatPerSec: 0,
    heatCapacity: HEAT_CAPACITY_BASE,
    heatDispersion: 0,
    turnRate: 0,
    spreadAngle: FLAK_CONE,
    flightTime: 0,
    ammoCapacity: 300,
    reloadTime: 13,
  }),
  /**
   * THE SAME LADDER SHAPE AS THE MACHINE GUN, rung for rung: damage, rate, magazine, range,
   * damage, reload. Both weapons live and die by the same three questions - how hard is a round,
   * how many are there, and how long is the silence - so the ladder that answers them for one
   * answers them for the other.
   *
   * NOTHING TIGHTENS THE CONE, deliberately. A spread tier would be the obvious seventh rung and
   * it is the one thing this weapon must not sell: the cone is the identity, and a Flak Cannon
   * that can be upgraded into accuracy is a Machine Gun with extra steps.
   */
  perLevel: Object.freeze([
    { damage: 1.0 }, // T2  4.0 -> 5.0
    { cooldown: -0.026 }, // T3  0.130 -> 0.104 s  (~29 rounds/s)
    { ammoCapacity: 120 }, // T4  300 -> 420 rounds
    { range: 70 }, // T5  400 -> 470
    { damage: 1.5 }, // T6  5.0 -> 6.5
    { reloadTime: -4 }, // T7  13.0 -> 9.0 s
  ]),
  // Declared HERE and nowhere else - the check runs both directions. See WeaponDef.excludes.
  excludes: Object.freeze(['machine-gun'] as const),
  reengageMul: 1,
  visualId: VIS_SLUG,
  muzzleOffset: 28,
  shellRadius: 5,
  beamColour: 0,
  beamWidth: 0,
  fireAlongFacing: false,
  detonateOnExpiry: false,
});

// ---------------------------------------------------------------------------------------------
// Heavy Artillery
//
// The only weapon in the game that does not care where anything is. Two shells fall on random
// spots near the mech - not on enemies, not ahead of the player, not where you are looking. It is
// weather, and you learn to fight underneath it.
//
// STRIKES FALL IN A 70-320 u ANNULUS about the mech: past the bodies actually touching you, onto
// the ground the next wave is crossing, but close enough that most of it happens where you can see
// it. Area grows with the square of the radius, so that band is a density dial as much as a reach
// one - see STRIKE_RADIUS_MIN/MAX in constants.ts for what the tighter and wider versions cost.
//
//   2 shells   0.7 s fuse   55.1 damage   75 u blast   3.789 s reload   -> 3 shells at tier 7
//
// The fuse is the weapon. Shells are inert while they fall - flagged NOCONTACT so nothing can set
// one off early - which gives the player two thirds of a second to read the markers and decide
// whether to walk into that ground or away from it.
// ---------------------------------------------------------------------------------------------

/**
 * The barrage's rhythm, and its two rate tiers as a fraction of it - see CANNON_COOLDOWN for why
 * these are derived rather than flat. One sixth each, which is what -0.6 s was against the 3.6 s
 * this ladder was authored around; tier 7 is still exactly two thirds of the base reload.
 */
const ARTILLERY_COOLDOWN = 3.789;
const ARTILLERY_RATE_TIER_FRAC = 1 / 6;
const ARTILLERY_RATE_TIER = -ARTILLERY_COOLDOWN * ARTILLERY_RATE_TIER_FRAC;

export const ARTILLERY: WeaponDef = Object.freeze({
  id: 'artillery',
  name: 'Heavy Artillery',
  kind: 'projectile',
  // Never consulted: `barrage` picks ground, not bodies. Declared to satisfy the def.
  targeting: 'nearest',
  pattern: 'barrage',
  behaviour: 'straight',
  // Fires into an empty field quite happily. It is not shooting AT anything.
  requiresTarget: false,
  base: Object.freeze({
    damage: 55.1,
    cooldown: ARTILLERY_COOLDOWN, // slow: this is a rhythm you plan around, not a gun you aim
    range: STRIKE_RADIUS_MAX,
    projectileSpeed: 0, // shells do not travel - they arrive
    projectileCount: 2,
    pierce: 0,
    knockback: 120,
    splashRadius: 75, // the damage IS the blast; there is no direct hit
    splashFrac: 1,
    turretTraverse: degToRad(720),
    fireArc: degToRad(180),
    heatPerSec: 0,
    heatCapacity: HEAT_CAPACITY_BASE,
    heatDispersion: 0,
    turnRate: 0,
    spreadAngle: 0,
    flightTime: 0.7, // the telegraph
    ammoCapacity: 0,
    reloadTime: 0,
  }),
  perLevel: Object.freeze([
    { splashRadius: 18 }, // T2  75 -> 93
    { cooldown: ARTILLERY_RATE_TIER }, // T3  3.789 -> 3.1575 s  (-1/6 of base)
    { damage: 22 }, // T4  55.1 -> 77.1
    { splashRadius: 18 }, // T5  93 -> 111
    { cooldown: ARTILLERY_RATE_TIER }, // T6  3.1575 -> 2.526 s  (2/3 base, as always)
    { projectileCount: 1 }, // T7  a third shell
  ]),
  reengageMul: 1,
  visualId: VIS_STRIKE_MARKER,
  muzzleOffset: 0,
  shellRadius: 0,
  beamColour: 0,
  beamWidth: 0,
  fireAlongFacing: false,
  detonateOnExpiry: true,
});

// ---------------------------------------------------------------------------------------------
// DRONES - a weapon that builds things instead of firing them
// ---------------------------------------------------------------------------------------------

/**
 * THE DRONE BAY. It has no muzzle, no shot and no target of its own; what it has is a BUILD TIMER.
 *
 * The stats are reused rather than invented, and each reuse is load-bearing:
 *
 *   cooldown         SECONDS TO BUILD ONE DRONE. Reusing the cooldown means Feed Systems - "every
 *                    weapon fires more often" - shortens the build, which is the same promise that
 *                    card makes everywhere else. A drone bay that ignored the rate passive would be
 *                    the one weapon in the game where it did nothing.
 *   projectileCount  MAX DRONES ALIVE. A drone IS this weapon's projectile; the tier ladder adding
 *                    one is the same shape as the artillery's third shell.
 *   range            ACQUISITION, doubled - see DRONE_ACQUIRE_MUL. Targeting Optics therefore
 *                    widens the patrol, which is what a player would expect it to do.
 *   splashRadius     THE DEATH BLAST, when a drone runs its magazine dry.
 *
 * WHAT IT SHOOTS IS NOT HERE. A drone fires the MACHINE GUN, one round at a time, resolved at this
 * weapon's own tier - see systems/drones.ts. Duplicating the Machine Gun's numbers into this def
 * would be two tables to keep in step for no gain, and "it fires a machine gun" is a sentence a
 * player can actually hold on to.
 */
/**
 * HOW LONG A DRONE TAKES TO BUILD, before the ladder and before any bonus.
 *
 * SET FROM THE OTHER END: the brief was that a Fern at tier 7 with Feed Systems maxed should hold
 * four drones MOST OF THE TIME. That build resolves to 15 x 0.65 x 0.5667 = 5.53 s.
 *
 * THE OBVIOUS ARITHMETIC IS WRONG, TWICE OVER, and it is worth knowing both ways before retuning.
 *
 *   "A drone lives L seconds, so four need one every L/4" wants the CONSTANT-FIRE life - 23.3 s
 *   from a 280-round magazine at a 0.083 s cadence. A drone fires about 41% of the time, so its
 *   real life is around 47 s.
 *
 *   Even with the right L the threshold is optimistic: 47/4 = 11.75 s would predict a full fleet
 *   at any build under that, and an 11.05 s build measures 57%. Deaths CLUSTER in dense waves
 *   rather than arriving evenly, and the fleet has to refill after each cluster.
 *
 * So it was swept rather than solved. Two seeds, tier 7 + Fern + maxed Feed:
 *
 *      base    build     mean fleet    % of the run at 4
 *       12 s   4.42 s     3.91          93%
 *       15 s   5.53 s     ?             ~89%    <- here, INTERPOLATED, not measured
 *       16 s   5.89 s     3.84          88%
 *       20 s   7.37 s     3.74          81%
 *       25 s   9.21 s     3.66          72%
 *       30 s  11.05 s     3.50          57%
 *       36 s  13.26 s     3.10          32%
 *
 * THE 15 ROW IS THE ONLY ONE NOT MEASURED. Every other row is two full runs; that one is read off
 * the curve between 12 and 16, which is close to straight at about 1.5 points per second. It is
 * written as a guess rather than rounded into the table because a number nobody measured must not
 * be able to pass for one that somebody did - re-run the sweep before quoting it at anyone.
 *
 * THE KNEE IS AROUND HERE. The curve costs about 1.5 points per second of base between 12 and 20,
 * 2.4 between 20 and 30, and 4.2 between 30 and 36 - so below this the base is being spent for very
 * little, and 12 bought five points for four seconds.
 *
 * IT LEAVES ROOM FOR THE CHASSIS AND THE CARD, which is the other half of not dropping straight to
 * 12. A player at tier 7 with neither builds at 9.75 s - so Fern's bay and a maxed Feed Systems
 * visibly buy something. At a 12 s base that gap nearly closes and the tier-7 fleet is full for
 * everyone regardless of what they built.
 *
 * THIS TABLE SUPERSEDES AN EARLIER ONE, and the difference is the whole reason to re-measure after
 * a mechanical change rather than trusting a number that was right last week. The first sweep ran
 * while Feed Systems still accelerated the drone's GUN, which shortened a drone's life to ~30 s;
 * a 25 s base measured 39% there and measures 72% here. Most of what that sweep was measuring was
 * a bug in what the rate card did to drones (see systems/drones.ts, DRONE_GUN_IGNORES).
 *
 * IT BARELY MOVES THE EARLY GAME. Tiers 1 and 2 cap the fleet at ONE, and one drone lives ~47 s
 * against a 15 s build - so the build time is not the binding constraint down there. What this
 * number controls is how fast a fleet of two, three or four REFILLS.
 */
export const DRONE_BUILD_SEC = 15;
/**
 * Per-tier build-time cut. Additive off the BASE, the way every other rate tier in this file is,
 * and DERIVED from it - the ladder is specified as percentages, so cutting the base cuts every
 * rung with it. 15 s runs down to 9.75 s by tier 7.
 */
export const DRONE_BUILD_TIER = -DRONE_BUILD_SEC * 0.1;
export const DRONE_BUILD_TIER_SMALL = -DRONE_BUILD_SEC * 0.05;
/** A drone engages anything inside this multiple of its gun's range. */
export const DRONE_ACQUIRE_MUL = 2;

export const DRONE: WeaponDef = Object.freeze({
  id: 'drone',
  name: 'Drones',
  kind: 'projectile',
  // Unused: the bay never selects a target. Each DRONE picks its own, from the bodies inside this
  // range (x DRONE_ACQUIRE_MUL) OF THE PLAYER - not of the drone, which is what stopped a chain of
  // kills from walking one off the screen. See systems/drones.ts.
  targeting: 'nearest',
  pattern: 'factory',
  behaviour: 'straight',
  // The bay builds whether or not anything is in range. It is a factory, not a gun.
  requiresTarget: false,
  base: Object.freeze({
    // NOT THE DRONE'S DAMAGE - the blast it leaves when its magazine runs dry. Its shooting is the
    // Machine Gun's damage, resolved at this weapon's tier.
    //
    // DELIBERATELY SMALL, and it used to be 55 - which was one artillery shell, and wrong for two
    // reasons. It made the drone's DEATH the payoff on a weapon whose whole point is the twenty
    // seconds of shooting before it, and at 55 over a 70 u circle a drone dying in a crowd of ten
    // early runts was worth 550 damage: an entire magazine, for free, by waiting. Anything a
    // player can farm by NOT using the weapon properly is the wrong number.
    //
    // 12 is about four of the drone's own rounds at tier 1 and two and a half at tier 7 - under a
    // second of its shooting. It still finishes a wounded runt standing next to it, which is all a
    // parting blast should do. The RADIUS is untouched: the drawn crater has to be the real one.
    damage: 12,
    cooldown: DRONE_BUILD_SEC,
    // Acquisition range BEFORE the x2. 130 is the Machine Gun's own reach, so a drone hunts twice
    // as far as it shoots and closes the rest.
    range: 130,
    projectileSpeed: 0,
    projectileCount: 1, // MAX DRONES
    pierce: 0,
    knockback: 0,
    splashRadius: 70,
    splashFrac: 1,
    turretTraverse: 0,
    fireArc: -1,
    heatPerSec: 0,
    heatCapacity: 0,
    heatDispersion: 0,
    turnRate: 0,
    spreadAngle: 0,
    flightTime: 0,
    ammoCapacity: 0,
    reloadTime: 0,
  }),
  perLevel: Object.freeze([
    { cooldown: DRONE_BUILD_TIER }, // T2 - builds faster
    { projectileCount: 1 }, // T3 - a second drone
    { cooldown: DRONE_BUILD_TIER }, // T4
    { projectileCount: 1 }, // T5 - a third
    { cooldown: DRONE_BUILD_TIER }, // T6
    { projectileCount: 1, cooldown: DRONE_BUILD_TIER_SMALL }, // T7 - a fourth, and a last trim
  ]),
  reengageMul: 1,
  // Unused by the bay itself - it spawns no projectile of its own. Its DRONES fire slugs; see
  // systems/drones.ts, which reads the Machine Gun's visual rather than this field.
  visualId: VIS_SLUG,
  muzzleOffset: 0,
  shellRadius: 5,
  beamColour: 0,
  beamWidth: 0,
  fireAlongFacing: false,
  // The dry-magazine blast goes out as a fused projectile with no contact, exactly as an artillery
  // shell does, so it reaches the crater FX and the splash path already written for that.
  detonateOnExpiry: true,
});

// ---------------------------------------------------------------------------------------------
// THE PHASE CANNON - one bolt, through everything, into the thickest part of the crowd.
//
// Character, in one line: it answers the question the Cannon refuses to. The Cannon commits to
// the single biggest body and ignores the crowd; this commits to the CROWD - the body with the
// most neighbours packed around it - and its bolt phases through every enemy, wreck and wall on
// the way, lands on that one target, and bursts. Nothing on the way in is touched; everything
// around the arrival point is.
//
// THE PHASING IS ALSO IN THE TARGETING. `densest` is the one strategy that does not filter for
// line of sight (see targeting.ts), so a Phase Cannon shoots the knot of bodies on the far side
// of a rock wall that every other gun has to walk around. That is the whole fantasy, and it is
// why the targeting rule and the flight behaviour ship as one weapon.
// ---------------------------------------------------------------------------------------------

/**
 * How far "around it" reaches when counting a body's neighbours: the cluster radius the densest
 * rule scores against. Sized a touch over the blast at tier 1 (55 u) so what the rule optimises
 * for is roughly what the burst then covers - a target chosen for neighbours the blast cannot
 * reach would make the rule read as broken.
 */
export const PHASE_CLUSTER_RADIUS = 80;

/**
 * 60 deg/s - the slowest turret in the game, a third under the Cannon's 90. The bolt cannot miss
 * once fired (it chases its mark through everything), so the traverse is where this weapon pays:
 * a crowd that forms BEHIND the mech is three full seconds of slew away, and repositioning so the
 * turret's job stays small is the skill the gun asks for.
 */
const PHASE_TURRET_TRAVERSE = degToRad(60);
const PHASE_FIRE_ARC = degToRad(14);

/** Same derived-rate-tier shape as the Cannon's - see CANNON_COOLDOWN for why. */
const PHASE_COOLDOWN = 1.6;
const PHASE_RATE_TIER = -PHASE_COOLDOWN * 0.15;

export const PHASE_CANNON: WeaponDef = Object.freeze({
  id: 'phase-cannon',
  // ONE MEDIUM TURRET, TWO GUNS THAT WANT IT. Declared here and nowhere else - the check runs
  // both directions. See WeaponDef.excludes.
  excludes: Object.freeze(['plasma'] as const),
  name: 'Phase Cannon',
  kind: 'projectile',
  targeting: 'densest',
  pattern: 'phase',
  behaviour: 'phase',
  requiresTarget: true,
  base: Object.freeze({
    // BELOW THE CANNON'S 44, deliberately: the Cannon buys its number by ignoring the crowd, and
    // a gun that hits the crowd for free cannot also match it on the direct hit. The blast makes
    // up the difference exactly when the target was chosen well.
    damage: 36,
    cooldown: PHASE_COOLDOWN,
    range: 260,
    projectileSpeed: 460,
    projectileCount: 1,
    pierce: 0,
    knockback: 90,
    // A MODERATE BURST at half strength: 18 into everything inside 55 u at tier 1. Enough to
    // matter against the packed chaff the targeting rule aims it into, nowhere near the
    // artillery's everything-in-the-circle blast.
    splashRadius: 55,
    splashFrac: 0.5,
    turretTraverse: PHASE_TURRET_TRAVERSE,
    fireArc: PHASE_FIRE_ARC,
    heatPerSec: 0,
    heatCapacity: HEAT_CAPACITY_BASE,
    heatDispersion: 0,
    turnRate: 0,
    spreadAngle: 0,
    // The bolt's whole flight budget, and its fuse when its mark dies mid-flight: it keeps going
    // on its last heading and BURSTS at the end of this (detonateOnExpiry), so a stolen kill
    // still costs the crowd something. 1.2 s at 460 u/s comfortably out-runs the 260 u range plus
    // a chase after a moving target.
    flightTime: 1.2,
    ammoCapacity: 0,
    reloadTime: 0,
  }),
  perLevel: Object.freeze([
    { damage: 8 }, // T2  36 -> 44
    { splashRadius: 12 }, // T3  55 -> 67
    { cooldown: PHASE_RATE_TIER }, // T4  1.60 -> 1.36 s
    { damage: 8 }, // T5  44 -> 52
    { splashRadius: 12 }, // T6  67 -> 79
    { cooldown: PHASE_RATE_TIER }, // T7  1.36 -> 1.12 s (0.70x base, as the Cannon's ladder)
  ]),
  reengageMul: 1,
  visualId: VIS_PLASMA,
  muzzleOffset: 30,
  shellRadius: 7,
  beamColour: 0,
  beamWidth: 0,
  fireAlongFacing: false,
  detonateOnExpiry: true,
});

// ---------------------------------------------------------------------------------------------
// THE MORTAR
//
// The Cannon's mount, asking the opposite question. The Cannon commits to the BIGGEST body in
// range and pays for it by ignoring everything else; the Mortar lobs one heavy shell into the
// THICKEST PART OF THE CROWD and does not care what is standing there.
//
// AND IT IS LAZY ABOUT TURNING, which is the whole character of the gun rather than a limitation
// of it. It looks for a clump inside a narrow cone in front of the barrel first, and only widens
// its search when that cone is empty - so it shoots what is already in front of it and swings
// across the yard only when the front has nothing to offer. A player who wants it pointed
// somewhere turns the mech.
//
// Damage and blast are the Heavy Artillery's, COPIED AND NOT REFERENCED. The two are different
// weapons that happen to start from one number, exactly the way the three cycle ladders start
// from one measured curve: retuning the barrage must not be able to reach this, and the guarantee
// is that there is no shared symbol to retune.
// ---------------------------------------------------------------------------------------------

/** The lob's rhythm, and its rate tiers as a fraction of it - see CANNON_COOLDOWN for why. */
const MORTAR_COOLDOWN = 2.0;
const MORTAR_RATE_TIER_FRAC = 0.15;
const MORTAR_RATE_TIER = -MORTAR_COOLDOWN * MORTAR_RATE_TIER_FRAC;

export const MORTAR: WeaponDef = Object.freeze({
  id: 'mortar',
  name: 'Mortar',
  kind: 'projectile',
  targeting: 'cone-densest',
  pattern: 'battery',
  behaviour: 'straight',
  requiresTarget: true,
  base: Object.freeze({
    damage: 55.1,
    cooldown: MORTAR_COOLDOWN,
    // Further than the Cannon, because a mortar's whole claim is that it reaches the crowd
    // forming rather than the one already on you.
    range: 330,
    // SLOW ENOUGH TO SEE. A lobbed shell that crossed the field as fast as the Cannon's would
    // read as a flat trajectory with a bigger bang, and the time in the air is what lets a clump
    // walk out from under it.
    projectileSpeed: 300,
    projectileCount: 1,
    pierce: 0,
    knockback: 120,
    // THE DAMAGE IS THE BLAST. There is no direct hit worth the name on a shell aimed at a gap
    // between bodies rather than at a body.
    splashRadius: 75,
    splashFrac: 1,
    // SLOWER THAN THE CANNON'S on the same mount, and the cone rule is why: a gun that hunts for
    // work near the barrel should be visibly reluctant to leave it.
    turretTraverse: degToRad(54),
    fireArc: CANNON_FIRE_ARC,
    heatPerSec: 0,
    heatCapacity: HEAT_CAPACITY_BASE,
    heatDispersion: 0,
    turnRate: 0,
    spreadAngle: 0,
    flightTime: 0, // it travels; reach is range / speed, not a fuse
    ammoCapacity: 0,
    reloadTime: 0,
  }),
  /**
   * TIERS 2-7. Index i applies at tier i+2, cumulatively. Deltas are ADDITIVE.
   *
   *   2 blast   3 rate of fire   4 damage   5 blast   6 rate of fire   7 a second shell
   *
   * Blast first because it is the tier that widens what a shell is FOR without asking the player
   * to aim differently, and the second shell last because it changes what the gun is - two lobs a
   * volley is a different relationship with a crowd than one bigger one.
   */
  perLevel: Object.freeze([
    { splashRadius: 12 }, // T2  75 -> 87
    { cooldown: MORTAR_RATE_TIER }, // T3  2.0 -> 1.7 s
    { damage: 20 }, // T4  55.1 -> 75.1
    { splashRadius: 12 }, // T5  87 -> 99
    { cooldown: MORTAR_RATE_TIER }, // T6  1.7 -> 1.4 s
    { projectileCount: 1 }, // T7  a second shell
    {}, // T8 - no ascension: the twin barrels are the Cannon's announcement and nothing else's
  ]),
  reengageMul: 0.55,
  visualId: VIS_SHELL,
  muzzleOffset: 30,
  shellRadius: 9,
  beamColour: 0,
  beamWidth: 0,
  fireAlongFacing: false,
  detonateOnExpiry: false,
});

// ---------------------------------------------------------------------------------------------
// THE PLASMA THROWER - low damage, and almost none of it is the bolt
// ---------------------------------------------------------------------------------------------
//
// IT SHARES THE MEDIUM TURRET WITH THE PHASE CANNON, so a run carries one or the other and never
// both (WeaponDef.excludes, declared on the Phase Cannon). The pair is a real choice rather than
// two versions of the same gun: the Phase Cannon is one enormous bolt through the thickest part
// of the crowd on a 1.6 s clock, and this is a stream of small ones that leaves the crowd on
// fire.
//
// IT RUNS ON HEAT AND IT IS NOT A LASER, which is a combination nothing else in the file has.
// `kind` is 'projectile' - there is a bolt, it flies, it can miss, it stops in the first body it
// reaches - and the limiter is the laser economy rather than a cooldown: heat while engaged,
// dispersion while idle, a latched cut-out at capacity. updateWeapons calls that pair `hot`, and
// the heat numbers are the SHORT LASER'S EXACTLY (7.5 gain, 8.5 shed) so the two guns share an
// uptime the player can already read off a bar they know.
//
// THE DAMAGE IS THE FIRE. The bolt itself is 9, which is deliberately not worth aiming; what it
// does is light the body, and a body alight pays `dpsFrac` of that hit every second for three
// seconds. That is why the burn is a FRACTION - see WeaponDef.burn - and it is why the two damage
// tiers on the ladder below are the whole gun rather than a small top-up.
//
// TARGETING IS THE POINT OF IT: highest health in a cone off the barrel that is NOT already
// burning (see targeting 'cone-coldest'). A gun that re-lit the same bruiser every tick would be
// a bad Phase Cannon; one that walks itself down the crowd, biggest first, skipping everything
// already alight, is the only weapon here that ASKS the player to hold the line and let it work.
// The cone starts at 30 degrees and widens by 30 until it finds one, so it is aimed with the
// whole mech exactly as the Mortar is.
const PLASMA_COOLDOWN = 0.27;
const PLASMA_HEAT_PER_SEC = 7.5;
const PLASMA_HEAT_DISPERSION = 8.5;
// Between the Short Laser's 165 and the Medium's 302.5, and nearer the short end: a stream of
// slow bolts that outranged what the player can see coming would be aimed on faith.
const PLASMA_RANGE = 230;
const PLASMA_TURRET_TRAVERSE = degToRad(75);
const PLASMA_FIRE_ARC = degToRad(20);

export const PLASMA: WeaponDef = Object.freeze({
  id: 'plasma',
  name: 'Plasma Thrower',
  kind: 'projectile',
  targeting: 'cone-coldest',
  pattern: 'battery',
  behaviour: 'straight',
  requiresTarget: true,
  base: Object.freeze({
    damage: 9,
    cooldown: PLASMA_COOLDOWN,
    range: PLASMA_RANGE,
    // SLOW, AND VISIBLY SO. A gout of fire that crossed the gap instantly would be a laser with
    // extra steps; at 260 the player can watch it travel, which is what sells it as a thrower and
    // what makes leading a runner an actual skill.
    projectileSpeed: 260,
    projectileCount: 1,
    // STOPS IN THE FIRST BODY IT REACHES, as specced. Piercing would light a whole file of
    // enemies from one bolt and make the "not already burning" rule pointless.
    pierce: 0,
    knockback: 0,
    // A VERY SMALL SPLASH THAT IS ALMOST NO DAMAGE AND ALL FIRE. `splashFrac` at a fifth means the
    // blast is a rounding error next to the bolt; what it actually does is LIGHT what it touches,
    // at the rate a direct hit would have (see applySplash - the burn deliberately does not fall
    // off with the damage).
    //
    // SMALL ON PURPOSE. At 26 it catches a neighbour or two pressed up against the body that was
    // hit, which is a crowd starting to catch rather than a crowd going up at once - and it keeps
    // the "aim at what is not already burning" rule meaningful, which a wide blast would not.
    splashRadius: 26,
    splashFrac: 0.2,
    turretTraverse: PLASMA_TURRET_TRAVERSE,
    fireArc: PLASMA_FIRE_ARC,
    heatPerSec: PLASMA_HEAT_PER_SEC,
    heatCapacity: HEAT_CAPACITY_BASE,
    heatDispersion: PLASMA_HEAT_DISPERSION,
    turnRate: 0,
    spreadAngle: 0,
    flightTime: 0,
    ammoCapacity: 0,
    reloadTime: 0,
  }),
  // THE SPECCED LADDER, rung for rung: capacity, damage, a little more reach, capacity, better
  // dispersion, damage. Every rung buys either SECONDS OF FIRE or the size of the fire - which is
  // the same shape as the laser ladder and for the same reason (weapons.ts header).
  perLevel: Object.freeze([
    { heatCapacity: 40 },
    { damage: 4 },
    { range: 25 },
    { heatCapacity: 40 },
    { heatDispersion: PLASMA_HEAT_DISPERSION * 0.35 },
    { damage: 5 },
    {},
  ]),
  // A BODY BURNS FOR THREE SECONDS AT 90% OF THE HIT THAT LIT IT, so a single bolt is worth
  // roughly 2.7x its own damage if nothing tops it up - and topping it up is free, because
  // `ignite` refreshes rather than stacks. That asymmetry is the gun: spreading fire across the
  // crowd pays, hosing one body does not.
  burn: Object.freeze({ dpsFrac: 0.9, seconds: 3 }),
  reengageMul: 1,
  visualId: VIS_FLAME,
  muzzleOffset: 24,
  shellRadius: 6,
  beamColour: 0,
  beamWidth: 0,
  fireAlongFacing: false,
  detonateOnExpiry: false,
});

// ---------------------------------------------------------------------------------------------
// TOXIC SLUDGE - the only gun in the yard that shoots at where you have BEEN
// ---------------------------------------------------------------------------------------------
//
// NO MOUNT. It is the first weapon in the catalog that occupies neither turret, which is why it
// composes with everything: any chassis can carry it beside whatever it already has, and the
// large-turret and medium-turret pairs stay the only exclusive choices in the game.
//
// IT AIMS, AND IT AIMS BADLY. `rear-cone` picks the BIGGEST thing in a HUNDRED-degree cone behind
// the mech - 50 degrees either side of its back - and the throw goes at that bearing with up to 20
// degrees of error. There is still no turret to slew and nothing is tracked between shots: the
// choice is made fresh at the trigger, out of whatever is behind you at that moment.
//
// OUTSIDE THE CONE IS NOT A TARGET, however big it is and however hard it is chasing. That is the
// cost of the gun facing backwards, and it is what makes WHICH WAY YOU WALK the thing you are
// actually deciding.
//
// AIM AND ERROR ARE BOTH LOAD-BEARING. Aim with no error is a slow shotgun that happens to leave a
// puddle; error with no aim is weather, and weather does not reward looking behind you. Together
// they answer "something big is following me" with "then there is now acid roughly between us".
//
// SO IT IS A WEAPON ABOUT RETREATING, and that is the whole design. Every other gun rewards
// facing the horde; this one pays for turning your back on it and walking, laying ground behind
// you that the crowd has to cross. The rear cone is what stops it firing into empty yard: the
// magazine is three shots and a six-second reload, and a shot thrown at nobody is a third of the
// weapon spent on nothing.
//
// THE DAMAGE IS THE GROUND, not the glob. The glob does a little on the way past - it carries
// enough pierce to reach where it is going rather than stopping in the first body, so a crowd
// packed right behind the mech takes a small hit as the spread goes through it - and then the
// pools do the work, for four seconds each, to anything standing in them.
const SLUDGE_RELOAD = 6;
// THE AIM ERROR, END TO END - so a throw lands within 20 degrees either side of the bearing to
// whatever it picked. It is NOT a fan: one glob leaves per throw, and this is how wrong that throw
// is allowed to be. See fireSludge.
const SLUDGE_SPREAD = degToRad(40);
// The DETECTION reach, not the throw: how far behind the mech something has to be before this is
// worth a shot at all. The throw itself is `flightTime` x `projectileSpeed`, about 68 units.
const SLUDGE_DETECT_RANGE = 340;

export const SLUDGE: WeaponDef = Object.freeze({
  id: 'sludge',
  name: 'Toxic Sludge',
  kind: 'projectile',
  targeting: 'rear-cone',
  pattern: 'sludge',
  behaviour: 'straight',
  // A GATE RATHER THAN A TARGET - but still required, because "no target" is exactly the answer
  // that must stop the volley. See the header.
  requiresTarget: true,
  base: Object.freeze({
    // The glob's own hit. Small on purpose: `puddle.dpsFrac` multiplies it into what the ground
    // does, so this number is really the weapon's damage dial wearing its smallest hat.
    //
    // HALVED FROM 8, AND THE WHOLE GUN CAME WITH IT - which is the reason to turn THIS dial rather
    // than `puddle.dpsFrac`. Measured at tier 7 with every passive, sludge was gaining x3.27 against
    // a loadout gaining x1.98, and moved from tenth place stripped to fourth place equipped: the
    // only gun in the set that changes rank. The pool multiplies damage by an area the blast passive
    // widens, so damage and blast compound on one weapon, and the base being small is exactly what
    // hid how steep that curve was.
    damage: 4,
    cooldown: 1.15,
    range: SLUDGE_DETECT_RANGE,
    projectileSpeed: 150,
    // ONE GLOB PER THROW. The fan is laid across the MAGAZINE rather than across a volley - see
    // fireSludge - so emptying a rack still paints the whole arc, one pool at a time, and a
    // capacity tier makes the wall finer instead of making each throw bigger.
    projectileCount: 1,
    // ENOUGH TO REACH THE GROUND IT IS AIMED AT. The hook that drops a puddle hangs off the
    // glob's EXPIRY (systems/projectiles.ts), so a glob stopped by a body would leave its pool at
    // the mech's feet instead of behind it. Over a 68-unit throw nothing can absorb this many
    // passes, which makes expiry the only way this round ever ends.
    pierce: 250,
    knockback: 0,
    // THE PUDDLE'S RADIUS, NOT A BLAST. `splashFrac` is 0, so nothing in the damage path ever
    // treats this as splash; it is read once, by the puddle hook, as the size of the pool.
    splashRadius: 42,
    splashFrac: 0,
    // 180 degrees of both, so the "laid on target" gate in updateWeapons can never hold fire on a
    // weapon whose target is behind it by definition.
    turretTraverse: degToRad(180),
    fireArc: degToRad(180),
    heatPerSec: 0,
    heatCapacity: HEAT_CAPACITY_BASE,
    heatDispersion: 0,
    turnRate: 0,
    spreadAngle: SLUDGE_SPREAD,
    // THE THROW, and the one number that makes this a short-ranged weapon on a long-ranged
    // trigger. An authored flight time wins over range/speed - see resolveWeaponStats.
    flightTime: 0.45,
    // THREE SHOTS AND A LONG WAIT. The shallowest magazine in the game by some distance, which is
    // what keeps a weapon that needs no aiming from simply being free.
    ammoCapacity: 3,
    reloadTime: SLUDGE_RELOAD,
  }),
  // The specced ladder, rung for rung: damage, magazine, pools, damage, reload, pools.
  perLevel: Object.freeze([
    { damage: 3 },
    { ammoCapacity: 2 },
    { splashRadius: 12 },
    { damage: 4 },
    { reloadTime: -1 },
    { splashRadius: 14 },
    {},
  ]),
  // FOUR SECONDS OF GROUND AT 2.4x THE GLOB. A fraction rather than a rate of its own, exactly as
  // WeaponDef.burn is and for the same reason: the two damage tiers and Jade's chassis bonus all
  // raise what the pool does without any of them naming a pool.
  puddle: Object.freeze({ dpsFrac: 2.4, seconds: 4 }),
  reengageMul: 1,
  visualId: VIS_SLUDGE,
  // BEHIND THE MECH. Every other muzzle offset pushes a round out in front of the barrel; this
  // one is negated by fireSludge, which throws along the mech's back.
  muzzleOffset: 18,
  shellRadius: 5,
  beamColour: 0,
  beamWidth: 0,
  fireAlongFacing: true,
  detonateOnExpiry: false,
});

export const WEAPON_CATALOG: readonly WeaponDef[] = Object.freeze([
  CANNON,
  LASER_SHORT,
  LASER_MEDIUM,
  LASER_LONG,
  MISSILE_SHORT,
  MISSILE_LONG,
  MACHINE_GUN,
  FLAK_CANNON,
  ARTILLERY,
  DRONE,
  PHASE_CANNON,
  // APPENDED, and that is deliberate rather than tidy: `levelUp.stacks` and every `tier` unlock
  // condition are keyed by catalog index, so inserting beside the other shell guns would renumber
  // half the table and silently repoint six conditions at the wrong cards.
  MORTAR,
  PLASMA,
  SLUDGE,
]);

/** Catalog index for a weapon id, or -1. Used at run start to install the hero's starting weapon. */
export function weaponDefIndex(id: WeaponId): number {
  for (let i = 0; i < WEAPON_CATALOG.length; i++) {
    if (WEAPON_CATALOG[i].id === id) return i;
  }
  return -1;
}
