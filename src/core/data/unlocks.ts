/**
 * WHAT A CHASSIS COSTS TO EARN - the condition each mech is locked behind, and the pure function
 * that decides whether a finished run met it.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY MECHS AND SYSTEMS UNLOCK BY DIFFERENT RULES
 * ---------------------------------------------------------------------------------------------
 * A SYSTEM unlocks by being TAKEN. Hold the artillery once and its page is in the Scrapopedia
 * forever - the manual is a record of what you have actually had in your hands, and nothing here
 * is involved in that: it is a set of ids the app unions after every level-up.
 *
 * A MECH is not something you pick up, so it cannot use that rule. Each chassis instead names a
 * thing you have to DO, tested once against the run that just ended. That is what makes the roster
 * a set of small goals rather than a list of things you happen to have seen.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE RUN, NOT A CAREER
 * ---------------------------------------------------------------------------------------------
 * Every condition here is evaluated against a SINGLE finished run, and deliberately so: "reach
 * wave 6" means reach wave 6 in one sitting, not accumulate six waves across three attempts. It
 * also keeps `meetsUnlock` a pure function of one small record, which is what lets the summary
 * screen tell you what you just earned without consulting anything persistent.
 *
 * A cumulative condition ("open fifty chests, ever") needs the career totals that only the app
 * layer has - and the day one was wanted, it arrived exactly as this paragraph prescribed: a new
 * `kind` (`killsWithTotal`) and a second argument (`CareerRecord`), leaving every one-run
 * condition the pure function of one small record it always was.
 *
 * ---------------------------------------------------------------------------------------------
 * NO CONDITIONS ARE WRITTEN YET, AND NONE WILL BE INVENTED HERE
 * ---------------------------------------------------------------------------------------------
 * This file is the VOCABULARY. What each chassis actually asks for is a design decision that has
 * not been made, so fifteen of the sixteen carry `never` - LOCKED, WITH NO ROUTE - and Slate
 * carries `always`.
 *
 * `never` is the honest state and a guessed number is not. A placeholder condition is a design
 * decision made by accident: it ships, players play around it, and by the time anyone argues about
 * it the argument is about changing something rather than about choosing it. A chassis that is
 * plainly locked says the true thing - this is coming, it is not ready - and cannot be mistaken
 * for a considered target.
 *
 * One rule does not wait: SLATE IS ALWAYS UNLOCKED. A player with an empty save has to be able to
 * press New Game, and a roster that can lock its own entry point is a roster that can brick itself.
 *
 * Adding a `kind` here is cheap - the union, one case in `meetsUnlock`, one in
 * `describeUnlockDone` - so the vocabulary is meant to grow to fit the conditions, not the
 * conditions to be bent to fit the vocabulary.
 */

import type { LevelId } from '../content/levels.js';
import type { WeaponId } from '../content/weaponCatalog.js';
import type { UpgradeId } from './upgrades.js';

/**
 * What a run has to have done. A tagged union rather than a predicate function, because these are
 * DATA: they are stored per hero in a catalog, they have to be printable on the achievement that
 * announces them ("Reached wave 3."), and a closure can be neither.
 */
export type UnlockCond =
  /** No condition. Slate, and anything else that should simply be there. */
  | { readonly kind: 'always' }
  /**
   * NO ROUTE. Locked, and no run can earn it.
   *
   * Not a mistake and not a disabled entry - it is "the condition for this has not been decided
   * yet", said out loud. `meetsUnlock` returns false for it unconditionally, so it is the one
   * `kind` that is not a question about the run at all.
   */
  | { readonly kind: 'never' }
  /** Reach wave `wave` - i.e. survive into the Nth 120 s cycle. 1 is the opening wave. */
  | { readonly kind: 'wave'; readonly wave: number }
  /** Survive `sec` seconds of RUN time. Intro and level-up pauses do not count; `runSec` is the clock. */
  | { readonly kind: 'survive'; readonly sec: number }
  /** Kill `count` things in one run. */
  | { readonly kind: 'kills'; readonly count: number }
  /** Take one card to `tier`. Works for a weapon or a system - `tier` 7 means finished. */
  | { readonly kind: 'tier'; readonly id: UpgradeId; readonly tier: number }
  /**
   * Kill a boss while `weapon` is EQUIPPED. Not with it - with it in the loadout.
   *
   * "Equipped" and "responsible for the kill" are two different conditions and this is the first.
   * Requiring the killing blow would make the condition a lottery on which of five guns happened
   * to land last, which is not a thing a player can play toward.
   */
  | { readonly kind: 'bossKillHolding'; readonly weapon: WeaponId }
  /**
   * Land the KILLING BLOW on `count` enemies with any of `weapons`.
   *
   * A LIST rather than one id, because the thing a player is being asked for is usually a KIND of
   * weapon and not a specific model. "Destroy a hundred with a missile" means either rack: the two
   * racks are one idea with two ranges, and a condition that accepted only one of them would be
   * asking for something nobody would guess.
   *
   * Killing blow, not damage dealt. "Kill with X" has to mean the thing a player would check on the
   * screen, and a gun that softens everything and never finishes anything has not killed with it.
   */
  | { readonly kind: 'killsWith'; readonly weapons: readonly WeaponId[]; readonly count: number }
  /**
   * Land the KILLING BLOW on `count` enemies with any of `weapons`, ACROSS EVERY RUN EVER PLAYED
   * - the career condition the file header promised would arrive as its own kind rather than by
   * making `killsWith` impure.
   *
   * The career totals live in the save, so they reach the evaluator as the CAREER ARGUMENT to
   * `meetsUnlock` - the app layer passes its banked tallies (current run included, since it banks
   * before it evaluates). When no career is supplied - a caller that has none, a test that
   * pins a single run - the condition falls back to the run's own `killsWith`, so it degrades to
   * the one-run reading rather than becoming quietly unsatisfiable.
   *
   * Same killing-blow rule as `killsWith`, for the same reason: "kill with X" has to mean the
   * thing a player would check on the screen, however many runs it took.
   */
  | {
      readonly kind: 'killsWithTotal';
      readonly weapons: readonly WeaponId[];
      readonly count: number;
    }
  /**
   * Land `count` killing blows WITH BLAST DAMAGE, across every run ever played - the second
   * career condition, keyed to a MECHANIC rather than a weapon: any splash that finishes a body
   * counts, whether the artillery's barrage, a Phase Cannon burst or a drone's death detonation
   * threw it. Same career plumbing as `killsWithTotal`, same fallback to the run's own tally when
   * no career is supplied.
   */
  | { readonly kind: 'splashKillsTotal'; readonly count: number }
  /** Land the KILLING BLOW on a boss with any of `weapons`. Same rule as `killsWith`. */
  | { readonly kind: 'bossKillBy'; readonly weapons: readonly WeaponId[] }
  /**
   * Be touched by the horde `count` times in one run, where the touch actually cost hit points.
   *
   * A bite the Energy Shield ate, or one absorbed by the immunity window a break opens, is not a
   * hit taken - neither cost anything, and counting them would make the condition easier for the
   * build that is least in danger.
   */
  | { readonly kind: 'contactHits'; readonly count: number }
  /**
   * Die to an enemy of this RANK - `regular`, `elite` or `boss`, matching `RankDef.name`.
   *
   * A name rather than the numeric constant, so the catalog entry reads as the sentence it is.
   * This is the only condition in the vocabulary that a run has to LOSE to satisfy, which is worth
   * knowing when writing one: it can never be met by a run that wins, and it will be evaluated
   * exactly once, at the end.
   */
  | { readonly kind: 'diedTo'; readonly rank: string }
  /** Win. */
  /**
   * Drop under a fifth of your hull at any point in a run, then reach full hull in that same run.
   *
   * THE ONLY CONDITION IN HERE ABOUT A ROUND TRIP rather than a total or an event. It cannot be
   * satisfied by being careful and it cannot be satisfied by being lucky once - the run has to go
   * badly and then be pulled back, which is exactly the story the card it unlocks is about.
   *
   * THE TWO HALVES NEED NOT BE ADJACENT. Going under the threshold arms the run for the rest of
   * it, so the recovery can take one spanner or twenty minutes; what is being asked for is that
   * both things happened, not that they happened together.
   *
   * `RunStats.fullRepairs` counts them; the threshold and the "and then reach full" half both live
   * at the site that watches hit points, because "was under a fifth at some point" is not a fact a
   * total can carry.
   */
  | { readonly kind: 'fullRepair' }
  /**
   * Held all three lasers at once, with all three overheated on the same tick.
   *
   * A STATE, not a total - the same shape as `fullRepair`, and for the same reason: "all three
   * were red-hot together" is not a fact three separate counters can reconstruct after the fact,
   * so `RunStats.lasersOverheated` is a latch set at the moment it is observed rather than
   * something derived here from three tallies that could have peaked on different ticks.
   */
  | { readonly kind: 'lasersOverheated' }
  | { readonly kind: 'win' }
  /**
   * WIN ON A NAMED MAP. The first condition in here that asks WHERE as well as what.
   *
   * `win` alone was not enough the moment a level had to be earned by clearing another one: a Mossy
   * victory unlocking Mossy is a condition that unlocks itself, and there is no way to express
   * "finish THAT yard" without the run saying which yard it was. Hence `RunRecord.levelId`.
   *
   * It is deliberately not `winLevel` plus a count. "Cleared the Scrapyard" is a thing that either
   * happened or did not; asking for it twice would be asking a player to prove they meant it.
   */
  | { readonly kind: 'winLevel'; readonly level: LevelId };

/**
 * Everything a condition may ask about one finished run, flattened away from `World`.
 *
 * A FLAT RECORD RATHER THAN THE WORLD ITSELF, for two reasons. The world is enormous and mutable
 * and half of it is invalidated the moment the run ends (dense indices, pools), so a condition
 * holding one is a condition that can read a lie. And a small record is something the summary
 * screen and a test can both build by hand - which is how "did this run earn Fern" stays checkable
 * without standing up a simulation.
 */
export interface RunRecord {
  /**
   * WHICH MAP THIS RUN WAS ON. Needed by `winLevel`, and by nothing else yet.
   *
   * Every other field here is a fact about what the player DID; this one is about where, and it is
   * in the record rather than being an argument to `meetsUnlock` so that a condition about the map
   * stays the same shape as every other condition - data, evaluated against one flat record.
   */
  readonly levelId: LevelId;
  /** Waves reached, 1-based: the opening wave is 1. */
  readonly wave: number;
  /** Seconds of run time survived. */
  readonly runSec: number;
  readonly kills: number;
  readonly won: boolean;
  /**
   * Tier held at the end of the run, by UPGRADE_CATALOG index. 0 means never taken.
   *
   * By INDEX rather than by id because that is the shape the simulation already keeps
   * (`world.levelUp.stacks`), and copying it is one line at the point where the run ends.
   * `meetsUnlock` is handed the catalog alongside so it can turn an id into that index without
   * this record having to know what the catalog looks like.
   */
  readonly tiers: ArrayLike<number>;
  /**
   * Weapons that were in the loadout when at least one boss died this run.
   *
   * A LIST OF IDS RATHER THAN THE Uint32Array RunStats KEEPS, resolved by the caller. Everything
   * else in this record is a plain number a test can write by hand, and a bare counts-by-catalog-
   * index array would have made the ONE interesting condition the one that needs a second lookup
   * table threaded through `meetsUnlock`.
   */
  readonly bossKillsHolding: readonly WeaponId[];
  /**
   * Killing blows this run, by the weapon that landed them. Absent key = none.
   *
   * A record rather than the Uint32Array RunStats keeps, resolved by the caller, for the same
   * reason `bossKillsHolding` is a list of ids: everything else in here is something a test can
   * write by hand, and threading a second catalog into `meetsUnlock` to decode an index would make
   * the interesting conditions the awkward ones.
   */
  readonly killsWith: Readonly<Partial<Record<WeaponId, number>>>;
  /** Weapons that landed the killing blow on a boss this run. */
  readonly bossKillsBy: readonly WeaponId[];
  /** Times the horde's touch actually cost hit points. See `RunStats.contactHits`. */
  readonly contactHits: number;
  /** Rank name of whatever killed the player, or '' if the run has not ended in death. */
  readonly diedTo: string;
  /** Times the run went under a tenth of its hull and got all the way back. See RunStats. */
  readonly fullRepairs: number;
  /** All three lasers held and overheated on the same tick, at some point. See RunStats. */
  readonly lasersOverheated: boolean;
  /** Killing blows landed by splash this run. See RunStats.splashKills. */
  readonly splashKills: number;
}

/**
 * CAREER TOTALS - what a whole save has done, as opposed to what one run did.
 *
 * The second argument the file header promised the day a cumulative condition arrived. Only the
 * app layer can build one (the totals live in the save), so it is optional and only the career
 * `kind`s read it: every one-run condition stays a pure function of the RunRecord, exactly as
 * before, and a caller with no save in hand simply omits it.
 */
export interface CareerRecord {
  /** Killing blows ever landed, by weapon, every run included. Absent key = none. */
  readonly killsWith: Readonly<Partial<Record<WeaponId, number>>>;
  /** Killing blows ever landed by splash, every run included. */
  readonly splashKills: number;
}

/**
 * Did this run earn the thing behind `cond`?
 *
 * `ids` is UPGRADE_CATALOG's ids in catalog order - the key for `RunRecord.tiers`. Passed in
 * rather than imported so a fixture catalog in a test lines up with a fixture record, and so this
 * module does not depend on the real content table to answer a question about a record.
 *
 * `career` feeds only the career kinds - see CareerRecord.
 */
export function meetsUnlock(
  cond: UnlockCond,
  run: RunRecord,
  ids: readonly UpgradeId[],
  career?: CareerRecord,
): boolean {
  switch (cond.kind) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'wave':
      return run.wave >= cond.wave;
    case 'survive':
      return run.runSec >= cond.sec;
    case 'kills':
      return run.kills >= cond.count;
    case 'win':
      return run.won;
    // BOTH HALVES. A run that ended on this map without winning has not cleared it, and a win on
    // another map is another map's achievement.
    case 'winLevel':
      return run.won && run.levelId === cond.level;
    case 'fullRepair':
      return run.fullRepairs > 0;
    case 'lasersOverheated':
      return run.lasersOverheated;
    case 'bossKillHolding':
      return run.bossKillsHolding.includes(cond.weapon);
    case 'killsWith': {
      let n = 0;
      for (const w of cond.weapons) n += run.killsWith[w] ?? 0;
      return n >= cond.count;
    }
    case 'killsWithTotal': {
      // The career when the caller has one; the run's own tallies when it does not - the
      // fallback that keeps this satisfiable (and testable) without a save in hand.
      const totals = career?.killsWith ?? run.killsWith;
      let n = 0;
      for (const w of cond.weapons) n += totals[w] ?? 0;
      return n >= cond.count;
    }
    case 'splashKillsTotal':
      // Same career-or-run fallback as killsWithTotal, for the same reasons.
      return (career?.splashKills ?? run.splashKills) >= cond.count;
    case 'bossKillBy':
      return cond.weapons.some((w) => run.bossKillsBy.includes(w));
    case 'contactHits':
      return run.contactHits >= cond.count;
    case 'diedTo':
      // `diedTo` is '' until the player is killed, so an unfinished run never satisfies this by
      // accident - and neither does a run that ended in victory.
      return run.diedTo !== '' && run.diedTo === cond.rank;
    case 'tier': {
      const i = ids.indexOf(cond.id);
      // An id the catalog does not carry can never be satisfied, and must not read as satisfied:
      // `tiers[-1]` is undefined, and `undefined >= 7` is false rather than an exception, but
      // relying on that would make this correct by accident.
      return i >= 0 && (run.tiers[i] ?? 0) >= cond.tier;
    }
  }
}

/**
 * HOW FAR ALONG A CAREER IS toward `cond`, as a fraction 0..1 - or -1 when the condition has no
 * progress a bar could honestly show.
 *
 * ONLY THE CAREER KINDS REPORT. They are the only conditions whose number climbs monotonically
 * across a save's whole life; everything else either happens or does not (a win, a death), or is
 * scoped to one run and resets too often for a bar drawn outside the run to mean anything.
 *
 * WHAT THE BAR IS FOR IS DELIBERATELY NOT PART OF THIS CONTRACT. The criteria are published
 * nowhere (see describeUnlockDone below), and the one consumer draws this fraction UNLABELED -
 * all it leaks is that something is counting and that it moved, which is the sealed plate's own
 * promise with a pulse in it. This function therefore returns a bare number and no words.
 */
export function unlockProgress(cond: UnlockCond, career: CareerRecord): number {
  if (cond.kind === 'splashKillsTotal') {
    const f = career.splashKills / cond.count;
    return f > 1 ? 1 : f;
  }
  if (cond.kind !== 'killsWithTotal') return -1;
  let n = 0;
  for (const w of cond.weapons) n += career.killsWith[w] ?? 0;
  const f = n / cond.count;
  return f > 1 ? 1 : f;
}

/**
 * The condition as one line, IN THE PAST TENSE - "Reached wave 3", "Killed a boss holding the Long
 * Laser". What a run DID, not what a run must do.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THERE IS NO IMPERATIVE VERSION OF THIS ANY MORE
 * ---------------------------------------------------------------------------------------------
 * There used to be one, printed under the silhouette on the mech picker. It is gone, and with it
 * the only place a player could read a criterion before meeting it. A locked chassis is now a
 * silhouette and a question mark and nothing else; the ACHIEVEMENT is the single surface where an
 * unlock condition is ever stated, and by then it is something you have already done.
 *
 * So the tense is not a detail. Every caller is describing a thing that has happened.
 *
 * IT CARRIES NUMBERS, unlike every card in the game. A card's number is a magnitude you cannot act
 * on in the four seconds you have to read it; this is the record of a specific thing you did, and
 * "Reached wave 3" and "got further" are not the same sentence.
 *
 * `names` and `weaponNames` map an id to its display name, for the same reason `ids` is passed to
 * `meetsUnlock`: this module describes conditions, it does not own the content tables.
 */
export function describeUnlockDone(
  cond: UnlockCond,
  names: (id: UpgradeId) => string | undefined,
  weaponNames: (id: WeaponId) => string | undefined = () => undefined,
  levelNames: (id: LevelId) => string | undefined = () => undefined,
): string {
  switch (cond.kind) {
    // Neither is reachable from an achievement - `always` is not an accomplishment and `never`
    // gets no achievement at all - but a switch over a union has to be total, and returning ''
    // is what an absent line looks like everywhere else here.
    case 'always':
    case 'never':
      return '';
    case 'wave':
      return `Reached wave ${cond.wave}.`;
    case 'survive':
      return `Survived ${formatMinutes(cond.sec)} in one run.`;
    case 'kills':
      return `Wrecked ${cond.count} in one run.`;
    case 'win':
      return 'Won a run.';
    // "Cleared", not "won on": the sentence is about finishing a place off. A player who reads this
    // has beaten every Scraplord in that yard, which is a different claim from having survived it.
    case 'winLevel':
      return `Cleared the ${levelNames(cond.level) ?? cond.level}.`;
    case 'bossKillHolding':
      return `Killed a boss holding the ${weaponNames(cond.weapon) ?? cond.weapon}.`;
    case 'killsWith':
      return `Destroyed ${cond.count} with ${listNames(cond.weapons, weaponNames)}.`;
    case 'killsWithTotal':
      return `Destroyed ${cond.count} with ${listNames(cond.weapons, weaponNames)}, across every run.`;
    case 'splashKillsTotal':
      return `Destroyed ${cond.count} with blast damage, across every run.`;
    case 'bossKillBy':
      return `Finished a boss with ${listNames(cond.weapons, weaponNames)}.`;
    case 'fullRepair':
      return 'Repaired to full hull after dropping below a fifth of it.';
    case 'lasersOverheated':
      return 'Ran all three lasers red-hot at once.';
    case 'contactHits':
      return `Took ${cond.count} hits from the horde in one run.`;
    case 'diedTo':
      return `Died to ${cond.rank === 'elite' ? 'an' : 'a'} ${cond.rank}.`;
    case 'tier': {
      const name = names(cond.id) ?? cond.id;
      return cond.tier >= 7 ? `Finished the ${name}.` : `Took the ${name} to tier ${cond.tier}.`;
    }
  }
}

/**
 * "the Short Missiles or the Long Missiles". Written out in full rather than as a group noun,
 * because the group noun is the thing that would have to be invented and then kept true - "a
 * missile" is obvious for the two racks and would be a guess for any other pairing.
 */
function listNames(
  ids: readonly WeaponId[],
  names: (id: WeaponId) => string | undefined,
): string {
  const out = ids.map((id) => `the ${names(id) ?? id}`);
  if (out.length <= 1) return out[0] ?? '';
  return `${out.slice(0, -1).join(', ')} or ${out[out.length - 1]}`;
}

/** `90` -> `1:30`, `600` -> `10:00`. Whole seconds; these are authored round numbers. */
function formatMinutes(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
