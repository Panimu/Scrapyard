/**
 * THE BESTIARY: every creature a level fields, at every rank, in one enumerable list.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS AN APP-LAYER MODULE AND NOT PART OF THE LEVEL
 * ---------------------------------------------------------------------------------------------
 * A level already knows its creatures and its ladder. What it does NOT know, and must not, is that
 * anybody wants to list them on a screen or remember which ones you have killed between runs.
 * `src/core/` has no concept of a save file (see CLAUDE.md) and no concept of the Scrapopedia, so
 * the flattening and the save key both live here, on the app side of that line.
 *
 * Two callers, one list, deliberately: `appState.recordKills` writes the keys and
 * `scrapopediaScreen` reads them. If each enumerated the ladder itself they would eventually
 * disagree about what an entry is, and the failure mode is a page that can never be unlocked.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE ENTRY IS A RUNG AND A RANK, NOT A CREATURE ID
 * ---------------------------------------------------------------------------------------------
 * A rung is what a player meets as one animal. On Mossy the Swarm cycle is three different insects
 * across its three ranks; that is ONE entry with three ranks, not three unrelated creatures - the
 * blowfly, the killer bee and the mosquito are the same thing getting worse. On the Scrapyard the
 * three ranks are one hull in three paints, which is the same relationship stated in art the pack
 * happened to provide.
 *
 * So the entry is `(level, rung, rank)` and the ART comes from whatever creature that rung's
 * resolver names for that rank. Both shapes flatten to the same list and the screen cannot tell
 * which is which.
 */

import { RANKS, createResolvedCycle } from './core/content/cycles.js';
import type { CreatureDef, LevelDef, LevelId, Rank } from './core/index.js';

export interface BestiaryEntry {
  /** The level this creature belongs to. Never used to look up another level's anything. */
  readonly levelId: LevelId;
  readonly levelName: string;
  /** Authored ladder index. Cycles past the table extrapolate onto the last rung and count as it. */
  readonly rung: number;
  readonly rank: Rank;
  /** The ladder's own name for the rung - `Rustling`, `Swarm`. */
  readonly cycleName: string;
  /** What the entry is called: the rung's name for a regular, and suffixed for the ranks above. */
  readonly name: string;
  /** That level's creature, for that rank. The art on the page is this and nothing else. */
  readonly creature: CreatureDef;
  /** Save key. See `creatureKey`. */
  readonly key: string;
}

/**
 * THE SAVE KEY for one bestiary entry.
 *
 * LEVEL ID FIRST, and that is the whole reason this is a function rather than a template literal
 * written twice. Two maps may one day name a creature the same thing, and a Mossy kill silently
 * unlocking a Scrapyard page is exactly the confusion the per-level content split exists to
 * prevent. The id is stable; the display name is not necessarily.
 *
 * It goes into `Settings.killedEnemies` beside the flavour and rank names, which are bare strings -
 * the `/` prefix is what keeps the two namespaces from ever colliding.
 *
 * RENAMING A CYCLE LOSES ITS PAGES. That is the cost this codebase has already accepted for
 * storing ids over indices (CLAUDE.md): an entry nothing resolves is dropped rather than left to
 * rot, and losing a page you have to kill one more of is cheaper than a collection that quietly
 * accumulates ghosts.
 */
export function creatureKey(levelId: LevelId, cycleName: string, rank: number): string {
  return `${levelId}/${cycleName}/${RANKS[rank].name}`;
}

/** What an entry is CALLED. A regular is just the creature; the ranks above say so. */
export function creatureEntryName(cycleName: string, rank: number): string {
  return rank === 0 ? cycleName : `${cycleName} ${RANKS[rank].name}`;
}

/**
 * Every entry for one level, in ladder order and then rank order - which is the order a player
 * meets them in, and therefore the order the index should list them in.
 */
export function bestiaryFor(level: LevelDef): BestiaryEntry[] {
  const out: BestiaryEntry[] = [];
  const scratch = createResolvedCycle(level.resolveCycle);
  for (let rung = 0; rung < level.cycleCount; rung++) {
    level.resolveCycle(rung, scratch);
    for (let rank = 0; rank < RANKS.length; rank++) {
      out.push({
        levelId: level.id,
        levelName: level.name,
        rung,
        rank: rank as Rank,
        cycleName: scratch.name,
        name: creatureEntryName(scratch.name, rank),
        creature: level.creatures[scratch.typeByRank[rank]],
        key: creatureKey(level.id, scratch.name, rank),
      });
    }
  }
  return out;
}
