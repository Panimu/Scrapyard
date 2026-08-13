/**
 * THE EIGHT MECHS.
 *
 * Eight because the art gives exactly eight top-down chassis in robot-pack, and inventing a ninth
 * would mean shipping a hero with someone else's silhouette. Identity comes from numbers and one
 * optional trait hook, not from new sprites.
 *
 * DESIGNING HEROES WHEN THERE IS ONLY ONE WEAPON is the real constraint here. With a full arsenal
 * you differentiate by what a hero unlocks; with just the Cannon, every hero shoots the same gun,
 * so the axes available are: how hard it hits, how often, how far, how well you survive being
 * reached, and how fast you scale. Each mech below owns one of those and pays for it somewhere.
 *
 * NO HERO IS STRICTLY DOMINATED - each is the outright best in the catalog at something, which
 * `heroes.test.ts` asserts rather than trusting this comment.
 *
 * KITING INVARIANT: the slowest mech here is x0.86 of a 195 u/s base = 167.7 u/s, against a
 * worst-case late-game swarmer at 144.4 u/s (tuning.ts §maxEnemySpeedAt). Every hero can outrun
 * the horde at t=900. Lowering any moveMaxSpeed multiplier below ~0.75 breaks the genre.
 */

import type { WeaponId } from '../content/weaponCatalog.js';
import type { PlayerStatKey, WeaponStatKey } from './stats.js';
import type { World } from '../types.js';

export type HeroId =
  | 'lancer'
  | 'forager'
  | 'kiln'
  | 'ticker'
  | 'longbarrow'
  | 'bulwark'
  | 'breaker'
  | 'harrier';

/**
 * The mutable per-shell context handed to `HeroTrait.onFireShell`, owned by updateWeapons.
 * A trait may retarget the shell (dirX/dirY), or change what it carries (damage/knockback).
 * `shellIndex` is 0-based within this volley, so a trait can treat the first shell specially.
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
 * same separation that lets weapons 2..12 arrive as pure data.
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
  /** One line, shown on the select screen. What this mech is FOR. */
  readonly identity: string;
  /** Sprite key produced by tools/prepare_assets.mjs - see docs/ASSET_MANIFEST.md. */
  readonly sprite: string;
  readonly startingWeapon: WeaponId;
  /** Multipliers on the tuning base. Absent key = x1. */
  readonly player: Readonly<Partial<Record<PlayerStatKey, number>>>;
  /** Multipliers on the weapon's authored stats. Absent key = x1. */
  readonly weapon: Readonly<Partial<Record<WeaponStatKey, number>>>;
}

/**
 * Index in this array is `WorldConfig.heroId` and is written into every replay. APPEND ONLY -
 * reordering invalidates saved runs.
 */
export const HERO_CATALOG: readonly HeroDef[] = Object.freeze([
  {
    id: 'lancer',
    name: 'Lancer',
    identity: 'The standard chassis. Every number is the baseline.',
    sprite: 'mech_blue',
    startingWeapon: 'cannon',
    player: {},
    weapon: {},
  },
  {
    id: 'forager',
    name: 'Forager',
    identity: 'Collects wider and levels faster. Weakest gun in the yard.',
    sprite: 'mech_green',
    startingWeapon: 'cannon',
    // Best pickupRadius and best xpGain in the catalog. Pays in raw damage: it wins by having
    // more upgrades than you at the same minute, not by hitting harder.
    player: { pickupRadius: 1.65, xpGain: 1.3, maxHp: 0.92 },
    weapon: { damage: 0.85 },
  },
  {
    id: 'kiln',
    name: 'Kiln',
    identity: 'Hits hardest. Made of paper.',
    sprite: 'mech_red',
    startingWeapon: 'cannon',
    // Best damage in the catalog by a clear margin, and the lowest HP. The Cannon already targets
    // the biggest thing in range, so Kiln is the hero that most wants that rule - and the one
    // punished worst by the swarmers it ignores.
    player: { maxHp: 0.75 },
    weapon: { damage: 1.4 },
  },
  {
    id: 'ticker',
    name: 'Ticker',
    identity: 'Fires half again as often. Each shell lands lighter.',
    sprite: 'mech_yellow',
    startingWeapon: 'cannon',
    // Best cooldown. Roughly damage-neutral against a single target, but far better at cleaning
    // up a spread-out field because it re-targets more often.
    player: {},
    weapon: { cooldown: 0.66, damage: 0.76, knockback: 0.8 },
  },
  {
    id: 'longbarrow',
    name: 'Longbarrow',
    identity: 'Reaches furthest and shoots flattest. Slow to reposition.',
    sprite: 'mech_3dblue',
    startingWeapon: 'cannon',
    // Best range and best projectile speed: kills things before they are a problem, provided you
    // never have to leave in a hurry. Slowest chassis in the catalog (still 167.7 u/s - above the
    // 144.4 u/s worst-case swarmer, so kiting survives).
    player: { moveMaxSpeed: 0.86, moveAccel: 0.9 },
    weapon: { range: 1.45, projectileSpeed: 1.3, cooldown: 1.12 },
  },
  {
    id: 'bulwark',
    name: 'Bulwark',
    identity: 'Soaks a beating and mends. Never in a hurry.',
    sprite: 'mech_3dgreen',
    startingWeapon: 'cannon',
    // Best maxHp, and the only hero with base regen and base armour. Flat armour is deliberately
    // strong against the swarm and weak against elites (tuning.ts §CombatTuning), which is exactly
    // the shape of Bulwark's problem: it survives being surrounded, not being hit by the big one.
    player: { maxHp: 1.5, hpRegen: 1, armour: 1, moveMaxSpeed: 0.88 },
    weapon: { cooldown: 1.1 },
  },
  {
    id: 'breaker',
    name: 'Breaker',
    identity: 'Every shell is a shove. Clears space rather than bodies.',
    sprite: 'mech_3dred',
    startingWeapon: 'cannon',
    // Best knockback and best splash. Solves the Cannon's blind spot - the swarm it refuses to
    // target - by punting whatever it does hit into the crowd behind it.
    player: {},
    weapon: { knockback: 2.1, splashRadius: 1.5, splashFrac: 1.4, damage: 0.9 },
  },
  {
    id: 'harrier',
    name: 'Harrier',
    identity: 'Fastest thing on the field. Thin armour, short reach.',
    sprite: 'mech_3dyellow',
    startingWeapon: 'cannon',
    // Best moveMaxSpeed and best moveAccel: the purest kiting hero, and the one that can actually
    // outrun a surge. Pays with range and HP, so a mistake is not recoverable.
    player: { moveMaxSpeed: 1.22, moveAccel: 1.35, maxHp: 0.85 },
    weapon: { range: 0.85 },
  },
] as const) as readonly HeroDef[];

/** Catalog index for a hero id, or -1. */
export function heroIndex(id: HeroId): number {
  for (let i = 0; i < HERO_CATALOG.length; i++) {
    if (HERO_CATALOG[i].id === id) return i;
  }
  return -1;
}
