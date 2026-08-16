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
 * WHY IT IS BARE TODAY
 * ---------------------------------------------------------------------------------------------
 * `makeScenery` returns an EMPTY world - deliberately, and only for now. The Scrapyard's generator
 * fills a fixed square; this level has no square to fill, so it needs terrain derived in chunks
 * around the player as they walk, which is the next piece of work and belongs in this file when it
 * arrives. Shipping bare turf beats shipping a wood that stops at an invisible line.
 *
 * An empty `Scenery` is a complete one: `count` 0 means every overlap query misses and every push
 * is a no-op, so nothing downstream needs to know this level has nothing in it yet.
 */

import { emptyScenery, type Scenery } from './scenery.js';
import { MOSS_CREATURES } from './creaturesMossy.js';
import { resolveMossyCycle } from './cyclesMossy.js';
import type { LevelDef } from './levels.js';

export const MOSSY_MAYHEM: LevelDef = Object.freeze({
  id: 'mossy-mayhem' as const,
  name: 'Mossy Mayhem',
  blurb: 'Open moss and turf, running out further than you can walk. No fence, no corners.',
  art: '',
  playable: true,

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

  makeScenery: (): Scenery => emptyScenery(),

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
});
