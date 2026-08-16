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
import { WALL_FACE_FRACTION, WALL_TREE_COUNT, type GameTextures } from './assets.js';
import { SpritePool } from './spritePool.js';
import type { Camera } from './camera.js';
import type { LevelDressing } from './dressing.js';

/**
 * How tall a tree is drawn, in world units.
 *
 * SIZED BY HEIGHT AGAINST THE MECH, not by width against the cell, and that was got wrong first
 * time. Scaled to 1.35 cells WIDE, the pack's trees came out between 133 and 200 units tall
 * depending on their aspect - up to four times the 52-unit mech - which is precisely the
 * dwarfing this whole art pass exists to avoid. Height is the dimension a player judges a tree
 * by, so height is the one that is fixed and width is what follows from the art.
 *
 * 126 was picked by looking at a run of eight in the real renderer. At 108 the canopies only just
 * touched and a treeline read as a row of separate lollipops with moss showing between the trunks -
 * decoration rather than something that stops you, which is the wrong message for a wall. At 126
 * the three surviving trees come out 79-83 units wide against a 64 unit cell, so consecutive
 * canopies overlap by a quarter and the run reads as one mass. It is 2.4x the mech, which a tree
 * is allowed to be; the thing that must not tower is the STONE, and that is handled by cropping
 * the cliff face (tools/make-moss-walls.mjs).
 */
const TREE_HEIGHT = 126;

/** Stumps are small. Well under a cell, so a felled tree visibly leaves a gap you can drive through. */
const STUMP_HEIGHT = 30;

/**
 * Sprite ceilings. The camera shows about 616 x 440 units - 10 x 7 cells - measured off the real
 * renderer, so 512 covers a screen entirely full of wall many times over. Running out costs one
 * missing tile rather than an allocation in the draw loop.
 */
const TOP_CAPACITY = 512;
const FACE_CAPACITY = 192;
const TREE_CAPACITY = 192;

/**
 * Which tree a cell grows, and which face a wall shows. A hash of the cell, so it is stable as the
 * camera moves - picking at random per frame would make the wood flicker between variants.
 *
 * Deliberately NOT the simulation's hash: this decides nothing the simulation can see, and reusing
 * that one would tie the art to the terrain's stream for no benefit.
 */
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
    this.drawWood(walls, c0, c1, r0, r1);

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
   * Passes 3 and 4: felled stumps, then standing trees.
   *
   * Both are anchored at the BOTTOM CENTRE of their cell rather than at its middle, because that is
   * where a trunk meets the ground - anchoring at the centre would bury half of every tree in the
   * cell above and make a treeline sit a quarter of a cell too high.
   */
  private drawWood(walls: MossWalls, c0: number, c1: number, r0: number, r1: number): void {
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const kind = wallKindAt(walls, cx, cy);
        const felled = kind === WALL_EMPTY && isWallBroken(walls, cx, cy);
        if (kind !== WALL_TREE && !felled) continue;

        const v = variantOf(cx, cy, WALL_TREE_COUNT);
        const pool = felled ? this.stumps : this.trees;
        const t = felled ? this.tex.wallStumps[v] : this.tex.wallTrees[v];
        const s = pool.acquire();
        if (s === undefined) continue;

        // Scaled on HEIGHT - see TREE_HEIGHT. Width follows from the art, which is what keeps a
        // pine narrow and a birch round instead of squashing both into a cell-shaped box.
        const scale = (felled ? STUMP_HEIGHT : TREE_HEIGHT) / t.height;
        s.texture = t;
        s.anchor.set(0.5, 1);
        s.position.set((cx + 0.5) * WALL_CELL, (cy + 1) * WALL_CELL);
        s.scale.set(scale);
        s.alpha = 1;
        s.tint = 0xffffff;
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
