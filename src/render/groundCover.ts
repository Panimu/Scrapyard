/**
 * PACKAGE B - GROUND COVER. Rocks and rubble scattered across the yard, purely to look at.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS, AND HOW TO REMOVE IT
 * ---------------------------------------------------------------------------------------------
 * A self-contained decoration layer. It owns its own sprite pool, its own textures (`cover_*`) and
 * its own placement rule, and NOTHING ELSE READS IT.
 *
 * TO REMOVE IT: delete this file, delete the three lines in gameRenderer.ts that construct it, add
 * it to the world container and call `draw`, and drop the `cover_*` entries from
 * tools/prepare_assets.mjs. There is nothing else - no core change, no save field, no tuning dial.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS NOT IN THE SIMULATION, AND THAT IS THE WHOLE DESIGN
 * ---------------------------------------------------------------------------------------------
 * Scenery lives in `src/core/content/scenery.ts` because it COLLIDES - the yard pushes bodies out
 * of it, so it has to be part of the deterministic world and part of the replay hash. A rock you
 * walk straight through does not, and putting it in core would mean a purely visual change to how
 * many rocks there are could alter a recorded run.
 *
 * So this generates itself render-side from the run's seed. Same seed, same rocks, on every device
 * and in every screenshot - without a single byte of it reaching `World`.
 *
 * ---------------------------------------------------------------------------------------------
 * NO STORAGE: THE YARD IS A PURE FUNCTION OF ITS CELL
 * ---------------------------------------------------------------------------------------------
 * The arena is 12 288 units square. Storing a scatter dense enough to be worth having would be
 * tens of thousands of entries, nearly all of them off screen forever.
 *
 * Instead the world is divided into CELLS, and what is in a cell is computed from a hash of its
 * coordinates and the seed, every frame, for the handful of cells the camera can see - about
 * twenty. A cell's contents therefore cost nothing to remember and cannot drift; walking away and
 * coming back re-derives exactly the same rocks, because there was never any state to lose.
 *
 * The hash is an integer mix rather than the core `Rng`: this runs per visible cell per frame, and
 * it must be seekable by coordinate rather than sequential. `Rng` is a stream, which is the wrong
 * shape for "what is at (x, y)" and would have to be re-seeded per cell to answer it.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY IT DOES NOT DROWN THE SCREEN
 * ---------------------------------------------------------------------------------------------
 * Three rules, all of them about staying out of the way of things that matter:
 *
 *   DIM AND SMALL. Every piece is tinted down and drawn under half a body's size. A rock as bright
 *     as a gem is a rock the player's eye keeps checking, and this screen already asks a lot of it.
 *   ONE PIECE PER CELL AT MOST, on a 320-unit lattice, which is about four visible at a time. Dense
 *     scatter reads as texture rather than as objects, and texture is what package A is for.
 *   NOTHING NEAR THE ORIGIN. A run opens on an empty patch of yard - the same reason scenery keeps
 *     a clear radius - so the first thing a player sees is the mech and not a boulder under it.
 */

import { Sprite, type Container, type Texture } from 'pixi.js';

import { SpritePool } from './spritePool.js';
import type { Camera } from './camera.js';

/** World units per cell. One rock per cell at most, so this IS the scatter density. */
const CELL = 190;
/** Cells kept clear around the origin, so a run does not open with a rock under the mech. */
const CLEAR_CELLS = 3;
/** Of the cells that could hold a rock, the fraction that do. */
const OCCUPANCY = 0.62;
/**
 * Drawn size range, world units. A bruiser is 28 across, so the biggest rocks are body-sized - but
 * they are dim, motionless and on the floor, which is what separates them from something to shoot.
 * At the first sizes tried (13-26) they were invisible: a rock has to be big enough to be a rock.
 */
const MIN_SIZE = 16;
const MAX_SIZE = 38;
/** Enough for the visible lattice several times over; the camera reaches ~500 u. */
const CAPACITY = 64;

/**
 * Multiplied into every piece. The pack art is lit for a bright RTS and lands too light and too
 * contrasty on this floor - unmodified, the grey boulders read as gems from the corner of the eye.
 */
const TINT = 0xb08a76;
const ALPHA = 0.85;

/**
 * A 32-bit integer hash of (x, y, seed). Three rounds of xor-shift and a multiply, which is enough
 * mixing that adjacent cells share no visible structure - the failure this replaces is a scatter
 * that lines up into rows because the hash was too weak in one axis.
 */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 0x1f1f1f1f) ^ (y * 0x8da6b343) ^ (seed * 0xd8163841);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** [0, 1) from one hash, taking a different slice of the bits per `k` so draws stay independent. */
function unit(h: number, k: number): number {
  return (((h >>> (k * 5)) ^ (h << (k * 3))) >>> 8) / 0x1000000;
}

export class GroundCover {
  readonly container: Container;
  private readonly pool: SpritePool;
  private readonly textures: readonly Texture[];
  private seed = 0;

  constructor(textures: readonly Texture[]) {
    this.textures = textures;
    this.pool = new SpritePool({ capacity: CAPACITY, label: 'ground-cover' });
    this.container = this.pool.container;
  }

  /** Called at the start of a run. The seed is the only thing that decides what the yard holds. */
  begin(seed: number): void {
    this.seed = seed | 0;
  }

  /**
   * Draws every piece the camera can see.
   *
   * NOT INTERPOLATED and not clocked: these do not move, do not bob and do not spin. Everything
   * else on this screen is alive, and the one way to make a rock read as scenery rather than as an
   * entity is to let it sit perfectly still.
   */
  draw(camera: Camera): void {
    const pool = this.pool;
    pool.begin();
    if (this.textures.length === 0) {
      pool.end();
      return;
    }

    // The cell range the view covers, plus a ring so a piece whose centre is just off screen still
    // draws its half that is on screen.
    const reach = Math.max(camera.halfW, camera.halfH) + MAX_SIZE;
    const x0 = Math.floor((camera.x - reach) / CELL);
    const x1 = Math.floor((camera.x + reach) / CELL);
    const y0 = Math.floor((camera.y - reach) / CELL);
    const y1 = Math.floor((camera.y + reach) / CELL);

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (Math.abs(cx) <= CLEAR_CELLS && Math.abs(cy) <= CLEAR_CELLS) continue;

        const h = hash(cx, cy, this.seed);
        if (unit(h, 0) >= OCCUPANCY) continue;

        // Placed anywhere in its cell rather than at the centre, or the lattice is visible.
        const x = cx * CELL + unit(h, 1) * CELL;
        const y = cy * CELL + unit(h, 2) * CELL;
        const size = MIN_SIZE + unit(h, 3) * (MAX_SIZE - MIN_SIZE);
        if (!camera.isVisible(x, y, size)) continue;

        const s = pool.acquire();
        if (s === undefined) break;
        const tex = this.textures[h % this.textures.length] ?? this.textures[0];
        s.texture = tex;
        s.anchor.set(0.5);
        s.position.set(x, y);
        // Rotation and mirror, so eight rocks from four textures never read as four rocks.
        s.rotation = Math.floor(unit(h, 4) * 4) * (Math.PI / 2);
        const scale = size / Math.max(tex.width, tex.height);
        s.scale.set(unit(h, 5) < 0.5 ? -scale : scale, scale);
        s.tint = TINT;
        s.alpha = ALPHA;
      }
    }

    pool.end();
  }
}

/** Kept beside the class so the renderer never has to know how a pool sprite is made. */
export type GroundCoverSprite = Sprite;
