/**
 * MOSSY MAYHEM'S WALLS: an UNBOUNDED lattice of 64-unit cells, dealt from a weight table.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS NOT THE SCRAPYARD'S SCENERY WITH DIFFERENT NUMBERS
 * ---------------------------------------------------------------------------------------------
 * The Scrapyard fills a FIXED SQUARE with circles - 256 cells, allocated once, one jittered pile
 * each. Neither half of that survives here:
 *
 *   - Mossy has no square. `arenaHalf` is Infinity and a run can walk a couple of hundred thousand
 *     units in a straight line, so there is no array that could hold the answer. Terrain has to be
 *     a PURE FUNCTION of (seed, where you are standing), computed when asked.
 *   - A wall is not a circle. A circle has no flat face to slide along and no corner to hide
 *     behind, and rounding the corners off a wall segment is exactly the thing that would make a
 *     lattice of them read as a field of blobs - which is what the Scrapyard already is.
 *
 * So this is its own geometry with its own queries, and `scenery.ts` dispatches to it. Nothing in
 * here can affect the Scrapyard, and nothing there can affect this.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE SHAPE PER BLOCK, WHICH IS WHAT BOUNDS EVERY QUERY
 * ---------------------------------------------------------------------------------------------
 * The plane is cut into BLOCK_CELLS-square BLOCKS. Each block deals AT MOST ONE SHAPE from the
 * weight table, from a hash of its own coordinates and the run seed. That is the same bargain the
 * Scrapyard's jittered grid makes, for the same three reasons:
 *
 *   - Density is uniform by construction, so no rejection sampling and no clumping.
 *   - "What is at (x, y)" is arithmetic on the block, not a search.
 *   - A SHAPE IS CONFINED TO ITS OWN BLOCK, inset by SHAPE_MARGIN cells. Two shapes in adjacent
 *     blocks are therefore at least 2 * SHAPE_MARGIN = 2 cells = 128 u apart, which the 52 u mech
 *     fits through with room. Without the inset, two blocks could deal walls that met at the seam
 *     and fused into one long barrier nobody authored.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CACHE IS A MEMO AND NOTHING ELSE
 * ---------------------------------------------------------------------------------------------
 * `blocks` holds generated blocks so that a query does not re-deal one every time. It is a PURE
 * MEMO of a pure function, which is the property that makes eviction safe: dropping an entry can
 * only cost time, never change an answer, so the cap can be whatever fits and a long walk cannot
 * grow it without bound.
 *
 * BROKEN CELLS ARE NOT IN IT, and that separation is the whole reason the cache can be evicted. A
 * destroyed tree lives in `broken`, keyed by its global cell, and that set is never dropped - so a
 * wood the player cut through stays cut even after they walk far enough away for its block to be
 * recycled. Storing the break inside the block array would have made a stroll a way to grow the
 * trees back.
 *
 * ---------------------------------------------------------------------------------------------
 * DETERMINISM
 * ---------------------------------------------------------------------------------------------
 * Every value here comes from `hashBlock`, which is integer mixing on `Math.imul` and `^`. No
 * `Math.pow`, no trigonometry, no wall-clock, no iteration order dependence - a replay recorded on
 * a phone reproduces in Node, which is the rule the whole of `src/core/` is built on.
 */

import type { SceneryPush } from './scenery.js';

/**
 * Edge of one wall cell, in world units. THE ONE NUMBER THIS FILE IS ABOUT.
 *
 * 64 against a 52-unit mech: a one-cell gap leaves 12 u of clearance, which is enough to drive
 * through under pressure without being enough to feel like a doorway. 56 was tried and leaves 4 u,
 * which collision slop eats; 48 is 4 u NARROWER THAN THE MECH and cannot be passed at all. So 64 is
 * the first comfortable size rather than an arbitrary power of two, and the mech's radius is the
 * reason. Changing `player.radius` without revisiting this number will silently seal the map.
 */
export const WALL_CELL = 64;

/**
 * Cells along one edge of a block. 10 * 64 = 640 u.
 *
 * SIZED AGAINST THE CAMERA, which is the measurement that matters and was got wrong first time.
 * The view is 616 x 440 units - 9.6 x 6.9 cells - measured off the real renderer rather than
 * assumed. At the 1024 u blocks this started with, ONE BLOCK WAS LARGER THAN THE SCREEN, so a
 * shape sitting anywhere but the near corner of the block the player was standing in was invisible:
 * 60% of screens showed no wall at all and the mean was 2.4 cells. A block the size of the view
 * puts roughly one shape in front of the player at a time, which is what "wall segments to fight
 * around" means.
 */
const BLOCK_CELLS = 10;

/**
 * Cells of empty margin a shape must leave inside its own block, on every side. See the header:
 * this is what keeps two neighbouring blocks' shapes from fusing into an unauthored barrier.
 */
const SHAPE_MARGIN = 1;

/** The cells a shape may actually occupy, per axis. */
const SHAPE_SPAN = BLOCK_CELLS - 2 * SHAPE_MARGIN;

/**
 * Chance a block deals a shape at all.
 *
 * MEASURED AGAINST THE 616 x 440 VIEW, over 10 000 sample positions across five seeds:
 *
 *     fill   mean wall cells on screen   screens with nothing on them
 *     0.62            4.4                        30.7%
 *     0.75            5.3                        21.0%
 *     0.85            6.0                        15.0%
 *     1.00            7.0                         7.0%
 *
 * 0.85 is the pick. Six cells is 384 u of wall against a 616 u view - one run crossing most of the
 * screen, which is a thing to fight around rather than a maze to solve. The 15% of screens with
 * nothing on them are what stop the map reading as corridors; note that even at 1.0 it is only 7
 * cells, because the ceiling here is the SHAPE SIZE and not the fill - a block deals one shape
 * however often it deals.
 */
const BLOCK_FILL = 0.85;

/** What a cell is made of. Also the value stored in a generated block. */
export const WALL_EMPTY = 0;
/** Grass-topped stone. Permanent: nothing in the game breaks it. */
export const WALL_SOLID = 1;
/** A tree. Breaks like a fuel barrel does, and leaves a stump. */
export const WALL_TREE = 2;

/**
 * Chance a block's shape is made of TREES rather than stone.
 *
 * A whole shape is one material, never a mixture. A line of stone with three trees in it reads as
 * a bug rather than as variety, and - more to the point - it would make "can I shoot through this"
 * a per-cell question the player has to ask while being chased. One look at a segment tells them
 * whether it can be removed.
 */
const TREE_SHARE = 0.36;

/**
 * NO WALLS WITHIN THIS OF THE ORIGIN.
 *
 * The player starts at (0, 0) and must not open a run inside a wall - or wedged in a doorway they
 * did not choose. The Scrapyard spends a `continue` on the same guarantee; here it is a test inside
 * the cell lookup, because there is no generation pass to skip.
 */
const CLEAR_RADIUS = 420;

/**
 * Blocks kept in the memo. 256 blocks is a 16x16 area of them - 16 384 u square, far more than a
 * player can see - at 256 bytes each, so about 64 kB. Nothing chooses this number precisely; it
 * only has to be comfortably more than is in view, because exceeding it costs a re-deal and
 * nothing else.
 */
const BLOCK_CACHE_CAP = 256;

/**
 * Packing bias for block and cell coordinates. A run can reach a few thousand cells from the
 * origin; 2^20 is four orders of magnitude past that in both directions, and the packed key stays
 * well inside the range a double represents exactly.
 */
const KEY_BIAS = 1 << 20;
const KEY_SPAN = 1 << 21;

/**
 * THE SHAPE KINDS, and the cumulative weights they are dealt on.
 *
 * Lines dominate because a line is the shape that does the job - something to put between you and
 * the horde - and because its LENGTH is rolled separately, so "line" is really a dozen different
 * pieces of furniture. The junctions come next: an L gives a corner to retreat into and a T gives
 * a fork that splits a chasing pack. Rooms are the rarest and the most expensive to walk into,
 * which is the right way round for the only shape that can trap someone.
 *
 * `etc.` in the brief is deliberately not taken up. Four shapes with rolled dimensions already
 * generate more distinct pieces than a run shows; a fifth kind would add authoring surface without
 * adding anything a player could name.
 */
const SHAPE_LINE = 0;
const SHAPE_ELL = 1;
const SHAPE_TEE = 2;
const SHAPE_ROOM = 3;
const SHAPE_CDF: readonly number[] = Object.freeze([
  0.36, // line   36%
  0.6, // L       24%
  0.78, // T      18%
  1.0, // room    22%
]);

/**
 * HOW MANY TREES STAND IN ONE DESTRUCTIBLE CELL, and how much each one is worth.
 *
 * ---------------------------------------------------------------------------------------------
 * THE COUNT LIVES HERE NOW, AND IT USED TO BE THE RENDERER'S
 * ---------------------------------------------------------------------------------------------
 * A clump was pure decoration - the dressing rolled 4 to 6 stems off its own hash and core knew
 * nothing about it, which was correct while a cell died to a single touch. It stopped being
 * correct the moment a stem became a THING YOU DESTROY: how many hits a cell takes is a fact about
 * the fight, so the count is simulation state and the dressing reads it rather than inventing it.
 *
 * ---------------------------------------------------------------------------------------------
 * A TILE OF TREES IS WORTH ABOUT AN ELITE
 * ---------------------------------------------------------------------------------------------
 * `TREE_STEM_HP` x 5 stems is 550, against the Mossy ladder's elites - which are ten times a
 * regular, so 560 at cycle 3 and 660 at cycle 4. A four-stem clump comes in at 440 and a six-stem
 * one at 660, which brackets that pair either side. A treeline is therefore something you spend
 * real output on rather than something that evaporates when a shell goes near it.
 *
 * FIXED RATHER THAN SCALED TO THE CURRENT CYCLE, and that is a choice worth stating because the
 * brief could be read either way. An elite is 220 HP in the first minute and 2250 in the last, so
 * a pool that tracked the ladder would move UNDER A CELL THE PLAYER IS HALF WAY THROUGH FELLING -
 * a treeline you had chewed a gap in would heal because a rollover happened. A constant is worth
 * more than exactness against a number that is itself a moving target.
 */
export const TREE_STEM_HP = 110;
const STEM_MIN = 4;
const STEM_SPAN = 3;

/**
 * How many stems a cell grew. A pure function of the seed and the cell, so it needs no storage and
 * is the same on every machine and in every replay.
 */
export function wallStemsAt(w: MossWalls, cx: number, cy: number): number {
  let h = Math.imul(cx | 0, 0x27d4eb2f) ^ Math.imul(cy | 0, 0x9e3779b1) ^ Math.imul(w.seed | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  return STEM_MIN + ((h >>> 0) % STEM_SPAN);
}

export interface MossWalls {
  readonly kind: 'walls';
  /** The run seed, mixed into every block hash. The layout is a pure function of this. */
  readonly seed: number;
  /**
   * Generated blocks, keyed by `blockKey`. A pure memo - see the header. Values are
   * `BLOCK_CELLS * BLOCK_CELLS` bytes of `WALL_*`.
   */
  readonly blocks: Map<number, Uint8Array>;
  /** Global cells whose tree has been broken, keyed by `cellKey`. Never evicted. */
  readonly broken: Set<number>;
  /**
   * HIT POINTS LEFT, for cells that have been damaged and not yet felled. Keyed by `cellKey`.
   *
   * ABSENT MEANS UNTOUCHED, not zero - the pool is `wallStemsAt * TREE_STEM_HP` and is seeded on
   * the first hit, so an unbounded map costs nothing for the enormous majority of cells nobody
   * ever shoots at. An entry is deleted when the cell breaks, so this only ever holds the handful
   * a player is actively chewing through.
   */
  readonly hurt: Map<number, number>;
  /**
   * How many trees have been broken this run. Diagnostics and the harness only; nothing branches
   * on it. There is no live count of standing walls, because on an unbounded map there is no
   * such number.
   */
  count: number;
  /**
   * Bumped by every write that changes what is standing. See `sceneryVersion` in scenery.ts: this
   * is how anything CACHED off the terrain - the flow field, today - knows to throw its copy away.
   */
  version: number;
}

export function createMossWalls(seed: number): MossWalls {
  return {
    kind: 'walls',
    seed: seed | 0,
    blocks: new Map(),
    broken: new Set(),
    hurt: new Map(),
    count: 0,
    version: 0,
  };
}

// -------------------------------------------------------------------------------------------
// Generation
// -------------------------------------------------------------------------------------------

/**
 * A 32-bit hash of one block's coordinates and the run seed.
 *
 * Three rounds of multiply-and-xor, which is enough that neighbouring blocks share no visible
 * structure - the failure this guards against is a hash whose low bits track `bx`, which deals the
 * same shape along a whole row and shows up as an obvious grain in the terrain.
 */
function hashBlock(seed: number, bx: number, by: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (bx | 0), 0x27d4eb2f);
  h = Math.imul(h ^ (by | 0), 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * A tiny deterministic stream over one block's hash. Local to generation, so it cannot be confused
 * with any of the world's RNG streams - and MUST NOT be one of them: terrain is derived from the
 * seed alone, exactly as the Scrapyard's is, so that changing how much of it exists never
 * reshuffles the horde. See "RNG streams are separated on purpose" in CLAUDE.md.
 */
class BlockRng {
  private s: number;
  constructor(h: number) {
    // A zero state would stick at zero forever, which for block (0, 0) of some seed would be a
    // silently empty region rather than a crash.
    this.s = (h | 0) === 0 ? 0x9e3779b1 : h | 0;
  }
  next(): number {
    let x = this.s | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x | 0;
    return (x >>> 0) / 4294967296;
  }
  int(n: number): number {
    const v = Math.floor(this.next() * n);
    return v >= n ? n - 1 : v;
  }
  /** Inclusive on both ends, which is what every dimension roll below wants. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
}

function blockKey(bx: number, by: number): number {
  return (bx + KEY_BIAS) * KEY_SPAN + (by + KEY_BIAS);
}

function cellKey(cx: number, cy: number): number {
  return (cx + KEY_BIAS) * KEY_SPAN + (cy + KEY_BIAS);
}

/** Marks one cell of a block, ignoring anything the shape puts outside the margin. */
function put(cells: Uint8Array, x: number, y: number, material: number): void {
  if (x < SHAPE_MARGIN || y < SHAPE_MARGIN) return;
  if (x >= BLOCK_CELLS - SHAPE_MARGIN || y >= BLOCK_CELLS - SHAPE_MARGIN) return;
  cells[y * BLOCK_CELLS + x] = material;
}

/**
 * Deals one block's cells. PURE in (seed, bx, by) - the memo depends on it.
 *
 * Every shape is ONE CELL THICK. That is the brief ("wall segments about the width of the player")
 * and it is also what the tileset is for: its thin variants mean a single-cell run is a first-class
 * piece of art rather than something that has to be doubled up to look right.
 */
function generateBlock(seed: number, bx: number, by: number): Uint8Array {
  const cells = new Uint8Array(BLOCK_CELLS * BLOCK_CELLS);
  const rng = new BlockRng(hashBlock(seed, bx, by));

  // Drawn FIRST and unconditionally, so that changing BLOCK_FILL moves which blocks are occupied
  // without also reshuffling what the occupied ones contain.
  const fill = rng.next();
  const kindRoll = rng.next();
  const material = rng.next() < TREE_SHARE ? WALL_TREE : WALL_SOLID;
  if (fill >= BLOCK_FILL) return cells;

  let kind = SHAPE_ROOM;
  for (let i = 0; i < SHAPE_CDF.length; i++) {
    if (kindRoll < SHAPE_CDF[i]) {
      kind = i;
      break;
    }
  }

  if (kind === SHAPE_LINE) {
    const len = rng.range(3, SHAPE_SPAN);
    const along = rng.range(0, SHAPE_SPAN - len) + SHAPE_MARGIN;
    const across = rng.range(0, SHAPE_SPAN - 1) + SHAPE_MARGIN;
    const vertical = rng.next() < 0.5;
    for (let i = 0; i < len; i++) {
      if (vertical) put(cells, across, along + i, material);
      else put(cells, along + i, across, material);
    }
    return cells;
  }

  if (kind === SHAPE_ELL || kind === SHAPE_TEE) {
    // A SPINE PLUS ONE ARM, and the only difference between the two kinds is where the arm meets
    // it: an L joins at an end, a T joins somewhere along the middle. Written once because they
    // are one shape with one parameter, which is also how the brief describes them.
    const spine = rng.range(3, SHAPE_SPAN);
    const arm = rng.range(2, Math.max(2, SHAPE_SPAN - 2));
    const vertical = rng.next() < 0.5;
    const armBack = rng.next() < 0.5;

    const sx = rng.range(0, Math.max(0, SHAPE_SPAN - spine)) + SHAPE_MARGIN;
    const sy = rng.range(0, Math.max(0, SHAPE_SPAN - arm)) + SHAPE_MARGIN;

    // Where along the spine the arm leaves it. An L is pinned to an end; a T is anywhere strictly
    // inside, so it always reads as a junction rather than as a badly drawn L.
    const joint =
      kind === SHAPE_ELL ? (rng.next() < 0.5 ? 0 : spine - 1) : rng.range(1, Math.max(1, spine - 2));

    for (let i = 0; i < spine; i++) {
      if (vertical) put(cells, sx, sy + i, material);
      else put(cells, sx + i, sy, material);
    }
    for (let j = 1; j < arm; j++) {
      const off = armBack ? -j : j;
      if (vertical) put(cells, sx + off, sy + joint, material);
      else put(cells, sx + joint, sy + off, material);
    }
    return cells;
  }

  // A ROOM: a hollow rectangle with its walls one cell thick and one to three ENTRANCES punched
  // out of it. The entrances are what stop it being a box the player can only look at - and they
  // are punched after the walls are laid rather than skipped during, so a corner is never removed
  // and the room can never come apart into two loose lines.
  const w = rng.range(4, Math.min(SHAPE_SPAN, 7));
  const h = rng.range(4, Math.min(SHAPE_SPAN, 6));
  const ox = rng.range(0, SHAPE_SPAN - w) + SHAPE_MARGIN;
  const oy = rng.range(0, SHAPE_SPAN - h) + SHAPE_MARGIN;

  for (let i = 0; i < w; i++) {
    put(cells, ox + i, oy, material);
    put(cells, ox + i, oy + h - 1, material);
  }
  for (let j = 1; j < h - 1; j++) {
    put(cells, ox, oy + j, material);
    put(cells, ox + w - 1, oy + j, material);
  }

  const doors = rng.range(1, 3);
  for (let d = 0; d < doors; d++) {
    const side = rng.int(4);
    if (side === 0) put(cells, ox + rng.range(1, w - 2), oy, WALL_EMPTY);
    else if (side === 1) put(cells, ox + rng.range(1, w - 2), oy + h - 1, WALL_EMPTY);
    else if (side === 2) put(cells, ox, oy + rng.range(1, h - 2), WALL_EMPTY);
    else put(cells, ox + w - 1, oy + rng.range(1, h - 2), WALL_EMPTY);
  }
  return cells;
}

/** One block's cells, from the memo or freshly dealt. */
function blockAt(w: MossWalls, bx: number, by: number): Uint8Array {
  const key = blockKey(bx, by);
  const hit = w.blocks.get(key);
  if (hit !== undefined) return hit;

  const cells = generateBlock(w.seed, bx, by);
  // A Map iterates in insertion order, so the first key is the oldest. Evicting it is safe
  // BECAUSE THIS IS A PURE MEMO - see the header.
  if (w.blocks.size >= BLOCK_CACHE_CAP) {
    const oldest = w.blocks.keys().next();
    if (oldest.done !== true) w.blocks.delete(oldest.value);
  }
  w.blocks.set(key, cells);
  return cells;
}

/** Floor division that is correct for negative coordinates, which half this map has. */
function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/**
 * WHAT IS IN CELL (cx, cy): one of the `WALL_*` values.
 *
 * The clear radius and the broken set are both applied HERE rather than at generation, so that
 * every query in this file - collision, rays, rendering - sees the same world without any of them
 * having to remember to ask.
 */
export function wallKindAt(w: MossWalls, cx: number, cy: number): number {
  const x = (cx + 0.5) * WALL_CELL;
  const y = (cy + 0.5) * WALL_CELL;
  if (x * x + y * y < CLEAR_RADIUS * CLEAR_RADIUS) return WALL_EMPTY;

  const bx = floorDiv(cx, BLOCK_CELLS);
  const by = floorDiv(cy, BLOCK_CELLS);
  const cells = blockAt(w, bx, by);
  const kind = cells[(cy - by * BLOCK_CELLS) * BLOCK_CELLS + (cx - bx * BLOCK_CELLS)];
  if (kind === WALL_TREE && w.broken.has(cellKey(cx, cy))) return WALL_EMPTY;
  return kind;
}

/** True if this cell held a tree that has since been broken. The renderer draws a stump there. */
export function isWallBroken(w: MossWalls, cx: number, cy: number): boolean {
  return w.broken.has(cellKey(cx, cy));
}

/** Cell column containing a world x. Also the row, for a world y - the lattice is square. */
export function wallCellOf(v: number): number {
  return Math.floor(v / WALL_CELL);
}

/** Centre of a cell, per axis. */
export function wallCentre(c: number): number {
  return (c + 0.5) * WALL_CELL;
}

// -------------------------------------------------------------------------------------------
// The queries `scenery.ts` dispatches to
// -------------------------------------------------------------------------------------------

/**
 * Cell index packing for the `Scenery` query contract, which hands an opaque integer back to the
 * caller and expects to be asked for its position later. See `sceneryX`/`sceneryY` in scenery.ts.
 */
export function packWallCell(cx: number, cy: number): number {
  return cellKey(cx, cy);
}
export function wallCellX(i: number): number {
  return Math.floor(i / KEY_SPAN) - KEY_BIAS;
}
export function wallCellY(i: number): number {
  return (i % KEY_SPAN) - KEY_BIAS;
}

/** Half a cell. What a broken tree's burst is sized from, and the radius a cell reports. */
export const WALL_HALF = WALL_CELL / 2;

/**
 * Squared distance from (x, y) to the nearest point of cell (cx, cy), and 0 when inside it.
 *
 * The whole of wall collision is this function: a cell is an axis-aligned box, and every question
 * anything asks about one - does this circle touch it, where does it get pushed to, does the ray
 * enter it - is answered from the closest point on the box.
 */
function cellDist2(cx: number, cy: number, x: number, y: number): number {
  const x0 = cx * WALL_CELL;
  const y0 = cy * WALL_CELL;
  const dx = x < x0 ? x0 - x : x > x0 + WALL_CELL ? x - (x0 + WALL_CELL) : 0;
  const dy = y < y0 ? y0 - y : y > y0 + WALL_CELL ? y - (y0 + WALL_CELL) : 0;
  return dx * dx + dy * dy;
}

/**
 * The first wall cell the circle (x, y, r) touches, or -1. Trees count: a shell stops on one and
 * then breaks it, exactly as it does on a fuel barrel.
 *
 * The scan is the cell range the circle's bounding box covers, which is at most 2x2 for anything
 * the game moves (the widest body is far under a cell) and never depends on how much terrain
 * exists.
 *
 * `d2 === 0` IS A HIT, and leaving that out is what let every projectile in the game fly through
 * every wall. A round is tested as a POINT - `sceneryOverlap(scenery, x, y, 0)` - and a point
 * inside a cell is at distance 0 from it, so the strict `d2 < r * r` reads `0 < 0` and is false.
 * The Scrapyard never showed this because a pile has a radius of its own: its reach is `pr + r`,
 * which stays positive at r = 0. A box has no radius, so containment has to be said out loud.
 */
export function wallOverlap(w: MossWalls, x: number, y: number, r: number): number {
  const c0 = wallCellOf(x - r);
  const c1 = wallCellOf(x + r);
  const r0 = wallCellOf(y - r);
  const r1 = wallCellOf(y + r);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      if (wallKindAt(w, cx, cy) === WALL_EMPTY) continue;
      const d2 = cellDist2(cx, cy, x, y);
      if (d2 === 0 || d2 < r * r) return packWallCell(cx, cy);
    }
  }
  return -1;
}

/**
 * The nearest BREAKABLE cell the circle touches, or -1. The complement of what rays occlude on.
 *
 * `d2 === 0` counts here for the same reason as in `wallOverlap`, and the symptom was its twin: a
 * shell arriving asks with radius 0, so without it an impact could never fell a tree and only
 * splash - which has a radius - ever could.
 */
export function wallDestructibleOverlap(w: MossWalls, x: number, y: number, r: number): number {
  const c0 = wallCellOf(x - r);
  const c1 = wallCellOf(x + r);
  const r0 = wallCellOf(y - r);
  const r1 = wallCellOf(y + r);
  let best = -1;
  let bestD2 = 0;
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      if (wallKindAt(w, cx, cy) !== WALL_TREE) continue;
      const d2 = cellDist2(cx, cy, x, y);
      if (d2 !== 0 && d2 >= r * r) continue;
      if (best < 0 || d2 < bestD2) {
        best = packWallCell(cx, cy);
        bestD2 = d2;
      }
    }
  }
  return best;
}

/**
 * How many times a push may re-test and push again.
 *
 * A circle smaller than a cell touches at most a 2x2 patch, so three resolutions settle every
 * corner the lattice can make. MEASURED, not reasoned: over 120 000 probe positions, one pass
 * leaves 25.7% of bodies still overlapping something, two leaves 0.5%, and three leaves none.
 * A fourth changes nothing. The loop breaks as soon as a pass finds no overlap, so the common
 * case - a body pressed against a flat wall - still costs exactly one.
 */
const PUSH_PASSES = 3;

/** Module scratch, for the same reason `scenery.ts` keeps one: the movement loops allocate nothing. */
const PUSH: SceneryPush = { x: 0, y: 0, nx: 0, ny: 0, hit: false };

/**
 * Slides a circle out of whatever wall it has entered.
 *
 * TWO PASSES, WHICH THE SCRAPYARD DOES NOT NEED. Its piles cannot overlap, so a body is inside at
 * most one and a single push always resolves. A wall is a LATTICE: a body in an inside corner is
 * genuinely inside two cells at once, and pushing out of one leaves it in the other. Resolving the
 * deepest first and then re-testing settles a corner exactly, and there is no third cell an
 * axis-aligned corner can reach.
 *
 * The normal returned is the LAST push's, which is the one that decides what the caller does next -
 * the player kills its inward velocity, an enemy keeps the tangent and walks along the wall. That
 * is the whole reason enemies get around a wall at all; they have no pathfinding, and sliding is
 * the only tool they have.
 */
export function pushOutOfWalls(
  w: MossWalls,
  x: number,
  y: number,
  r: number,
): Readonly<SceneryPush> {
  PUSH.x = x;
  PUSH.y = y;
  PUSH.nx = 0;
  PUSH.ny = 0;
  PUSH.hit = false;

  for (let pass = 0; pass < PUSH_PASSES; pass++) {
    const px = PUSH.x;
    const py = PUSH.y;
    const c0 = wallCellOf(px - r);
    const c1 = wallCellOf(px + r);
    const r0 = wallCellOf(py - r);
    const r1 = wallCellOf(py + r);

    let bestCx = 0;
    let bestCy = 0;
    let bestD2 = r * r;
    let found = false;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (wallKindAt(w, cx, cy) === WALL_EMPTY) continue;
        const d2 = cellDist2(cx, cy, px, py);
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        bestCx = cx;
        bestCy = cy;
        found = true;
      }
    }
    if (!found) break;

    const x0 = bestCx * WALL_CELL;
    const y0 = bestCy * WALL_CELL;
    const x1 = x0 + WALL_CELL;
    const y1 = y0 + WALL_CELL;

    if (bestD2 > 0) {
      // Outside the box: push along the line from the closest point on it, which is the shortest
      // way out and gives the face's normal on a flat wall and a corner's diagonal on a corner.
      const qx = px < x0 ? x0 : px > x1 ? x1 : px;
      const qy = py < y0 ? y0 : py > y1 ? y1 : py;
      const dx = px - qx;
      const dy = py - qy;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy);
      PUSH.nx = dx * inv;
      PUSH.ny = dy * inv;
      PUSH.x = qx + PUSH.nx * r;
      PUSH.y = qy + PUSH.ny * r;
    } else {
      // INSIDE the box, which movement alone cannot produce - it is a body that spawned in a wall,
      // or one a teleport put there.
      //
      // OUT THROUGH THE NEAREST FACE THAT OPENS ONTO AIR, which is the whole subtlety here. The
      // obvious rule - nearest face, full stop - does not terminate: a body buried in the middle of
      // a horizontal run has its left and right faces nearest, and leaving through either puts it
      // inside the NEXT cell of the same wall, where the same rule applies again. It walks along
      // the inside of the wall for as many passes as it is given and is still embedded at the end.
      // Measured at 9.5% of pushes before this test existed, and it did not improve with more
      // passes because it is a fixed point rather than slow convergence.
      //
      // A fully buried body - every neighbour also wall - has no open face, and then the nearest
      // one is the right answer again: the next pass carries it one cell closer to the surface.
      const dl = px - x0;
      const dr = x1 - px;
      const du = py - y0;
      const dd = y1 - py;
      const openL = wallKindAt(w, bestCx - 1, bestCy) === WALL_EMPTY;
      const openR = wallKindAt(w, bestCx + 1, bestCy) === WALL_EMPTY;
      const openU = wallKindAt(w, bestCx, bestCy - 1) === WALL_EMPTY;
      const openD = wallKindAt(w, bestCx, bestCy + 1) === WALL_EMPTY;
      const any = openL || openR || openU || openD;
      const BURIED = Infinity;
      const cl = !any || openL ? dl : BURIED;
      const cr = !any || openR ? dr : BURIED;
      const cu = !any || openU ? du : BURIED;
      const cd = !any || openD ? dd : BURIED;
      const m = Math.min(cl, cr, cu, cd);
      if (m === cl) {
        PUSH.nx = -1;
        PUSH.ny = 0;
        PUSH.x = x0 - r;
        PUSH.y = py;
      } else if (m === cr) {
        PUSH.nx = 1;
        PUSH.ny = 0;
        PUSH.x = x1 + r;
        PUSH.y = py;
      } else if (m === cu) {
        PUSH.nx = 0;
        PUSH.ny = -1;
        PUSH.x = px;
        PUSH.y = y0 - r;
      } else {
        PUSH.nx = 0;
        PUSH.ny = 1;
        PUSH.x = px;
        PUSH.y = y1 + r;
      }
    }
    PUSH.hit = true;
  }

  return PUSH;
}

/**
 * Walks the ray (ox, oy) + t * (dx, dy) cell by cell, calling `want` on each, and returns the
 * distance at which it first enters a cell that answers true - or -1 within `maxT`.
 *
 * A grid traversal rather than a box test per candidate cell, because a laser reaching 473 u
 * crosses seven cells and testing the whole bounding rectangle would be fifty. This is the
 * standard incremental DDA: step whichever axis has the nearer boundary, and the distance at that
 * boundary IS the entry distance, so nothing has to be solved.
 */
let rayCellX = 0;
let rayCellY = 0;

function rayWalk(
  w: MossWalls,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
  want: number,
): number {
  let cx = wallCellOf(ox);
  let cy = wallCellOf(oy);

  // An emitter standing INSIDE a wall hits it at zero rather than shooting out through it.
  if (wallKindAt(w, cx, cy) === want) {
    rayCellX = cx;
    rayCellY = cy;
    return 0;
  }

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  // Distance along the ray per cell of travel on each axis. Infinity for an axis-aligned ray,
  // which then simply never steps that axis - `Infinity < t` is false and needs no special case.
  const tDeltaX = dx === 0 ? Infinity : WALL_CELL / (dx < 0 ? -dx : dx);
  const tDeltaY = dy === 0 ? Infinity : WALL_CELL / (dy < 0 ? -dy : dy);

  const nextX = (cx + (dx > 0 ? 1 : 0)) * WALL_CELL;
  const nextY = (cy + (dy > 0 ? 1 : 0)) * WALL_CELL;
  let tMaxX = dx === 0 ? Infinity : (nextX - ox) / dx;
  let tMaxY = dy === 0 ? Infinity : (nextY - oy) / dy;

  for (;;) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      t = tMaxY;
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (t > maxT) return -1;
    if (wallKindAt(w, cx, cy) === want) {
      // The cell is recorded rather than left to be re-derived from `t`. Stepping a little way
      // along the ray to find out what it hit LOOKS equivalent and is not: at a grazing angle the
      // ray can cross a corner and be back out of the cell within a unit, so the caller would fell
      // the tree next door - or a cell with no tree in it at all.
      rayCellX = cx;
      rayCellY = cy;
      return t;
    }
  }
}

/**
 * Distance at which the ray first meets a SOLID wall, or -1. This is what stops a laser firing
 * into a rock face before it pays any heat for the shot.
 *
 * TREES ARE EXEMPT, exactly as fuel barrels are on the Scrapyard and for the same reason: a beam
 * has to be able to burn one down, and a weapon that refuses to fire at a thing it could destroy
 * would leave the continuous guns unable to clear a wood at all.
 */
export function wallRayHit(
  w: MossWalls,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
): number {
  return rayWalk(w, ox, oy, dx, dy, maxT, WALL_SOLID);
}

/** The first TREE the ray enters, as a packed cell, or -1. The complement of `wallRayHit`. */
export function wallDestructibleRayHit(
  w: MossWalls,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
): number {
  if (rayWalk(w, ox, oy, dx, dy, maxT, WALL_TREE) < 0) return -1;
  return packWallCell(rayCellX, rayCellY);
}

/** Fells the tree in a packed cell. One write, and every query above forgets it at once. */
export function breakWallCell(w: MossWalls, i: number): void {
  if (w.broken.has(i)) return;
  w.broken.add(i);
  w.hurt.delete(i);
  w.count++;
  w.version++;
}

/**
 * How many stems of a cell are still standing. `wallStemsAt` when nothing has touched it, 0 once
 * the cell is broken, and the remaining fraction of the pool in between.
 *
 * ROUNDED UP, so a stem is standing until its share of the pool is GONE rather than disappearing
 * the moment it is scratched. Five stems on 550 points means the fifth falls at 440, the fourth at
 * 330, and the cell opens at 0 - which is the promise the bar makes: every hit is progress and the
 * last hit is the one that opens the gap.
 */
export function wallStemsStanding(w: MossWalls, cx: number, cy: number): number {
  const i = cellKey(cx, cy);
  if (w.broken.has(i)) return 0;
  const left = w.hurt.get(i);
  const stems = wallStemsAt(w, cx, cy);
  if (left === undefined) return stems;
  const up = Math.ceil(left / TREE_STEM_HP);
  return up < 0 ? 0 : up > stems ? stems : up;
}

/**
 * Puts `amount` of damage into a destructible cell. Returns how many stems that hit brought down,
 * which is 0 for most hits and is what the caller turns into events.
 *
 * THE VERSION IS BUMPED ONLY WHEN THE CELL OPENS, not per stem. A stem coming down changes what is
 * DRAWN and nothing about what is solid - the cell is a collider until the last one falls - and
 * `version` is read by the flow field to decide whether to throw its cached routes away. Bumping
 * it per stem would rebuild the horde's pathing every time a shell clipped a tree, for a route
 * that had not changed.
 */
export function damageWallCell(w: MossWalls, i: number, amount: number): number {
  if (amount <= 0 || w.broken.has(i)) return 0;
  const cx = wallCellX(i);
  const cy = wallCellY(i);
  const stems = wallStemsAt(w, cx, cy);
  const before = w.hurt.get(i) ?? stems * TREE_STEM_HP;
  const after = before - amount;
  const standingBefore = Math.ceil(before / TREE_STEM_HP);

  if (after <= 0) {
    breakWallCell(w, i);
    return standingBefore;
  }
  w.hurt.set(i, after);
  const standingAfter = Math.ceil(after / TREE_STEM_HP);
  return standingBefore - standingAfter;
}
