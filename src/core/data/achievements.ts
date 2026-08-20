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

import { LEVEL_CATALOG, type LevelId } from '../content/levels.js';
import { WEAPON_CATALOG } from '../content/weaponCatalog.js';
import { HERO_CATALOG, type HeroId } from './heroes.js';
import { UPGRADE_CATALOG, type UpgradeId } from './upgrades.js';
import { describeUnlockDone, type UnlockCond } from './unlocks.js';

/**
 * Internal name. Rename freely - `platformKey` is the one that is permanent.
 *
 * The `mech-` half is generated: EVERY CHASSIS UNLOCK IS ALSO AN ACHIEVEMENT, and that is a rule
 * rather than a list, so it is written as one. See MECH_ACHIEVEMENTS below.
 */
export type AchievementId =
  | 'cleared-scrapyard'
  | 'chain-laser'
  | 'gtm-hornet'
  | 'twin-mount'
  | 'giga-laser'
  | 'hydra'
  | 'radiator-bank'
  | 'phase-cannon'
  | 'shaped-charges'
  | 'flak-cannon'
  | `mech-${HeroId}`
  | `level-${LevelId}`;

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
  /**
   * Sprite key for the notification's icon - the same keys `spriteUrl` resolves.
   *
   * EVERY ACHIEVEMENT HAS ITS OWN, and none of them is new art: a chassis achievement wears the
   * chassis, and a weapon achievement wears that weapon's card icon. The picture a player already
   * associates with the thing is a better badge than a generic trophy, and it costs nothing.
   */
  readonly icon: string;
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
 * THE DESCRIPTION IS THE CONDITION, IN THE PAST TENSE, and this is the whole point of it. The
 * criteria are published NOWHERE - the picker shows a locked chassis as a bare silhouette - so
 * this banner is the only surface in the game where an unlock condition is ever stated, and by the
 * time it appears the player has already met it. "Moss / Reached wave 3." tells you what you got
 * and what got it, at the one moment both are news.
 *
 * The NAME is the chassis' own. A flavour name is a piece of writing per mech and nobody has
 * written them; inventing sixteen would be putting words in the game's mouth.
 *
 * SECRET, because the picker withholds which silhouette is which. An achievement list naming Ember
 * up front would hand back exactly what the silhouette is keeping.
 */
const levelName = (id: LevelId): string | undefined => LEVEL_CATALOG.find((l) => l.id === id)?.name;
const upgradeName = (id: string): string | undefined => UPGRADE_CATALOG.find((d) => d.id === id)?.name;
const weaponName = (id: string): string | undefined => WEAPON_CATALOG.find((w) => w.id === id)?.name;

/**
 * A CARD'S OWN unlock condition, read off the card rather than retyped - see "by reference" on
 * the achievement entries below. A throw rather than a fallback: an achievement silently pointed
 * at the wrong condition is exactly the drift this whole file exists to prevent, and it should
 * fail the build rather than ship quietly wrong.
 */
function cardUnlock(id: UpgradeId): UnlockCond {
  const cond = UPGRADE_CATALOG.find((d) => d.id === id)?.unlock;
  if (cond === undefined) throw new Error(`achievements: ${id} has no unlock condition`);
  return cond;
}
const RADIATOR_UNLOCK = cardUnlock('p-radiator');
const PHASE_CANNON_UNLOCK = cardUnlock('w-phase-cannon');
const BLAST_UNLOCK = cardUnlock('p-blast');
const FLAK_UNLOCK = cardUnlock('w-flak-cannon');

/**
 * ---------------------------------------------------------------------------------------------
 * ONE PER EARNED MAP, GENERATED FROM THE LEVEL'S OWN UNLOCK
 * ---------------------------------------------------------------------------------------------
 * The same rule as the chassis below, for the same reason: a map that has to be earned is a goal,
 * every goal in this game gets an achievement, and hand-copying the condition is how a player ends
 * up standing on a map with no trophy for having opened it. `cond` is `LevelDef.unlock`, by
 * reference, so they cannot disagree.
 *
 * THE NAME IS THE MAP THAT OPENED, and the description is what opened it - "Mossy Mayhem / Cleared
 * the Scrapyard." Both halves are news at that moment and neither is news without the other.
 *
 * NOT SECRET, and this is the one place the chassis rule is deliberately not followed. A locked
 * chassis is a silhouette with its name withheld, so naming it up front would give away what the
 * picker is hiding. A locked MAP shows its name on the card - the yard picker has always said
 * "Mossy Mayhem" - so there is nothing left to keep, and a hidden trophy for a visible thing would
 * only make the list look emptier than it is. The CRITERIA are still published nowhere.
 *
 * THE ICON IS THAT MAP'S OWN REPRESENTATIVE CREATURE, `bestiaryBody` - the one the level already
 * nominates to illustrate itself in the Scrapopedia. Reusing it here means a new level brings its
 * own trophy art with it, and there is no second decision to forget. (The card `art` would be the
 * obvious choice and is not usable: Mossy Mayhem has none yet, and an achievement with an empty
 * sprite key is a 404 on the one screen that is meant to be a reward.)
 */
const LEVEL_ACHIEVEMENTS: readonly AchievementDef[] = LEVEL_CATALOG.filter(
  (l) => l.unlock.kind !== 'never' && l.unlock.kind !== 'always',
).map((l) => {
  const body = l.creatures[l.bestiaryBody];
  if (body === undefined) throw new Error(`achievements: ${l.id} has no bestiaryBody creature`);
  return Object.freeze({
    id: `level-${l.id}` as AchievementId,
    platformKey: `scrapyard_level_${l.id.replace(/-/g, '_')}`,
    name: l.name,
    icon: body.frames[0],
    description: describeUnlockDone(l.unlock, upgradeName, weaponName, levelName),
    secret: false,
    cond: l.unlock,
  });
});

const MECH_ACHIEVEMENTS: readonly AchievementDef[] = HERO_CATALOG.filter(
  (h) => h.unlock.kind !== 'never' && h.unlock.kind !== 'always',
).map((h) =>
  Object.freeze({
    id: `mech-${h.id}` as AchievementId,
    // The hero id, not its index: the catalog's order is a presentation decision and is documented
    // as reorderable, and a platform key that moves when the picker is rearranged is not permanent.
    platformKey: `scrapyard_mech_${h.id}`,
    name: h.name,
    icon: h.sprite,
    description: describeUnlockDone(h.unlock, upgradeName, weaponName, levelName),
    secret: true,
    cond: h.unlock,
  }),
);

/**
 * ORDER IS PRESENTATION ORDER and nothing else. Nothing indexes into this array - the app stores
 * earned achievements by `id` - so it can be reordered freely.
 */
export const ACHIEVEMENT_CATALOG: readonly AchievementDef[] = Object.freeze([
  /**
   * CLEARING THE FIRST MAP, as a feat in its own right.
   *
   * WHY THIS IS HAND-WRITTEN WHEN THE OTHER MAPS' ARE GENERATED. `LEVEL_ACHIEVEMENTS` turns each
   * level's OWN unlock into a trophy, which is the right rule and gives the wrong answer here: the
   * Scrapyard's unlock is `always` - it is the map an empty save starts on - so the generator
   * skips it, and the only map everybody actually plays first had nothing to show for finishing.
   *
   * IT FIRES ALONGSIDE "Mossy Mayhem", and that is intended rather than an oversight. Both are
   * true at the same moment and they say different things: one is "the moss is open", which is a
   * door, and this one is "you survived fifteen minutes in the yard", which is the thing you did.
   * Games hand out the chapter-complete and the next-chapter-unlocked together as a matter of
   * course, and a first clear is the single loudest moment this game has.
   *
   * NOT SECRET, for the same reason the generated map trophies are not: the yard is on screen from
   * the first second and there is nothing about its existence to keep back.
   */
  {
    id: 'cleared-scrapyard',
    platformKey: 'scrapyard_cleared_scrapyard',
    name: 'Closing Time',
    // The yard's own ground texture, which is the picture a player has spent their whole first
    // run looking at. `scrap_0` is the crushed car - the level card's art, already loaded.
    icon: 'scrap_0',
    description: 'Survived a full run in the Scrapyard.',
    secret: false,
    cond: { kind: 'winLevel', level: 'scrapyard' },
  },
  ...LEVEL_ACHIEVEMENTS,
  ...MECH_ACHIEVEMENTS,
  {
    id: 'chain-laser',
    platformKey: 'scrapyard_chain_laser',
    name: 'Arc Welder',
    // The card icon of the weapon it happens to, which is the picture the player has been staring
    // at on every level-up that got them here.
    icon: 'icon_w-laser-medium',
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
  {
    id: 'twin-mount',
    platformKey: 'scrapyard_twin_mount',
    name: 'Both Barrels',
    // THE ASCENSION'S OWN ICON, the Hornet's choice rather than the Chain Laser's: what makes
    // the Twin Mount worth finding is the pair of shells, and only the tier-8 icon shows two.
    icon: 'icon_w-twin-mount',
    description: 'Turned the Cannon into the Twin Mount.',
    secret: true,
    // Tier 8 is reachable by nothing but a chest paying out an ascension - see the Chain Laser's
    // note above.
    cond: { kind: 'tier', id: 'w-cannon', tier: 8 },
  },
  {
    id: 'flak-cannon',
    platformKey: 'scrapyard_flak_cannon',
    // The number is the joke and the joke is the target. It is the only achievement name in the
    // table that states its own figure, because nine thousand and one is not a threshold a player
    // would ever infer - and because a player who gets there will have been counting.
    name: "It's Over Nine Thousand",
    icon: 'icon_w-flak-cannon',
    description: 'Killed 9001 enemies with the Flak Cannon.',
    secret: true,
    // BY REFERENCE, off the card itself - see cardUnlock. The card and the trophy cannot disagree
    // about what nine thousand means, and neither can be retuned without the other following.
    cond: FLAK_UNLOCK,
  },
  {
    id: 'hydra',
    platformKey: 'scrapyard_hydra',
    name: 'Many Heads',
    icon: 'icon_w-hydra',
    description: 'Grew the Short Laser into the Hydra.',
    secret: true,
    // Tier 8 is reachable by nothing but a chest paying out an ascension - see the Chain Laser's
    // note above.
    cond: { kind: 'tier', id: 'w-laser-short', tier: 8 },
  },
  {
    id: 'giga-laser',
    platformKey: 'scrapyard_giga_laser',
    name: 'Light the Yard',
    // The ascension's own icon, the Twin Mount's choice: what makes the Giga worth finding is the
    // channel of light, and only the tier-8 icon shows it.
    icon: 'icon_w-giga-laser',
    description: 'Turned the Long Laser into the Giga Laser.',
    secret: true,
    // Tier 8 is reachable by nothing but a chest paying out an ascension - see the Chain Laser's
    // note above.
    cond: { kind: 'tier', id: 'w-laser-long', tier: 8 },
  },
  {
    id: 'gtm-hornet',
    platformKey: 'scrapyard_gtm_hornet',
    name: "Hornet's Nest",
    // THE ASCENSION'S OWN ICON, not the parent card's - which is the opposite of the choice above,
    // and deliberate. The Chain Laser is the same beam bent, so the card the player stared at all
    // the way up is still a picture of what they got. The Hornet is not: what makes it worth
    // finding is that one missile becomes two, and only the tier-8 icon says so.
    icon: 'icon_w-gtm-hornet',
    description: 'Fed the Short Missiles to the Long ones and made the GTM Hornet.',
    secret: true,
    // Tier 8 is reachable by nothing but a chest paying out an ascension - see the note above.
    cond: { kind: 'tier', id: 'w-missile-long', tier: 8 },
  },
  {
    id: 'radiator-bank',
    platformKey: 'scrapyard_radiator_bank',
    name: 'Red Line',
    // THE CARD'S OWN ICON. Unlike the Hornet, there is no bigger reveal behind this one - the card
    // IS the reward, so the picture the player has been staring at level-up after level-up is the
    // right badge for it.
    icon: 'icon_p-radiator',
    description: describeUnlockDone(RADIATOR_UNLOCK, upgradeName, weaponName, levelName),
    secret: true,
    // BY REFERENCE, not hand-copied - see the header. `p-radiator` is what actually gates the
    // card, and this achievement fires for exactly the same reason the card unlocks, because they
    // are the same condition object.
    cond: RADIATOR_UNLOCK,
  },
  {
    id: 'phase-cannon',
    platformKey: 'scrapyard_phase_cannon',
    name: 'Through and Through',
    // The card's own icon - the bolt passing through two ghosts into a burst, which is the
    // mechanic the thousand kills were made with.
    icon: 'icon_w-phase-cannon',
    description: describeUnlockDone(PHASE_CANNON_UNLOCK, upgradeName, weaponName, levelName),
    secret: true,
    // BY REFERENCE, like the radiator's: the card's own `killsWithTotal` condition, so the trophy
    // and the deck unlock can never disagree about what a thousand and one means. This is also
    // the entry the Scrapopedia's UNLABELED progress bar hangs off - `unlockProgress` reads this
    // same object, so the bar, the trophy and the card all move on the identical count.
    cond: PHASE_CANNON_UNLOCK,
  },
  {
    id: 'shaped-charges',
    platformKey: 'scrapyard_shaped_charges',
    name: 'Collateral',
    icon: 'icon_p-blast',
    description: describeUnlockDone(BLAST_UNLOCK, upgradeName, weaponName, levelName),
    secret: true,
    // BY REFERENCE - the card's own `splashKillsTotal` condition, and the third sealed row to
    // carry the unlabeled career progress bar.
    cond: BLAST_UNLOCK,
  },
]);
