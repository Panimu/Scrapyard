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
  | 'artillery'
  | 'drone';

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
/** A drone's round. A slug like the Machine Gun's, because that is literally what it fires. */
export const VIS_DRONE_ROUND = 5;

/**
 * Target-selection strategies.
 *
 * `'highest-hp'` is the Cannon's specced rule and the identity of this iteration.
 * `'nearest'` is not a demo: SCATTER's Flak Battery trait rewrites shells 2..n to it
 * (DESIGN.md §8.2), and it is what proves the strategy seam actually generalises.
 */
export type TargetingId = 'highest-hp' | 'nearest' | 'lowest-hp'; // grows: | 'densest'

export type FirePatternId = 'battery' | 'beam' | 'spread' | 'barrage' | 'factory';

export type BehaviourId = 'straight' | 'homing'; // grows: | 'arc'

/**
 * BehaviourId -> index into PROJECTILE_BEHAVIOURS, which is what the pool stores (a Uint8Array).
 * Indices are part of the determinism key: they are written into ProjectilePool.behaviour and
 * therefore into every replay hash. APPEND ONLY - never renumber.
 */
export const BEHAVIOUR_STRAIGHT = 0;
export const BEHAVIOUR_HOMING = 1;

export const BEHAVIOUR_ID: Readonly<Record<BehaviourId, number>> = Object.freeze({
  straight: BEHAVIOUR_STRAIGHT,
  homing: BEHAVIOUR_HOMING,
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
 * 90 deg/s = 1.5707963267948966 rad/s, DOWN FROM 220.
 *
 * THE OLD NUMBER WAS CHOSEN SO THE TURRET WAS ALWAYS LAID ON: 220 deg/s sweeps 278 deg during a
 * 1.263 s cooldown against a 180 deg worst-case re-lay, so switching targets cost the Cannon
 * nothing and it fired on essentially every cooldown expiry. That is most of why a single-target
 * gun with no splash, no heat and no magazine sat at the top of the damage table - measured with
 * every weapon in the game held at tier 7, it took 18.9% of a run's damage against a four-way
 * cluster at 14.2%.
 *
 * At 90 deg/s the sweep is 114 deg per cooldown at tier 1 and 80 deg at tier 7, against that same
 * 180 deg worst case. So the gun now HAS TO TRACK, and it loses shots exactly when the horde is
 * spread around the mech rather than in front of it - a situational cost rather than a flat one,
 * and one that grows as its own fire-rate tiers land.
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
const CANNON_TURRET_TRAVERSE = degToRad(90);

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
  ]),
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
    perLevel: laserTiers(damagePerSec, heatPerSec, heatDispersion),
    chainsFrom,
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
export const LASER_SHORT = laser('laser-short', 'Short Laser', 165, 46, 7.5, 8.5, 0x3be86b, 1.6);
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
export const LASER_LONG = laser('laser-long', 'Long Laser', 473, 92, 25.5, 8.0, 0xff4d4d, 2.7);

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
//   SRM              2       15 deg   3.0 s     62     1.15 s  4.8 rad/s  ~345
//   LRM              3       10 deg   4.2 s     42     2.00 s  1.95 rad/s ~660
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
): WeaponDef {
  return Object.freeze({
    id,
    name,
    kind: 'projectile' as WeaponKind,
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
  2, 15, 3.0, 62, 280, 300, 1.15, 4.8, 0, 0, 210, VIS_MISSILE_SHORT,
  Object.freeze([
    { cooldown: -0.45 }, // T2  3.00 -> 2.55 s
    { turnRate: 0.7 }, // T3  2.4 -> 3.1 rad/s
    { damage: 22 }, // T4  62 -> 84
    { cooldown: -0.45 }, // T5  2.55 -> 2.10 s
    { turnRate: 0.7 }, // T6  3.1 -> 3.8 rad/s
    { projectileCount: 1 }, // T7  a third missile
  ]),
);

export const MISSILE_LONG = missile(
  'missile-long', 'Long Missiles',
  3, 10, 4.2, 42, 430, 330, 2.0, 1.95, 0, 0, 160, VIS_MISSILE_LONG,
  Object.freeze([
    { cooldown: -0.6 }, // T2  4.20 -> 3.60 s
    { turnRate: 0.45 }, // T3  1.30 -> 1.75 rad/s
    { damage: 15 }, // T4  42 -> 57
    { projectileCount: 1 }, // T5  a fourth missile
    { flightTime: 0.6 }, // T6  2.0 -> 2.6 s, reach ~860
    { projectileCount: 1 }, // T7  a fifth missile
  ]),
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
    turretTraverse: degToRad(900), // whips around; it has to keep up with its own rate of fire
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
export const DRONE_BUILD_SEC = 30;
/** Per-tier build-time cut. Additive off the BASE, the way every other rate tier in this file is. */
export const DRONE_BUILD_TIER = -DRONE_BUILD_SEC * 0.1;
export const DRONE_BUILD_TIER_SMALL = -DRONE_BUILD_SEC * 0.05;
/** A drone engages anything inside this multiple of its gun's range. */
export const DRONE_ACQUIRE_MUL = 2;

export const DRONE: WeaponDef = Object.freeze({
  id: 'drone',
  name: 'Drones',
  kind: 'projectile',
  // Unused: the bay never selects a target. Each DRONE picks its own, by proximity, from where it
  // is standing rather than from where the player is - which is the whole point of sending it out.
  targeting: 'nearest',
  pattern: 'factory',
  behaviour: 'straight',
  // The bay builds whether or not anything is in range. It is a factory, not a gun.
  requiresTarget: false,
  base: Object.freeze({
    // Not the drone's damage - the blast it leaves when its magazine runs dry. Its shooting is the
    // Machine Gun's damage, resolved at this weapon's tier.
    damage: 55,
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
  visualId: VIS_DRONE_ROUND,
  muzzleOffset: 0,
  shellRadius: 5,
  beamColour: 0,
  beamWidth: 0,
  fireAlongFacing: false,
  // The dry-magazine blast goes out as a fused projectile with no contact, exactly as an artillery
  // shell does, so it reaches the crater FX and the splash path already written for that.
  detonateOnExpiry: true,
});

export const WEAPON_CATALOG: readonly WeaponDef[] = Object.freeze([
  CANNON,
  LASER_SHORT,
  LASER_MEDIUM,
  LASER_LONG,
  MISSILE_SHORT,
  MISSILE_LONG,
  MACHINE_GUN,
  ARTILLERY,
  DRONE,
]);

/** Catalog index for a weapon id, or -1. Used at run start to install the hero's starting weapon. */
export function weaponDefIndex(id: WeaponId): number {
  for (let i = 0; i < WEAPON_CATALOG.length; i++) {
    if (WEAPON_CATALOG[i].id === id) return i;
  }
  return -1;
}
