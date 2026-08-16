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
