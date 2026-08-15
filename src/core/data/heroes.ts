/**
 * THE SIXTEEN MECHS.
 *
 * STATS ARE STILL IDENTICAL ACROSS ALL SIXTEEN. The one thing that differs is the WEAPON each
 * starts with, unlocked at tier 1 - which makes picking a mech a loadout decision rather than a
 * cosmetic one, without opening the balance surface that sixteen distinct stat blocks would.
 *
 * THE PAINT TELLS YOU WHAT YOU ARE HOLDING, for the four weapons that have a colour to match:
 *
 *     green chassis  -> Short Laser   (green beam)
 *     blue chassis   -> Medium Laser  (blue beam)
 *     red chassis    -> Long Laser    (red beam)
 *     yellow chassis -> Cannon        (no laser is yellow, and the Cannon is the odd one out)
 *
 * WHO OPENS WITH WHAT, and it is NOT an even split any more:
 *
 *     Short Laser     moss, jade
 *     Medium Laser    slate, cobalt
 *     Long Laser      ember, rust
 *     Cannon          amber, brass
 *     Short Missiles  ash                            <- one
 *     Long Missiles   onyx, vermilion, indigo        <- three
 *     Machine Gun     bone, copper
 *     Heavy Artillery plum, fern
 *
 * Two-per-weapon was a real property and it is worth naming what replaced it: a player who has
 * used one green mech knows what the other green mech does, and that no longer holds for the
 * missile racks. Onyx was moved to the long rack deliberately; rebalancing to 2/2 means moving
 * vermilion or indigo to the short rack, which is a one-line change if the split starts to grate.
 *
 * WHEN FULLER VARIETY RETURNS, nothing structural has to change:
 *   - `player` and `weapon` are already multiplier maps consumed by resolvePlayerStats /
 *     resolveWeaponStats. Fill them in and the difference is live.
 *   - `HeroTrait` and the HERO_TRAITS registry in data/traits.ts are already wired into
 *     updateWeapons. Register a trait and the hook fires.
 * The two things to preserve at that point: no hero may be strictly dominated by another, and
 * every hero's resolved moveMaxSpeed must stay above the worst-case late-game runt speed
 * (~144.4 u/s at t=900, see tuning.ts) or kiting - the whole genre - quietly breaks.
 */

import type { WeaponId } from '../content/weaponCatalog.js';
import type { PlayerStatKey, WeaponStatKey } from './stats.js';
import type { UpgradeId } from './upgrades.js';
import type { UnlockCond } from './unlocks.js';
import type { World } from '../types.js';

export type HeroId =
  | 'slate'
  | 'moss'
  | 'ember'
  | 'amber'
  | 'cobalt'
  | 'jade'
  | 'rust'
  | 'brass'
  | 'onyx'
  | 'ash'
  | 'vermilion'
  | 'indigo'
  | 'bone'
  | 'copper'
  | 'plum'
  | 'fern';

/**
 * The mutable per-shell context handed to `HeroTrait.onFireShell`, owned by updateWeapons.
 * A trait may retarget the shell (dirX/dirY) or change what it carries (damage/knockback).
 * `shellIndex` is 0-based within this volley, so a trait can treat the first shell specially.
 *
 * Unused while variety is deferred, but the type is part of updateWeapons' contract.
 */
export interface ShotCtx {
  dirX: number;
  dirY: number;
  damage: number;
  knockback: number;
  /** Dense index of the enemy this shell was aimed at, or -1. */
  targetDense: number;
  shellIndex: number;
}

/**
 * Optional hooks a hero may implement. Both are called from the weapon system's hot path, so an
 * implementation must not allocate.
 *
 * The hooks exist so a hero can bend the Cannon without the Cannon knowing about heroes - the
 * same separation that lets weapons 2..12 arrive as pure data. No hero registers one today.
 */
export interface HeroTrait {
  /**
   * Rewrites the target list produced by the weapon's targeting strategy, in place.
   * Receives the candidate dense indices and how many are valid; returns the new count.
   */
  readonly modifyTargets?: (world: World, targets: Int32Array, count: number) => number;
  /** Called once per shell, immediately before it is spawned. Mutate `shot` in place. */
  readonly onFireShell?: (world: World, shot: ShotCtx) => void;
}

/**
 * A chassis' bonus to ONE named weapon.
 *
 * `add` joins the additive stage of resolution and `mul` the multiplicative one, exactly as an
 * upgrade card's effects do (see data/stats.ts). Both are needed and neither substitutes for the
 * other: "+1 pierce" has to be additive because the Cannon's base pierce is 0 and a multiplier on
 * zero is nothing, and "50% better dispersion" has to be multiplicative or it would mean something
 * different at every tier of the weapon.
 */
export interface HeroWeaponBonus {
  readonly mul?: Readonly<Partial<Record<WeaponStatKey, number>>>;
  readonly add?: Readonly<Partial<Record<WeaponStatKey, number>>>;
}

export interface HeroDef {
  readonly id: HeroId;
  /**
   * WHAT A RUN HAS TO DO TO EARN THIS CHASSIS. A chassis whose condition is unmet is locked and
   * cannot be picked. See data/unlocks.ts for the vocabulary.
   *
   * EVERY ENTRY IS `always` TODAY, WHICH IS NOT A DESIGN - IT IS AN ABSENCE OF ONE. The conditions
   * are still to be written, and an invented placeholder is worse than none: it locks a chassis
   * behind a number nobody chose, and the moment it ships it is a thing players have played around
   * and a thing this file has to be argued out of. `always` locks nothing, so the roster behaves
   * exactly as it did before unlocks existed until the real conditions land here.
   */
  readonly unlock: UnlockCond;
  readonly name: string;
  /** One line for the select screen. Says what the chassis is and what its bonus does. */
  readonly identity: string;
  /** Sprite key produced by tools/prepare_assets.mjs - see docs/ASSET_MANIFEST.md. */
  readonly sprite: string;
  /**
   * How the chassis moves, which is the only thing the renderer needs to know about the art.
   * `walk` advances the leg cycle by DISTANCE TRAVELLED, so a standing mech stands still instead
   * of moon-walking. `hover` advances it on the clock as well, because a hover that goes
   * completely still has landed. Must match `legs` in tools/make-mechs.mjs.
   */
  readonly gait: 'walk' | 'hover';
  /**
   * The gun this chassis walks in holding, at tier 1 - or `null` for a chassis that walks in
   * holding nothing.
   *
   * `null` is not a degenerate case to be defended against, it is Plum: a mech that opens with an
   * Energy Shield and no weapon at all, and kills the first cycle by letting things break itself
   * on the rim. Every consumer already guarded on "starting weapon not found in the catalog"
   * because a fixture catalog may omit one, so the null path is the path that was already there.
   */
  readonly startingWeapon: WeaponId | null;
  /**
   * A non-weapon card this chassis walks in holding, at tier 1. Seeded exactly like the starting
   * weapon: one stack taken, so the pool offers its TIER 2 next rather than offering the unlock of
   * something already in your hands.
   */
  readonly startingUpgrade?: UpgradeId;
  /** Multipliers on the tuning base. Absent key = x1. */
  readonly player: Readonly<Partial<Record<PlayerStatKey, number>>>;
  /**
   * Multipliers on EVERY weapon's authored stats. Absent key = x1. Empty for every hero today, and
   * deliberately so: a blanket "+8% damage" is the least interesting thing a chassis can be. See
   * `weaponBonus` for the version that says something.
   */
  readonly weapon: Readonly<Partial<Record<WeaponStatKey, number>>>;
  /**
   * THE CHASSIS' IDENTITY: a bonus to ONE named weapon, applied whenever that weapon is held -
   * not only when it is the opener. Slate's dispersion bonus is a bonus to the Medium Laser, so a
   * Slate that finds a second Medium Laser mid-run... has the same one gun, but a Slate that picks
   * up the Medium Laser having opened with something else still gets it.
   *
   * Absent on a chassis with no bonus yet. The eight at the top of the catalog have one; the eight
   * below them are still plain, and are the obvious place for the next pass.
   */
  readonly weaponBonus?: Readonly<Partial<Record<WeaponId, HeroWeaponBonus>>>;
}

/**
 * Index in this array is `WorldConfig.heroId`, and THE ORDER HERE IS THE ORDER ON THE SELECT
 * SCREEN - the picker walks this array. That makes it a presentation decision as much as a data
 * one, so it is reordered when the roster wants reordering.
 *
 * WHAT THAT COSTS, exactly. The index is written into a run's config and into its hash, so a
 * reorder means an OLD RECORDED RUN would replay on a different mech. Nothing persists a run
 * today - `scrapyard.settings.v1` stores `lastHeroId` and nothing else, so the entire blast
 * radius is that the picker may open on a different chassis once after an update. The moment
 * replays are saved anywhere, this array is frozen and new chassis go on the end.
 *
 * SIXTEEN CHASSIS, TWO PER WEAPON, ONE LIGHT AND ONE HEAVY. Every one of the eight weapons is
 * somebody's opener, and each has a light frame and a heavy frame that look nothing alike -
 * different legs, different weapon mount, different torso (tools/make-mechs.mjs asserts that no
 * two share a silhouette). The stat blocks are still empty, so today the pairing is a promise the
 * art is making on the simulation's behalf: when hero variety lands, the light one takes speed
 * and the heavy one takes armour, and the roster is already shaped for it.
 *
 * Named after their paint, deliberately: a name like "Bulwark" would promise a behaviour these
 * chassis do not yet have.
 */
export const HERO_CATALOG: readonly HeroDef[] = Object.freeze([
  {
    id: 'slate',
    unlock: { kind: 'always' },
    name: 'Slate',
    identity:
      'Light biped, twin gun pods. Opens with the Medium Laser, and vents its heat 50% faster.',
    sprite: 'mech_slate',
    gait: 'walk',
    startingWeapon: 'laser-medium',
    player: {},
    weapon: {},
    // Dispersion, not capacity. Uptime is dispersion / (generation + dispersion) with no
    // capacity term at all, so this is the one laser stat that actually buys sustained DPS -
    // the Medium Laser's duty cycle goes from 28% to 37%.
    weaponBonus: { 'laser-medium': { mul: { heatDispersion: 1.5 } } },
  },
  {
    id: 'moss',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Moss',
    identity:
      'Light strider, rotary drums. Opens with the Short Laser at double reach.',
    sprite: 'mech_moss',
    gait: 'walk',
    startingWeapon: 'laser-short',
    player: {},
    weapon: {},
    // 165 u to 330 u, and it is a fix as much as a bonus: measured against the real horde, the
    // Short Laser reaches 9% of its arithmetic ceiling at tier 7 because it has nothing inside it
    // most of the time. Doubling the reach is the only lever the weapon's own ladder does not
    // sell - no laser tier buys range.
    weaponBonus: { 'laser-short': { mul: { range: 2 } } },
  },
  {
    id: 'ember',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Ember',
    identity:
      'Light strider, one heavy cannon. Opens with the Long Laser, 30% hotter-hitting.',
    sprite: 'mech_ember',
    gait: 'walk',
    startingWeapon: 'laser-long',
    player: {},
    weapon: {},
    // Damage only. The Long Laser's heat generation is untouched, so this is 30% more damage
    // per second of fire for exactly the same duty cycle - the cleanest bonus on the roster.
    weaponBonus: { 'laser-long': { mul: { damage: 1.3 } } },
  },
  {
    id: 'amber',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Amber',
    identity:
      'Heavy biped, one heavy cannon. Opens with the Cannon, and its shells punch through.',
    sprite: 'mech_amber',
    gait: 'walk',
    startingWeapon: 'cannon',
    player: {},
    weapon: {},
    // ADDITIVE, and it has to be: the Cannon's base pierce is 0, so a multiplier would be
    // worth precisely nothing. Amber's shells hit two bodies from tier 1, and the tier-7
    // pierce rung stacks on top for three.
    weaponBonus: { cannon: { add: { pierce: 1 } } },
  },
  {
    id: 'onyx',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Onyx',
    identity:
      'Heavy quad, boxed missile racks. Opens with the Long Missiles, and fires one more.',
    sprite: 'mech_onyx',
    gait: 'walk',
    startingWeapon: 'missile-long',
    player: {},
    weapon: {},
    // Additive for the same reason as Amber's pierce, and it compounds with the ladder: the
    // long rack buys a fourth missile at T5 and a fifth at T7, so a finished Onyx throws six.
    weaponBonus: { 'missile-long': { add: { projectileCount: 1 } } },
  },
  {
    id: 'ash',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Ash',
    identity:
      'Light biped, boxed missile racks. Opens with the Short Missiles, rearmed 20% faster.',
    sprite: 'mech_ash',
    gait: 'walk',
    startingWeapon: 'missile-short',
    player: {},
    weapon: {},
    // The short rack's limiter is its COOLDOWN - the rearm between volleys - so that is the
    // stat here. 20% less time, 3.0 s to 2.4 s, and 2.1 s to 1.68 s once the ladder is spent.
    weaponBonus: { 'missile-short': { mul: { cooldown: 0.8 } } },
  },
  {
    id: 'bone',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Bone',
    identity:
      'Light strider, twin gun pods. Opens with the Machine Gun, 30% harder-hitting.',
    sprite: 'mech_bone',
    gait: 'walk',
    startingWeapon: 'machine-gun',
    player: {},
    weapon: {},
    // Per ROUND, and the machine gun fires two at a time from a 200-round magazine, so the
    // 30% lands on every one of them and on the whole magazine's worth of damage.
    weaponBonus: { 'machine-gun': { mul: { damage: 1.3 } } },
  },
  {
    id: 'plum',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Plum',
    identity:
      'Heavy biped, no gun at all. Nothing but an Energy Shield, recharging 60% faster. Kill with it.',
    sprite: 'mech_plum',
    gait: 'walk',
    // NO GUN, AND NO FREE CARD EITHER. The only chassis in the game that opens with nothing to
    // shoot with, and its only way to hurt anything is the shield's backlash: 30 damage into
    // whatever breaks the rim, against a first-cycle Rustling's 22 HP. Every one of Plum's early
    // kills is something that killed itself on the field, one per recharge, and the first level
    // has to be earned out of those before it holds a weapon at all.
    //
    // That is a far harder start than any other chassis has, and it is meant to be. See world.ts
    // for what it measures at.
    startingWeapon: null,
    startingUpgrade: 'p-shield',
    // 60% less recharge time: 20 s to 8 s at tier 1, 9 s to 3.6 s with the ladder spent.
    // This is a PLAYER multiplier on a stat whose base is 0 and whose whole value arrives
    // from the card - which is exactly the case the resolution order had to move to support
    // (see data/stats.ts).
    player: { shieldRecharge: 0.4 },
    weapon: {},
  },
  {
    id: 'jade',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Jade',
    identity:
      'Heavy biped, forward claw arms. Opens with the Short Laser.',
    sprite: 'mech_jade',
    gait: 'walk',
    startingWeapon: 'laser-short',
    player: {},
    weapon: {},
  },
  {
    id: 'rust',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Rust',
    identity:
      'Heavy quad, spine-slung artillery tube. Opens with the Long Laser.',
    sprite: 'mech_rust',
    gait: 'walk',
    startingWeapon: 'laser-long',
    player: {},
    weapon: {},
  },
  {
    id: 'brass',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Brass',
    identity:
      'Light hover, one heavy cannon. Opens with the Cannon.',
    sprite: 'mech_brass',
    gait: 'hover',
    startingWeapon: 'cannon',
    player: {},
    weapon: {},
  },
  {
    id: 'cobalt',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Cobalt',
    identity:
      'Heavy quad, twin gun pods. Opens with the Medium Laser.',
    sprite: 'mech_cobalt',
    gait: 'walk',
    startingWeapon: 'laser-medium',
    player: {},
    weapon: {},
  },
  {
    id: 'vermilion',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Vermilion',
    identity:
      'Light hover, rotary drums. Opens with the Long Missiles.',
    sprite: 'mech_vermilion',
    gait: 'hover',
    startingWeapon: 'missile-long',
    player: {},
    weapon: {},
  },
  {
    id: 'indigo',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Indigo',
    identity:
      'Heavy strider, boxed missile racks. Opens with the Long Missiles.',
    sprite: 'mech_indigo',
    gait: 'walk',
    startingWeapon: 'missile-long',
    player: {},
    weapon: {},
  },
  {
    id: 'copper',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Copper',
    identity:
      'Heavy quad, rotary drums. Opens with the Machine Gun.',
    sprite: 'mech_copper',
    gait: 'walk',
    startingWeapon: 'machine-gun',
    player: {},
    weapon: {},
  },
  {
    id: 'fern',
    unlock: { kind: 'always' }, // TODO: condition to be defined
    name: 'Fern',
    identity:
      'Light hover, forward claw arms. Opens with the Heavy Artillery.',
    sprite: 'mech_fern',
    gait: 'hover',
    startingWeapon: 'artillery',
    player: {},
    weapon: {},
  },
] as const) as readonly HeroDef[];

/** Catalog index for a hero id, or -1. */
export function heroIndex(id: HeroId): number {
  for (let i = 0; i < HERO_CATALOG.length; i++) {
    if (HERO_CATALOG[i].id === id) return i;
  }
  return -1;
}
