/**
 * THE UPGRADE POOL - what a level-up can offer.
 *
 * THE CONSTRAINT THAT SHAPED THIS FILE: there is exactly one weapon. In Vampire Survivors half of
 * every level-up pool is "here is a new gun", and that carries the progression on its own. With
 * only the Cannon, every card has to make the SAME gun or the SAME chassis feel different, so the
 * pool is built along five deliberately distinct axes:
 *
 *   1. more damage per shell        (Shells, Shaped Charge)
 *   2. more shells                  (Autoloader, Twin Mount, Sabot)
 *   3. more reach                   (Long Barrel, Propellant)
 *   4. survive being reached        (Hull, Plate, Reactor, Ablative)
 *   5. scale faster                 (Servos, Magnet, Siphon)
 *
 * A run that takes only from one axis should feel lopsided and eventually lose - that is the
 * choice being offered. Nothing here is a strict upgrade over anything else here.
 *
 * STACKING is linear per stack and resolved in data/stats.ts: two stacks of a +18% card is +36%,
 * never +39%. See that file for why compounding is a trap on a phone screen.
 */

import type { WeaponId } from '../content/weaponCatalog.js';
import type { PlayerStatKey, WeaponStatKey } from './stats.js';

export type UpgradeId =
  | 'w-laser-short'
  | 'w-laser-medium'
  | 'w-laser-long'
  | 'hv-shells'
  | 'autoloader'
  | 'long-barrel'
  | 'twin-mount'
  | 'sabot'
  | 'propellant'
  | 'shaped-charge'
  | 'hull-extension'
  | 'armour-plate'
  | 'reactor-patch'
  | 'ablative-layer'
  | 'servo-tuning'
  | 'magnet-coil'
  | 'data-siphon';

/**
 * One stat change. `mode` is the half of the resolution order this lands in:
 *   'add' - summed into the additive term, applied BEFORE multipliers
 *   'mul' - a fractional multiplier, e.g. 0.18 means +18%; summed linearly per stack
 */
export interface UpgradeEffect {
  readonly target: 'player' | 'weapon';
  readonly key: PlayerStatKey | WeaponStatKey;
  readonly mode: 'add' | 'mul';
  readonly amount: number;
}

/**
 * WEAPON cards add a gun to the loadout; PASSIVE cards change your numbers.
 *
 * They are separated because they compete for DIFFERENT SPACE - MAX_WEAPONS slots and
 * MAX_PASSIVES slots - and the level-up card has to respect both independently. Folding weapons
 * into the same pool as passives would let a run fill every slot with stat cards and never be
 * offered a second gun, which is the failure mode this split exists to prevent.
 *
 * Target shape is the Vampire Survivors one: seven weapons, seven passives. Four weapons exist
 * today.
 */
export type UpgradeKind = 'weapon' | 'passive';

export interface UpgradeDef {
  readonly id: UpgradeId;
  readonly kind: UpgradeKind;
  /** Set only on `kind: 'weapon'` cards: the weapon this card puts in a slot. */
  readonly grantsWeapon?: WeaponId;
  readonly name: string;
  /** Shown on the card. Must state the actual number - "the number on screen is the number". */
  readonly description: string;
  readonly maxStacks: number;
  /** Relative draw weight while the upgrade still has stacks left. */
  readonly weight: number;
  readonly effects: readonly UpgradeEffect[];
}

/**
 * Index in this array indexes LevelUpState.stacks and appears in every replay. APPEND ONLY.
 */
export const UPGRADE_CATALOG: readonly UpgradeDef[] = Object.freeze([
  // ---- weapons -----------------------------------------------------------------------------
  // Weapon cards carry no `effects`: they hand you a gun, and the gun's own numbers live in
  // WEAPON_CATALOG. maxStacks is 1 because weapon LEVELS do not exist yet - when they do, this
  // becomes the level cap and resolveWeaponStats already knows how to apply perLevel.
  {
    id: 'w-laser-short',
    kind: 'weapon',
    grantsWeapon: 'laser-short',
    name: 'Short Laser',
    description: 'Green beam. Burns the weakest enemy in close range. Needs a clear line.',
    maxStacks: 1,
    weight: 12,
    effects: [],
  },
  {
    id: 'w-laser-medium',
    kind: 'weapon',
    grantsWeapon: 'laser-medium',
    name: 'Medium Laser',
    description: 'Blue beam. Moderate damage at middling range. Heats twice as fast.',
    maxStacks: 1,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-laser-long',
    kind: 'weapon',
    grantsWeapon: 'laser-long',
    name: 'Long Laser',
    description: 'Red beam. Heavy damage at long range, in short bursts.',
    maxStacks: 1,
    weight: 8,
    effects: [],
  },

  // ---- passives ----------------------------------------------------------------------------
  // ---- 1. damage per shell -----------------------------------------------------------------
  {
    id: 'hv-shells',
    kind: 'passive',
    name: 'High-Velocity Shells',
    description: '+18% Cannon damage.',
    maxStacks: 5,
    weight: 10,
    effects: [{ target: 'weapon', key: 'damage', mode: 'mul', amount: 0.18 }],
  },
  {
    id: 'shaped-charge',
    kind: 'passive',
    name: 'Shaped Charge',
    description: '+30% splash radius, +25% splash damage.',
    maxStacks: 4,
    weight: 7,
    effects: [
      { target: 'weapon', key: 'splashRadius', mode: 'mul', amount: 0.3 },
      { target: 'weapon', key: 'splashFrac', mode: 'mul', amount: 0.25 },
    ],
  },

  // ---- 2. more shells ----------------------------------------------------------------------
  {
    id: 'autoloader',
    kind: 'passive',
    name: 'Autoloader',
    description: '-12% Cannon cooldown.',
    maxStacks: 5,
    weight: 10,
    effects: [{ target: 'weapon', key: 'cooldown', mode: 'mul', amount: -0.12 }],
  },
  {
    id: 'twin-mount',
    kind: 'passive',
    name: 'Twin Mount',
    description: '+1 shell per volley.',
    // Capped at 2: the Cannon fires at ONE target, so extra shells are extra damage on the
    // biggest thing in range. A third stack would make the swarm blind spot unrecoverable.
    maxStacks: 2,
    weight: 4,
    effects: [{ target: 'weapon', key: 'projectileCount', mode: 'add', amount: 1 }],
  },
  {
    id: 'sabot',
    kind: 'passive',
    name: 'Sabot Rounds',
    description: '+1 pierce. Shells punch through one more body.',
    maxStacks: 3,
    weight: 6,
    effects: [{ target: 'weapon', key: 'pierce', mode: 'add', amount: 1 }],
  },

  // ---- 3. reach ----------------------------------------------------------------------------
  {
    id: 'long-barrel',
    kind: 'passive',
    name: 'Long Barrel',
    description: '+15% Cannon range.',
    maxStacks: 4,
    weight: 8,
    effects: [{ target: 'weapon', key: 'range', mode: 'mul', amount: 0.15 }],
  },
  {
    id: 'propellant',
    kind: 'passive',
    name: 'Hot Propellant',
    description: '+22% shell speed. Less lead time, fewer misses on movers.',
    maxStacks: 3,
    weight: 6,
    effects: [{ target: 'weapon', key: 'projectileSpeed', mode: 'mul', amount: 0.22 }],
  },

  // ---- 4. survive being reached ------------------------------------------------------------
  {
    id: 'hull-extension',
    kind: 'passive',
    name: 'Hull Extension',
    description: '+25 max HP, and heal for the same.',
    maxStacks: 5,
    weight: 9,
    effects: [{ target: 'player', key: 'maxHp', mode: 'add', amount: 25 }],
  },
  {
    id: 'armour-plate',
    kind: 'passive',
    name: 'Armour Plate',
    description: '+3 armour. Subtracted from every hit, to a floor of 25%.',
    // Flat armour is strong against swarmers and weak against elites by design - it buys
    // tolerance for being SURROUNDED, never for being hit by the big thing.
    maxStacks: 5,
    weight: 8,
    effects: [{ target: 'player', key: 'armour', mode: 'add', amount: 3 }],
  },
  {
    id: 'reactor-patch',
    kind: 'passive',
    name: 'Reactor Patch',
    description: '+0.8 HP regenerated per second.',
    maxStacks: 5,
    weight: 7,
    effects: [{ target: 'player', key: 'hpRegen', mode: 'add', amount: 0.8 }],
  },
  {
    id: 'ablative-layer',
    kind: 'passive',
    name: 'Ablative Layer',
    description: '-8% damage taken from all sources.',
    maxStacks: 4,
    weight: 6,
    effects: [{ target: 'player', key: 'damageTakenMul', mode: 'add', amount: -0.08 }],
  },

  // ---- 5. scale faster ---------------------------------------------------------------------
  {
    id: 'servo-tuning',
    kind: 'passive',
    name: 'Servo Tuning',
    description: '+8% top speed, +12% acceleration.',
    maxStacks: 4,
    weight: 8,
    effects: [
      { target: 'player', key: 'moveMaxSpeed', mode: 'mul', amount: 0.08 },
      { target: 'player', key: 'moveAccel', mode: 'mul', amount: 0.12 },
    ],
  },
  {
    id: 'magnet-coil',
    kind: 'passive',
    name: 'Magnet Coil',
    description: '+30% pickup radius.',
    maxStacks: 4,
    weight: 7,
    effects: [{ target: 'player', key: 'pickupRadius', mode: 'mul', amount: 0.3 }],
  },
  {
    id: 'data-siphon',
    kind: 'passive',
    name: 'Data Siphon',
    description: '+15% XP from every gem.',
    maxStacks: 4,
    weight: 6,
    effects: [{ target: 'player', key: 'xpGain', mode: 'mul', amount: 0.15 }],
  },
] as const) as readonly UpgradeDef[];

/** Catalog index for an upgrade id, or -1. */
export function upgradeIndex(id: UpgradeId): number {
  for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
    if (UPGRADE_CATALOG[i].id === id) return i;
  }
  return -1;
}

/**
 * Total stacks available across the whole pool. If a run ever takes this many picks there is
 * nothing left to offer, and updateProgression must degrade gracefully rather than loop forever
 * looking for a third distinct card.
 */
export const TOTAL_AVAILABLE_STACKS: number = UPGRADE_CATALOG.reduce((n, u) => n + u.maxStacks, 0);
