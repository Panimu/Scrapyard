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
 * EQUAL IN WHAT THE PLAYER FEELS, which is not always equal in what the engine stores. For six of
 * the seven those are the same thing and a tier is a flat `max / tiers` of the stat. Rate of fire
 * is the exception: it is stored as a cooldown share, rate is that share's reciprocal, and only one
 * of the two can be linear. The ladder is authored in RATE and converted - see `rateLadder` - so a
 * third of the tiers is a third of the shots per second, which is the thing the price is paying
 * for. `metaEffectValue` is the number that is linear for every upgrade, and the test suite asserts
 * exactly that for the whole catalog.
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
  | 'm-heatcap'
  | 'm-drone'
  | 'm-blast'
  | 'm-insurance'
  | 'm-rerolls'
  | 'm-magnet'
  | 'm-mounts'
  | 'm-passives'
  | 'm-hp'
  | 'm-repair';

/**
 * One stat change, per tier owned.
 *
 * Same shape as `UpgradeEffect` plus one field it does not have: `weapon`. A card cannot scope
 * itself to a single gun - every passive in the deck is deliberately "every weapon" - but the
 * workshop sells one upgrade that is about the drone bay specifically, and the alternative to
 * scoping was inventing a `droneBuildSec` stat that only one weapon reads.
 */
/**
 * Things an upgrade can change that are NOT a resolved stat: run-start grants.
 *
 * A union rather than a bare string so a typo is a compile error, and separate from the stat keys
 * because these never reach `resolveOne` - `accumulateMeta` filters on `target` and a `run` effect
 * is invisible to every resolver by construction.
 */
export type RunGrantKey = 'rerolls' | 'weaponSlots' | 'passiveSlots';

export interface MetaEffect {
  /**
   * `player` and `weapon` are resolved stats. `run` is a ONE-OFF GRANT read once at run start -
   * a number the simulation is seeded with rather than one it recomputes.
   *
   * It is a target rather than a second mechanism because the alternative is what Mech Insurance
   * had to do: no effects at all, and the magnitude living in whatever code implements it. That is
   * correct for a pure behaviour with nothing to count, and wrong the moment there IS a number -
   * the shop would then have to restate it, which is the one thing MetaDisplay exists to prevent.
   */
  readonly target: 'player' | 'weapon' | 'run';
  readonly key: PlayerStatKey | WeaponStatKey | RunGrantKey;
  /** 'add' is absolute units; 'mul' is a share of base, summed with every other share. */
  readonly mode: 'add' | 'mul';
  /**
   * PER TIER. A number is that much for every tier - owning n applies it n times.
   *
   * AN ARRAY IS PER-TIER DELTAS, for the one ladder whose steps are not equal in the STAT because
   * they have to be equal in what the player feels. Rate of fire is stored as a cooldown share and
   * the two are reciprocals: equal steps down the cooldown are accelerating steps up the rate. See
   * `rateLadder`. Everything else is a plain number, because for everything else the stat and the
   * felt effect are the same shape.
   */
  readonly amount: number | readonly number[];
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
  /** Which of `effects` is the headline. Omitted for `flag`, which has no stat behind it. */
  readonly key?: PlayerStatKey | WeaponStatKey | RunGrantKey;
  /**
   *   percent         a share of base, shown as +X%
   *   rateOfFire      a cooldown REDUCTION, shown as the increase in shots per second it produces
   *   flat            absolute units, shown as a bare number
   *   count           a whole number of named things, `noun` pluralised past one
   *   secondsFaster   a negative `add` in seconds, shown as how much sooner
   *   flag            no magnitude at all - it either happens or it does not, and `noun` says what
   */
  readonly as: 'percent' | 'rateOfFire' | 'flat' | 'count' | 'secondsFaster' | 'flag';
  /** The thing being bought, as the player would name it. For `flag`, the whole sentence. */
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
  /**
   * THE VERSION OF THE DEAL, checked against every save on load.
   *
   * A purchase records the version (and the price paid) beside its tier count. When a shipped
   * upgrade is RETUNED - cost per tier, tier count, or what a tier does - bump this by one, and
   * every save holding the old deal has those tiers refunded AT THE PRICE ACTUALLY PAID and the
   * purchase removed on its next load (see `reconcileMetaTiers` in appState.ts). The player
   * keeps their credits; nobody keeps a deal that no longer exists, and nobody is silently
   * repriced to one they never agreed to.
   *
   * Do NOT bump it for a blurb or comment edit - a bump resets every owner's purchase, which is
   * the point when the numbers moved and pure noise when they did not.
   */
  readonly version: number;
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

/**
 * Per-tier cooldown deltas whose running sum lands the RATE OF FIRE on equal steps.
 *
 * THE LADDER IS AUTHORED IN RATE AND STORED AS COOLDOWN, because those are the two different things
 * this upgrade is. What the player buys and feels is shots per second: a third of the ladder should
 * be a third of the DPS, and three tiers of 3.33% should read 3.33, 6.67, 10. What the engine
 * stores is the gap between shots, and rate is its reciprocal - so a ladder of equal cooldown steps
 * produces 3.1, 6.5, 10 instead, which is a ladder whose first tier is quietly the worst buy.
 *
 * Only one of the two can be linear. This picks the one the player experiences, and pays for it by
 * making the stored deltas shrink slightly as they go - which nothing but this function needs to
 * know, because they are summed rather than compared.
 *
 * Computed rather than written out: the deltas are numbers like -0.0322581 that no reader could
 * check by eye, and the rate they are derived FROM is the number the design is actually about.
 */
function rateLadder(fullRate: number, tiers: number): readonly number[] {
  const out: number[] = [];
  let prev = 0;
  for (let i = 1; i <= tiers; i++) {
    const total = rateToCooldown((fullRate * i) / tiers);
    out.push(total - prev);
    prev = total;
  }
  return Object.freeze(out);
}

/** The summed contribution of `tiers` tiers of one effect, whichever shape its amount is. */
function effectTotal(fx: MetaEffect, tiers: number): number {
  if (typeof fx.amount === 'number') return fx.amount * tiers;
  let sum = 0;
  for (let i = 0; i < tiers && i < fx.amount.length; i++) sum += fx.amount[i];
  return sum;
}

export const META_CATALOG: readonly MetaDef[] = Object.freeze([
  {
    id: 'm-mounts',
    name: 'Reinforced Mounts',
    blurb: 'The chassis carries another gun mount. Every run, whichever mech you take out.',
    tiers: 2,
    cost: 200,
    version: 2,
    /**
     * THE MOST BUILD-CHANGING THING IN THE SHOP, first in the list because of it - and the reason
     * the base sits at THREE rather than this being a fourth and fifth mount bolted onto five.
     *
     * A run is a series of decisions about what NOT to carry, and that decision is only sharp
     * while the loadout is tight. Selling two extra mounts on top of five would have blunted the
     * decision for everyone who bought them and changed nothing for anyone who did not; moving the
     * floor to three sharpens it for a new save and makes this purchase the moment the run opens
     * back up, twice over on the way to the same five guns a fully-upgraded save always ends at.
     *
     * TWO TIERS, SOLD SEPARATELY RATHER THAN AS ONE PURCHASE. A player who has only banked enough
     * for the first tier still gets something for it - three-to-four matters on its own, not only
     * as a stepping stone to five - and 200 credits a tier is deliberately several runs' worth
     * each.
     *
     * A RUN GRANT rather than a stat, seeded into `World.maxWeapons` at createWorld - see
     * MAX_WEAPONS, which is now the BASE rather than the ceiling. Nothing recomputes it mid-run,
     * which is correct: a slot count that could change while a card was open is a card that could
     * be offered and then refused.
     */
    effects: Object.freeze([
      { target: 'run' as const, key: 'weaponSlots' as const, mode: 'add' as const, amount: 1 },
    ]),
    // A COUNT, now that it is a ladder rather than a single flip. Tier one is a fourth mount and
    // tier two a fifth, and the two states have to read differently - `count` pluralises past one,
    // so this reads "1 extra mount" and then "2 extra mounts" rather than restating a fixed ordinal
    // ("fifth") at a tier that has only bought the fourth.
    display: { key: 'weaponSlots', as: 'count', noun: 'extra mount' },
  },
  {
    id: 'm-passives',
    name: 'Auxiliary Bay',
    blurb: 'The chassis carries another passive mount. Every run, whichever mech you take out.',
    tiers: 2,
    cost: 400,
    version: 1,
    /**
     * REINFORCED MOUNTS' TWIN, on the other half of the loadout - and priced well above it on
     * purpose. A sixth weapon slot competes against eleven guns; a sixth and seventh PASSIVE slot
     * compete against the entire passive catalog, which is short enough that a build with two
     * spare bays can hold nearly all of it. That is the purchase that finally lets a finished save
     * stop choosing what to leave out of the DEFENSIVE half of a loadout, on top of the offensive
     * half Reinforced Mounts already opened up - which is exactly why it costs twice as much.
     *
     * TWO TIERS FOR THE SAME REASON REINFORCED MOUNTS IS TWO: five-to-six is worth buying on its
     * own, not only as a stepping stone to seven.
     *
     * A RUN GRANT, seeded into `World.maxPassives` at createWorld exactly the way Reinforced
     * Mounts seeds `World.maxWeapons` - see MAX_PASSIVES, the base rather than the ceiling.
     */
    effects: Object.freeze([
      { target: 'run' as const, key: 'passiveSlots' as const, mode: 'add' as const, amount: 1 },
    ]),
    display: { key: 'passiveSlots', as: 'count', noun: 'extra passive slot' },
  },
  {
    id: 'm-damage',
    name: 'Ordnance Stores',
    blurb:
      'Every gun the yard hands you hits harder, from the first second of the run. A hotter-running laser burns through its heat faster.',
    tiers: 7,
    cost: 50,
    version: 1,
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
    version: 1,
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
    version: 1,
    // A SHAPED LADDER, and the only one here. Equal cooldown steps would advertise 3.1 / 6.5 / 10
    // because rate is cooldown's reciprocal, which makes the first tier the worst buy of the three
    // for the same money. `rateLadder` authors it in rate instead: 3.3 / 6.7 / 10, equal thirds of
    // the DPS it promises, at the cost of stored deltas that shrink slightly as they go.
    effects: Object.freeze([
      {
        target: 'weapon' as const,
        key: 'cooldown' as const,
        mode: 'mul' as const,
        amount: rateLadder(0.1, 3),
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
    version: 1,
    effects: Object.freeze([
      { target: 'player' as const, key: 'armour' as const, mode: 'add' as const, amount: 1 },
    ]),
    display: { key: 'armour', as: 'flat', noun: 'armour' },
  },
  {
    id: 'm-hp',
    name: 'Hull Reserves',
    blurb:
      'The chassis carries more hull to start with. Nothing about it stops the horde reaching you - it just takes more to end the run.',
    tiers: 4,
    cost: 40,
    version: 1,
    // THE ONE BASIC STAT THE SHOP HAD NEVER SOLD. Hull Plating takes a flat amount off every hit
    // and Mech Insurance covers the run's single worst moment outright - but nothing here had ever
    // grown the pool those two are protecting. 20 hull at full ladder against a 120 hp base is real
    // without being a second Hull Plating: armour is worth more against a swarm of small hits, this
    // is worth the same against anything that lands.
    effects: Object.freeze([
      { target: 'player' as const, key: 'maxHp' as const, mode: 'add' as const, amount: 5 },
    ]),
    display: { key: 'maxHp', as: 'flat', noun: 'max hull' },
  },
  {
    id: 'm-repair',
    name: 'Repair Bay',
    blurb:
      'A small repair clock, running from the first second of the run - a trickle next to Field Repair, and no substitute for finding it, but it never has to be found at all.',
    tiers: 3,
    cost: 30,
    version: 1,
    /**
     * FIELD REPAIR'S PERMANENT SHADOW, DELIBERATELY MUCH WEAKER. The card ticks five hull points
     * back every five seconds at full ladder - 1 hp/s against a 120 hp hull, as its own comment
     * states. This tops out at three hull points every fifteen seconds: a fifth of that rate, for
     * a run that has not found Field Repair yet, or never will. It is not meant to compete with the
     * card - it exists so "no repair at all" stops being the default before you have.
     *
     * THE INTERVAL IS SET ONCE, AT TIER 1, AND NEVER TOUCHED AGAIN - unlike the card, which spends
     * two of its seven tiers shortening it. Every tier here buys the same plain thing: one more
     * hit point on the same slow clock. That keeps the headline number honest under a `flat`
     * display, where every tier is supposed to be worth exactly the same as every other - a ladder
     * that also sped up the clock would make the later tiers worth more per credit than the first.
     *
     * STACKS WITH FIELD REPAIR IF BOTH ARE HELD, the same way every additive stat in this game
     * does: the two clocks' amounts sum and their intervals sum, precisely like the card's own two
     * dials already combine with each other.
     */
    effects: Object.freeze([
      { target: 'player' as const, key: 'repairAmount' as const, mode: 'add' as const, amount: 1 },
      {
        target: 'player' as const,
        key: 'repairInterval' as const,
        mode: 'add' as const,
        amount: [15, 0, 0],
      },
    ]),
    display: { key: 'repairAmount', as: 'flat', noun: 'hp per tick' },
  },
  {
    id: 'm-speed',
    name: 'Servo Tuning',
    blurb: 'The chassis walks quicker, whichever chassis it is.',
    tiers: 3,
    cost: 45,
    version: 1,
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
    version: 1,
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
    id: 'm-heatcap',
    name: 'Heat Sinks',
    blurb: 'Every beam runs a bigger heat buffer before it has to cut out.',
    tiers: 1,
    cost: 80,
    version: 1,
    // COOLANT BAFFLES' TWIN, on the other of Radiator Bank's two dials: dispersion buys a shorter
    // silence between bursts, this buys a longer burst before the cut-out. Both are permanent
    // shadows of that in-run card at a fraction of its strength - Radiator Bank spends three tiers
    // on capacity for +30% at full, this is one tier at a little over a quarter of that.
    //
    // A NO-OP FOR ANYTHING THAT DOES NOT BUILD HEAT, the same shelter every other heat upgrade
    // here relies on - not because a projectile weapon's `heatCapacity` is always zero (most
    // declare `HEAT_CAPACITY_BASE` regardless), but because a buffer only matters once heat is
    // rising toward it, and a projectile weapon's `heatPerSec` is zero: the buffer sits there and
    // is simply never approached.
    effects: Object.freeze([
      {
        target: 'weapon' as const,
        key: 'heatCapacity' as const,
        mode: 'mul' as const,
        amount: 0.08,
      },
    ]),
    display: { key: 'heatCapacity', as: 'percent', noun: 'heat capacity' },
  },
  {
    id: 'm-drone',
    name: 'Fabricator Feed',
    blurb: 'The drone bay turns a new drone around sooner.',
    tiers: 2,
    cost: 80,
    version: 1,
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
  {
    id: 'm-blast',
    name: 'Bursting Charges',
    blurb: 'Everything that explodes, explodes wider - the artillery barrage and a spent drone alike.',
    tiers: 3,
    cost: 70,
    version: 1,
    // UNSCOPED ON PURPOSE, and a no-op for anything that does not blast: only the Heavy Artillery
    // (75 u) and the drone's death detonation (70 u) carry a `splashRadius` at all, and a share of
    // zero is zero for everything else - the same trick the heat upgrades lean on. Area grows with
    // the SQUARE of the radius, so +30% radius is ~+69% ground covered at full ladder; the radius
    // is still the number shown, because it is the ring the player actually sees on the floor.
    effects: Object.freeze([
      {
        target: 'weapon' as const,
        key: 'splashRadius' as const,
        mode: 'mul' as const,
        amount: 0.3 / 3,
      },
    ]),
    display: { key: 'splashRadius', as: 'percent', noun: 'blast radius' },
  },
  {
    id: 'm-insurance',
    name: 'Mech Insurance',
    blurb:
      'The first hit that would end a run does not. The hull comes back whole and nothing can touch you for a few seconds while you get clear.',
    tiers: 1,
    cost: 100,
    version: 1,
    /**
     * NO STAT EFFECTS AT ALL, and it is the first upgrade here with none.
     *
     * Everything else in this shop is a number the resolver folds in. This is a BEHAVIOUR: it
     * changes what happens at the moment `damage.ts` would set RUN_PHASE_DEAD, which is not
     * something any multiplier can express. So `effects` is empty and the whole of it lives at that
     * one site - see `insuranceSaves`.
     *
     * ONCE PER RUN, tracked on the player rather than in the save. A second death is a real death,
     * and the latch resets when the next run starts because it is run state, not a possession.
     */
    effects: Object.freeze([]),
    display: { as: 'flag', noun: 'Survives your first death' },
  },
  {
    id: 'm-rerolls',
    name: 'Rerolls',
    blurb:
      'Walk into every run holding more second opinions. A reroll deals a fresh three cards and still owes you the pick.',
    tiers: 3,
    cost: 30,
    version: 1,
    /**
     * A RUN-START GRANT, not a stat. `world.ts` seeds `levelUp.rerolls` from the run tuning plus
     * this, once, and nothing recomputes it - which is the whole character of the thing: a reroll
     * is a resource you spend, so a permanent upgrade to it has to arrive as a bigger pile at the
     * start rather than as a multiplier on anything.
     *
     * The number lives HERE and nowhere else. `metaRunGrant` reads it for the seeding and
     * `metaEffectValue` reads it for the shop text, so the "+6 rerolls" on the card and the six
     * rerolls in the run are the same 2 x 3.
     *
     * TWO PER TIER, FLAT, which keeps the workshop's promise that a third of the tiers is a third
     * of the effect - and unlike every percentage in this shop it is exact rather than nearly so.
     */
    effects: Object.freeze([
      { target: 'run' as const, key: 'rerolls' as const, mode: 'add' as const, amount: 2 },
    ]),
    display: { key: 'rerolls', as: 'flat', noun: 'rerolls' },
  },
  {
    id: 'm-magnet',
    name: 'Scrap Magnetics',
    blurb: 'Cores come to you from further off, so the ground you cannot safely cross still pays.',
    tiers: 3,
    cost: 35,
    version: 1,
    /**
     * THE QUIETEST THING IN THE SHOP AND ONE OF THE MOST FELT. Every other entry here makes a run
     * hit harder or last longer; this one stops it LOSING something it already earned. The late
     * game is a wall of bodies, and XP lying in ground you cannot safely re-cross is the most
     * common invisible loss in a run - invisible precisely because nothing on the summary screen
     * counts the gems you walked away from.
     *
     * A MULTIPLIER ON `pickupRadius`, which is the radius inside which a core starts CHASING you
     * (see tuning's magnetAccel - it accelerates, it does not teleport). So this widens the mouth
     * of the funnel rather than making anything move faster, and the drum's magnet consumable
     * stays a different thing: that one sweeps the whole field once, this one changes every second
     * of every run by a little.
     *
     * 45% ACROSS THREE TIERS. Bigger than Servo Tuning's 15% because it is worth strictly less per
     * point: speed is offence, defence and escape at once, while a wider funnel is only ever the
     * gems you would otherwise have left - and a player buying this is buying fewer regrets rather
     * than more power.
     */
    effects: Object.freeze([
      {
        target: 'player' as const,
        key: 'pickupRadius' as const,
        mode: 'mul' as const,
        amount: 0.45 / 3,
      },
    ]),
    display: { key: 'pickupRadius', as: 'percent', noun: 'pickup range' },
  },
]);

/** Trims a trailing `.0` so a whole number reads as one. 12.857 -> "12.9", 30 -> "30". */
function oneDecimal(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * What `tiers` tiers of this upgrade are worth, as a NUMBER in the units the player is shown:
 * a fraction for a percentage, absolute units for a flat one, seconds for the drone bay.
 *
 * READ BACK OUT OF `effects`, never restated beside them - see MetaDisplay. Pass `def.tiers` for
 * the full-ladder figure and the owned count for what the player has right now.
 *
 * EVERY LADDER IS LINEAR IN THIS NUMBER. That is the property the workshop promises - a third of
 * the tiers is a third of the effect - and it is why rate of fire is converted here rather than
 * left as the cooldown share it is stored as. See `rateLadder` for the half of that which lives in
 * the catalog.
 */
export function metaEffectValue(def: MetaDef, tiers: number): number {
  // A flag has no stat and therefore no magnitude - it is held or it is not. Returned as 0/1 so
  // the "every tier is worth the same" invariant is meaningful for it rather than skipped.
  if (def.display.as === 'flag') return tiers > 0 ? 1 : 0;
  const fx = def.effects.find((e) => e.key === def.display.key);
  if (fx === undefined || tiers <= 0) return 0;
  const total = effectTotal(fx, tiers > def.tiers ? def.tiers : tiers);
  switch (def.display.as) {
    case 'percent':
      return total;
    // `total` is the cooldown share, which is negative. 1/(1+m) - 1 is the rate it produces.
    case 'rateOfFire':
      return 1 / (1 + total) - 1;
    case 'flat':
    case 'count':
      return total;
    case 'secondsFaster':
      return -total;
  }
}

/**
 * The same thing in words. `bare` drops the noun, for the "· +30% at full" tail on a row whose
 * headline has just said it.
 */
export function metaEffectText(def: MetaDef, tiers: number, bare = false): string {
  const d = def.display;
  if (tiers <= 0) return '';
  if (d.as === 'flag') return d.noun;
  if (def.effects.find((e) => e.key === d.key) === undefined) return '';
  const v = metaEffectValue(def, tiers);

  switch (d.as) {
    case 'percent':
    case 'rateOfFire':
      return bare ? `+${oneDecimal(v * 100)}%` : `+${oneDecimal(v * 100)}% ${d.noun}`;
    case 'flat':
      return bare ? oneDecimal(v) : `${oneDecimal(v)} ${d.noun}`;
    case 'count':
      return bare ? oneDecimal(v) : `${oneDecimal(v)} ${d.noun}${v === 1 ? '' : 's'}`;
    case 'secondsFaster':
      return bare ? `${oneDecimal(v)}s` : `Drones build ${oneDecimal(v)}s faster`;
  }
}

/**
 * Tiers of one upgrade held, out of a dense tier array. Clamped to the upgrade's ceiling.
 *
 * FOR THE ONE UPGRADE THAT IS NOT A STAT. Everything else reaches the game through the resolvers
 * and nothing has to look a tier up by name; Mech Insurance is a behaviour at a single site in
 * damage.ts, and this is how that site asks. Kept here rather than inlining an index, because a
 * catalog index written into a system is exactly the coupling the rest of this file avoids.
 */
/**
 * Total of every owned tier's RUN-START GRANT of `key`.
 *
 * The `run` counterpart to `accumulateMeta`, and deliberately a separate function rather than a
 * third case inside it: that one returns a reused accumulator for a hot per-weapon path, and this
 * is called once per run. Sharing the accumulator would put a footgun on a cold path for nothing.
 */
/**
 * The MOST a run grant can ever be, with every tier of everything that feeds it bought.
 *
 * For sizing UI that is built once and cannot be rebuilt per run - the pause overlay's slot pips,
 * which need as many elements as the biggest possible loadout and then hide the ones this
 * particular save has not earned. Derived from the catalog so a second upgrade feeding the same
 * key raises the ceiling without anyone remembering to.
 */
export function metaMaxGrant(key: RunGrantKey): number {
  let total = 0;
  for (const def of META_CATALOG) {
    for (const fx of def.effects) {
      if (fx.target !== 'run' || fx.key !== key) continue;
      total += effectTotal(fx, def.tiers);
    }
  }
  return total;
}

export function metaRunGrant(tiers: ArrayLike<number>, key: RunGrantKey): number {
  let total = 0;
  for (let i = 0; i < META_CATALOG.length; i++) {
    const owned = tiers[i] ?? 0;
    if (owned <= 0) continue;
    const def = META_CATALOG[i];
    const held = owned > def.tiers ? def.tiers : owned;
    for (const fx of def.effects) {
      if (fx.target !== 'run' || fx.key !== key) continue;
      total += effectTotal(fx, held);
    }
  }
  return total;
}

export function metaTierOf(tiers: ArrayLike<number>, id: MetaId): number {
  for (let i = 0; i < META_CATALOG.length; i++) {
    const def = META_CATALOG[i];
    if (def.id !== id) continue;
    const owned = tiers[i] ?? 0;
    return owned > def.tiers ? def.tiers : owned < 0 ? 0 : owned;
  }
  return 0;
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
      const total = effectTotal(fx, held);
      if (fx.mode === 'add') META_ACC.add += total;
      else META_ACC.mul += total;
    }
  }
  return META_ACC;
}
