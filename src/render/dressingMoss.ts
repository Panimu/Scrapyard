/**
 * MOSSY MAYHEM'S DRESSING: the wall segments, autotiled over whatever the camera can see.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SIMULATION OWNS THE LATTICE; THIS FILE ONLY LOOKS AT IT
 * ---------------------------------------------------------------------------------------------
 * `core/content/wallsMossy.ts` decides where every wall is and what it is made of. Nothing here
 * generates anything, caches anything, or writes to the world - it asks `wallKindAt` about the
 * cells on screen and picks a texture. That is the same line every other renderer in this codebase
 * keeps, and it matters more than usual here because the walls are COLLISION: a renderer that
 * derived its own layout would eventually draw a gap the mech cannot drive through.
 *
 * ---------------------------------------------------------------------------------------------
 * THE AUTOTILE IS A NEIGHBOUR TEST AND NOTHING MORE
 * ---------------------------------------------------------------------------------------------
 * Which of the sixteen pieces a cell draws depends only on which of its four orthogonal neighbours
 * are also wall:
 *
 *     cols 0,1,2 = left edge / middle / right edge      col 3 = a ONE-CELL-WIDE column
 *     rows 0,1,2 = top edge  / middle / bottom edge     row 3 = a ONE-CELL-TALL bar
 *     (3, 3)                                           = a lone block
 *
 * The thin variants are why this tileset was chosen: every shape the lattice deals is ONE CELL
 * THICK, and a tileset without them would need each wall doubled up to avoid drawing a rim down
 * the middle of it. This layout took a seam test to establish - the obvious reading is a 4x4 edge
 * set, which puts a visible border between every pair of adjacent cells.
 *
 * A DIAGONAL NEIGHBOUR IS NOT CONSULTED. The sheet has no inner-corner piece, so there is nothing
 * to draw differently if it were, and asking would only cost time.
 *
 * ---------------------------------------------------------------------------------------------
 * FOUR PASSES, AND THE ORDER IS THE WHOLE OF THE DEPTH SORTING
 * ---------------------------------------------------------------------------------------------
 *   1. tops    the grass surface of every wall cell
 *   2. faces   a cliff face under any cell with nothing below it, which is what gives a wall height
 *   3. stumps  where a tree has been felled
 *   4. trees   the standing ones
 *
 * Faces come after tops because a face hangs into the cell below its own, and that cell is empty by
 * definition - but a face belonging to the row above would otherwise be painted over by a top.
 * Trees come last and are iterated NORTH TO SOUTH so a southern tree overlaps a northern one, which
 * is the only depth cue overlapping canopies get.
 */

import { Container } from 'pixi.js';

import {
  WALL_CELL,
  WALL_EMPTY,
  WALL_TREE,
  isWallBroken,
  wallCellOf,
  wallKindAt,
  type MossWalls,
  type World,
} from '../core/index.js';
import {
  SWAY_FRAMES,
  WALL_BUSH_COUNT,
  WALL_FACE_FRACTION,
  WALL_TREE_COUNT,
  type GameTextures,
} from './assets.js';
import { SpritePool } from './spritePool.js';
import type { Camera } from './camera.js';
import type { LevelDressing } from './dressing.js';

/**
 * A TREED CELL IS A CLUMP, NOT A TREE.
 *
 * It used to be one 126-unit tree per cell, and the giveaway was exactly what you would expect: a
 * run of them read as a row of stamps on a 64-unit grid, because that is what it was. The cell is
 * still the collider and still takes one hit - nothing below changes what the simulation does - but
 * it now GROWS several smaller stems at hashed offsets, so the treeline's silhouette is ragged and
 * a wood looks like a wood.
 *
 * THE JITTER IS THE WHOLE DIAL, and it is set well short of what looks best in a still picture.
 * At +/- 0.29 of a cell the wood is beautiful and the WALL IS GONE: stems drift far enough that
 * clumps separate, the run reads as detached bushes, and a player walks confidently into a gap they
 * can see through. At +/- 0.25 the canopies still overlap their neighbours - which is the property
 * the old 126 number existed to guarantee - and the silhouette is still broken up. Mocked both
 * before picking.
 *
 * SIZED BY HEIGHT AGAINST THE MECH, not by width against the cell, and that was got wrong once
 * already: scaled to a fixed WIDTH the pack's trees came out 133-200 units tall depending on their
 * aspect, up to four times the 52-unit mech, which is the dwarfing this whole art pass exists to
 * avoid. Height is the dimension a player judges a tree by, so height is fixed and width follows
 * from the art - which is what keeps a pine narrow and a birch round.
 */
const STEM_HEIGHT = 76;
/** Stems per cell: `STEM_MIN` plus a hashed 0..2. Six at 76 u covers a cell with overlap to spare. */
const STEM_MIN = 4;
const STEM_SPAN = 3;
/** Total spread of a stem's base within its cell, as a fraction of one. Half of it either way. */
const STEM_SPREAD = 0.5;
/** Per-stem size jitter, so a clump is not one tree repeated. */
const STEM_SCALE_MIN = 0.8;
const STEM_SCALE_SPAN = 0.45;
/**
 * Where a clump sits in its cell, as a fraction from the cell's top. Not the bottom edge, which is
 * where the single tree was anchored: a clump has stems on both sides of this line, so anchoring at
 * the bottom would hang half of every cell's foliage into the cell below.
 */
const STEM_BASE_FRAC = 0.58;

/**
 * UNDERGROWTH. Two bushes tucked at the foot of every clump, inside its own cell.
 *
 * What they hide is the line where trunks meet the ground - a row of trunks standing on open moss
 * is the second giveaway that a treeline is a row of stamps, and no amount of scattering the
 * canopies fixes it.
 *
 * INSIDE THE CELL, NEVER OUTSIDE IT. Scattering bushes onto the open ground next to a wall looks
 * better still - it dissolves the boundary completely - and it is a promise the simulation does not
 * keep: nothing collides with a bush, so a fringe of them outside the wall is a band where a player
 * cannot tell terrain from decoration. Inside a treed cell the collider is already there and the
 * bush adds no claim at all.
 */
const BUSH_WIDTH = 34;
const BUSH_COUNT = 2;
/** Bush x spread within the cell, and where its band of y sits below the cell's middle. */
const BUSH_SPREAD = 0.9;
const BUSH_BASE_FRAC = 0.68;
const BUSH_BASE_SPAN = 0.3;

/**
 * SWAY. Ticks per frame of the eight-frame cycle, so a full sway is 56 ticks - a hair under a
 * second, which is a breeze rather than a gale.
 *
 * PHASED PER CELL. A wood where every tree reaches the same frame on the same tick is a chorus
 * line, and it is far more obviously wrong than no animation at all. The offset is the cell's own
 * hash, so it is stable as the camera moves and costs nothing to keep.
 *
 * THE CLOCK IS THE SIMULATION'S TICK, not a wall clock, for the same reason the Sporeling's gait
 * is: it is identical on every machine and across a replay, and it is read here and written back
 * nowhere.
 */
const SWAY_TICKS = 7;

/** Stumps are small. Well under a cell, so a felled tree visibly leaves a gap you can drive through. */
const STUMP_HEIGHT = 30;

/**
 * Sprite ceilings. The camera shows about 616 x 440 units - 10 x 7 cells - measured off the real
 * renderer, so 512 covers a screen entirely full of wall many times over. Running out costs one
 * missing tile rather than an allocation in the draw loop.
 */
const TOP_CAPACITY = 512;
const FACE_CAPACITY = 192;
/**
 * Raised from 192 with the clump. A treed cell now costs up to six stems plus two bushes instead of
 * one sprite, so a screen packed with wood needs eight times what it did. Running out is one
 * missing stem out of a clump, which is invisible - the old ceiling would have been a whole cell
 * of wood vanishing.
 */
const TREE_CAPACITY = 1536;

/**
 * Which tree a cell grows, and which face a wall shows. A hash of the cell, so it is stable as the
 * camera moves - picking at random per frame would make the wood flicker between variants.
 *
 * Deliberately NOT the simulation's hash: this decides nothing the simulation can see, and reusing
 * that one would tie the art to the terrain's stream for no benefit.
 */
/**
 * One 32-bit hash per cell, and everything a clump needs is squeezed out of it: how many stems,
 * which variants, where each one stands, how big it is, and the sway phase.
 *
 * ONE HASH RATHER THAN ONE PER QUESTION, because this runs for every treed cell on screen every
 * frame - a clump is up to eight sprites and there can be seventy cells in view. `stemFrac` slices
 * it rather than re-hashing.
 *
 * Deliberately NOT the simulation's hash: this decides nothing the simulation can see, and reusing
 * that one would tie the art to the terrain's stream for no benefit.
 */
function cellHash(cx: number, cy: number): number {
  let h = Math.imul(cx | 0, 0x27d4eb2f) ^ Math.imul(cy | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * A stable 0..1 for stem `k`'s question `q`, out of a cell's hash.
 *
 * Re-mixed rather than sliced straight out: the raw bits of one hash are far too correlated for
 * six stems' worth of positions, and taking them directly lined every clump's trunks up on a
 * diagonal. Cheap enough that it is fine in the draw loop - three multiplies.
 */
function stemFrac(h: number, k: number, q: number): number {
  let v = Math.imul(h ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(q + 7, 0x85ebca6b), 0xc2b2ae35);
  v ^= v >>> 16;
  v = Math.imul(v, 0x27d4eb2f);
  return ((v ^ (v >>> 15)) >>> 0) / 4294967296;
}

function variantOf(cx: number, cy: number, n: number): number {
  let h = Math.imul(cx | 0, 0x27d4eb2f) ^ Math.imul(cy | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) % n;
}

export class MossDressing implements LevelDressing {
  readonly container: Container;

  private readonly tex: GameTextures;
  private readonly tops: SpritePool;
  private readonly faces: SpritePool;
  private readonly stumps: SpritePool;
  private readonly trees: SpritePool;
  /** Scratch for the per-cell south-first stem sort. Preallocated: this runs per cell per frame. */
  private readonly stemOrder = new Int32Array(STEM_MIN + STEM_SPAN);

  constructor(tex: GameTextures) {
    this.tex = tex;
    this.container = new Container({ label: 'dressing-moss' });
    this.tops = new SpritePool({ capacity: TOP_CAPACITY, label: 'wall-tops' });
    this.faces = new SpritePool({ capacity: FACE_CAPACITY, label: 'wall-faces' });
    this.stumps = new SpritePool({ capacity: TREE_CAPACITY, label: 'wall-stumps' });
    this.trees = new SpritePool({ capacity: TREE_CAPACITY, label: 'wall-trees' });
    this.container.addChild(
      this.tops.container,
      this.faces.container,
      this.stumps.container,
      this.trees.container,
    );
  }

  begin(): void {
    // Nothing to seed. The lattice is a pure function of the run seed and the simulation holds it;
    // this dressing has no state of its own to reset, which is exactly the point of that split.
  }

  draw(camera: Camera, world: World): void {
    const tops = this.tops;
    const faces = this.faces;
    const stumps = this.stumps;
    const trees = this.trees;
    tops.begin();
    faces.begin();
    stumps.begin();
    trees.begin();

    const walls = world.scenery;
    if (walls.kind !== 'walls') {
      tops.end();
      faces.end();
      stumps.end();
      trees.end();
      return;
    }

    // One cell of margin on every side: a tree is wider than its cell and a face hangs below its
    // own, so a cell just off screen can still have art that reaches onto it.
    const c0 = wallCellOf(camera.x - camera.halfW) - 1;
    const c1 = wallCellOf(camera.x + camera.halfW) + 1;
    const r0 = wallCellOf(camera.y - camera.halfH) - 2;
    const r1 = wallCellOf(camera.y + camera.halfH) + 1;

    this.drawGround(walls, c0, c1, r0, r1);
    this.drawWood(walls, c0, c1, r0, r1, world.tick);

    tops.end();
    faces.end();
    stumps.end();
    trees.end();
  }

  /** Passes 1 and 2: the grass tops of every wall cell, and the cliff face under exposed edges. */
  private drawGround(walls: MossWalls, c0: number, c1: number, r0: number, r1: number): void {
    const faceH = WALL_CELL * WALL_FACE_FRACTION;

    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const kind = wallKindAt(walls, cx, cy);
        // A TREE HAS NO GROUND UNDER IT. Trees are the destructible variety and they stand on the
        // moss; giving them a grass plinth as well would make a felled one leave a square of
        // terrain behind that nothing collides with.
        if (kind === WALL_EMPTY || kind === WALL_TREE) continue;

        const left = wallKindAt(walls, cx - 1, cy) !== WALL_EMPTY;
        const right = wallKindAt(walls, cx + 1, cy) !== WALL_EMPTY;
        const up = wallKindAt(walls, cx, cy - 1) !== WALL_EMPTY;
        const down = wallKindAt(walls, cx, cy + 1) !== WALL_EMPTY;

        const col = !left && !right ? 3 : !left ? 0 : !right ? 2 : 1;
        const row = !up && !down ? 3 : !up ? 0 : !down ? 2 : 1;

        const top = this.tops.acquire();
        if (top !== undefined) {
          const t = this.tex.wallTiles[row * 4 + col];
          top.texture = t;
          top.anchor.set(0);
          top.position.set(cx * WALL_CELL, cy * WALL_CELL);
          top.scale.set(WALL_CELL / t.width, WALL_CELL / t.height);
          top.alpha = 1;
          top.tint = 0xffffff;
        }

        if (down) continue;
        const face = this.faces.acquire();
        if (face === undefined) continue;
        const f = this.tex.wallFaces[variantOf(cx, cy, this.tex.wallFaces.length)];
        face.texture = f;
        face.anchor.set(0);
        face.position.set(cx * WALL_CELL, (cy + 1) * WALL_CELL);
        face.scale.set(WALL_CELL / f.width, faceH / f.height);
        face.alpha = 1;
        face.tint = 0xffffff;
      }
    }
  }

  /**
   * Passes 3 and 4: felled stumps, then the standing wood and its undergrowth.
   *
   * Everything is anchored at BOTTOM CENTRE, because that is where a trunk meets the ground -
   * anchoring at the middle would bury half of every stem in the cell above.
   *
   * DEPTH IS DRAW ORDER, not zIndex. The cell loop already runs north to south, and within a cell
   * the stems are emitted in order of their own jittered y and the bushes last - a bush skirts the
   * FOOT of its clump, so it belongs in front of every stem in that cell and behind anything in the
   * cell below. That is the whole sort, and it costs a six-element insertion rather than a
   * sortable container.
   */
  private drawWood(walls: MossWalls, c0: number, c1: number, r0: number, r1: number, tick: number): void {
    const order = this.stemOrder;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const kind = wallKindAt(walls, cx, cy);
        const felled = kind === WALL_EMPTY && isWallBroken(walls, cx, cy);
        if (kind !== WALL_TREE && !felled) continue;

        const h = cellHash(cx, cy);
        const n = STEM_MIN + (h % STEM_SPAN);
        // The sway clock, per cell. See SWAY_TICKS: the offset is what stops the wood marching.
        const frame = felled
          ? 0
          : (((tick / SWAY_TICKS) | 0) + (h >>> 8)) % SWAY_FRAMES;

        // Stems south-first within the cell, so a nearer trunk covers a further one.
        for (let k = 0; k < n; k++) order[k] = k;
        for (let a = 1; a < n; a++) {
          const key = order[a];
          const ky = stemFrac(h, key, 1);
          let b = a - 1;
          while (b >= 0 && stemFrac(h, order[b], 1) > ky) {
            order[b + 1] = order[b];
            b--;
          }
          order[b + 1] = key;
        }

        for (let i = 0; i < n; i++) {
          const k = order[i];
          const s = (felled ? this.stumps : this.trees).acquire();
          if (s === undefined) break;
          const v = (h >>> (k * 3 + 2)) % WALL_TREE_COUNT;
          const t = felled ? this.tex.wallStumps[v] : this.tex.wallTrees[v][frame];
          // Scaled on HEIGHT - see STEM_HEIGHT. Width follows from the art.
          const grow = STEM_SCALE_MIN + stemFrac(h, k, 2) * STEM_SCALE_SPAN;
          s.texture = t;
          s.anchor.set(0.5, 1);
          s.position.set(
            (cx + 0.5) * WALL_CELL + (stemFrac(h, k, 0) - 0.5) * WALL_CELL * STEM_SPREAD,
            (cy + STEM_BASE_FRAC) * WALL_CELL + (stemFrac(h, k, 1) - 0.5) * WALL_CELL * STEM_SPREAD,
          );
          s.scale.set(((felled ? STUMP_HEIGHT : STEM_HEIGHT) * grow) / t.height);
          s.alpha = 1;
          s.tint = 0xffffff;
        }

        // The skirt. Drawn on a felled cell too: the trees came down, the scrub did not.
        for (let k = 0; k < BUSH_COUNT; k++) {
          const s = this.trees.acquire();
          if (s === undefined) break;
          const bv = (h >>> (k * 4 + 11)) % WALL_BUSH_COUNT;
          const t = this.tex.wallBushes[bv][frame];
          const w = BUSH_WIDTH * (STEM_SCALE_MIN + stemFrac(h, k, 3) * STEM_SCALE_SPAN);
          s.texture = t;
          s.anchor.set(0.5, 1);
          s.position.set(
            (cx + 0.5) * WALL_CELL + (stemFrac(h, k, 4) - 0.5) * WALL_CELL * BUSH_SPREAD,
            (cy + BUSH_BASE_FRAC) * WALL_CELL + stemFrac(h, k, 5) * WALL_CELL * BUSH_BASE_SPAN,
          );
          s.scale.set(w / t.width);
          s.alpha = 1;
          s.tint = 0xffffff;
        }
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
