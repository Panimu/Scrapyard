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

import type { PlayerStatKey, WeaponStatKey } from './stats.js';

export type UpgradeId =
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

export interface UpgradeDef {
  readonly id: UpgradeId;
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
  // ---- 1. damage per shell -----------------------------------------------------------------
  {
    id: 'hv-shells',
    name: 'High-Velocity Shells',
    description: '+18% Cannon damage.',
    maxStacks: 5,
    weight: 10,
    effects: [{ target: 'weapon', key: 'damage', mode: 'mul', amount: 0.18 }],
  },
  {
    id: 'shaped-charge',
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
    name: 'Autoloader',
    description: '-12% Cannon cooldown.',
    maxStacks: 5,
    weight: 10,
    effects: [{ target: 'weapon', key: 'cooldown', mode: 'mul', amount: -0.12 }],
  },
  {
    id: 'twin-mount',
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
    name: 'Sabot Rounds',
    description: '+1 pierce. Shells punch through one more body.',
    maxStacks: 3,
    weight: 6,
    effects: [{ target: 'weapon', key: 'pierce', mode: 'add', amount: 1 }],
  },

  // ---- 3. reach ----------------------------------------------------------------------------
  {
    id: 'long-barrel',
    name: 'Long Barrel',
    description: '+15% Cannon range.',
    maxStacks: 4,
    weight: 8,
    effects: [{ target: 'weapon', key: 'range', mode: 'mul', amount: 0.15 }],
  },
  {
    id: 'propellant',
    name: 'Hot Propellant',
    description: '+22% shell speed. Less lead time, fewer misses on movers.',
    maxStacks: 3,
    weight: 6,
    effects: [{ target: 'weapon', key: 'projectileSpeed', mode: 'mul', amount: 0.22 }],
  },

  // ---- 4. survive being reached ------------------------------------------------------------
  {
    id: 'hull-extension',
    name: 'Hull Extension',
    description: '+25 max HP, and heal for the same.',
    maxStacks: 5,
    weight: 9,
    effects: [{ target: 'player', key: 'maxHp', mode: 'add', amount: 25 }],
  },
  {
    id: 'armour-plate',
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
    name: 'Reactor Patch',
    description: '+0.8 HP regenerated per second.',
    maxStacks: 5,
    weight: 7,
    effects: [{ target: 'player', key: 'hpRegen', mode: 'add', amount: 0.8 }],
  },
  {
    id: 'ablative-layer',
    name: 'Ablative Layer',
    description: '-8% damage taken from all sources.',
    maxStacks: 4,
    weight: 6,
    effects: [{ target: 'player', key: 'damageTakenMul', mode: 'add', amount: -0.08 }],
  },

  // ---- 5. scale faster ---------------------------------------------------------------------
  {
    id: 'servo-tuning',
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
    name: 'Magnet Coil',
    description: '+30% pickup radius.',
    maxStacks: 4,
    weight: 7,
    effects: [{ target: 'player', key: 'pickupRadius', mode: 'mul', amount: 0.3 }],
  },
  {
    id: 'data-siphon',
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
