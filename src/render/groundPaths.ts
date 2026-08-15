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
 * THE ROADS WIND, AND GETTING THERE TOOK THREE GOES
 * ---------------------------------------------------------------------------------------------
 * V1 ruled one dead-straight road down every band, full length of the arena, in both axes. It was
 * a GRID - the exact wallpaper problem the baked floor was made to solve, moved up a scale and
 * drawn in a brighter colour. The giveaway was in the art rather than in the screenshot: fifteen
 * tiles are vendored, and a layout of infinite straight lines can only ever ask for the two
 * straights and the junctions. All four end caps and all four corners were dead files.
 *
 * V2 made each road hold a column for seven cells and then step sideways. That reached the corner
 * tiles, but it was still a lattice with kinks in it - the road was straight almost everywhere and
 * turned only on a schedule, which is a road drawn by someone avoiding the problem.
 *
 * The mistake in both was a self-imposed one: assuming `road(cx, cy)` being a pure function of the
 * coordinate forced the layout into bands and segments. It does not. A ROAD'S COLUMN CAN BE A
 * SMOOTH FUNCTION OF ITS ROW - value noise, sampled at `cy`, quantised to a cell. That is still
 * O(1) and still seekable by coordinate, and it is an arbitrary winding walk rather than a lattice.
 * A complete connectivity set was always enough to draw one; the layout was what was missing.
 *
 * So, three rules, and between them every one of the fifteen tiles gets drawn:
 *
 *   ROADS WIND. Two octaves of value noise, swinging up to AMP cells either side of the band's
 *     centre line, holding a heading and then turning - see `vnoise` for why the interpolation
 *     shape is the difference between a bend and a zigzag. The sideways moves are where the
 *     CORNER tiles come from, and they are now most of the road rather than an occasional event.
 *   ROADS ROT. Every non-junction cell has a chance of simply not being there. Runs come apart
 *     into stretches with gaps between them, which is where the END CAPS come from, and which is
 *     the difference between a road somebody maintains and a road the scrap grew over.
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
 * consult a neighbour's decision, because the neighbour has no decision until it is asked, and no
 * cell may assume it is reached by walking from anywhere. See `vertAt` for how a winding road is
 * still kept connected under that rule, and note that erosion is a per-cell dice roll for the same
 * reason: a chewed edge would have to know where the edge was.
 */

import { type Container, type Texture } from 'pixi.js';

import { SpritePool } from './spritePool.js';
import type { Camera } from './camera.js';

/** World units per cell. The tiles are 64 px authored at 1 px per unit, so this is their size. */
const CELL = 64;
/**
 * Cells per band. At most one road per band per axis, so this sets the spacing - and it also sets
 * the room a road has to wander in, since a road never leaves the band it belongs to.
 */
const BAND = 12;
/**
 * How far a road swings from its band's centre line, in cells. The band's interior is 5 cells
 * either side of centre, so at 4 a road uses nearly all the room it has while still leaving a
 * cell of margin at each band edge - two roads in neighbouring bands can never end up adjacent
 * and be drawn as one two-lane motorway.
 */
const AMP = 4;
/**
 * The two wavelengths the wander is built from, in cells. Coprime so they do not line up into a
 * repeating shape, and both long enough that the road holds a heading for a while: 16 cells is
 * ~1000 units, so a full swing is about one screen. Dropping these makes roads wobble per-cell,
 * which reads as a jagged mess rather than as a road that bends.
 *
 * THEY ARE ALSO A CORRECTNESS CONSTRAINT, not just taste - see the slope budget below.
 */
const WAVE_LONG = 16;
const WAVE_SHORT = 9;
/** Weights of the two waves. The short one is detail on the long one, not an equal partner. */
const WAVE_MIX = 0.7;

/**
 * THE SLOPE BUDGET, WHICH IS WHAT KEEPS THE RINGS AWAY. Read this before touching AMP or either
 * wavelength.
 *
 * Smoothstepped value noise changes at most 1.5 / period per cell, so the centreline moves at most
 *
 *     2 * AMP * 1.5 * (WAVE_MIX / WAVE_LONG + (1 - WAVE_MIX) / WAVE_SHORT)
 *
 * cells per step. Keep that UNDER 1 and the road can never move more than one cell at a time,
 * which caps a row's span at two cells. A 2x2 block of road - the thing that draws as a closed
 * ring - then requires two consecutive spans covering the same pair, which is exactly the one-row
 * spike that `colAt` flattens. So the two rules together make rings impossible rather than rare,
 * and the audit over five seeds and 195 000 cells finds none.
 *
 * At the values above the budget comes to 0.925. Raising AMP to 5 or shortening WAVE_SHORT to 5
 * puts it over 1 and the little roundabouts come straight back - measured, not guessed: the
 * version with AMP 4 / 11 / 5 scored 1.51 and put a ring in roughly every screen.
 */
/** Fraction of bands with no road at all, which is what makes the spacing irregular. */
const BAND_SKIP = 0.2;
/**
 * Per-cell chance a road cell has worn away. This is the dial that decides whether the yard looks
 * abandoned or bombed: at 0.3 the roads stop being followable, at 0.04 they look brand new. At
 * 0.13 it was throwing off two-cell fragments often enough that they read as litter rather than
 * as a road that used to be there, which is the failure this number is really guarding against.
 */
const EROSION = 0.1;
/**
 * A winding road covers more cells per screen than a straight one - every sideways move spends a
 * horizontal run as well as the vertical it was already spending - so this is well above the ~40
 * a phone actually draws. Idle pool sprites cost a few hundred bytes each; a road that stops
 * halfway down the screen because the pool ran dry costs a bug report.
 */
const CAPACITY = 192;

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

/** [0, 1) from a hash, as a float. */
function unit(h: number): number {
  return (h >>> 8) / 0x1000000;
}

/**
 * One octave of value noise along a line: a hashed value every `period` cells, smoothly blended
 * between. This is what turns a road from a lattice into a curve.
 *
 * SMOOTHSTEP RATHER THAN LINEAR between the control points, and it is not cosmetic. Linear
 * interpolation gives a road a constant sideways drift and then an abrupt change of heading at
 * every control point, which is a zigzag. Smoothstep flattens the ends, so the road HOLDS A
 * HEADING near each control point and does its turning in between - which is what a road that
 * bends looks like, as opposed to a road that has been folded.
 */
function vnoise(t: number, period: number, salt: number): number {
  const i = floorDiv(t, period);
  const f = (t - i * period) / period;
  const a = unit(hash(i, 0, salt));
  const b = unit(hash(i + 1, 0, salt));
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

export class GroundPaths {
  readonly container: Container;
  private readonly pool: SpritePool;
  /** Indexed by connectivity mask 1..15; index 0 is never read. */
  private readonly textures: readonly Texture[];
  private seed = 0;
  /**
   * Centrelines already worked out this frame, cleared every draw.
   *
   * The layout is a pure function and could be recomputed every time, but the mask asks about five
   * cells and each of those needs the centreline at three positions to check for a spike, so the
   * same column gets derived around sixty times per cell without this. That is real work on a
   * phone for a layer nobody is looking at. The cache changes no answer - it is the same pure
   * function with its results kept for the length of one frame.
   */
  private readonly colMemo = new Map<number, number>();
  private readonly rowMemo = new Map<number, number>();

  constructor(byMask: readonly Texture[]) {
    this.textures = byMask;
    this.pool = new SpritePool({ capacity: CAPACITY, label: 'ground-paths' });
    this.container = this.pool.container;
  }

  /** Called at the start of a run. The seed is the only thing that decides where the roads run. */
  begin(seed: number): void {
    this.seed = seed | 0;
    this.colMemo.clear();
    this.rowMemo.clear();
  }

  /** Whether band `b` on this axis carries a road at all. About a fifth of them do not. */
  private bandHas(b: number, axis: number): boolean {
    return hash(b, axis, this.seed ^ SALT_SKIP) % 1024 >= BAND_SKIP * 1024;
  }

  /**
   * How far band `b`'s road has strayed from its centre line at position `t` along its length,
   * as a whole number of cells in [-AMP, +AMP].
   *
   * Salted by the band, or every road in the yard would wind in perfect unison - which looks less
   * like a road network than the straight lattice did.
   */
  private wander(b: number, t: number, salt: number): number {
    const s = this.seed ^ salt ^ Math.imul(b, 0x9e3779b1);
    const n = vnoise(t, WAVE_LONG, s) * WAVE_MIX + vnoise(t, WAVE_SHORT, s ^ 0x5bf03635) * (1 - WAVE_MIX);
    return Math.round((n * 2 - 1) * AMP);
  }

  /** The centreline straight off the noise, before spikes are taken out of it. */
  private raw(b: number, t: number, salt: number): number {
    return b * BAND + (BAND >> 1) + this.wander(b, t, salt);
  }

  /**
   * The column band `b`'s vertical road occupies at row `cy`, or NO_ROAD if the band has none.
   *
   * The road never leaves its band: the centre line is BAND/2 and the swing is capped at AMP,
   * which is why `vertAt` can answer by looking at one band instead of searching neighbours.
   *
   * A ONE-ROW SPIKE IS FLATTENED, and that is not smoothing for its own sake - it is the one shape
   * this tile set cannot draw. A road that steps one cell sideways and immediately back covers a
   * 2x2 square of cells, and a 2x2 of corner tiles is a closed RING with a hole in the middle. It
   * appears on screen as a tiny roundabout somebody built in the middle of nowhere, and at the
   * wander slopes that make roads interesting it happens often enough to read as a defect.
   *
   * Flattening the spike is the fix rather than deleting one of the four cells, because every
   * choice of which cell to delete disconnects the road in some other configuration. Removing the
   * excursion removes the cause, and a spike is a wobble the road is better off without anyway.
   */
  private colAt(b: number, cy: number): number {
    if (!this.bandHas(b, 0)) return NO_ROAD;
    const key = b * 0x100000 + cy + 0x80000;
    const seen = this.colMemo.get(key);
    if (seen !== undefined) return seen;
    const here = this.raw(b, cy, SALT_COL);
    const before = this.raw(b, cy - 1, SALT_COL);
    const after = this.raw(b, cy + 1, SALT_COL);
    const out = before === after && before !== here ? before : here;
    this.colMemo.set(key, out);
    return out;
  }

  private rowAt(b: number, cx: number): number {
    if (!this.bandHas(b, 1)) return NO_ROAD;
    const key = b * 0x100000 + cx + 0x80000;
    const seen = this.rowMemo.get(key);
    if (seen !== undefined) return seen;
    const here = this.raw(b, cx, SALT_ROW);
    const before = this.raw(b, cx - 1, SALT_ROW);
    const after = this.raw(b, cx + 1, SALT_ROW);
    const out = before === after && before !== here ? before : here;
    this.rowMemo.set(key, out);
    return out;
  }

  /**
   * Whether this cell is on a vertical road.
   *
   * THE SPAN IS WHAT KEEPS A WINDING ROAD CONNECTED, and it is the whole trick. Row `cy` holds not
   * just the road's column at `cy` but every cell between that and its column at `cy + 1`. So when
   * the road moves sideways it lays the corner and the horizontal run it needs on the way, and the
   * cell it lands on is by construction also the start of the next row's span.
   *
   * That is what lets an arbitrary walk be a PURE FUNCTION OF A COORDINATE. Neither cell consults
   * the other and neither has to be visited first; both derive the same two columns from the same
   * noise and agree about the run between them. A road built by actually walking it would have to
   * be generated from a start point and stored, which for a 12 288-unit arena is thousands of
   * cells that are never seen.
   */
  private vertAt(cx: number, cy: number): boolean {
    const b = floorDiv(cx, BAND);
    const here = this.colAt(b, cy);
    if (here === NO_ROAD) return false;
    const next = this.colAt(b, cy + 1);
    return cx >= Math.min(here, next) && cx <= Math.max(here, next);
  }

  private horizAt(cx: number, cy: number): boolean {
    const b = floorDiv(cy, BAND);
    const here = this.rowAt(b, cx);
    if (here === NO_ROAD) return false;
    const next = this.rowAt(b, cx + 1);
    return cy >= Math.min(here, next) && cy <= Math.max(here, next);
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
    // Held for one frame only. The camera moves, so last frame's cells are mostly the wrong ones
    // and a cache that grew forever would be a slow leak in a decoration layer.
    this.colMemo.clear();
    this.rowMemo.clear();
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
