/**
 * THE EIGHT MECHS.
 *
 * Eight because the art gives exactly eight top-down chassis in robot-pack.
 *
 * STATS ARE STILL IDENTICAL ACROSS ALL EIGHT. The one thing that differs is the WEAPON each starts
 * with, unlocked at tier 1 - which makes picking a mech a loadout decision rather than a cosmetic
 * one, without opening the balance surface that eight distinct stat blocks would.
 *
 * THE PAINT TELLS YOU WHAT YOU ARE HOLDING. Beam colours and chassis colours are matched:
 *
 *     green chassis  -> Short Laser   (green beam)
 *     blue chassis   -> Medium Laser  (blue beam)
 *     red chassis    -> Long Laser    (red beam)
 *     yellow chassis -> Cannon        (no laser is yellow, and the Cannon is the odd one out)
 *
 * Four weapons across eight chassis means each weapon is offered by two mechs - the plain finish
 * and the shaded one. That pairing is memorable in a way an arbitrary assignment would not be: a
 * player who has used the green mech once knows what the other green mech does.
 *
 * WHEN FULLER VARIETY RETURNS, nothing structural has to change:
 *   - `player` and `weapon` are already multiplier maps consumed by resolvePlayerStats /
 *     resolveWeaponStats. Fill them in and the difference is live.
 *   - `HeroTrait` and the HERO_TRAITS registry in data/traits.ts are already wired into
 *     updateWeapons. Register a trait and the hook fires.
 * The two things to preserve at that point: no hero may be strictly dominated by another, and
 * every hero's resolved moveMaxSpeed must stay above the worst-case late-game swarmer speed
 * (~144.4 u/s at t=900, see tuning.ts) or kiting - the whole genre - quietly breaks.
 */

import type { WeaponId } from '../content/weaponCatalog.js';
import type { PlayerStatKey, WeaponStatKey } from './stats.js';
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

export interface HeroDef {
  readonly id: HeroId;
  readonly name: string;
  /** One line for the select screen. Flavour only while every chassis performs identically. */
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
  readonly startingWeapon: WeaponId;
  /** Multipliers on the tuning base. Absent key = x1. Empty for every hero today. */
  readonly player: Readonly<Partial<Record<PlayerStatKey, number>>>;
  /** Multipliers on the weapon's authored stats. Absent key = x1. Empty for every hero today. */
  readonly weapon: Readonly<Partial<Record<WeaponStatKey, number>>>;
}

/**
 * Index in this array is `WorldConfig.heroId` and is written into every replay. APPEND ONLY -
 * reordering invalidates saved runs. The eight added in the second pass are therefore appended
 * after `brass` rather than interleaved with the chassis they pair with.
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
    name: 'Slate',
    identity: 'Light biped, twin gun pods. Opens with the Medium Laser.',
    sprite: 'mech_slate',
    gait: 'walk',
    startingWeapon: 'laser-medium',
    player: {},
    weapon: {},
  },
  {
    id: 'moss',
    name: 'Moss',
    identity: 'Light strider, rotary drums. Opens with the Short Laser.',
    sprite: 'mech_moss',
    gait: 'walk',
    startingWeapon: 'laser-short',
    player: {},
    weapon: {},
  },
  {
    id: 'ember',
    name: 'Ember',
    identity: 'Light strider, one heavy cannon. Opens with the Long Laser.',
    sprite: 'mech_ember',
    gait: 'walk',
    startingWeapon: 'laser-long',
    player: {},
    weapon: {},
  },
  {
    id: 'amber',
    name: 'Amber',
    identity: 'Heavy biped, one heavy cannon. Opens with the Cannon.',
    sprite: 'mech_amber',
    gait: 'walk',
    startingWeapon: 'cannon',
    player: {},
    weapon: {},
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    identity: 'Heavy quad, twin gun pods. Opens with the Medium Laser.',
    sprite: 'mech_cobalt',
    gait: 'walk',
    startingWeapon: 'laser-medium',
    player: {},
    weapon: {},
  },
  {
    id: 'jade',
    name: 'Jade',
    identity: 'Heavy biped, forward claw arms. Opens with the Short Laser.',
    sprite: 'mech_jade',
    gait: 'walk',
    startingWeapon: 'laser-short',
    player: {},
    weapon: {},
  },
  {
    id: 'rust',
    name: 'Rust',
    identity: 'Heavy quad, spine-slung artillery tube. Opens with the Long Laser.',
    sprite: 'mech_rust',
    gait: 'walk',
    startingWeapon: 'laser-long',
    player: {},
    weapon: {},
  },
  {
    id: 'brass',
    name: 'Brass',
    identity: 'Light hover, one heavy cannon. Opens with the Cannon.',
    sprite: 'mech_brass',
    gait: 'hover',
    startingWeapon: 'cannon',
    player: {},
    weapon: {},
  },
  // ---- second pass: the missiles, the machine gun and the artillery get openers -------
  {
    id: 'onyx',
    name: 'Onyx',
    identity: 'Heavy quad, boxed missile racks. Opens with the Short Missiles.',
    sprite: 'mech_onyx',
    gait: 'walk',
    startingWeapon: 'missile-short',
    player: {},
    weapon: {},
  },
  {
    id: 'ash',
    name: 'Ash',
    identity: 'Light biped, boxed missile racks. Opens with the Short Missiles.',
    sprite: 'mech_ash',
    gait: 'walk',
    startingWeapon: 'missile-short',
    player: {},
    weapon: {},
  },
  {
    id: 'vermilion',
    name: 'Vermilion',
    identity: 'Light hover, rotary drums. Opens with the Long Missiles.',
    sprite: 'mech_vermilion',
    gait: 'hover',
    startingWeapon: 'missile-long',
    player: {},
    weapon: {},
  },
  {
    id: 'indigo',
    name: 'Indigo',
    identity: 'Heavy strider, boxed missile racks. Opens with the Long Missiles.',
    sprite: 'mech_indigo',
    gait: 'walk',
    startingWeapon: 'missile-long',
    player: {},
    weapon: {},
  },
  {
    id: 'bone',
    name: 'Bone',
    identity: 'Light strider, twin gun pods. Opens with the Machine Gun.',
    sprite: 'mech_bone',
    gait: 'walk',
    startingWeapon: 'machine-gun',
    player: {},
    weapon: {},
  },
  {
    id: 'copper',
    name: 'Copper',
    identity: 'Heavy quad, rotary drums. Opens with the Machine Gun.',
    sprite: 'mech_copper',
    gait: 'walk',
    startingWeapon: 'machine-gun',
    player: {},
    weapon: {},
  },
  {
    id: 'plum',
    name: 'Plum',
    identity: 'Heavy biped, spine-slung artillery tube. Opens with the Heavy Artillery.',
    sprite: 'mech_plum',
    gait: 'walk',
    startingWeapon: 'artillery',
    player: {},
    weapon: {},
  },
  {
    id: 'fern',
    name: 'Fern',
    identity: 'Light hover, forward claw arms. Opens with the Heavy Artillery.',
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
