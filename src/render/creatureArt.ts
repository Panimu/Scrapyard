/**
 * CREATURE ART, PER LEVEL - which texture a `typeId` draws, at what scale, and which frame of a
 * creature that comes apart as it is hurt.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE SCALE RULE IS PER LEVEL AND NOT ONE FORMULA
 * ---------------------------------------------------------------------------------------------
 * A creature declares `drawSize` in WORLD UNITS and the renderer has to turn that into a sprite
 * scale, which means knowing how many pixels of the source image are actually the creature. The
 * two levels answer that differently, and the difference is a fact about their art packs rather
 * than a preference:
 *
 *   SCRAPYARD   Kenney units sit inside a fixed 64x64 canvas with wildly varying margins - a runt
 *               is 16x24 px of art in that canvas. Scaling the canvas would draw a 26-unit runt as
 *               a 6.5-unit speck inside its own 26-unit collision circle, so the content had to be
 *               MEASURED, once, by hand, into the table below. The art cannot be trimmed after the
 *               fact without redoing the whole pipeline.
 *   MOSSY       `tools/make-moss-enemies.mjs` trims every DCSS tile to its opaque bounding box at
 *               bake time, so the PNG's own dimensions ARE the content and the texture can simply
 *               be asked. No table, and no way for one to fall out of date.
 *
 * A single formula could not serve both without a flag, and a flag on this axis is exactly what
 * the level split exists to remove. So the rule is a function the level supplies, in a registry
 * the compiler requires to be total - the same shape as `DRESSING_BY_LEVEL` next door, for the
 * same reason.
 *
 * ---------------------------------------------------------------------------------------------
 * DAMAGE STAGES ARE DRAWN, NEVER SIMULATED
 * ---------------------------------------------------------------------------------------------
 * A Mossy snail becomes a slug at half health and a hydra sheds a head every fifth of its bar.
 * Core knows nothing about either: the creature table lists the sprites, and `stageIndexFor` picks
 * between them from the HP the renderer is already reading to draw the health bar.
 *
 * That is not a shortcut, it is the correct seam. The stages change nothing about the fight - not
 * a radius, not a speed, not a hitbox - so putting them in the simulation would add state that
 * must hash, replay and stay deterministic in exchange for nothing at all. A creature with five
 * faces is one enemy, and the sim is entitled to keep thinking so.
 */

import type { Texture } from 'pixi.js';

import type { CreatureDef } from '../core/index.js';
import type { LevelId } from '../core/content/levels.js';

/** One drawable frame: the texture, and the scale that makes its content measure `drawSize`. */
export interface CreatureFrame {
  readonly texture: Texture;
  readonly scale: number;
}

/**
 * A level's whole creature art, indexed by `typeId`. Every entry has AT LEAST ONE frame, so the
 * draw path never branches on whether a creature has stages - it indexes a list that is usually
 * one long.
 */
export type LevelCreatureArt = readonly (readonly CreatureFrame[])[];

/**
 * Largest content dimension of each Kenney enemy hull, in DEFAULT-size pixels, indexed by hull-1.
 * Straight from the measured bbox table in ASSET_MANIFEST §2.
 *
 * SCRAPYARD ONLY. It lives here beside the rule that uses it rather than in assets.ts, because it
 * is not a fact about loading textures - it is a fact about one art pack, and the next level to
 * arrive should be able to read this file and see that it owes nothing to this table.
 */
const HULL_CONTENT_PX: readonly number[] = [
  24, // 1  infantry, plain          16x24
  24, // 2  infantry, helmet         16x24
  24, // 3  infantry, arms out       20x24
  24, // 4  infantry, shoulder pads  20x24
  24, // 5  infantry, bulky          16x24
  32, // 6  light truck              32x32
  40, // 7  long truck               40x36
  40, // 8  boxy truck               32x40
  51, // 9  tank, gun barrel         51x38
  44, // 10 heavy hover-bus          44x40
  40, // 11 rig with cylinder        40x40
  24, // 12 infantry, orange         16x24
];

/** We ship `PNG/Retina/Unit/`, whose canvas AND content are exactly 2x the Default-size art. */
const ENEMY_RETINA_FACTOR = 2;

/**
 * How many pixels of `texture` are the creature, for a creature at index `id` in the level's table.
 * The scale is then `drawSize / contentPx`.
 */
export type ContentPxRule = (id: number, texture: Texture) => number;

/**
 * EVERY LEVEL'S RULE, BY ID. `Record<LevelId, ...>` so a missing entry is a COMPILE ERROR: a level
 * added to the core catalog stops the build until somebody has said how its art is measured, which
 * beats defaulting to a formula that would silently draw its creatures at the wrong size.
 */
export const CONTENT_PX_BY_LEVEL: Record<LevelId, ContentPxRule> = {
  // The atlas is four recolour bands of twelve hulls, so `hull = (id % 12) + 1`. That arithmetic
  // is the Scrapyard's and appears in exactly two places - here, and `typeIdFor` in core.
  scrapyard: (id) => HULL_CONTENT_PX[id % 12] * ENEMY_RETINA_FACTOR,
  // Trimmed at bake time: the PNG is the creature and nothing else.
  'mossy-mayhem': (_id, texture) => Math.max(texture.width, texture.height),
};

/** Every sprite key a level's creatures can draw, stages included, for the loader's key list. */
export function creatureSpriteKeys(creatures: readonly CreatureDef[]): string[] {
  const keys: string[] = [];
  for (const c of creatures) {
    keys.push(c.sprite);
    for (const s of c.stages) keys.push(s);
  }
  return keys;
}

/**
 * Builds one level's creature art. `get` resolves a sprite key to a loaded texture.
 *
 * A creature with no stages becomes a one-frame list of its own `sprite`, so the draw path is
 * uniform. Each stage is measured independently - a hydra shrinks from 32 source pixels to 21 as
 * it loses heads, and measuring once would have stretched the last frame back up to full size,
 * throwing away the one thing the effect is for.
 */
export function buildCreatureArt(
  levelId: LevelId,
  creatures: readonly CreatureDef[],
  get: (key: string) => Texture,
): LevelCreatureArt {
  const contentPx = CONTENT_PX_BY_LEVEL[levelId];
  return creatures.map((c) => {
    const keys = c.stages.length > 0 ? c.stages : [c.sprite];
    return keys.map((key) => {
      const texture = get(key);
      return { texture, scale: c.drawSize / contentPx(c.id, texture) };
    });
  });
}

/**
 * Which frame a creature on `hp` of `maxHp` shows, out of `count`.
 *
 * Even bands of damage taken, healthiest first. Two frames therefore break at exactly half - one
 * event in the fight, which is what a snail losing its shell should be - and five break every 20%,
 * which turns a hydra's health bar into a visible countdown of heads.
 *
 * Clamped at both ends rather than trusted: an over-heal or a negative-HP frame between the killing
 * blow and the reap would otherwise index outside the list.
 */
export function stageIndexFor(hp: number, maxHp: number, count: number): number {
  if (count <= 1 || maxHp <= 0) return 0;
  const taken = 1 - hp / maxHp;
  const i = Math.floor(taken * count);
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}
