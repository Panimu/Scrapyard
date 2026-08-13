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
  | 'brass';

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
  readonly startingWeapon: WeaponId;
  /** Multipliers on the tuning base. Absent key = x1. Empty for every hero today. */
  readonly player: Readonly<Partial<Record<PlayerStatKey, number>>>;
  /** Multipliers on the weapon's authored stats. Absent key = x1. Empty for every hero today. */
  readonly weapon: Readonly<Partial<Record<WeaponStatKey, number>>>;
}

/**
 * Index in this array is `WorldConfig.heroId` and is written into every replay. APPEND ONLY -
 * reordering invalidates saved runs.
 *
 * Named after their paint, deliberately: a name like "Bulwark" would promise a behaviour these
 * chassis do not yet have.
 */
export const HERO_CATALOG: readonly HeroDef[] = Object.freeze([
  {
    id: 'slate',
    name: 'Slate',
    identity: 'Grey plate, blue beam. Opens with the Medium Laser.',
    sprite: 'mech_blue',
    startingWeapon: 'laser-medium',
    player: {},
    weapon: {},
  },
  {
    id: 'moss',
    name: 'Moss',
    identity: 'Green plate, green beam. Opens with the Short Laser.',
    sprite: 'mech_green',
    startingWeapon: 'laser-short',
    player: {},
    weapon: {},
  },
  {
    id: 'ember',
    name: 'Ember',
    identity: 'Red plate, red beam. Opens with the Long Laser.',
    sprite: 'mech_red',
    startingWeapon: 'laser-long',
    player: {},
    weapon: {},
  },
  {
    id: 'amber',
    name: 'Amber',
    identity: 'Yellow plate. Opens with the Cannon.',
    sprite: 'mech_yellow',
    startingWeapon: 'cannon',
    player: {},
    weapon: {},
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    identity: 'Shaded blue. Opens with the Medium Laser.',
    sprite: 'mech_3dblue',
    startingWeapon: 'laser-medium',
    player: {},
    weapon: {},
  },
  {
    id: 'jade',
    name: 'Jade',
    identity: 'Shaded green. Opens with the Short Laser.',
    sprite: 'mech_3dgreen',
    startingWeapon: 'laser-short',
    player: {},
    weapon: {},
  },
  {
    id: 'rust',
    name: 'Rust',
    identity: 'Shaded red. Opens with the Long Laser.',
    sprite: 'mech_3dred',
    startingWeapon: 'laser-long',
    player: {},
    weapon: {},
  },
  {
    id: 'brass',
    name: 'Brass',
    identity: 'Shaded yellow. Opens with the Cannon.',
    sprite: 'mech_3dyellow',
    startingWeapon: 'cannon',
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
