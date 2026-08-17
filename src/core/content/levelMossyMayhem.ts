/**
 * MOSSY MAYHEM. Open turf, unbounded in every direction.
 *
 * ---------------------------------------------------------------------------------------------
 * NOT "THE SCRAPYARD WITHOUT A FENCE"
 * ---------------------------------------------------------------------------------------------
 * It shares the mechs, the guns and the horde, and past that it is meant to diverge as far as it
 * needs to. Everything specific to it lives here and nothing about it is expressed as a flag on a
 * shared table, so a change to this level cannot alter the Scrapyard and a third level does not
 * have to be describable in terms of either.
 *
 * ---------------------------------------------------------------------------------------------
 * ITS TERRAIN IS WALLS, AND THEY GO ON FOREVER
 * ---------------------------------------------------------------------------------------------
 * The Scrapyard scatters circles across a fixed square. This level has no square, so it cannot -
 * and blobs would not be what it wants anyway. `wallsMossy.ts` deals SEGMENTS instead: lines, Ls,
 * Ts and walled rooms with entrances, one shape per block of the plane, generated from the seed
 * wherever the player happens to be standing.
 *
 * Two varieties. Stone is permanent; TREES come down when shot and leave a stump. That is a
 * property of the terrain rather than a feature switched on for this level, which is why it cost
 * core one event and no system a branch.
 */

import { type Scenery } from './scenery.js';
import { createMossWalls } from './wallsMossy.js';
import { MOSS, MOSS_CREATURES } from './creaturesMossy.js';
import { MOSS_LADDER, resolveMossyCycle } from './cyclesMossy.js';
import type { LevelDef } from './levels.js';

export const MOSSY_MAYHEM: LevelDef = Object.freeze({
  id: 'mossy-mayhem' as const,
  name: 'Mossy Mayhem',
  blurb: 'Open moss and turf, running out further than you can walk. No fence, no corners.',
  art: '',
  playable: true,
  /**
   * EARNED BY FINISHING THE SCRAPYARD - the whole yard, every Scraplord down, not merely surviving
   * it.
   *
   * The second map is the first thing in the game that is behind a WIN rather than behind a
   * milestone inside a loss. Every chassis condition so far can be met by a run that ends badly;
   * this one cannot, which is what makes it the reward for having actually finished something.
   *
   * The Scrapyard by name rather than `win`, because `win` would be satisfied by clearing THIS map
   * and a condition that unlocks itself is not a condition.
   */
  unlock: { kind: 'winLevel', level: 'scrapyard' } as const,

  /**
   * NO EDGE IN ANY DIRECTION.
   *
   * Infinity rather than a very large number, and it is worth being deliberate about: every bound
   * check in core is a comparison, and `x > Infinity` is false, so every clamp degrades to exactly
   * the no-op an unbounded world wants without a single `if (bounded)` anywhere. A big finite
   * number would instead put a wall somewhere far away that nobody tested, which is the kind of
   * thing found by a player rather than by us.
   *
   * It never reaches an entity's position or the replay hash: the clamps that would have written
   * it are the ones that no longer fire, and `hashWorld` walks pools rather than config.
   */
  arenaHalf: Infinity,
  floor: 'floor_moss',

  /**
   * The whole plane's worth of walls, from the seed alone. Nothing is allocated up front: the
   * lattice generates the block under the query and memoises it, so a run that walks two hundred
   * thousand units costs the same as one that never leaves the opening.
   */
  makeScenery: (seed: number): Scenery => createMossWalls(seed),

  /**
   * ITS OWN CREATURES AND ITS OWN LADDER - eight things that live in moss, and the eight cycles
   * that spend them, in `creaturesMossy.ts` and `cyclesMossy.ts`.
   *
   * Nothing in either is shared with the Scrapyard: not a stat, not a sprite, not an id. Two of
   * the bosses come apart as they are hurt, which is a property of THESE creatures rather than a
   * feature switched on for the level, and is why it costs core nothing.
   */
  creatures: MOSS_CREATURES,
  resolveCycle: resolveMossyCycle,
  cycleCount: MOSS_LADDER.length,

  /**
   * THE JACKAL, and not the Sporeling this map opens with.
   *
   * The bestiary body carries a variant's render cue - a size change, a tint, a rim - at 34 px, so
   * it has to be a silhouette that still reads once it has been squashed and recoloured. A dog
   * does; a mushroom becomes an anonymous blob. It is also a RUNT, like the Scrapyard's Rustling
   * beside it, so the two maps' bodies are drawn at the same scale and the row compares creatures
   * rather than sizes.
   */
  bestiaryBody: MOSS.JACKAL,
});
