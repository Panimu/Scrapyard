/**
 * Texture loading and every number that translates "source pixels" into "world units".
 *
 * The render layer is the only place allowed to know a sprite's pixel size, so all of it lives
 * here rather than being sprinkled through the draw code. Every constant below is quoted from
 * docs/ASSET_MANIFEST.md, which measured them by decoding the actual PNGs - do not re-derive
 * them from the art.
 *
 * NOTE ON DELIVERY: this loads individual textures out of `public/sprites/` (produced by
 * `node tools/prepare_assets.mjs`). ASSET_MANIFEST §6 recommends one packed 1024x1024 atlas and
 * package.json reserves `npm run assets` -> tools/pack-assets.mjs for it; until that exists we
 * pay extra batch flushes. Everything here is written so that swapping in an atlas is a change
 * to `loadGameTextures` alone: the rest of the renderer only ever sees `Texture` objects.
 */

import { Assets, Rectangle, Texture } from 'pixi.js';
import { HERO_CATALOG, SCENERY_VARIANTS } from '../core/index.js';
import { LEVEL_CATALOG, type LevelId } from '../core/content/levels.js';
import {
  buildCreatureArt,
  creatureRimKeys,
  creatureSpriteKeys,
  type LevelCreatureArt,
} from './creatureArt.js';

/**
 * Cuts a horizontal sway strip into its frames.
 *
 * EVERY FRAME SHARES THE STRIP'S `source`, which is the entire reason the bake writes a strip
 * instead of N files: a TextureSource is what the batcher keys on, so a phase-staggered wood
 * showing all eight frames at once still costs one source per variant. Windows onto a texture are
 * free; textures are not.
 *
 * The strip is `SWAY_FRAMES` equal columns and nothing in the PNG says so - see `SWAY_FRAMES`.
 */
function sway(strip: Texture): Texture[] {
  return cutStrip(strip, SWAY_FRAMES);
}

/**
 * Cuts a horizontal strip into `frames` equal columns, all sharing the strip's `source`.
 *
 * The generalisation of `sway`, extracted when the flock arrived with two strips of its own at
 * different frame counts. Same rule, same reason: one TextureSource per animation however many
 * frames of it are on screen at once.
 */
function cutStrip(strip: Texture, frames: number): Texture[] {
  const w = Math.round(strip.width / frames);
  const h = strip.height;
  return Array.from(
    { length: frames },
    (_, f) => new Texture({ source: strip.source, frame: new Rectangle(f * w, 0, w, h) }),
  );
}

/** The distinct ground-texture keys the level catalog asks for, in catalog order, deduplicated. */
function levelFloorKeys(): string[] {
  const out: string[] = [];
  for (const level of LEVEL_CATALOG) {
    if (level.floor !== '' && !out.includes(level.floor)) out.push(level.floor);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rotation offsets. ASSET_MANIFEST §8.
// ---------------------------------------------------------------------------------------------

export const ROT_OFFSET = {
  /** The mech art faces +x. Three independent confirmations in ASSET_MANIFEST §1. */
  mech: 0,
  /** Flame plume points up. */
  muzzle: Math.PI / 2,
  /** Shell art points up. */
  shell: Math.PI / 2,
  /** Trail streak points up. */
  trail: Math.PI / 2,
} as const;

// ---------------------------------------------------------------------------------------------
// Source pixel dimensions. ASSET_MANIFEST §1-§3.
// ---------------------------------------------------------------------------------------------

/**
 * Player mech canvas (tools/make-mechs.mjs). Non-square: the legs splay wider than the hull is
 * long, so the canvas is taller than it is wide even though the machine faces +x.
 */
export const MECH_SRC_W = 148;
/**
 * Drawn canvas width in world units, NOT the width of the machine: the painted hull spans about
 * two thirds of the canvas (x 26..120 of 148) and the barrels and shadow fill the rest. At 58 the
 * hull measures ~37 u across against a 26 u collision radius, so the HITBOX IS SLIGHTLY MORE
 * GENEROUS THAN THE PAINT. That is the right way round for a bullet-heaven - a hit that looks
 * like a graze still lands - and it is why this is not simply 2 x radius.
 */
export const MECH_DRAW_W = 58;
export const MECH_SCALE = MECH_DRAW_W / MECH_SRC_W;

/**
 * Leg frames per chassis, covering HALF a gait cycle (tools/make-mechs.mjs). The full cycle is
 * `2 * MECH_WALK_FRAMES` poses; the second half is the first half mirrored.
 */
export const MECH_WALK_FRAMES = 6;

/** Turret canvas (tools/make-mechs.mjs), and its drawn length in world units. */
export const TURRET_SRC_W = 80;
export const TURRET_DRAW_W = 42;
export const TURRET_SCALE = TURRET_DRAW_W / TURRET_SRC_W;

/** Muzzle emits at +24 u along facing - the front lip of the 52 u chassis. */
export const MUZZLE_OFFSET = 24;

/*
 * WHERE THE ENEMY CONTENT-SIZE TABLE WENT: `render/creatureArt.ts`.
 *
 * It used to live here, next to the loader, as `HULL_CONTENT_PX` plus a retina factor. It is not a
 * fact about LOADING textures, though - it is a measured fact about one art pack, and it is only
 * one of the two rules the game now needs (Mossy's tiles are trimmed at bake time, so their own
 * dimensions are the content). Both rules live together beside the registry that chooses between
 * them. Leaving a copy here would have been a hand-measured table existing twice.
 */

/** Shell `spaceMissiles_012` is 16x22 and points up; drawn ~16 u long. */
const SHELL_SRC_H = 22;
const SHELL_DRAW_LEN = 16;
export const SHELL_SCALE = SHELL_DRAW_LEN / SHELL_SRC_H;

/** Missile `spaceMissiles_001` is 16x40 and points up; drawn ~22 u long - visibly longer than
 *  the Cannon's 16 u shell, so a screen carrying both reads as two weapons. */
const MISSILE_SRC_H = 40;
const MISSILE_DRAW_LEN = 22;
export const MISSILE_SCALE = MISSILE_DRAW_LEN / MISSILE_SRC_H;

/**
 * THE TWO RACKS, drawn from the one missile texture at different proportions.
 *
 * Short is SQUAT AND FAT, long is LONGER AND THINNER: about 20 u x 11.4 u against 25 u x 6.3 u,
 * which is 1.75 : 1 against 3.9 : 1. Enough that a screen carrying both volleys reads as two
 * weapons rather than one, small enough that neither stops looking like a missile - the source art
 * is a single body with a nose and fins, and pushing the aspect much further turns one of them
 * into a dart and the other into a barrel.
 *
 * THE SPLIT WAS WIDENED. It shipped at 10 u and 7.5 u wide, which is a 33% difference in the one
 * dimension that tells the two racks apart, on objects 20-odd units long moving at 300 u/s. The
 * lengths already differed and the widths were doing almost nothing; short is now 13% fatter and
 * long 15% thinner, which is 80% between them. ONLY THE WIDTHS MOVED - the lengths are what say
 * "missile" at all, and they were already carrying their share.
 *
 * The reel icons are drawn to these same ratios (tools/make-icons.mjs). That matters more than it
 * sounds: the icon is where a player learns which silhouette is which, so an icon whose
 * proportions flatter the art is teaching the wrong thing.
 *
 * Non-uniform scale rather than two textures, because the alternative is a second 16x40 PNG that
 * differs from the first only in how wide it was drawn. That is a texture bind and a file to keep
 * in sync for a difference the GPU can make for free.
 */
export const MISSILE_SHORT_SCALE_X = MISSILE_SCALE * 1.3;
export const MISSILE_SHORT_SCALE_Y = MISSILE_SCALE * 0.9;
export const MISSILE_LONG_SCALE_X = MISSILE_SCALE * 0.72;
export const MISSILE_LONG_SCALE_Y = MISSILE_SCALE * 1.15;

/** Machine gun slug: drawn ~9 u long - small enough that a stream of them reads as a stream. */
const SLUG_SRC_H = 26;
const SLUG_DRAW_LEN = 9;
export const SLUG_SCALE = SLUG_DRAW_LEN / SLUG_SRC_H;

/**
 * The drone source is 64x64 at two pixels per world unit, so it is 32 world units of canvas - but
 * the machine inside it is the 13 u body plus its rotor discs, which is what the number below is
 * measured against. Drawn ~19 u across: bigger than a gem, comfortably smaller than a mech, and
 * large enough that the blue lens is still a lens on a phone.
 *
 * The MACHINE fills about 51 of the source's 64 px - body plus the rotor discs at the corners - so
 * the drawn width below is canvas, and the drone itself comes out around four fifths of it. At 26
 * that is a ~21 u machine against the mech's 52: clearly smaller, and still large enough that the
 * four rotors and the blue lens are separate things on a phone rather than one dark blob.
 *
 * Kept in step with tools/make-drone.mjs by hand, like every other sprite constant here.
 */
const DRONE_SRC_W = 64;
const DRONE_DRAW_W = 26;
export const DRONE_SCALE = DRONE_DRAW_W / DRONE_SRC_W;

/** Gem `spaceParts_035` is 32x63; drawn ~18 u tall. */
const GEM_SRC_H = 63;
const GEM_DRAW_H = 18;
export const GEM_SCALE = GEM_DRAW_H / GEM_SRC_H;

/**
 * Puff frames grow 21 -> 50 px. A CONSTANT scale across the sequence is what makes the puff
 * expand: the growth is baked into the art, so applying a per-frame scale would double it.
 * 50 px * 0.68 = 34 u at the last frame, which is grunt-sized; effects scale from there.
 */
export const PUFF_SCALE = 0.68;
export const PUFF_FRAME_COUNT = 7;
/** ASSET_MANIFEST §3.4: ~60 ms per frame, alpha fading over the last 3. */
export const PUFF_FRAME_SEC = 0.06;

/** All five particles are 512x512. Effects express size in world units and divide by this. */
export const PARTICLE_SRC = 512;

/**
 * Muzzle flash anchor. 452/512 puts the flame ROOT on the barrel tip rather than its centre,
 * measured from the strong-alpha row span y=134..452 (ASSET_MANIFEST §3.1).
 */
export const MUZZLE_ANCHOR_Y = 0.883;

/** Gem tint per tier (0..4). `spaceParts_035` is verified pure greyscale, so tint is clean. */
export const GEM_TINT: readonly number[] = [0x4fd1ff, 0x6fe36f, 0xc77bff, 0xffd34f, 0xff7ad9];

/**
 * Ground tile size, world units. PACKAGE A raised it from 64 to 512: `npm run floor` bakes an 8x8
 * patchwork of the pack's two plain rust tiles into one seamless texture, so the ground repeats
 * every 512 units instead of every 64. Seam measured at a worst-case channel delta of 7 out of
 * 255, which is invisible - the tool prints it on every bake.
 */
export const FLOOR_TILE_UNITS = 512;

/**
 * PACKAGE B: how many `cover_*` pieces prepare_assets vendors. Only referenced here and by the
 * texture loader, so removing the package is removing three lines.
 */
export const GROUND_COVER_VARIANTS = 8;

// ---------------------------------------------------------------------------------------------
// THE PERIMETER FENCE. These three restate the layout tools/make-fence.mjs draws to, and the two
// files have to be edited together: the texture is authored at 2 px per world unit, and the sprite
// is placed by these numbers rather than by the texture's own size.
// ---------------------------------------------------------------------------------------------
/** Repeat length along the run. One tile is four panels and covers most of a screen width. */
export const FENCE_TILE_UNITS = 256;
/** How far the strip reaches INSIDE ARENA_HALF: the shadow, and the junk drifted at the foot. */
export const FENCE_INNER_UNITS = 16;
/** How far it reaches OUTSIDE: structure, then dead ground fading to VOID. */
export const FENCE_OUTER_UNITS = 112;
/**
 * THE GROUND OUTSIDE THE FENCE IS STILL GROUND.
 *
 * It was an opaque near-black for a while, and that was wrong: the yard sat in a void, and a
 * barren place with nothing at all beyond its fence reads as the edge of a level rather than as
 * somewhere. The floor tile already covers the whole viewport, so all the exterior needs is to be
 * visibly OUTSIDE - dimmer and colder, not absent.
 *
 * So this is a WASH, not a fill: the same dark tone at `OUTSIDE_ALPHA` over the ground, which
 * leaves the rust and the tile pattern legible underneath while putting the yard unmistakably in
 * the light. The strip's own gradient in make-fence.mjs fades to exactly this and no further, so
 * the two meet without a band.
 */
export const OUTSIDE_COLOUR = 0x140f09;
export const OUTSIDE_ALPHA = 0.55;

/**
 * Scrap piles are drawn on a 192 px canvas at 2 px per world unit, so the art fills a 96 u radius
 * (tools/make-scrap.mjs). The sim rolls each pile's radius independently, and the renderer scales
 * by `radius / SCRAP_SRC_RADIUS` - so the sprite is always exactly as big as the circle the
 * simulation is colliding against, and a pile never lies about how far around it you have to walk.
 */
export const SCRAP_SRC_RADIUS = 96;

/**
 * Consumables are drawn on a 96 px canvas and want to sit at about 38 world units - a shade bigger
 * than the 34 u pickup radius, so the thing you can see is very slightly more generous than the
 * thing you have to touch. Nobody ever complained that a pickup was too easy to grab; the reverse
 * is the complaint.
 */
export const CONSUMABLE_SCALE = 38 / 96;
/**
 * THE CHEST IS DRAWN BIGGER THAN THE OTHER DROPS, and deliberately so: it is the reward a whole
 * boss fight was for, and it spent its entire life so far being drawn as a single COIN - the
 * smallest thing in the game - because the pickup renderer had no branch for it.
 */
export const CHEST_SCALE = 54 / 96;

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

export interface GameTextures {
  /** Body layer, indexed by HERO_CATALOG position, resolved through each hero's `sprite` key. */
  readonly mechs: readonly Texture[];
  /**
   * Ground shadow, indexed by HERO_CATALOG position. One static texture per chassis, drawn on a
   * sprite the renderer never rotates - unlike the body and legs, a shadow's screen direction has
   * to stay put regardless of which way the chassis is facing.
   */
  readonly mechShadows: readonly Texture[];
  /**
   * Leg layer: `[heroIndex][frame]`, MECH_WALK_FRAMES frames covering HALF a gait cycle. The
   * renderer plays them forwards then again mirrored vertically, because a walker at phase
   * `phi + pi` is itself at `phi` with its legs exchanged - and every chassis is drawn mirrored
   * about its own centreline, so exchanging the legs is exactly a vertical flip.
   */
  readonly mechLegs: readonly (readonly Texture[])[];
  readonly turret: Texture;
  /** The Twin Mount's twin barrels - the Cannon's own sprite from tier 8 on. */
  readonly turretTwin: Texture;
  /** The Phase Cannon's mount - shorter than the Cannon's, drawn stacked above it. */
  readonly turretPhase: Texture;
  /** The Machine Gun's snout - the shortest of the three, top of the stack. */
  readonly turretMg: Texture;
  /**
   * Creature art by level id, each indexed by `EnemyPool.typeId` within THAT level's table.
   *
   * A MAP RATHER THAN ONE ARRAY, for the same reason `floors` is one: typeId 3 means a different
   * creature on each map, so there is no single array it could index. The renderer looks up
   * `world.level.id` once per run, not per enemy.
   */
  readonly creatures: ReadonlyMap<LevelId, LevelCreatureArt>;
  /**
   * Ground textures by their level's `floor` key. See `levelFloorKeys`.
   *
   * A MAP RATHER THAN A FIELD PER LEVEL, so the renderer looks one up by `world.level.floor` and
   * never learns how many levels exist.
   */
  readonly floors: ReadonlyMap<string, Texture>;
  /** Perimeter fence strip, tiled along each run. Repeat-wrapped, so it is kept out of any atlas. */
  readonly fence: Texture;
  /** Corner pillar, one per corner, capping the two runs that meet there. */
  readonly fencePost: Texture;
  /** Scrap piles, indexed by `Scenery.variant`. */
  readonly scrap: readonly Texture[];
  /** The cross set - PICKUP_KIND_REPAIR_CROSS. Twice the heal, a quarter of the spanners. */
  consSpannerCross: Texture;
  /** The spanner - PICKUP_KIND_REPAIR. */
  readonly consSpanner: Texture;
  /** Blue credit coins, indexed by the pickup's `tier`: single / small / large / bag. */
  readonly consCoin: readonly Texture[];
  /** The gem magnet - PICKUP_KIND_MAGNET. */
  readonly consMagnet: Texture;
  readonly consDice: Texture;
  /** PACKAGE B - ground cover. See src/render/groundCover.ts. */
  readonly cover: readonly Texture[];
  /** PACKAGE C - ground paths, INDEXED BY CONNECTIVITY MASK 1..15. See groundPaths.ts. */
  readonly pathByMask: readonly Texture[];
  readonly chest: Texture;
  readonly shell: Texture;
  readonly gem: Texture;
  readonly puff: readonly Texture[];
  readonly fxMuzzle: Texture;
  readonly fxFlash: Texture;
  readonly fxBurst: Texture;
  readonly fxSparkle: Texture;
  readonly fxTrail: Texture;
  /** Missile body, indexed by WeaponDef.visualId === 1. */
  readonly missile: Texture;
  /** Machine gun round, visualId === 2. */
  readonly slug: Texture;
  /** The drone, drawn by `npm run drone`. Circular on purpose - see tools/make-drone.mjs. */
  readonly drone: Texture;
  /**
   * THE TWO FLAME POSES a burning body wears. Kenney particles, baked by `npm run plasma`.
   *
   * TWO FILES, FOUR FRAMES: the renderer mirrors both horizontally for the other two poses. See
   * tools/make-plasma.mjs.
   */
  readonly burn: readonly Texture[];

  /**
   * THE ARCS ON A SLOWED BODY. Four white branching sparks, tinted per draw - see make-plasma for
   * why these are Kenney's rather than the DCSS zaps that look more like lightning.
   */
  readonly zap: readonly Texture[];
  /** The Plasma Thrower's bolt, and the heat around it. Also `npm run plasma`. */
  readonly gout: Texture;
  readonly goutHaze: Texture;
  /** THE ENERGY SHIELD'S BODY: three sweeping arcs, played as a loop. Also `npm run plasma`. */
  readonly twirl: readonly Texture[];
  /**
   * MOSSY MAYHEM'S WALL SEGMENTS. Four sets, all baked by `npm run walls`.
   *
   * `wallTiles` is the 4x4 AUTOTILE, indexed `row * 4 + col`, where the two indices are the ones
   * the neighbour test in `dressingMoss.ts` already produced - cols 0/1/2 and rows 0/1/2 are the
   * edges and middle, and col/row 3 are the thin one-cell-wide and one-cell-tall variants. Order
   * is the sheet's, so there is no lookup table between the test and the texture.
   */
  readonly wallTiles: readonly Texture[];
  /** Cliff faces, drawn under any cell with nothing below it. Four, so a long edge does not repeat. */
  readonly wallFaces: readonly Texture[];
  /** The destructible variety, standing. */
  /**
   * The trees, as SWAY CYCLES: `wallTrees[variant][frame]`, `SWAY_FRAMES` long.
   *
   * Every frame of one variant is a window onto the SAME strip PNG, so it is one TextureSource per
   * tree however many frames are on screen. That is not tidiness - the wood is phase-staggered per
   * cell (a forest that sways in lockstep reads as a chorus line), so at any instant a screenful is
   * showing most of the eight frames at once. As eight separate files that would be eight sources
   * per variant interleaved down the draw order and a shredded batch; as windows onto one strip it
   * stays three sources for the whole wood.
   */
  readonly wallTrees: readonly (readonly Texture[])[];
  /** Undergrowth, same shape and for the same reason: `wallBushes[variant][frame]`. */
  readonly wallBushes: readonly (readonly Texture[])[];
  /** The same trees felled. Index-paired with `wallTrees`: stump N is tree N cut down. */
  readonly wallStumps: readonly Texture[];
  /**
   * CITY CHAOS'S TERRAIN, drawn by `npm run citywalls` (tools/make-city-walls.mjs).
   *
   * `cityRoofTiles` is the same 4x4 autotile scheme as `wallTiles` - indexed `row * 4 + col`
   * off the same neighbour test, run by `dressingCity.ts`. The rest are what the road grid
   * needs: asphalt and its painted line, the site fences in both runs, the piles and the rubble
   * they become, and the props scattered on roofs.
   */
  readonly cityRoofTiles: readonly Texture[];
  readonly cityFaces: readonly Texture[];
  readonly cityRoad: Texture;
  readonly cityRoadDash: Texture;
  /**
   * The site fences, one piece per N/E/S/W neighbour mask like the scrap paths' `path_1..15`,
   * times CITY_FENCE_VARIANTS board variants. Indexed `(mask - 1) * CITY_FENCE_VARIANTS + v`;
   * there is no mask-0 entry because an isolated breakable cell draws as a material pile.
   */
  readonly cityFence: readonly Texture[];
  readonly cityPiles: readonly Texture[];
  readonly cityRubble: readonly Texture[];
  /** Site-litter ground decals, scattered over construction blocks. Art only; nothing collides. */
  readonly cityLitter: readonly Texture[];
  /** The traffic cone, standing and knocked over. Same deal: dressing, not scenery. */
  readonly cityCones: readonly Texture[];
  readonly cityRoofProps: readonly Texture[];
  /**
   * THE FLOCK, as two cycles: heads down and walking. One TextureSource each, for the reason the
   * trees have one - a field of sheep is phase-staggered by necessity, so a screenful shows most
   * of a cycle's frames at once. See tools/make-sheep.mjs.
   */
  readonly sheepGraze: readonly Texture[];
  readonly sheepWalk: readonly Texture[];
}

/** How many pieces each of the four wall sets has. See tools/make-moss-walls.mjs. */
export const WALL_TILE_COUNT = 16;
export const WALL_FACE_COUNT = 4;
export const WALL_TREE_COUNT = 3;
export const WALL_BUSH_COUNT = 4;
/** How many pieces each city set has. See tools/make-city-walls.mjs. */
export const CITY_FACE_COUNT = 4;
export const CITY_FENCE_VARIANTS = 2;
export const CITY_PILE_COUNT = 4;
export const CITY_RUBBLE_COUNT = 2;
export const CITY_LITTER_COUNT = 5;
export const CITY_CONE_COUNT = 2;
export const CITY_ROOF_PROP_COUNT = 3;
/**
 * Frames in the sheep's two cycles. MUST match the sheets in tools/make-sheep.mjs - which are the
 * pack's own frame counts, not a choice this project made.
 */
export const SHEEP_GRAZE_FRAMES = 12;
export const SHEEP_WALK_FRAMES = 4;
/**
 * Frames in a foliage sway cycle. MUST match `SWAY_FRAMES` in tools/make-moss-walls.mjs: the strip
 * is a plain PNG with nothing in it that says how many columns it has, so this number is the only
 * thing that knows, and a mismatch silently draws slivers of two frames at once.
 */
export const SWAY_FRAMES = 8;

/**
 * Height of a cliff-face texture as a fraction of a wall cell. The tool crops the bottom 36 of the
 * sheet's 64 px, and the renderer has to know how tall the result is to place it under a cell.
 * Derived from the same two numbers rather than measured off the texture, so the two cannot drift.
 */
export const WALL_FACE_FRACTION = 36 / 64;

/**
 * A sprite name -> data: URI map, injected by tools/inline_build.mjs for the single-file build.
 *
 * Absent in every normal build, where sprites are fetched as ordinary files. It exists because a
 * single-file share target runs under a CSP that blocks all external requests, so the textures
 * have to arrive inside the document itself.
 */
declare global {
  // eslint-disable-next-line no-var
  var __SPRITE_DATA__: Record<string, string> | undefined;
}

/** Where prepare_assets.mjs put the sprites, honouring Vite's configured base path. */
/**
 * URL for a sprite by atlas key.
 *
 * EXPORTED, and every consumer must use it. The single-file share build has no `sprites/`
 * directory at all - `tools/inline_build.mjs` folds all 79 assets into `__SPRITE_DATA__` as data:
 * URIs - so anything that builds `sprites/<name>.png` by hand renders nothing in the artifact
 * while working perfectly on the dev server. The hero-select grid did exactly that, and shipped
 * eight broken images to every player who opened the shared link.
 */
export function spriteUrl(name: string): string {
  const inlined = globalThis.__SPRITE_DATA__;
  if (inlined !== undefined) {
    const uri = inlined[name];
    // Fall through to the normal URL when a name is missing rather than loading `undefined`:
    // one absent sprite should be one missing texture, not a failed boot.
    if (uri !== undefined) return uri;
  }
  const base = import.meta.env.BASE_URL || './';
  return `${base.endsWith('/') ? base : `${base}/`}sprites/${name}.png`;
}

/**
 * Loads every texture the game can draw, in one batch.
 *
 * `Assets.load` with an array resolves them in parallel and returns a keyed record - the v8
 * loader API. There is no `PIXI.Loader` fallback path in v8.
 */
export async function loadGameTextures(
  onProgress?: (fraction: number) => void,
): Promise<GameTextures> {
  // LOAD TEXTURES THROUGH `Image`, NOT WORKERS OR `fetch`. Pixi's default path is blocked twice
  // over inside a sandboxed embed, and both failures hang rather than throw:
  //
  //   preferWorkers        decodes in a worker built from a `blob:` URL. Without `worker-src
  //                        blob:` the worker is refused and `isImageBitmapSupported()` awaits a
  //                        handshake that never arrives.
  //   preferCreateImageBitmap
  //                        falls back to `fetch(url)` even for a `data:` URI, which `connect-src`
  //                        governs - and a strict embed sets `connect-src 'none'`.
  //
  // Turning both off takes the `new Image(); img.src = url` path, which is governed by `img-src`
  // and is the most permissively treated way to get pixels into a page. Neither failure surfaced
  // as a rejection: the loader simply never settled, progress sat at 0, and it looked exactly
  // like a slow network. That is why this is pinned rather than left to the defaults.
  //
  // Cost is a few ms per sprite across the 71 we load, on a decode that happens once at boot.
  Assets.setPreferences({ preferWorkers: false, preferCreateImageBitmap: false });

  const keys: string[] = [];

  const mechKeys = HERO_CATALOG.map((h) => h.sprite);
  // The eight heroes reference only four hues x two finishes, and two heroes could in principle
  // share a sprite key, so de-duplicate before asking the loader for them.
  for (const k of new Set(mechKeys)) {
    keys.push(k, `${k}_shadow`);
    for (let f = 0; f < MECH_WALK_FRAMES; f++) keys.push(`${k}_w${f}`);
  }
  keys.push('turret', 'turret_twin', 'turret_phase', 'turret_mg');

  // EVERY LEVEL'S CREATURES, from the level catalog rather than from a global enemy table. There
  // is no global enemy table any more: each level owns its own, and adding a level's creatures is
  // a row in its own content file with nothing to remember here.
  for (const level of LEVEL_CATALOG) {
    for (const key of creatureSpriteKeys(level.creatures)) keys.push(key);
    // The boss outline sprites, where the level bakes them. Empty for a level whose rule reuses
    // the body texture, so this adds nothing to the Scrapyard's load.
    for (const key of creatureRimKeys(level.id, level.creatures)) keys.push(key);
  }

  keys.push('fence', 'fence_post', 'shell', 'missile', 'slug', 'gem', 'drone');
  // ONE GROUND TEXTURE PER LEVEL, taken from the level catalog rather than listed here. Adding a
  // level's floor is then a row in `LEVEL_CATALOG` and a row in `tools/make-floor.mjs`, with
  // nothing to remember in the renderer - which is the whole reason the key lives on the level.
  for (const key of levelFloorKeys()) keys.push(key);
  for (let i = 0; i < SCENERY_VARIANTS; i++) keys.push(`scrap_${i}`);
  keys.push('cons_spanner', 'cons_spanner_cross', 'cons_magnet', 'cons_dice', 'chest');
  // PACKAGE B. Remove this line and the `cover` field with the layer.
  for (let i = 0; i < GROUND_COVER_VARIANTS; i++) keys.push(`cover_${i}`);
  // PACKAGE C. Masks 1..15; there is no `path_0` because an empty cell draws nothing.
  for (let m = 1; m <= 15; m++) keys.push(`path_${m}`);
  for (let i = 0; i < 4; i++) keys.push(`cons_coin${i}`);
  for (let i = 0; i < PUFF_FRAME_COUNT; i++) keys.push(`puff_${i}`);
  keys.push('fx_muzzle', 'fx_flash', 'fx_burst', 'fx_sparkle', 'fx_trail');
  keys.push('burn_0', 'burn_1', 'gout', 'gout_haze');
  keys.push('zap_0', 'zap_1', 'zap_2', 'zap_3');
  keys.push('twirl_0', 'twirl_1', 'twirl_2');
  // Mossy Mayhem's walls. `mwall_t<col><row>` is the autotile; see GameTextures.wallTiles.
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) keys.push(`mwall_t${col}${row}`);
  }
  for (let i = 0; i < WALL_FACE_COUNT; i++) keys.push(`mwall_face${i}`);
  for (let i = 0; i < WALL_TREE_COUNT; i++) keys.push(`mwall_tree${i}`, `mwall_stump${i}`);
  for (let i = 0; i < WALL_BUSH_COUNT; i++) keys.push(`mwall_bush${i}`);
  keys.push('msheep_graze', 'msheep_walk');
  // City Chaos's terrain. `cwall_t<col><row>` is the roof autotile; see GameTextures.
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) keys.push(`cwall_t${col}${row}`);
  }
  for (let i = 0; i < CITY_FACE_COUNT; i++) keys.push(`cface${i}`);
  keys.push('croad', 'croad_dash');
  for (let m = 1; m <= 15; m++) {
    for (let v = 0; v < CITY_FENCE_VARIANTS; v++) keys.push(`cfence_m${m}_${v}`);
  }
  for (let i = 0; i < CITY_PILE_COUNT; i++) keys.push(`cpile${i}`);
  for (let i = 0; i < CITY_RUBBLE_COUNT; i++) keys.push(`crubble${i}`);
  for (let i = 0; i < CITY_LITTER_COUNT; i++) keys.push(`clitter${i}`);
  for (let i = 0; i < CITY_CONE_COUNT; i++) keys.push(`ccone${i}`);
  for (let i = 0; i < CITY_ROOF_PROP_COUNT; i++) keys.push(`croofprop${i}`);

  // `UnresolvedAsset` carries a `[key: string]: any` index signature, so an ARRAY of them also
  // satisfies the single-asset overload and TypeScript picks that one first. Naming the record
  // as the type parameter is what makes the multi-asset return type come out right; the runtime
  // behaviour (a record keyed by each asset's first alias) is unchanged.
  const loaded = await Assets.load<Record<string, Texture>>(
    keys.map((k) => ({ alias: k, src: spriteUrl(k) })),
    onProgress,
  );

  const get = (k: string): Texture => {
    const t = loaded[k];
    if (t === undefined) throw new Error(`assets: texture "${k}" failed to load`);
    return t;
  };

  // WebGL REPEAT wrapping needs a dedicated power-of-two texture; this is exactly why the floor
  // tile and the fence strip are kept OUT of any atlas (ASSET_MANIFEST gotcha 8).
  // Every level's floor, wrapped. A TilingSprite samples outside [0,1] and WebGL needs REPEAT on a
  // dedicated power-of-two texture to do it, which is why these stay out of any atlas.
  const floors = new Map<string, Texture>();
  for (const key of levelFloorKeys()) {
    const t = get(key);
    t.source.wrapMode = 'repeat';
    t.source.scaleMode = 'linear';
    floors.set(key, t);
  }

  const fence = get('fence');
  fence.source.wrapMode = 'repeat';
  fence.source.scaleMode = 'linear';

  // Smooth vector-derived art, upscaled. Linear + mipmaps; NEAREST would look worse, not
  // crisper (ASSET_MANIFEST gotcha 6).
  for (const k of keys) {
    if (k === 'fence' || floors.has(k)) continue;
    get(k).source.scaleMode = 'linear';
  }

  const creatures = new Map<LevelId, LevelCreatureArt>();
  for (const level of LEVEL_CATALOG) {
    creatures.set(level.id, buildCreatureArt(level.id, level.creatures, get));
  }

  const puff: Texture[] = [];
  for (let i = 0; i < PUFF_FRAME_COUNT; i++) puff.push(get(`puff_${i}`));

  return {
    mechs: HERO_CATALOG.map((h) => get(h.sprite)),
    mechShadows: HERO_CATALOG.map((h) => get(`${h.sprite}_shadow`)),
    mechLegs: HERO_CATALOG.map((h) =>
      Array.from({ length: MECH_WALK_FRAMES }, (_, f) => get(`${h.sprite}_w${f}`)),
    ),
    turret: get('turret'),
    turretTwin: get('turret_twin'),
    turretPhase: get('turret_phase'),
    turretMg: get('turret_mg'),
    drone: get('drone'),
    // `row * 4 + col`, matching the neighbour test that produces the two indices.
    wallTiles: Array.from({ length: WALL_TILE_COUNT }, (_, i) =>
      get(`mwall_t${i % 4}${Math.floor(i / 4)}`),
    ),
    wallFaces: Array.from({ length: WALL_FACE_COUNT }, (_, i) => get(`mwall_face${i}`)),
    wallTrees: Array.from({ length: WALL_TREE_COUNT }, (_, i) => sway(get(`mwall_tree${i}`))),
    wallBushes: Array.from({ length: WALL_BUSH_COUNT }, (_, i) => sway(get(`mwall_bush${i}`))),
    wallStumps: Array.from({ length: WALL_TREE_COUNT }, (_, i) => get(`mwall_stump${i}`)),
    cityRoofTiles: Array.from({ length: WALL_TILE_COUNT }, (_, i) =>
      get(`cwall_t${i % 4}${Math.floor(i / 4)}`),
    ),
    cityFaces: Array.from({ length: CITY_FACE_COUNT }, (_, i) => get(`cface${i}`)),
    cityRoad: get('croad'),
    cityRoadDash: get('croad_dash'),
    cityFence: Array.from({ length: 15 * CITY_FENCE_VARIANTS }, (_, i) =>
      get(`cfence_m${Math.floor(i / CITY_FENCE_VARIANTS) + 1}_${i % CITY_FENCE_VARIANTS}`),
    ),
    cityPiles: Array.from({ length: CITY_PILE_COUNT }, (_, i) => get(`cpile${i}`)),
    cityRubble: Array.from({ length: CITY_RUBBLE_COUNT }, (_, i) => get(`crubble${i}`)),
    cityLitter: Array.from({ length: CITY_LITTER_COUNT }, (_, i) => get(`clitter${i}`)),
    cityCones: Array.from({ length: CITY_CONE_COUNT }, (_, i) => get(`ccone${i}`)),
    cityRoofProps: Array.from({ length: CITY_ROOF_PROP_COUNT }, (_, i) => get(`croofprop${i}`)),
    sheepGraze: cutStrip(get('msheep_graze'), SHEEP_GRAZE_FRAMES),
    sheepWalk: cutStrip(get('msheep_walk'), SHEEP_WALK_FRAMES),
    creatures,
    floors,
    fence,
    fencePost: get('fence_post'),
    scrap: Array.from({ length: SCENERY_VARIANTS }, (_, i) => get(`scrap_${i}`)),
    consSpanner: get('cons_spanner'),
    consSpannerCross: get('cons_spanner_cross'),
    consCoin: Array.from({ length: 4 }, (_, i) => get(`cons_coin${i}`)),
    consMagnet: get('cons_magnet'),
    consDice: get('cons_dice'),
    cover: Array.from({ length: GROUND_COVER_VARIANTS }, (_, i) => get(`cover_${i}`)),
    // Index 0 is a deliberate hole - a cell with no neighbours is not drawn - so the array can be
    // indexed by the mask directly with no arithmetic at the call site.
    pathByMask: Array.from({ length: 16 }, (_, m) => (m === 0 ? get('path_1') : get(`path_${m}`))),
    chest: get('chest'),
    shell: get('shell'),
    missile: get('missile'),
    slug: get('slug'),
    gem: get('gem'),
    puff,
    fxMuzzle: get('fx_muzzle'),
    fxFlash: get('fx_flash'),
    fxBurst: get('fx_burst'),
    fxSparkle: get('fx_sparkle'),
    fxTrail: get('fx_trail'),
    burn: [get('burn_0'), get('burn_1')],
    zap: [get('zap_0'), get('zap_1'), get('zap_2'), get('zap_3')],
    gout: get('gout'),
    goutHaze: get('gout_haze'),
    twirl: [get('twirl_0'), get('twirl_1'), get('twirl_2')],
  };
}

/**
 * Warms the browser cache for every reel symbol.
 *
 * SPRITE KEYS, NOT UPGRADE IDS. It used to prepend `icon_` itself, which made "every symbol the
 * chest can show is an upgrade" an assumption baked into three separate places - and it is not
 * true: a chest with nothing left to give lands on the salvage symbols, which are `cons_*`.
 *
 * THE ICONS ARE NOT IN THE ATLAS AND MUST NOT BE. They are drawn as DOM `<img>` by the level-up
 * card and the chest overlay - never by Pixi - so loading them as textures would pay for a second
 * copy on the GPU that nothing samples.
 *
 * But it left them COLD. The first Cyber Chest of a run builds ninety-odd tiles and asks the
 * browser for fourteen images it has never seen, all inside the frame the reels start spinning -
 * so the first spin of every run hitched while the first spin of every later chest did not. That
 * asymmetry is the tell, and it is why this is a preload rather than a rendering fix.
 *
 * Fire and forget: the Images are never added to the document and are held only so the decoded
 * bitmaps survive until something asks for them. A failure is silently fine - the icon simply
 * loads later, exactly as it did before.
 */
const iconCache: HTMLImageElement[] = [];

export function preloadUpgradeIcons(sprites: readonly string[]): void {
  if (iconCache.length > 0) return;
  for (const sprite of sprites) {
    const img = new Image();
    img.decoding = 'async';
    img.src = spriteUrl(sprite);
    iconCache.push(img);
  }
}
