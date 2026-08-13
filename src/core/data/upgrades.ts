/**
 * THE UPGRADE POOL.
 *
 * FOUR CARDS. NOTHING ELSE. Every card is a weapon, and every weapon has SEVEN TIERS: tier 1 puts
 * it in your hands, tiers 2-7 change what it does. Passives will exist later and are deliberately
 * absent rather than stubbed - a placeholder passive would show up on cards and dilute a pool whose
 * whole point right now is that every choice is a gun.
 *
 * WHAT A TIER DOES lives in WEAPON_CATALOG's `perLevel` arrays, not here. This file says WHICH
 * weapon a card belongs to and what to print on it; the weapon's own file says what tier 4 is
 * worth. That split is what stops the card text and the actual numbers from drifting apart, which
 * is the failure mode of every upgrade system that stores its effects twice.
 *
 * The ladders, from WEAPON_CATALOG:
 *
 *   Lasers   1 unlock  2 damage+heat  3 capacity  4 dispersion  5 damage+heat  6 capacity  7 dispersion
 *   Cannon   1 unlock  2 range        3 fire rate 4 damage      5 range        6 fire rate 7 pierce
 *
 * The laser ladder alternates "hits harder" against "runs longer" on purpose: damage tiers also
 * raise heat generation, so raw power shortens your bursts and capacity/dispersion buy them back.
 * A laser fed nothing but damage tiers ends up firing in shorter and shorter stabs.
 */

import type { WeaponId } from '../content/weaponCatalog.js';
import type { PlayerStatKey, WeaponStatKey } from './stats.js';

export type UpgradeId = 'w-cannon' | 'w-laser-short' | 'w-laser-medium' | 'w-laser-long';

/** Tiers per weapon, including the unlock. */
export const WEAPON_MAX_TIER = 7;

/**
 * One stat change. Retained for passives, which will use it; no weapon card carries effects,
 * because a weapon's numbers come from its own `perLevel` ladder.
 *
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
 * WEAPON cards put a gun in a slot and then level it. PASSIVE cards change your numbers.
 *
 * The distinction stays even though no passive exists yet: they compete for separate space
 * (MAX_WEAPONS and MAX_PASSIVES), and the card has to respect both independently. Folding them
 * into one pool would let a run fill every slot with stat cards and never be offered a gun.
 */
export type UpgradeKind = 'weapon' | 'passive';

export interface UpgradeDef {
  readonly id: UpgradeId;
  readonly kind: UpgradeKind;
  /** Set only on `kind: 'weapon'`: the weapon this card unlocks at tier 1 and levels thereafter. */
  readonly grantsWeapon?: WeaponId;
  readonly name: string;
  /** Shown when the card is the UNLOCK - what the weapon is. */
  readonly description: string;
  /**
   * What each tier does, indexed from 0 = tier 1. The card shows the entry for the tier being
   * OFFERED, so a player about to take tier 4 reads "Heat dispersion +5/s" rather than a generic
   * "Level up Short Laser". Length must equal maxStacks.
   */
  readonly tiers: readonly string[];
  /** Equals WEAPON_MAX_TIER for weapon cards: stacks taken IS the weapon's tier. */
  readonly maxStacks: number;
  /** Relative draw weight while the card still has tiers left. */
  readonly weight: number;
  readonly effects: readonly UpgradeEffect[];
}

/**
 * Every laser upgrades on the same ladder, so the card text is generated the same way. The numbers
 * quoted are computed from the weapon's own base in weaponCatalog.laserTiers, and repeated here as
 * text only - which is why the multipliers below must match that function.
 */
function laserTierText(damagePerSec: number, heatPerSec: number): readonly string[] {
  const dmg = Math.round(damagePerSec * 0.4);
  const heat = Math.round(heatPerSec * 0.4 * 10) / 10;
  const disp = Math.round(heatPerSec * 0.5 * 10) / 10;
  return [
    'Unlock.',
    `Damage +${dmg}/s, but heat +${heat}/s.`,
    'Heat capacity +40.',
    `Heat dispersion +${disp}/s.`,
    `Damage +${dmg}/s, but heat +${heat}/s.`,
    'Heat capacity +40.',
    `Heat dispersion +${disp}/s.`,
  ];
}

/**
 * Index in this array indexes LevelUpState.stacks and appears in every replay. APPEND ONLY.
 */
export const UPGRADE_CATALOG: readonly UpgradeDef[] = Object.freeze([
  {
    id: 'w-cannon',
    kind: 'weapon',
    grantsWeapon: 'cannon',
    name: 'Cannon',
    description: 'Lobs a heavy shell at the highest-HP enemy in range. Splash finishes the rest.',
    tiers: Object.freeze([
      'Unlock.',
      'Range +65.',
      'Fire rate: cooldown -0.18s.',
      'Damage +18 per shell.',
      'Range +65.',
      'Fire rate: cooldown -0.18s.',
      'Shells pierce one extra enemy.',
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-laser-short',
    kind: 'weapon',
    grantsWeapon: 'laser-short',
    name: 'Short Laser',
    description: 'Green beam. Burns the weakest enemy at close range. Needs a clear line.',
    tiers: laserTierText(30, 10),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-laser-medium',
    kind: 'weapon',
    grantsWeapon: 'laser-medium',
    name: 'Medium Laser',
    description: 'Blue beam. Moderate damage at middling range, and it runs hot.',
    tiers: laserTierText(55, 20),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-laser-long',
    kind: 'weapon',
    grantsWeapon: 'laser-long',
    name: 'Long Laser',
    description: 'Red beam. Heavy damage at long range, in short bursts.',
    tiers: laserTierText(85, 30),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
] as const) as readonly UpgradeDef[];

/** Catalog index for an upgrade id, or -1. */
export function upgradeIndex(id: UpgradeId): number {
  for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
    if (UPGRADE_CATALOG[i].id === id) return i;
  }
  return -1;
}

/** Catalog index of the card that owns a weapon, or -1. */
export function upgradeIndexForWeapon(weapon: WeaponId): number {
  for (let i = 0; i < UPGRADE_CATALOG.length; i++) {
    if (UPGRADE_CATALOG[i].grantsWeapon === weapon) return i;
  }
  return -1;
}

/**
 * Total tiers in the pool: 4 weapons x 7 = 28 picks to exhaust everything.
 *
 * A run reaching this has nothing left to be offered, and updateProgression must degrade
 * gracefully rather than hunt forever for a third distinct card.
 */
export const TOTAL_AVAILABLE_STACKS: number = UPGRADE_CATALOG.reduce((n, u) => n + u.maxStacks, 0);
