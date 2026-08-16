/**
 * THE SCRAPYARD. A fenced square of rust, wrecks and fuel drums.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE FILE PER LEVEL, AND THIS IS THE WHOLE OF THIS ONE
 * ---------------------------------------------------------------------------------------------
 * A level used to be a row of booleans on a shared table - `scenery: true`, `groundDecor: true` -
 * which made the second level "the Scrapyard with things switched off" and would have made the
 * third one a fourth and fifth boolean that every system had to branch on. That is the same shape
 * the weapon catalog forbids: a branch in a system for one piece of content is the wrong shape.
 *
 * So a level SUPPLIES its parts instead of ticking boxes. `makeScenery` is this level's own world
 * generation, and a level whose terrain works completely differently hands over a completely
 * different function without anything in core learning a new flag.
 */

import { createScenery, type Scenery } from './scenery.js';
import { ARENA_HALF } from '../constants.js';
import type { LevelDef } from './levels.js';

export const SCRAPYARD: LevelDef = Object.freeze({
  id: 'scrapyard' as const,
  name: 'Scrapyard',
  blurb: 'A fenced yard of rust and wrecks. Fifteen minutes, seven bosses, nowhere to run to.',
  art: 'scrap_0',
  playable: true,

  /**
   * A WALL, and the pressure of it is the level. Being cornered is the Scrapyard's whole argument:
   * running always ends, so the fight is about where you get pushed to.
   */
  arenaHalf: ARENA_HALF,
  floor: 'floor',

  /**
   * Scrap piles and fuel drums on a jittered grid, filling the square.
   *
   * The generator is indexed from `-ARENA_HALF` and is built around knowing where the edges are,
   * which is exactly why it belongs to THIS level rather than to core. A level with no edges
   * cannot use it and does not have to pretend to.
   */
  makeScenery: (seed: number): Scenery => createScenery(seed),
});
