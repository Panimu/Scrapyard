/**
 * THE LEVEL CATALOG: the shape a level has, and the list of them.
 *
 * ---------------------------------------------------------------------------------------------
 * A LEVEL SUPPLIES ITS PARTS - IT DOES NOT TICK BOXES
 * ---------------------------------------------------------------------------------------------
 * This table held booleans for a while: `scenery: true`, `groundDecor: true`. That made the second
 * level "the first one with things switched off", and it would have made the third level a fourth
 * and fifth boolean with an `if` for each in whatever system happened to care. It is the same shape
 * the weapon catalog explicitly forbids - a branch in a system for one piece of content - and it
 * has the same failure: content can only ever differ in the ways somebody already anticipated.
 *
 * So the fields here are either UNIVERSAL FACTS every level must answer (how big is it, what is the
 * ground called) or FUNCTIONS THE LEVEL SUPPLIES (`makeScenery`). Nothing is a switch on shared
 * behaviour. A level whose terrain is generated in chunks, or whose ground is procedural, or which
 * has no ground at all, hands over its own function and core learns nothing new.
 *
 * Each level's definition lives in ITS OWN FILE - `levelScrapyard.ts`, `levelMossyMayhem.ts` - so
 * that a change to one cannot silently alter the other, and so that reading a level means reading
 * one file rather than picking a column out of a table.
 *
 * ---------------------------------------------------------------------------------------------
 * THE RENDER SIDE IS SEPARATE, AND KEYED BY ID
 * ---------------------------------------------------------------------------------------------
 * How a level LOOKS - its ground decoration, its perimeter, whatever a future level paints - is not
 * in here, because core must not depend on the renderer. It lives in `src/render/dressing.ts`, in a
 * `Record<LevelId, ...>` that the type system requires to be complete: adding a level to this
 * catalog fails to compile until it has been given a dressing. That is a much stronger guarantee
 * than a boolean, which can be forgotten and simply reads as `false`.
 */

import type { UnlockCond } from '../data/unlocks.js';
import type { CreatureDef, CycleResolver } from './cycles.js';
import { MOSSY_MAYHEM } from './levelMossyMayhem.js';
import { SCRAPYARD } from './levelScrapyard.js';
import type { Scenery } from './scenery.js';

export type LevelId = 'scrapyard' | 'mossy-mayhem';

export interface LevelDef {
  readonly id: LevelId;
  readonly name: string;
  /** One line, on the card. What the ground is, not what the mechanics are. */
  readonly blurb: string;
  /** Sprite key for the card's art, or '' for the placeholder plate. */
  readonly art: string;
  /** False: shown on the picker, greyed, and refused. */
  readonly playable: boolean;

  /**
   * WHAT A RUN HAS TO HAVE DONE FOR THIS MAP TO BE AVAILABLE, in the same language a chassis uses.
   *
   * A DIFFERENT QUESTION FROM `playable`, and both are needed. `playable` is about the CONTENT: is
   * this level finished enough to be shipped at all. `unlock` is about the SAVE: has this player
   * earned it. A level can be unfinished (not playable, nobody may enter), finished but unearned
   * (playable, locked on this save), or open (`always`) - and collapsing the two would mean the day
   * a map is gated is the day the app layer starts reading a content flag as a progression flag.
   *
   * `always` for the entry point, for exactly the reason Slate is: a roster whose only door can be
   * locked is a roster that can brick itself.
   *
   * The achievement that announces a level unlock is DERIVED from this field by reference - see
   * data/achievements.ts - so the two can never disagree about what earned the map.
   */
  readonly unlock: UnlockCond;

  /**
   * Half-extent of the playable square, world units, or `Infinity` for an unbounded level.
   *
   * A UNIVERSAL FACT rather than a feature switch: every system that moves a body has to know
   * where the world stops, and "nowhere" is a legitimate answer to that question rather than a
   * different code path. Read once into `World.arenaHalf`; nothing in core reads `ARENA_HALF`
   * directly any more, that constant being merely the Scrapyard's number.
   */
  readonly arenaHalf: number;

  /**
   * Ground texture key, without the `sprites/` path or the `.png`.
   *
   * One baked, seamless, tiling texture per level. `tools/make-floor.mjs` bakes them and
   * `assets.ts` loads exactly the keys this catalog names, so a level's ground is a row here and a
   * row there with nothing to change in the renderer.
   */
  readonly floor: string;

  /**
   * THE LEVEL'S OWN WORLD GENERATION, called once at run start with the run's seed.
   *
   * A function rather than a flag, because the levels do not generate the same thing with a
   * different density - they generate differently. The Scrapyard fills a fixed square from its
   * edges inward; an unbounded level cannot, and a future level might carve rooms or grow terrain
   * around the player. All of those are this signature; none of them is a boolean.
   *
   * Must be DETERMINISTIC in `seed` alone. It is part of the replay key.
   */
  readonly makeScenery: (seed: number) => Scenery;

  /**
   * THE LEVEL'S OWN CREATURES. `typeId` on the enemy pool indexes THIS array.
   *
   * There is no global enemy catalog any more. Two levels' id 3 are two unrelated things, and
   * that is the point: a creature can be renamed, resized, given a damage stage or deleted without
   * any possibility of moving something on another map.
   */
  readonly creatures: readonly CreatureDef[];

  /**
   * HOW MANY RUNGS THIS LEVEL'S LADDER ACTUALLY AUTHORS.
   *
   * `resolveCycle` answers for any index - past the table it extrapolates the last rung - so
   * nothing in the simulation needs this. The BESTIARY does: it enumerates a level's creatures and
   * has to stop where the authored content stops, or it would list minute 17's harder Wyrm as a
   * separate animal. It is also what the kill tally is sized by, and what clamps a late cycle back
   * onto the rung it is a repeat of.
   */
  readonly cycleCount: number;

  /**
   * HOW MANY GRAZING PROPS THIS MAP KEEPS ALIVE. 0 for a map with none.
   *
   * A COUNT RATHER THAN A BOOLEAN, and it is a universal fact rather than a feature switch: every
   * map answers "how much loot walks about on you" the way every map answers "how big is it". The
   * Scrapyard's answer is none, because its loot is drums baked into the terrain; Mossy Mayhem's is
   * a flock, because its terrain is trees and a felled tree gives nothing.
   *
   * The flock is topped up around the player rather than placed at run start - see systems/sheep.ts
   * - which is what makes a number meaningful on an unbounded map.
   */
  readonly sheep: number;

  /**
   * WHICH OF THIS LEVEL'S CREATURES ILLUSTRATES THE SHARED MACHINERY. An id into `creatures`.
   *
   * The Scrapopedia has pages for VARIANTS and RANKS - swift, tough, spiky, elite, boss - which
   * are properties of the machinery rather than of any one creature, so a page needs a body to
   * put the cue on. It used to be a hardcoded `enemy_01`, which was fine when there was one map
   * and became a lie the moment there were two: a player who only plays Mossy was shown a scrap
   * machine to explain what a swift moss creature looks like.
   *
   * So every level names its OWN representative and the pedia shows one per level side by side.
   * No level's art is ever repurposed to stand for another's, which also means a body on that
   * screen can always be answered for - it is that map's creature, from that map's table.
   *
   * Pick a PLAIN, mid-roster, unmistakable silhouette. It carries the variant's render cue at
   * 34 px, so a body whose outline is ambiguous at that size teaches nothing.
   */
  readonly bestiaryBody: number;

  /**
   * THE LEVEL'S OWN LADDER - which creature the director spawns in cycle `index`, and how tough.
   *
   * A function for the same reason `makeScenery` is one. The Scrapyard's ladder names a hull and
   * derives three ranks by recolouring an atlas frame; Mossy's names three creatures outright
   * because its art has no recolours; a third level might generate its ladder from the seed. All
   * of those fill the same `ResolvedCycle`, and the director cannot tell the difference.
   *
   * Must be DETERMINISTIC in `index` alone.
   */
  readonly resolveCycle: CycleResolver;
}

/** Every level, in picker order. */
export const LEVEL_CATALOG: readonly LevelDef[] = Object.freeze([SCRAPYARD, MOSSY_MAYHEM]);

/** A level by id, or the first playable one. Never an index literal, never a bare fallback. */
export function levelOrDefault(id: string | undefined): LevelDef {
  const found = id === undefined ? undefined : levelById(id);
  if (found !== undefined && found.playable) return found;
  const first = LEVEL_CATALOG.find((l) => l.playable);
  return first ?? LEVEL_CATALOG[0];
}

/** The default and the fallback: the first playable entry, never an index literal. */
export function firstPlayableLevel(): LevelId {
  for (const level of LEVEL_CATALOG) {
    if (level.playable) return level.id;
  }
  return LEVEL_CATALOG[0].id;
}

export function levelById(id: string): LevelDef | undefined {
  for (const level of LEVEL_CATALOG) {
    if (level.id === id) return level;
  }
  return undefined;
}
