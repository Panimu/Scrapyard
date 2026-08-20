/**
 * CITY CHAOS. An unbounded grid of streets, and the blocks between them.
 *
 * ---------------------------------------------------------------------------------------------
 * NOT "MOSSY WITH BUILDINGS"
 * ---------------------------------------------------------------------------------------------
 * It shares the mechs, the guns and the machinery of cycles, and past that everything specific to
 * it lives in its own files: its terrain in `wallsCity.ts`, its nineteen machines in
 * `creaturesCity.ts`, its ladder and the boss-promotion rule in `cyclesCity.ts`. Nothing about it
 * is a flag on a shared table, so a change to this level cannot alter the other two.
 *
 * ---------------------------------------------------------------------------------------------
 * ITS TERRAIN IS A ROAD GRID, AND IT GOES ON FOREVER
 * ---------------------------------------------------------------------------------------------
 * Streets every 768 units on both axes, and every square between them a city block the size of
 * the screen: most filled with solid building, some fenced off as construction sites with a
 * gateway or two (the fences break; the buildings never do), some courtyard buildings you can
 * fight inside, some open plazas. The whole plane is a pure function of the run seed - see
 * wallsCity.ts - and every run opens at a crossroads.
 *
 * ---------------------------------------------------------------------------------------------
 * ITS ENEMIES ARE MACHINES, AND EVERY BOSS GETS PROMOTED
 * ---------------------------------------------------------------------------------------------
 * The city's own rule, from the design brief: the boss of cycle N returns as cycle N+1's elite.
 * Eight bosses - four bipedal war mechs, then the four animal-piloted quad mechs - each of them
 * fought once alone and then again in pairs behind the next horde. See cyclesCity.ts.
 */

import { createCityBlocks } from './wallsCity.js';
import { CITY, CITY_CREATURES } from './creaturesCity.js';
import { CITY_LADDER, resolveCityCycle } from './cyclesCity.js';
import type { LevelDef } from './levels.js';
import type { Scenery } from './scenery.js';

export const CITY_CHAOS: LevelDef = Object.freeze({
  id: 'city-chaos' as const,
  name: 'City Chaos',
  blurb: 'Streets on a grid, blocks to fight around, and the machines that own them now.',
  // Its own composited card - see tools/make-level-art.mjs, same reasoning as Mossy's.
  art: 'level_city',
  playable: true,

  /**
   * EARNED BY FINISHING MOSSY MAYHEM - the same shape as Mossy's own unlock, one map further
   * along. The campaign is a chain: finish the yard to reach the moss, finish the moss to reach
   * the city. Named by level rather than `win` for the reason Mossy's comment gives: a condition
   * that unlocks itself is not a condition.
   */
  unlock: { kind: 'winLevel', level: 'mossy-mayhem' } as const,

  /** No edge in any direction - same deliberate Infinity as Mossy, see that file's note. */
  arenaHalf: Infinity,
  floor: 'floor_city',

  /**
   * THE SAME FOUR AS THE MOSS, FOR THE SAME MEASURED REASON. A sheep is this map's fuel barrel -
   * the buildings give nothing back when you cannot break them - and the flock's operating
   * footprint (the 1500 u cull radius, see systems/sheep.ts) is level-independent, so Mossy's
   * measurement against the Scrapyard's drum density carries over unchanged. That a flock of
   * sheep has wandered into the city is, on reflection, exactly the sort of thing the name
   * "City Chaos" promises.
   */
  sheep: 4,

  /** The whole city, from the seed alone. Pure arithmetic - not even a cache. See wallsCity.ts. */
  makeScenery: (seed: number): Scenery => createCityBlocks(seed),

  creatures: CITY_CREATURES,
  resolveCycle: resolveCityCycle,
  cycleCount: CITY_LADDER.length,

  /**
   * THE SENTRY - the unarmed two-legged security bot of cycle 2. A runt, like the Rustling and
   * the Jackal beside it on the Scrapopedia row, so the three maps' bodies compare at the same
   * scale; and the most unmistakable small silhouette this roster has - a domed eye on two bent
   * legs reads at 34 px where the boxy junkbot would smear.
   */
  bestiaryBody: CITY.TWOLEGS,
});
