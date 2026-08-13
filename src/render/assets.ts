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
import { ARCHETYPES, ENEMY_CATALOG, HERO_CATALOG } from '../core/index.js';

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

/** Player mech canvas. Non-square: the treads add height even though the long axis is x. */
export const MECH_SRC_W = 148;
/** Drawn chassis width in world units. Collision radius is 26 u = half of this. */
export const MECH_DRAW_W = 52;
export const MECH_SCALE = MECH_DRAW_W / MECH_SRC_W; // 0.35135

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
// Loading
// ---------------------------------------------------------------------------------------------

export interface GameTextures {
  /** Indexed by HERO_CATALOG position, resolved through each hero's `sprite` key. */
  readonly mechs: readonly Texture[];
  /** Indexed by EnemyPool.typeId (0..47). */
  readonly enemies: readonly Texture[];
  /** Sprite scale for each typeId, so the CONTENT measures the archetype's drawSize. */
  readonly enemyScale: Float32Array;
  readonly floor: Texture;
  readonly shell: Texture;
  readonly gem: Texture;
  readonly puff: readonly Texture[];
  readonly fxMuzzle: Texture;
  readonly fxFlash: Texture;
  readonly fxBurst: Texture;
  readonly fxSparkle: Texture;
  readonly fxTrail: Texture;
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
function spriteUrl(name: string): string {
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
  const keys: string[] = [];

  const mechKeys = HERO_CATALOG.map((h) => h.sprite);
  // The eight heroes reference only four hues x two finishes, and two heroes could in principle
  // share a sprite key, so de-duplicate before asking the loader for them.
  for (const k of new Set(mechKeys)) keys.push(k);

  for (const def of ENEMY_CATALOG) keys.push(def.sprite);

  keys.push('floor', 'shell', 'gem');
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

  const floor = get('floor');
  // WebGL REPEAT wrapping needs a dedicated power-of-two texture; this is exactly why the floor
  // tile is kept OUT of any atlas (ASSET_MANIFEST gotcha 8).
  floor.source.wrapMode = 'repeat';
  floor.source.scaleMode = 'linear';

  // Smooth vector-derived art, upscaled. Linear + mipmaps; NEAREST would look worse, not
  // crisper (ASSET_MANIFEST gotcha 6).
  for (const k of keys) {
    if (k === 'floor') continue;
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
    enemies,
    enemyScale,
    floor,
    shell: get('shell'),
    gem: get('gem'),
    puff,
    fxMuzzle: get('fx_muzzle'),
    fxFlash: get('fx_flash'),
    fxBurst: get('fx_burst'),
    fxSparkle: get('fx_sparkle'),
    fxTrail: get('fx_trail'),
  };
}

/**
 * Draw size for the boss, which reuses `enemy_46` (hull 10) at 112 u - the only sprite reuse in
 * the game. Exposed so the enemy draw path can special-case it off ENEMY_FLAG_BOSS without
 * reaching back into the catalog.
 */
export function bossScale(): number {
  const boss = ARCHETYPES[4];
  return boss.drawSize / (HULL_CONTENT_PX[9] * ENEMY_RETINA_FACTOR);
}
