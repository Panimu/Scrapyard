/**
 * THE SCRAPYARD'S CREATURE TABLE - 48 wrecked machines, from the Kenney sci-fi RTS atlas.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS DERIVED, NOT TYPED OUT, AND THAT IS THE WHOLE TRICK
 * ---------------------------------------------------------------------------------------------
 * The atlas is 12 silhouettes x 4 faction recolours, laid out so that hull N, N+12, N+24 and N+36
 * are pixel-identical repaints. So a cycle picks ONE hull and reads three recolours off it, and
 * the player meets the same machine in three paint jobs at three sizes.
 *
 * That is the entire reason the Scrapyard's ranks read instantly without a legend: you already
 * know what that shape does, this one is just bigger and the wrong colour. It is a property of
 * THIS art pack, it is not available on Mossy Mayhem's hand-drawn creatures, and it is exactly
 * the sort of thing that used to be baked into shared code and is now local to the level that has
 * it. See `creaturesMossy.ts` for what a level does instead when its art has no recolours.
 *
 * ---------------------------------------------------------------------------------------------
 * NO DAMAGE STAGES ANYWHERE IN HERE
 * ---------------------------------------------------------------------------------------------
 * Every entry's `stages` is empty. A Kenney unit is one clean vector drawing with nothing to come
 * apart, and inventing a wrecked repaint for 48 of them is work the game has not asked for.
 */

import { creature, type CreatureDef } from './cycles.js';
import { ARCHETYPES, ENEMY_CATALOG } from './enemyCatalog.js';

/**
 * `typeId` for a (hull, tier) pair. Mirrors ENEMY_CATALOG's `id -> (hull, tier)` arithmetic
 * exactly: `hull = (id % 12) + 1`, `tier = (id / 12) | 0`.
 *
 * THIS ARITHMETIC IS THE SCRAPYARD'S AND NOBODY ELSE'S. It only means anything against an atlas
 * laid out in four equal recolour bands, which is a fact about one asset pack.
 */
export function typeIdFor(hull: number, tier: number): number {
  return tier * 12 + (hull - 1);
}

/**
 * One row per atlas frame, in atlas order, so `typeIdFor` indexes it directly.
 *
 * Generated from ENEMY_CATALOG rather than restated: that table already decided which silhouette
 * is chaff and which is a wall, by measured opaque pixel area, and a second hand-written copy
 * would drift from it the first time anyone edited one.
 */
export const SCRAPYARD_CREATURES: readonly CreatureDef[] = Object.freeze(
  ENEMY_CATALOG.map((def) => creature(def.id, def.sprite, ARCHETYPES[def.archetype].drawSize)),
) as readonly CreatureDef[];
