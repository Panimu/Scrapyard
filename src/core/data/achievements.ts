/**
 * ACHIEVEMENTS - the table, and nothing else.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS REUSES THE UNLOCK CONDITION LANGUAGE
 * ---------------------------------------------------------------------------------------------
 * An achievement and a chassis unlock ask the same kind of question - "did a run do this?" - and
 * there is no version of this game where they should be able to disagree about what "finish the
 * Cannon" means. So there is ONE condition language (`UnlockCond`) and ONE evaluator
 * (`meetsUnlock`), with two tables of things hung off it.
 *
 * The day an achievement wants something a chassis unlock cannot express, the answer is a new
 * `kind` in unlocks.ts that both can use - not a second evaluator here that drifts from the first.
 *
 * ---------------------------------------------------------------------------------------------
 * `platformKey` EXISTS BECAUSE THIS IS GOING SOMEWHERE ELSE EVENTUALLY
 * ---------------------------------------------------------------------------------------------
 * Game Center and Steam each want their own identifier, minted in their own console, and both
 * treat that identifier as PERMANENT - you cannot rename one after a player has earned it without
 * orphaning their copy. Our internal `id` is a TypeScript union member that we will want to rename
 * freely as the codebase moves around, so the two must not be the same string.
 *
 * Hence: rename `id` whenever it reads better; NEVER touch `platformKey` once a build carrying it
 * has shipped. Retiring an achievement means removing the entry, not reusing its key for something
 * else.
 *
 * ---------------------------------------------------------------------------------------------
 * SECRET ACHIEVEMENTS ARE SECRET FOR THE SAME REASON THE SCRAPOPEDIA IS QUIET ABOUT TIER 8
 * ---------------------------------------------------------------------------------------------
 * "Unlock the Chain Laser" is a sentence that tells you a Chain Laser exists, that a Medium Laser
 * becomes one, and that there is something to go looking for. We took that out of the manual on
 * purpose. An achievement list is exactly the back door it would come in through, so the flag is
 * here from the first entry rather than being retrofitted the day the second one needs it.
 *
 * A secret achievement shows its name only once it has been earned. Both platforms have a native
 * notion of this, so the flag maps straight through when the bridge lands.
 */

import { HERO_CATALOG, type HeroId } from './heroes.js';
import type { UnlockCond } from './unlocks.js';

/**
 * Internal name. Rename freely - `platformKey` is the one that is permanent.
 *
 * The `mech-` half is generated: EVERY CHASSIS UNLOCK IS ALSO AN ACHIEVEMENT, and that is a rule
 * rather than a list, so it is written as one. See MECH_ACHIEVEMENTS below.
 */
export type AchievementId = 'chain-laser' | `mech-${HeroId}`;

export interface AchievementDef {
  readonly id: AchievementId;
  /**
   * The identifier an external platform knows this by. PERMANENT once shipped - see the header.
   * Lower-case, underscore-separated, no spaces: the intersection of what Game Center and Steam
   * both accept without escaping.
   */
  readonly platformKey: string;
  /** Shown on the toast, and on a platform's own overlay. */
  readonly name: string;
  /** One line. Says what was done, in the past tense, because it is only ever read after the fact. */
  readonly description: string;
  /** Hidden - name and description withheld - until earned. */
  readonly secret: boolean;
  /** Evaluated against a run by `meetsUnlock`. */
  readonly cond: UnlockCond;
}

/**
 * ---------------------------------------------------------------------------------------------
 * ONE PER CHASSIS UNLOCK, GENERATED FROM THE UNLOCK ITSELF
 * ---------------------------------------------------------------------------------------------
 * Every mech unlock is also an achievement. That is a RULE, so it is written as one rather than as
 * a hand-copied row per chassis - which would be sixteen chances for the achievement's condition
 * to drift away from the unlock's, producing the worst possible outcome: a player who has the mech
 * and not the trophy, or the trophy and not the mech.
 *
 * `cond` is the hero's own `unlock`, by reference. They cannot disagree.
 *
 * A CHASSIS WITH NO CRITERIA YET GETS NO ACHIEVEMENT. `never` is "not designed", and an
 * unearnable trophy on a platform's list is a permanent 0% that says the game is broken rather
 * than that the content is unfinished. They appear as their conditions are written.
 *
 * THE NAMING IS DELIBERATELY PLAIN - the chassis' own name, and "Unlocked X." A flavour name is a
 * piece of writing per mech and nobody has written them; inventing sixteen would be putting words
 * in the game's mouth. `AchievementDef.name` is one string per entry when they are wanted.
 *
 * SECRET, because the picker shows a locked chassis as a silhouette with no name on it. An
 * achievement list naming Ember would hand back exactly what the silhouette is withholding.
 */
const MECH_ACHIEVEMENTS: readonly AchievementDef[] = HERO_CATALOG.filter(
  (h) => h.unlock.kind !== 'never' && h.unlock.kind !== 'always',
).map((h) =>
  Object.freeze({
    id: `mech-${h.id}` as AchievementId,
    // The hero id, not its index: the catalog's order is a presentation decision and is documented
    // as reorderable, and a platform key that moves when the picker is rearranged is not permanent.
    platformKey: `scrapyard_mech_${h.id}`,
    name: h.name,
    description: `Unlocked ${h.name}.`,
    secret: true,
    cond: h.unlock,
  }),
);

/**
 * ORDER IS PRESENTATION ORDER and nothing else. Nothing indexes into this array - the app stores
 * earned achievements by `id` - so it can be reordered freely.
 */
export const ACHIEVEMENT_CATALOG: readonly AchievementDef[] = Object.freeze([
  ...MECH_ACHIEVEMENTS,
  {
    id: 'chain-laser',
    platformKey: 'scrapyard_chain_laser',
    name: 'Arc Welder',
    description: 'Turned a Medium Laser into the Chain Laser.',
    secret: true,
    /**
     * TIER 8 IS THE ASCENSION AND NOTHING ELSE REACHES IT. The level-up deck caps a weapon at 7 -
     * `isOfferable` reads `maxStacks`, which stays at WEAPON_MAX_TIER - so the only thing in the
     * game that can push a stack to 8 is a Cyber Chest paying out an ascension the run has earned.
     * Testing the tier is therefore exactly equivalent to testing "the chest granted this", without
     * needing an event, a flag on the world, or a hook inside the chest.
     */
    cond: { kind: 'tier', id: 'w-laser-medium', tier: 8 },
  },
]);
