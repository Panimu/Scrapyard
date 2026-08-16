/**
 * THE LEVELS. Two, and the simulation reads them now.
 *
 * A table rather than a pair of buttons in the UI, because a level is the thing that chooses what
 * the ground is, how big the world is, and eventually the scenery mix and the enemy ladder. When
 * those arrive they arrive as FIELDS HERE, not as a switch statement in whatever system needed to
 * know.
 *
 * ---------------------------------------------------------------------------------------------
 * `arenaHalf` IS THE FIRST THING A LEVEL ACTUALLY DECIDES
 * ---------------------------------------------------------------------------------------------
 * The Scrapyard is a fenced square: half-extent `ARENA_HALF`, a wall you can be cornered against,
 * and that pressure is the level. Mossy Mayhem is `Infinity` - genuinely unbounded in all four
 * directions, no wall, no wrap, no soft nudge back toward the middle.
 *
 * INFINITY RATHER THAN A VERY LARGE NUMBER, and it is worth being deliberate about. Every bound
 * check in core is a comparison, and `x > Infinity` is false, `x < -Infinity` is false, so every
 * clamp degrades to exactly the no-op an unbounded world wants without a single `if (bounded)`
 * anywhere. A big finite number would instead put a wall somewhere far away that nobody tested,
 * which is the kind of thing that is found by a player and not by us.
 *
 * It never reaches an entity's position or the replay hash: the clamps that would have written it
 * are the ones that no longer fire, and `hashWorld` walks pools rather than config.
 *
 * A LEVEL NOBODY CAN PICK IS STILL WORTH SHIPPING - `playable` says so in one place rather than in
 * the markup. That is how Mossy Mayhem sat here as a name for weeks, and it is how the next one
 * will too.
 */

import { ARENA_HALF } from '../constants.js';

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
   * Read once into `World.arenaHalf` at creation and consulted from there by every system that
   * cares. Nothing in core reads `ARENA_HALF` directly any more - that constant is now just the
   * Scrapyard's number, quoted here.
   */
  readonly arenaHalf: number;
  /**
   * Ground texture key, without the `sprites/` path or the `.png`.
   *
   * One baked, seamless, tiling texture per level - the same shape the Scrapyard's `floor` has
   * been since the ground was baked. A level's floor is one TilingSprite with one texture, and
   * changing levels changes which texture.
   */
  readonly floor: string;
  /**
   * Does this level generate colliding scenery?
   *
   * FALSE FOR MOSSY MAYHEM TODAY, and deliberately. `createScenery` fills a FIXED SQUARE at run
   * start - it is built around knowing where the edges are - and an unbounded level needs scenery
   * generated in chunks around the player instead. That is the next piece of work, and shipping
   * the ground without it beats shipping a wood that stops at an invisible line 6144 units out.
   */
  readonly scenery: boolean;
  /**
   * Does this level draw the render-side ground decoration - the rubble scatter and the worn
   * service roads?
   *
   * FALSE FOR MOSSY MAYHEM, because both are dressed for the yard. The scatter is rust clusters
   * and grey boulders tinted `0xb08a76`, and the roads are pale plating tinted to worn concrete;
   * on turf they read as smears of dirt somebody spilled rather than as ground. The moss map gets
   * its own decoration in the same step as its scenery, out of the medieval pack.
   *
   * Purely cosmetic and render-side - see src/render/groundCover.ts. Nothing in the simulation
   * knows either layer exists, which is why this is a rendering flag and not a `scenery` one.
   */
  readonly groundDecor: boolean;
}

export const LEVEL_CATALOG: readonly LevelDef[] = Object.freeze([
  Object.freeze({
    id: 'scrapyard' as const,
    name: 'Scrapyard',
    blurb: 'A fenced yard of rust and wrecks. Fifteen minutes, seven bosses, nowhere to run to.',
    art: 'scrap_0',
    playable: true,
    arenaHalf: ARENA_HALF,
    floor: 'floor',
    scenery: true,
    groundDecor: true,
  }),
  Object.freeze({
    id: 'mossy-mayhem' as const,
    name: 'Mossy Mayhem',
    blurb: 'Open moss and turf, running out further than you can walk. No fence, no corners.',
    art: '',
    playable: true,
    // No wall in any direction. See this file's header for why Infinity rather than a big number.
    arenaHalf: Infinity,
    floor: 'floor_moss',
    // Not yet - see `scenery` and `groundDecor` on LevelDef.
    scenery: false,
    groundDecor: false,
  }),
]);

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
