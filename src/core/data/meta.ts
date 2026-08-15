/**
 * THE WORKSHOP. Permanent upgrades bought with credits, between runs.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS AND WHERE THE HALVES LIVE
 * ---------------------------------------------------------------------------------------------
 * This file is the CONTENT: what can be bought, how many tiers it has, what a tier costs and what
 * a tier does. It is a table, and adding an eighth upgrade is a literal in it.
 *
 * It is NOT the save. Which tiers a player owns lives in `Settings.metaTiers` (src/appState.ts),
 * because a save is the app layer's problem and core does not know what one is. Core is handed a
 * plain array of tier counts on `WorldConfig` and resolves stats from it, exactly the way it is
 * handed a `Tuning` - data in, no storage, no branching on whether a shop exists.
 *
 * ---------------------------------------------------------------------------------------------
 * A TIER IS A SHARE OF THE STATED MAXIMUM, NOT A RUNG ON A RAMP
 * ---------------------------------------------------------------------------------------------
 * The in-run cards use a BACK-LOADED ramp - `PASSIVE_RAMP` - where the seventh rung is worth twice
 * the first, so that the last card in a ladder still feels like something. The workshop does the
 * opposite deliberately: every tier of an upgrade is worth exactly the same, `max / tiers`, and
 * every tier costs the same.
 *
 * That is because these are bought rather than found. A ramp makes the first purchase the worst
 * value and the last the best, which in a shop means "save up" is always right and buying early is
 * always a mistake - a decision with one answer is not a decision. Flat tiers make the question the
 * only one worth asking: which upgrade, not when.
 *
 * ---------------------------------------------------------------------------------------------
 * THE NUMBERS ARE ON SCREEN HERE, AND THAT IS NOT A BREACH OF THE CARD RULE
 * ---------------------------------------------------------------------------------------------
 * Upgrade CARDS carry no magnitudes on purpose: a card is read in four seconds with a horde closing
 * in, and a percentage invites arithmetic instead of a decision. None of that is true of a shop.
 * The horde is not coming, the player is spending a currency they had to earn, and comparing "+30%
 * damage for 350" against "+15% range for 150" IS the activity. Withholding the numbers here would
 * not preserve the feel of a card, it would just make the prices unanswerable.
 *
 * So `metaEffectText` states the effect plainly and the screen shows the per-tier cost. It is asked
 * for WHAT THE PLAYER OWNS rather than only what a full ladder comes to, because "what am I
 * actually running with" is the other half of the question a shop is there to answer - and with
 * every tier worth the same, the current figure is also the clearest possible statement of what the
 * next one buys.
 *
 * ---------------------------------------------------------------------------------------------
 * PERCENTAGES ADD, HERE TOO
 * ---------------------------------------------------------------------------------------------
 * A `mul` amount is a share of the BASE and is summed with every other share - see `resolveOne` in
 * stats.ts. So workshop damage and a maxed Ordnance are +30% and +130%, landing at +160% of base,
 * NOT 1.3 x 2.3. That is the rule for the whole game and the workshop is not an exception to it -
 * a permanent upgrade that multiplied on top of a run's own cards would be worth several times more
 * to a finished build than to a fresh one, and nothing on the screen would say so.
 */

import type { WeaponId } from '../content/definitions.js';
import type { PlayerStatKey, WeaponStatKey } from './stats.js';

export type MetaId =
  | 'm-damage'
  | 'm-range'
  | 'm-rate'
  | 'm-armour'
  | 'm-speed'
  | 'm-laser'
  | 'm-drone';

/**
 * One stat change, per tier owned.
 *
 * Same shape as `UpgradeEffect` plus one field it does not have: `weapon`. A card cannot scope
 * itself to a single gun - every passive in the deck is deliberately "every weapon" - but the
 * workshop sells one upgrade that is about the drone bay specifically, and the alternative to
 * scoping was inventing a `droneBuildSec` stat that only one weapon reads.
 */
export interface MetaEffect {
  readonly target: 'player' | 'weapon';
  readonly key: PlayerStatKey | WeaponStatKey;
  /** 'add' is absolute units; 'mul' is a share of base, summed with every other share. */
  readonly mode: 'add' | 'mul';
  /** PER TIER. Owning n tiers applies this n times. */
  readonly amount: number;
  /** Weapon-scoped effects apply only when resolving that weapon. Omitted means every weapon. */
  readonly weapon?: WeaponId;
}

/**
 * How to say out loud what a given number of tiers is worth.
 *
 * NAMES THE HEADLINE EFFECT RATHER THAN RESTATING ITS SIZE. An upgrade may touch more than one stat
 * - damage drags heat, speed drags acceleration - and only one of those is what the player is
 * buying. So this names the KEY, and the magnitude is read back out of `effects`.
 *
 * That is the whole reason it is shaped this way. A hand-written "+30% damage at full" beside an
 * amount of `0.3 / 7` is two places to keep true, and the day somebody retunes the ladder the
 * string is the half that gets forgotten - on a shop screen, where the string IS the offer.
 */
export interface MetaDisplay {
  /** Which of `effects` is the headline. */
  readonly key: PlayerStatKey | WeaponStatKey;
  /**
   *   percent         a share of base, shown as +X%
   *   rateOfFire      a cooldown REDUCTION, shown as the increase in shots per second it produces
   *   flat            absolute units, shown as a bare number
   *   secondsFaster   a negative `add` in seconds, shown as how much sooner
   */
  readonly as: 'percent' | 'rateOfFire' | 'flat' | 'secondsFaster';
  /** The thing being bought, as the player would name it. */
  readonly noun: string;
}

export interface MetaDef {
  readonly id: MetaId;
  readonly name: string;
  /** What it does, in the player's words. */
  readonly blurb: string;
  readonly tiers: number;
  /** Credits per tier. Flat: every tier of one upgrade costs the same. */
  readonly cost: number;
  readonly effects: readonly MetaEffect[];
  /** How `metaEffectText` phrases this upgrade. See MetaDisplay. */
  readonly display: MetaDisplay;
}

/**
 * `+X% rate of fire` is a REDUCTION of cooldown, and the two are not the same number.
 *
 * Firing 10% more often means the gap between shots is 1/1.1 of what it was, so the multiplier
 * wanted is -0.0909..., not -0.10. Feed Systems does the same conversion for the same reason; this
 * is that arithmetic written once rather than a decimal nobody could check.
 */
function rateToCooldown(rate: number): number {
  return 1 / (1 + rate) - 1;
}

export const META_CATALOG: readonly MetaDef[] = Object.freeze([
  {
    id: 'm-damage',
    name: 'Ordnance Stores',
    blurb:
      'Every gun the yard hands you hits harder, from the first second of the run. A hotter-running laser burns through its heat faster.',
    tiers: 7,
    cost: 50,
    // HEAT RIDES WITH DAMAGE, exactly as it does on the Ordnance card and on the lasers' own damage
    // rungs. The rule in this game is that raw power on a beam costs burst - you buy the burst back
    // with capacity and dispersion tiers, and in this shop that is Coolant Baffles.
    //
    // Shipping this without the heat clause made it strictly better on a laser than the in-run card
    // that says the same words, which is the exact trap the Ordnance comment warns about: a bonus
    // that quietly adds "and on these three, ignore the mechanic they are built around". A
    // permanent upgrade is the worst possible place for that exemption, because unlike a card it is
    // in play from the first second of every run.
    //
    // PROPORTIONAL AND PAIRED AT THE SAME AMOUNT, so it lands in line with whatever that laser's
    // heat profile already is. A no-op for everything else: projectile weapons declare
    // `heatPerSec: 0`, and a share of zero is zero.
    effects: Object.freeze([
      { target: 'weapon' as const, key: 'damage' as const, mode: 'mul' as const, amount: 0.3 / 7 },
      {
        target: 'weapon' as const,
        key: 'heatPerSec' as const,
        mode: 'mul' as const,
        amount: 0.3 / 7,
      },
    ]),
    display: { key: 'damage', as: 'percent', noun: 'damage' },
  },
  {
    id: 'm-range',
    name: 'Optical Array',
    blurb: 'Everything reaches further, so the horde is dying before it arrives.',
    tiers: 5,
    cost: 30,
    effects: Object.freeze([
      { target: 'weapon' as const, key: 'range' as const, mode: 'mul' as const, amount: 0.15 / 5 },
    ]),
    display: { key: 'range', as: 'percent', noun: 'range' },
  },
  {
    id: 'm-rate',
    name: 'Autoloaders',
    blurb: 'Shorter gaps between shots on everything that has a gap.',
    tiers: 3,
    // COOLDOWN ONLY, unlike Feed Systems, which also buys heat dispersion and reload seconds. The
    // workshop sells those separately - dispersion IS Coolant Baffles - and one upgrade that
    // quietly contained another would make the cheaper one pointless.
    cost: 40,
    effects: Object.freeze([
      {
        target: 'weapon' as const,
        key: 'cooldown' as const,
        mode: 'mul' as const,
        amount: rateToCooldown(0.1) / 3,
      },
    ]),
    display: { key: 'cooldown', as: 'rateOfFire', noun: 'rate of fire' },
  },
  {
    id: 'm-armour',
    name: 'Hull Plating',
    blurb: 'Takes a little off every hit you take, for the whole run.',
    // FLAT, because base armour is 0 and a percentage of nothing is nothing - the same reason
    // Ablative Plate is flat. Two armour is small against an elite and real against a swarm.
    tiers: 2,
    cost: 50,
    effects: Object.freeze([
      { target: 'player' as const, key: 'armour' as const, mode: 'add' as const, amount: 1 },
    ]),
    display: { key: 'armour', as: 'flat', noun: 'armour' },
  },
  {
    id: 'm-speed',
    name: 'Servo Tuning',
    blurb: 'The chassis walks quicker, whichever chassis it is.',
    tiers: 3,
    cost: 45,
    // BOTH KEYS, for the reason Servo Drive gives: moveDrag is derived as accel / maxSpeed, so
    // raising the ceiling alone would make the mech float - a higher top speed it takes noticeably
    // longer to reach. Scaling both keeps time-to-max-speed constant.
    effects: Object.freeze([
      {
        target: 'player' as const,
        key: 'moveMaxSpeed' as const,
        mode: 'mul' as const,
        amount: 0.15 / 3,
      },
      {
        target: 'player' as const,
        key: 'moveAccel' as const,
        mode: 'mul' as const,
        amount: 0.15 / 3,
      },
    ]),
    display: { key: 'moveMaxSpeed', as: 'percent', noun: 'movement speed' },
  },
  {
    id: 'm-laser',
    name: 'Coolant Baffles',
    blurb: 'The beams shed heat faster, so they cut out for less of the fight.',
    tiers: 1,
    cost: 100,
    // A NO-OP FOR EVERYTHING ELSE, and it needs no scoping to be one: projectile weapons declare
    // `heatDispersion: 0`, and a share of zero is zero. The same trick the Ordnance card uses to
    // put a heat clause on a card every weapon can hold.
    effects: Object.freeze([
      {
        target: 'weapon' as const,
        key: 'heatDispersion' as const,
        mode: 'mul' as const,
        amount: 0.1,
      },
    ]),
    display: { key: 'heatDispersion', as: 'percent', noun: 'heat dispersion' },
  },
  {
    id: 'm-drone',
    name: 'Fabricator Feed',
    blurb: 'The drone bay turns a new drone around sooner.',
    tiers: 2,
    cost: 80,
    // SCOPED TO THE DRONE, and it has to be: build time IS the drone weapon's `cooldown`, so an
    // unscoped -1s would take a second off every gun in the game and be worth many times its price.
    effects: Object.freeze([
      {
        target: 'weapon' as const,
        key: 'cooldown' as const,
        mode: 'add' as const,
        amount: -1,
        weapon: 'drone' as const,
      },
    ]),
    display: { key: 'cooldown', as: 'secondsFaster', noun: 'drone build time' },
  },
]);

/** Trims a trailing `.0` so a whole number reads as one. 12.857 -> "12.9", 30 -> "30". */
function oneDecimal(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * What `tiers` tiers of this upgrade are worth, in words.
 *
 * READ BACK OUT OF `effects`, never restated beside them - see MetaDisplay. Pass `def.tiers` for
 * the full-ladder figure and the owned count for what the player has right now.
 *
 * RATE OF FIRE IS NOT A CLEAN MULTIPLE OF ITS TIERS, and that is arithmetic rather than a bug. The
 * ladder buys equal reductions of COOLDOWN, and rate is cooldown's reciprocal, so equal steps down
 * are slightly accelerating steps up: three tiers read +3.1%, +6.5%, +10%. Making the advertised
 * rate linear instead would make the underlying stat's steps unequal, and the stat is the thing
 * that is actually the same size every time. The gap is a tenth of a percent either way.
 */
export function metaEffectText(def: MetaDef, tiers: number, bare = false): string {
  const d = def.display;
  const fx = def.effects.find((e) => e.key === d.key);
  if (fx === undefined || tiers <= 0) return '';
  const total = fx.amount * (tiers > def.tiers ? def.tiers : tiers);

  switch (d.as) {
    case 'percent':
      return bare ? `+${oneDecimal(total * 100)}%` : `+${oneDecimal(total * 100)}% ${d.noun}`;
    case 'rateOfFire': {
      // `total` is the cooldown share, which is negative. 1/(1+m) - 1 is the rate it produces.
      const rate = oneDecimal((1 / (1 + total) - 1) * 100);
      return bare ? `+${rate}%` : `+${rate}% ${d.noun}`;
    }
    case 'flat':
      return bare ? oneDecimal(total) : `${oneDecimal(total)} ${d.noun}`;
    case 'secondsFaster':
      return bare ? `${oneDecimal(-total)}s` : `Drones build ${oneDecimal(-total)}s faster`;
  }
}

/** Catalog index for an id, or -1. */
export function metaIndex(id: MetaId): number {
  for (let i = 0; i < META_CATALOG.length; i++) {
    if (META_CATALOG[i].id === id) return i;
  }
  return -1;
}

/** What the NEXT tier of this upgrade costs, or -1 when it is already full. */
export function metaNextCost(def: MetaDef, owned: number): number {
  return owned >= def.tiers ? -1 : def.cost;
}

/**
 * Everything sunk into the workshop, in credits, by catalog index.
 *
 * THIS IS WHAT THE REFUND PAYS BACK, and it is computed rather than stored for exactly that
 * reason. A separately-banked "spent" total is a second source of truth that can disagree with the
 * tiers it is supposed to describe - and the day it does, the refund either invents credits or eats
 * them. Derived from the tiers, it cannot: flat per-tier pricing makes the sum exact, with no
 * rounding to decide who absorbs.
 */
export function metaSpent(tiers: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < META_CATALOG.length; i++) {
    const def = META_CATALOG[i];
    const owned = tiers[i] ?? 0;
    const held = owned > def.tiers ? def.tiers : owned < 0 ? 0 : owned;
    total += held * def.cost;
  }
  return total;
}

/** Reused by the resolver; a few dozen calls per run, never concurrently. */
const META_ACC = { add: 0, mul: 1 };

/**
 * Sums every owned tier's contribution to one stat.
 *
 * `weapon` is the id of the weapon being resolved, or undefined for a player stat. A scoped effect
 * that names a different weapon is skipped; an unscoped one always applies.
 *
 * THE RETURNED OBJECT IS REUSED - the same instance on every call, like `ACC` in stats.ts. Read it
 * before calling again, or copy it. Holding two results and comparing them compares the second to
 * itself, which is a mistake that looks completely reasonable on the page.
 */
export function accumulateMeta(
  tiers: ArrayLike<number>,
  target: 'player' | 'weapon',
  key: string,
  weapon: WeaponId | undefined,
): { readonly add: number; readonly mul: number } {
  META_ACC.add = 0;
  META_ACC.mul = 1;
  for (let i = 0; i < META_CATALOG.length; i++) {
    const owned = tiers[i] ?? 0;
    if (owned <= 0) continue;
    const def = META_CATALOG[i];
    const held = owned > def.tiers ? def.tiers : owned;
    for (const fx of def.effects) {
      if (fx.target !== target || fx.key !== key) continue;
      if (fx.weapon !== undefined && fx.weapon !== weapon) continue;
      if (fx.mode === 'add') META_ACC.add += fx.amount * held;
      else META_ACC.mul += fx.amount * held;
    }
  }
  return META_ACC;
}
