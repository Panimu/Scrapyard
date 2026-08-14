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

import { Assets, Texture } from 'pixi.js';
import { ARCHETYPES, ENEMY_CATALOG, HERO_CATALOG, SCENERY_VARIANTS } from '../core/index.js';

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
export const MECH_WALK_FRAMES = 4;

/** Turret canvas (tools/make-mechs.mjs), and its drawn length in world units. */
export const TURRET_SRC_W = 80;
export const TURRET_DRAW_W = 42;
export const TURRET_SCALE = TURRET_DRAW_W / TURRET_SRC_W;

/** Muzzle emits at +24 u along facing - the front lip of the 52 u chassis. */
export const MUZZLE_OFFSET = 24;

/**
 * Largest content dimension of each enemy hull, in DEFAULT-size pixels, indexed by `hull - 1`.
 * Straight from the measured bbox table in ASSET_MANIFEST §2.
 *
 * This table is why the renderer does not simply scale the 64 px canvas to `drawSize`: a swarmer
 * is 16x24 px of art inside a 64x64 canvas, so canvas-scaling would draw a 26 u swarmer as a
 * 6.5 u speck inside its own 26 u collision circle. We scale so the CONTENT measures `drawSize`.
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
 * Short is SQUAT AND FAT, long is LONGER AND THINNER, and the pair is deliberately modest: about
 * 20 u x 10 u against 25 u x 7.5 u. Enough that a screen carrying both volleys reads as two
 * weapons rather than one, small enough that neither stops looking like a missile - the source
 * art is a single body with a nose and fins, and pushing the aspect much further turns one of
 * them into a dart and the other into a barrel.
 *
 * Non-uniform scale rather than two textures, because the alternative is a second 16x40 PNG that
 * differs from the first only in how wide it was drawn. That is a texture bind and a file to keep
 * in sync for a difference the GPU can make for free.
 */
export const MISSILE_SHORT_SCALE_X = MISSILE_SCALE * 1.15;
export const MISSILE_SHORT_SCALE_Y = MISSILE_SCALE * 0.9;
export const MISSILE_LONG_SCALE_X = MISSILE_SCALE * 0.85;
export const MISSILE_LONG_SCALE_Y = MISSILE_SCALE * 1.15;

/** Machine gun slug: drawn ~9 u long - small enough that a stream of them reads as a stream. */
const SLUG_SRC_H = 26;
const SLUG_DRAW_LEN = 9;
export const SLUG_SCALE = SLUG_DRAW_LEN / SLUG_SRC_H;

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

/** Ground tile is 64x64 and seamless on both axes (wrap delta measured at exactly 0.00). */
export const FLOOR_TILE_UNITS = 64;

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
 * The colour beyond the fence, and it MUST equal the value the texture's gradient ends on
 * (`VOID` in make-fence.mjs). The renderer floods the whole exterior with it and the strip fades
 * into it; a mismatch of even one step draws a visible band along all four runs.
 */
export const VOID_COLOUR = 0x151109;

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

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

export interface GameTextures {
  /** Body layer, indexed by HERO_CATALOG position, resolved through each hero's `sprite` key. */
  readonly mechs: readonly Texture[];
  /**
   * Leg layer: `[heroIndex][frame]`, MECH_WALK_FRAMES frames covering HALF a gait cycle. The
   * renderer plays them forwards then again mirrored vertically, because a walker at phase
   * `phi + pi` is itself at `phi` with its legs exchanged - and every chassis is drawn mirrored
   * about its own centreline, so exchanging the legs is exactly a vertical flip.
   */
  readonly mechLegs: readonly (readonly Texture[])[];
  readonly turret: Texture;
  /** Indexed by EnemyPool.typeId (0..47). */
  readonly enemies: readonly Texture[];
  /** Sprite scale for each typeId, so the CONTENT measures the archetype's drawSize. */
  readonly enemyScale: Float32Array;
  readonly floor: Texture;
  /** Perimeter fence strip, tiled along each run. Repeat-wrapped, so it is kept out of any atlas. */
  readonly fence: Texture;
  /** Corner pillar, one per corner, capping the two runs that meet there. */
  readonly fencePost: Texture;
  /** Scrap piles, indexed by `Scenery.variant`. */
  readonly scrap: readonly Texture[];
  /** The spanner - PICKUP_KIND_REPAIR. */
  readonly consSpanner: Texture;
  /** Blue credit coins, indexed by the pickup's `tier`: single / small / large / bag. */
  readonly consCoin: readonly Texture[];
  /** The gem magnet - PICKUP_KIND_MAGNET. */
  readonly consMagnet: Texture;
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
}

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
    keys.push(k);
    for (let f = 0; f < MECH_WALK_FRAMES; f++) keys.push(`${k}_w${f}`);
  }
  keys.push('turret');

  for (const def of ENEMY_CATALOG) keys.push(def.sprite);

  keys.push('floor', 'fence', 'fence_post', 'shell', 'missile', 'slug', 'gem');
  for (let i = 0; i < SCENERY_VARIANTS; i++) keys.push(`scrap_${i}`);
  keys.push('cons_spanner', 'cons_magnet');
  for (let i = 0; i < 4; i++) keys.push(`cons_coin${i}`);
  for (let i = 0; i < PUFF_FRAME_COUNT; i++) keys.push(`puff_${i}`);
  keys.push('fx_muzzle', 'fx_flash', 'fx_burst', 'fx_sparkle', 'fx_trail');

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
  const floor = get('floor');
  floor.source.wrapMode = 'repeat';
  floor.source.scaleMode = 'linear';

  const fence = get('fence');
  fence.source.wrapMode = 'repeat';
  fence.source.scaleMode = 'linear';

  // Smooth vector-derived art, upscaled. Linear + mipmaps; NEAREST would look worse, not
  // crisper (ASSET_MANIFEST gotcha 6).
  for (const k of keys) {
    if (k === 'floor' || k === 'fence') continue;
    get(k).source.scaleMode = 'linear';
  }

  const enemies: Texture[] = [];
  const enemyScale = new Float32Array(ENEMY_CATALOG.length);
  for (let i = 0; i < ENEMY_CATALOG.length; i++) {
    const def = ENEMY_CATALOG[i];
    enemies.push(get(def.sprite));
    enemyScale[i] = def.drawSize / (HULL_CONTENT_PX[def.hull - 1] * ENEMY_RETINA_FACTOR);
  }

  const puff: Texture[] = [];
  for (let i = 0; i < PUFF_FRAME_COUNT; i++) puff.push(get(`puff_${i}`));

  return {
    mechs: HERO_CATALOG.map((h) => get(h.sprite)),
    mechLegs: HERO_CATALOG.map((h) =>
      Array.from({ length: MECH_WALK_FRAMES }, (_, f) => get(`${h.sprite}_w${f}`)),
    ),
    turret: get('turret'),
    enemies,
    enemyScale,
    floor,
    fence,
    fencePost: get('fence_post'),
    scrap: Array.from({ length: SCENERY_VARIANTS }, (_, i) => get(`scrap_${i}`)),
    consSpanner: get('cons_spanner'),
    consCoin: Array.from({ length: 4 }, (_, i) => get(`cons_coin${i}`)),
    consMagnet: get('cons_magnet'),
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
  };
}

