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
 * A cumulative condition ("open fifty chests, ever") would need the career totals that only the
 * app layer has. It is a new `kind` and a second argument on the day one is wanted, not a reason
 * to make this one impure now.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CONDITIONS IN HERO_CATALOG ARE PROVISIONAL
 * ---------------------------------------------------------------------------------------------
 * The MACHINERY is settled; the numbers on each chassis are a first pass, chosen to open the
 * roster steadily rather than to be a grind, and to exercise every `kind` so none of them is a
 * code path nobody has run. They are one field per hero in one table and are meant to be rewritten
 * as the roster gets its real personality.
 *
 * One rule is not provisional: SLATE IS ALWAYS UNLOCKED. A player with an empty save has to be
 * able to press New Game, and a roster that can lock its own entry point is a roster that can
 * brick itself.
 */

import type { UpgradeId } from './upgrades.js';

/**
 * What a run has to have done. A tagged union rather than a predicate function, because these are
 * DATA: they are stored per hero in a catalog, they have to be printable on the select screen
 * ("Reach wave 4"), and a closure can be neither.
 */
export type UnlockCond =
  /** No condition. Slate, and anything else that should simply be there. */
  | { readonly kind: 'always' }
  /** Reach wave `wave` - i.e. survive into the Nth 120 s cycle. 1 is the opening wave. */
  | { readonly kind: 'wave'; readonly wave: number }
  /** Survive `sec` seconds of RUN time. Intro and level-up pauses do not count; `runSec` is the clock. */
  | { readonly kind: 'survive'; readonly sec: number }
  /** Kill `count` things in one run. */
  | { readonly kind: 'kills'; readonly count: number }
  /** Take one card to `tier`. Works for a weapon or a system - `tier` 7 means finished. */
  | { readonly kind: 'tier'; readonly id: UpgradeId; readonly tier: number }
  /** Win. */
  | { readonly kind: 'win' };

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
}

/**
 * Did this run earn the thing behind `cond`?
 *
 * `ids` is UPGRADE_CATALOG's ids in catalog order - the key for `RunRecord.tiers`. Passed in
 * rather than imported so a fixture catalog in a test lines up with a fixture record, and so this
 * module does not depend on the real content table to answer a question about a record.
 */
export function meetsUnlock(
  cond: UnlockCond,
  run: RunRecord,
  ids: readonly UpgradeId[],
): boolean {
  switch (cond.kind) {
    case 'always':
      return true;
    case 'wave':
      return run.wave >= cond.wave;
    case 'survive':
      return run.runSec >= cond.sec;
    case 'kills':
      return run.kills >= cond.count;
    case 'win':
      return run.won;
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
 * The condition as one line for the player, on the locked tile.
 *
 * IT CARRIES NUMBERS, unlike every card in the game. A card's number is a magnitude you cannot act
 * on in the four seconds you have to read it; this is a TARGET, and a target you cannot see is not
 * a target. "Reach wave 4" and "get further" are not the same instruction.
 *
 * `names` maps an upgrade id to its display name, for the same reason `ids` is passed to
 * `meetsUnlock`: this module describes conditions, it does not own the content table.
 */
export function describeUnlock(
  cond: UnlockCond,
  names: (id: UpgradeId) => string | undefined,
): string {
  switch (cond.kind) {
    case 'always':
      return '';
    case 'wave':
      return `Reach wave ${cond.wave}`;
    case 'survive':
      return `Survive ${formatMinutes(cond.sec)} in one run`;
    case 'kills':
      return `Wreck ${cond.count} in one run`;
    case 'win':
      return 'Win a run';
    case 'tier': {
      const name = names(cond.id) ?? cond.id;
      return cond.tier >= 7 ? `Finish the ${name}` : `Take the ${name} to tier ${cond.tier}`;
    }
  }
}

/** `90` -> `1:30`, `600` -> `10:00`. Whole seconds; these are authored round numbers. */
function formatMinutes(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
