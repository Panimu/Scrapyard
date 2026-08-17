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

import { BOSS_OUTLINE_SCALE, type CreatureDef } from '../core/index.js';
import type { LevelId } from '../core/content/levels.js';

/**
 * HOW A CREATURE CARRIES ITSELF. An index, not a description - the renderer owns what each one
 * looks like (see `drawEnemies`).
 *
 * THE ART PACKS SHIP NO ANIMATION. DCSS is one still frame per creature - no walk cycle, no attack,
 * no death (assets/dcss/README.md is explicit about it) - so any motion has to be made rather than
 * played back. That leaves two ways to do it, and this is the cheap one: transform the still.
 * Squash, stretch and lean cost nothing per creature, work on art nobody drew frames for, and
 * generalise to the whole roster for free. Baking real frames would look better and costs an
 * artist per creature; this is the experiment that says whether that is worth doing.
 */
export const GAIT_NONE = 0;
/**
 * THE TODDLE. Two footfalls a stride, squashing on each, with the body rising over the planted one
 * and the whole thing rolling side to side once across the pair.
 *
 * Named for what it is rather than "walk": a toddle is specifically a body too tall for its legs
 * shifting its weight from one to the other, which is exactly what the lean at one-per-stride
 * riding on the squash at two-per-stride produces. A waddle is hips, a bob is only vertical, and a
 * plain "walk" would have made the second gait impossible to name honestly.
 */
export const GAIT_TODDLE = 1;
/**
 * THE TWO-STEP. A deliberately CRUDE walk: two poses, hard cut, no easing anywhere.
 *
 * Everything else here is continuous - `sin` all the way down - and this is the opposite on
 * purpose. It is the read of an old two-frame sprite walk, where the whole animation is one pose
 * and its opposite alternating on a beat, and what sells that is the POP: an eased version of the
 * same poses reads as a smooth lurch, which is a different and much worse thing.
 *
 * Three things move together and all three snap: the body leans one way then the other, rises on
 * the pose it leans into, and shifts a little over the foot it is standing on. Two states, and
 * nothing in between.
 */
export const GAIT_TWO_STEP = 2;

/**
 * Radians of stride per tick, for a creature drawn `GAIT_REF_HEIGHT` units tall. 2*pi/26 is a
 * stride every 26 ticks - a hair over four tenths of a second, a brisk walk rather than a scuttle.
 */
const GAIT_RATE = (Math.PI * 2) / 26;
/** The drawn height that rate is FOR: a runt, which is the smallest thing that walks. */
const GAIT_REF_HEIGHT = 26;

/**
 * BIG THINGS TAKE LONGER STEPS. A creature drawn twice the size does not walk at twice the speed
 * with the same cadence - its legs are a longer pendulum, and a pendulum's period goes with the
 * SQUARE ROOT of its length. Same reason an elephant's stride looks slow and a mouse's looks
 * frantic, and the reason a game that scales a sprite without scaling its cadence gets something
 * that reads as a toy rather than as a large animal.
 *
 * So the rate is divided by `sqrt(size)`. On the rank ladder that is a stride every 26 ticks for a
 * regular, 32 for an elite and 44 for a boss - the boss takes 1.7x as long over a step while being
 * 2.9x the size, which is the ratio the physics gives rather than one picked by eye.
 *
 * `Math.sqrt` is fine HERE and would not be in core: this is the render layer, and the value is
 * computed once at load rather than per frame.
 */
export function gaitRateFor(drawnHeight: number): number {
  if (drawnHeight <= 0) return GAIT_RATE;
  return GAIT_RATE * Math.sqrt(GAIT_REF_HEIGHT / drawnHeight);
}

/**
 * KEYED BY SPRITE NAME, not by creature id. A name is content that means the same thing forever,
 * whereas ids are positional - and this table would silently start animating the wrong creature the
 * day somebody inserted a row above it. Anything absent simply does not move, which is the right
 * default for a table nobody has got to yet.
 */
const GAIT_BY_SPRITE: Readonly<Record<string, number>> = {
  // THE SPORELING, which the toddle was built for. A cap on two legs is the best possible test of a
  // transform-only gait: it is top-heavy, so a lean reads as weight shifting rather than as the
  // whole sprite sliding, and it is already drawn mid-stride.
  moss_wandering_mushroom: GAIT_TODDLE,

  // THE FORMLESS PAIR, and they are not an obvious fit - the toddle is a legged idea and these have
  // no legs. It works because the part a blob needs IS the squash: something soft moving under its
  // own weight compresses and recovers, and the lean turns that from a pulse into travel. The rise
  // is the questionable half on these two, and it is small enough at their size to read as the
  // body heaving forward rather than as a hop.
  moss_jelly: GAIT_TODDLE,
  moss_ooze: GAIT_TODDLE,

  // THE VINE STALKER gets the two-step, and it is the right body for it: drawn head-on, upright,
  // arms out, with no profile to contradict. A snapped lean on something facing you reads as a
  // stride; the same snap on a creature drawn in profile would read as a glitch.
  moss_vine_stalker: GAIT_TWO_STEP,
};

/** One drawable frame: the texture, the scale that makes its content measure `drawSize`, and how it moves. */
export interface CreatureFrame {
  readonly texture: Texture;
  readonly scale: number;
  /** One of the GAIT_* constants. */
  readonly gait: number;
  /**
   * Radians of stride per tick at rank `regular`, from the creature's drawn height. See
   * `gaitRateFor`.
   *
   * ONE VALUE PER CREATURE, NOT PER FRAME, even though it sits on the frame: a hydra is 32 source
   * pixels tall with five heads and 31 with one, and `phase` is `tick * rate`, so a rate that
   * moved when a stage changed would jump the phase by hundreds of radians mid-fight. Taken from
   * frame 0, so every stage of a creature keeps the cadence it started with.
   */
  readonly gaitRate: number;
  /** The sprite the boss outline pass draws. See `RIM_BY_LEVEL`. */
  readonly rim: Texture;
  /** `rim`'s own scale. Applied from the same centre as `scale`, so the two stay concentric. */
  readonly rimScale: number;
}

/**
 * HOW A LEVEL DRAWS THE BOSS OUTLINE. Two answers, and which one is right is a fact about the art
 * pack rather than a preference - the same shape, and the same reason, as `CONTENT_PX_BY_LEVEL`.
 *
 * ---------------------------------------------------------------------------------------------
 * A TINT IS A MULTIPLY, AND THAT IS THE WHOLE STORY
 * ---------------------------------------------------------------------------------------------
 * `out = texel x tint`. It can darken a pixel; it can never brighten one. So tinting a scaled-up
 * copy of a sprite only produces a coloured rim if the sprite's OUTER EDGE is bright.
 *
 *   SCRAPYARD   Kenney's units are flat-shaded with no keyline, so the edge takes the blue and a
 *               scaled copy of the body IS the outline. Nothing to bake, and it batches with the
 *               body because it is the same texture.
 *   MOSSY       DCSS creatures carry a heavy near-black keyline all the way round, and the keyline
 *               is exactly what an enlarged copy exposes. Measured on the visible band: 81%
 *               near-black on the Sporeling, 98% on the jelly, mean colour #191f0d. It read as a
 *               black shadow, and worst on bosses because the band scales with the body - 7.5
 *               world units of it round a 75-unit Sporeling boss.
 *
 * So Mossy draws a rim baked by `tools/make-moss-enemies.mjs`: the creature's own alpha mask,
 * grown two source pixels, minus itself, painted flat white. White multiplies to whatever colour
 * is asked for; hollow means a gap between two legs stays a gap; and a real dilation is an EVEN
 * band, where scaling about the centre gave one that was nothing at the waist and widest at the
 * extremities.
 */
export interface RimRule {
  /** The sprite key drawing `key`'s rim, or undefined to reuse the body sprite itself. */
  readonly keyFor: (key: string) => string | undefined;
  /** Rim scale, as a multiple of the body's. A baked rim is 1: it is already the right size. */
  readonly scale: number;
}

/**
 * WHICH WAY A LEVEL'S ART IS DRAWN FACING: `1` for east, `-1` for west.
 *
 * The renderer mirrors a creature so it faces the way it is walking, and to do that it has to know
 * which way the art faces to begin with. That is a fact about the PACK, not about the creature, so
 * it belongs here with the other two - and it was assumed rather than asked, which is the bug this
 * exists to fix.
 *
 *   SCRAPYARD   Kenney's RTS units are drawn facing EAST, and every enemy on that map has been
 *               correct since the first build - which is why the assumption survived.
 *   MOSSY       Dungeon Crawl's monster tiles are drawn facing WEST. All of them: checked the full
 *               roster of 23 rather than a sample, and every creature with a profile at all - the
 *               dragons, the hydra at all five head counts, both hounds, the jackal, the flies, the
 *               snail and slug - points its head to the left. The rest are drawn head-on and do not
 *               care. So every creature on the moss was walking backwards, in both directions.
 *
 * IT WAS REPORTED AS "the Draconian is wrong", and that is worth recording. The Draconian is a
 * bruiser drawn up to 122 units with a snout you cannot misread; a 26-unit jackal walking backwards
 * reads as a smudge. The loudest symptom was not the cause, and fixing the sprite would have left
 * twenty-two others wrong.
 */
export const ART_FACING_BY_LEVEL: Record<LevelId, number> = {
  scrapyard: 1,
  'mossy-mayhem': -1,
};

/** EVERY LEVEL'S RULE, BY ID - `Record<LevelId, ...>`, so a new level cannot forget to answer. */
export const RIM_BY_LEVEL: Record<LevelId, RimRule> = {
  scrapyard: { keyFor: () => undefined, scale: BOSS_OUTLINE_SCALE },
  'mossy-mayhem': { keyFor: (key) => `${key}_rim`, scale: 1 },
};

/**
 * Every rim sprite key a level's creatures need, deduplicated - empty for a level whose rule
 * reuses the body. Separate from `creatureSpriteKeys` because these are not creature art: nothing
 * but the boss outline pass ever draws one, and the bestiary must not pick them up.
 */
export function creatureRimKeys(levelId: LevelId, creatures: readonly CreatureDef[]): string[] {
  const rule = RIM_BY_LEVEL[levelId];
  const keys = new Set<string>();
  for (const c of creatures) {
    for (const f of c.frames) {
      const k = rule.keyFor(f);
      if (k !== undefined) keys.add(k);
    }
  }
  return [...keys];
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

/** Anything with pixel dimensions: a loaded `Texture`, or an `<img>`'s natural size. */
export interface Measurable {
  readonly width: number;
  readonly height: number;
}

/**
 * How many pixels of `art` are the creature, for a creature at index `id` in the level's table.
 * The sprite scale is then `drawSize / contentPx`.
 *
 * Deliberately typed on WIDTH AND HEIGHT rather than on `Texture`, so the Scrapopedia can ask the
 * same question of an `<img>`'s natural size. That screen draws one body per level side by side,
 * and without this they are wrong relative to each other by a factor of 2.7 - a Kenney unit is a
 * small figure in a large empty canvas, a DCSS tile is trimmed to its own edges, and letting the
 * browser fit each to the same box makes two identically-sized runts look nothing alike.
 */
export type ContentPxRule = (id: number, art: Measurable) => number;

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
  'mossy-mayhem': (_id, art) => Math.max(art.width, art.height),
};

/**
 * Every sprite key a level's creatures can draw, DEDUPLICATED.
 *
 * The dedupe is not defensive tidiness, it is required: Pixi's resolver warns and takes an
 * "overwriting" path when the same alias is registered twice, and two levels may legitimately
 * share nothing while ONE level reuses a frame across two creatures. Cheaper to guarantee it here
 * than to rely on every content table being written without repeats.
 */
export function creatureSpriteKeys(creatures: readonly CreatureDef[]): string[] {
  const keys = new Set<string>();
  for (const c of creatures) {
    for (const f of c.frames) keys.add(f);
  }
  return [...keys];
}

/**
 * Builds one level's creature art. `get` resolves a sprite key to a loaded texture.
 *
 * EVERY FRAME IS MEASURED INDEPENDENTLY. A hydra shrinks from 32 source pixels to 21 as it loses
 * heads; measuring once and reusing the scale would stretch the last frame back up to full size,
 * throwing away the one thing the effect is for.
 */
export function buildCreatureArt(
  levelId: LevelId,
  creatures: readonly CreatureDef[],
  get: (key: string) => Texture,
): LevelCreatureArt {
  const contentPx = CONTENT_PX_BY_LEVEL[levelId];
  const rim = RIM_BY_LEVEL[levelId];
  return creatures.map((c) => {
    // The creature's own drawn height, from its healthiest frame - see `CreatureFrame.gaitRate`
    // for why this is deliberately not measured per frame.
    const whole = get(c.frames[0]);
    const gaitRate = gaitRateFor((whole.height * c.drawSize) / contentPx(c.id, whole));

    return c.frames.map((key) => {
      const texture = get(key);
      // THE SAME `scale` FOR BOTH when the rim is baked. A baked rim is the body's own box grown
      // by a fixed margin, so drawing it at the body's scale from the same centre puts the band
      // exactly where the dilation put it - which is the point of baking it.
      const scale = c.drawSize / contentPx(c.id, texture);
      const rimKey = rim.keyFor(key);
      return {
        texture,
        scale,
        gait: GAIT_BY_SPRITE[key] ?? GAIT_NONE,
        gaitRate,
        rim: rimKey === undefined ? texture : get(rimKey),
        rimScale: scale * rim.scale,
      };
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

/**
 * How much to magnify a level's bestiary body so its CONTENT fills its box, given the loaded
 * image's natural size.
 *
 * The Scrapopedia sizes its icons in CSS and lets `object-fit: contain` fit the whole PNG, which
 * fits the CANVAS - so a Kenney unit, whose canvas is mostly empty, comes out at about a third of
 * the size of a trimmed DCSS tile drawn beside it. Both are 26-unit runts in play; the row has to
 * say so.
 */
export function bestiaryIconScale(levelId: LevelId, creatureId: number, art: Measurable): number {
  const longest = Math.max(art.width, art.height);
  if (longest <= 0) return 1;
  const px = CONTENT_PX_BY_LEVEL[levelId](creatureId, art);
  return px > 0 ? longest / px : 1;
}
