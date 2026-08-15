/**
 * PACKAGE C - GROUND PATHS. Worn service roads laid across the yard, purely to look at.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS, AND HOW TO REMOVE IT
 * ---------------------------------------------------------------------------------------------
 * A self-contained decoration layer, exactly like package B and independent of it. It owns its own
 * sprite pool, its own textures (`path_*`) and its own layout rule, and NOTHING ELSE READS IT.
 *
 * TO REMOVE IT: delete this file, delete the three lines in gameRenderer.ts that construct it, add
 * it to the world container and call `draw`, and drop the `path_*` entries from
 * tools/prepare_assets.mjs. No core change, no save field, no tuning dial.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT IS FOR, WHICH IS NOT DECORATION
 * ---------------------------------------------------------------------------------------------
 * Every direction in this yard looks the same. That is a real cost and not an aesthetic one: it is
 * why chasing an off-screen arrow feels like guessing, and why "go back to where the chest fell"
 * is not a thing a player can actually do. A road gives the ground a grain, and a grain is the
 * cheapest possible way to know roughly where you are.
 *
 * It is deliberately SPARSE for that reason. Roads you cross every few seconds are wallpaper
 * again; roads you meet every few hundred units are landmarks.
 *
 * ---------------------------------------------------------------------------------------------
 * NO ROTATION: THE PACK SHIPS EVERY ORIENTATION AS ITS OWN TILE
 * ---------------------------------------------------------------------------------------------
 * The fifteen transparent path tiles are a complete connectivity set - four end caps, two
 * straights, four corners, four T-junctions and a crossroads - and each one's path meets the tile
 * edge at its MIDPOINT, measured rather than assumed. So a cell's tile is chosen by a 4-bit mask
 * of which neighbours are also road (1 = north, 2 = east, 4 = south, 8 = west) and drawn upright.
 *
 * prepare_assets.mjs vendors them named BY THAT MASK, so this file's lookup is one array index and
 * there is no table here to fall out of step with the art.
 *
 * ---------------------------------------------------------------------------------------------
 * THE LAYOUT IS A WARPED LATTICE, DERIVED PER CELL AND STORED NOWHERE
 * ---------------------------------------------------------------------------------------------
 * Roads run along whole rows and columns of cells, one road per BAND of `BAND` cells, sitting at a
 * hashed offset inside its band. So the spacing is irregular - a road every 6 to 12 cells rather
 * than every 9 - while remaining a pure function of the coordinate.
 *
 * That is what makes it free. Nothing is generated at run start and nothing is remembered: the
 * camera asks about the twenty-odd cells it can see, every frame, and walking away and back
 * re-derives exactly the same roads because there was never any state to lose. A stored road
 * network for a 12 288-unit arena would be thousands of cells, nearly all of them never seen.
 *
 * THE OFFSET IS KEPT OFF THE BAND EDGES, which is not tidiness: two neighbouring bands that both
 * put their road against the shared edge would draw two parallel roads one cell apart, and the
 * connectivity mask would render that as a two-lane motorway rather than as two roads.
 */

import { type Container, type Texture } from 'pixi.js';

import { SpritePool } from './spritePool.js';
import type { Camera } from './camera.js';

/** World units per cell. The tiles are 64 px authored at 1 px per unit, so this is their size. */
const CELL = 64;
/** Cells per band. One road per band, so roads land 6-12 cells apart at BAND 9. */
const BAND = 9;
/** Enough for the visible lattice: the camera reaches ~500 u, so ~16 cells across. */
const CAPACITY = 96;

/**
 * The path art is pale ice-blue, which on a rust floor reads as water on an alien planet. Tinted
 * to worn concrete it reads as what the yard needs it to be: plating somebody laid down and the
 * scrap grew over.
 *
 * The alpha matters as much as the tint. At full strength a road is the brightest thing on screen
 * and the eye follows it instead of the horde; at 0.5 it is ground that happens to be a different
 * colour, which is what a road in peripheral vision should be.
 */
const TINT = 0x9c9384;
const ALPHA = 0.5;

/** As groundCover's, and for the same reason - the lookup must be seekable by coordinate. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 0x27220a95) ^ (y * 0x165667b1) ^ (seed * 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Floor division that behaves for negative coordinates - the yard is centred on the origin. */
function bandOf(cell: number): number {
  return Math.floor(cell / BAND);
}

export class GroundPaths {
  readonly container: Container;
  private readonly pool: SpritePool;
  /** Indexed by connectivity mask 1..15; index 0 is never read. */
  private readonly textures: readonly Texture[];
  private seed = 0;

  constructor(byMask: readonly Texture[]) {
    this.textures = byMask;
    this.pool = new SpritePool({ capacity: CAPACITY, label: 'ground-paths' });
    this.container = this.pool.container;
  }

  /** Called at the start of a run. The seed is the only thing that decides where the roads run. */
  begin(seed: number): void {
    this.seed = seed | 0;
  }

  /** The one road column in this cell's band, kept clear of both band edges. */
  private roadCol(cell: number): boolean {
    const b = bandOf(cell);
    const off = 1 + (hash(b, 0x5eed, this.seed) % (BAND - 2));
    return cell === b * BAND + off;
  }

  private roadRow(cell: number): boolean {
    const b = bandOf(cell);
    const off = 1 + (hash(0x5eed, b, this.seed) % (BAND - 2));
    return cell === b * BAND + off;
  }

  private isRoad(cx: number, cy: number): boolean {
    return this.roadCol(cx) || this.roadRow(cy);
  }

  draw(camera: Camera): void {
    const pool = this.pool;
    pool.begin();
    if (this.textures.length < 16) {
      pool.end();
      return;
    }

    const reach = Math.max(camera.halfW, camera.halfH) + CELL;
    const x0 = Math.floor((camera.x - reach) / CELL);
    const x1 = Math.floor((camera.x + reach) / CELL);
    const y0 = Math.floor((camera.y - reach) / CELL);
    const y1 = Math.floor((camera.y + reach) / CELL);

    for (let cy = y0; cy <= y1; cy++) {
      // Hoisted: whether this ROW is a road is the same for every cell in it, and the row test is
      // the expensive half (a hash and a modulo). The column test cannot be hoisted the same way,
      // but it is the inner loop's only per-cell cost.
      const rowIsRoad = this.roadRow(cy);
      const rowAbove = this.roadRow(cy - 1);
      const rowBelow = this.roadRow(cy + 1);

      for (let cx = x0; cx <= x1; cx++) {
        const colIsRoad = this.roadCol(cx);
        if (!colIsRoad && !rowIsRoad) continue;

        // The mask, from the four neighbours. A cell on a road COLUMN always connects north and
        // south; one on a road ROW always connects east and west; a junction does both.
        let mask = 0;
        if (colIsRoad || rowAbove) mask |= 1;
        if (rowIsRoad || this.roadCol(cx + 1)) mask |= 2;
        if (colIsRoad || rowBelow) mask |= 4;
        if (rowIsRoad || this.roadCol(cx - 1)) mask |= 8;
        if (mask === 0) continue;

        const x = cx * CELL + CELL / 2;
        const y = cy * CELL + CELL / 2;
        if (!camera.isVisible(x, y, CELL)) continue;

        const s = pool.acquire();
        if (s === undefined) break;
        s.texture = this.textures[mask];
        s.anchor.set(0.5);
        s.position.set(x, y);
        s.rotation = 0;
        s.scale.set(1);
        s.tint = TINT;
        s.alpha = ALPHA;
      }
    }

    pool.end();
  }
}
