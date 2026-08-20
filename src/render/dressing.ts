/**
 * LEVEL DRESSING: everything a level paints under the action, and nothing shared between levels.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------------------------
 * The renderer used to own a GroundPaths, a GroundCover and a Fence directly, and asked the level
 * whether to show each one. Two problems, and the second is the serious one:
 *
 *   - `if (level.groundDecor)` is a branch in a system for one piece of content, which is the exact
 *     shape the weapon catalog forbids and for the same reason.
 *   - It could only ever express levels that are THIS level with parts removed. A level that wants
 *     a fog layer, or animated water, or a ceiling, has nothing to switch on - it needs the
 *     renderer edited, and the edit lands in the middle of code the other levels depend on.
 *
 * A dressing is a level's whole visual identity below the entities, behind one interface. The
 * renderer holds a slot in its layer order and whatever is in that slot decides what the ground of
 * this level looks like. Levels cannot see each other, cannot share a flag, and cannot break each
 * other - and a new one is a new file plus a row in the registry.
 *
 * ---------------------------------------------------------------------------------------------
 * THE REGISTRY IS TOTAL, AND THE COMPILER ENFORCES IT
 * ---------------------------------------------------------------------------------------------
 * `Record<LevelId, DressingFactory>` requires an entry for EVERY level id. Adding a level to the
 * core catalog therefore fails to compile until somebody decides what it looks like. That is worth
 * far more than the boolean it replaced: a boolean that nobody sets reads as `false` and ships a
 * level with no ground, silently.
 *
 * ---------------------------------------------------------------------------------------------
 * CORE CANNOT REACH THIS, AND MUST NOT
 * ---------------------------------------------------------------------------------------------
 * `LevelDef` lives in core and holds no reference to any of this - core has no PixiJS and no
 * renderer. The link is the level's `id`, resolved here. That is the same seam the whole codebase
 * keeps between simulation and presentation, applied to levels.
 */

import type { Container } from 'pixi.js';

import type { LevelId } from '../core/content/levels.js';
import type { World } from '../core/index.js';
import type { Camera } from './camera.js';
import type { GameTextures } from './assets.js';
import { CityDressing } from './dressingCity.js';
import { MossDressing } from './dressingMoss.js';
import { ScrapyardDressing } from './dressingScrapyard.js';

export interface LevelDressing {
  /**
   * Everything this dressing draws, in one container, added to the renderer's slot.
   *
   * The dressing owns the internal layer order within it. The renderer only knows that the whole
   * lot sits below the strike markers and above the floor.
   */
  readonly container: Container;

  /** A run on this level is starting. The seed is the only thing that may decide what appears. */
  begin(world: World): void;

  /** Once a frame, after the camera is positioned and before anything that moves is drawn. */
  draw(camera: Camera, world: World): void;

  /**
   * The level is being left. Release anything that would otherwise sit in the display list or hold
   * GPU resources for a level nobody is playing.
   *
   * Textures are SHARED with the asset cache and must not be destroyed here - the next run on this
   * level wants them back.
   */
  destroy(): void;
}

export type DressingFactory = (tex: GameTextures) => LevelDressing;

/**
 * EVERY LEVEL'S DRESSING, BY ID.
 *
 * `Record<LevelId, ...>` and not a Map or a lookup with a fallback: a missing entry is a COMPILE
 * ERROR, which is the whole point. Adding a level to the core catalog stops the build until
 * somebody has said what its ground looks like.
 *
 * The import list below is the honest dependency: this module knows about every level, and it is
 * the ONLY module that does. Nothing else in the renderer names a level.
 */
export const DRESSING_BY_LEVEL: Record<LevelId, DressingFactory> = {
  scrapyard: (tex) => new ScrapyardDressing(tex),
  'mossy-mayhem': (tex) => new MossDressing(tex),
  'city-chaos': (tex) => new CityDressing(tex),
};
