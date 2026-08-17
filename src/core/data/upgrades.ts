/**
 * THE UPGRADE POOL.
 *
 * ---------------------------------------------------------------------------------------------
 * CARD TEXT CARRIES NO NUMBERS
 * ---------------------------------------------------------------------------------------------
 * Every `description` and every entry of `tiers` is qualitative: "reaches further", "a heavier
 * shell", "burns hotter - and heats itself up faster doing it". The one exception is a COUNT OF
 * PROJECTILES - "a third missile", "a fourth missile", "a third shell" - because that is not a
 * magnitude, it is a different thing happening: three warheads in the air instead of two is
 * visible from the card and visible on the screen, and rounding it to "more missiles" would be
 * vaguer than the game actually is.
 *
 * (Two counts sit just inside that exception on purpose: the Cannon's extra pierce and the
 * shield's second rim. Both are a discrete +1 that changes what a shot or a hit DOES, and both
 * read as nonsense without the number - "shells punch through enemies" is not the tier.)
 *
 * WHY. A percentage on a card invites arithmetic, and arithmetic is not the decision the card is
 * asking about. "+7% weapon range" reads as a number to compare against another number; "every
 * weapon reaches further" reads as a thing that happens to your mech. The second is what a player
 * with four seconds and a horde closing in can actually use.
 *
 * THE SHAPE OF A LADDER STILL HAS TO SURVIVE IT. The passives are back-loaded - the seventh rung
 * is worth twice the first - and a player who cannot see 5% against 10% must still be able to feel
 * that, or taking the same card again stops being a decision. So the wording escalates in three
 * bands (`rampText`), banded where the ramp's own steps fall.
 *
 * This is NOT a retreat from "the number on screen is always the number" (DESIGN.md 7.3). That
 * rule is about ACCURACY - no hidden spread, no fudged rolls, what is displayed is what happens.
 * Showing fewer numbers is not showing false ones, and every number that IS shown - a heat bar, a
 * damage figure in the summary - is still exact.
 *
 * SIXTEEN CARDS: nine weapons and seven passives, every one of them SEVEN TIERS deep. Tier 1 puts
 * the thing in your hands; tiers 2-7 change what it does. A run has five weapon slots and five
 * passive slots, so nothing here is a collection to complete - 112 tiers exist and a long run
 * takes perhaps 30 of them.
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
import type { UnlockCond } from './unlocks.js';
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
  | 'w-drone'
  | 'w-phase-cannon'
  | 'p-range'
  | 'p-damage'
  | 'p-rate'
  | 'p-speed'
  | 'p-armour'
  | 'p-shield'
  | 'p-repair'
  | 'p-radiator';

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
  /** The upgrade the run must be holding. A passive for most; the Hornet names another WEAPON. */
  readonly requires: UpgradeId;
  /**
   * The tier `requires` must have reached. 1 means merely held, which is what every ascension
   * before the Hornet wanted and what a passive requirement should keep meaning - the Chain Laser
   * asks for a build that went NEAR Targeting Optics, not one that maxed it.
   *
   * The Hornet asks for 7, and that is a different kind of demand: it is not "you also took the
   * short rack", it is "you finished it". Which is the point, because it then TAKES it.
   */
  readonly requiresTier: number;
  /**
   * An upgrade this ascension CONSUMES, if any. Its weapon is stripped out of the loadout and its
   * tiers are given back to zero, so the slot is free and the card can be offered again as a
   * brand new gun.
   *
   * THE ONLY MECHANISM IN THE GAME THAT TAKES SOMETHING AWAY. It exists because the Hornet does
   * not merely reference the short rack - it eats it, and fires its warheads. An ascension that
   * added a second rack's worth of missiles for free would be strictly better than holding both,
   * which is not a decision.
   */
  readonly consumes?: UpgradeId;
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
   * OFFERED, so a player about to take tier 4 reads what THAT rung does rather than a generic
   * "Level up Short Laser". Length must equal maxStacks.
   *
   * NO NUMBERS. See the file header.
   */
  readonly tiers: readonly string[];
  /** Equals WEAPON_MAX_TIER for weapon cards: stacks taken IS the weapon's tier. */
  readonly maxStacks: number;
  /**
   * WHAT A PLAYER MUST HAVE DONE BEFORE THIS CARD IS EVER OFFERED. Absent = offered from the first
   * run, which is every card but one.
   *
   * The SAME condition language the chassis roster uses (data/unlocks.ts), evaluated by the app
   * against the save file and pushed into `World.cardUnlocked` at run start - core never learns
   * what a save is. A locked card is invisible to the deck; it is not a dimmed offer.
   *
   * This is a heavier thing to add than a chassis lock, and worth being reluctant about: a locked
   * chassis costs a player one of sixteen ways to start, while a locked card is content missing
   * from every run they play until they earn it.
   */
  readonly unlock?: UnlockCond;
  /**
   * WHAT THE LOADOUT MUST HOLD RIGHT NOW for this card to be offered. Absent = offered regardless
   * of loadout, which is every card but one.
   *
   * A DIFFERENT QUESTION FROM `unlock`, and evaluated a different way. `unlock` is decided once at
   * run start from the save - has this ever been EARNED. This is decided fresh every card, against
   * the RUN IN PROGRESS - is it USEFUL right now. A passive whose entire effect keys off one
   * archetype of weapon (see p-radiator, which is a no-op on anything but a laser) is a dead pick
   * for a run holding none, and the deck should not spend an offer slot on a card that does nothing.
   *
   * ANY ONE of the list is enough, matching the `killsWith`/`bossKillBy` rule: this asks for a
   * KIND of weapon, not a specific model.
   */
  readonly requiresWeaponHeld?: readonly WeaponId[];
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
/**
 * The laser ladder, said in words. Identical text on the repeated rungs (5 repeats 2, 7 repeats 4)
 * because they ARE the same rung twice - inventing a difference in the wording would be inventing
 * a difference in the weapon.
 */
function laserTierText(): readonly string[] {
  return Object.freeze([
    'Unlock.',
    'Burns hotter - and heats itself up faster doing it.',
    'A bigger heat sink: longer bursts before it cuts out.',
    'Sheds heat faster, so it comes back sooner.',
    'Burns hotter - and heats itself up faster doing it.',
    'A bigger heat sink: longer bursts before it cuts out.',
    'Sheds heat faster, so it comes back sooner.',
  ]);
}

// ---------------------------------------------------------------------------------------------
// PASSIVES
//
// SEVEN cards for FIVE slots (MAX_PASSIVES), so a finished build has deliberately left two behind.
//
// Five of the seven are percentage cards on the shared ramp below. Energy Shield is not a
// percentage of anything - it installs a mechanism - and Radiator Bank splits its ramp across two
// keys instead of one; both are authored at the bottom of the catalog with their own reasoning.
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

/**
 * A passive's seven rungs, said in words.
 *
 * NO NUMBERS ON A CARD (see the header). The ramp is back-loaded - 5/5/6/7/8/9/10, so the seventh
 * rung is worth twice the first - and a player who cannot see the percentages still has to be able
 * to feel that shape, or "take this card again" stops being a decision. So the seven rungs are
 * banded 2/3/2 onto three phrasings, which is exactly where the ramp's own steps fall.
 */
function rampText(small: string, mid: string, big: string): readonly string[] {
  return Object.freeze([small, small, mid, mid, mid, big, big]);
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
      'Reaches further.',
      'Lays and fires quicker.',
      'A heavier shell.',
      'Reaches further again.',
      'Lays and fires quicker again.',
      'Shells punch through one extra enemy.',
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
      'Rearms sooner.',
      'Homes more tightly.',
      'Heavier warheads.',
      'Rearms sooner again.',
      'Homes more tightly again.',
      'A third missile.',
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-missile-long',
    /**
     * THE GTM HORNET, and it is the first ascension that COSTS something.
     *
     * The Chain Laser asks for a passive held at any tier: a nudge toward a build. This asks for
     * the Short Missiles FINISHED, at seven, and then takes them - the rack is stripped for parts
     * and its slot comes back empty for a new gun.
     *
     * That is the whole design. The Hornet fires the short rack's warheads out of the long rack's
     * tubes, so a run that has both is carrying the same missiles twice; folding one into the
     * other is a trade rather than a bonus. An ascension that simply added a second rack's worth
     * of missiles for free would be strictly better than holding both, and a choice nobody can
     * lose is not a choice.
     */
    ascension: Object.freeze({
      name: 'GTM Hornet',
      icon: 'w-gtm-hornet',
      requires: 'w-missile-short' as const,
      requiresTier: WEAPON_MAX_TIER,
      consumes: 'w-missile-short' as const,
      description:
        'Shortly after launch, every missile still in the air splits into two short-range missiles fifteen degrees apart. The short rack is stripped for parts and its slot comes back empty.',
    }),
    kind: 'weapon',
    grantsWeapon: 'missile-long',
    name: 'Long Missiles',
    description: 'Three missiles on a long fuse, fired where you last moved. Weak homing, wide reach.',
    tiers: Object.freeze([
      'Unlock.',
      'Rearms sooner.',
      'Homes more tightly.',
      'Heavier warheads.',
      'A fourth missile.',
      'A longer fuse, so they fly further before they fall.',
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
      'Two rounds at a time into the weakest enemy, very close in. A deep belt, then a long reload.',
    tiers: Object.freeze([
      'Unlock.',
      'A harder-hitting round.',
      'Spins faster.',
      'A deeper magazine.',
      'Reaches further.',
      'A much harder-hitting round.',
      'Reloads much faster.',
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
      'A wider blast.',
      'Shells fall more often.',
      'Heavier shells.',
      'A wider blast again.',
      'Shells fall more often again.',
      'A third shell.',
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    effects: [],
  },
  {
    id: 'w-drone',
    kind: 'weapon',
    grantsWeapon: 'drone',
    name: 'Drones',
    description:
      'Builds a drone that flies escort, hunts anything that comes close, and shoots it with a machine gun until its magazine is dry. Then it detonates.',
    tiers: Object.freeze([
      'Unlock.',
      'Builds faster.',
      'A second drone.',
      'Builds faster again.',
      'A third drone.',
      'Builds faster again.',
      'A fourth drone, and faster still.',
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    // LOCKED UNTIL THE YARD IS BEATEN. The one card in the deck that has to be earned - see
    // `unlock` above, and the chassis that opens with it for the way in that does not.
    unlock: { kind: 'win' },
    effects: [],
  },
  {
    id: 'w-phase-cannon',
    kind: 'weapon',
    grantsWeapon: 'phase-cannon',
    name: 'Phase Cannon',
    description:
      'One plasma bolt that flies through everything - the horde, the wrecks, the walls - and bursts on the thickest knot of enemies it can find.',
    // Order matches the weapon's own perLevel ladder exactly: damage, burst, rate, twice around.
    tiers: Object.freeze([
      'Unlock.',
      'A heavier bolt.',
      'A wider burst.',
      'Rearms sooner.',
      'A heavier bolt again.',
      'A wider burst again.',
      'Rearms sooner still.',
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 10,
    /**
     * LOCKED BEHIND ITSELF: a thousand and one killing blows with the gun, in one run. The same
     * bootstrap the drone card uses - the card cannot come up in the deck until earned, and the
     * chassis that OPENS with it (Brass) is the way in: a held card keeps offering its tiers
     * whatever the lock says, so Brass levels it while everyone else is still earning it.
     */
    unlock: { kind: 'killsWith', weapons: ['phase-cannon'], count: 1001 },
    effects: [],
  },
  {
    id: 'w-laser-short',
    kind: 'weapon',
    grantsWeapon: 'laser-short',
    name: 'Short Laser',
    description: 'Green beam. Burns whatever stands between you and the weakest enemy.',
    tiers: laserTierText(),
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
      requiresTier: 1,
      description:
        'The beam jumps. From whatever it burns it reaches the nearest enemy not already in the chain, and keeps going while the whole beam still fits inside its range.',
    }),
    kind: 'weapon',
    grantsWeapon: 'laser-medium',
    name: 'Medium Laser',
    description: 'Blue beam. Moderate damage at middling range, and it runs hot.',
    tiers: laserTierText(),
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
    tiers: laserTierText(),
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
    tiers: rampText(
      'Every weapon reaches a little further.',
      'Every weapon reaches further.',
      'Every weapon reaches much further.',
    ),
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
    tiers: rampText(
      'Every weapon hits a little harder.',
      'Every weapon hits harder.',
      'Every weapon hits much harder.',
    ),
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
    // Both halves in every rung, because both halves land in every rung - a card that mentioned
    // the reload only on the tiers where it happened to be large would be lying by omission.
    tiers: rampText(
      'Everything fires a little more often, and reloads a little sooner.',
      'Everything fires more often, and reloads sooner.',
      'Everything fires much more often, and reloads much sooner.',
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
    tiers: rampText(
      'The chassis moves a little faster.',
      'The chassis moves faster.',
      'The chassis moves much faster.',
    ),
    tierEffects: rampEffects('player', ['moveMaxSpeed', 'moveAccel']),
    maxStacks: WEAPON_MAX_TIER,
    weight: 9,
    effects: [],
  },
  {
    id: 'p-armour',
    kind: 'passive',
    name: 'Ablative Plate',
    description: 'Takes something off every hit you take - never all of it, and never nothing.',
    // FLAT, not a percentage. Base armour is 0, so a multiplier would be worth precisely nothing -
    // the one place the shared ramp cannot be used. The same back-loaded shape by hand: +22 armour
    // in total, seventh tier twice the first.
    //
    // Flat armour is strong against the swarm and weak against elites by design (tuning.ts): 22
    // armour turns a 5-damage runt hit into the 25% floor, and a 28-damage elite hit into 6.
    // It buys tolerance for being SURROUNDED, never for being hit by the big thing.
    tiers: Object.freeze([
      'A little more plating.',
      'A little more plating.',
      'More plating.',
      'More plating.',
      'Much more plating.',
      'Much more plating.',
      'Much more plating.',
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
    id: 'p-repair',
    kind: 'passive',
    /**
     * THE NAME WAS CONTESTED AND THIS SIDE WON IT. "Field Repair" was the one-off patch a chest or
     * a card hands over when there is nothing left to fit (OFFER_HEAL); that is now PATCH REPAIR,
     * and the permanent system has the name. It is the right way round - a consolation prize is
     * the thing that should be described by what it is, and a system the player builds a run
     * around is the thing that should own the name.
     *
     * THE ID IS UNTOUCHED THROUGHOUT. `p-repair` is what a save file stores
     * (Settings.earnedCards), so renaming it would take the card away from everyone who had
     * unlocked it - see CLAUDE.md. The icon file is keyed off it too. The id is a union member we
     * rename freely in principle; this one has shipped, so it does not move however often the
     * display name does.
     */
    name: 'Field Repair',
    // The UNLOCK card carries the whole mechanism, like the Energy Shield's does: both numbers are
    // 0 at base, so "Unlock." on its own would put the entire card nowhere the player can read it.
    description:
      'A repair clock. Every few seconds it puts a little of your hull back - the only thing in the yard that mends you without being picked up.',
    /**
     * TWO DIALS ON ONE CLOCK, and the ladder alternates them on purpose: five tiers add hit points
     * and two shorten the interval. That is not the same card twice. More hit points per tick makes
     * a repair worth more when it lands; a shorter interval changes how OFTEN you are safe, which
     * is the thing a player actually feels while being chased.
     *
     *   1  unlock   1 hp / 7 s
     *   2  +1 hp    2 hp / 7 s
     *   3  +1 hp    3 hp / 7 s
     *   4  faster   3 hp / 6 s
     *   5  +1 hp    4 hp / 6 s
     *   6  +1 hp    5 hp / 6 s
     *   7  faster   5 hp / 5 s   = 1 hp/s, against a base 120 hp hull
     *
     * NO NUMBERS ON THE CARD TEXT, per the house rule - but "sooner" and "more" have to be
     * distinguishable in words, because they are the whole choice this ladder offers.
     */
    tiers: Object.freeze([
      'Unlock.',
      'Repairs more each time.',
      'Repairs more each time.',
      'Repairs sooner.',
      'Repairs more each time.',
      'Repairs more each time.',
      'Repairs sooner again.',
    ]),
    tierEffects: Object.freeze([
      [
        { target: 'player' as const, key: 'repairAmount' as const, mode: 'add' as const, amount: 1 },
        // The interval is SET at unlock rather than added to, because a base of 0 means "no clock"
        // and adding to it would make the card's first tier depend on a number that is not there.
        { target: 'player' as const, key: 'repairInterval' as const, mode: 'add' as const, amount: 7 },
      ],
      [{ target: 'player' as const, key: 'repairAmount' as const, mode: 'add' as const, amount: 1 }],
      [{ target: 'player' as const, key: 'repairAmount' as const, mode: 'add' as const, amount: 1 }],
      [{ target: 'player' as const, key: 'repairInterval' as const, mode: 'add' as const, amount: -1 }],
      [{ target: 'player' as const, key: 'repairAmount' as const, mode: 'add' as const, amount: 1 }],
      [{ target: 'player' as const, key: 'repairAmount' as const, mode: 'add' as const, amount: 1 }],
      [{ target: 'player' as const, key: 'repairInterval' as const, mode: 'add' as const, amount: -1 }],
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 9,
    effects: [],
    /**
     * EARNED BY SURVIVING SOMETHING, which is the only kind of condition this card could honestly
     * have. It is a card about coming back from the edge, so it is unlocked by coming back from the
     * edge: drop under a fifth of your hull at any point in a run, and reach full hull in that
     * same run.
     *
     * That is still a hard thing to do: the level-up heal is gone and a spanner is the only thing
     * that mends you, so it asks the player to find several after a bad patch. A run that manages
     * it has earned a repair clock.
     */
    unlock: Object.freeze({ kind: 'fullRepair' as const }),
  },
  {
    id: 'p-shield',
    kind: 'passive',
    name: 'Energy Shield',
    // The UNLOCK card shows this instead of tiers[0], so it has to carry the whole mechanism -
    // "Unlock." on its own would put the three numbers that define the card nowhere the player
    // can read them before spending the pick.
    description:
      'A blue rim absorbs one hit outright and burns whatever broke it. A moment of immunity with it, and then it comes back.',
    // NOT a percentage card, and not on the shared ramp: there is nothing here to take a
    // percentage OF. All three numbers are 0 at base (tuning.ts), so the unlock tier carries the
    // whole mechanism and the six after it move three separate dials.
    //
    // WHY IT IS NOT REDUNDANT WITH ABLATIVE PLATE. Armour subtracts a flat amount from every hit,
    // so it is worth 22 HP against a runt nibble and 22 HP against a boss slam - which means
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
      'Comes back sooner.',
      'A longer moment of immunity when it breaks.',
      'Comes back sooner again.',
      'A longer moment still.',
      'Comes back much sooner.',
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
  {
    id: 'p-radiator',
    kind: 'passive',
    /**
     * RADIATOR BANK - a laser specialist, and the first passive that is honestly a dead pick on a
     * run holding none. Every other passive here does SOMETHING for every weapon, even when heat
     * is a rider on a broader effect (Ordnance's damage, Feed Systems' rate); this card's entire
     * effect is heat, full stop, so `requiresWeaponHeld` keeps it out of the deck for anyone who
     * cannot use it rather than offering a slot that does nothing.
     *
     * TWO DIALS, NOT ONE, and that is the reason to add a second heat card rather than just taking
     * Feed Systems further: dispersion buys a SHORTER WAIT between bursts, capacity buys a LONGER
     * BURST before the cut-out - two different questions at the trigger, and nothing else in the
     * catalog moves capacity at all (only a laser's own T3/T6 tiers do). Stacking this with Feed
     * Systems still compounds on the dispersion half, which is fine: that overlap is the price of
     * this card sharing a lever with an existing one rather than inventing a third.
     *
     * THE RAMP IS SPLIT ACROSS BOTH KEYS rather than the shared PASSIVE_RAMP applied once, so each
     * half is worth less per tier than a single-key card's ramp - the same trade Feed Systems makes
     * across three keys instead of one. Dispersion carries the open and close rungs (1, 3, 5, 7),
     * capacity the middle three (2, 4, 6), so the card never spends two tiers in a row on the same
     * dial.
     *
     * NOT MEASURED YET. These numbers are a first pass, not a claim - see CLAUDE.md, "measure
     * balance changes, do not assert them". A `dps`/`t8` run against a laser-only loadout with this
     * maxed is owed before treating the ramp as final.
     */
    name: 'Radiator Bank',
    description: 'Every beam runs a bigger heat buffer and sheds it faster between bursts.',
    tiers: Object.freeze([
      'Sheds heat a little faster between bursts.',
      'Carries a bigger heat buffer.',
      'Sheds heat faster between bursts.',
      'Carries a bigger heat buffer.',
      'Sheds heat faster between bursts.',
      'Carries a much bigger heat buffer.',
      'Sheds heat much faster between bursts.',
    ]),
    tierEffects: Object.freeze([
      [{ target: 'weapon' as const, key: 'heatDispersion' as const, mode: 'mul' as const, amount: 0.08 }],
      [{ target: 'weapon' as const, key: 'heatCapacity' as const, mode: 'mul' as const, amount: 0.08 }],
      [{ target: 'weapon' as const, key: 'heatDispersion' as const, mode: 'mul' as const, amount: 0.08 }],
      [{ target: 'weapon' as const, key: 'heatCapacity' as const, mode: 'mul' as const, amount: 0.1 }],
      [{ target: 'weapon' as const, key: 'heatDispersion' as const, mode: 'mul' as const, amount: 0.1 }],
      [{ target: 'weapon' as const, key: 'heatCapacity' as const, mode: 'mul' as const, amount: 0.12 }],
      [{ target: 'weapon' as const, key: 'heatDispersion' as const, mode: 'mul' as const, amount: 0.12 }],
    ]),
    maxStacks: WEAPON_MAX_TIER,
    weight: 9,
    effects: [],
    requiresWeaponHeld: Object.freeze(['laser-short', 'laser-medium', 'laser-long']),
    /**
     * BEHIND HAVING RUN ALL THREE LASERS RED-HOT AT ONCE - a run that has already committed hard
     * enough to lasers to feel the exact problem this card solves. See UnlockCond
     * `lasersOverheated` and RunStats.lasersOverheated.
     */
    unlock: Object.freeze({ kind: 'lasersOverheated' as const }),
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
