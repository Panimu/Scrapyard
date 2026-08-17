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
import { ARENA_HALF, RUN_LENGTH_SEC } from '../constants.js';
import { SCRAPYARD_CREATURES } from './creaturesScrapyard.js';
import { CYCLE_LADDER, resolveScrapyardCycle } from './cyclesScrapyard.js';
import type { LevelDef } from './levels.js';

export const SCRAPYARD: LevelDef = Object.freeze({
  id: 'scrapyard' as const,
  name: 'Scrapyard',
  /**
   * BOTH NUMBERS ARE DERIVED, and they are derived because the hand-written version was wrong in
   * both: it said "Fifteen minutes, seven bosses" for a sixteen-minute run with eight, having been
   * written when the run was 900 s and the eighth Scraplord at 15:30 therefore never arrived.
   *
   * "Then the last Scraplord" is the WIN CONDITION rather than flavour. The clock is a floor: the
   * yard stops sending at the timer and the run is won when nothing with a boss flag is still
   * standing (systems/progression.ts). A blurb that stopped at the minutes would promise a survival
   * timer, which is the one thing this game does not have.
   */
  blurb: `A fenced yard of rust and wrecks. ${Math.round(RUN_LENGTH_SEC / 60)} minutes, ${CYCLE_LADDER.length} bosses, then the last Scraplord.`,
  art: 'scrap_0',
  playable: true,
  // THE DOOR. Every save can play this from the first tap - see LevelDef.unlock.
  unlock: { kind: 'always' } as const,

  /**
   * A WALL, and the pressure of it is the level. Being cornered is the Scrapyard's whole argument:
   * running always ends, so the fight is about where you get pushed to.
   */
  arenaHalf: ARENA_HALF,
  floor: 'floor',
  // NONE. This yard's loot is its fuel drums, which are part of the ground it is made of.
  sheep: 0,

  /**
   * Scrap piles and fuel drums on a jittered grid, filling the square.
   *
   * The generator is indexed from `-ARENA_HALF` and is built around knowing where the edges are,
   * which is exactly why it belongs to THIS level rather than to core. A level with no edges
   * cannot use it and does not have to pretend to.
   */
  makeScenery: (seed: number): Scenery => createScenery(seed),

  /**
   * Wrecked machines out of the Kenney sci-fi RTS atlas, and the eight-cycle ladder that spends
   * them. Both live in their own files and are this level's alone - see `creaturesScrapyard.ts`.
   */
  creatures: SCRAPYARD_CREATURES,
  resolveCycle: resolveScrapyardCycle,
  cycleCount: CYCLE_LADDER.length,

  /** Hull 1, blue: the Rustling's own body, and the first thing anyone who plays this map met. */
  bestiaryBody: 0,
});
