/**
 * THE UPGRADE POOL.
 *
 * FOURTEEN CARDS: eight weapons and six passives, every one of them SEVEN TIERS deep. Tier 1 puts
 * the thing in your hands; tiers 2-7 change what it does. A run has five weapon slots and five
 * passive slots, so nothing here is a collection to complete - 98 tiers exist and a long run takes
 * perhaps 30 of them.
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

export type UpgradeId =
  | 'w-cannon'
  | 'w-laser-short'
  | 'w-laser-medium'
  | 'w-laser-long'
  | 'w-missile-short'
  | 'w-missile-long'
  | 'w-machine-gun'
  | 'w-artillery'
  | 'p-range'
  | 'p-damage'
  | 'p-rate'
  | 'p-speed'
  | 'p-armour'
  | 'p-shield';

/** Tiers per weapon, including the unlock. The ceiling a LEVEL-UP can ever reach. */
export const WEAPON_MAX_TIER = 7;

/**
 * TIER 8 - THE ASCENSION. A weapon's capstone, and the only tier no card can offer.
 *
 * `maxStacks` stays at WEAPON_MAX_TIER, which is what `isOfferable` reads, so tier 8 is invisible
 * to the level-up deck by construction rather than by a rule someone has to remember. The only
 * route to it is a Cyber Chest, and only when `ascensionReady` says the run has earned it: the
 * weapon sitting at exactly tier 7, AND the ascension's required passive held at any tier.
 *
 * That second condition is the point of the whole mechanism. A tier 8 is not "keep taking the
 * card" - it is a BUILD arriving somewhere, and the requirement names which build. The Chain
 * Laser needs Targeting Optics because chaining is bought with reach: the passive that was doing
 * nothing but making a beam longer becomes the passive that decides how many bodies it crosses.
 */
export const WEAPON_ASCENDED_TIER = 8;

/**
 * What a weapon becomes at tier 8, and what it costs to get there.
 *
 * The renamed weapon is the SAME `WeaponDef` at level 8 - not a second catalog entry - so every
 * stat, every targeting rule and every renderer path is inherited rather than re-declared, and
 * the ladder's `perLevel[6]` supplies the tier-8 numbers exactly as it supplies the other six.
 * Only the NAME and the ICON change, which is all a rename is.
 */
export interface Ascension {
  /** What the weapon is called from tier 8 onward. */
  readonly name: string;
  /** Sprite key for the tier-8 icon, without the `icon_` prefix. */
  readonly icon: string;
  /** Held at ANY tier. Nothing here cares how deep the passive is, only that the run took it. */
  readonly requires: UpgradeId;
  /** Card text, shown on the chest that grants it. */
  readonly description: string;
}

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
  /**
   * PER-TIER effects, index 0 = tier 1, applied cumulatively for every tier taken.
   *
   * This exists because `effects` alone can only ever be LINEAR: the resolver multiplies one
   * amount by the stack count, so every tier of a card is worth exactly the same. Passives are
   * deliberately back-loaded - the seventh tier is worth about twice the first - which needs a
   * different number per rung, exactly the way a weapon's `perLevel` ladder works.
   *
   * When present this REPLACES `effects` entirely; a card uses one mechanism or the other.
   */
  readonly tierEffects?: readonly (readonly UpgradeEffect[])[];
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
  /**
   * Set on weapon cards that have a tier 8. Absent means the weapon tops out at 7 - which is most
   * of them today, and the reason this is optional rather than a field every card must fill in.
   */
  readonly ascension?: Ascension;
  /** Relative draw weight while the card still has tiers left. */
  readonly weight: number;
  readonly effects: readonly UpgradeEffect[];
}

/**
 * What a weapon card is CALLED at a given tier, and which icon it draws.
 *
 * One helper rather than the same `stacks >= 8 ? ... : ...` in the HUD, the level-up card and the
 * chest: a rename is exactly the kind of thing that ends up applied in two places out of three,
 * and the one place it is missing is the one the player screenshots.
 */
export function upgradeNameAt(def: UpgradeDef, tier: number): string {
  const asc = def.ascension;
  return asc !== undefined && tier >= WEAPON_ASCENDED_TIER ? asc.name : def.name;
}

/** Sprite key WITHOUT the `icon_` prefix. */
export function upgradeIconAt(def: UpgradeDef, tier: number): string {
  const asc = def.ascension;
  return asc !== undefined && tier >= WEAPON_ASCENDED_TIER ? asc.icon : def.id;
}

/**
 * What a HELD weapon is called right now - the HUD's question, asked from the weapon end.
 *
 * It goes through the CARD rather than the WeaponDef, because the ascension lives on the card and
 * putting a second copy of the name on the weapon would be two places to rename from. A weapon
 * with no card (there is none today) degrades to the catalog name.
 */
export function weaponNameAtTier(weapon: WeaponId, tier: number): string {
  const i = upgradeIndexForWeapon(weapon);
  const def = i >= 0 ? UPGRADE_CATALOG[i] : undefined;
  return def !== undefined ? upgradeNameAt(def, tier) : '';
}

/**
 * Every laser upgrades on the same ladder, so the card text is generated the same way. The numbers
 * quoted are computed from the weapon's own base in weaponCatalog.laserTiers, and repeated here as
 * text only - which is why the multipliers below must match that function.
 */
function laserTierText(
  damagePerSec: number,
  heatPerSec: number,
  heatDispersion: number,
): readonly string[] {
  const dmg = Math.round(damagePerSec * 0.4);
  const heat = Math.round(heatPerSec * 0.4 * 10) / 10;
  const disp = Math.round(heatDispersion * 0.5 * 10) / 10;
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

// ---------------------------------------------------------------------------------------------
// PASSIVES
//
// SIX cards for FIVE slots (MAX_PASSIVES), so a finished build has deliberately left one behind.
//
// Five of the six are percentage cards on the shared ramp below. The sixth, Energy Shield, is not
// a percentage of anything - it installs a mechanism - and is authored at the bottom of the
// catalog with its own reasoning.
//
// The five ramp cards run seven tiers each, BACK-LOADED: 5 / 5 / 6 / 7 / 8 / 9 / 10 percent. That sums to
// exactly 50% and the seventh rung is worth exactly twice the first, so finishing a passive is a
// real decision rather than a rounding error - the last two tiers alone are worth as much as the
// first four.
//
// Every percentage card multiplies rather than adds, and they are summed linearly by the resolver
// (see stats.ts): a fully-invested card is +50%, never 1.05 x 1.05 x ... compounding to +58%. The
// number on the card is the number.
// ---------------------------------------------------------------------------------------------

/** The shared back-loaded ramp. Sums to 0.50; last tier is exactly twice the first. */
const PASSIVE_RAMP: readonly number[] = [0.05, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1];

/**
 * FEED SYSTEMS' RELOAD RUNGS, in SECONDS off the top, summing to 3.5.
 *
 * A STEEPER SHAPE THAN THE SHARED RAMP, deliberately. PASSIVE_RAMP's rungs step up by a flat
 * point at a time, so finishing it is worth twice starting it and no rung is an event. These
 * step up by ever more - and the seventh is worth more than the first three together:
 *
 *   T1  0.15    cumulative 0.15
 *   T2  0.20               0.35
 *   T3  0.30               0.65
 *   T4  0.40               1.05
 *   T5  0.55               1.60
 *   T6  0.70               2.30
 *   T7  1.20               3.50   <- the jump the card is built around
 *
 * The early rungs are meant to feel thin. This half of the card only matters to a weapon with a
 * magazine, and there is exactly one of those; making its first tier generous would hand the
 * Machine Gun most of the benefit for a single pick and leave six rungs of nothing behind it.
 * Back-loading it this hard is what makes FINISHING the card the decision.
 *
 * Flat seconds rather than a percentage, because there is only one reload in the game to take a
 * percentage of and "3.5 seconds off" is a thing a player can hold in their head while a belt
 * runs dry. A weapon with no magazine never notices: the reload path is gated on ammoCapacity.
 */
const FEED_RELOAD: readonly number[] = [0.15, 0.2, 0.3, 0.4, 0.55, 0.7, 1.2];

function rampText(prefix: string): readonly string[] {
  return PASSIVE_RAMP.map((v) => `${prefix} +${Math.round(v * 100)}%.`);
}

/** One `mul` effect per tier on a single key, following the ramp. */
function rampEffects(
  target: 'player' | 'weapon',
  keys: readonly (PlayerStatKey | WeaponStatKey)[],
  scale = 1,
): readonly (readonly UpgradeEffect[])[] {
  return PASSIVE_RAMP.map((v) =>
    keys.map((key) => ({ target, key, mode: 'mul' as const, amount: v * scale })),
  );
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
    // No mention of splash: the Cannon lost its blast radius, and Heavy Artillery is the only
    // area weapon in the game. A card that still promised splash would be the exact drift this
    // file's header is about.
    description: 'Lobs a heavy shell at the highest-HP enemy in range. One target, hit hard.',
    tiers: Object.freeze([
      'Unlock.',
      'Range +62.',
      'Fire rate: cooldown -15%.',
      'Damage +18 per shell.',
      'Range +62.',
      'Fire rate: cooldown -15%.',
      'Shells pierce one extra enemy.',
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-missile-short',
    kind: 'weapon',
    grantsWeapon: 'missile-short',
    name: 'Short Missiles',
    description: 'Two homing missiles fired where you last moved. Slow to rearm, hits hard.',
    tiers: Object.freeze([
      'Unlock.',
      'Rearm 0.45s faster.',
      'Turn radius: +0.7 rad/s homing.',
      'Damage +22 per missile.',
      'Rearm 0.45s faster.',
      'Turn radius: +0.7 rad/s homing.',
      'A third missile.',
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-missile-long',
    kind: 'weapon',
    grantsWeapon: 'missile-long',
    name: 'Long Missiles',
    description: 'Three missiles on a long fuse, fired where you last moved. Weak homing, wide reach.',
    tiers: Object.freeze([
      'Unlock.',
      'Rearm 0.6s faster.',
      'Turn radius: +0.45 rad/s homing.',
      'Damage +15 per missile.',
      'A fourth missile.',
      'Flight time +0.6s.',
      'A fifth missile.',
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-machine-gun',
    kind: 'weapon',
    grantsWeapon: 'machine-gun',
    name: 'Machine Gun',
    description:
      'Two rounds at a time into the weakest enemy, very close in. 200 rounds, then a long reload.',
    tiers: Object.freeze([
      'Unlock.',
      'Damage +1.5 per round.',
      'Rate of fire: cycle -0.018s.',
      'Magazine +80 rounds.',
      'Range +25.',
      'Damage +3 per round.',
      'Reload 4.5s faster.',
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-artillery',
    kind: 'weapon',
    grantsWeapon: 'artillery',
    name: 'Heavy Artillery',
    description:
      'Two shells fall on random ground nearby after a short fuse. Aims at nothing. Big blast.',
    tiers: Object.freeze([
      'Unlock.',
      'Blast radius +18.',
      'Rate of fire: reload -16.7%.',
      'Damage +22 per shell.',
      'Blast radius +18.',
      'Rate of fire: reload -16.7%.',
      'A third shell.',
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
    description: 'Green beam. Burns whatever stands between you and the weakest enemy.',
    tiers: laserTierText(46, 7.5, 8.5),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-laser-medium',
    ascension: Object.freeze({
      name: 'Chain Laser',
      icon: 'w-chain-laser',
      requires: 'p-range' as const,
      description:
        'The beam jumps. From whatever it burns it reaches the nearest enemy not already in the chain, and keeps going while the whole beam still fits inside its range.',
    }),
    kind: 'weapon',
    grantsWeapon: 'laser-medium',
    name: 'Medium Laser',
    description: 'Blue beam. Moderate damage at middling range, and it runs hot.',
    tiers: laserTierText(66, 16.5, 8.6),
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
    tiers: laserTierText(92, 25.5, 8.0),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  // ---- passives ----------------------------------------------------------------------------
  {
    id: 'p-range',
    kind: 'passive',
    name: 'Targeting Optics',
    description: 'Every weapon reaches further.',
    tiers: rampText('Weapon range'),
    tierEffects: rampEffects('weapon', ['range']),
    maxStacks: WEAPON_MAX_TIER,
    weight: 9,
    effects: [],
  },
  {
    id: 'p-damage',
    kind: 'passive',
    name: 'Ordnance',
    description: 'Every weapon hits harder. A hotter-running laser burns through its heat faster.',
    // HEAT RIDES WITH DAMAGE, and it is the same key pairing the lasers' own damage tiers use
    // (`laserTiers`: `{ damage: +40%, heatPerSec: +40% }`). The rule in this game is that raw
    // power on a beam costs burst - you buy the burst back with capacity and dispersion tiers -
    // and a passive that broke that rule was the one way to get laser damage with no heat bill.
    // It made Ordnance strictly better on a laser than the laser's own damage rungs, which is
    // backwards: a card that says "every weapon hits harder" should not also quietly say "and on
    // these three, ignore the mechanic they are built around".
    //
    // Proportional, not flat, so it lands "in line with that laser's heat profile" whichever
    // laser it is: the same +50% on the Short Laser's 10/s and the Long Laser's 34/s.
    //
    // A NO-OP FOR EVERYTHING ELSE. Projectile weapons declare `heatPerSec: 0` and multiplying
    // zero leaves zero, so no shell-thrower notices this key exists.
    tiers: rampText('Weapon damage'),
    tierEffects: rampEffects('weapon', ['damage', 'heatPerSec']),
    maxStacks: WEAPON_MAX_TIER,
    weight: 9,
    effects: [],
  },
  {
    id: 'p-rate',
    kind: 'passive',
    name: 'Feed Systems',
    description:
      'Every weapon fires more often - shorter cooldowns, faster heat dispersion, a quicker reload.',
    // THREE keys, because the game has three ways of pacing a weapon and a card that named only
    // one would be dead weight for whole halves of the catalog. `cooldown` would do NOTHING for
    // the three lasers, which are gated by heat; neither of those touches the MAGAZINE, which is
    // the only limiter the Machine Gun has.
    //
    // Cooldown carries a NEGATIVE ramp scaled so the full card is a +50% RATE of fire, not a -50%
    // cooldown: cooldown x (1/1.5) = 0.667, so the amounts must total -0.333.
    //
    // RELOAD IS FLAT SECONDS, NOT A PERCENTAGE, and it has its own steeper shape - see
    // FEED_RELOAD. Rate of fire and reload pull against each other on a magazine weapon: firing
    // faster empties the belt sooner, so the percentage half of this card buys burst and gives
    // back uptime. The seconds half is what buys the uptime back.
    tiers: PASSIVE_RAMP.map(
      (v, i) => `Rate of fire +${Math.round(v * 100)}%. Reload ${FEED_RELOAD[i]}s faster.`,
    ),
    tierEffects: PASSIVE_RAMP.map((v, i) => [
      { target: 'weapon' as const, key: 'cooldown' as const, mode: 'mul' as const, amount: -v * (1 / 3 / 0.5) },
      { target: 'weapon' as const, key: 'heatDispersion' as const, mode: 'mul' as const, amount: v },
      { target: 'weapon' as const, key: 'reloadTime' as const, mode: 'add' as const, amount: -FEED_RELOAD[i] },
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 9,
    effects: [],
  },
  {
    id: 'p-speed',
    kind: 'passive',
    name: 'Servo Drive',
    description: 'The chassis moves faster.',
    // Acceleration rises with top speed deliberately. moveDrag is DERIVED as accel/maxSpeed, so
    // raising only the top speed would lower drag and make the mech float - a higher ceiling it
    // takes noticeably longer to reach. Scaling both keeps time-to-max-speed constant, so the mech
    // feels the same and is simply quicker.
    tiers: rampText('Movement speed'),
    tierEffects: rampEffects('player', ['moveMaxSpeed', 'moveAccel']),
    maxStacks: WEAPON_MAX_TIER,
    weight: 9,
    effects: [],
  },
  {
    id: 'p-armour',
    kind: 'passive',
    name: 'Ablative Plate',
    description: 'Subtracts from every hit taken, down to a floor of 25% of the original.',
    // FLAT, not a percentage. Base armour is 0, so a multiplier would be worth precisely nothing -
    // the one place the shared ramp cannot be used. The same back-loaded shape by hand: +22 armour
    // in total, seventh tier twice the first.
    //
    // Flat armour is strong against the swarm and weak against elites by design (tuning.ts): 22
    // armour turns a 5-damage swarmer hit into the 25% floor, and a 28-damage elite hit into 6.
    // It buys tolerance for being SURROUNDED, never for being hit by the big thing.
    tiers: Object.freeze([
      'Armour +2.',
      'Armour +2.',
      'Armour +3.',
      'Armour +3.',
      'Armour +4.',
      'Armour +4.',
      'Armour +4.',
    ]),
    tierEffects: Object.freeze(
      [2, 2, 3, 3, 4, 4, 4].map((v) => [
        { target: 'player' as const, key: 'armour' as const, mode: 'add' as const, amount: v },
      ]),
    ),
    maxStacks: WEAPON_MAX_TIER,
    weight: 9,
    effects: [],
  },
  {
    id: 'p-shield',
    kind: 'passive',
    name: 'Energy Shield',
    // The UNLOCK card shows this instead of tiers[0], so it has to carry the whole mechanism -
    // "Unlock." on its own would put the three numbers that define the card nowhere the player
    // can read them before spending the pick.
    description:
      'A blue rim absorbs one hit outright and burns what hit it. 0.1s immunity, back in 20s.',
    // NOT a percentage card, and not on the shared ramp: there is nothing here to take a
    // percentage OF. All three numbers are 0 at base (tuning.ts), so the unlock tier carries the
    // whole mechanism and the six after it move three separate dials.
    //
    // WHY IT IS NOT REDUNDANT WITH ABLATIVE PLATE. Armour subtracts a flat amount from every hit,
    // so it is worth 22 HP against a swarmer nibble and 22 HP against a boss slam - which means
    // it is worth EVERYTHING against the swarm and almost nothing against the big thing. A shield
    // layer prevents one hit whatever its size, so it is worth 5 HP against a nibble and 42
    // against a slam. They are the same slot cost and opposite shapes, which is the point.
    //
    // THE RECHARGE LADDER, in the only terms that matter - layers per minute, not seconds:
    //   T1  20.0 s   3.0 /min
    //   T2  17.0 s   3.5 /min   +18%
    //   T4  13.5 s   4.4 /min   +26%
    //   T6   9.0 s   6.7 /min   +50%
    // Back-loaded like every other passive: the last cooldown tier is worth nearly three times the
    // first. Authored as time (that is what the player reads on the card) but SHAPED as rate.
    //
    // THE IMMUNITY WINDOW IS WHY TIERS 3 AND 5 ARE NOT FILLER. Without it a break would buy one
    // bite, and in a crowd of six the other five would land on the very next tick - the shield
    // would be worth about a sixth of a hit and the card would be a trap. The window makes a break
    // eat everything touching you for 0.1 s, and 0.2 s at tier 5 is long enough to cover a full
    // contact cycle's worth of a surrounding pile-on.
    tiers: Object.freeze([
      'Unlock.',
      'Recharge 3s faster: 17s.',
      'Immunity 0.15s.',
      'Recharge 3.5s faster: 13.5s.',
      'Immunity 0.2s.',
      'Recharge 4.5s faster: 9s.',
      'A second rim. Each recharges in turn.',
    ]),
    tierEffects: Object.freeze([
      [
        { target: 'player' as const, key: 'shieldLayers' as const, mode: 'add' as const, amount: 1 },
        { target: 'player' as const, key: 'shieldRecharge' as const, mode: 'add' as const, amount: 20 },
        { target: 'player' as const, key: 'shieldImmune' as const, mode: 'add' as const, amount: 0.1 },
      ],
      [{ target: 'player' as const, key: 'shieldRecharge' as const, mode: 'add' as const, amount: -3 }],
      [{ target: 'player' as const, key: 'shieldImmune' as const, mode: 'add' as const, amount: 0.05 }],
      [{ target: 'player' as const, key: 'shieldRecharge' as const, mode: 'add' as const, amount: -3.5 }],
      [{ target: 'player' as const, key: 'shieldImmune' as const, mode: 'add' as const, amount: 0.05 }],
      [{ target: 'player' as const, key: 'shieldRecharge' as const, mode: 'add' as const, amount: -4.5 }],
      [{ target: 'player' as const, key: 'shieldLayers' as const, mode: 'add' as const, amount: 1 }],
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 9,
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
 * Total tiers in the pool: 14 cards x 7 = 98 picks to exhaust everything.
 *
 * A run reaching this has nothing left to be offered, and updateProgression must degrade
 * gracefully rather than hunt forever for a third distinct card.
 */
export const TOTAL_AVAILABLE_STACKS: number = UPGRADE_CATALOG.reduce((n, u) => n + u.maxStacks, 0);
