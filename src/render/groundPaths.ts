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
 * WHY THE FIRST VERSION LOOKED LIKE GRAPH PAPER, AND WHAT FIXED IT
 * ---------------------------------------------------------------------------------------------
 * The first layout put one dead-straight road down every band, full length of the arena, in both
 * axes. It was a GRID - which is the exact wallpaper problem the baked floor was made to solve,
 * moved up a scale and drawn in a brighter colour. The giveaway was in the art rather than in the
 * screenshot: fifteen tiles are vendored, and a layout of infinite straight lines can only ever
 * ask for the straights and the junctions. The four end caps and the four corners were dead files.
 * Art you cannot reach is a layout that is not doing anything.
 *
 * Three rules replaced it, and between them every one of the fifteen tiles now gets drawn:
 *
 *   ROADS JOG. A road holds a column for a SEGMENT and then steps sideways within its band and
 *     carries on, so it meanders down the yard instead of ruling a line down it. The step is a
 *     real connected run of cells, not a jump - which is where the CORNER tiles come from.
 *   ROADS ROT. Every cell has a chance of simply not being there. Runs come apart into stretches
 *     with gaps between them, which is where the END CAPS come from, and which is the difference
 *     between a road somebody maintains and a road the scrap grew over.
 *   NOT EVERY BAND HAS ONE. About a fifth of bands are empty, so the spacing is genuinely
 *     irregular - sometimes two roads close together, sometimes a long walk between them. A
 *     guaranteed road every N units is a grid however much you bend it.
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
 * DERIVED PER CELL AND STORED NOWHERE
 * ---------------------------------------------------------------------------------------------
 * Nothing is generated at run start and nothing is remembered: the camera asks about the cells it
 * can see, every frame, and walking away and back re-derives exactly the same roads because there
 * was never any state to lose. A stored road network for a 12 288-unit arena would be thousands of
 * cells, nearly all of them never seen.
 *
 * That is what forces the layout to be a PURE FUNCTION OF A COORDINATE - `road(cx, cy)` may not
 * consult a neighbour's decision, because the neighbour has no decision until it is asked. It is
 * the reason a road jogs on a segment boundary both of its cells can compute independently rather
 * than by wandering, and the reason erosion is a per-cell dice roll rather than a chewed edge.
 */

import { type Container, type Texture } from 'pixi.js';

import { SpritePool } from './spritePool.js';
import type { Camera } from './camera.js';

/** World units per cell. The tiles are 64 px authored at 1 px per unit, so this is their size. */
const CELL = 64;
/** Cells per band. At most one road per band per axis, so this sets the spacing. */
const BAND = 9;
/**
 * Cells a road holds one column for before it steps sideways. At CELL 64 a segment is ~450 units,
 * which is about one bend per screen: often enough that a road is visibly not straight, rare
 * enough that it still reads as a road going somewhere rather than as a scribble.
 */
const SEG = 7;
/** Fraction of bands with no road at all, which is what makes the spacing irregular. */
const BAND_SKIP = 0.22;
/**
 * Per-cell chance a road cell has worn away. This is the dial that decides whether the yard looks
 * abandoned or bombed: at 0.3 the roads stop being followable, at 0.04 they look brand new. At
 * 0.13 it was throwing off two-cell fragments often enough that they read as litter rather than
 * as a road that used to be there, which is the failure this number is really guarding against.
 */
const EROSION = 0.1;
/** Enough for the visible lattice with its jog runs; the camera reaches ~500 u. */
const CAPACITY = 128;

/**
 * The path art is pale ice-blue, which on a rust floor reads as water on an alien planet. Tinted
 * to worn concrete it reads as what the yard needs it to be: plating somebody laid down and the
 * scrap grew over.
 *
 * The alpha matters as much as the tint. At full strength a road is the brightest thing on screen
 * and the eye follows it instead of the horde; at 0.5 it is ground that happens to be a different
 * colour, which is what a road in peripheral vision should be.
 *
 * WEAR varies it per cell on top of that. A uniform alpha is the other half of why the first
 * version looked printed rather than laid: real plating is scuffed in patches, and a road whose
 * every cell is equally faded is a road drawn with one pen.
 */
const TINT = 0x9c9384;
const ALPHA = 0.5;
const WEAR_MIN = 0.66;
const WEAR_MAX = 1.15;

/** Returned by the column/row lookups for a band that has no road in it. */
const NO_ROAD = 0x7fffffff;

/** Salts, so the two axes and the erosion roll never share a decision for the same number. */
const SALT_COL = 0x9e3779b1 | 0;
const SALT_ROW = 0x85ebca6b | 0;
const SALT_SKIP = 0xc2b2ae35 | 0;
const SALT_ROT = 0x27d4eb2f | 0;
const SALT_WEAR = 0x165667b1 | 0;

/** As groundCover's, and for the same reason - the lookup must be seekable by coordinate. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 0x27220a95) ^ (y * 0x165667b1) ^ (seed * 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Floor division that behaves for negative coordinates - the yard is centred on the origin. */
function floorDiv(cell: number, by: number): number {
  return Math.floor(cell / by);
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

  /** Whether band `b` on this axis carries a road at all. About a fifth of them do not. */
  private bandHas(b: number, axis: number): boolean {
    return hash(b, axis, this.seed ^ SALT_SKIP) % 1024 >= BAND_SKIP * 1024;
  }

  /**
   * The column a vertical road holds over segment `s` of its band, kept off BOTH band edges.
   *
   * That is not tidiness. Two neighbouring bands that each put their road hard against the shared
   * edge would draw two parallel roads one cell apart, and the connectivity mask renders that as a
   * two-lane motorway rather than as two roads.
   */
  private colAt(b: number, s: number): number {
    if (!this.bandHas(b, 0)) return NO_ROAD;
    return b * BAND + 1 + (hash(b, s, this.seed ^ SALT_COL) % (BAND - 2));
  }

  private rowAt(b: number, s: number): number {
    if (!this.bandHas(b, 1)) return NO_ROAD;
    return b * BAND + 1 + (hash(s, b, this.seed ^ SALT_ROW) % (BAND - 2));
  }

  /**
   * Whether this cell is on a vertical road: either the straight run of its own segment, or the
   * sideways step at the segment boundary that links the previous segment's column to this one's.
   *
   * The step lives on the FIRST ROW of a segment and runs between the two columns inclusive, so
   * both ends of it are also on their own segment's straight - which is what makes the join
   * connected without either cell having to know what its neighbour decided.
   */
  private vertAt(cx: number, cy: number): boolean {
    const b = floorDiv(cx, BAND);
    const s = floorDiv(cy, SEG);
    const cur = this.colAt(b, s);
    if (cur === NO_ROAD) return false;
    if (cx === cur) return true;
    if (cy !== s * SEG) return false;
    const prev = this.colAt(b, s - 1);
    if (prev === NO_ROAD) return false;
    return cx >= Math.min(prev, cur) && cx <= Math.max(prev, cur);
  }

  private horizAt(cx: number, cy: number): boolean {
    const b = floorDiv(cy, BAND);
    const s = floorDiv(cx, SEG);
    const cur = this.rowAt(b, s);
    if (cur === NO_ROAD) return false;
    if (cy === cur) return true;
    if (cx !== s * SEG) return false;
    const prev = this.rowAt(b, s - 1);
    if (prev === NO_ROAD) return false;
    return cy >= Math.min(prev, cur) && cy <= Math.max(prev, cur);
  }

  /**
   * The one question the whole layer is built out of. Called for the cell AND for its four
   * neighbours, so it has to be cheap and it has to be consistent - the mask is only correct
   * because a neighbour asked about from either side answers the same way.
   */
  private road(cx: number, cy: number): boolean {
    const vert = this.vertAt(cx, cy);
    const horiz = this.horizAt(cx, cy);
    if (!vert && !horiz) return false;
    // A CROSSING NEVER ROTS. Erosion is allowed to break a road anywhere along its length, but a
    // junction is the one piece of this layer that is actually load-bearing: it is the landmark
    // the roads exist to provide, and "the crossroads north of where I died" stops meaning
    // anything if the crossroads is a coin flip. It also keeps the 15-tile drawn.
    if (vert && horiz) return true;
    return hash(cx, cy, this.seed ^ SALT_ROT) % 1024 >= EROSION * 1024;
  }

  draw(camera: Camera): void {
    const pool = this.pool;
    pool.begin();
    if (this.textures.length < 16) {
      pool.end();
      return;
    }

    const reach = Math.max(camera.halfW, camera.halfH) + CELL;
    const x0 = floorDiv(camera.x - reach, CELL);
    const x1 = floorDiv(camera.x + reach, CELL);
    const y0 = floorDiv(camera.y - reach, CELL);
    const y1 = floorDiv(camera.y + reach, CELL);

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.road(cx, cy)) continue;

        // Five `road` calls per road cell rather than the hoisted row/column tests the straight
        // layout could use. Jogging roads are not separable into "this row is a road" any more, so
        // the neighbours have to be asked individually - a few thousand integer hashes a frame,
        // which does not register next to one sprite upload.
        let mask = 0;
        if (this.road(cx, cy - 1)) mask |= 1;
        if (this.road(cx + 1, cy)) mask |= 2;
        if (this.road(cx, cy + 1)) mask |= 4;
        if (this.road(cx - 1, cy)) mask |= 8;
        // A cell whose neighbours all rotted away. There is no mask-0 tile and there should not be
        // one: a single square of plating alone in the dirt is litter, not a road.
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
        const wear = (hash(cx, cy, this.seed ^ SALT_WEAR) >>> 8) & 0xff;
        s.alpha = Math.min(1, ALPHA * (WEAR_MIN + (wear / 0xff) * (WEAR_MAX - WEAR_MIN)));
      }
    }

    pool.end();
  }
}
